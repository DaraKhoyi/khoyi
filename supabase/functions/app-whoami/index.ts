import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PLATFORM_ADMIN = "dara@brokerdara.com";
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const db = createClient(SUPABASE_URL, SERVICE);
    const isPlatform = (user.email || "").toLowerCase() === PLATFORM_ADMIN;
    const { data: agent } = await db.from("agents").select("id,role,team,user_id,name").eq("auth_user_id", user.id).limit(1).maybeSingle();
    const role = agent?.role || (isPlatform ? "owner" : null);
    return new Response(JSON.stringify({
      ok: true, is_platform_admin: isPlatform, role, team: agent?.team || null,
      agent_id: agent?.id || null, owner_id: agent?.user_id || (isPlatform ? user.id : null), name: agent?.name || null,
      is_admin: isPlatform || ["owner", "broker_admin"].includes(role || ""), is_team_leader: role === "team_leader",
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
