// critical-connection-watch
//
// The Google watcher covers Google. This covers everything else PrismOS depends
// on that can die quietly — starting with the Quo phone line, which carries
// calls, texts, and now the alerting SMS itself.
//
// The rule Dara set: "any and every critical connection." So this is built as a
// LIST of probes, not a Quo-specific function. Adding the next dependency means
// appending one entry, not writing another watcher that forgets a channel.
//
// Runs on pg_cron every 10 minutes. verify_jwt=false because cron calls it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { raiseConnectionAlert, resolveConnectionAlert } from "../_shared/connectionAlert.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QCP_TOKEN = Deno.env.get("QCP_TOKEN") || "";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Same trust rule as the Google watcher: a service credential or the internal
// cron token. Never an identity supplied in the body.
function isServiceCaller(req: Request): boolean {
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth && auth === SERVICE_KEY) return true;
  if (QCP_TOKEN && (req.headers.get("x-qcp-token") || "") === QCP_TOKEN) return true;
  return false;
}

type ProbeResult = { ok: boolean; revoked: boolean; detail: string };

// A probe distinguishes THREE states, not two. "Could not reach the provider"
// is not "the provider cut you off" — treating a network blip as a revocation
// is how alerting systems teach people to ignore them.
async function probeQuo(): Promise<ProbeResult> {
  const key = Deno.env.get("QUO_API_KEY");
  if (!key) return { ok: false, revoked: true, detail: "QUO_API_KEY is not configured" };
  try {
    const r = await fetch("https://api.openphone.com/v1/phone-numbers", {
      headers: { Authorization: key },
    });
    if (r.ok) return { ok: true, revoked: false, detail: "" };
    const text = (await r.text()).slice(0, 200);
    // 401/403 = the key is dead or the account is suspended: actionable.
    // 429/5xx = their problem, probably transient: stay quiet.
    const revoked = r.status === 401 || r.status === 403;
    return { ok: false, revoked, detail: `${r.status} ${text}` };
  } catch (e) {
    return { ok: false, revoked: false, detail: "Could not reach Quo: " + String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!isServiceCaller(req)) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const report: unknown[] = [];

  // ── Quo phone line ─────────────────────────────────────────────────────────
  // Only alert people who actually have a line; an agent with no number has
  // nothing broken.
  const { data: lines } = await admin.from("quo_settings")
    .select("user_id, active_number").not("active_number", "is", null);

  if (lines && lines.length) {
    const res = await probeQuo();
    for (const line of lines) {
      if (res.ok) {
        await resolveConnectionAlert(admin, line.user_id as string, "quo", line.active_number as string);
        report.push({ kind: "quo", user: line.user_id, state: "healthy" });
        continue;
      }
      if (!res.revoked) {
        report.push({ kind: "quo", user: line.user_id, state: "probe inconclusive", detail: res.detail });
        continue;
      }
      const raised = await raiseConnectionAlert({
        admin,
        userId: line.user_id as string,
        kind: "quo",
        targetId: line.active_number as string,
        label: "your phone line " + line.active_number,
        detail: res.detail,
        what: "calls and texts",
        actionUrl: "https://darasapp.com/?view=quo",
        critical: true,
      });
      report.push({ kind: "quo", user: line.user_id, state: "ALERT", notified: raised.notified, channels: raised.channels });
    }
  }

  return json({ ok: true, report });
});
