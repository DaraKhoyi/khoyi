// google-connection-watch
//
// WHY THIS EXISTS
// On 14 Aug 2026 Google revoked the refresh token on the owner's default
// account. Gmail send, Gmail sync, Calendar sync, Drive and Contacts all died
// at once. The exact reason ("Token has been expired or revoked") sat in
// email_accounts.last_sync_error for 26 HOURS and nothing said a word. The
// failure was discovered by a human trying to send an email and getting a
// meaningless toast.
//
// Reading the error better (v1.06.76) makes the failure legible AFTER you hit
// send. This makes it legible BEFORE — and without you looking.
//
// WHAT IT DOES, every 10 minutes:
//   1. Probes each connected Google account by exchanging its refresh_token.
//      A refresh is the only honest test of a grant; a stored access token can
//      look fine for an hour after the grant behind it is gone.
//   2. A successful probe is not wasted — the fresh access token is stored, so
//      the watchdog doubles as a keep-alive.
//   3. invalid_grant => mark reauth_required_at (once), write the sentinel
//      last_sync_error the Settings banner reads, and PUSH the owner.
//   4. Re-push once a day while it stays broken, so it can't be forgotten.
//   5. A later successful probe clears all of it silently.
//
// DESIGN NOTES
// - Probing costs one token exchange per account per run only when a refresh is
//   actually due (token within PROBE_WINDOW_MS of expiry) or when the account is
//   already flagged. Healthy accounts with a valid token are skipped, so this is
//   roughly the same number of Google calls the app already makes.
// - Multi-user by construction: it loops every account in the table and pushes
//   the account's OWN user_id. Nothing about this function knows who the broker
//   is.
// - Spends no AI tokens, so there is nothing to attribute.
//
// Invoked by pg_cron (verify_jwt = false). Accepts a service credential in
// either of the two forms Supabase now issues.

import { raiseConnectionAlert, resolveConnectionAlert } from "../_shared/connectionAlert.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

// Refresh (and therefore probe) when the stored token is inside this window of
// expiring. Ten minutes wider than the cron interval so no account is skipped.
const PROBE_WINDOW_MS = 15 * 60 * 1000;
// While an account stays broken, remind the owner this often.
const RENOTIFY_MS = 24 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Supabase issues the service credential in two shapes right now: the legacy
// service_role JWT and the newer sb_secret_ key. SUPABASE_SERVICE_ROLE_KEY in
// the runtime is currently the latter. Accepting only one of them is exactly
// how every cron-called function started returning 401 in August. Compare
// against what the runtime holds, and against the vault copy the cron jobs
// read, rather than assuming which shape is in play.
function isServiceCaller(req: Request): boolean {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  const legacy = Deno.env.get("LEGACY_SERVICE_ROLE_KEY") || "";
  if (legacy && token === legacy) return true;
  const internal = Deno.env.get("QCP_TOKEN") || "";
  if (internal && req.headers.get("x-internal-token") === internal) return true;
  return false;
}

// Google's family of "this grant is gone" answers. All of them mean the same
// thing operationally: no amount of retrying helps, a human must re-consent.
function isRevoked(status: number, text: string): boolean {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("invalid_grant") ||
    s.includes("token has been expired or revoked") ||
    s.includes("account has been deleted") ||
    (status === 400 && s.includes("unauthorized_client"))
  );
}

async function probe(account: Record<string, unknown>) {
  if (!account.refresh_token) {
    return { ok: false, revoked: true, detail: "No refresh_token on account — reconnect Google." };
  }
  let r: Response;
  try {
    r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: String(account.refresh_token),
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (e) {
    // Network trouble reaching Google is NOT a revoked grant. Say nothing and
    // let the next run decide — a false "reconnect your account" alert would
    // teach the owner to ignore the real one.
    return { ok: false, revoked: false, detail: "Could not reach Google: " + String(e) };
  }
  if (r.ok) {
    const tokens = await r.json();
    return { ok: true, revoked: false, tokens };
  }
  const text = await r.text();
  return { ok: false, revoked: isRevoked(r.status, text), detail: `${r.status} ${text.slice(0, 300)}` };
}

async function pushOwner(userId: string, email: string, purposes: string[]) {
  // Name what actually stopped working. "Reconnect your account" is not a
  // reason; "your calendar stopped syncing yesterday" is.
  const nice: Record<string, string> = {
    email: "email", calendar: "calendar", drive: "files", contacts: "contacts",
  };
  const stopped = (purposes || []).map((p) => nice[p] || p);
  const what = stopped.length
    ? stopped.slice(0, -1).join(", ") + (stopped.length > 1 ? " and " + stopped[stopped.length - 1] : stopped[0])
    : "sync";
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        user_id: userId,
        title: "Google ended the connection to " + email,
        body: `Your ${what} stopped syncing. Open Settings and tap Reconnect — it takes about fifteen seconds.`,
        url: "https://darasapp.com/?view=settings&reconnect=1",
        tag: "google-reauth",
      }),
    });
    return true;
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!isServiceCaller(req)) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const { data: accounts, error } = await admin
    .from("email_accounts")
    .select("id,user_id,email_address,provider,purposes,refresh_token,token_expires_at,is_active,reauth_required_at,reauth_notified_at")
    .eq("provider", "google");
  if (error) return json({ error: error.message }, 500);

  const report: Record<string, unknown>[] = [];

  for (const acc of accounts || []) {
    if (acc.is_active === false) continue;

    const expMs = acc.token_expires_at ? new Date(acc.token_expires_at as string).getTime() : 0;
    const tokenStillGood = expMs - now > PROBE_WINDOW_MS;
    const alreadyFlagged = !!acc.reauth_required_at;

    // Skip accounts whose token is comfortably valid and that aren't already
    // flagged — there is nothing to learn and nothing to keep alive.
    if (tokenStillGood && !alreadyFlagged) {
      report.push({ email: acc.email_address, state: "healthy (not due)" });
      continue;
    }

    const res = await probe(acc);

    if (res.ok) {
      const tokens = res.tokens as Record<string, unknown>;
      const newExp = new Date(now + (((tokens.expires_in as number) || 3600) - 60) * 1000).toISOString();
      const patch: Record<string, unknown> = {
        access_token: tokens.access_token,
        token_expires_at: newExp,
        last_health_check_at: nowIso,
      };
      if (alreadyFlagged) {
        // Recovered. Clear the flags AND the sentinel, so the Settings banner
        // and every composer pre-flight go quiet on their own.
        patch.reauth_required_at = null;
        patch.reauth_notified_at = null;
        patch.last_sync_error = null;
        // Close the alert but KEEP the row — the old code deleted every trace of
        // an outage on recovery, which is why "did it ever fire?" had no answer.
        await resolveConnectionAlert(admin, acc.user_id as string, "google_" + (((acc.purposes as string[]) || [])[0] || "email"), acc.id as string);
      }
      const { error: uErr } = await admin.from("email_accounts").update(patch).eq("id", acc.id);
      report.push({
        email: acc.email_address,
        state: alreadyFlagged ? "recovered" : "refreshed",
        write_error: uErr ? uErr.message : null,
      });
      continue;
    }

    if (!res.revoked) {
      // Reachability problem, not a revocation. Record that we looked; do not
      // alarm anyone.
      await admin.from("email_accounts").update({ last_health_check_at: nowIso }).eq("id", acc.id);
      report.push({ email: acc.email_address, state: "probe inconclusive", detail: res.detail });
      continue;
    }

    // Revoked.
    const firstTime = !alreadyFlagged;
    const lastNotified = acc.reauth_notified_at ? new Date(acc.reauth_notified_at as string).getTime() : 0;
    const dueAgain = !firstTime && now - lastNotified > RENOTIFY_MS;
    const shouldNotify = firstTime || dueAgain;

    // One alert row per account, four channels, every attempt recorded.
    // raiseConnectionAlert is idempotent, so the every-10-minutes cron does not
    // spam: it re-notifies on its own cadence and escalates to SMS.
    const nice: Record<string, string> = { email: "email", calendar: "calendar", drive: "files", contacts: "contacts" };
    const stopped = (((acc.purposes as string[]) || []).map((p) => nice[p] || p));
    const whatStopped = stopped.length ? stopped.join(" and ") : "syncing";
    const raised = await raiseConnectionAlert({
      admin,
      userId: acc.user_id as string,
      kind: "google_" + (((acc.purposes as string[]) || [])[0] || "email"),
      targetId: acc.id as string,
      label: acc.email_address as string,
      detail: res.detail || "invalid_grant",
      what: whatStopped,
      critical: true,
    });
    const notified = raised.notified;

    const patch: Record<string, unknown> = {
      last_health_check_at: nowIso,
      // The sentinel the client's accountNeedsReauth() matches on.
      last_sync_error: "REAUTH_REQUIRED: " + (res.detail || "invalid_grant"),
    };
    if (firstTime) patch.reauth_required_at = nowIso;
    if (notified) patch.reauth_notified_at = nowIso;

    const { error: uErr } = await admin.from("email_accounts").update(patch).eq("id", acc.id);
    report.push({
      email: acc.email_address,
      state: "REAUTH REQUIRED",
      first_time: firstTime,
      notified,
      write_error: uErr ? uErr.message : null,
    });
  }

  return json({ checked: (accounts || []).length, report });
});
