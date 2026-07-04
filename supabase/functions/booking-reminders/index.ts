// booking-reminders — cron (verify_jwt=false). Emails the client a reminder
// ~24h before and ~1h before their meeting, once each. Marks flags so it never
// double-sends. Uses the agent's Gmail. (Google already reminds the agent.)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);
const PUBLIC_BASE = Deno.env.get("PUBLIC_BASE_URL") || "https://darasapp.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const LABEL: Record<string, string> = { phone: "Phone call", zoom: "Zoom", google_meet: "Google Meet", office: "Office meeting", property: "Property showing", other: "Meeting" };
const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function agentAccount(userId: string) {
  const { data } = await admin.from("email_accounts").select("id").eq("user_id", userId).eq("is_active", true).order("created_at").limit(1);
  return data && data[0]?.id;
}
async function sendReminder(bk: any, whenText: string, tz: string) {
  const accountId = await agentAccount(bk.user_id);
  if (!accountId) return false;
  const { data: usArr } = await admin.from("user_settings").select("display_name").eq("user_id", bk.user_id).limit(1);
  const agentName = (usArr && usArr[0]?.display_name) || "your agent";
  const label = LABEL[bk.meeting_type] || "Meeting";
  const cancelUrl = `${PUBLIC_BASE}/book.html?u=${encodeURIComponent(bk.slug || "")}&cancel=${bk.cancel_token}`;
  const where = bk.location || "";
  const whereHtml = /^https?:\/\//i.test(where) ? `<a href="${where}">${esc(where)}</a>` : esc(where);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f1f1f;line-height:1.6;">
<p>Hi ${esc(bk.client_name)},</p>
<p>A quick reminder about your <b>${esc(label)}</b> with ${esc(agentName)}:</p>
<p style="font-size:16px;margin-bottom:4px;"><b>${esc(whenText)} (Eastern)</b></p>
<p style="font-size:15px;">📍 ${whereHtml}</p>
<p>Need to change it? <a href="${cancelUrl}">Cancel or reschedule here</a>.</p>
<p>See you soon!<br>${esc(agentName)}</p></div>`;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}` },
    body: JSON.stringify({ user_id: bk.user_id, account_id: accountId, to: bk.client_email, subject: `Reminder: ${label} with ${agentName} — ${whenText}`, body_html: html }),
  });
  return r.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const now = Date.now();
    const in24 = new Date(now + 24 * 3600000).toISOString();
    const in90 = new Date(now + 90 * 60000).toISOString();
    const nowIso = new Date(now).toISOString();
    const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

    let sent24 = 0, sent1 = 0;

    // 24h reminders: within 24h, more than 90min away, not yet sent
    const { data: due24 } = await admin.from("bookings").select("*")
      .eq("status", "confirmed").eq("reminder_24_sent", false)
      .gt("start_at", in90).lte("start_at", in24).limit(100);
    for (const bk of due24 || []) {
      const { data: usArr } = await admin.from("user_settings").select("timezone").eq("user_id", bk.user_id).limit(1);
      const tz = (usArr && usArr[0]?.timezone) || "America/New_York";
      const ok = await sendReminder(bk, fmt(bk.start_at, tz), tz);
      await admin.from("bookings").update({ reminder_24_sent: true }).eq("id", bk.id);
      if (ok) sent24++;
    }

    // 1h reminders: within 90min, not yet sent
    const { data: due1 } = await admin.from("bookings").select("*")
      .eq("status", "confirmed").eq("reminder_1_sent", false)
      .gt("start_at", nowIso).lte("start_at", in90).limit(100);
    for (const bk of due1 || []) {
      const { data: usArr } = await admin.from("user_settings").select("timezone").eq("user_id", bk.user_id).limit(1);
      const tz = (usArr && usArr[0]?.timezone) || "America/New_York";
      const ok = await sendReminder(bk, fmt(bk.start_at, tz), tz);
      await admin.from("bookings").update({ reminder_1_sent: true, reminder_24_sent: true }).eq("id", bk.id);
      if (ok) sent1++;
    }

    return json({ ok: true, sent_24h: sent24, sent_1h: sent1 });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
