// Disconnect a cloud connection: revoke the token at Dropbox (frees the app's
// user slot) then delete the connection (cascade removes tokens + watched folders).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const { connection_id } = await req.json();
    const { data: conn } = await admin.from("cloud_connections")
      .select("id, user_id").eq("id", connection_id).maybeSingle();
    if (!conn || conn.user_id !== user.id) return json({ error: "not_found" }, 404);
    // Revoke at Dropbox so the account frees the app's user slot
    try {
      const { data: t } = await admin.from("cloud_tokens").select("access_token").eq("connection_id", connection_id).maybeSingle();
      if (t?.access_token) {
        await fetch("https://api.dropboxapi.com/2/auth/token/revoke", {
          method: "POST", headers: { Authorization: `Bearer ${t.access_token}` },
        });
      }
    } catch (_) { /* revoke best-effort */ }
    await admin.from("cloud_connections").delete().eq("id", connection_id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
