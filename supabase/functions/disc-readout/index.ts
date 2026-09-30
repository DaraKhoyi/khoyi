import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model (30 Sep)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Auth + cost attribution added 26 Sep. This function had NO caller check and
// the gateway accepts the PUBLIC anon key: anyone who found the URL could spend the brokerage's Claude
// credit, and none of the spend was attributed (standing rule: every function
// spending tokens logs to ai_usage_log against the user). The app only calls it
// from a signed-in screen via supabase.functions.invoke, which sends the user's JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "Missing ANTHROPIC_API_KEY" }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: ures } = token ? await admin.auth.getUser(token) : { data: null as any };
  const userId = ures?.user?.id;
  if (!userId) return json({ error: "Not authenticated" }, 401);

  let p: any = {};
  try { p = await req.json(); } catch (_e) { return json({ error: "Bad JSON" }, 400); }

  const a = p?.style?.adaptive || {};
  const n = p?.style?.natural || {};
  const sub = p?.drive?.sub || {};
  const validity = p?.validity || {};
  const name = (p?.name || "this agent").toString().slice(0, 80);

  let validityLine = "";
  if (validity.flag) {
    validityLine = `\nVALIDITY ANCHOR: Agent self-reported "${validity.anchorLabel || ""}" for work vs. off-duty. Flag: ${String(validity.flag.type).toUpperCase()} — ${validity.flag.headline}. ${validity.flag.detail}`;
  } else if (validity.anchorLabel) {
    validityLine = `\nVALIDITY ANCHOR: Agent self-reported "${validity.anchorLabel}". No flag triggered.`;
  }

  const system = `You are PRISM, the behavioral intelligence engine for Realty ONE Group Advantage, a real-estate brokerage. You write sharp, honest, useful readouts of an agent's assessment results. Tone: direct, no-fluff, action-oriented, lightly editorial. Read the agent like a coach who has seen 500 careers and will not soften the truth — but is never cruel. Speak TO the agent using "you". Plain prose only: no markdown, no headers, no bullet points or lists inside the readout.`;

  const user = `Generate a Full Spectrum readout for this agent, then two coaching priorities.

AGENT: ${name}

STYLE (DISC), 0-100:
- Adaptive (at work): D=${a.D} I=${a.I} S=${a.S} C=${a.C}
- Natural (off-duty): D=${n.D} I=${n.I} S=${n.S} C=${n.C}
- Style label: ${p?.styleLabel || ""}${validityLine}

DRIVE / GRIT (0-100):
- Endurance (long-arc commitment): ${sub.E}
- Recovery (bounce-back after losses): ${sub.R}
- Discipline (effort when unmotivated): ${sub.D}
- Focus (anti-shiny-object): ${sub.F}
- Overall Drive: ${p?.drive?.overall}
- Distortion items triggered: ${p?.drive?.distortionHits ?? 0} of 4 (3+ = faking-good flag)

Return ONLY a JSON object (no markdown, no code fences) with exactly these keys:
{
  "readout": "Exactly 3 short paragraphs separated by a blank line. (1) What the Style says about how this agent operates, including any notable Natural-vs-Adaptive gap (15+ points = stress signal); weave in the validity flag if one fired. (2) What the Drive scores reveal, with honest emphasis on the lowest sub-dimension and what it looks like on a Tuesday at 2pm in real estate. (3) The combined Style x Drive read: where they win, where they leak revenue. Plain sentences only.",
  "coaching": "Their two lowest Drive sub-dimensions, formatted exactly as: PRIORITY 1: <name>\\n<2-3 sentences: what the gap looks like in practice + a concrete intervention>\\n\\nPRIORITY 2: <name>\\n<2-3 sentences>. Plain text, no markdown."
}`;

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (e) {
    return json({ error: "Upstream fetch failed: " + (e as Error).message }, 502);
  }

  if (!r.ok) {
    const txt = await r.text();
    return json({ error: `Anthropic ${r.status}: ${txt.slice(0, 200)}` }, 502);
  }

  const j = await r.json();
  await logAiUsage(admin, { userId, fn: "disc-readout", model: MODEL, usage: j?.usage, usedOwn: false });
  let text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  // Strip accidental code fences
  text = text.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();

  let readout = "", coaching = "";
  try {
    const parsed = JSON.parse(text);
    readout = (parsed.readout || "").toString().trim();
    coaching = (parsed.coaching || "").toString().trim();
  } catch (_e) {
    // Fallback: treat whole output as the readout
    readout = text;
  }

  if (!readout) return json({ error: "Empty readout" }, 502);
  return json({ readout, coaching });
});
