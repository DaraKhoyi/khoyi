// Serves a shared listing presentation as HTML by its public token. No auth —
// the un-guessable token IS the key. verify_jwt=false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t");
  if (!t) return new Response("Missing link token.", { status: 400 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Seller e-signature submission from the shared deck.
  if (url.searchParams.get("sign") === "1" && req.method === "POST") {
    try {
      const body = await req.json();
      const { data, error } = await sb.rpc("sign_presentation", {
        p_token: t, p_name: body.name || "", p_drawn: body.drawn || "",
        p_consent: !!body.consent, p_ua: body.ua || null,
      });
      const r = Array.isArray(data) ? data[0] : data;
      return new Response(JSON.stringify(error ? { ok: false, message: error.message } : r), {
        headers: { "content-type": "application/json" },
      });
    } catch (_e) {
      return new Response(JSON.stringify({ ok: false, message: "Bad request." }), { status: 400, headers: { "content-type": "application/json" } });
    }
  }

  const { data, error } = await sb.rpc("get_shared_presentation", { p_token: t });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || !row.html) {
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="background:#100D09;color:#F6F1E7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1 style="font-family:Georgia,serif;font-weight:400">This presentation isn't available</h1><p style="color:#8C8475">The link may have expired or been turned off. Ask your agent for a fresh link.</p></div></body>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  // best-effort view bump
  sb.rpc("bump_presentation_view", { p_token: t }).then(() => {}).catch(() => {});
  return new Response(row.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
