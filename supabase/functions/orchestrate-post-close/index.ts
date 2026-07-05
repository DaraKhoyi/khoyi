import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";

async function loadVoice(sb: any, uid: string): Promise<any> {
  try { const { data } = await sb.from("voice_cards").select("body,name").eq("user_id", uid).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1); return data?.[0] || null; } catch (_) { return null; }
}

async function planFor(sb: any, uid: string, deal: any, clientName: string): Promise<any> {
  const steps: any[] = [{ step: "context", detail: `Loaded closed deal: ${clientName || deal.address || deal.id}` }];
  const voice = await loadVoice(sb, uid);
  steps.push({ step: "voice", detail: voice ? `Applied ${voice.name || "agent"}'s MyVoice` : "Used brokerage default voice" });
  const info = [
    clientName && `Client: ${clientName}`, deal.address && `Property: ${deal.address}`, deal.side && `Side: ${deal.side}`,
    deal.sale_price && `Sale price: $${Number(deal.sale_price).toLocaleString()}`, deal.close_date && `Closed: ${deal.close_date}`,
    deal.notes && `Notes: ${String(deal.notes).slice(0, 600)}`,
  ].filter(Boolean).join("\n");
  const voiceBlock = voice ? `Write messages in this agent's voice (authoritative on tone/phrasing/sign-off):\n"""${voice.body}"""` : `Brokerage default voice: warm, genuine, plain language, never salesy or AI-sounding.`;
  const prompt = `You are a top real-estate agent's assistant preparing a POST-CLOSE plan for a deal that just closed. Goal: strengthen the relationship, earn a review + referral at the right moment, and set up long-term nurture. Reply ONLY as JSON:
{
 "summary": "1-2 sentences: the close and the recommended follow-through",
 "first_touch": {"channel":"email","subject":"...","body":"a warm, genuine thank-you to send right after close, in the agent's voice"},
 "cadence": [
   {"day_offset":0,"action":"Send thank-you","channel":"email"},
   {"day_offset":6,"action":"Ask for a review + referral","channel":"email","body":"a natural, low-pressure review + referral request in the agent's voice"},
   {"day_offset":30,"action":"30-day settle-in check","channel":"text"},
   {"day_offset":180,"action":"6-month check-in","channel":"call"},
   {"day_offset":365,"action":"1-year home anniversary note + market update","channel":"email","body":"a warm anniversary note in the agent's voice"}
 ]
}
Rules: personalize using ONLY real details; never fabricate; the thank-you and review ask must sound genuinely human and match the voice; NEVER ask for the review in the same message as the thank-you.

DEAL:
${info || "(sparse — keep it warm and simple)"}

${voiceBlock}`;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2200, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json();
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let plan: any = {};
  try { const m = raw.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : raw); } catch (_) { plan = { summary: "Could not generate a plan.", cadence: [] }; }
  if (!Array.isArray(plan.cadence)) plan.cadence = [];
  plan.deal_id = deal.id; plan.client_name = clientName; plan.address = deal.address;
  steps.push({ step: "plan", detail: `Drafted thank-you + review ask + ${plan.cadence.length}-step post-close cadence` });
  return { plan, steps };
}

async function runForDeal(sb: any, uid: string, deal_id: string): Promise<string | null> {
  const { data: deal } = await sb.from("deals").select("*").eq("id", deal_id).eq("user_id", uid).maybeSingle();
  if (!deal) return null;
  const { data: dup } = await sb.from("agent_runs").select("id").eq("user_id", uid).eq("agent", "post_close").eq("output->>deal_id", deal_id).limit(1);
  if (dup?.[0]) return dup[0].id;
  let clientName = deal.client_name || "";
  if (!clientName && deal.primary_client_id) { const { data: c } = await sb.from("contacts").select("name").eq("id", deal.primary_client_id).maybeSingle(); clientName = c?.name || ""; }
  const { plan, steps } = await planFor(sb, uid, deal, clientName);
  const { data: run } = await sb.from("agent_runs").insert({ user_id: uid, agent: "post_close", target_type: "deal", target_id: deal.primary_client_id || null, status: "prepared", summary: plan.summary || `Post-close plan for ${clientName || deal.address}`, steps, output: plan }).select("id").single();
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
    if (user && body.deal_id) { const id = await runForDeal(sb, user.id, body.deal_id); return J({ ok: true, run_id: id }); }
    // Sweep: recently closed deals with no post-close run yet
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    const { data: pausedRows } = await sb.from("agent_controls").select("user_id").eq("paused", true);
    const paused = new Set((pausedRows || []).map((r: any) => r.user_id));
    let prepared = 0;
    for (const a of (agents || [])) {
      if (paused.has(a.auth_user_id)) continue;
      try { const uid = a.auth_user_id; const { data: deals } = await sb.from("deals").select("id").eq("user_id", uid).eq("status", "closed").gte("close_date", since).limit(15);
        for (const d of (deals || [])) { const id = await runForDeal(sb, uid, d.id); if (id) prepared++; }
      } catch (_) {}
    }
    return J({ ok: true, prepared });
  } catch (e) { return J({ error: String(e) }, 500); }
});
