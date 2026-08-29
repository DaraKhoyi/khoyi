// email-unsubscribe
//
// Archiving junk is a tap. Stopping it is permanent — and it is the only action
// on the whole card that makes tomorrow's queue smaller than today's.
//
// Real senders publish List-Unsubscribe (RFC 2369) and increasingly
// List-Unsubscribe-Post (RFC 8058), which allows a single POST with no
// confirmation page. We prefer that; then an https link the person can open;
// then mailto, which we send from their own mailbox.
//
// We do NOT store raw_headers — the column exists and is empty on all 55,234
// messages — so the headers are read from Gmail on demand.
//
// Auth: the caller's own JWT. The account must belong to them. There is no
// service-role path: nothing should be able to unsubscribe on someone's behalf.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function freshToken(admin: any, account: any): Promise<string> {
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (exp > Date.now() + 60000 && account.access_token) return account.access_token;
  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
    refresh_token: account.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Token refresh failed: " + (j.error_description || j.error || r.status));
  await admin.from("email_accounts").update({
    access_token: j.access_token,
    token_expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
  }).eq("id", account.id);
  return j.access_token;
}

// List-Unsubscribe: <https://...>, <mailto:...>
function parseTargets(header: string) {
  const out: { http?: string; mailto?: string } = {};
  for (const m of header.matchAll(/<([^>]+)>/g)) {
    const v = m[1].trim();
    if (/^https?:/i.test(v) && !out.http) out.http = v;
    else if (/^mailto:/i.test(v) && !out.mailto) out.mailto = v;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const { account_id, provider_message_id, sender } = body || {};
    if (!account_id || !provider_message_id) return json({ error: "account_id and provider_message_id required" }, 400);

    const { data: account } = await admin.from("email_accounts")
      .select("*").eq("id", account_id).eq("user_id", user.id).maybeSingle();
    if (!account) return json({ error: "Forbidden: account does not belong to caller" }, 403);

    const token = await freshToken(admin, account);
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${provider_message_id}` +
      `?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post&metadataHeaders=From`;
    const mr = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!mr.ok) return json({ error: `Could not read the message from Gmail (${mr.status})` }, 200);
    const msg = await mr.json();
    const headers: any[] = (msg.payload && msg.payload.headers) || [];
    const get = (n: string) => (headers.find((h) => String(h.name).toLowerCase() === n) || {}).value || "";

    const lu = get("list-unsubscribe");
    const oneClick = /one-?click/i.test(get("list-unsubscribe-post"));
    if (!lu) {
      // Honest: no mechanism exists. Blocking is still worth offering.
      return json({ ok: false, reason: "no_header",
        message: "This sender publishes no unsubscribe link. You can still mark them Not a lead so they stop reaching this queue." });
    }
    const t = parseTargets(lu);

    // RFC 8058 one-click: a single POST, no landing page, no confirmation.
    if (oneClick && t.http) {
      const r = await fetch(t.http, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
      if (r.ok) return json({ ok: true, method: "one_click", sender: sender || get("from") });
      return json({ ok: false, reason: "one_click_failed", url: t.http,
        message: "The sender's one-click unsubscribe returned " + r.status + ". Open the link to finish it." });
    }

    // mailto: we can send that ourselves from their mailbox.
    if (t.mailto) {
      const addr = t.mailto.replace(/^mailto:/i, "").split("?")[0];
      const subjM = /[?&]subject=([^&]*)/i.exec(t.mailto);
      const subject = subjM ? decodeURIComponent(subjM[1]) : "unsubscribe";
      const raw = [
        `To: ${addr}`, `From: ${account.email_address}`, `Subject: ${subject}`,
        "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", "unsubscribe",
      ].join("\r\n");
      const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: b64 }),
      });
      if (sr.ok) return json({ ok: true, method: "mailto", to: addr, sender: sender || get("from") });
      return json({ ok: false, reason: "mailto_failed", url: t.http || null,
        message: "Could not send the unsubscribe email (" + sr.status + ")." });
    }

    // Only a link — hand it back rather than pretending it is done.
    return json({ ok: false, reason: "needs_link", url: t.http || null,
      message: "This one needs a click. Open the sender's unsubscribe page to finish." });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 200);
  }
});
