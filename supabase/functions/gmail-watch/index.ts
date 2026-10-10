// gmail-watch — arms (and renews) Gmail push notifications via users.watch()
// for every active account, pointing at the GMAIL_PUBSUB_TOPIC. Gmail watches
// expire <=7 days, so a cron re-runs this daily. Stores watch_expires_at.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireService } from "../_shared/guard.ts";
import { withTokenCrypto } from "../_shared/googleTokens.ts";

async function freshAccessToken(account) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120000) return account.access_token;
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
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json()).access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  { const denied = await requireService(req, {}); if (denied) return denied; }   // pg_cron / service only (_shared/guard.ts)
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  try {
    const topic = Deno.env.get("GMAIL_PUBSUB_TOPIC");
    if (!topic) return J({ ok: false, error: "GMAIL_PUBSUB_TOPIC not set" }, 500);
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), withTokenCrypto());
    const { data: accounts } = await supabase.from("email_accounts").select("*").eq("is_active", true);
    const watched = [];
    for (const a of accounts || []) {
      try {
        const at = await freshAccessToken(a);
        const w = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
          method: "POST",
          headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
          body: JSON.stringify({ topicName: topic }),
        });
        if (!w.ok) { watched.push({ email: a.email_address, ok: false, error: `watch ${w.status}: ${(await w.text()).slice(0, 150)}` }); continue; }
        const wj = await w.json();
        const expIso = wj.expiration ? new Date(parseInt(wj.expiration)).toISOString() : null;
        await supabase.from("email_accounts").update({ watch_expires_at: expIso, watch_history_id: wj.historyId || null }).eq("id", a.id);
        watched.push({ email: a.email_address, ok: true, expires_at: expIso, history_id: wj.historyId });
      } catch (e) {
        watched.push({ email: a.email_address, ok: false, error: String(e) });
      }
    }
    return J({ ok: true, watched });
  } catch (e) { return J({ ok: false, error: String(e) }, 500); }
});
