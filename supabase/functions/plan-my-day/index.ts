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
    const { name, date, tasks = [], events = [], reachouts = [], unreadEmails = [], deals = [], properties = [], journal = [], brain = [], gci = null, habits = null, workingHours = null } = await req.json();
    const wh = { start: Number(workingHours?.start) || 8, end: Number(workingHours?.end) || 18 };
    const hhmm = (iso) => { try { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; } };

    const nothing = (!tasks || tasks.length === 0) && (!reachouts || reachouts.length === 0) && (!unreadEmails || unreadEmails.length === 0);
    if (nothing) return J({ summary: "Nothing due, no replies owed, and your inbox is clear — the day is yours. Use the open runway to prospect or get ahead.", plan: [] });

    const taskLines = (tasks || []).slice(0, 30).map((t) => {
      const due = t.due_date ? ` (due ${t.due_date})` : "";
      const pri = t.priority ? ` [${t.priority}]` : "";
      return `(${t.id}) ${t.title}${due}${pri}`;
    }).join("\n");
    const eventLines = (events || []).slice(0, 15).map((e) => {
      if (e.all_day) return `- ${e.title} (all day)`;
      const s = e.start ? e.start : (e.start_at ? hhmm(e.start_at) : "");
      const en = e.end ? e.end : (e.end_at ? hhmm(e.end_at) : "");
      const span = s ? (en && en !== s ? `${s}–${en}` : s) : "";
      return `- ${e.title}${span ? ` @ ${span}` : ""}`;
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
    const journalLines = (journal || []).slice(0, 25).map((j) => `- ${j.when ? `(${j.when}) ` : ""}${String(j.text || "").replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n");
    const brainLines = (brain || []).slice(0, 25).map((b) => `- ${b.title ? `${b.title}: ` : ""}${String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n");
    const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
    let gciLine = "(not provided)";
    if (gci && gci.goal) {
      if (gci.status === "no_data") {
        gciLine = `Annual GCI goal: ${money(gci.goal)}. No closed GCI is recorded yet this year (you're ${gci.yearPct}% through the year). Treat this as a prompt to lean toward revenue and lead-gen work today; do NOT cite a precise dollar gap, and gently suggest logging any closed business.`;
      } else {
        gciLine = `Annual GCI goal: ${money(gci.goal)}. Year-to-date: ${money(gci.ytd)} (${gci.yearPct}% through the year; on-pace target is ${money(gci.paceTarget)}). Status: ${gci.status}${gci.status === "behind" ? ` by ${money(gci.behindBy)}` : ""}.`;
      }
    }
    let habitsLine = "(not provided)";
    if (habits && habits.plansAnalyzed) {
      const kinds = (habits.byKind || []).map((k) => `${k.kind}: ${k.done}/${k.planned} done (${k.rate}%)`).join("; ");
      const chronic = (habits.chronic || []).slice(0, 6).map((t) => `"${t}"`).join(", ");
      habitsLine = `Based on ${habits.plansAnalyzed} recent plans — follow-through by type: ${kinds || "n/a"}.${chronic ? ` Chronically deferred (carried over repeatedly): ${chronic}.` : ""}`;
    }

    const sys = `You are a sharp executive chief of staff for a real-estate broker${name ? ` named ${name}` : ""}. Today is ${date || "today"}.
Build ONE focused, realistic plan for the day from the inputs below: open tasks, people to reach out to, unread emails (with body text), the fixed calendar, and — for CONTEXT — the broker's live deals and properties. Rules:
- Single prioritized sequence, ordered by leverage and urgency — overdue / time-sensitive first, then high-impact revenue & relationship work (replying to people who wrote, overdue follow-ups, live deals), then quick wins. Do not echo input order.
- REACH-OUTS are relationship/revenue work; weight them highly. You may group a few quick calls/texts into one "power hour" block.
- UNREAD EMAILS: read the body text. Surface only the few that are genuinely client-, deal-, or money-relevant (ignore newsletters, receipts, shipping, marketing) and fold the rest into ONE short "triage inbox" step that names the count.
- USE DEALS & PROPERTIES as context to enrich the "why" — if a task, email, or person maps to a live deal or property, say so and let it raise priority. Deals/properties are context only; never turn them into standalone steps unless an input item points to them.
- JOURNAL & BRAIN NOTES are the broker's own recent notes and observations. Use them to add a relevant, specific detail to a step's "why" — a promise made, a person's preference, a next step they jotted, a fact about a deal. Notes are context only; never create a standalone step from them. If a note clearly contradicts or updates an input, defer to the note.
- GCI PACE: This is the broker's income goal for the year. If the status is "behind," weight revenue-generating work higher today (live deals, reach-outs to clients/leads, follow-ups on offers, lead-gen) and name the gap ONCE in the summary to create healthy, motivating urgency — never guilt. If "on_track" or "ahead," acknowledge it briefly and keep balance. If "no_data," simply lean toward revenue/lead-gen without citing a dollar gap.
- HABITS / FOLLOW-THROUGH: This reflects what the broker actually completes. Order the day to fit real behavior — give the kinds they reliably finish prime, high-energy slots; do not over-stack kinds they rarely complete. For chronically deferred items, place them first with a gentle "just knock this out" nudge, or suggest dropping/delegating if it keeps getting skipped. Be encouraging and matter-of-fact, never judgmental.
- Work AROUND fixed calendar events (never place work on top of a meeting). Do NOT output the fixed calendar events themselves as plan steps — they are already on the calendar and will be shown separately. Only schedule the actionable work in the open gaps around them.
- TIME-BLOCK THE DAY: lay the plan on a real timeline inside WORKING HOURS. Treat fixed calendar events as immovable. Slot each actionable step into an open gap and give it a concrete "start" and "end" in 24-hour HH:MM. Use realistic durations — texts/calls 10–20 min, inbox triage 20–30 min, focused work 30–60 min. Never overlap an event or another step. Leave small buffers between blocks; do not pack every minute. Order matters: put the highest-leverage work (and, when behind on GCI, revenue work) in the prime morning slots, respecting the HABITS guidance.
- If a step genuinely won't fit before the end of WORKING HOURS, defer it: set "start" and "end" to null. Put deferred items last. The "when" field should still be a short human label (e.g., "9:00–9:30 AM" or "Tomorrow").
- Be realistic: ~5-8 focused items. Pick the vital few; if there's more, say what to defer.
- For each item include: a short "why", a "when" (human label), "start"/"end" (HH:MM 24h, or null if deferred), a "kind" (exactly one of task|reachout|email|focus), and "refs" = the list of input ids (the (t#)/(r#)/(e#) tokens) the step draws from. A "triage inbox" step should list all the e# ids it covers. Use [] for refs when none apply.
- Motivating, human.
Respond ONLY with strict JSON, no markdown:
{"summary":"1-2 sentence game plan","plan":[{"title":"...","when":"9:00–9:30 AM","start":"09:00","end":"09:30","why":"...","kind":"task|reachout|email|focus","refs":["t1","e2"]}]}`;

    const user = `WORKING HOURS: ${String(wh.start).padStart(2, "0")}:00–${String(wh.end).padStart(2, "0")}:00 (24h). Schedule all timed work inside this window.\n\nOPEN TASKS:\n${taskLines || "(none)"}\n\nPEOPLE TO REACH OUT TO:\n${reachLines || "(none)"}\n\nUNREAD EMAILS:\n${emailLines || "(none)"}\n\nLIVE DEALS (context):\n${dealLines || "(none)"}\n\nPROPERTIES (context):\n${propLines || "(none)"}\n\nRECENT JOURNAL NOTES (context):\n${journalLines || "(none)"}\n\nBRAIN NOTES (context):\n${brainLines || "(none)"}\n\nGCI PACE:\n${gciLine}\n\nHABITS / FOLLOW-THROUGH:\n${habitsLine}\n\nFIXED CALENDAR TODAY:\n${eventLines || "(nothing scheduled)"}`;

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
    const okTime = (t) => (typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t.trim()) ? t.trim().padStart(5, "0") : null);
    const plan = Array.isArray(parsed?.plan)
      ? parsed.plan.filter((p) => p && p.title).map((p) => ({
          title: String(p.title), when: String(p.when || ""), start: okTime(p.start), end: okTime(p.end), why: String(p.why || ""), kind: okKind(String(p.kind || "task")),
          refs: Array.isArray(p.refs) ? p.refs.map((r) => String(r)).slice(0, 20) : [],
        }))
      : [];
    return J({ summary: String(parsed?.summary || "Here's your focused plan for today."), plan });
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
});
