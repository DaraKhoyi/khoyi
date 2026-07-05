import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";
const TERMINAL = ["closed", "lost", "dead", "archived", "withdrawn", "cancelled", "sold"];

function etToday(): string {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const [m, d, y] = s.split(",")[0].trim().split("/"); return `${y}-${m}-${d}`;
}
function etDateOf(iso: string): string { try { const s = new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }); const [m, d, y] = s.split(",")[0].trim().split("/"); return `${y}-${m}-${d}`; } catch (_) { return ""; } }
function etTime(iso: string): string { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } }
function daysAgo(n: number): string { return new Date(Date.now() - n * 864e5).toISOString(); }
function dateAgo(n: number): string { return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); }

async function planWithClaude(obligations: any[], growth: any[]): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const oLines = obligations.map((c) => `${c.idx} [${c.kind}] ${c.title} — ${c.context}`).join("\n") || "(none)";
  const gLines = growth.map((c) => `${c.idx} [${c.kind}] ${c.title} — ${c.context}`).join("\n") || "(none)";
  const prompt = `You are the broker's chief of staff. Two lists follow. OBLIGATIONS are things that need a response so nothing drops. OPPORTUNITIES are proactive plays to grow the business.

Do three things and reply ONLY as JSON (no preamble):
1. "summary": a warm, 2-3 sentence good-morning orientation addressed directly to the broker — what's pressing, and what's worth pursuing today. Natural, human, concise.
2. "obligations": rank them most-important first; omit low-value noise. Each: {"idx":n,"why":"one concrete sentence why it matters now","priority":1|2|3} (1=urgent, 2=important, 3=minor).
3. "growth": curate to the best 1-3 highest-value plays only — quality over quantity. Each: {"idx":n,"why":"one compelling concrete sentence","priority":1|2|3}.

OBLIGATIONS:
${oLines}

OPPORTUNITIES:
${gLines}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json();
    const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const m = raw.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : raw);
    return { summary: p.summary || "", obligations: Array.isArray(p.obligations) ? p.obligations : [], growth: Array.isArray(p.growth) ? p.growth.slice(0, 3) : [] };
  } catch (_) { return { summary: "", obligations: [], growth: [] }; }
}

async function generateForUser(sb: any, uid: string): Promise<number> {
  const today = etToday(); const now = Date.now();
  const obligations: any[] = []; const growth: any[] = []; let idx = 0;

  // ===== OBLIGATIONS =====
  try {
    const { data } = await sb.from("tasks").select("id,title,due_date").eq("user_id", uid).eq("completed", false).not("due_date", "is", null).lte("due_date", today).order("due_date", { ascending: true }).limit(12);
    for (const t of (data || [])) { const overdue = t.due_date < today; obligations.push({ idx: idx++, bucket: "obligation", kind: "task", title: t.title, context: overdue ? `overdue since ${t.due_date}` : "due today", action_type: "open_task", source_ref: "task:" + t.id, payload: { task_id: t.id }, base: overdue ? 1 : 2 }); }
  } catch (_) {}
  try {
    const { data } = await sb.from("quo_calls").select("id,participant,summary,op_created_at").eq("user_id", uid).eq("review_status", "pending").order("op_created_at", { ascending: false }).limit(6);
    for (const c of (data || [])) obligations.push({ idx: idx++, bucket: "obligation", kind: "call", title: `Follow up from call with ${c.participant || "a contact"}`, context: (c.summary || "call has suggested to-dos to review").slice(0, 120), action_type: "review_call", source_ref: "call:" + c.id, payload: { call_id: c.id }, base: 2 });
  } catch (_) {}
  try {
    const { data } = await sb.from("knowledge_facts").select("fact_key,value_text,value_date,source_id").eq("user_id", uid).in("fact_type", ["deadline", "date"]).not("value_date", "is", null).gte("value_date", today).lte("value_date", dateAgo(-7)).order("value_date", { ascending: true }).limit(8);
    for (const f of (data || [])) obligations.push({ idx: idx++, bucket: "obligation", kind: "deadline", title: `${f.fact_key}: ${f.value_text || f.value_date}`, context: `deadline on ${f.value_date} from your knowledge base`, action_type: "create_task", source_ref: "kd:" + f.source_id + ":" + f.fact_key, payload: { title: `${f.fact_key} (${f.value_text || f.value_date})`, due_date: f.value_date, priority: "high" }, base: f.value_date <= today ? 1 : 2 });
  } catch (_) {}
  try {
    const { data } = await sb.from("deals").select("id,name,client_name,address,status,updated_at").eq("user_id", uid).lt("updated_at", daysAgo(14)).limit(12);
    for (const d of (data || [])) { if (TERMINAL.includes(String(d.status || "").toLowerCase())) continue; const days = Math.floor((now - new Date(d.updated_at).getTime()) / 864e5); obligations.push({ idx: idx++, bucket: "obligation", kind: "deal", title: `Nudge deal: ${d.name || d.client_name || d.address || "untitled"}`, context: `no movement in ${days} days (status: ${d.status || "active"})`, action_type: "review_deal", source_ref: "deal:" + d.id, payload: { deal_id: d.id }, base: 2 }); }
  } catch (_) {}
  try {
    const { data } = await sb.from("events").select("id,title,start_at,location").eq("user_id", uid).gte("start_at", new Date(now - 6 * 3600e3).toISOString()).lte("start_at", new Date(now + 22 * 3600e3).toISOString()).order("start_at", { ascending: true }).limit(10);
    for (const e of (data || [])) { if (etDateOf(e.start_at) !== today) continue; obligations.push({ idx: idx++, bucket: "obligation", kind: "appointment", title: `${e.title || "Appointment"} at ${etTime(e.start_at)}`, context: `on your calendar today${e.location ? " — " + e.location : ""}`, action_type: "open_event", source_ref: "evt:" + e.id, payload: { event_id: e.id }, base: 2 }); }
  } catch (_) {}

  // Prepared agent plans awaiting approval (e.g., New-Lead Orchestrator)
  try {
    const { data } = await sb.from("agent_runs").select("id,summary,agent").eq("user_id", uid).eq("status", "prepared").order("created_at", { ascending: false }).limit(6);
    for (const r of (data || [])) obligations.push({ idx: idx++, bucket: "obligation", kind: "agent_plan", title: (r.agent === "post_close" ? "Post-close plan ready — review & approve" : "New-lead plan ready — review & approve"), context: (r.summary || "a prepared plan is waiting for your approval").slice(0, 140), action_type: "open_agentruns", source_ref: "run:" + r.id, payload: { run_id: r.id }, base: 2 });
  } catch (_) {}

  // ===== OPPORTUNITIES (growth) =====
  try {
    const { data } = await sb.from("contacts").select("id,name,type,last_contact_at").eq("user_id", uid).lt("last_contact_at", daysAgo(90)).order("last_contact_at", { ascending: true }).limit(12);
    for (const c of (data || [])) { const days = c.last_contact_at ? Math.floor((now - new Date(c.last_contact_at).getTime()) / 864e5) : null; growth.push({ idx: idx++, bucket: "growth", kind: "reengage", title: `Reconnect with ${c.name}`, context: `${days ? days + " days" : "a long time"} since your last contact${c.type ? " — " + c.type : ""}; overdue for a warm touch`, action_type: "create_task", source_ref: "reengage:" + c.id, payload: { title: `Reach out to ${c.name} (reconnect)`, priority: "medium" }, base: 3 }); }
  } catch (_) {}
  try {
    const { data } = await sb.from("deals").select("id,name,client_name,close_date,status").eq("user_id", uid).eq("status", "closed").gte("close_date", dateAgo(30)).limit(8);
    for (const d of (data || [])) growth.push({ idx: idx++, bucket: "growth", kind: "review_ask", title: `Ask ${d.client_name || d.name || "your recent client"} for a review + referral`, context: `closed ${d.close_date} — the warmest window for a 5-star review and a referral`, action_type: "create_task", source_ref: "review:" + d.id, payload: { title: `Request review + referral — ${d.client_name || d.name || d.id}`, priority: "medium" }, base: 2 });
  } catch (_) {}
  try {
    const { data } = await sb.from("contacts").select("id,name,recruiting_stage,recruiting_stage_changed_at").eq("user_id", uid).not("recruiting_stage", "is", null).not("recruiting_stage", "in", "(signed,lost,hired)").lt("recruiting_stage_changed_at", daysAgo(14)).order("recruiting_stage_changed_at", { ascending: true }).limit(8);
    for (const c of (data || [])) growth.push({ idx: idx++, bucket: "growth", kind: "recruit", title: `Recruiting: follow up with ${c.name}`, context: `in your recruiting pipeline at "${c.recruiting_stage}" with no movement lately`, action_type: "create_task", source_ref: "recruit:" + c.id, payload: { title: `Recruiting follow-up — ${c.name}`, priority: "medium" }, base: 3 });
  } catch (_) {}

  const allById: Record<number, any> = {};
  for (const c of [...obligations, ...growth]) allById[c.idx] = c;
  if (!obligations.length && !growth.length) { try { await sb.from("cos_runs").upsert({ user_id: uid, run_date: today, summary: "You're all clear right now — no fires and nothing queued. As calls, emails, and deadlines come in, I'll line up what's next." }, { onConflict: "user_id,run_date" }); } catch (_) {} return 0; }

  let plan = await planWithClaude(obligations, growth);
  let plannedO = plan.obligations, plannedG = plan.growth, summary = plan.summary;
  if (!plannedO.length && !plannedG.length) { plannedO = obligations.slice(0, 10).sort((a, b) => a.base - b.base).map((c) => ({ idx: c.idx, why: c.context, priority: c.base })); plannedG = growth.slice(0, 3).map((c) => ({ idx: c.idx, why: c.context, priority: c.base })); }
  if (!summary) summary = `You have ${obligations.length} item${obligations.length === 1 ? "" : "s"} that need${obligations.length === 1 ? "s" : ""} you today${plannedG.length ? `, plus ${plannedG.length} growth play${plannedG.length === 1 ? "" : "s"} worth a look` : ""}.`;
  try { await sb.from("cos_runs").upsert({ user_id: uid, run_date: today, summary }, { onConflict: "user_id,run_date" }); } catch (_) {}

  const { data: existing } = await sb.from("cos_actions").select("source_ref,status").eq("user_id", uid).eq("run_date", today);
  const acted = new Set((existing || []).filter((r: any) => r.status !== "pending").map((r: any) => r.source_ref));
  const rows: any[] = [];
  let rank = 0;
  for (const r of plannedO) { const c = allById[r.idx]; if (!c || c.bucket !== "obligation" || acted.has(c.source_ref)) continue; rows.push({ user_id: uid, run_date: today, bucket: "obligation", kind: c.kind, title: c.title, why: (r.why || c.context || "").slice(0, 300), action_type: c.action_type, action_payload: c.payload, priority: [1, 2, 3].includes(r.priority) ? r.priority : c.base, rank: rank++, source_ref: c.source_ref, status: "pending" }); }
  let grank = 100;
  for (const r of plannedG) { const c = allById[r.idx]; if (!c || c.bucket !== "growth" || acted.has(c.source_ref)) continue; rows.push({ user_id: uid, run_date: today, bucket: "growth", kind: c.kind, title: c.title, why: (r.why || c.context || "").slice(0, 300), action_type: c.action_type, action_payload: c.payload, priority: [1, 2, 3].includes(r.priority) ? r.priority : c.base, rank: grank++, source_ref: c.source_ref, status: "pending" }); }
  if (rows.length) { try { await sb.from("cos_actions").upsert(rows, { onConflict: "user_id,run_date,source_ref" }); } catch (_) {} }
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
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    let total = 0;
    for (const a of (agents || [])) { try { total += await generateForUser(sb, a.auth_user_id); } catch (_) {} }
    return J({ ok: true, agents: (agents || []).length, generated: total });
  } catch (e) { return J({ error: String(e) }, 500); }
});
