// impersonate — "Act as user": a supervisor opens PrismOS as one of their agents.
//
// Security batch 1 (8 Oct 2026, approved by Dara):
//   * WHO: owner -> any linked user in their brokerage; broker_admin -> plain
//     agents and team leaders only (never the owner or another admin); a team
//     leader -> only plain agents who are 'member' of a team where the leader is
//     'leader' (team membership is admin-managed since 08f). Nobody else.
//     The caller's role row must be unique (UNIQUE agents.auth_user_id, 08e) and
//     in the same brokerage as the target.
//   * EXPIRY: every act-as session expires 30 minutes after it starts. Its auth
//     session id is recorded in impersonation_log.session_id with expires_at;
//     cron expire_support_sessions() revokes it (refresh tokens die), and
//     "Return to my account" revokes it at once.
//   * LOG: only the supervisor who started a session can close it.
//   * NO ADMIN TOKEN IN THE BROWSER: the supervisor's own session is signed out
//     when the act-as session starts, and action 'return' mints a fresh session
//     for the supervisor from the server, using the still-valid act-as session
//     and its log row. Nothing of the supervisor's is kept in localStorage.
//   * A support session cannot start another one.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const ACT_AS_MINUTES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session_id claim of a Supabase access token (already verified by getUser), or null. */
function sessionIdOf(token: string): string | null {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
    const sid = json && typeof json.session_id === "string" ? json.session_id : "";
    return UUID.test(sid) ? sid : null;
  } catch (_) { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(URL, SR);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user: caller } } = await sb.auth.getUser(token);
    if (!caller) return J({ error: "Unauthorized" }, 401);
    const callerSession = sessionIdOf(token);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "start";

    // Mint a real session for a user by email (magic link generated and verified here).
    async function mintSession(email: string) {
      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({ type: "magiclink", email });
      const hashed = linkData?.properties?.hashed_token;
      if (linkErr || !hashed) return null;
      const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: sess, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
      if (vErr || !sess?.session) return null;
      return sess.session;
    }
    async function revoke(sessionId: string | null) {
      if (!sessionId) return;
      try { await sb.rpc("revoke_support_session", { p_session_id: sessionId }); } catch (_) { /* cron expiry is the backstop */ }
    }

    // ── End (audit close-out) — only the supervisor who started it ──────────
    if (action === "end") {
      if (body.log_id) {
        const { data: row } = await sb.from("impersonation_log").select("id, actor_user_id, session_id, ended_at").eq("id", body.log_id).maybeSingle();
        if (!row || row.actor_user_id !== caller.id) return J({ error: "Not your session" }, 403);
        if (!row.ended_at) await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", row.id);
        await revoke(row.session_id);
      }
      return J({ ok: true });
    }

    // ── Return: called WITH the act-as session; gives the supervisor a fresh session ──
    if (action === "return") {
      if (!body.log_id || !callerSession) return J({ error: "Nothing to return from" }, 400);
      const { data: row } = await sb.from("impersonation_log").select("id, actor_user_id, target_user_id, session_id, ended_at, expires_at").eq("id", body.log_id).maybeSingle();
      const live = row && !row.ended_at && row.session_id === callerSession && row.target_user_id === caller.id
        && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
      if (!live) {
        if (row && row.session_id === callerSession) { await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", row.id).is("ended_at", null); await revoke(row.session_id); }
        return J({ error: "This act-as session has ended. Sign in again." }, 403);
      }
      await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", row.id);
      await revoke(row.session_id);
      const { data: actorAuth } = await sb.auth.admin.getUserById(row.actor_user_id);
      const actorEmail = actorAuth?.user?.email;
      const s = actorEmail ? await mintSession(actorEmail) : null;
      if (!s) return J({ error: "Session ended. Sign in again to return to your account." }, 500);
      return J({ ok: true, access_token: s.access_token, refresh_token: s.refresh_token });
    }

    // ── Start ───────────────────────────────────────────────────────────────
    // A support session cannot start another one.
    if (callerSession) {
      const { data: nested, error: nErr } = await sb.from("impersonation_log").select("id").eq("session_id", callerSession).limit(1);
      if (nErr || (nested && nested.length)) return J({ error: "You're already acting as someone. Return to your account first." }, 403);
    }

    const target_user_id = body.target_user_id;
    if (!target_user_id) return J({ error: "target_user_id required" }, 400);
    if (target_user_id === caller.id) return J({ error: "You can't act as yourself" }, 400);

    // Re-verify authorization SERVER-SIDE (never trust the client).
    const { data: actorRows } = await sb.from("agents").select("role, user_id, active").eq("auth_user_id", caller.id).limit(2);
    if (!actorRows || actorRows.length !== 1 || actorRows[0].active === false) return J({ error: "You're not authorized to act as this user" }, 403);
    const actorAgent = actorRows[0];
    const actorRole = actorAgent.role || "";
    const { data: targetRows } = await sb.from("agents").select("role, name, user_id, active").eq("auth_user_id", target_user_id).limit(2);
    if (!targetRows || targetRows.length !== 1) return J({ error: "Target user not found" }, 404);
    const targetAgent = targetRows[0];
    const targetRole = targetAgent.role || "";
    if (targetAgent.user_id !== actorAgent.user_id || targetAgent.active === false) return J({ error: "You're not authorized to act as this user" }, 403);

    let allowed = false;
    if (actorRole === "owner") allowed = actorAgent.user_id === caller.id;
    else if (actorRole === "broker_admin") allowed = !["owner", "broker_admin"].includes(targetRole);
    else if (targetRole === "agent") {
      const { data: leadTeams } = await sb.from("team_members").select("team_id").eq("auth_user_id", caller.id).eq("role", "leader");
      const teamIds = (leadTeams || []).map((r: { team_id: string }) => r.team_id);
      if (teamIds.length) {
        const { data: tm } = await sb.from("team_members").select("team_id").eq("auth_user_id", target_user_id).eq("role", "member").in("team_id", teamIds);
        allowed = !!(tm && tm.length);
      }
    }
    if (!allowed) return J({ error: "You're not authorized to act as this user" }, 403);

    const { data: targetAuth } = await sb.auth.admin.getUserById(target_user_id);
    const email = targetAuth?.user?.email;
    if (!email) return J({ error: "Target user has no email" }, 400);

    const expiresAt = new Date(Date.now() + ACT_AS_MINUTES * 60_000).toISOString();
    const { data: logRow, error: logErr } = await sb.from("impersonation_log").insert({ actor_user_id: caller.id, target_user_id, actor_role: actorRole, expires_at: expiresAt }).select("id").maybeSingle();
    if (logErr || !logRow?.id) return J({ error: "Could not record the session. Nothing was opened." }, 500);

    const sess = await mintSession(email);
    if (!sess) { await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", logRow.id); return J({ error: "Could not start session" }, 500); }

    // Record the minted session BEFORE handing it out, so it can expire and be revoked.
    const sessionId = sessionIdOf(sess.access_token);
    const { error: mErr } = sessionId
      ? await sb.from("impersonation_log").update({ session_id: sessionId }).eq("id", logRow.id)
      : { error: new Error("no session id") };
    if (mErr) {
      try { await sb.auth.admin.signOut(sess.access_token, "local"); } catch (_) { /* best effort */ }
      await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", logRow.id);
      return J({ error: "Could not start the session safely. Nothing was opened." }, 500);
    }

    // The supervisor's own session in this browser is closed: the browser no
    // longer keeps it, and 'return' mints a fresh one.
    try { await sb.auth.admin.signOut(token, "local"); } catch (_) { /* best effort */ }

    return J({ ok: true, access_token: sess.access_token, refresh_token: sess.refresh_token, target: { id: target_user_id, name: targetAgent.name || email, email }, log_id: logRow.id, expires_at: expiresAt });
  } catch (e) { return J({ error: String(e) }, 500); }
});
