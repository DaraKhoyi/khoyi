// lead-concierge — the 5-minute rule, automated. When a new lead reaches out
// (inbound text, missed call), draft a warm, personalized FIRST reply in the
// agent's own voice, stash it, and push the agent to send it with one tap. Speed
// to lead is the single biggest lever in real estate — 21x more likely to convert
// inside 5 minutes, and 78% of buyers go with whoever answers first.
//
// Called service-role from quo-webhook on a new inbound. Body:
//   { user_id, contact_id?, lead_name?, lead_phone, channel, inbound_text? }
// -> creates a lead_concierge row (with draft) and pushes the agent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MODEL = "claude-sonnet-4-6";

async function loadVoice(admin: any, userId: string) {
  const [{ data: vc }, { data: ag }] = await Promise.all([
    admin.from("voice_cards").select("body").eq("user_id", userId).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1),
    admin.from("agents").select("name").eq("user_id", userId).maybeSingle(),
  ]);
  return { voice: (vc && vc[0] && vc[0].body) || null, name: (ag && ag.name) || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json();
    const { user_id, contact_id, lead_phone, channel } = b;
    let { lead_name, inbound_text } = b;
    if (!user_id || !lead_phone) return new Response(JSON.stringify({ error: "user_id and lead_phone required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // respect the agent's on/off switch
    const { data: st } = await admin.from("lead_concierge_settings").select("enabled").eq("user_id", user_id).maybeSingle();
    if (st && st.enabled === false) return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { ...cors, "Content-Type": "application/json" } });

    // de-dupe: if we already have a pending concierge for this phone today, don't double up
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data: existing } = await admin.from("lead_concierge").select("id").eq("user_id", user_id).eq("lead_phone", lead_phone).eq("status", "pending").gte("created_at", since).limit(1);
    if (existing && existing.length) return new Response(JSON.stringify({ ok: true, skipped: "already_pending" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const { voice, name } = await loadVoice(admin, user_id);
    const firstName = (lead_name || "").trim().split(/\s+/)[0] || null;

    const sys = (voice
      ? `You write text messages for ${name || "a real-estate agent"}, in their own voice, captured here and authoritative on tone, phrasing, and word choice:\n"""${voice}"""\n`
      : `You write text messages for ${name || "a real-estate agent"}. Voice: warm, human, plain, confident — never salesy, never AI-sounding.\n`) +
      `Write the agent's FIRST reply to a brand-new lead. Goals, in order: acknowledge them warmly by first name if known, answer or engage with what they asked, and move toward a conversation (offer to help, ask one easy question, or suggest a quick call). Keep it to 1-3 short sentences, like a real person texting. No subject line, no signature, no emojis unless the agent's voice uses them. Return ONLY the message text.`;

    const usr = (firstName ? `The lead's name is ${firstName}. ` : "The lead's name is unknown. ") +
      (inbound_text ? `They just texted: "${String(inbound_text).slice(0, 400)}"` : `They just called and missed you (no message). Reach out proactively.`);

    let draft = firstName ? `Hi ${firstName}! Thanks for reaching out — happy to help. What can I tell you?` : `Hi there! Thanks for reaching out — happy to help. What can I tell you?`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 300, system: sys, messages: [{ role: "user", content: usr }] }),
      });
      const data = await r.json();
      const t = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
      if (t) draft = t.replace(/^["']|["']$/g, "");
      try { await logAiUsage(admin, { userId: user_id, fn: "lead-concierge", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}
    } catch (_) { /* keep the safe fallback draft */ }

    const { data: row, error } = await admin.from("lead_concierge").insert({
      user_id, contact_id: contact_id || null, lead_name: lead_name || null, lead_phone,
      channel: channel || "sms", inbound_text: inbound_text || null, draft, status: "pending",
    }).select("id").single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    // push the agent — this IS the speed-to-lead moment
    try {
      await admin.functions.invoke("push-send", { body: {
        user_id,
        title: firstName ? `New lead: ${firstName} — reply ready` : "New lead — reply ready",
        body: draft.slice(0, 120),
        url: "https://darasapp.com/?concierge=" + row.id,
        tag: "concierge",
      } });
    } catch (_) { /* push best-effort */ }

    return new Response(JSON.stringify({ ok: true, id: row.id, draft }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
