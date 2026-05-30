// gmail-modify
// Unified endpoint for modifying labels on a Gmail thread.
// Handles: archive (remove INBOX), star/unstar, mark read/unread, spam,
// arbitrary label add/remove. All via Gmail's threads.modify API.
//
// POST body:
//   { account_id, thread_id: provider_thread_id,
//     add?: string[],     // label IDs/names to add
//     remove?: string[]   // label IDs/names to remove
//   }
//
// Convenience flags (set add/remove for you):
//   action: 'archive' | 'unarchive' | 'star' | 'unstar' | 'mark_read' | 'mark_unread' | 'spam' | 'unspam'
//
// Returns: { ok: true, thread: { labels: [...] } }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function refreshAccessTokenIfNeeded(supabase, account) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token on account — reconnect Gmail.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  const tokens = await r.json();
  const newExp = new Date(now + ((tokens.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({
    access_token: tokens.access_token, token_expires_at: newExp,
  }).eq("id", account.id);
  return tokens.access_token;
}

// Action → label changes mapping
const ACTIONS = {
  archive:     { remove: ["INBOX"] },
  unarchive:   { add: ["INBOX"] },
  star:        { add: ["STARRED"] },
  unstar:      { remove: ["STARRED"] },
  mark_read:   { remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"] },
  spam:        { add: ["SPAM"], remove: ["INBOX"] },
  unspam:      { remove: ["SPAM"], add: ["INBOX"] },
  snooze:      { remove: ["INBOX"] },   // hide from inbox; cron restores at snooze_until
  unsnooze:    { add: ["INBOX"] },      // restore early
};

// Verifies the caller via JWT in the Authorization header. Returns the user's
// id, or throws if the token is missing/invalid. Service-role calls (cron)
// would not normally hit this function — it's purely client-called.
async function requireAuthedUserId(req, supabase) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Unauthorized: missing Authorization header");
  // Reject service-role tokens — this endpoint is per-user only
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("Unauthorized: service-role calls not permitted on this endpoint");
  }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized: invalid or expired token");
  return user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { account_id, thread_id, action, snooze_until } = body || {};
    let { add = [], remove = [] } = body || {};

    if (!account_id || !thread_id) {
      return new Response(JSON.stringify({ error: "account_id and thread_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action) {
      const preset = ACTIONS[action];
      if (!preset) {
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      add = [...add, ...(preset.add || [])];
      remove = [...remove, ...(preset.remove || [])];
    }

    if (add.length === 0 && remove.length === 0) {
      return new Response(JSON.stringify({ error: "Nothing to do — provide action or add/remove" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // SECURITY: verify caller identity from JWT, then verify account belongs to caller.
    // Before this check, an authenticated user could pass any other user's account_id
    // and modify their Gmail labels.
    const callerUserId = await requireAuthedUserId(req, supabase);

    const { data: account, error: aErr } = await supabase
      .from("email_accounts").select("*").eq("id", account_id).single();
    if (aErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (account.user_id !== callerUserId) {
      return new Response(JSON.stringify({ error: "Forbidden: account does not belong to caller" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    // Call Gmail threads.modify
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread_id}/modify`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Gmail modify failed: ${r.status}`, detail: t.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await r.json();

    // Update local DB: compute new label set for the thread
    const { data: thread } = await supabase
      .from("email_threads").select("id, labels")
      .eq("account_id", account_id).eq("provider_thread_id", thread_id).maybeSingle();
    if (thread) {
      const labelSet = new Set(thread.labels || []);
      for (const l of remove) labelSet.delete(l);
      for (const l of add) labelSet.add(l);
      const newLabels = Array.from(labelSet);
      const hasUnread = newLabels.includes("UNREAD");
      const patch: any = { labels: newLabels, has_unread: hasUnread };
      if (action === "snooze" && snooze_until) patch.snoozed_until = snooze_until;
      if (action === "unsnooze") patch.snoozed_until = null;
      await supabase.from("email_threads")
        .update(patch)
        .eq("id", thread.id);
      // Also update individual messages' labels
      await supabase.from("email_messages")
        .update({ labels: newLabels, is_read: !hasUnread })
        .eq("thread_id", thread.id);
    }

    return new Response(JSON.stringify({ ok: true, applied: { add, remove } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err && (err as any).message ? (err as any).message : String(err);
    const status = msg.startsWith("Unauthorized") ? 401 : msg.startsWith("Forbidden") ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
