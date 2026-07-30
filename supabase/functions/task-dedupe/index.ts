// task-dedupe — compares a proposed task against the user's OPEN tasks and returns
// plausible matches, each classified: same | variant | update | unclear. AI-assisted
// so it catches semantically-equal tasks phrased differently across repeated calls.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODELS = ["claude-sonnet-4-6", "claude-3-5-sonnet-20241022"];

function norm(s: string){ return (s||"").toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(w=>w.length>2); }
function jaccard(a: string, b: string){ const A=new Set(norm(a)), B=new Set(norm(b)); if(!A.size||!B.size) return 0; let inter=0; for(const x of A) if(B.has(x)) inter++; return inter/(A.size+B.size-inter); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await sb.auth.getUser(token);
    const body = await req.json().catch(() => ({}));
    const uid = user?.id || body.user_id;
    if (!uid) return J({ error: "Not authenticated" }, 401);
    const proposed = body.proposed || {};
    const pTitle = String(proposed.title || "").trim();
    if (!pTitle) return J({ ok: true, candidates: [] });

    // Load open tasks (recent). Optionally narrow to a contact's tasks first, then top up.
    let contactTaskIds: string[] = [];
    if (body.contact_id) {
      try { const { data: tc } = await sb.from("task_contacts").select("task_id").eq("contact_id", body.contact_id); contactTaskIds = (tc || []).map((r: any) => r.task_id); } catch (_) {}
    }
    const { data: openTasks } = await sb.from("tasks").select("id,title,notes,priority,due_date,created_at").eq("user_id", uid).eq("completed", false).order("created_at", { ascending: false }).limit(120);
    let pool = (openTasks || []);
    // Rank: same-contact tasks first, then by token overlap with the proposed title.
    pool = pool.map((t: any) => ({ t, s: (contactTaskIds.includes(t.id) ? 0.4 : 0) + jaccard(pTitle + " " + (proposed.note || ""), (t.title || "") + " " + (t.notes || "")) }))
               .sort((a: any, b: any) => b.s - a.s).slice(0, 25).map((x: any) => x.t);
    if (!pool.length) return J({ ok: true, candidates: [] });

    const list = pool.map((t: any, i: number) => `${i}. [id:${t.id}] "${t.title}"${t.due_date ? ` (due ${t.due_date})` : ""}${t.notes ? ` — ${String(t.notes).slice(0, 120)}` : ""}`).join("\n");
    const prompt = `A new task is being created from a phone call. Decide which of the user's OPEN tasks (if any) it overlaps with, so we don't create a duplicate.

NEW TASK: "${pTitle}"${proposed.note ? `\nContext: ${proposed.note}` : ""}

OPEN TASKS:
${list}

Return STRICT JSON only:
{ "candidates": [ { "id": "<task id>", "relation": "same" | "variant" | "update" | "unclear", "why": "one short phrase" } ] }
- "same": essentially the same task (a true duplicate).
- "update": the new task is a newer/expanded version of the existing one (e.g. same commitment, new detail or date).
- "variant": related and easily confused, but plausibly a distinct task.
- "unclear": can't tell — worth showing the user.
Only include tasks that genuinely might overlap. If none overlap, return an empty list. Never invent ids.`;

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    let raw = "";
    let __tdUsage: any = null;
    for (const model of MODELS) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: prompt }] }) });
        if (!r.ok) continue;
        const d = await r.json(); __tdUsage = d?.usage || __tdUsage; raw = (d.content || []).map((c: any) => c.text || "").join(""); if (raw) break;
      } catch (_) {}
    }
    let parsed: any = { candidates: [] };
    try { await logAiUsage(sb, { userId: uid, fn: "task-dedupe", model: MODELS[0], usage: __tdUsage, usedOwn: false }); } catch (_) {}
    try { const m = raw.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : raw); } catch (_) {}
    const byId: Record<string, any> = {}; pool.forEach((t: any) => byId[t.id] = t);
    const candidates = (parsed.candidates || [])
      .filter((c: any) => byId[c.id])
      .map((c: any) => ({ ...byId[c.id], relation: ["same", "variant", "update", "unclear"].includes(c.relation) ? c.relation : "unclear", why: String(c.why || "").slice(0, 140) }));
    return J({ ok: true, candidates });
  } catch (e) { return J({ error: String(e) }, 500); }
});
