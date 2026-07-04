// booking-create — public (verify_jwt=false). Creates a booking from the public
// page: calendar event (pushes to Google), contact (if new) + review task,
// booking row, and a confirmation email to the client with an .ics invite and a
// cancel/reschedule link.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);
const PUBLIC_BASE = Deno.env.get("PUBLIC_BASE_URL") || "https://darasapp.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TYPES: Record<string, { label: string; needsAddress: boolean; office?: boolean }> = {
  phone: { label: "Phone call", needsAddress: false },
  zoom: { label: "Zoom", needsAddress: false },
  google_meet: { label: "Google Meet", needsAddress: false },
  office: { label: "Office meeting", needsAddress: true, office: true },
  property: { label: "Property showing", needsAddress: true },
  other: { label: "Meeting", needsAddress: true },
};
const digits = (s: string) => (s || "").replace(/\D/g, "");
const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const icsEsc = (s: string) => (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const rand = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");

async function googleAccessToken(userId: string): Promise<{ token: string; accountId: string } | null> {
  const { data: accts } = await admin.from("email_accounts").select("*")
    .eq("user_id", userId).eq("provider", "google").eq("is_active", true).order("updated_at", { ascending: false });
  const acct = (accts || []).find((a: any) => (a.scopes || []).some((s: string) => s.includes("calendar"))) || (accts || [])[0];
  if (!acct?.refresh_token) return null;
  let token = acct.access_token;
  if (!acct.token_expires_at || new Date(acct.token_expires_at) <= new Date()) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: acct.refresh_token, grant_type: "refresh_token" }),
    });
    const t = await r.json(); token = t.access_token;
    if (token) await admin.from("email_accounts").update({ access_token: token, token_expires_at: new Date(Date.now() + ((t.expires_in || 3600) - 60) * 1000).toISOString() }).eq("id", acct.id);
  }
  return token ? { token, accountId: acct.id } : null;
}

// Create the event straight in Google Calendar WITH a Google Meet link.
async function createGoogleMeet(userId: string, ev: { summary: string; description: string; startIso: string; endIso: string; tz: string }) {
  const auth = await googleAccessToken(userId); if (!auth) return null;
  const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.summary, description: ev.description,
      start: { dateTime: ev.startIso, timeZone: ev.tz }, end: { dateTime: ev.endIso, timeZone: ev.tz },
      conferenceData: { createRequest: { requestId: rand(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  if (!r.ok) return null;
  const g = await r.json();
  const meetLink = g.hangoutLink || (g.conferenceData?.entryPoints || []).find((e: any) => e.entryPointType === "video")?.uri || "";
  return { id: g.id, calendarId: "primary", meetLink };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const slug = String(b.slug || "").toLowerCase().trim();
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim();
    const phone = String(b.phone || "").trim();
    const notes = String(b.notes || "").trim();
    const meeting_type = String(b.meeting_type || "").trim();
    const address = String(b.address || "").trim();
    const duration = [30, 60, 90, 120].includes(+b.duration) ? +b.duration : 30;
    const startIso = String(b.start_at || "");
    const type = TYPES[meeting_type];
    // honeypot — bots fill hidden fields; pretend success, create nothing
    if (b.hp || b.website) return json({ ok: true, cancel_token: "", emailed: false });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
    if (!slug || !name || !email || !phone || !startIso || !type) return json({ ok: false, error: "missing_fields" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "bad_email" }, 400);

    const startMs = new Date(startIso).getTime();
    if (isNaN(startMs)) return json({ ok: false, error: "bad_time" }, 400);
    const endIso = new Date(startMs + duration * 60000).toISOString();

    // agent
    const { data: us } = await admin.from("user_settings").select("user_id, display_name, office_address, zoom_link, booking_phone, booking_enabled, timezone, booking_types, booking_durations, booking_min_notice_min, booking_horizon_days")
      .eq("booking_slug", slug).maybeSingle();
    if (!us || !us.booking_enabled) return json({ ok: false, error: "not_available" }, 404);
    const userId = us.user_id;
    // per-agent controls
    const enDur = (Array.isArray(us.booking_durations) && us.booking_durations.length) ? us.booking_durations : [30, 60, 90, 120];
    if (!enDur.includes(duration)) return json({ ok: false, error: "duration_unavailable" }, 400);
    const enTypes = (Array.isArray(us.booking_types) && us.booking_types.length) ? us.booking_types : ["phone", "zoom", "google_meet", "office", "property", "other"];
    if (!enTypes.includes(meeting_type)) return json({ ok: false, error: "type_unavailable" }, 400);
    if (startMs < Date.now() + ((us.booking_min_notice_min ?? 120)) * 60000) return json({ ok: false, error: "too_soon" }, 400);
    if (startMs > Date.now() + ((us.booking_horizon_days ?? 21)) * 86400000) return json({ ok: false, error: "too_far" }, 400);
    const tz = us.timezone || "America/New_York";
    const whenLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(startIso));
    // rate limit — max 6 bookings per IP per hour
    if (ip) {
      const since = new Date(Date.now() - 3600000).toISOString();
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
      if ((count || 0) >= 6) return json({ ok: false, error: "rate_limited" }, 429);
    }

    // location / join info
    const meetingLabel = type.label;
    let location = "";
    if (type.office) location = address || us.office_address || "Office (address to follow)";
    else if (meeting_type === "zoom") location = us.zoom_link || "Zoom (link to follow)";
    else if (meeting_type === "google_meet") location = "Google Meet (link in invite)";
    else if (type.needsAddress) { if (!address) return json({ ok: false, error: "address_required" }, 400); location = address; }
    else location = type.label;

    // re-check the slot is still free (prevent double-booking)
    const { data: clash } = await admin.from("events").select("id")
      .eq("user_id", userId).neq("status", "cancelled").eq("all_day", false)
      .lt("start_at", endIso).gt("end_at", startIso).limit(1);
    if (clash && clash.length) return json({ ok: false, error: "slot_taken" }, 409);

    const desc = `Booked via your Prism booking page.\nClient: ${name}\nEmail: ${email}\nPhone: ${phone}` + (notes ? `\nNotes: ${notes}` : "");

    // 1) calendar event
    const { data: ev } = await admin.from("events").insert({
      user_id: userId, title: `${meetingLabel} with ${name}`,
      start_at: startIso, end_at: endIso, all_day: false,
      location, description: desc, event_kind: "appointment",
      category: "appointment", sync_status: "pending_push", status: "confirmed",
    }).select("id").maybeSingle();
    const eventId = ev?.id || null;

    // Google Meet: create the event directly in Google to mint a Meet link.
    let meetLink = "";
    if (meeting_type === "google_meet" && eventId) {
      try {
        const g = await createGoogleMeet(userId, { summary: `${meetingLabel} with ${name}`, description: desc, startIso, endIso, tz });
        if (g && g.meetLink) {
          meetLink = g.meetLink; location = meetLink;
          await admin.from("events").update({ google_event_id: g.id, google_calendar_id: g.calendarId, location: meetLink, sync_status: "synced", last_synced_at: new Date().toISOString() }).eq("id", eventId);
        }
      } catch (_e) { /* link-to-follow fallback */ }
    }
    // where/join line for the confirmation
    let whereLine = location;
    if (meeting_type === "google_meet") whereLine = meetLink || "Google Meet link will be emailed shortly";
    else if (meeting_type === "zoom") whereLine = us.zoom_link || "Zoom link will be emailed shortly";
    else if (meeting_type === "phone") whereLine = us.booking_phone ? `Phone call — reach ${us.display_name || "your agent"} at ${us.booking_phone}` : `Phone call — ${us.display_name || "your agent"} will call you`;

    // 2) contact — find by email or phone, else create + review task
    let contactId: string | null = null; let contactIsNew = false;
    const ph = digits(phone);
    const { data: byEmail } = await admin.from("contacts").select("id").eq("user_id", userId).ilike("email", email).limit(1);
    if (byEmail && byEmail.length) contactId = byEmail[0].id;
    if (!contactId && ph.length >= 7) {
      const { data: byPhone } = await admin.from("contacts").select("id, phone").eq("user_id", userId).ilike("phone", `%${ph.slice(-7)}%`).limit(1);
      if (byPhone && byPhone.length) contactId = byPhone[0].id;
    }
    if (!contactId) {
      const { data: nc } = await admin.from("contacts").insert({
        user_id: userId, name, type: "lead", email,
        origin: "booking", origin_detail: "Booking page",
        notes: `Booked a ${meetingLabel} on the booking page.` + (notes ? ` Notes: ${notes}` : ""),
      }).select("id").maybeSingle();
      if (nc?.id) {
        contactId = nc.id; contactIsNew = true;
        // phone & email are blanked by a trigger on insert — set them in a second step
        await admin.from("contacts").update({
          phone, phones: [{ value: phone, label: "Mobile", is_default: true }],
          email, emails: [{ value: email, label: "Email", is_default: true }],
        }).eq("id", contactId);
        // review task for the agent — due today, Urgent / A
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        await admin.from("tasks").insert({
          user_id: userId, title: `Review new contact and name the contact — ${name}`,
          notes: `New contact from a booking (${meetingLabel}).\nEmail: ${email}\nPhone: ${phone}` + (notes ? `\nNotes: ${notes}` : ""),
          priority: "high", priority_system: "eisenhower", eisenhower_quadrant: "A",
          due_date: todayStr, completed: false, contact_id: contactId,
        });
      }
    }
    if (eventId && contactId) await admin.from("events").update({ contact_id: contactId }).eq("id", eventId);

    // heads-up task on EVERY booking (new contacts already got a review task above)
    if (!contactIsNew) {
      const todayStr2 = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      await admin.from("tasks").insert({
        user_id: userId, title: `New booking — ${meetingLabel} with ${name}`,
        notes: `${whenLabel}\nEmail: ${email}\nPhone: ${phone}` + (notes ? `\nNotes: ${notes}` : ""),
        priority: "high", priority_system: "eisenhower", eisenhower_quadrant: "A",
        due_date: todayStr2, completed: false, contact_id: contactId,
      });
    }

    // 3) booking row
    const cancelToken = rand();
    await admin.from("bookings").insert({
      user_id: userId, slug, client_name: name, client_email: email, client_phone: phone,
      notes, meeting_type, location, duration_minutes: duration,
      start_at: startIso, end_at: endIso, status: "confirmed",
      event_id: eventId, contact_id: contactId, cancel_token: cancelToken, ip: ip || null,
    });

    // 4) confirmation email to the client (from the agent's Gmail) w/ .ics + cancel link
    let emailed = false;
    try {
      const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", userId).eq("is_active", true).order("created_at").limit(1);
      const accountId = acct && acct[0]?.id;
      if (accountId) {
        const cancelUrl = `${PUBLIC_BASE}/book.html?u=${encodeURIComponent(slug)}&cancel=${cancelToken}`;
        const agentName = us.display_name || "your agent";
        const ics = [
          "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Prism//Booking//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
          `UID:${cancelToken}@darasapp.com`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
          `DTSTART:${icsDate(startIso)}`, `DTEND:${icsDate(endIso)}`,
          `SUMMARY:${icsEsc(meetingLabel + " with " + agentName)}`,
          `LOCATION:${icsEsc(whereLine)}`,
          `DESCRIPTION:${icsEsc((/^https?:\/\//i.test(whereLine) ? ("Join: " + whereLine + "\\n") : "") + "Booked with " + agentName + ". To cancel or reschedule: " + cancelUrl)}`,
          "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
        ].join("\r\n");
        const icsB64 = btoa(unescape(encodeURIComponent(ics)));
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f1f1f;line-height:1.6;">
<p>Hi ${esc(name)},</p>
<p>Your <b>${esc(meetingLabel)}</b> with ${esc(agentName)} is confirmed:</p>
<p style="font-size:16px;margin-bottom:4px;"><b>${esc(whenLabel)} (Eastern)</b></p>
<p style="font-size:15px;">📍 ${/^https?:\/\//i.test(whereLine) ? `<a href="${whereLine}">${esc(whereLine)}</a>` : esc(whereLine)}</p>
${notes ? `<p style="color:#555;">Your note: ${esc(notes)}</p>` : ""}
<p>A calendar invite is attached. Need to change it? <a href="${cancelUrl}">Cancel or reschedule here</a>.</p>
<p>See you then!<br>${esc(agentName)}</p></div>`;
        const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}` },
          body: JSON.stringify({
            user_id: userId, account_id: accountId, to: email,
            subject: `Confirmed: ${meetingLabel} with ${agentName} — ${whenLabel}`,
            body_html: html,
            attachments: [{ filename: "invite.ics", mime_type: "text/calendar", content_base64: icsB64 }],
          }),
        });
        emailed = r.ok;
      }
    } catch (_e) { /* email is best-effort; booking still stands */ }

    return json({ ok: true, cancel_token: cancelToken, emailed, when: startIso, duration, meeting_type, location });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
