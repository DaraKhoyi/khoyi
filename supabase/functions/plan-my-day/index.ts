// plan-my-day
// POST {
//   name?, date?,
//   tasks:        [{title, due_date?, priority?}],
//   events:       [{title, start_at?, all_day?}],
//   reachouts:    [{name, reason}],         // people to contact (reply owed / cadence overdue)
//   unreadEmails: [{from, subject, age}]    // inbox triage signal
// }
// -> { summary: string, plan: [{ title, when, why, kind }] }   kind: task|reachout|email|focus
//
// Triages the day's work — tasks, reach-outs, and inbox — into ONE realistic,
// ordered sequence around the user's calendar. Stateless; no DB access.
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
    const { name, date, tasks = [], events = [], reachouts = [], unreadEmails = [] } = await req.json();

    const nothing = (!tasks || tasks.length === 0) && (!reachouts || reachouts.length === 0) && (!unreadEmails || unreadEmails.length === 0);
    if (nothing) {
      return J({ summary: "Nothing due, no replies owed, and your inbox is clear — the day is yours. Use the open runway to prospect or get ahead.", plan: [] });
    }

    const taskLines = (tasks || []).slice(0, 30).map((t, i) => {
      const due = t.due_date ? ` (due ${t.due_date})` : "";
      const pri = t.priority ? ` [${t.priority}]` : "";
      return `${i + 1}. ${t.title}${due}${pri}`;
    }).join("\n");
    const eventLines = (events || []).slice(0, 15).map((e) => {
      const when = e.all_day ? "all day" : (e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
      return `- ${e.title}${when ? ` @ ${when}` : ""}`;
    }).join("\n");
    const reachLines = (reachouts || []).slice(0, 15).map((r, i) => `${i + 1}. ${r.name}${r.reason ? ` — ${r.reason}` : ""}`).join("\n");
    const emailLines = (unreadEmails || []).slice(0, 12).map((e, i) => `${i + 1}. From ${e.from || "?"}${e.age ? ` (${e.age})` : ""}: ${e.subject || "(no subject)"}`).join("\n");

    const sys = `You are a sharp executive chief of staff for a real-estate broker${name ? ` named ${name}` : ""}. Today is ${date || "today"}.
Build ONE focused, realistic plan for the day from FOUR inputs: open tasks, people to reach out to, unread emails, and the fixed calendar. Rules:
- Produce a single prioritized sequence, ordered by leverage and urgency — overdue / time-sensitive first, then high-impact revenue & relationship work (replying to people who wrote, overdue follow-ups, live deals), then quick wins. Do not just echo input order.
- REACH-OUTS are relationship/revenue work — weight them highly. A client awaiting a reply or an overdue follow-up usually outranks routine tasks. You may group a few quick calls/texts into one "power hour" block.
- UNREAD EMAILS: do NOT list newsletters, receipts, shipping notices, or marketing. Identify only the few that look client-, deal-, or money-relevant and surface those specifically; fold the rest into a single short "triage inbox" step (mention the count). Never let inbox noise crowd out real work.
- Work AROUND the fixed calendar events (never place a task on top of a meeting).
- Be realistic: a person meaningfully finishes ~5-8 focused items a day. Pick the vital few across ALL inputs; if there's more, say what to defer.
- For each item: a short reason it earns the slot, a rough "when" (e.g., "First thing", "Before your 1:30", "Power hour, late morning", "End of day"), and a "kind" of exactly one of: task, reachout, email, focus.
- Keep it motivating and human.
Respond ONLY with strict JSON, no markdown, no preamble:
{"summary":"1-2 sentence game plan","plan":[{"title":"...","when":"...","why":"...","kind":"task|reachout|email|focus"}]}`;

    const user = `OPEN TASKS (due/overdue/priority):\n${taskLines || "(none)"}\n\nPEOPLE TO REACH OUT TO:\n${reachLines || "(none)"}\n\nUNREAD EMAILS:\n${emailLines || "(none)"}\n\nFIXED CALENDAR TODAY:\n${eventLines || "(nothing scheduled)"}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1600, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return J({ error: `AI error ${resp.status}` }, 502);
    const data = await resp.json();
    let text = (data?.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch { return J({ summary: "Here's your day.", plan: [], raw: text }); }
    const okKind = (k) => (["task", "reachout", "email", "focus"].includes(k) ? k : "task");
    const plan = Array.isArray(parsed?.plan)
      ? parsed.plan.filter((p) => p && p.title).map((p) => ({ title: String(p.title), when: String(p.when || ""), why: String(p.why || ""), kind: okKind(String(p.kind || "task")) }))
      : [];
    return J({ summary: String(parsed?.summary || "Here's your focused plan for today."), plan });
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
});
