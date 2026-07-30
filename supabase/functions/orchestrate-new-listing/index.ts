import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";
const LISTING_SIDES = ["listing"];

async function loadVoice(sb: any, uid: string): Promise<any> {
  try { const { data } = await sb.from("voice_cards").select("body,name").eq("user_id", uid).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1); return data?.[0] || null; } catch (_) { return null; }
}

async function planFor(sb: any, uid: string, deal: any): Promise<any> {
  const addr = deal.address || deal.name || "the listing";
  const steps: any[] = [{ step: "context", detail: `Loaded new listing: ${addr}` }];
  const voice = await loadVoice(sb, uid);
  steps.push({ step: "voice", detail: voice ? `Applied ${voice.name || "agent"}'s MyVoice` : "Used brokerage default voice" });
  const info = [
    deal.address && `Address: ${deal.address}`, deal.client_name && `Seller: ${deal.client_name}`,
    deal.list_price && `List price: $${Number(deal.list_price).toLocaleString()}`, deal.target_price && `Target price: $${Number(deal.target_price).toLocaleString()}`,
    deal.list_date && `List date: ${deal.list_date}`, deal.notes && `Notes: ${String(deal.notes).slice(0, 700)}`,
  ].filter(Boolean).join("\n");
  const voiceBlock = voice ? `Write the description and announcement in this agent's voice (authoritative on tone/phrasing/sign-off):\n"""${voice.body}"""` : `Brokerage default voice: warm, savvy, plain language, never salesy or AI-sounding.`;
  const prompt = `You are a top listing agent's assistant preparing a NEW-LISTING launch plan, ready to approve in one tap. Reply ONLY as JSON:
{
 "summary": "1-2 sentences: the listing and the recommended launch approach",
 "listing_description": "a compelling, accurate MLS/marketing description in the agent's voice — highlight only real features you were given; do NOT invent specifics",
 "pricing_note": "a short pricing/positioning approach; if comps matter, say to pull live comparables from the MLS — NEVER invent comp prices or addresses",
 "first_touch": {"channel":"email","subject":"Just Listed: <short address>","body":"a just-listed announcement to the agent's sphere, in the agent's voice"},
 "cadence": [
   {"day_offset":0,"action":"Confirm listing agreement + gather remaining property details","channel":"task"},
   {"day_offset":1,"action":"Book professional photos (+ staging if it helps)","channel":"task"},
   {"day_offset":2,"action":"Pull live MLS comps + finalize the price","channel":"task"},
   {"day_offset":3,"action":"Enter the MLS listing (description ready)","channel":"task","body":"<put the listing_description here>"},
   {"day_offset":3,"action":"Send the just-listed announcement to your sphere","channel":"email","body":"<put the first_touch body here>"},
   {"day_offset":4,"action":"Post just-listed on social","channel":"social"},
   {"day_offset":6,"action":"Broker/agent preview","channel":"task"},
   {"day_offset":8,"action":"Host the first open house","channel":"task"},
   {"day_offset":12,"action":"Follow up with open-house + online leads; review feedback/pricing","channel":"task"}
 ]
}
Rules: personalize using ONLY real details given; never fabricate features, comps, or numbers; the description and announcement must sound genuinely human and match the voice.

LISTING:
${info || "(sparse — keep it clean and note details to gather)"}

${voiceBlock}`;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2600, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json();
  try { await logAiUsage(sb, { userId: uid, fn: "orchestrate-new-listing", model: MODEL, usage: j?.usage, usedOwn: false }); } catch (_) {}
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let plan: any = {};
  try { const m = raw.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : raw); } catch (_) { plan = { summary: "Could not generate a plan.", cadence: [] }; }
  if (!Array.isArray(plan.cadence)) plan.cadence = [];
  plan.deal_id = deal.id; plan.address = addr;
  steps.push({ step: "plan", detail: `Drafted MLS description + just-listed announcement + ${plan.cadence.length}-step launch checklist` });
  return { plan, steps };
}

async function runForDeal(sb: any, uid: string, deal_id: string): Promise<string | null> {
  const { data: deal } = await sb.from("deals").select("*").eq("id", deal_id).eq("user_id", uid).maybeSingle();
  if (!deal) return null;
  const { data: dup } = await sb.from("agent_runs").select("id").eq("user_id", uid).eq("agent", "new_listing").eq("output->>deal_id", deal_id).limit(1);
  if (dup?.[0]) return dup[0].id;
  const { plan, steps } = await planFor(sb, uid, deal);
  const { data: run } = await sb.from("agent_runs").insert({ user_id: uid, agent: "new_listing", target_type: "deal", target_id: deal.primary_client_id || null, status: "prepared", summary: plan.summary || `Launch plan for ${plan.address}`, steps, output: plan }).select("id").single();
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
    // Sweep: recently listed, active listing-side deals with no launch plan yet
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const { data: agents } = await sb.from("agents").select("auth_user_id").not("auth_user_id", "is", null);
    const { data: pausedRows } = await sb.from("agent_controls").select("user_id").eq("paused", true);
    const paused = new Set((pausedRows || []).map((r: any) => r.user_id));
    let prepared = 0;
    for (const a of (agents || [])) {
      if (paused.has(a.auth_user_id)) continue;
      try { const uid = a.auth_user_id;
        const { data: deals } = await sb.from("deals").select("id,side,status").eq("user_id", uid).in("side", LISTING_SIDES).gte("list_date", since).limit(15);
        for (const d of (deals || [])) { if (["closed", "lost", "withdrawn", "cancelled", "sold"].includes(String(d.status || "").toLowerCase())) continue; const id = await runForDeal(sb, uid, d.id); if (id) prepared++; }
      } catch (_) {}
    }
    return J({ ok: true, prepared });
  } catch (e) { return J({ error: String(e) }, 500); }
});
