// guard.ts — one door check for functions that must not run for just anyone.
//
// Found 8 Oct 2026 (security audit H1–H3, M4): sixteen functions ran with the
// service role for any caller on the internet. Eleven had verify_jwt = false
// and no check at all (sheets-sync read the commission sheet with the owner's
// Google token; call-commitments, disc-batch-nightly and unstuck-weekly spent
// AI credit; usage-report-monthly mailed a cost report; recording-purge deleted
// audio). Four had verify_jwt = true, which the PUBLIC anon key passes, and
// trusted a user_id from the body (call-enrich read call summaries across
// agents). property-research billed AI to whatever user_id it was handed.
//
// The rule, in one place:
//   requireService    — pg_cron or another of our functions only. Accepts what
//                       isServiceCaller accepts (the service key pg_cron sends
//                       from Vault, or the x-qcp-token). Everyone else: 401.
//   requireServiceOr  — the service role, or a signed-in user. A user may only
//                       act for THEMSELVES (body user_id must match the token),
//                       or, with { staff: true }, must be owner/broker_admin.
//
// Probe: a caller that passes the check and sends `x-guard-probe: 1` gets
// 200 {ok, probe} and the job does NOT run. That is how a deploy proves the
// cron's own credential still opens the door without triggering a monthly
// email or a recording purge. A caller that fails the check never reaches it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearer, isServiceCaller } from "./serviceCaller.ts";

const PROBE = "x-guard-probe";
type H = Record<string, string>;

function reply(body: unknown, status: number, cors: H): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function probed(req: Request, cors: H, who: string): Response | null {
  return req.headers.get(PROBE) === "1" ? reply({ ok: true, probe: true, caller: who }, 200, cors) : null;
}

/** Service role (pg_cron, our own functions) only. Returns a Response to send back, or null to carry on. */
export async function requireService(req: Request, cors: H = {}): Promise<Response | null> {
  if (!(await isServiceCaller(req))) return reply({ ok: false, error: "not allowed" }, 401, cors);
  return probed(req, cors, "service");
}

export type Caller = { service: boolean; userId: string | null; res: Response | null };

/** Service role, or a signed-in user acting for themselves (or staff, when opts.staff). */
export async function requireServiceOr(
  req: Request, cors: H = {}, opts: { staff?: boolean; bodyUserId?: string | null } = {},
): Promise<Caller> {
  if (await isServiceCaller(req)) return { service: true, userId: opts.bodyUserId || null, res: probed(req, cors, "service") };
  const tok = bearer(req);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let uid: string | null = null;
  if (tok) {
    try { const { data } = await admin.auth.getUser(tok); uid = data?.user?.id || null; } catch { uid = null; }
  }
  if (!uid) return { service: false, userId: null, res: reply({ ok: false, error: "sign in first" }, 401, cors) };
  if (opts.bodyUserId && opts.bodyUserId !== uid) {
    return { service: false, userId: null, res: reply({ ok: false, error: "you can only do this for yourself" }, 403, cors) };
  }
  if (opts.staff) {
    const { data: rows } = await admin.from("agents").select("role").eq("auth_user_id", uid);
    const ok = (rows || []).length === 1 && ["owner", "broker_admin"].includes(rows![0].role);
    if (!ok) return { service: false, userId: null, res: reply({ ok: false, error: "owner or broker admin only" }, 403, cors) };
  }
  return { service: false, userId: uid, res: probed(req, cors, opts.staff ? "staff" : "user") };
}
