// _shared/impersonation.ts — is this request coming from an "Act as user" session?
//
// WHY (8 Oct 2026, Google verification). "Act as user" (functions/impersonate)
// mints a real session for the agent so a broker admin or team leader can see
// PrismOS the way that agent does. Google's Limited Use rules forbid letting a
// supervisor read the agent's Google data, and our own setup screen promises
// "Your broker cannot read your mail". So every support session is now marked
// and Google-sourced data is withheld from it, on the server:
//   * the database hides Gmail, Google Calendar and Google Contacts rows from
//     it with RESTRICTIVE row-level-security policies
//     (supabase/sql/2026-10-08c_act_as_hides_google_data.sql), and
//   * edge functions that read or act on Google with the service role call
//     isImpersonatedRequest() and refuse.
//
// HOW A SUPPORT SESSION IS RECOGNISED. Every Supabase access token carries a
// `session_id` claim; it stays the same when the token is refreshed. When
// impersonate mints the agent's session it records that session_id in
// impersonation_log.session_id BEFORE handing the token out (and revokes the
// session if it cannot). Any request whose token carries a recorded session_id
// is a support session, for as long as that session lives. The agent's own
// sign-ins get fresh session ids that are never in the log, so their access is
// untouched.
//
// This is a DENY-ONLY check: it can only ever make a request see less. The
// function's own authentication (auth.getUser) still decides who the caller is;
// a forged token fails there first.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session_id claim of a Supabase access token, or null. Does NOT verify. */
export function sessionIdFromJwt(token: string | null | undefined): string | null {
  try {
    const t = String(token || "").replace(/^Bearer\s+/i, "").trim();
    const part = t.split(".")[1];
    if (!part) return null;
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
    const sid = json && typeof json.session_id === "string" ? json.session_id : "";
    return UUID.test(sid) ? sid : null;
  } catch (_) {
    return null;
  }
}

/**
 * True when the bearer token belongs to an "Act as user" session.
 * `admin` must be a SERVICE-ROLE client (impersonation_log is not readable by
 * the agent). Fails CLOSED: if the lookup itself errors, the request is treated
 * as a support session, because showing Google data by mistake is the worse
 * outcome and the agent can simply retry.
 */
export async function isImpersonatedRequest(admin: any, tokenOrHeader: string | null | undefined): Promise<boolean> {
  const sid = sessionIdFromJwt(tokenOrHeader);
  if (!sid) return false; // service-role, cron and anon tokens carry no session
  const { data, error } = await admin
    .from("impersonation_log").select("id").eq("session_id", sid).limit(1);
  if (error) return true;
  return Array.isArray(data) && data.length > 0;
}

export const SUPPORT_SESSION_MESSAGE =
  "Google email, calendar and contacts are private to the agent and are hidden during support sessions.";

/** A ready 403 for edge functions. */
export function supportSessionResponse(headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: SUPPORT_SESSION_MESSAGE, support_session: true }), {
    status: 403,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
