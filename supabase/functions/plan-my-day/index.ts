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
    const { name, date, tasks = [], events = [], reachouts = [], unreadEmails = [], deals = [], properties = [], journal = [], brain = [], gci = null, habits = null, workingHours = null, constraints = "", pipeline = null, lightDay = false } = await req.json();
    const wh = { start: Number(workingHours?.start) || 8, end: Number(workingHours?.end) || 18 };
    const hhmm = (iso) => { try { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; } };

    const con = String(constraints || "").trim().slice(0, 300);
    const pipeContacts = (pipeline?.contacts || []).slice(0, 8);
    const pipeSystems = (pipeline?.systems || []).slice(0, 8);
    const hasPipeline = pipeContacts.length > 0 || pipeSystems.length > 0;

    const nothing = (!tasks || tasks.length === 0) && (!reachouts || reachouts.length === 0) && (!unreadEmails || unreadEmails.length === 0);
    // Truly empty day AND nothing to prospect → hand the runway back. But if there's a
    // pipeline to protect, fall through and build a pipeline-only day instead.
    if (nothing && !hasPipeline) return J({ summary: "Nothing due, no replies owed, and your inbox is clear — the day is yours. Use the open runway to prospect or get ahead.", plan: [] });

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
    const pipeContactLines = pipeContacts.map((c) => `(${c.id}) ${c.name}${c.reason ? ` — ${c.reason}` : ""}`).join("\n");
    const pipeSystemLines = pipeSystems.map((s) => `- ${s.name}${s.category ? ` (${s.category})` : ""}`).join("\n");

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
- For each item include: a short "why", a "when" (human label), "start"/"end" (HH:MM 24h, or null if deferred), a "kind" (exactly one of task|reachout|email|focus), and "refs" = the list of input ids (the (t#)/(r#)/(e#)/(p#) tokens) the step draws from. A "triage inbox" step should list all the e# ids it covers. Use [] for refs when none apply.
- CHANNEL (reach-outs only): for kind "reachout", add a "channel" (text|call|email) — the best way to reach that person. Infer it from any preference in the brain/journal notes (e.g., "prefers texts", "always call her"); otherwise default to "text" for a quick light touch, "call" for high-stakes or relationship-deepening conversations, and "email" when it needs detail or a document. Omit channel (null) for non-reachout kinds.
- CONSTRAINTS (if provided): the broker has told you specific limits on today — available time, hours they're away, or location (e.g., "only have 2 hours", "out until noon", "working from home", "no calls today"). Treat these as HARD limits and reshape the whole plan around them. Recompute the usable window: if they only have N hours, schedule at most ~N hours of timed work and DEFER the rest (start/end null); if they're out until a time, place nothing before it; if location- or channel-bound (WFH / traveling / no calls), prefer the work that fits (calls/emails/remote vs in-person showings, or text/email when calls are out). Keep only the vital few that fit the limit; defer everything else. Acknowledge the constraint in ONE short phrase in the summary.
- PIPELINE PROTECTION (light days): if LIGHT DAY is true, the broker's task and meeting load is thin — and a quiet day is a silent pipeline risk. Proactively ADD 1-3 concrete revenue-protecting blocks in the open runway, drawn ONLY from the PIPELINE list below. Two kinds: (a) reach out to specific nurture/sphere people — use kind "reachout", put their (p#) id in refs, and set a channel; (b) run a focused prospecting power-hour on ONE of the broker's active lead-gen systems — use kind "focus" and name the actual system (e.g., "Power hour: Sphere of Influence — 30 min of calls/texts"). Name real people and the real system; never invent contacts. On a day with little else, this IS the most important work — give it a prime morning slot, not the leftovers. Do NOT add pipeline blocks when LIGHT DAY is false (the day is already full). If CONSTRAINTS shrink the day, respect them first and add fewer (or no) pipeline blocks.
- RISK & CONFLICT FLAGS: after building the plan, scan for genuine risks the broker should see at a glance and list them in "flags". Each flag is {"level":"warn"|"risk","text":"..."} — "risk" for things that could cost money or break a commitment, "warn" for friction. Look for: a time-sensitive email or deal item (offer expiring, deadline, client waiting) that you could NOT give a prime slot; being BEHIND on GCI with little/no revenue-generating work scheduled today; an item that is chronically deferred (per HABITS) — flag it to drop, delegate, or finally do; an unrealistically ambitious day where important work had to be deferred; a high-stakes step with no buffer before a hard meeting. Do NOT flag simple calendar overlaps or a generic count of deferred items — those are handled elsewhere. Keep flags to the vital few (max 3). Each text is one short, specific, actionable sentence. Use [] when there are no real risks — do not manufacture them.
- Motivating, human.
Respond ONLY with strict JSON, no markdown:
{"summary":"1-2 sentence game plan","plan":[{"title":"...","when":"9:00–9:30 AM","start":"09:00","end":"09:30","why":"...","kind":"task|reachout|email|focus","channel":"text|call|email|null","refs":["t1","e2"]}],"flags":[{"level":"warn|risk","text":"..."}]}`;

    const user = `WORKING HOURS: ${String(wh.start).padStart(2, "0")}:00–${String(wh.end).padStart(2, "0")}:00 (24h). Schedule all timed work inside this window.\n\nCONSTRAINTS FOR TODAY: ${con || "(none — use the full working window)"}\n\nLIGHT DAY: ${lightDay ? "YES — load is thin; proactively protect the pipeline using the PIPELINE list below." : "no — the day has enough real work; do not add pipeline filler."}\n\nOPEN TASKS:\n${taskLines || "(none)"}\n\nPEOPLE TO REACH OUT TO:\n${reachLines || "(none)"}\n\nUNREAD EMAILS:\n${emailLines || "(none)"}\n\nPIPELINE (nurture/sphere people to get ahead on, and active lead-gen systems — use ONLY on a LIGHT DAY):\nContacts:\n${pipeContactLines || "(none)"}\nActive lead-gen systems:\n${pipeSystemLines || "(none)"}\n\nLIVE DEALS (context):\n${dealLines || "(none)"}\n\nPROPERTIES (context):\n${propLines || "(none)"}\n\nRECENT JOURNAL NOTES (context):\n${journalLines || "(none)"}\n\nBRAIN NOTES (context):\n${brainLines || "(none)"}\n\nGCI PACE:\n${gciLine}\n\nHABITS / FOLLOW-THROUGH:\n${habitsLine}\n\nFIXED CALENDAR TODAY:\n${eventLines || "(nothing scheduled)"}`;

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
    const okChan = (c) => (["text", "call", "email"].includes(c) ? c : null);
    const okLevel = (l) => (["warn", "risk"].includes(l) ? l : "warn");
    const plan = Array.isArray(parsed?.plan)
      ? parsed.plan.filter((p) => p && p.title).map((p) => ({
          title: String(p.title), when: String(p.when || ""), start: okTime(p.start), end: okTime(p.end), why: String(p.why || ""), kind: okKind(String(p.kind || "task")),
          channel: okChan(String(p.channel || "")),
          refs: Array.isArray(p.refs) ? p.refs.map((r) => String(r)).slice(0, 20) : [],
        }))
      : [];
    const flags = Array.isArray(parsed?.flags)
      ? parsed.flags.filter((f) => f && f.text).map((f) => ({ level: okLevel(String(f.level || "warn")), text: String(f.text).slice(0, 220) })).slice(0, 3)
      : [];
    return J({ summary: String(parsed?.summary || "Here's your focused plan for today."), plan, flags });
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
});
