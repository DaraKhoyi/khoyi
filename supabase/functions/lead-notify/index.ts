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
//
// v10 (7 Oct 2026). notification_runtime.portal_live switches on three things,
// and with it false this function behaves as v9 did:
//   1. PORTAL LEADS ALWAYS ALERT. A lead from a portal template or relay address
//      (verdict.ts: portalOf) gets a score floor above the threshold. Zillow's
//      own inquiry format scored 35, so Ola's Redondo Way buyers never reached her.
//   2. WHEN A PUSH RINGS. 8 AM–9 PM ET; at night only a lead under 15 minutes
//      old, tagged urgent so the agent's own quiet hours let it through.
//      At most RATE_PER_HOUR lead alerts per agent per hour.
//   3. LATE ALERTS, BY ID ONLY. notification_runtime.backfill_lead_ids lists
//      specific old leads to alert on once (one email per owner). Nothing else
//      from the backlog is ever sent: live runs look back at most 6 hours, and
//      a lead that already has a row is never judged again.
// Alerts go to the lead's OWNER only: push to lead.user_id, email from the
// owner's own mailbox to the owner's own address. No cc, no fallback, nobody else.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { decide, pushPlan, RATE_PER_HOUR, type Verdict } from "./verdict.ts";

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
PrismOS emails you when a new lead writes in, so you can answer first.
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
    PrismOS emails you when a new lead writes in, so you can answer first.
  </p>
  <p style="margin:0;font-size:13px;color:#666">
    Don't want these? <a href="${off}" style="color:#8a6d1f">Turn them off here</a> &mdash; one click, no explanation needed.
  </p>
</div>`;
  return { subject, text, html };
}

function etStamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function propertyOf(text: string) {
  return ((String(text || "").match(/^\s*Property:\s*(.+)$/im) || [])[1] || "").trim();
}

// One email per owner for leads that never got their alert. Honest about the
// timing (not "just came in"), and nothing in it points at anyone but the agent.
function buildLateEmail(agentFirst: string, leads: any[], token: string) {
  const off = `${APP}/n/off?t=${token}`;
  const srcs = [...new Set(leads.map(l => l.source || "portal"))];
  const n = leads.length;
  const subject = n === 1
    ? `Still waiting: ${leads[0].lead_name || "a lead"} (${srcs[0]})`
    : `${n} ${srcs.length === 1 ? srcs[0] + " " : ""}leads are still waiting on you`;
  const lines = leads.map(l => {
    const prop = propertyOf(l.inbound_text);
    return `• ${l.lead_name || l.lead_email || "Someone"}, ${etStamp(l.first_seen_at)}${prop ? " — " + prop : ""}`;
  });
  const text =
`${agentFirst}, ${n === 1 ? "this lead" : "these leads"} came in without an alert and ${n === 1 ? "is" : "are"} still open:

${lines.join("\n")}

Reply from PrismOS (or straight to the ${srcs.length === 1 ? srcs[0] + " " : ""}email): ${APP}

——
PrismOS emails you when a new lead writes in, so you can answer first.
Don't want these? Turn them off here, no explanation needed:
${off}`;
  const html =
`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p style="margin:0 0 14px">${esc(agentFirst)}, ${n === 1 ? "this lead" : "these leads"} came in without an alert and ${n === 1 ? "is" : "are"} still open:</p>
  <ul style="margin:0 0 14px;padding-left:18px">${lines.map(x => `<li>${esc(x.replace(/^• /, ""))}</li>`).join("")}</ul>
  <p style="margin:18px 0"><a href="${APP}" style="background:#C5A95E;color:#1a1205;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;display:inline-block">Reply in PrismOS</a></p>
  <hr style="border:0;border-top:1px solid #e6e0d4;margin:22px 0">
  <p style="margin:0 0 10px;font-size:13px;color:#666">PrismOS emails you when a new lead writes in, so you can answer first.</p>
  <p style="margin:0;font-size:13px;color:#666">Don't want these? <a href="${off}" style="color:#8a6d1f">Turn them off here</a> &mdash; one click, no explanation needed.</p>
</div>`;
  return { subject, text, html };
}

function hourET(d = new Date()) {
  return Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })) % 24;
}

async function pushOwner(userId: string, title: string, body: string, tag: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      // user_id is the lead's owner and nobody else.
      body: JSON.stringify({ user_id: userId, title, body, url: "https://darasapp.com/", tag }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (j?.held) return "push held: " + j.held;
    if (j?.skipped) return "push " + j.skipped;
    if (j?.note === "no devices") return "push: no device registered";
    if (typeof j?.sent === "number") return j.sent > 0 ? `pushed to ${j.sent} device(s)` : "push: every device refused";
    return "push: " + String(j?.error || r.status);
  } catch (e) { return "push failed: " + String((e as Error)?.message || e); }
}

// Late alerts for specific leads, listed by id in notification_runtime.backfill_lead_ids.
async function runBackfill(admin: any, rt: any, agentBy: Map<string, any>) {
  const ids: string[] = Array.isArray(rt?.backfill_lead_ids) ? rt.backfill_lead_ids : [];
  if (!ids.length) return null;
  const h = hourET();
  if (h < 8 || h >= 21) return { deferred: ids.length, why: "outside 8 AM–9 PM ET" };
  // Take the list atomically: only the run that empties it sends (a late alert
  // goes once or not at all, even with two runs at the same moment).
  const { data: took } = await admin.from("notification_runtime")
    .update({ backfill_lead_ids: [], updated_at: new Date().toISOString() })
    .eq("id", true).eq("backfill_lead_ids", `{${ids.join(",")}}`).select("id");
  if (!took || !took.length) return { note: "another run took the backfill" };
  const { data: leads } = await admin.from("lead_concierge")
    .select("id, user_id, lead_name, lead_email, lead_phone, channel, inbound_text, first_seen_at, source, kind, status")
    .in("id", ids);
  const byOwner = new Map<string, any[]>();
  const skipped: string[] = [];
  for (const l of leads || []) {
    // Only an open lead whose owner is a logged-in agent, and only once.
    if (l.status !== "pending" || l.kind !== "lead" || !agentBy.has(l.user_id)) { skipped.push(l.id); continue; }
    const { data: n } = await admin.from("lead_notifications").select("id, decision, shadow, reason").eq("lead_id", l.id).maybeSingle();
    if (n && (n.decision === "sent" || n.shadow === false)) { skipped.push(l.id); continue; }
    if (!byOwner.has(l.user_id)) byOwner.set(l.user_id, []);
    byOwner.get(l.user_id)!.push({ ...l, notif: n });
  }
  const out: any = { owners: 0, sent: 0, failed: 0, skipped: skipped.length };
  for (const [owner, ls] of byOwner) {
    out.owners++;
    const agent = agentBy.get(owner);
    const { data: pref } = await admin.from("notification_prefs").select("email_new_leads, unsubscribe_token").eq("user_id", owner).maybeSingle();
    const mark = async (decision: string, note: string, sent: boolean) => {
      for (const l of ls) {
        const reason = (l.notif?.reason ? l.notif.reason + " · " : "") + note;
        const row: any = { decision, shadow: false, reason, sent_at: sent ? new Date().toISOString() : null };
        if (l.notif) await admin.from("lead_notifications").update(row).eq("id", l.notif.id);
        else await admin.from("lead_notifications").insert({ ...row, user_id: owner, lead_id: l.id, lead_name: l.lead_name, lead_email: l.lead_email, channel: l.channel, score: 60,
          preview: String(l.inbound_text || "").trim().replace(/\s+/g, " ").slice(0, 300) });
      }
    };
    if (pref?.email_new_leads === false) { await mark("suppressed", "late alert: agent turned these off", false); continue; }
    const first = String(agent?.name || "").trim().split(/[\s,]+/)[0] || "there";
    const pushNote = await pushOwner(owner, ls.length === 1 ? `Still waiting: ${ls[0].lead_name || "a lead"}` : `${ls.length} leads still waiting on you`,
      "Open PrismOS to answer", "new-lead-late-" + owner);
    const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", owner).eq("is_active", true)
      .order("is_default", { ascending: false }).limit(1);
    if (!acct?.[0] || !agent?.email) { await mark("failed", `late alert: no mailbox to send from · ${pushNote}`, false); out.failed++; continue; }
    const msg = buildLateEmail(first, ls, String(pref?.unsubscribe_token || ""));
    const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-qcp-token": QCP },
      // From the owner's own mailbox, to the owner's own address. No cc, no bcc.
      body: JSON.stringify({ account_id: acct[0].id, user_id: owner, to: agent.email, subject: msg.subject, body_text: msg.text, body_html: msg.html }),
    });
    const jr: any = await r.json().catch(() => ({}));
    if (r.ok && !jr.error) { await mark("sent", `late alert emailed (portal fix) · ${pushNote}`, true); out.sent += ls.length; }
    else { await mark("failed", `late alert failed: ${String(jr.error || r.status)} · ${pushNote}`, false); out.failed += ls.length; }
  }
  return out;
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
    const portalLive = rt?.portal_live === true;

    // Only agents with a login. Nobody else can act on the email anyway.
    const { data: agents } = await admin.from("agents")
      .select("auth_user_id, name, email").eq("active", true).not("auth_user_id", "is", null);
    const agentBy = new Map((agents || []).map(a => [a.auth_user_id, a]));
    if (!agentBy.size) return json({ ok: true, considered: 0, note: "no agents with logins" });

    const backfill = portalLive ? await runBackfill(admin, rt, agentBy) : null;

    // Leads first seen in the last 6 hours that have not been judged yet. The
    // window keeps a backlog from stampeding everyone on first run — but during
    // the shadow run a wider pass is useful, so Dara has real examples to read
    // straight away instead of waiting for the next lead to land. Sending is off
    // in shadow mode, so a wide look-back costs nothing.
    // v10: once anything can send for real, never look back more than 6 hours.
    const maxHours = (portalLive || !shadow) ? 6 : 24 * 30;
    const hours = Math.min(Number(body.hours) || 6, maxHours);
    const { data: leads } = await admin.from("lead_concierge")
      .select("id, user_id, lead_name, lead_email, lead_phone, channel, inbound_text, first_seen_at, contact_id, source, kind")
      .eq("status", "pending")
      // A reply is never an alert. Someone Dara already knows waiting on him is
      // important and is not a race; spending the alarm on it is how the alarm
      // stops meaning anything.
      .eq("kind", "lead")
      .gte("first_seen_at", new Date(Date.now() - hours * 3600 * 1000).toISOString())
      .order("first_seen_at", { ascending: false }).limit(Number(body.limit) || 200);

    const out: any = { considered: 0, would_send: 0, suppressed: 0, sent: 0, shadow, portal_live: portalLive, backfill };
    for (const lead of leads || []) {
      if (!agentBy.has(lead.user_id)) continue;

      const { data: already } = await admin.from("lead_notifications")
        .select("id").eq("lead_id", lead.id).maybeSingle();
      if (already) continue;
      out.considered++;

      // What the owner has already decided about this sender, from the True
      // lead / Not lead buttons on the review screen. Two rules can exist for
      // one address over time, so read them all rather than maybeSingle(),
      // which throws the moment there is more than one row.
      const { data: rules } = await admin.from("lead_sender_rules")
        .select("kind").eq("user_id", lead.user_id).ilike("sender", lead.lead_email || "~none~");
      const kinds = new Set((rules || []).map((r: any) => r.kind));
      const muted = kinds.has("not_a_lead") || kinds.has("blocked") || kinds.has("unsubscribed");
      // "True lead" is a standing instruction, not a hint. If Dara has said mail
      // from this person is a lead, the heuristics do not get to overrule him —
      // they exist to guess where he has not yet spoken.
      const vouched = kinds.has("lead_ok");

      const addr = String(lead.lead_email || "").trim().toLowerCase();
      const text = String(lead.inbound_text || "");

      // Three suppressions the first shadow pass proved were needed. Each one is
      // a real row from that run, and each would have cost trust on its own.

      // 1. A COLLEAGUE IS NOT A LEAD. Ola emailing Josh produced a "new lead"
      //    notification for Josh. Anyone on the brokerage roster is a co-worker.
      let colleague = false;
      if (addr) {
        const { data: onRoster } = await admin.from("agents")
          .select("id").ilike("email", addr).limit(1);
        colleague = !!(onRoster && onRoster.length);
      }

      // 2. ONE SENDER, ONE NOTIFICATION. alla.tampabayrealtor@gmail.com would
      //    have emailed Josh FOUR times in this window, and five other senders
      //    twice. A person who writes three times is one conversation, not three
      //    leads — and three emails about it is exactly the noise Dara warned
      //    about. Seven days is long enough to cover a back-and-forth.
      let repeat = false;
      if (addr) {
        const { data: recent } = await admin.from("lead_notifications")
          .select("id").eq("user_id", lead.user_id).ilike("lead_email", addr)
          .in("decision", portalLive ? ["would_send", "sent"] : ["would_send"])
          .gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(1);
        repeat = !!(recent && recent.length);
      }

      // 3–5 (the desk, replies, billing, no transaction words) and the score
      // live in verdict.ts. Portal leads get their floor there when portal_live.
      const dv = decide({ lead, text, muted, vouched, colleague, repeat, portalLive });
      const v: Verdict = { send: dv.send, reason: dv.reason, score: dv.score };

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

      // SHADOW MODE STAYS ON FOR GUESSES, AND COMES OFF FOR CERTAINTY. This has
      // been silent since it was built because the old queue called a VPN advert
      // a lead. A lead recognised by its SOURCE TEMPLATE is a different kind of
      // claim: realtor.com's own "New realtor.com lead - <name>" format, a Zillow
      // inquiry, the brokerage's IDX form. Those send now. Score-based guesses
      // keep logging until Dara has read enough of them to trust the score.
      const certain = (!!lead.source && lead.source !== "Direct inquiry") || !!dv.portal;
      row.reason = (row.reason || "") + (certain ? " · recognised source: " + (dv.portal || lead.source) : "");
      if (shadow && !certain) { await admin.from("lead_notifications").insert(row); continue; }

      // CLAIM BEFORE SENDING (v10). gmail-sync nudges this function the moment a
      // lead lands while the 10-minute sweep may be running too. The row goes in
      // first; the one-row-per-lead index lets exactly one run send.
      let claimId: string | null = null;
      if (portalLive) {
        const { data: claimed, error: cErr } = await admin.from("lead_notifications")
          .insert({ ...row, decision: "sending" }).select("id").maybeSingle();
        if (cErr || !claimed) { out.would_send--; continue; }
        claimId = claimed.id;
      }
      const persist = async (r: any) => {
        if (!claimId) return admin.from("lead_notifications").insert(r);
        const { user_id: _u, lead_id: _l, ...rest } = r;
        return admin.from("lead_notifications").update(rest).eq("id", claimId);
      };

      // RATE LIMIT (v10): at most RATE_PER_HOUR lead alerts per agent per hour.
      if (portalLive) {
        const { count } = await admin.from("lead_notifications").select("id", { count: "exact", head: true })
          .eq("user_id", lead.user_id).eq("decision", "sent").gte("sent_at", new Date(Date.now() - 3600e3).toISOString());
        if ((count || 0) >= RATE_PER_HOUR) {
          row.decision = "suppressed"; row.reason += ` · rate limit (${RATE_PER_HOUR} an hour)`;
          await persist(row); out.suppressed++; out.would_send--; continue;
        }
      }

      // SPEED TO LEAD IS THE WHOLE POINT, so a recognised lead buzzes the phone
      // the moment it lands. v9: 7am–10pm only. v10 (portal_live): see pushPlan.
      let pushedOk = false;
      if (certain) {
        const who = lead.lead_name || lead.lead_email || lead.lead_phone || "Someone";
        if (portalLive) {
          const plan = pushPlan(lead.first_seen_at, new Date(), hourET(), lead.id);
          if (plan.push) {
            const note = await pushOwner(lead.user_id, `New lead: ${who}`, `${dv.portal || lead.source} · answer in the next 5 minutes`, plan.tag!);
            pushedOk = /^pushed to/.test(note);
            row.reason += " · " + note;
          } else row.reason += " · " + plan.why;
        } else {
          try {
            const hourNow = hourET();
            if (hourNow >= 7 && hourNow < 22) {
              await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  user_id: lead.user_id,
                  title: `New lead: ${who}`,
                  body: `${lead.source} · answer in the next 5 minutes`,
                  url: "https://darasapp.com/",
                  tag: "new-lead-" + lead.id,
                }),
              });
              row.reason = (row.reason || "") + " · pushed";
            }
          } catch (_) { /* the email below is still the record */ }
        }
      }

      // Live. Respect the agent's own switch.
      const { data: pref } = await admin.from("notification_prefs")
        .select("email_new_leads, unsubscribe_token").eq("user_id", lead.user_id).maybeSingle();
      let token = pref?.unsubscribe_token;
      if (!pref) {
        const { data: made } = await admin.from("notification_prefs")
          .insert({ user_id: lead.user_id }).select("unsubscribe_token").maybeSingle();
        token = made?.unsubscribe_token;
      } else if (pref.email_new_leads === false) {
        if (portalLive && pushedOk) {   // the phone got it; that is the alert
          row.decision = "sent"; row.sent_at = new Date().toISOString(); row.shadow = false; row.reason += " · email skipped: agent turned lead emails off";
          await persist(row); out.sent++; continue;
        }
        row.decision = "suppressed"; row.reason = "agent turned these off";
        await persist(row); out.suppressed++; out.would_send--; continue;
      }

      const { data: acct } = await admin.from("email_accounts")
        .select("id").eq("user_id", lead.user_id).eq("is_active", true)
        .order("is_default", { ascending: false }).limit(1);
      const from = acct?.[0];
      const first = String(agent?.name || "").trim().split(/[\s,]+/)[0] || "there";
      const msg = buildEmail(first, lead, text, String(token || ""));

      if (!from || !agent?.email) {
        if (portalLive && pushedOk) {   // the phone got it; that is the alert
          row.decision = "sent"; row.sent_at = new Date().toISOString(); row.shadow = false; row.reason += " · email skipped: no mailbox to send from";
          await persist(row); out.sent++; continue;
        }
        row.decision = "suppressed"; row.reason = "no mailbox to send from";
        await persist(row); out.suppressed++; out.would_send--; continue;
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
      if (r.ok && !jr.error) { row.decision = "sent"; row.sent_at = new Date().toISOString(); if (portalLive) row.shadow = false; out.sent++; }
      else { row.decision = "failed"; row.reason = String(jr.error || r.status); }
      await persist(row);
    }

    return json({ ok: true, ...out });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) });
  }
});
