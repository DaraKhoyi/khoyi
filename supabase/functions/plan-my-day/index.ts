// plan-my-day
// POST {
//   name?, date?,
//   tasks:        [{id, title, due_date?, priority?}],
//   events:       [{title, start_at?, all_day?}],
//   reachouts:    [{id, name, reason}],
//   unreadEmails: [{id, from, subject, age, excerpt}],   // excerpt = email body text
//   deals:        [{name, status, side?, price?, client?, notes?}],   // Supabase enrichment
//   properties:   [{name, status, notes?}]
// }
// -> { summary, plan: [{ title, when, why, kind, refs }] }
//      kind: task|reachout|email|focus    refs: array of input ids this step draws from
//
// Triages the day into ONE realistic, ordered sequence around the calendar,
// reading email bodies and cross-referencing live deals/properties for context.
// Stateless; no DB access.
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
    const { name, date, tasks = [], events = [], reachouts = [], unreadEmails = [], deals = [], properties = [] } = await req.json();

    const nothing = (!tasks || tasks.length === 0) && (!reachouts || reachouts.length === 0) && (!unreadEmails || unreadEmails.length === 0);
    if (nothing) return J({ summary: "Nothing due, no replies owed, and your inbox is clear — the day is yours. Use the open runway to prospect or get ahead.", plan: [] });

    const taskLines = (tasks || []).slice(0, 30).map((t) => {
      const due = t.due_date ? ` (due ${t.due_date})` : "";
      const pri = t.priority ? ` [${t.priority}]` : "";
      return `(${t.id}) ${t.title}${due}${pri}`;
    }).join("\n");
    const eventLines = (events || []).slice(0, 15).map((e) => {
      const when = e.all_day ? "all day" : (e.start_at ? new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
      return `- ${e.title}${when ? ` @ ${when}` : ""}`;
    }).join("\n");
    const reachLines = (reachouts || []).slice(0, 15).map((r) => `(${r.id}) ${r.name}${r.reason ? ` — ${r.reason}` : ""}`).join("\n");
    const emailLines = (unreadEmails || []).slice(0, 12).map((e) => {
      const body = (e.excerpt || "").replace(/\s+/g, " ").trim().slice(0, 600);
      return `(${e.id}) From ${e.from || "?"}${e.age ? ` (${e.age})` : ""} — Subject: ${e.subject || "(no subject)"}${body ? `\n    Body: ${body}` : ""}`;
    }).join("\n");
    const dealLines = (deals || []).slice(0, 20).map((d) => {
      const bits = [d.name || d.client || "Deal", d.status, d.side, d.price ? `$${Number(d.price).toLocaleString()}` : null].filter(Boolean).join(" · ");
      return `- ${bits}${d.notes ? ` — ${String(d.notes).slice(0, 120)}` : ""}`;
    }).join("\n");
    const propLines = (properties || []).slice(0, 20).map((p) => `- ${[p.name, p.status].filter(Boolean).join(" · ")}${p.notes ? ` — ${String(p.notes).slice(0, 120)}` : ""}`).join("\n");

    const sys = `You are a sharp executive chief of staff for a real-estate broker${name ? ` named ${name}` : ""}. Today is ${date || "today"}.
Build ONE focused, realistic plan for the day from the inputs below: open tasks, people to reach out to, unread emails (with body text), the fixed calendar, and — for CONTEXT — the broker's live deals and properties. Rules:
- Single prioritized sequence, ordered by leverage and urgency — overdue / time-sensitive first, then high-impact revenue & relationship work (replying to people who wrote, overdue follow-ups, live deals), then quick wins. Do not echo input order.
- REACH-OUTS are relationship/revenue work; weight them highly. You may group a few quick calls/texts into one "power hour" block.
- UNREAD EMAILS: read the body text. Surface only the few that are genuinely client-, deal-, or money-relevant (ignore newsletters, receipts, shipping, marketing) and fold the rest into ONE short "triage inbox" step that names the count.
- USE DEALS & PROPERTIES as context to enrich the "why" — if a task, email, or person maps to a live deal or property, say so and let it raise priority. Deals/properties are context only; never turn them into standalone steps unless an input item points to them.
- Work AROUND fixed calendar events (never place work on top of a meeting).
- Be realistic: ~5-8 focused items. Pick the vital few; if there's more, say what to defer.
- For each item include: a short "why", a rough "when", a "kind" (exactly one of task|reachout|email|focus), and "refs" = the list of input ids (the (t#)/(r#)/(e#) tokens) the step draws from. A "triage inbox" step should list all the e# ids it covers. Use [] for refs when none apply.
- Motivating, human.
Respond ONLY with strict JSON, no markdown:
{"summary":"1-2 sentence game plan","plan":[{"title":"...","when":"...","why":"...","kind":"task|reachout|email|focus","refs":["t1","e2"]}]}`;

    const user = `OPEN TASKS:\n${taskLines || "(none)"}\n\nPEOPLE TO REACH OUT TO:\n${reachLines || "(none)"}\n\nUNREAD EMAILS:\n${emailLines || "(none)"}\n\nLIVE DEALS (context):\n${dealLines || "(none)"}\n\nPROPERTIES (context):\n${propLines || "(none)"}\n\nFIXED CALENDAR TODAY:\n${eventLines || "(nothing scheduled)"}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return J({ error: `AI error ${resp.status}` }, 502);
    const data = await resp.json();
    let text = (data?.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch { return J({ summary: "Here's your day.", plan: [], raw: text }); }
    const okKind = (k) => (["task", "reachout", "email", "focus"].includes(k) ? k : "task");
    const plan = Array.isArray(parsed?.plan)
      ? parsed.plan.filter((p) => p && p.title).map((p) => ({
          title: String(p.title), when: String(p.when || ""), why: String(p.why || ""), kind: okKind(String(p.kind || "task")),
          refs: Array.isArray(p.refs) ? p.refs.map((r) => String(r)).slice(0, 20) : [],
        }))
      : [];
    return J({ summary: String(parsed?.summary || "Here's your focused plan for today."), plan });
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
});
