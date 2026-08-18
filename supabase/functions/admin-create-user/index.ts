import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
// PLATFORM_ADMIN is a BREAK-GLASS, not the role system.
//
// The real source of truth is agents.role in ('owner','broker_admin'), which is
// what is_brokerage_staff() enforces in the database. This exists for exactly one
// case: the very first sign-in on a fresh deployment, before any agents row has a
// role, when there would otherwise be nobody able to grant one.
//
// It reads from an ENV VAR now rather than a string literal. Hardcoding a person's
// email into shipped code breaks the standing rule against hardcoding a person,
// means admin cannot be granted without a deploy, and locks the owner out of their
// own platform if they ever change their address.
const PLATFORM_ADMIN = (Deno.env.get("PLATFORM_ADMIN_EMAIL") || "khoyi1234@gmail.com").toLowerCase();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const db = createClient(SUPABASE_URL, SERVICE);
    const email0 = (user.email || "").toLowerCase();

    // resolve caller authority + org owner
    const { data: callerAgent } = await db.from("agents").select("user_id,role").eq("auth_user_id", user.id).limit(1).maybeSingle();
    const isPlatform = email0 === PLATFORM_ADMIN;
    const isAdmin = isPlatform || (callerAgent && ["owner", "broker_admin"].includes(callerAgent.role));
    if (!isAdmin) return new Response(JSON.stringify({ error: "Not authorized" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    const ownerId = isPlatform ? user.id : callerAgent!.user_id;

    const { action, agent_id, email, password, role } = await req.json();
    if (!agent_id) return new Response(JSON.stringify({ error: "agent_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: agent } = await db.from("agents").select("*").eq("id", agent_id).eq("user_id", ownerId).maybeSingle();
    if (!agent) return new Response(JSON.stringify({ error: "Agent not found in your brokerage" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    if (action === "reset") {
      if (!agent.auth_user_id) return new Response(JSON.stringify({ error: "This agent has no login yet" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      if (!password || password.length < 8) return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const { error } = await db.auth.admin.updateUserById(agent.auth_user_id, { password });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, reset: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // create login
    if (!email || !password || password.length < 8) return new Response(JSON.stringify({ error: "Email and a password of 8+ characters are required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    if (agent.auth_user_id) return new Response(JSON.stringify({ error: "This agent already has a login" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: created, error } = await db.auth.admin.createUser({ email: email.toLowerCase().trim(), password, email_confirm: true, user_metadata: { full_name: agent.name, role: role || agent.role } });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const upd: any = { auth_user_id: created.user.id, email: email.toLowerCase().trim(), updated_at: new Date().toISOString() };
    if (role) upd.role = role;
    await db.from("agents").update(upd).eq("id", agent_id);
    return new Response(JSON.stringify({ ok: true, auth_user_id: created.user.id }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
