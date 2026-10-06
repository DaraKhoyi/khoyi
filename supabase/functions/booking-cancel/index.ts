// booking-cancel — public (verify_jwt=false). Cancels a booking via its
// cancel_token: removes the calendar event (from Google + our DB), frees the
// slot, and marks the booking cancelled so the client can rebook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function refreshToken(refresh_token: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token, grant_type: "refresh_token" }),
  });
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const token = String(b.cancel_token || "").trim();
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const { data: bk } = await admin.from("bookings").select("*").eq("cancel_token", token).maybeSingle();
    if (!bk) return json({ ok: false, error: "not_found" }, 404);
    if (bk.status === "cancelled") return json({ ok: true, already: true, slug: bk.slug });

    // remove the calendar event (Google best-effort, then our row)
    if (bk.event_id) {
      const { data: ev } = await admin.from("events").select("*").eq("id", bk.event_id).maybeSingle();
      if (ev?.google_event_id) {
        try {
          let { data: acct } = await admin.from("email_accounts").select("*")
            .eq("user_id", bk.user_id).eq("provider", "google").eq("is_active", true)
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
          if (acct?.refresh_token) {
            let accessToken = acct.access_token;
            if (!acct.token_expires_at || new Date(acct.token_expires_at) <= new Date()) {
              const refreshed = await refreshToken(acct.refresh_token);
              accessToken = refreshed.access_token;
              await admin.from("email_accounts").update({ access_token: accessToken, token_expires_at: new Date(Date.now() + ((refreshed.expires_in || 3600) - 60) * 1000).toISOString() }).eq("id", acct.id);
            }
            const calId = ev.google_calendar_id || "primary";
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${ev.google_event_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
          }
        } catch (_e) { /* best-effort */ }
      }
      await admin.from("events").delete().eq("id", bk.event_id);
    }

    const { error: cErr } = await admin.from("bookings").update({ status: "cancelled" }).eq("id", bk.id);
    if (cErr) return json({ ok: false, error: "could_not_cancel" }, 500);

    // ── Tell the other side. Until 6 Oct 2026 a cancellation told nobody: the
    // agent found a gap in their day, or the client turned up to nothing.
    //   by the client  -> the agent gets a phone notification and a note on
    //                     the booking task; the client gets a short email.
    //   by the agent   -> the client gets an email saying it is cancelled,
    //                     with the link to book another time.
    //   a reschedule   -> nobody: the new booking's own confirmation says it.
    const told = { agent: false, client: false };
    if (!b.rescheduled) {
      // Who cancelled: a signed-in caller who is the booking's own agent, else the client.
      let byAgent = false;
      try {
        const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (jwt) { const { data: who } = await admin.auth.getUser(jwt); byAgent = !!who?.user && who.user.id === bk.user_id; }
      } catch (_e) { /* not signed in: the client */ }
      const { data: us } = await admin.from("user_settings").select("display_name, timezone").eq("user_id", bk.user_id).maybeSingle();
      const tz = us?.timezone || "America/New_York", agentName = us?.display_name || "your agent";
      const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(bk.start_at));
      const label = ({ phone: "Phone call", zoom: "Zoom", google_meet: "Google Meet", office: "Office meeting", property: "Property showing", other: "Meeting" } as Record<string, string>)[bk.meeting_type] || "Meeting";
      const esc = (t: string) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, BASE = Deno.env.get("SUPABASE_URL")!, PUBLIC_BASE = Deno.env.get("PUBLIC_BASE_URL") || "https://darasapp.com";
      if (!byAgent) {
        try {
          const r = await fetch(`${BASE}/functions/v1/push-send`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: bk.user_id, title: `Booking cancelled: ${bk.client_name}`, body: `${label}, ${when}. That time is open again.`, url: "/", tag: "booking-cancel-" + bk.id }) });
          told.agent = r.ok;
        } catch (_e) { /* the task note below still says it */ }
        // The heads-up task made when it was booked now says what happened, and is let go.
        const { data: tasks } = await admin.from("tasks").select("id, notes").eq("user_id", bk.user_id).eq("completed", false).is("dropped_at", null)
          .in("title", [`New booking — ${label} with ${bk.client_name}`, `Review new contact and name the contact — ${bk.client_name}`]).limit(5);
        for (const t of tasks || []) {
          const { error: tErr } = await admin.from("tasks").update({ notes: (t.notes ? t.notes + "\n" : "") + `[${bk.client_name} cancelled this booking (${when}).]` }).eq("id", t.id);
          if (!tErr) told.agent = true;
        }
      }
      // Email to the client, from the agent's own mailbox, with a calendar cancellation.
      try {
        const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", bk.user_id).eq("is_active", true).order("created_at").limit(1);
        const accountId = acct && acct[0]?.id;
        if (accountId && bk.client_email) {
          const stampIcs = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
          const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Prism//Booking//EN", "METHOD:CANCEL", "BEGIN:VEVENT",
            `UID:${bk.cancel_token}@darasapp.com`, `DTSTAMP:${stampIcs(new Date().toISOString())}`, `DTSTART:${stampIcs(bk.start_at)}`, `DTEND:${stampIcs(bk.end_at)}`,
            `SUMMARY:${(label + " with " + agentName).replace(/[,;]/g, " ")}`, "SEQUENCE:1", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
          const bookUrl = `${PUBLIC_BASE}/book/${encodeURIComponent(bk.slug)}`;
          const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f1f1f;line-height:1.6;"><p>Hi ${esc(bk.client_name)},</p>` +
            (byAgent ? `<p>${esc(agentName)} has had to cancel your <b>${esc(label)}</b> on <b>${esc(when)} (Eastern)</b>.</p><p>You can <a href="${bookUrl}">choose another time here</a>.</p>`
                     : `<p>Your <b>${esc(label)}</b> with ${esc(agentName)} on <b>${esc(when)} (Eastern)</b> is cancelled, as you asked.</p><p>If you would like another time, you can <a href="${bookUrl}">book one here</a>.</p>`) +
            `<p>${esc(agentName)}</p></div>`;
          const r = await fetch(`${BASE}/functions/v1/gmail-send`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
            body: JSON.stringify({ user_id: bk.user_id, account_id: accountId, to: bk.client_email, subject: `Cancelled: ${label} with ${agentName} — ${when}`, body_html: html,
              attachments: [{ filename: "cancel.ics", mime_type: "text/calendar", content_base64: btoa(unescape(encodeURIComponent(ics))) }] }) });
          told.client = r.ok;
        }
      } catch (_e) { /* the cancellation itself stands */ }
    }
    return json({ ok: true, slug: bk.slug, told });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
