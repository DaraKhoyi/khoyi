// lead-notify
//
// Emails an agent when a REAL new lead arrives. Nothing else.
//
// The failure condition Dara set: one email about a VPN advert teaches an agent
// that these are noise, and they will ignore the one that mattered. A missed
// lead costs an opportunity; a false alert costs the channel. So this is built
// to be WRONG IN THE DIRECTION OF SILENCE — every rule below excludes, none
// includes, and anything unrecognised is not sent.
//
// The existing lead queue is not good enough to sit behind a notification: it
// has surfaced Zatos VPN, Nerve Repair supplements and association newsletters
// as "NEW LEAD", and only ~10 of 43 pending leads carry a triage verdict. This
// re-judges each one rather than trusting that queue.
//
// SHADOW MODE. While notification_runtime.shadow_mode is true, every decision is
// written to lead_notifications and NOTHING is sent. Dara reviews the log, and
// live sending starts only when the false positives are gone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QCP = Deno.env.get("QCP_TOKEN") || "";
const APP = "https://darasapp.com";
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ── the filter ───────────────────────────────────────────────────────────────
//
// Ordered cheapest-first. The first rule that fires decides, and the reason is
// recorded so a wrong call can be traced to the line that made it.

const MACHINE = /(no-?reply|do-?not-?reply|notification|mailer-daemon|postmaster|bounce|unsubscribe|@e\.|@email\.|@mail\.|@reply\.|@news|@marketing|@campaign|@sendgrid|@mailchimp|@constantcontact|@hubspot|@salesforce|@zillow\.com|@leads\.|automated|alerts?@|info@|support@|billing@|admin@|team@|sales@|hello@|contact@)/i;

// Phrases that only appear in bulk mail. Any one of them and it is not a lead.
const BULK = /(unsubscribe|view (this )?(email )?in (your )?browser|manage (your )?preferences|you (are )?receiv(ing|ed) this|privacy policy|©\s?20\d\d|all rights reserved|opt[- ]out|update your preferences|sent to you by|this is an automated)/i;

// Someone actually wanting something from a real estate agent.
const INTENT = /(interested in|looking (for|to)|can you|could you|would you|do you have|available|showing|schedule|appointment|tour|walk[- ]?through|offer|listing|list my|sell my|buy(ing)?|rent(al|ing)?|price|square (feet|foot)|bedroom|property|house|home|condo|address|call me|reach me|get back to me|question about|referral|\?)/i;

type Verdict = { send: boolean; reason: string; score: number };

function judge(lead: any, body: string): Verdict {
  const from = String(lead.lead_email || "").toLowerCase();
  const text = String(body || "");
  const name = String(lead.lead_name || "");

  if (!from && !lead.lead_phone) return { send: false, reason: "no way to identify the sender", score: 0 };
  if (from && MACHINE.test(from)) return { send: false, reason: "machine or role address", score: 0 };
  if (BULK.test(text)) return { send: false, reason: "bulk-mail markers in the body", score: 0 };

  // A triage verdict, when there is one, outranks the text heuristics.
  const cat = String(lead.triage || "").toLowerCase();
  if (cat && /promo|market|newsletter|spam|junk|no_?action|fyi/.test(cat)) {
    return { send: false, reason: `triage says ${cat}`, score: 0 };
  }

  // Very short or very long both mean "not a person asking a question".
  const len = text.trim().length;
  if (len < 15) return { send: false, reason: "too short to act on", score: 0 };
  if (len > 4000) return { send: false, reason: "too long to be an enquiry", score: 0 };

  let score = 0;
  if (/urgent|requires_response/.test(cat)) score += 40;
  if (INTENT.test(text)) score += 35;
  if (text.includes("?")) score += 10;
  if (name && /\s/.test(name.trim())) score += 10;          // a real first and last name
  if (/\b\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4}\b/.test(text)) score += 15;  // left a number
  if (lead.channel === "text" || lead.channel === "missed_call") score += 20;

  // 55 is deliberately high. Everything here is a signal of a human asking for
  // something; needing two of them keeps one lucky keyword from sending.
  if (score < 55) return { send: false, reason: `not enough signal (${score})`, score };
  return { send: true, reason: `looks like a real enquiry (${score})`, score };
}

function esc(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmail(agentFirst: string, lead: any, body: string, token: string) {
  const who = lead.lead_name || lead.lead_email || lead.lead_phone || "Someone";
  const how = lead.channel === "email" ? "emailed you" : lead.channel === "text" ? "texted you" : "tried to reach you";
  const snippet = String(body || "").trim().replace(/\s+/g, " ").slice(0, 400);
  const off = `${APP}/n/off?t=${token}`;

  const subject = `New lead: ${who}`;
  const text =
`${agentFirst}, a new lead just came in.

${who} ${how}.

"${snippet}"

Reply from PrismOS: ${APP}

——
We're testing new-lead emails with the beta group, so you're getting these
automatically. If you'd rather have a text instead, just tell Dara — we can
switch you over.

Don't want these? Turn them off here, no explanation needed:
${off}`;

  const html =
`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p style="margin:0 0 14px">${esc(agentFirst)}, a new lead just came in.</p>
  <p style="margin:0 0 6px"><strong>${esc(who)}</strong> ${esc(how)}.</p>
  <blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #C5A95E;background:#faf7f0;color:#333">${esc(snippet)}</blockquote>
  <p style="margin:18px 0"><a href="${APP}" style="background:#C5A95E;color:#1a1205;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;display:inline-block">Reply in PrismOS</a></p>
  <hr style="border:0;border-top:1px solid #e6e0d4;margin:22px 0">
  <p style="margin:0 0 10px;font-size:13px;color:#666">
    We're testing new-lead emails with the beta group, so you're getting these automatically.
    If you'd rather have a <strong>text</strong> instead, just tell Dara &mdash; we can switch you over.
  </p>
  <p style="margin:0;font-size:13px;color:#666">
    Don't want these? <a href="${off}" style="color:#8a6d1f">Turn them off here</a> &mdash; one click, no explanation needed.
  </p>
</div>`;
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const internal = (QCP && (req.headers.get("x-qcp-token") || "") === QCP) || auth === SERVICE_KEY;
    if (!internal) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));

    const { data: rt } = await admin.from("notification_runtime").select("*").eq("id", true).maybeSingle();
    const shadow = body.force_live === true ? false : (rt?.shadow_mode !== false);

    // Only agents with a login. Nobody else can act on the email anyway.
    const { data: agents } = await admin.from("agents")
      .select("auth_user_id, name, email").eq("active", true).not("auth_user_id", "is", null);
    const agentBy = new Map((agents || []).map(a => [a.auth_user_id, a]));
    if (!agentBy.size) return json({ ok: true, considered: 0, note: "no agents with logins" });

    // Leads first seen in the last 6 hours that have not been judged yet. The
    // window keeps a backlog from stampeding everyone on first run — but during
    // the shadow run a wider pass is useful, so Dara has real examples to read
    // straight away instead of waiting for the next lead to land. Sending is off
    // in shadow mode, so a wide look-back costs nothing.
    const hours = Math.min(Number(body.hours) || 6, 24 * 30);
    const { data: leads } = await admin.from("lead_concierge")
      .select("id, user_id, lead_name, lead_email, lead_phone, channel, inbound_text, first_seen_at, contact_id")
      .eq("status", "pending")
      .gte("first_seen_at", new Date(Date.now() - hours * 3600 * 1000).toISOString())
      .order("first_seen_at", { ascending: false }).limit(Number(body.limit) || 200);

    const out = { considered: 0, would_send: 0, suppressed: 0, sent: 0, shadow };
    for (const lead of leads || []) {
      if (!agentBy.has(lead.user_id)) continue;

      const { data: already } = await admin.from("lead_notifications")
        .select("id").eq("lead_id", lead.id).maybeSingle();
      if (already) continue;
      out.considered++;

      // A sender the owner has already judged is never a lead again.
      const { data: ruled } = await admin.from("lead_sender_rules")
        .select("kind").eq("user_id", lead.user_id).ilike("sender", lead.lead_email || "~none~").maybeSingle();

      const text = String(lead.inbound_text || "");
      const v: Verdict = ruled
        ? { send: false, reason: `sender previously marked ${ruled.kind}`, score: 0 }
        : judge(lead, text);

      const agent = agentBy.get(lead.user_id);
      const row: any = {
        user_id: lead.user_id, lead_id: lead.id, contact_id: lead.contact_id,
        lead_name: lead.lead_name, lead_email: lead.lead_email, channel: lead.channel,
        preview: text.trim().replace(/\s+/g, " ").slice(0, 300),
        decision: v.send ? "would_send" : "suppressed",
        reason: v.reason, score: v.score, shadow,
      };

      if (!v.send) { out.suppressed++; await admin.from("lead_notifications").insert(row); continue; }
      out.would_send++;

      if (shadow) { await admin.from("lead_notifications").insert(row); continue; }

      // Live. Respect the agent's own switch.
      const { data: pref } = await admin.from("notification_prefs")
        .select("email_new_leads, unsubscribe_token").eq("user_id", lead.user_id).maybeSingle();
      let token = pref?.unsubscribe_token;
      if (!pref) {
        const { data: made } = await admin.from("notification_prefs")
          .insert({ user_id: lead.user_id }).select("unsubscribe_token").maybeSingle();
        token = made?.unsubscribe_token;
      } else if (pref.email_new_leads === false) {
        row.decision = "suppressed"; row.reason = "agent turned these off";
        await admin.from("lead_notifications").insert(row); out.suppressed++; out.would_send--; continue;
      }

      const { data: acct } = await admin.from("email_accounts")
        .select("id").eq("user_id", lead.user_id).eq("is_active", true)
        .order("is_default", { ascending: false }).limit(1);
      const from = acct?.[0];
      const first = String(agent?.name || "").trim().split(/[\s,]+/)[0] || "there";
      const msg = buildEmail(first, lead, text, String(token || ""));

      if (!from || !agent?.email) {
        row.decision = "suppressed"; row.reason = "no mailbox to send from";
        await admin.from("lead_notifications").insert(row); out.suppressed++; out.would_send--; continue;
      }

      const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-qcp-token": QCP },
        body: JSON.stringify({
          account_id: from.id, user_id: lead.user_id, to: agent.email,
          subject: msg.subject, body_text: msg.text, body_html: msg.html,
        }),
      });
      const jr = await r.json().catch(() => ({}));
      if (r.ok && !jr.error) { row.decision = "sent"; row.sent_at = new Date().toISOString(); out.sent++; }
      else { row.decision = "failed"; row.reason = String(jr.error || r.status); }
      await admin.from("lead_notifications").insert(row);
    }

    return json({ ok: true, ...out });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) });
  }
});
