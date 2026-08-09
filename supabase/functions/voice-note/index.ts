// voice-note — talk for 20 seconds after a showing; PrismOS turns it into filed work.
// The ease-of-use win: one tap, speak, and we transcribe the memo, figure out who
// it's about, write a clean contact note, pull out the to-dos with due dates, and
// draft the follow-up — then hand it back as a review card. Nothing is saved until
// the agent taps Apply.
//
// POST { audio_base64, mime? }  (authenticated)
// -> { ok, transcript, result:{ contact_id?, contact_name?, note, tasks:[{title,due}], followup? } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MODEL = "claude-sonnet-4-6";

async function transcribe(bytes: Uint8Array, aaiKey: string): Promise<string> {
  // 1) upload the audio bytes
  const up = await fetch("https://api.assemblyai.com/v2/upload", { method: "POST", headers: { authorization: aaiKey }, body: bytes });
  const upJson = await up.json();
  if (!upJson.upload_url) throw new Error("upload failed");
  // 2) submit for transcription
  const sub = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST", headers: { authorization: aaiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upJson.upload_url, speech_model: "universal" }),
  });
  const subJson = await sub.json();
  if (!subJson.id) throw new Error("transcript submit failed");
  // 3) poll briefly — a short memo finishes in a few seconds
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const p = await fetch(`https://api.assemblyai.com/v2/transcript/${subJson.id}`, { headers: { authorization: aaiKey } });
    const t = await p.json();
    if (t.status === "completed") return t.text || "";
    if (t.status === "error") throw new Error(t.error || "transcription error");
  }
  throw new Error("transcription timed out");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") || "").replace("Bearer ", ""));
    const uid = u?.user?.id;
    if (!uid) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { audio_base64 } = await req.json();
    if (!audio_base64) return new Response(JSON.stringify({ error: "audio_base64 required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const aaiKey = Deno.env.get("ASSEMBLYAI_API_KEY") || "";
    if (!aaiKey) return new Response(JSON.stringify({ error: "Transcription is not configured." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // decode base64 → bytes
    const bin = atob(audio_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const transcript = await transcribe(bytes, aaiKey);
    if (!transcript.trim()) return new Response(JSON.stringify({ ok: true, transcript: "", result: null, empty: true }), { headers: { ...cors, "Content-Type": "application/json" } });

    // pull the agent's contacts (names only) so Claude can match who it's about
    const { data: contacts } = await admin.from("contacts").select("id, name").eq("user_id", uid).not("name", "is", null).limit(2000);
    const names = (contacts || []).map((c: any) => c.name).slice(0, 800);
    const today = new Date().toISOString().slice(0, 10);

    const sys = `You turn a real-estate agent's spoken memo into filed work. Return ONLY JSON, no prose:
{
  "contact_name": "the person this is about, matched to the provided list if possible, else your best read, else null",
  "note": "a clean, third-person contact note capturing what happened and what matters (1-4 sentences)",
  "tasks": [ { "title": "a clear to-do", "due": "YYYY-MM-DD or null" } ],
  "followup": "a short, warm follow-up text to the person in the agent's voice, or null if none is implied"
}
Today is ${today}. Resolve relative dates ("this weekend", "Monday", "in two days") to real dates. Keep tasks concrete and few. If the memo names a property or people, keep those details in the note.`;

    const usr = `Known contacts (match the memo to one if it clearly fits): ${names.join(", ").slice(0, 6000)}\n\nThe agent said:\n"""${transcript}"""`;

    let result: any = { contact_name: null, note: transcript, tasks: [], followup: null };
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 900, system: sys, messages: [{ role: "user", content: usr }] }),
      });
      const data = await r.json();
      try { await logAiUsage(admin, { userId: uid, fn: "voice-note", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}
      let text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(text);
      result = { ...result, ...parsed };
    } catch (_) { /* keep the raw-transcript fallback */ }

    // resolve the matched name to a contact_id
    let contact_id: string | null = null;
    if (result.contact_name) {
      const want = String(result.contact_name).toLowerCase().trim();
      const hit = (contacts || []).find((c: any) => (c.name || "").toLowerCase().trim() === want)
        || (contacts || []).find((c: any) => (c.name || "").toLowerCase().includes(want) || want.includes((c.name || "").toLowerCase()));
      if (hit) contact_id = hit.id;
    }

    return new Response(JSON.stringify({ ok: true, transcript, result: { ...result, contact_id } }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
