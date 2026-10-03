// journal-tidy — clean up a dictated journal note WITHOUT shortening it.
// POST { text } -> { tidied }
//
// Dara, 3 Oct 2026, on the full-screen Journal: the sparkle button. Dictation
// leaves run-on sentences, "um", missing full stops and mis-heard homophones.
// This fixes those and nothing else. It is NOT a summary: a journal is the
// record, so every fact, name, number, time stamp, bullet, checkbox and
// ==highlight== comes back, in the same order. The app puts the result in place
// through its own undo history, so one tap of Undo returns the original words.
//
// Haiku: this is proofreading, not reasoning. Signed-in users only; the cost is
// logged to the person (not about one contact — see ai_fn_not_about_a_person).
import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const MODEL = "claude-haiku-4-5";
const MAX_CHARS = 12000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `You proofread a person's private journal note, much of it dictated by voice. Return the SAME note, cleaned up. You are a careful copy editor, not a writer.

Do:
- Fix spelling, capitalisation, punctuation and obvious speech-to-text mistakes.
- Remove filler ("um", "uh", "you know", "like" as filler) and false starts.
- Break run-on dictation into sentences and, where the topic clearly changes, paragraphs.

Never:
- Never shorten, summarise, or drop a detail. Every fact, name, number, amount, date, address and intention stays.
- Never add anything that is not there: no advice, no conclusions, no headings, no "Next:" line.
- Never change the order of what was said, or the person's own wording and voice beyond the fixes above.
- Never touch these markers; keep each exactly where it is: a line that begins with a date and time followed by " — "; a line that begins with "• "; a line that begins with "☐ " or "☑ " (keep the same box); text wrapped in ==double equals== (keep the == on both sides).
- If a name or word is unclear, leave it as written. Do not guess.

Output ONLY the cleaned note. No preamble, no quotes around it, no explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text } = await req.json().catch(() => ({}));
    const raw = String(text || "");
    if (!raw.trim()) return J({ error: "text required" }, 400);
    if (raw.length > MAX_CHARS) return J({ error: "too_long", max: MAX_CHARS }, 413);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return J({ error: "Unauthorized" }, 401);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return J({ error: "not configured" }, 500);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: "user", content: raw }] }),
    });
    if (!r.ok) return J({ error: `model ${r.status}` }, 502);
    const j = await r.json();
    try { await logAiUsage(supabase, { userId: user.id, fn: "journal-tidy", model: MODEL, usage: j?.usage, usedOwn: false }); } catch (_) {}
    if (j?.stop_reason === "max_tokens") return J({ error: "too_long", max: MAX_CHARS }, 413);   // never hand back a note cut off mid-way
    const tidied = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    // A proofread that lost a third of the note is a summary, and a summary is not what was asked for.
    if (!tidied || tidied.length < raw.trim().length * 0.6) return J({ error: "would_shorten" }, 422);
    return J({ tidied });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
