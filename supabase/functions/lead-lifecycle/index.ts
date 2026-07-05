import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function estDateOffset(days: number): string { return new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }

async function resolveRun(sb: any, uid: string, run: any): Promise<string | null> {
  const cid = run.target_id; if (!cid) return null;
  const { data: contact } = await sb.from("contacts").select("id,name,last_inbound_at").eq("id", cid).maybeSingle();
  if (!contact) { await sb.from("agent_runs").update({ status: "closed" }).eq("id", run.id); return "closed"; }
  const start = new Date(run.decided_at || run.created_at).getTime();

  // signals
  const { data: deals } = await sb.from("deals").select("id").eq("user_id", uid).eq("primary_client_id", cid).limit(1);
  const converted = !!(deals && deals[0]);
  const replied = !!(contact.last_inbound_at && new Date(contact.last_inbound_at).getTime() > start);
  const { data: cadTasks } = await sb.from("tasks").select("id,completed").eq("user_id", uid).eq("source_url", "cadence:" + run.id);
  const total = (cadTasks || []).length;
  const open = (cadTasks || []).filter((t: any) => !t.completed).length;
  const allDone = total > 0 && open === 0;

  let outcome: string | null = null;
  if (converted) outcome = "converted";
  else if (replied) outcome = "engaged";
  else if (allDone) outcome = "nurture";
  if (!outcome) return null; // still active, no engagement yet

  // cancel any remaining cadence tasks (including the outcome-decision task)
  if (open > 0) { try { await sb.from("tasks").update({ completed: true, completed_at: new Date().toISOString() }).eq("user_id", uid).eq("source_url", "cadence:" + run.id).eq("completed", false); } catch (_) {} }

  const steps = Array.isArray(run.steps) ? run.steps : [];
  if (outcome === "engaged") {
    try { await sb.from("tasks").insert({ user_id: uid, title: `${contact.name} replied \u2014 respond and move them into your pipeline`, due_date: estDateOffset(0), priority: "high", completed: false, list: "inbox", contact_id: cid, notes: "Your New-Lead agent stopped the cadence because this lead engaged." }); } catch (_) {}
    steps.push({ step: "lifecycle", detail: "Lead replied during the cadence \u2014 stopped remaining touches and queued a hand-off." });
  } else if (outcome === "converted") {
    steps.push({ step: "lifecycle", detail: "Lead converted (a deal now exists) \u2014 closed the cadence." });
  } else if (outcome === "nurture") {
    try { await sb.from("contacts").update({ cadence_days: 90 }).eq("id", cid); } catch (_) {}
    try { await sb.from("tasks").insert({ user_id: uid, title: `Quarterly nurture touch \u2014 ${contact.name}`, due_date: estDateOffset(90), priority: "low", completed: false, list: "inbox", contact_id: cid, notes: "Cadence finished with no response. Enrolled in long-term (quarterly) nurture so this lead doesn't go dark." }); } catch (_) {}
    steps.push({ step: "lifecycle", detail: "Cadence finished with no response \u2014 enrolled in long-term quarterly nurture." });
  }
  await sb.from("agent_runs").update({ status: outcome, steps, decided_at: run.decided_at || new Date().toISOString() }).eq("id", run.id);
  return outcome;
}

async function runForUser(sb: any, uid: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const { data: runs } = await sb.from("agent_runs").select("id,target_id,decided_at,created_at,steps").eq("user_id", uid).eq("agent", "new_lead").eq("status", "approved").limit(100);
  for (const run of (runs || [])) { try { const o = await resolveRun(sb, uid, run); if (o) counts[o] = (counts[o] || 0) + 1; } catch (_) {} }
  return counts;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await sb.auth.getUser(token);
    if (user) return J({ ok: true, ...(await runForUser(sb, user.id)) });
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    const { data: pausedRows } = await sb.from("agent_controls").select("user_id").eq("paused", true);
    const paused = new Set((pausedRows || []).map((r: any) => r.user_id));
    const totals: Record<string, number> = {};
    for (const a of (agents || [])) { if (paused.has(a.auth_user_id)) continue; try { const c = await runForUser(sb, a.auth_user_id); for (const k in c) totals[k] = (totals[k] || 0) + c[k]; } catch (_) {} }
    return J({ ok: true, ...totals });
  } catch (e) { return J({ error: String(e) }, 500); }
});
