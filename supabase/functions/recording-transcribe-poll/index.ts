// recording-transcribe-poll — cron. Finishes AssemblyAI transcriptions for
// manually-uploaded recordings (status='transcribing' with an aai_transcript_id):
// fetches the transcript when ready, writes speaker-labeled text, flips to 'ready'.
//
// SPEAKER LABELS ARE IDENTIFIED, NOT GUESSED.
// The previous version decided who was who by POSITION: whoever spoke first was
// assumed to be the account owner (first_speaker defaulted to "me"). Answer a
// call and let the other person speak first — which is most calls — and every
// label came out backwards, taking every extracted commitment with it. It was
// silent, systematic, and invisible in the data.
//
// Now the letters AssemblyAI gives us (A/B/C…) are resolved from what people
// actually SAY: who introduces themselves, who provides the service vs asks for
// it, who is named by the other party. If that cannot be determined we say so —
// neutral "Speaker 1/2" labels and a low-confidence flag beat a confident lie,
// because a wrong label is worse than an absent one.
//
// Also handles 3+ speakers, so meetings label properly instead of being forced
// into a Me/Them binary.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") || "";
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY") || "";
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Who owns this recording, and who else was likely on it.
async function context(admin: any, rec: any) {
  let owner = "The account owner";
  let them: string | null = null;
  try {
    const { data: a } = await admin.from("agents").select("name").eq("auth_user_id", rec.user_id).maybeSingle();
    if (a?.name) owner = a.name;
  } catch (_) { /* neutral fallback is fine */ }
  try {
    if (rec.contact_id) {
      const { data: c } = await admin.from("contacts").select("name").eq("id", rec.contact_id).maybeSingle();
      if (c?.name) them = c.name;
    }
  } catch (_) { /* optional */ }
  return { owner, them };
}

// Ask which letter is the account owner. Returns { map, confidence } where map
// is { "A": "Me", "B": "Renee" }. Deliberately allows "unknown".
async function identifySpeakers(utt: any[], owner: string, them: string | null) {
  const letters = [...new Set(utt.map((u: any) => u.speaker))].filter(Boolean);
  if (!letters.length) return { map: {}, confidence: "low" };
  // One voice: it is a memo. The owner is the only person there.
  if (letters.length === 1) return { map: { [letters[0]]: "Me" }, confidence: "high" };
  if (!ANTHROPIC) return { map: {}, confidence: "low" };

  const sample = utt.slice(0, 60).map((u: any) => `Speaker ${u.speaker}: ${u.text}`).join("\n").slice(0, 6000);
  const sys =
    "You identify who is speaking in a call transcript. Strict JSON, no fence:\n" +
    '{ "owner_letter": "A"|"B"|null, "names": { "A": "name or null" }, "confidence": "high"|"low" }\n\n' +
    `The ACCOUNT OWNER is ${owner}, a real estate professional.` +
    (them ? ` The call is believed to be with ${them}, but verify rather than assume.` : "") + "\n" +
    "Decide which speaker letter is the account owner using EVIDENCE IN THE WORDS:\n" +
    "- someone stating their own name, or being addressed by name by the other party\n" +
    "- who is PROVIDING the real-estate service (listings, showings, contracts, commissions) vs receiving it\n" +
    "- who answers questions about the business vs asks them\n" +
    "Rules:\n" +
    "- Do NOT use speaking order. Who speaks first means nothing.\n" +
    "- If the evidence is thin, set owner_letter null and confidence low. That is a valid, useful answer.\n" +
    "- names: give a real name for a letter only if it is actually said. Otherwise null.";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 400, system: sys,
        messages: [{ role: "user", content: `Speaker letters present: ${letters.join(", ")}.\n\n${sample}` }],
      }),
    });
    if (!r.ok) return { map: {}, confidence: "low" };
    const d = await r.json(); __rtpUsage = d?.usage || __rtpUsage;
    const raw = (d?.content || []).map((c: any) => c?.text || "").join("").replace(/```json|```/g, "").trim();
    const p = JSON.parse(raw);
    const ownerLetter = p?.owner_letter && letters.includes(p.owner_letter) ? p.owner_letter : null;
    if (!ownerLetter) return { map: {}, confidence: "low" };

    const map: Record<string, string> = {};
    let others = 0;
    for (const L of letters) {
      if (L === ownerLetter) { map[L] = "Me"; continue; }
      const said = p?.names?.[L];
      others++;
      map[L] = (typeof said === "string" && said.trim())
        ? said.trim()
        : (letters.length === 2 && them ? them : `Speaker ${others + 1}`);
    }
    return { map, confidence: p?.confidence === "high" ? "high" : "low" };
  } catch (_) {
    return { map: {}, confidence: "low" };
  }
}

serve(async (req) => {
  try {
    if ((req.headers.get("x-internal-token") || "") !== (Deno.env.get("QCP_TOKEN") || "")) return J({ error: "unauthorized" }, 401);
    if (!AAI_KEY) return J({ skipped: "no ASSEMBLYAI_API_KEY" });
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: recs } = await admin.from("recordings")
      .select("id, user_id, contact_id, first_speaker, aai_transcript_id")
      .eq("transcription_status", "transcribing").not("aai_transcript_id", "is", null).limit(25);
    if (!recs || !recs.length) return J({ ok: true, checked: 0, ready: 0 });

    let ready = 0, errored = 0, pending = 0, identified = 0;
    for (const rec of recs) {
      try {
        const r = await fetch(`https://api.assemblyai.com/v2/transcript/${rec.aai_transcript_id}`, { headers: { authorization: AAI_KEY } });
        if (!r.ok) { pending++; continue; }
        const t = await r.json();
        if (t.status === "completed") {
          const utt = Array.isArray(t.utterances) ? t.utterances : [];
          const { owner, them } = await context(admin, rec);
          const { map, confidence } = await identifySpeakers(utt, owner, them);
          try { await logAiUsage(admin, { userId: rec?.user_id, fn: "recording-transcribe-poll", model: "claude-sonnet-4-6", usage: __rtpUsage, usedOwn: false }); } catch (_) {}

          let method = "content";
          let label: (sp: string) => string;
          if (Object.keys(map).length) {
            label = (sp: string) => map[sp] || "Speaker ?";
            identified++;
          } else {
            // Could not identify. Do NOT fall back to the positional guess that
            // caused the inversions — label neutrally and record that it is
            // unresolved, so a human reading this knows not to trust a Me/Them
            // split that was never actually determined.
            method = "unresolved";
            const letters = [...new Set(utt.map((u: any) => u.speaker))].filter(Boolean);
            label = (sp: string) => `Speaker ${Math.max(1, letters.indexOf(sp) + 1)}`;
          }

          const text = utt.length ? utt.map((u: any) => `${label(u.speaker)}: ${u.text}`).join("\n") : (t.text || "");
          const segments = utt.map((u: any) => ({ start: (u.start || 0) / 1000, end: (u.end || 0) / 1000, text: u.text, speaker: label(u.speaker) }));
          await admin.from("recordings").update({
            transcription_status: "ready",
            transcript_text: text,
            transcript_segments: segments,
            speaker_map: Object.keys(map).length ? map : null,
            speaker_id_method: method,
            speaker_id_confidence: confidence,
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
    return J({ ok: true, checked: recs.length, ready, errored, pending, identified });
  } catch (e) { return J({ error: String(e) }, 500); }
});
