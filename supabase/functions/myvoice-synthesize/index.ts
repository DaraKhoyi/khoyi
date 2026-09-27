import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MODEL = "claude-sonnet-4-6";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callClaude(system: string, user: string, maxTokens = 1400, onUsage?: (u: any) => Promise<void>): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (onUsage) await onUsage(j?.usage);
  let t = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  t = t.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  return t;
}

async function getFloor(): Promise<string> {
  try {
    const sb = createClient(SUPABASE_URL!, SERVICE_KEY!);
    const { data } = await sb.from("voice_cards").select("body").eq("kind", "platform").eq("is_active", true).limit(1);
    if (data && data[0] && data[0].body) return data[0].body as string;
  } catch (_e) {}
  return "THE CONCIERGE — the brokerage platform voice: warm, real-estate savvy, lead with the answer, plain language, no clichés, close with one concrete next step, never salesy or AI-sounding.";
}

function intakeBlock(p: any): string {
  const samples = Array.isArray(p.samples) ? p.samples.filter((s: string) => (s || "").trim()) : [];
  const a = p.answers || {};
  const cal = p.calibration || {};
  const lines: string[] = [];
  lines.push(`AGENT NAME: ${p.name || "the agent"}`);
  if (samples.length) {
    lines.push("\nREAL MESSAGES THEY HAVE SENT (highest-signal — study the rhythm, word choice, warmth, length):");
    samples.forEach((s: string, i: number) => lines.push(`--- sample ${i + 1} ---\n${s}`));
  }
  if (a.opener) lines.push(`\nHow they open a first message: ${a.opener}`);
  if (a.signoff) lines.push(`Sign-off they actually use: ${a.signoff}`);
  if (a.emoji) lines.push(`Emoji: ${a.emoji}`);
  if (a.punctuation) lines.push(`Punctuation that is "them": ${a.punctuation}`);
  if (a.tells) lines.push(`Words/phrases they say a lot (tells): ${a.tells}`);
  if (a.banned) lines.push(`Words/phrases they would NEVER use: ${a.banned}`);
  if (a.analogies) lines.push(`Analogy style: ${a.analogies}`);
  if (a.sliders) lines.push(`Temperament sliders (0-100): ${JSON.stringify(a.sliders)}`);
  if (a.humor) lines.push(`Humor: ${a.humor}`);
  if (a.badNews) lines.push(`Delivering hard news: ${a.badNews}`);
  if (a.why) lines.push(`Why they do this work: ${a.why}`);
  if (a.feel) lines.push(`What they want a client to FEEL after reading them: ${a.feel}`);
  if (a.nonnegotiables) lines.push(`What they push back on (non-negotiables): ${a.nonnegotiables}`);
  if (a.audience) lines.push(`Typical client / register: ${a.audience}`);
  if (a.region) lines.push(`Market/region flavor: ${a.region}`);
  if (a.languages) lines.push(`Other languages they write clients in: ${a.languages}`);
  if (cal.flagged && cal.flagged.length) lines.push(`\nIn a sample Concierge draft, these lines felt "NOT me": ${JSON.stringify(cal.flagged)}`);
  if (cal.rewriteBefore || cal.rewriteAfter) lines.push(`They rewrote one line.\n  Concierge wrote: "${cal.rewriteBefore || ""}"\n  They would say:  "${cal.rewriteAfter || ""}"  (this rewrite is extremely high signal — weight it heavily)`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "Missing ANTHROPIC_API_KEY" }, 500);
  // Auth + cost attribution added 26 Sep: there was no caller check (the gateway
  // accepts the PUBLIC anon key), so anyone could spend Claude credit here, and
  // none of it was attributed. Only the signed-in My Voice screen calls this.
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
  const tok = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: ures } = tok ? await admin.auth.getUser(tok) : { data: null as any };
  const userId = ures?.user?.id;
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const logUsage = (usage: any) => logAiUsage(admin, { userId, fn: "myvoice-synthesize", model: MODEL, usage, usedOwn: false });

  let p: any = {};
  try { p = await req.json(); } catch (_e) { return json({ error: "Bad JSON" }, 400); }
  const mode = p.mode || "card";
  const floor = await getFloor();

  try {
    if (mode === "test") {
      const cardBody = (p.cardBody || "").toString();
      const scenario = (p.scenario || "Write a short, warm text to a buyer named Maria who toured three homes with you last weekend and has gone quiet for five days. Nudge things forward without pressure.").toString();
      const system = `You are writing a real message AS a specific real-estate agent. Two voice layers apply, in order:\n1) THE FLOOR (platform voice) — governs professionalism, structure, and the no-clichés rules:\n${floor}\n2) THE AGENT'S PERSONAL VOICE — wins on phrasing, rhythm, warmth, signature moves:\n${cardBody}\nWrite only the message itself. No preamble, no quotes, no markdown. Keep it the length a real agent would actually send.`;
      const draft = await callClaude(system, `Scenario: ${scenario}\n\nWrite the message now.`, 600, logUsage);
      return json({ draft });
    }

    // mode === 'card'
    const system = `You are PRISM's voice architect for Realty ONE Group Advantage. The brokerage already has a PLATFORM voice called "The Concierge" that EVERY message inherits automatically (warmth, real-estate savvy, lead-with-the-answer, plain language, no clichés, one concrete next step, never salesy or AI-sounding). Your job is to capture ONLY THE DELTA — the things that make THIS agent sound unmistakably like themselves on top of that floor. Do NOT restate the platform rules. Be specific and usable; infer from their real samples first, then their answers, then their calibration edits. Here is the floor for context (do not repeat it back):\n${floor}`;
    const user = `Build this agent's PERSONAL voice card — the layer that rides on top of The Concierge.\n\n${intakeBlock(p)}\n\nReturn ONLY a JSON object (no markdown, no code fences) with these keys:\n{\n  "body": "150-260 words, written in second person ('you'), describing how THIS agent sounds ON TOP of the floor: their rhythm and sentence length, signature phrases/tells, how they open and sign off, emoji/punctuation habits, temperament, how they handle hard news, the register for their typical client, and what they want clients to feel. Include a short 'Signature moves' cluster and a short 'Never (for this agent)' cluster. Plain prose, no markdown headers.",\n  "persona_summary": "one vivid sentence capturing this agent's voice",\n  "do_examples": ["4-6 short, specific, second-person dos unique to this agent"],\n  "dont_examples": ["4-6 short, specific don'ts unique to this agent"]\n}`;
    const text = await callClaude(system, user, 1500, logUsage);
    let card: any = {};
    try { card = JSON.parse(text); } catch (_e) { card = { body: text, persona_summary: "", do_examples: [], dont_examples: [] }; }
    if (!card.body) return json({ error: "Empty card" }, 502);
    return json({
      body: String(card.body || "").trim(),
      persona_summary: String(card.persona_summary || "").trim(),
      do_examples: Array.isArray(card.do_examples) ? card.do_examples.slice(0, 8) : [],
      dont_examples: Array.isArray(card.dont_examples) ? card.dont_examples.slice(0, 8) : [],
    });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
