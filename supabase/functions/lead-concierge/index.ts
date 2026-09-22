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
    const { user_id, contact_id, lead_phone, lead_email, channel, email_context, source } = b;
    let { lead_name, inbound_text } = b;
    const isEmail = channel === "email";
    const leadHandle = isEmail ? lead_email : lead_phone;
    if (!user_id || !leadHandle) return new Response(JSON.stringify({ error: "user_id and a phone or email required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // respect the agent's on/off switch
    const { data: st } = await admin.from("lead_concierge_settings").select("enabled").eq("user_id", user_id).maybeSingle();
    if (st && st.enabled === false) return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { ...cors, "Content-Type": "application/json" } });

    // de-dupe: one pending concierge per lead handle per 12h
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const dupeCol = isEmail ? "lead_email" : "lead_phone";
    const { data: existing } = await admin.from("lead_concierge").select("id").eq("user_id", user_id).eq(dupeCol, leadHandle).eq("status", "pending").gte("created_at", since).limit(1);
    // realtor.com sends every buyer from the same leads@ address. Deduping on the
    // address alone would swallow the second buyer of the day; for a recognised
    // source the buyer's name is part of the identity.
    if (existing && existing.length && source && lead_name) {
      const { data: sameBuyer } = await admin.from("lead_concierge").select("id").eq("user_id", user_id)
        .eq(dupeCol, leadHandle).eq("status", "pending").ilike("lead_name", String(lead_name)).gte("created_at", since).limit(1);
      if (!sameBuyer || !sameBuyer.length) existing.length = 0;
    }
    if (existing && existing.length) return new Response(JSON.stringify({ ok: true, skipped: "already_pending" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const { voice, name } = await loadVoice(admin, user_id);
    const firstName = (lead_name || "").trim().split(/\s+/)[0] || null;

    // HOW TOP AGENTS ANSWER EACH KIND OF LEAD. A portal buyer has usually sent
    // the same inquiry to three agents and will talk to whoever answers first
    // and most usefully; a referral arrives warm and must thank the referrer; a
    // rental lead is a future buyer; a home-value request is a seller.
    const sourceLine = !source ? "" : ({
      "Referral": "This came from someone the agent already knows, about a friend or relative who needs help. Thank them warmly for thinking of the agent, and ask for the best way to reach the person they mentioned.",
      "Direct inquiry": "A new person wrote in about real estate. Answer what they actually asked before anything else.",
      "Rent.com / Apartments": "A RENTAL inquiry. Confirm the rental is available or offer comparable ones, propose a viewing time, and ask their move-in date. Renters today are buyers in a year or two — be generous.",
      "Home-value request": "A HOMEOWNER asking what their home is worth — a potential seller. Thank them, say you will prepare a proper market analysis rather than an online estimate, and ask one question about the home's condition or updates.",
    } as Record<string,string>)[source] || `A buyer lead from ${source}. They have very likely contacted several agents at once; speed and usefulness win. Mention the specific property if one is named, offer two concrete times to see it (today or tomorrow), and ask ONE qualifying question — whether they are pre-approved, or their timeline. Never say "thanks for reaching out".`;
    const channelLine = (sourceLine ? sourceLine + " " : "") + (isEmail
      ? `Write the agent's FIRST reply to a brand-new lead who EMAILED in. Warm, human, and helpful: greet them by first name if known, engage with what they asked, and move toward a conversation (offer to help, ask one easy question, or suggest a quick call). 2-5 sentences — an email, not a text, but still concise and personal. No signature (the app adds it). Return ONLY the email body text.`
      : `Write the agent's FIRST reply to a brand-new lead who TEXTED. 1-3 short sentences, like a real person texting. No subject line, no signature, no emojis unless the agent's voice uses them. Return ONLY the message text.`);

    const sys = (voice
      ? `You write ${isEmail ? "emails" : "text messages"} for ${name || "a real-estate agent"}, in their own voice, captured here and authoritative on tone, phrasing, and word choice:\n"""${voice}"""\n`
      : `You write ${isEmail ? "emails" : "text messages"} for ${name || "a real-estate agent"}. Voice: warm, human, plain, confident — never salesy, never AI-sounding.\n`) + channelLine;

    const usr = (firstName ? `The lead's name is ${firstName}. ` : "The lead's name is unknown. ") +
      (inbound_text ? `They just ${isEmail ? "emailed" : "texted"}: "${String(inbound_text).slice(0, 600)}"` : `They just reached out (no message). Reach out proactively.`);

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

    // reply subject for the email path ("Re: ..." off the lead's subject)
    let draftSubject: string | null = null;
    if (isEmail) {
      const s = (email_context && email_context.subject) || "";
      draftSubject = s ? (/^re:/i.test(s) ? s : "Re: " + s) : (firstName ? `Hi ${firstName} — following up` : "Thanks for reaching out");
    }

    const { data: row, error } = await admin.from("lead_concierge").insert({
      user_id, contact_id: contact_id || null, lead_name: lead_name || null,
      lead_phone: isEmail ? null : lead_phone, lead_email: isEmail ? lead_email : null,
      channel: channel || "sms", inbound_text: inbound_text || null,
      draft, draft_subject: draftSubject, email_context: email_context || null, status: "pending",
      source: source || null,
    }).select("id").single();
    // Two mailboxes can receive one thread and race to card it in the same
    // second; the unique index lc_one_pending_per_person lets exactly one win.
    // Losing that race is the correct outcome, not a failure.
    if (error && (error as any).code === "23505") return new Response(JSON.stringify({ ok: true, skipped: "already_pending" }), { headers: { ...cors, "Content-Type": "application/json" } });
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
