// Lists folders inside a Dropbox path so the app can browse + pick a watch folder.
// Auth: verify_jwt=true (Supabase validates the caller); we re-derive the user and
// confirm the connection is theirs. Access token is refreshed on demand.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Returns a valid Dropbox access token for a connection, refreshing if expired.
export async function dropboxAccessToken(admin: any, connectionId: string): Promise<string | null> {
  const { data: t } = await admin.from("cloud_tokens")
    .select("access_token, refresh_token, token_expires_at").eq("connection_id", connectionId).maybeSingle();
  if (!t) return null;
  const exp = t.token_expires_at ? new Date(t.token_expires_at).getTime() : 0;
  if (t.access_token && exp > Date.now() + 30000) return t.access_token;
  if (!t.refresh_token) return t.access_token || null;
  const form = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: APP_KEY, client_secret: APP_SECRET,
  });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  if (!r.ok) return null;
  const j = await r.json();
  const newExp = j.expires_in ? new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() : null;
  await admin.from("cloud_tokens").update({
    access_token: j.access_token, token_expires_at: newExp, updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId);
  return j.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { connection_id, path } = await req.json();
    const { data: conn } = await admin.from("cloud_connections")
      .select("id, user_id").eq("id", connection_id).maybeSingle();
    if (!conn || conn.user_id !== user.id) return json({ error: "not_found" }, 404);

    const token = await dropboxAccessToken(admin, connection_id);
    if (!token) return json({ error: "no_token" }, 400);

    const r = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: path || "", recursive: false, limit: 1000 }),
    });
    if (!r.ok) return json({ error: "list_failed", detail: await r.text() }, 400);
    const data = await r.json();
    const folders = (data.entries || [])
      .filter((e: any) => e[".tag"] === "folder")
      .map((e: any) => ({ name: e.name, path: e.path_lower, path_display: e.path_display }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    const audioCount = (data.entries || []).filter((e: any) =>
      e[".tag"] === "file" && /\.(m4a|mp3|wav|aac|ogg|opus|amr|3gp|flac)$/i.test(e.name || "")).length;
    return json({ folders, audioCount, path: path || "" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
