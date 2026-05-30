// email-snooze-restore
// Sweeps email_threads where snoozed_until <= now AND snoozed_until IS NOT NULL.
// Clears snoozed_until and re-adds INBOX label to the thread (locally + via Gmail).
// Run by pg_cron every 5 minutes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(account) {
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
  if (!r.ok) return null;
  const tokens = await r.json();
  return tokens.access_token;
}

serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: due } = await supabase
      .from("email_threads")
      .select("id, account_id, provider_thread_id, labels")
      .not("snoozed_until", "is", null)
      .lte("snoozed_until", new Date().toISOString())
      .limit(100);

    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, restored: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by account to share access tokens
    const byAccount = new Map();
    for (const t of due) {
      if (!byAccount.has(t.account_id)) byAccount.set(t.account_id, []);
      byAccount.get(t.account_id).push(t);
    }

    let restored = 0;
    for (const [accountId, threads] of byAccount) {
      const { data: account } = await supabase
        .from("email_accounts").select("*").eq("id", accountId).single();
      if (!account || !account.refresh_token) continue;
      const accessToken = await refreshAccessToken(account);
      if (!accessToken) continue;

      for (const t of threads) {
        // Re-add INBOX label via Gmail
        try {
          await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.provider_thread_id}/modify`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ addLabelIds: ["INBOX"] }),
          });
        } catch (_) { /* non-fatal */ }

        // Update local: clear snoozed_until, add INBOX label
        const labels = new Set(t.labels || []);
        labels.add("INBOX");
        await supabase.from("email_threads")
          .update({ snoozed_until: null, labels: Array.from(labels) })
          .eq("id", t.id);
        restored++;
      }
    }

    return new Response(JSON.stringify({ ok: true, restored }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
