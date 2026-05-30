// gmail-labels-sync
// Mirror the user's Gmail labels (both system and user-created) into our
// gmail_labels table so the label picker is fast and offline-friendly.
//
// POST body: { account_id }

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
  if (!account.refresh_token) throw new Error("No refresh_token");
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
    const { account_id } = body || {};
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    const { data: account } = await supabase
      .from("email_accounts").select("*").eq("id", account_id).single();
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    // Fetch full labels list from Gmail
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`Gmail labels fetch failed: ${r.status}`);
    const { labels = [] } = await r.json();

    // Upsert each into gmail_labels
    let synced = 0;
    for (const l of labels) {
      const row = {
        user_id: account.user_id,
        account_id,
        label_id: l.id,
        name: l.name,
        type: l.type === "system" ? "system" : "user",
        color: l.color || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("gmail_labels")
        .upsert(row, { onConflict: "account_id,label_id" });
      if (!error) synced++;
    }

    // Remove labels that no longer exist on Gmail
    const liveIds = labels.map(l => l.id);
    if (liveIds.length > 0) {
      await supabase.from("gmail_labels")
        .delete().eq("account_id", account_id)
        .not("label_id", "in", `(${liveIds.map(id => `"${id}"`).join(",")})`);
    }

    return new Response(JSON.stringify({ ok: true, synced, total: labels.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
