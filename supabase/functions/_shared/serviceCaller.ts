// serviceCaller.ts — is this request really from the service role (cron, or
// another of our functions)? The one way to ask.
//
// Found 27 Sep: five functions deployed with verify_jwt = false (so the gateway
// checks nothing) decided "service role" by base64-decoding the token and
// reading {"role": "service_role"} — WITHOUT checking its signature. Anyone
// could type that token. Tested: an unsigned forgery got a 200 from
// lead-qualify. calendar-sync then trusted body.user_id (any agent's calendar),
// task-autoschedule rewrote any user's schedule, ari-briefing-deliver sent
// briefings. A decoded claim is not a verified one.
//
// Accepted: the exact service key this function was given, the shared QCP
// token, or any other token the API itself accepts as a service key (there are
// two live formats, legacy JWT and sb_secret). The last is checked by asking
// PostgREST's root, which answers ONLY to a service key — forged, anon and user
// tokens all get 401. Verified tokens are remembered for the isolate's life.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const QCP = Deno.env.get("QCP_TOKEN") || "";
const verified = new Set<string>();

export function bearer(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function isServiceCaller(req: Request): Promise<boolean> {
  if (QCP && (req.headers.get("x-qcp-token") || "") === QCP) return true;
  const tok = bearer(req);
  if (!tok) return false;
  if (SERVICE && tok === SERVICE) return true;
  if (verified.has(tok)) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: tok, Authorization: `Bearer ${tok}`, Accept: "application/openapi+json" },
    });
    try { await r.body?.cancel(); } catch { /* nothing to drain */ }
    if (r.ok) { verified.add(tok); return true; }
  } catch { /* network trouble is a no, never a yes */ }
  return false;
}
