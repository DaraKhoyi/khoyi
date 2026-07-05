import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";
const TERMINAL = ["closed", "lost", "dead", "archived", "withdrawn", "cancelled", "sold"];

function etToday(): string {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const [m, d, y] = s.split(",")[0].trim().split("/");
  return `${y}-${m}-${d}`;
}
function etDateOf(iso: string): string {
  try { const s = new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }); const [m, d, y] = s.split(",")[0].trim().split("/"); return `${y}-${m}-${d}`; } catch (_) { return ""; }
}
function etTime(iso: string): string {
  try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; }
}

async function rankWithClaude(candidates: any[]): Promise<any[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const lines = candidates.map((c) => `${c.idx} [${c.kind}] ${c.title} — ${c.context}`).join("\n");
  const prompt = `You are the broker's chief of staff. Below are candidate items competing for the broker's attention today. Select the ones that genuinely deserve action or awareness today and RANK them most-important first. Be decisive — omit low-value noise. Reply ONLY as a JSON array (no preamble): [{"idx": <number>, "why": "<one short concrete sentence explaining why it matters now>", "priority": 1|2|3}]. priority 1 = urgent/time-sensitive, 2 = important, 3 = nice to do. Include at most 10.

CANDIDATES:
${lines}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json();
    const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const m = raw.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch (_) { return []; }
}

async function generateForUser(sb: any, uid: string): Promise<number> {
  const today = etToday();
  const now = Date.now();
  const candidates: any[] = [];
  let idx = 0;

  // 1) Overdue + due-today tasks
  try {
    const { data } = await sb.from("tasks").select("id,title,due_date,priority,contact_id").eq("user_id", uid).eq("completed", false).not("due_date", "is", null).lte("due_date", today).order("due_date", { ascending: true }).limit(12);
    for (const t of (data || [])) {
      const overdue = t.due_date < today;
      candidates.push({ idx: idx++, kind: "task", title: t.title, context: overdue ? `overdue since ${t.due_date}` : "due today", action_type: "open_task", source_ref: "task:" + t.id, payload: { task_id: t.id }, base: overdue ? 1 : 2 });
    }
  } catch (_) {}

  // 2) Pending call follow-ups
  try {
    const { data } = await sb.from("quo_calls").select("id,participant,summary,op_created_at").eq("user_id", uid).eq("review_status", "pending").order("op_created_at", { ascending: false }).limit(6);
    for (const c of (data || [])) candidates.push({ idx: idx++, kind: "call", title: `Follow up from call with ${c.participant || "a contact"}`, context: (c.summary || "call has suggested to-dos to review").slice(0, 120), action_type: "review_call", source_ref: "call:" + c.id, payload: { call_id: c.id }, base: 2 });
  } catch (_) {}

  // 3) Upcoming knowledge deadlines (next 7 days)
  try {
    const in7 = new Date(now + 7 * 864e5).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
    const [mm, dd, yy] = in7.split(",")[0].trim().split("/"); const end = `${yy}-${mm}-${dd}`;
    const { data } = await sb.from("knowledge_facts").select("fact_key,value_text,value_date,source_id").eq("user_id", uid).in("fact_type", ["deadline", "date"]).not("value_date", "is", null).gte("value_date", today).lte("value_date", end).order("value_date", { ascending: true }).limit(8);
    for (const f of (data || [])) candidates.push({ idx: idx++, kind: "deadline", title: `${f.fact_key}: ${f.value_text || f.value_date}`, context: `deadline on ${f.value_date} from your knowledge base`, action_type: "create_task", source_ref: "kd:" + f.source_id + ":" + f.fact_key, payload: { title: `${f.fact_key} (${f.value_text || f.value_date})`, due_date: f.value_date, priority: "high" }, base: f.value_date <= today ? 1 : 2 });
  } catch (_) {}

  // 4) Stalled deals (active, no movement in 14+ days)
  try {
    const cut = new Date(now - 14 * 864e5).toISOString();
    const { data } = await sb.from("deals").select("id,name,client_name,address,status,updated_at").eq("user_id", uid).lt("updated_at", cut).limit(12);
    for (const d of (data || [])) {
      if (TERMINAL.includes(String(d.status || "").toLowerCase())) continue;
      const days = Math.floor((now - new Date(d.updated_at).getTime()) / 864e5);
      candidates.push({ idx: idx++, kind: "deal", title: `Nudge deal: ${d.name || d.client_name || d.address || "untitled"}`, context: `no movement in ${days} days (status: ${d.status || "active"})`, action_type: "review_deal", source_ref: "deal:" + d.id, payload: { deal_id: d.id }, base: 2 });
    }
  } catch (_) {}

  // 5) Today's appointments
  try {
    const { data } = await sb.from("events").select("id,title,start_at,location,contact_id").eq("user_id", uid).gte("start_at", new Date(now - 6 * 3600e3).toISOString()).lte("start_at", new Date(now + 22 * 3600e3).toISOString()).order("start_at", { ascending: true }).limit(10);
    for (const e of (data || [])) {
      if (etDateOf(e.start_at) !== today) continue;
      candidates.push({ idx: idx++, kind: "appointment", title: `${e.title || "Appointment"} at ${etTime(e.start_at)}`, context: `on your calendar today${e.location ? " — " + e.location : ""}`, action_type: "open_event", source_ref: "evt:" + e.id, payload: { event_id: e.id }, base: 2 });
    }
  } catch (_) {}

  if (!candidates.length) return 0;

  // Rank with Claude (falls back to base ordering)
  let ranked = await rankWithClaude(candidates);
  if (!Array.isArray(ranked) || !ranked.length) ranked = candidates.slice(0, 10).sort((a, b) => a.base - b.base).map((c, i) => ({ idx: c.idx, why: c.context, priority: c.base }));

  // Preserve already-acted items (don't resurrect dismissed/done)
  const { data: existing } = await sb.from("cos_actions").select("source_ref,status").eq("user_id", uid).eq("run_date", today);
  const acted = new Set((existing || []).filter((r: any) => r.status !== "pending").map((r: any) => r.source_ref));

  const rows: any[] = [];
  let rank = 0;
  for (const r of ranked) {
    const c = candidates.find((x) => x.idx === r.idx); if (!c) continue;
    if (acted.has(c.source_ref)) continue;
    rows.push({ user_id: uid, run_date: today, kind: c.kind, title: c.title, why: (r.why || c.context || "").slice(0, 300), action_type: c.action_type, action_payload: c.payload, priority: [1, 2, 3].includes(r.priority) ? r.priority : c.base, rank: rank++, source_ref: c.source_ref, status: "pending" });
  }
  if (!rows.length) return 0;
  try { await sb.from("cos_actions").upsert(rows, { onConflict: "user_id,run_date,source_ref" }); } catch (_) {}
  return rows.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await sb.auth.getUser(token);
    if (user) { const n = await generateForUser(sb, user.id); return J({ ok: true, generated: n }); }
    // cron / service-role: run for all active agents
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    let total = 0;
    for (const a of (agents || [])) { try { total += await generateForUser(sb, a.auth_user_id); } catch (_) {} }
    return J({ ok: true, agents: (agents || []).length, generated: total });
  } catch (e) { return J({ error: String(e) }, 500); }
});
