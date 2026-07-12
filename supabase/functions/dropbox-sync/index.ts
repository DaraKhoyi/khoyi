// Pulls new audio files from watched Dropbox folders into pending_recordings.
// Two modes: cron (x-internal-token = INGEST_TOKEN) sweeps EVERY user's folders;
// user mode (valid JWT) scopes to the caller. Cursor-tracked, deduped, skips
// Personal folders. Any common audio format; ignores non-audio.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const AUDIO_RE = /\.(m4a|mp3|wav|aac|ogg|opus|amr|3gp|flac|wma|mp4)$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function accessToken(admin: any, connectionId: string): Promise<string | null> {
  const { data: t } = await admin.from("cloud_tokens").select("access_token, refresh_token, token_expires_at").eq("connection_id", connectionId).maybeSingle();
  if (!t) return null;
  const exp = t.token_expires_at ? new Date(t.token_expires_at).getTime() : 0;
  if (t.access_token && exp > Date.now() + 30000) return t.access_token;
  if (!t.refresh_token) return t.access_token || null;
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: APP_KEY, client_secret: APP_SECRET });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!r.ok) return null;
  const j = await r.json();
  const newExp = j.expires_in ? new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() : null;
  await admin.from("cloud_tokens").update({ access_token: j.access_token, token_expires_at: newExp, updated_at: new Date().toISOString() }).eq("connection_id", connectionId);
  return j.access_token;
}

async function dbx(token: string, endpoint: string, body: unknown) {
  return await fetch(`https://api.dropboxapi.com/2/files/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const INGEST = Deno.env.get("INGEST_TOKEN") || "";
    const isCron = !!INGEST && (req.headers.get("x-internal-token") || "") === INGEST;
    const body = await req.json().catch(() => ({}));

    let userId: string | null = null;
    if (!isCron) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    let fq = admin.from("watched_folders").select("id, user_id, connection_id, path, personal, cursor, enabled").eq("enabled", true).eq("personal", false);
    if (userId) fq = fq.eq("user_id", userId);
    if (body.connection_id) fq = fq.eq("connection_id", body.connection_id);
    const { data: folders } = await fq;
    if (!folders || !folders.length) return json({ ok: true, created: 0, note: "no_watched_folders" });

    let created = 0;
    for (const fld of folders) {
      const token = await accessToken(admin, fld.connection_id);
      if (!token) continue;
      const entries: any[] = [];
      let cursor = fld.cursor as string | null;
      try {
        if (cursor) {
          let more = true;
          while (more) { const r = await dbx(token, "list_folder/continue", { cursor }); if (!r.ok) break; const d = await r.json(); entries.push(...(d.entries || [])); cursor = d.cursor; more = d.has_more; }
        } else {
          let r = await dbx(token, "list_folder", { path: fld.path, recursive: false, limit: 2000 });
          if (r.ok) { let d = await r.json(); entries.push(...(d.entries || [])); cursor = d.cursor; let more = d.has_more;
            while (more) { r = await dbx(token, "list_folder/continue", { cursor }); if (!r.ok) break; d = await r.json(); entries.push(...(d.entries || [])); cursor = d.cursor; more = d.has_more; } }
        }
      } catch (_) { /* skip folder */ }

      const audio = entries.filter((e) => e[".tag"] === "file" && AUDIO_RE.test(e.name || ""));
      for (const e of audio) {
        const { error } = await admin.from("pending_recordings").insert({
          user_id: fld.user_id, connection_id: fld.connection_id, folder_id: fld.id, provider: "dropbox",
          file_id: e.id, file_path: e.path_lower, file_name: e.name, file_hash: e.content_hash || null,
          size_bytes: e.size || null, recorded_at: e.client_modified || e.server_modified || null, status: "pending",
        });
        if (!error) created++;
      }
      await admin.from("watched_folders").update({ cursor, last_synced_at: new Date().toISOString() }).eq("id", fld.id);
    }
    return json({ ok: true, created });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
