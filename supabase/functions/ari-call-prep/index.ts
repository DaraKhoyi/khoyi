// ari-call-prep
// Returns a tight, ready-to-use prep brief for reaching out to one contact:
// who they are, how to communicate given their DISC style, recent history,
// live deal context, an opener, talking points, and a clear next step.

import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model (30 Sep)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
function roleOf(tok: string): string | null { try { const seg = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(seg + "===".slice((seg.length + 3) % 4))).role || null; } catch { return null; } }
const DISC_LABEL: Record<string, string> = {
  D: "Driver — direct, fast, results-focused. Be brief, lead with the bottom line, give them control.",
  I: "Influencer — sociable, enthusiastic, big-picture. Be warm, personable, paint the vision, keep energy up.",
  S: "Steady — patient, loyal, relationship-first. Be unhurried, reassuring, personal; no pressure.",
  C: "Conscientious — precise, analytical, cautious. Be accurate, specific, provide data and details, no hype.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const body = await req.json().catch(() => ({}));
    let uid: string;
    if ((token === SERVICE || roleOf(token) === "service_role") && body.user_id) {
      uid = body.user_id;
    } else {
      const authClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
      const { data } = await authClient.auth.getUser(token);
      if (!data?.user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      uid = data.user.id;
    }
    const contactId = body.contact_id;
    if (!contactId) return new Response(JSON.stringify({ error: "contact_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const db = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await db.from("contacts").select("*").eq("id", contactId).eq("user_id", uid).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    // DISC
    const { data: disc } = await db.from("disc_evidence").select("signals_d,signals_i,signals_s,signals_c,weight").eq("contact_id", contactId);
    const agg: any = { D: 0, I: 0, S: 0, C: 0 };
    (disc || []).forEach((e: any) => { const w = Number(e.weight) || 1; agg.D += (e.signals_d || 0) * w; agg.I += (e.signals_i || 0) * w; agg.S += (e.signals_s || 0) * w; agg.C += (e.signals_c || 0) * w; });
    let discLetter: string | null = null;
    const top = Object.entries(agg).sort((a: any, b: any) => b[1] - a[1])[0];
    if (top && (top[1] as number) > 0) discLetter = top[0];

    // recent interactions
    const { data: ix } = await db.from("contact_interactions").select("channel,direction,occurred_at,brief,body,kind").eq("contact_id", contactId).order("occurred_at", { ascending: false }).limit(5);
    // last inbound email
    let lastEmail: any = null;
    if (c.email) {
      const { data: em } = await db.from("email_messages").select("subject,snippet,body_text,internal_date,direction").ilike("from_address", `%${c.email}%`).order("internal_date", { ascending: false }).limit(1);
      lastEmail = em && em[0];
    }
    // active deals
    const { data: deals } = await db.from("deals").select("name,client_name,address,status,list_price,sale_price,target_price,list_date,contract_date,close_date,opened_date,side")
      .eq("user_id", uid).or(`primary_client_id.eq.${contactId},client_name.ilike.%${(c.name || "").replace(/[%,]/g, "")}%`).limit(5);
    const activeDeals = (deals || []).filter((d: any) => !["closed", "won", "lost", "dead", "cancelled", "archived"].includes(String(d.status || "").toLowerCase()));
    // propensity
    const { data: sc } = await db.from("contact_scores").select("score,tier,factors").eq("contact_id", contactId).maybeSingle();
    // voice
    const { data: vcs } = await db.from("voice_cards").select("persona_summary,name").eq("user_id", uid).eq("is_active", true).limit(1);
    const voice = vcs && vcs[0];

    const daysSince = (d: string | null) => d == null ? null : Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
    const facts: string[] = [];
    facts.push(`Name: ${c.name}${c.company ? ` (${c.company})` : ""}${c.role ? `, ${c.role}` : ""}${c.profession ? ` — ${c.profession}` : ""}`);
    if (c.type) facts.push(`Relationship: ${c.type}${c.status ? `, status ${c.status}` : ""}${c.priority ? `, ${c.priority} priority` : ""}`);
    if ((c.tags || []).length) facts.push(`Tags: ${(c.tags || []).join(", ")}`);
    if (c.home_ownership || c.home_purchase_year) facts.push(`Home: ${c.home_ownership || "?"}${c.home_purchase_year ? `, bought ${c.home_purchase_year}` : ""}${c.home_city ? `, ${c.home_city}` : ""}`);
    facts.push(`Last contact: ${daysSince(c.last_contact_at) == null ? "none logged" : daysSince(c.last_contact_at) + " days ago"}; last inbound: ${daysSince(c.last_inbound_at) == null ? "none" : daysSince(c.last_inbound_at) + " days ago"}`);
    if (c.notes) facts.push(`Notes: ${String(c.notes).slice(0, 400)}`);
    if (sc) facts.push(`Propensity-to-transact score: ${sc.score}/100 (${sc.tier})${sc.factors ? ` — drivers: ${Object.keys(sc.factors).join(", ")}` : ""}`);
    if (lastEmail) facts.push(`Most recent email (${lastEmail.direction || "?"}): "${String(lastEmail.snippet || lastEmail.body_text || "").replace(/\r/g, "").slice(0, 400)}"`);
    if ((ix || []).length) facts.push("Recent interactions: " + (ix || []).map((i: any) => `${i.direction || ""} ${i.channel || ""} ${daysSince(i.occurred_at)}d ago${i.brief ? `: ${String(i.brief).slice(0, 80)}` : ""}`).join(" | "));
    const dealText = activeDeals.length
      ? activeDeals.map((d: any) => `${d.name || d.address || d.client_name || "deal"} — status ${d.status || "?"}${d.address ? `, ${d.address}` : ""}${d.list_price ? `, list $${Number(d.list_price).toLocaleString()}` : ""}${d.close_date ? `, closing ${d.close_date}` : d.contract_date ? `, under contract ${d.contract_date}` : ""}`).join(" ; ")
      : "No active deal on file.";

    const sys = "You are Ari, an AI partner prepping a real estate agent for a live call or text. Produce a tight, practical prep brief the agent can glance at while dialing. " +
      "Be specific to THIS contact and their data — never generic. Adapt the approach to their behavioral style. Respond ONLY with compact JSON, no markdown, no preamble. " +
      'Schema: {"who":"one sentence on who they are and why they matter right now","communicate":"one or two sentences on HOW to talk to them given their style","opener":"a natural first line the agent can say","talking_points":["2 to 4 short bullets, specific to their situation/deal"],"next_step":"the one concrete outcome to aim for on this call"}';
    const user = `${voice ? `Agent voice: ${voice.persona_summary || voice.name}\n` : ""}Behavioral style: ${discLetter ? `${discLetter} — ${DISC_LABEL[discLetter]}` : "unknown (use balanced, warm-but-efficient approach)"}\n\nContact dossier:\n- ${facts.join("\n- ")}\n\nLive deal context: ${dealText}\n\nWrite the prep brief now.`;

    let prep: any = null;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 700, system: sys, messages: [{ role: "user", content: user }] }),
      });
      if (r.ok) {
        const j = await r.json();
        await logAiUsage(db, { userId: uid, fn: "ari-call-prep", model: MODEL, usage: j?.usage, usedOwn: false, subjectType: "contact", subjectId: contactId });
        const txt = (j.content || []).map((b: any) => b.text || "").join("").trim().replace(/^```json/i, "").replace(/```$/, "").trim();
        prep = JSON.parse(txt);
      }
    } catch (_e) { /* fall through */ }

    const phone = c.phone || (Array.isArray(c.phones) && c.phones[0] && (c.phones[0].number || c.phones[0].value || c.phones[0])) || null;
    return new Response(JSON.stringify({
      prep,
      contact: { id: c.id, name: c.name, phone, email: c.email || null, company: c.company || null },
      disc: discLetter ? { letter: discLetter, label: DISC_LABEL[discLetter] } : null,
      score: sc || null,
      deal: dealText,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
