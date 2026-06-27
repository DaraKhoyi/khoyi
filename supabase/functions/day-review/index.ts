// day-review
// POST { name?, date?, doneCount, total, done:[titles], undone:[titles], mood?, note?, gci? }
// -> { recap }   // a short, warm end-of-day reflection that closes the loop
// Stateless; no DB access. The client persists the recap (day_plans.review + journal).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { name, date, doneCount = 0, total = 0, done = [], undone = [], mood = "", note = "", gci = null } = await req.json();
    const doneLines = (done || []).slice(0, 20).map((t) => `- ${String(t).slice(0, 140)}`).join("\n");
    const undoneLines = (undone || []).slice(0, 20).map((t) => `- ${String(t).slice(0, 140)}`).join("\n");
    const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
    let gciLine = "(not provided)";
    if (gci && gci.goal) {
      gciLine = gci.status === "no_data"
        ? `Annual GCI goal ${money(gci.goal)}; no closed GCI logged yet this year.`
        : `Annual GCI goal ${money(gci.goal)}; YTD ${money(gci.ytd)} (${gci.status}${gci.status === "behind" ? ` by ${money(gci.behindBy)}` : ""}).`;
    }

    const sys = `You are a warm, sharp chief of staff for a real-estate broker${name ? ` named ${name}` : ""}. It's the end of the day (${date || "today"}) and they're closing out their plan. Write a SHORT end-of-day reflection (2-3 sentences, ~45-70 words) that:
- Opens by genuinely acknowledging what they got done (${doneCount} of ${total}) — be specific, name a win or two from the DONE list; celebrate real effort, not just the number.
- Names what to carry into tomorrow from the UNFINISHED list (the one or two that matter most), framed as a clean hand-off, not a scolding.
- Closes with one forward-looking nudge. If GCI shows "behind" and revenue work slipped today, gently point tomorrow toward income-generating activity — encouraging, never guilt.
- Honor the broker's stated MOOD and NOTE if given: match the tone (lift them up on a tough day; match the energy on a great one) and reflect their note back briefly.
Be human and concrete. No markdown, no bullet points, no preamble — just the reflection text.
Respond ONLY with strict JSON: {"recap":"..."}`;

    const user = `DONE (${doneCount}/${total}):\n${doneLines || "(nothing checked off)"}\n\nUNFINISHED:\n${undoneLines || "(everything done!)"}\n\nMOOD: ${mood || "(not given)"}\nNOTE: ${note || "(none)"}\n\nGCI PACE: ${gciLine}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return J({ error: `AI error ${resp.status}` }, 502);
    const data = await resp.json();
    let text = (data?.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let recap = "";
    try { recap = String(JSON.parse(text)?.recap || ""); } catch { recap = text.replace(/^\{?"?recap"?:?\s*"?/i, "").replace(/"?\}?$/i, ""); }
    if (!recap) recap = `You closed out ${doneCount} of ${total} today. Carry the rest into tomorrow and keep the momentum going.`;
    return J({ recap });
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
});
