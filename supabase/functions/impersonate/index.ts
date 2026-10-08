import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isImpersonatedRequest, sessionIdFromJwt } from "../_shared/impersonation.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(URL, SR);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user: actor } } = await sb.auth.getUser(token);
    if (!actor) return J({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "start";

    // End an impersonation session (audit close-out). Only the supervisor who
    // started it may close it, and the support session itself is revoked so its
    // refresh token cannot be used again (8 Oct 2026).
    if (action === "end") {
      if (body.log_id) {
        const { data: row } = await sb.from("impersonation_log").select("id, actor_user_id, session_id").eq("id", body.log_id).maybeSingle();
        if (row && row.actor_user_id === actor.id) {
          await sb.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", row.id);
          if (row.session_id) { try { await sb.rpc("revoke_support_session", { p_session_id: row.session_id }); } catch (_) { /* best effort; the session stays marked either way */ } }
        }
      }
      return J({ ok: true });
    }

    // A support session cannot start another one.
    if (await isImpersonatedRequest(sb, token)) return J({ error: "You're already acting as someone. Return to your account first." }, 403);

    const target_user_id = body.target_user_id;
    if (!target_user_id) return J({ error: "target_user_id required" }, 400);
    if (target_user_id === actor.id) return J({ error: "You can't act as yourself" }, 400);

    // Re-verify authorization SERVER-SIDE (never trust the client)
    const { data: actorAgent } = await sb.from("agents").select("role").eq("auth_user_id", actor.id).maybeSingle();
    const actorRole = actorAgent?.role || "";
    const { data: targetAgent } = await sb.from("agents").select("role, name").eq("auth_user_id", target_user_id).maybeSingle();
    if (!targetAgent) return J({ error: "Target user not found" }, 404);
    const targetRole = targetAgent.role || "";

    let allowed = false;
    if (actorRole === "owner") allowed = true;
    else if (actorRole === "broker_admin") allowed = targetRole !== "owner";
    else {
      const { data: leadTeams } = await sb.from("team_members").select("team_id").eq("auth_user_id", actor.id).in("role", ["leader", "admin", "owner"]);
      const teamIds = (leadTeams || []).map((r: { team_id: string }) => r.team_id);
      if (teamIds.length) {
        const { data: tm } = await sb.from("team_members").select("team_id").eq("auth_user_id", target_user_id).in("team_id", teamIds);
        allowed = !!(tm && tm.length) && !["owner", "broker_admin"].includes(targetRole);
      }
    }
    if (!allowed) return J({ error: "You're not authorized to act as this user" }, 403);

    const { data: targetAuth } = await sb.auth.admin.getUserById(target_user_id);
    const email = targetAuth?.user?.email;
    if (!email) return J({ error: "Target user has no email" }, 400);

    const { data: logRow } = await sb.from("impersonation_log").insert({ actor_user_id: actor.id, target_user_id, actor_role: actorRole }).select("id").maybeSingle();

    // Mint a real session for the target: generate a magic-link token, then verify it here.
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = linkData?.properties?.hashed_token;
    if (linkErr || !hashed) return J({ error: "Could not start session" }, 500);
    const anon = createClient(URL, ANON);
    const { data: sess, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
    if (vErr || !sess?.session) return J({ error: "Could not verify session: " + (vErr?.message || "") }, 500);

    // MARK THE SESSION AS A SUPPORT SESSION BEFORE ANYONE CAN USE IT (8 Oct 2026).
    // Its session_id goes into impersonation_log; the database's restrictive
    // policies and the Google edge functions hide the agent's Gmail, Google
    // Calendar and Google Contacts from any token carrying that id (see
    // _shared/impersonation.ts). If it cannot be recorded, the session is
    // revoked and nothing is handed out: an unmarked support session would see
    // the agent's mail.
    const sessionId = sessionIdFromJwt(sess.session.access_token);
    let marked = false;
    if (sessionId && logRow?.id) {
      const { error: mErr } = await sb.from("impersonation_log").update({ session_id: sessionId }).eq("id", logRow.id);
      marked = !mErr;
    }
    if (!marked) {
      try { await sb.auth.admin.signOut(sess.session.access_token, "local"); } catch (_) { /* revoke best effort */ }
      if (sessionId) { try { await sb.rpc("revoke_support_session", { p_session_id: sessionId }); } catch (_) {} }
      return J({ error: "Could not start a support session safely. Nothing was opened." }, 500);
    }

    return J({ ok: true, access_token: sess.session.access_token, refresh_token: sess.session.refresh_token, target: { id: target_user_id, name: targetAgent.name || email, email }, log_id: logRow?.id || null });
  } catch (e) { return J({ error: String(e) }, 500); }
});
