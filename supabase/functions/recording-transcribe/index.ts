// recording-transcribe
// POST { recording_id: uuid, user_id: uuid }
//
// Flow:
//   1. Read the recording row, fetch the audio from Supabase Storage
//   2. Send to OpenAI Whisper (verbose_json -> segments with timestamps)
//   3. Apply speaker labels via alternating-gap heuristic + first_speaker hint
//   4. Save transcript + segments back to the row
//   5. The DB trigger queues the contact for DISC re-analysis

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Speaker labeling heuristic for 2-person conversations:
// - First speaker is the one the user said spoke first (first_speaker)
// - Switch speakers when a silence gap > MIN_GAP separates segments
// - This is approximate but good enough for DISC inference; user can correct.
const MIN_GAP_SECONDS = 1.0;

function applySpeakerLabels(segments: any[], firstSpeaker: string): any[] {
  const labels = firstSpeaker === "contact"
    ? ["contact", "me"]
    : ["me", "contact"];
  let cursor = 0;
  const out: any[] = [];
  let prevEnd = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (i > 0) {
      const gap = (s.start || 0) - prevEnd;
      if (gap >= MIN_GAP_SECONDS) cursor = (cursor + 1) % 2;
    }
    out.push({
      start: s.start,
      end: s.end,
      speaker: labels[cursor],
      text: (s.text || "").trim(),
    });
    prevEnd = s.end || s.start || prevEnd;
  }
  return out;
}

function segmentsToPlainText(segments: any[]): string {
  // Group consecutive same-speaker segments into paragraphs
  const parts: string[] = [];
  let current: { speaker: string; text: string } | null = null;
  for (const s of segments) {
    const label = s.speaker === "contact" ? "Contact" : "Me";
    if (current && current.speaker === s.speaker) {
      current.text += " " + s.text;
    } else {
      if (current) parts.push(`${current.speaker === "contact" ? "Contact" : "Me"}: ${current.text}`);
      current = { speaker: s.speaker, text: s.text };
    }
  }
  if (current) parts.push(`${current.speaker === "contact" ? "Contact" : "Me"}: ${current.text}`);
  return parts.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let recordingId: string | null = null;
  try {
    const body = await req.json();
    recordingId = body.recording_id;
    if (!recordingId) throw new Error("recording_id required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Two ways in:
    //  (1) a signed-in user (the app) — derive user_id from their JWT.
    //  (2) an internal caller (the stuck-recording retry cron) — presents the
    //      shared internal token and an explicit user_id. This lets a scheduled
    //      job re-submit a recording that got orphaned in 'pending' without
    //      impersonating anyone. Same submit code runs either way (one place).
    const INTERNAL_TOKEN = Deno.env.get("QCP_TOKEN") || "";
    const internalTok = req.headers.get("x-internal-token") || "";
    let userId: string;
    if (INTERNAL_TOKEN && internalTok && internalTok === INTERNAL_TOKEN) {
      userId = body.user_id;
      if (!userId) throw new Error("user_id required for internal call");
    } else {
      // SECURITY: derive user_id from JWT only
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token || token === SUPABASE_SERVICE_ROLE_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    // Load the recording
    const { data: rec, error: rErr } = await supabase.from("recordings")
      .select("*").eq("id", recordingId).eq("user_id", userId).maybeSingle();
    if (rErr || !rec) throw new Error("Recording not found");
    if (!rec.storage_path) throw new Error("No storage path on recording");
    if (rec.audio_purged) throw new Error("Audio has been purged");

    // Mark as transcribing. AssemblyAI has no 25MB cap and handles multi-hour audio.
    await supabase.from("recordings").update({
      transcription_status: "transcribing",
      transcription_error: null,
      transcription_provider: "assemblyai",
    }).eq("id", recordingId);

    const AAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") || "";
    if (!AAI_KEY) throw new Error("ASSEMBLYAI_API_KEY not configured");

    // Submit via a signed URL so AssemblyAI fetches the audio directly — no size
    // limit and no streaming large files through this function.
    const { data: signed, error: sErr } = await supabase.storage
      .from("recordings").createSignedUrl(rec.storage_path, 60 * 60 * 3);
    if (sErr || !signed?.signedUrl) throw new Error(`Signed URL failed: ${sErr?.message || "unknown"}`);

    // Speaker-count hint sharpens diarization. A recording linked to a single
    // contact is almost always a 1:1 call (you + them = 2). This is a hint, not a
    // hard cap, so larger meetings still resolve; it's also ignored for clips under
    // 2 minutes. An explicit rec.expected_speakers (e.g. a "meeting" set in the app)
    // overrides; unlinked recordings are left to auto-detect.
    // Code-switching / multilingual: transcribe conversations where the speaker
    // flips languages mid-conversation (e.g. English<->Farsi, English<->Spanish).
    // Universal-3 Pro handles the core languages natively; routing to Universal-2
    // extends coverage to all 99 languages (Persian included). Each word is kept in
    // the language it was spoken; the summarizer renders the output in English.
    const aaiBody: Record<string, unknown> = {
      audio_url: signed.signedUrl,
      speaker_labels: true,
      language_detection: true,
      speech_models: ["universal-3-pro", "universal-2"],
      prompt: "The spoken language may change throughout the audio (the speaker may code-switch, e.g. between English and Farsi, or English and Spanish). Transcribe in the original language mix, preserving each word in the language it is spoken.",
    };
    const explicitSpk = Number(rec.expected_speakers) || 0;
    if (explicitSpk >= 1) aaiBody.speakers_expected = Math.min(Math.max(explicitSpk, 1), 20);
    else if (rec.contact_id) aaiBody.speakers_expected = 2;

    const sub = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: AAI_KEY, "content-type": "application/json" },
      body: JSON.stringify(aaiBody),
    });
    if (!sub.ok) {
      const t = await sub.text();
      throw new Error(`AssemblyAI submit error: ${sub.status} ${t.slice(0, 400)}`);
    }
    const subData = await sub.json();
    if (!subData.id) throw new Error("AssemblyAI did not return a transcript id");

    await supabase.from("recordings").update({
      aai_transcript_id: subData.id,
      transcription_status: "transcribing",
    }).eq("id", recordingId);

    // recording-transcribe-poll (cron) finishes it: fetches the transcript when ready.
    return new Response(JSON.stringify({ ok: true, status: "transcribing", transcript_id: subData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    // Best-effort: mark the recording as errored so the UI can show it
    try {
      if (recordingId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase.from("recordings").update({
          transcription_status: "error",
          transcription_error: String(err).slice(0, 600),
        }).eq("id", recordingId);
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
