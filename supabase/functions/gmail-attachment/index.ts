// gmail-attachment — fetches a single attachment's bytes from Gmail on demand.
// Auth: uses the CALLER's JWT for DB reads, so RLS guarantees a user can only
// pull attachments on their own accounts. The Gmail API call uses that account's
// (refreshed) access token. Returns base64url data for the client to save/open.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const { account_id, provider_message_id, provider_attachment_id } = await req.json();
    if (!account_id || !provider_message_id || !provider_attachment_id) return J({ ok: false, error: "missing params" }, 400);

    // RLS-scoped client (caller's JWT) — only the owner can read this account.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }
    );
    const { data: account, error: aerr } = await supabase
      .from("email_accounts").select("*").eq("id", account_id).maybeSingle();
    if (aerr || !account) return J({ ok: false, error: "account not found or not yours" }, 404);

    // Refresh the access token (Google access tokens expire ~hourly).
    let accessToken = account.access_token;
    const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
    if (!accessToken || exp - Date.now() < 120000) {
      const t = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
          refresh_token: account.refresh_token,
          grant_type: "refresh_token",
        }).toString(),
      });
      if (!t.ok) return J({ ok: false, error: `token refresh ${t.status}` }, 502);
      accessToken = (await t.json()).access_token;
    }

    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${provider_message_id}/attachments/${provider_attachment_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return J({ ok: false, error: `gmail ${r.status}: ${(await r.text()).slice(0, 150)}` }, 502);
    const j = await r.json(); // { size, data: base64url }
    return J({ ok: true, data: j.data, size: j.size });
  } catch (e) {
    return J({ ok: false, error: String(e) }, 500);
  }
});
