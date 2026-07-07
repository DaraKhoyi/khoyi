// recording-transcribe-poll — cron. Finishes AssemblyAI transcriptions for
// manually-uploaded recordings (status='transcribing' with an aai_transcript_id):
// fetches the transcript when ready, writes speaker-labeled text, flips to 'ready'.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") || "";
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  try {
    if ((req.headers.get("x-internal-token") || "") !== (Deno.env.get("QCP_TOKEN") || "")) return J({ error: "unauthorized" }, 401);
    if (!AAI_KEY) return J({ skipped: "no ASSEMBLYAI_API_KEY" });
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: recs } = await admin.from("recordings")
      .select("id, first_speaker, aai_transcript_id")
      .eq("transcription_status", "transcribing").not("aai_transcript_id", "is", null).limit(25);
    if (!recs || !recs.length) return J({ ok: true, checked: 0, ready: 0 });

    let ready = 0, errored = 0, pending = 0;
    for (const rec of recs) {
      try {
        const r = await fetch(`https://api.assemblyai.com/v2/transcript/${rec.aai_transcript_id}`, { headers: { authorization: AAI_KEY } });
        if (!r.ok) { pending++; continue; }
        const t = await r.json();
        if (t.status === "completed") {
          const utt = Array.isArray(t.utterances) ? t.utterances : [];
          const firstLetter = utt[0]?.speaker;
          const firstIsMe = (rec.first_speaker || "me") !== "them";
          const label = (sp: string) => sp === firstLetter ? (firstIsMe ? "Me" : "Them") : (firstIsMe ? "Them" : "Me");
          const text = utt.length ? utt.map((u: any) => `${label(u.speaker)}: ${u.text}`).join("\n") : (t.text || "");
          const segments = utt.map((u: any) => ({ start: (u.start || 0) / 1000, end: (u.end || 0) / 1000, text: u.text, speaker: label(u.speaker) }));
          await admin.from("recordings").update({
            transcription_status: "ready",
            transcript_text: text,
            transcript_segments: segments,
            duration_seconds: t.audio_duration || null,
            transcription_error: null,
          }).eq("id", rec.id);
          ready++;
        } else if (t.status === "error") {
          await admin.from("recordings").update({ transcription_status: "error", transcription_error: String(t.error || "AssemblyAI error").slice(0, 600) }).eq("id", rec.id);
          errored++;
        } else { pending++; }
      } catch (_) { pending++; }
    }
    return J({ ok: true, checked: recs.length, ready, errored, pending });
  } catch (e) { return J({ error: String(e) }, 500); }
});
