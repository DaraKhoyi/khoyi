// Returns a short-lived, direct streaming URL for a pending recording's audio so the
// user can listen while labeling who was in the meeting (Review screen).
// Pending items still live in the user's cloud (Dropbox) — nothing is copied into our
// storage until the item is confirmed — so we mint a Dropbox temporary link (~4h) and
// let the browser stream it directly. We never proxy the file (they can be 100MB+).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { pending_id, recording_id } = await req.json().catch(() => ({}));

    // Already-ingested recording -> signed URL from our own bucket.
    if (recording_id) {
      const { data: rec } = await admin.from("recordings").select("storage_path").eq("id", recording_id).eq("user_id", user.id).maybeSingle();
      if (!rec || !rec.storage_path) return json({ error: "not_found" }, 404);
      const { data: signed } = await admin.storage.from("recordings").createSignedUrl(rec.storage_path, 14400);
      if (!signed?.signedUrl) return json({ error: "sign_failed" }, 500);
      return json({ url: signed.signedUrl, source: "storage" });
    }

    if (!pending_id) return json({ error: "pending_id required" }, 400);
    // Ownership check is the security boundary — scope by user_id.
    const { data: p } = await admin.from("pending_recordings")
      .select("id, user_id, connection_id, provider, file_path, storage_path, file_name")
      .eq("id", pending_id).eq("user_id", user.id).maybeSingle();
    if (!p) return json({ error: "not_found" }, 404);

    // If it's already been copied into our storage, prefer that.
    if (p.storage_path) {
      const { data: signed } = await admin.storage.from("recordings").createSignedUrl(p.storage_path, 14400);
      if (signed?.signedUrl) return json({ url: signed.signedUrl, source: "storage" });
    }

    if (p.provider !== "dropbox") return json({ error: "unsupported_provider", provider: p.provider }, 400);
    const token = await accessToken(admin, p.connection_id);
    if (!token) return json({ error: "no_token" }, 400);

    const r = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: p.file_path }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return json({ error: "dropbox_link_failed", status: r.status, detail: txt.slice(0, 300) }, 502);
    }
    const j = await r.json();
    if (!j.link) return json({ error: "no_link" }, 502);
    return json({ url: j.link, source: "dropbox", name: p.file_name });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
