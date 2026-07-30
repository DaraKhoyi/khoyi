import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";

async function loadVoice(sb: any, uid: string): Promise<any> {
  try { const { data } = await sb.from("voice_cards").select("body,name").eq("user_id", uid).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1); return data?.[0] || null; } catch (_) { return null; }
}
async function research(token: string | null, contact_id: string): Promise<string> {
  if (!token) return "";
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/contact-research`, { method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ contact_id, scope: "both" }), signal: ctrl.signal });
    clearTimeout(to);
    const j = await r.json().catch(() => null);
    if (!j) return "";
    const bits = [j.summary, j.overview, j.professional_summary, j.bio, j.notes].filter(Boolean);
    return (bits.join("\n") || JSON.stringify(j)).slice(0, 2500);
  } catch (_) { return ""; }
}

async function planFor(sb: any, uid: string, contact: any, token: string | null): Promise<any> {
  const steps: any[] = [{ step: "context", detail: `Loaded lead ${contact.name}` }];
  const res = await research(token, contact.id);
  if (res) steps.push({ step: "research", detail: "Enriched via contact-research" }); else steps.push({ step: "research", detail: "Skipped/none (used existing data)" });
  const voice = await loadVoice(sb, uid);
  steps.push({ step: "voice", detail: voice ? `Applied ${voice.name || "agent"}'s MyVoice` : "Used brokerage default voice" });
  const lead = [
    contact.name && `Name: ${contact.name}`, contact.type && `Type: ${contact.type}`, contact.company && `Company: ${contact.company}`,
    contact.profession && `Profession: ${contact.profession}`, (contact.home_city || contact.home_state) && `Area: ${[contact.home_city, contact.home_state].filter(Boolean).join(", ")}`,
    contact.email && `Email: ${contact.email}`, contact.phone && `Phone: ${contact.phone}`, contact.origin && `Source: ${contact.origin}${contact.origin_detail ? " / " + contact.origin_detail : ""}`,
    contact.notes && `Notes: ${String(contact.notes).slice(0, 800)}`,
  ].filter(Boolean).join("\n");
  const voiceBlock = voice ? `Write first_touch in this agent's voice (authoritative on tone/phrasing/sign-off):\n"""${voice.body}"""` : `Brokerage default voice: warm, plain language, lead with the answer, one concrete next step, never salesy or AI-sounding.`;
  const prompt = `You are a top real-estate agent's assistant preparing a FIRST-CONTACT plan for a NEW LEAD, ready to approve in one tap. Reply ONLY as JSON:
{
 "summary": "1-2 sentences: who this lead is and the recommended approach",
 "disc_hint": {"letter":"D|I|S|C|?","confidence":"low|medium|high","why":"one sentence tied to real signals; use ? if truly unknown"},
 "first_touch": {"channel":"email|text","subject":"(email only; empty for text)","body":"the actual message, ready to send, concise, human, one clear next step"},
 "cadence": [{"day_offset":0,"action":"Send first touch (email)","channel":"email"}, {"day_offset":2,"action":"...","channel":"text|call|email"} ]
}
Rules: 4-6 cadence steps over ~30 days, mixing channels and tapering; personalize using ONLY real details (never fabricate, never imply you researched them); first_touch must sound genuinely human and match the voice below.

LEAD:
${lead || "(sparse — keep the first touch light and curious)"}

RESEARCH:
${res || "none"}

${voiceBlock}`;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
  if (!r.ok) {
    // Surface the API failure instead of silently emitting a "Could not generate
    // a plan" placeholder that looks like a real (empty) result to the agent.
    const errText = await r.text().catch(() => "");
    throw new Error(`Anthropic API error ${r.status}: ${errText.slice(0, 200)}`);
  }
  const j = await r.json();
  try { await logAiUsage(sb, { userId: uid, fn: "orchestrate-new-lead", model: MODEL, usage: j?.usage, usedOwn: false }); } catch (_) {}
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let plan: any = {};
  try { const m = raw.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : raw); } catch (_) { plan = { summary: "Could not generate a plan.", cadence: [] }; }
  // Close the loop: every cadence ends with an explicit outcome decision (the watcher usually resolves this automatically first)
  if (!Array.isArray(plan.cadence)) plan.cadence = [];
  const lastDay = plan.cadence.reduce((m: number, st: any) => Math.max(m, Number(st.day_offset) || 0), 0);
  plan.cadence.push({ day_offset: lastDay + 3, action: `Decide ${contact.name}'s outcome \u2014 replied? respond & move to pipeline \u00B7 converted? open a deal \u00B7 no response? enroll in long-term nurture`, channel: "decision", is_outcome: true });
  steps.push({ step: "plan", detail: `Drafted first touch + ${plan.cadence.length}-step cadence ending in an outcome decision` });
  return { plan, steps };
}

async function runForContact(sb: any, uid: string, contact_id: string, token: string | null): Promise<string | null> {
  const { data: contact } = await sb.from("contacts").select("*").eq("id", contact_id).eq("user_id", uid).maybeSingle();
  if (!contact) return null;
  // skip if a prepared run already exists for this contact
  const { data: existing } = await sb.from("agent_runs").select("id").eq("user_id", uid).eq("agent", "new_lead").eq("target_id", contact_id).eq("status", "prepared").limit(1);
  if (existing?.[0]) return existing[0].id;
  const { plan, steps } = await planFor(sb, uid, contact, token);
  const { data: run } = await sb.from("agent_runs").insert({ user_id: uid, agent: "new_lead", target_type: "contact", target_id: contact_id, status: "prepared", summary: plan.summary || `First-contact plan for ${contact.name}`, steps, output: plan }).select("id").single();
  return run?.id || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await sb.auth.getUser(token);
    const body = await req.json().catch(() => ({}));

    if (user && body.contact_id) { const id = await runForContact(sb, user.id, body.contact_id, token); return J({ ok: true, run_id: id }); }

    // Sweep mode (cron/service-role): prep recently-created leads with no prepared run yet
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    const { data: pausedRows } = await sb.from("agent_controls").select("user_id").eq("paused", true);
    const paused = new Set((pausedRows || []).map((r: any) => r.user_id));
    let prepared = 0;
    for (const a of (agents || [])) {
      if (paused.has(a.auth_user_id)) continue;
      try {
        const uid = a.auth_user_id;
        const { data: leads } = await sb.from("contacts").select("id").eq("user_id", uid).ilike("type", "%lead%").gte("created_at", since).limit(10);
        for (const c of (leads || [])) { const id = await runForContact(sb, uid, c.id, null); if (id) prepared++; }
      } catch (_) {}
    }
    return J({ ok: true, prepared });
  } catch (e) { return J({ error: String(e) }, 500); }
});
