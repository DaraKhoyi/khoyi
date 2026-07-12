// Processes CONFIRMED pending recordings. Cron-driven (x-internal-token=INGEST_TOKEN).
// For each: downloads the audio from Dropbox -> creates a recordings row + uploads to
// the recordings bucket -> triggers recording-transcribe (which chains to poll ->
// process for the summary/tasks/DISC signal) -> fires contact-research (deep) + disc-
// analyze for each confirmed person. Multi-user: sweeps every user's confirmed items.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const INGEST = Deno.env.get("INGEST_TOKEN") || "";
const RESEARCH_TOKEN = Deno.env.get("RESEARCH_TOKEN") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function bg(p: Promise<any>) { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) {} }

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
  if (!INGEST || (req.headers.get("x-internal-token") || "") !== INGEST) return json({ error: "unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Claim a small batch of confirmed items (all users)
  const { data: batch } = await admin.from("pending_recordings")
    .select("*").eq("status", "confirmed").order("created_at", { ascending: true }).limit(3);
  if (!batch || !batch.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  for (const rec of batch) {
    await admin.from("pending_recordings").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", rec.id);
    try {
      const token = await accessToken(admin, rec.connection_id);
      if (!token) throw new Error("no_token");

      // Download the audio from Dropbox
      const dl = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: rec.file_path }) },
      });
      if (!dl.ok) throw new Error("download_failed_" + dl.status);
      const bytes = new Uint8Array(await dl.arrayBuffer());

      const primary = (rec.confirmed_contact_ids && rec.confirmed_contact_ids[0]) || null;
      const mime = /\.(mp3)$/i.test(rec.file_name) ? "audio/mpeg" : /\.(wav)$/i.test(rec.file_name) ? "audio/wav" : /\.(m4a|mp4|aac)$/i.test(rec.file_name) ? "audio/mp4" : "audio/mpeg";

      // Create the recording row (chains into the existing transcribe -> process pipeline)
      const { data: newRec, error: insErr } = await admin.from("recordings").insert({
        user_id: rec.user_id, contact_id: primary, title: rec.file_name || "Meeting recording",
        mime_type: mime, size_bytes: rec.size_bytes || bytes.length,
        recorded_at: rec.recorded_at || new Date().toISOString(), transcription_status: "pending",
      }).select("id").single();
      if (insErr || !newRec) throw new Error("recording_insert_failed");
      const recId = newRec.id;

      const filename = (rec.file_name || "recording").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${rec.user_id}/${recId}/${filename}`;
      const up = await admin.storage.from("recordings").upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) { await admin.from("recordings").delete().eq("id", recId); throw new Error("upload_failed"); }
      await admin.from("recordings").update({ storage_path: path }).eq("id", recId);

      // Kick off transcription (service-role auth passes recording-transcribe's verify_jwt)
      bg(fetch(`${SUPABASE_URL}/functions/v1/recording-transcribe`, {
        method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recording_id: recId, user_id: rec.user_id }),
      }));

      // Research + DISC for each confirmed person
      for (const cid of (rec.confirmed_contact_ids || [])) {
        if (rec.research_depth === "deep" && RESEARCH_TOKEN) {
          bg(fetch(`${SUPABASE_URL}/functions/v1/contact-research`, {
            method: "POST", headers: { "x-internal-token": RESEARCH_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ contact_id: cid }),
          }));
        }
        bg(fetch(`${SUPABASE_URL}/functions/v1/disc-analyze`, {
          method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: cid, user_id: rec.user_id }),
        }));
      }

      await admin.from("pending_recordings").update({ status: "done", recording_id: recId, updated_at: new Date().toISOString() }).eq("id", rec.id);
      processed++;
    } catch (e) {
      await admin.from("pending_recordings").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", rec.id);
    }
  }
  return json({ ok: true, processed });
});
