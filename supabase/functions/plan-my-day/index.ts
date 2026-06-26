// plan-my-day
// POST { name?, date?, tasks: [{title, due_date?, priority?}], events: [{title, start_at?, all_day?}] }
// -> { summary: string, plan: [{ title: string, when: string, why: string }] }
//
// Triages the day's due/overdue tasks into a realistic, ordered sequence around
// the user's existing calendar, with a one-line reason for each. Stateless — all
// data is passed in; no DB access.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { name, date, tasks = [], events = [] } = await req.json();
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return J({ summary: "Nothing due or overdue — your day is clear. Use the open runway to prospect or get ahead.", plan: [] });
    }

    const taskLines = tasks.slice(0, 30).map((t: any, i: number) => {
      const due = t.due_date ? ` (due ${t.due_date})` : "";
      const pri = t.priority ? ` [${t.priority}]` : "";
      return `${i + 1}. ${t.title}${due}${pri}`;
    }).join("\n");
    const eventLines = (events || []).slice(0, 15).map((e: any) => {
      const when = e.all_day ? "all day" : (e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
      return `- ${e.title}${when ? ` @ ${when}` : ""}`;
    }).join("\n");

    const sys = `You are a sharp executive chief of staff for a real-estate broker${name ? ` named ${name}` : ""}. Today is ${date || "today"}.
Triage the task list into a focused, realistic plan for ONE day. Rules:
- Order by leverage and urgency: overdue and time-sensitive first, then high-impact revenue/relationship work, then quick wins. Do not just echo the input order.
- Work AROUND the fixed calendar events (never schedule a task on top of a meeting).
- Be realistic — a person can meaningfully complete maybe 5-8 focused items in a day. If there are more, pick the vital few and say what to defer.
- For each chosen item, give a short, concrete reason (why it earns the slot) and a rough "when" (e.g., "First thing", "Before your 1:30", "Late morning", "After lunch", "End of day").
- Keep it motivating and human, not robotic.
Respond ONLY with strict JSON, no markdown, no preamble:
{"summary":"1-2 sentence game plan for the day","plan":[{"title":"...","when":"...","why":"..."}]}`;

    const user = `TASKS (due/overdue/priority):\n${taskLines}\n\nFIXED CALENDAR TODAY:\n${eventLines || "(nothing scheduled)"}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return J({ error: `AI error ${resp.status}` }, 502);
    const data = await resp.json();
    let text = (data?.content || []).map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { return J({ summary: "Here's your day.", plan: [], raw: text }); }
    const plan = Array.isArray(parsed?.plan) ? parsed.plan.filter((p: any) => p && p.title).map((p: any) => ({ title: String(p.title), when: String(p.when || ""), why: String(p.why || "") })) : [];
    return J({ summary: String(parsed?.summary || "Here's your focused plan for today."), plan });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
