// gmail-trash
// Move a message or thread to Gmail's Trash (Gmail will auto-delete after 30 days).
// This is the standard "delete" behavior — true permanent delete is intentionally
// not exposed because it's irreversible.
//
// POST body: { account_id, thread_id?: provider_thread_id, message_id?: provider_message_id }
// One of thread_id or message_id required. If thread_id, trashes the entire thread.

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { account_id, thread_id, message_id } = body || {};
    if (!account_id || (!thread_id && !message_id)) {
      return new Response(JSON.stringify({ error: "account_id and one of thread_id/message_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // SECURITY: verify caller via JWT; service-role calls rejected here
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account, error: aErr } = await supabase
      .from("email_accounts").select("*").eq("id", account_id).single();
    if (aErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (account.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden: account does not belong to caller" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    // Call Gmail trash endpoint
    let url, dbCleanup;
    if (thread_id) {
      url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread_id}/trash`;
      dbCleanup = async () => {
        // Mark thread as trashed locally: remove INBOX, add TRASH
        const { data: thread } = await supabase
          .from("email_threads").select("id, labels")
          .eq("account_id", account_id).eq("provider_thread_id", thread_id).maybeSingle();
        if (thread) {
          const newLabels = (thread.labels || []).filter(l => l !== "INBOX");
          if (!newLabels.includes("TRASH")) newLabels.push("TRASH");
          await supabase.from("email_threads")
            .update({ labels: newLabels, has_unread: false })
            .eq("id", thread.id);
        }
      };
    } else {
      url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/trash`;
      dbCleanup = async () => {
        const { data: msg } = await supabase
          .from("email_messages").select("id, labels, thread_id")
          .eq("account_id", account_id).eq("provider_message_id", message_id).maybeSingle();
        if (msg) {
          const newLabels = (msg.labels || []).filter(l => l !== "INBOX");
          if (!newLabels.includes("TRASH")) newLabels.push("TRASH");
          await supabase.from("email_messages").update({ labels: newLabels }).eq("id", msg.id);
        }
      };
    }

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Gmail trash failed: ${r.status}`, detail: t.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await dbCleanup();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
