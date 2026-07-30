import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";

async function loadVoice(sb: any, uid: string): Promise<any> {
  try { const { data } = await sb.from("voice_cards").select("body,name").eq("user_id", uid).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1); return data?.[0] || null; } catch (_) { return null; }
}

async function planFor(sb: any, uid: string, deal: any, sellerName: string): Promise<any> {
  const addr = deal.address || deal.name || "the property";
  const steps: any[] = [{ step: "context", detail: `Loaded listing opportunity: ${addr}` }];
  const voice = await loadVoice(sb, uid);
  steps.push({ step: "voice", detail: voice ? `Applied ${voice.name || "agent"}'s MyVoice` : "Used brokerage default voice" });
  const info = [
    deal.address && `Property: ${deal.address}`, sellerName && `Seller: ${sellerName}`,
    deal.target_price && `Seller's price expectation: $${Number(deal.target_price).toLocaleString()}`, deal.list_price && `Anticipated list: $${Number(deal.list_price).toLocaleString()}`,
    deal.notes && `Notes: ${String(deal.notes).slice(0, 700)}`,
  ].filter(Boolean).join("\n");
  const voiceBlock = voice ? `Write the seller-facing pieces in this agent's voice (authoritative on tone/phrasing/sign-off):\n"""${voice.body}"""` : `Brokerage default voice: warm, savvy, confident, plain language, never salesy or AI-sounding.`;
  const prompt = `You are a top listing agent's assistant preparing everything needed to WIN a LISTING PRESENTATION (the pitch to a homeowner to earn their listing). The marketing plan is the centerpiece — it justifies the commission and separates this agent from discount brokerages. Reply ONLY as JSON:
{
 "summary": "1-2 sentences: the opportunity and how to win it",
 "marketing_plan": "a compelling, specific, seller-facing MARKETING PLAN for THIS property: professional photography/video, MLS + portal syndication reach, targeted social + digital ads, open houses, the brokerage/agent network, email to the agent's sphere, and a single-property web presence. Tailor it to the property; make the seller feel their home will be marketed better here than anywhere else. Do not invent property features you weren't given.",
 "pricing_note": "a pricing/CMA approach to present; if comps matter, say to pull live comparables from the MLS — NEVER invent comp prices or addresses",
 "why_me": "2-4 crisp, confident 'why me' talking points in the agent's voice",
 "first_touch": {"channel":"email","subject":"...","body":"a warm pre-appointment message to the seller — confirm the meeting, set expectations, build rapport, in the agent's voice"},
 "cadence": [
   {"day_offset":0,"action":"Pull live comps + build the CMA","channel":"task"},
   {"day_offset":0,"action":"Prepare the pre-listing package + marketing plan to present","channel":"task","body":"<put the marketing_plan here>"},
   {"day_offset":1,"action":"Deliver the listing presentation","channel":"task"},
   {"day_offset":2,"action":"Send thank-you + recap + address any objections","channel":"email","body":"<a warm follow-up in the agent's voice>"},
   {"day_offset":4,"action":"Follow up on their decision","channel":"call"},
   {"day_offset":8,"action":"Final check-in / handle remaining objections","channel":"task"}
 ]
}
Rules: personalize using ONLY real details given; never fabricate features, comps, or numbers; seller-facing pieces must sound genuinely human and match the voice.

LISTING OPPORTUNITY:
${info || "(sparse — keep it clean and note details to gather at the appointment)"}

${voiceBlock}`;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2800, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json();
  try { await logAiUsage(sb, { userId: uid, fn: "orchestrate-listing-presentation", model: MODEL, usage: j?.usage, usedOwn: false }); } catch (_) {}
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let plan: any = {};
  try { const m = raw.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : raw); } catch (_) { plan = { summary: "Could not generate a plan.", cadence: [] }; }
  if (!Array.isArray(plan.cadence)) plan.cadence = [];
  plan.deal_id = deal.id; plan.address = addr;
  steps.push({ step: "plan", detail: `Drafted marketing plan + why-me + pre-appointment note + ${plan.cadence.length}-step presentation checklist` });
  return { plan, steps };
}

async function runForDeal(sb: any, uid: string, deal_id: string): Promise<string | null> {
  const { data: deal } = await sb.from("deals").select("*").eq("id", deal_id).eq("user_id", uid).maybeSingle();
  if (!deal) return null;
  const { data: dup } = await sb.from("agent_runs").select("id").eq("user_id", uid).eq("agent", "listing_presentation").eq("output->>deal_id", deal_id).limit(1);
  if (dup?.[0]) return dup[0].id;
  let sellerName = deal.client_name || "";
  if (!sellerName && deal.primary_client_id) { const { data: c } = await sb.from("contacts").select("name").eq("id", deal.primary_client_id).maybeSingle(); sellerName = c?.name || ""; }
  const { plan, steps } = await planFor(sb, uid, deal, sellerName);
  const { data: run } = await sb.from("agent_runs").insert({ user_id: uid, agent: "listing_presentation", target_type: "deal", target_id: deal.primary_client_id || null, status: "prepared", summary: plan.summary || `Listing presentation for ${plan.address}`, steps, output: plan }).select("id").single();
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
    // Sweep: listing-side deals still at the "lead" stage (opportunities being pitched) with no presentation prepped
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    const { data: pausedRows } = await sb.from("agent_controls").select("user_id").eq("paused", true);
    const paused = new Set((pausedRows || []).map((r: any) => r.user_id));
    let prepared = 0;
    for (const a of (agents || [])) {
      if (paused.has(a.auth_user_id)) continue;
      try { const uid = a.auth_user_id;
        const { data: deals } = await sb.from("deals").select("id").eq("user_id", uid).eq("side", "listing").eq("status", "lead").limit(15);
        for (const d of (deals || [])) { const id = await runForDeal(sb, uid, d.id); if (id) prepared++; }
      } catch (_) {}
    }
    return J({ ok: true, prepared });
  } catch (e) { return J({ error: String(e) }, 500); }
});
