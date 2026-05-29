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
    const userId = body.user_id;
    if (!recordingId || !userId) throw new Error("recording_id and user_id required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load the recording
    const { data: rec, error: rErr } = await supabase.from("recordings")
      .select("*").eq("id", recordingId).eq("user_id", userId).maybeSingle();
    if (rErr || !rec) throw new Error("Recording not found");
    if (!rec.storage_path) throw new Error("No storage path on recording");
    if (rec.audio_purged) throw new Error("Audio has been purged");

    // Mark as transcribing
    await supabase.from("recordings").update({
      transcription_status: "transcribing",
      transcription_error: null,
    }).eq("id", recordingId);

    // Download the audio file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("recordings").download(rec.storage_path);
    if (dlErr || !fileData) throw new Error(`Download failed: ${dlErr?.message || "unknown"}`);

    // Send to Whisper with verbose_json to get segments
    const form = new FormData();
    form.append("file", fileData, rec.storage_path.split("/").pop() || "audio.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const wResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!wResp.ok) {
      const t = await wResp.text();
      throw new Error(`Whisper error: ${wResp.status} ${t.slice(0, 400)}`);
    }
    const whisperData = await wResp.json();
    const rawSegments = whisperData.segments || [{ start: 0, end: 0, text: whisperData.text || "" }];

    // Apply speaker labels
    const labeledSegments = applySpeakerLabels(rawSegments, rec.first_speaker || "me");
    const transcriptText = segmentsToPlainText(labeledSegments);
    const duration = whisperData.duration || (rawSegments.length ? rawSegments[rawSegments.length - 1].end : null);

    // Save back to the recording (this triggers the DISC queue via DB trigger)
    const { error: upErr } = await supabase.from("recordings").update({
      transcription_status: "ready",
      transcript_text: transcriptText,
      transcript_segments: labeledSegments,
      duration_seconds: duration,
      transcription_error: null,
    }).eq("id", recordingId);
    if (upErr) throw new Error(`Save failed: ${upErr.message}`);

    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: duration,
      segment_count: labeledSegments.length,
      transcript_chars: transcriptText.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
