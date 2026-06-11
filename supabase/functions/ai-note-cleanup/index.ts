// ai-note-cleanup
// POST { text: string, kind?: 'note'|'call'|'meeting'|'text'|'email' }
// -> { cleaned: string }
//
// Turns a raw, voice-dictated (or rough) activity note into a clean, concise,
// professional CRM timeline note. Preserves every concrete fact; never invents.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KIND_HINT: Record<string, string> = {
  note: "a general note",
  call: "a phone call recap",
  meeting: "a meeting recap",
  text: "a text/SMS exchange recap",
  email: "an email recap",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text, kind } = await req.json();
    if (!text || !String(text).trim()) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hint = KIND_HINT[kind] || "a note";
    const system = `You clean up voice-dictated CRM activity notes for a real-estate professional. The user spoke a raw, unstructured ${hint}; turn it into a clear, concise, professional written note for a CRM activity timeline.

Rules:
- Preserve every concrete fact exactly: names, phone numbers, dollar amounts, dates, addresses, percentages, commitments, and next steps. NEVER invent or embellish details.
- Fix grammar, punctuation, filler words ("um", "like"), and false starts.
- Keep it tight: 1-4 short sentences, or a few compact lines if there are multiple distinct points.
- If there are clear action items, end with a single line starting "Next: " summarizing them.
- Preserve any @mentions (e.g. @John Smith) and #tags exactly as written.
- Write in first person from the user's perspective, past tense.
- Output ONLY the cleaned note text. No preamble, no surrounding quotes, no markdown headers.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: String(text) }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${t.slice(0, 200)}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await r.json();
    const cleaned = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    return new Response(JSON.stringify({ cleaned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
