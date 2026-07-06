// cube-acr-sync
// Pulls Cube ACR call recordings that the user auto-backs-up to a Google Drive
// folder, transcribes them with AssemblyAI (speaker-diarized), and drops each one
// into `quo_calls` so the existing quo-call-process brain produces the summary,
// proposed tasks, contact timeline entry, and DISC re-analysis — exactly like an
// OpenPhone call.
//
// Two passes per run (idempotent, cron-safe):
//   A) discover new audio files in the folder -> upload to AssemblyAI -> insert a
//      quo_calls stub with raw.cube.stt_status='transcribing'
//   B) poll in-flight transcripts -> when complete, fill transcript + duration and
//      flip stt_status='done' (processed_at stays null so quo-call-process takes it)
//
// Auth: cron sends x-internal-token (CUBE_TOKEN); a user JWT scopes to that user.
// Requires secret ASSEMBLYAI_API_KEY; no-ops cleanly if absent.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") || "";
const NEW_PER_RUN = 3;   // cap audio uploads per run to stay within time budget
const POLL_PER_RUN = 10; // in-flight transcripts to check per run

const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function freshToken(admin: any, account: any) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token — reconnect this account.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  const t = await r.json();
  const newExp = new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString();
  await admin.from("email_accounts").update({ access_token: t.access_token, token_expires_at: newExp }).eq("id", account.id);
  return t.access_token;
}

// Pull the most-likely phone number and a recorded time out of a Cube ACR filename.
// Cube names files various ways; we try a number first, then fall back to a name.
function parseName(name: string): { phone: string | null; name: string | null } {
  const base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
  const digits = (base.match(/\+?\d[\d\s().-]{6,}\d/g) || [])
    .map((m) => m.replace(/\D/g, ""))
    .filter((d) => d.length >= 7 && d.length <= 15);
  const phone = digits.length ? digits[0] : null;
  // Name candidate: strip obvious timestamp / number chunks and separators.
  let nm = base.replace(/\+?\d[\d\s().-]{6,}\d/g, " ").replace(/\d{4}[-_]?\d{2}[-_]?\d{2}.*/g, " ").replace(/[_\-]+/g, " ").trim();
  if (nm.length < 2) nm = "";
  return { phone, name: nm || null };
}

function diarize(t: any): string {
  const utt = t?.utterances;
  if (Array.isArray(utt) && utt.length) {
    return utt.map((u: any) => `Speaker ${u.speaker}: ${String(u.text || "").trim()}`).join("\n");
  }
  return String(t?.text || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const internalTok = req.headers.get("x-internal-token") || "";
    const INTERNAL = Deno.env.get("CUBE_TOKEN") || "";
    let scopeUserId: string | null = null;
    if (!(INTERNAL && internalTok === INTERNAL)) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!token) return J({ error: "Not authenticated" }, 401);
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return J({ error: "Not authenticated" }, 401);
      scopeUserId = user.id;
    }
    if (!AAI_KEY) return J({ skipped: "no ASSEMBLYAI_API_KEY set" });

    let settingsQ = admin.from("cube_acr_settings").select("*").eq("enabled", true).not("folder_id", "is", null).not("account_id", "is", null);
    if (scopeUserId) settingsQ = settingsQ.eq("user_id", scopeUserId);
    const { data: settings } = await settingsQ;
    if (!settings || !settings.length) return J({ submitted: 0, ingested: 0, note: "no enabled folders" });

    let submitted = 0, ingested = 0, failed = 0;

    for (const s of settings) {
      // ---------- account + Drive token ----------
      const { data: account } = await admin.from("email_accounts").select("*").eq("id", s.account_id).maybeSingle();
      if (!account) continue;
      let access: string;
      try { access = await freshToken(admin, account); } catch { continue; }

      // ================= PASS A: discover new files =================
      // Cube ACR stores recordings in date-named SUBFOLDERS inside the chosen folder,
      // so scan the folder itself PLUS its recent date subfolders (bounded to ~15 days
      // so a first run doesn't backfill months of history in one shot).
      const listAudio = async (folderId: string): Promise<any[]> => {
        const p = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false and mimeType contains 'audio'`, fields: "files(id,name,createdTime,size,mimeType)", pageSize: "50", orderBy: "createdTime desc", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
        const r = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, { headers: { Authorization: `Bearer ${access}` } });
        return r.ok ? (((await r.json()).files) || []) : [];
      };
      const subP = new URLSearchParams({ q: `'${s.folder_id}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`, fields: "files(id,name,createdTime)", pageSize: "100", orderBy: "createdTime desc", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      const subR = await fetch(`https://www.googleapis.com/drive/v3/files?${subP}`, { headers: { Authorization: `Bearer ${access}` } });
      const subs: any[] = subR.ok ? (((await subR.json()).files) || []) : [];
      const cutoff = Date.now() - 15 * 864e5;
      const recentSubs = subs.filter((d: any) => { const t = Date.parse(d.name); return isNaN(t) ? true : t >= cutoff; }).slice(0, 10);
      let files: any[] = [];
      for (const fid of [s.folder_id, ...recentSubs.map((d: any) => d.id)]) { const got = await listAudio(fid); if (got.length) files = files.concat(got); if (files.length >= 80) break; }
      files.sort((a: any, b: any) => String(b.createdTime || "").localeCompare(String(a.createdTime || "")));
      {
        if (files.length) {
          const ids = files.map((f: any) => `cube:${f.id}`);
          const { data: existing } = await admin.from("quo_calls").select("op_id").eq("user_id", s.user_id).in("op_id", ids);
          const seen = new Set((existing || []).map((r: any) => r.op_id));
          const fresh = files.filter((f: any) => !seen.has(`cube:${f.id}`)).slice(0, NEW_PER_RUN);

          for (const f of fresh) {
            try {
              // download audio bytes from Drive
              const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${access}` } });
              if (!dr.ok) { failed++; continue; }
              const bytes = new Uint8Array(await dr.arrayBuffer());
              // upload to AssemblyAI
              const up = await fetch("https://api.assemblyai.com/v2/upload", { method: "POST", headers: { authorization: AAI_KEY }, body: bytes });
              if (!up.ok) { failed++; continue; }
              const upUrl = (await up.json()).upload_url;
              // submit transcription with speaker labels
              const sub = await fetch("https://api.assemblyai.com/v2/transcript", {
                method: "POST", headers: { authorization: AAI_KEY, "content-type": "application/json" },
                body: JSON.stringify({ audio_url: upUrl, speaker_labels: true }),
              });
              if (!sub.ok) { failed++; continue; }
              const tid = (await sub.json()).id;
              const meta = parseName(f.name);
              // resolve a contact up front (by phone, else by name) so name-only files still link
              let contactId: string | null = null;
              const last10 = (p: string | null) => (p ? p.replace(/\D/g, "").slice(-10) : "");
              if (meta.phone || meta.name) {
                const { data: cs } = await admin.from("contacts").select("id,name,phone").eq("user_id", s.user_id);
                const list = cs || [];
                if (meta.phone) { const hit = list.find((c: any) => last10(c.phone) === last10(meta.phone)); if (hit) contactId = hit.id; }
                if (!contactId && meta.name) { const nm = meta.name.toLowerCase(); const hit = list.find((c: any) => String(c.name || "").toLowerCase() === nm); if (hit) contactId = hit.id; }
              }
              await admin.from("quo_calls").insert({
                user_id: s.user_id, op_id: `cube:${f.id}`, direction: "inbound",
                participant: meta.phone, from_number: meta.phone, contact_id: contactId,
                op_created_at: f.createdTime || new Date().toISOString(), transcript: null, processed_at: null,
                raw: { cube: { drive_file_id: f.id, file_name: f.name, account_id: s.account_id, stt_status: "transcribing", transcript_id: tid, source: "cube_acr" } },
              });
              submitted++;
            } catch { failed++; }
          }
        }
      }

      // ================= PASS B: ingest finished transcripts =================
      const { data: inflight } = await admin.from("quo_calls").select("id, raw")
        .eq("user_id", s.user_id).eq("raw->cube->>stt_status", "transcribing").limit(POLL_PER_RUN);
      for (const call of (inflight || [])) {
        const tid = call?.raw?.cube?.transcript_id;
        if (!tid) continue;
        try {
          const tr = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, { headers: { authorization: AAI_KEY } });
          if (!tr.ok) continue;
          const t = await tr.json();
          if (t.status === "completed") {
            const text = diarize(t);
            const dur = t.audio_duration ? Math.round(t.audio_duration) : null;
            const newRaw = { ...(call.raw || {}), cube: { ...(call.raw?.cube || {}), stt_status: "done", utterances: (t.utterances || []).map((u: any) => ({ speaker: u.speaker, text: u.text })) } };
            await admin.from("quo_calls").update({ transcript: text || "(no speech detected)", duration: dur, raw: newRaw, updated_at: new Date().toISOString() }).eq("id", call.id);
            ingested++;
          } else if (t.status === "error") {
            const newRaw = { ...(call.raw || {}), cube: { ...(call.raw?.cube || {}), stt_status: "failed", error: String(t.error || "transcription error") } };
            await admin.from("quo_calls").update({ raw: newRaw, updated_at: new Date().toISOString() }).eq("id", call.id);
            failed++;
          }
          // queued/processing -> leave for next run
        } catch { /* transient */ }
      }

      try { await admin.from("cube_acr_settings").update({ last_checked_at: new Date().toISOString() }).eq("user_id", s.user_id); } catch (_) {}
    }

    return J({ submitted, ingested, failed });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
