// calendar-ics-feed — publishes a user's PrismOS events as a read-only iCalendar
// (.ics) feed. Secured by an unguessable per-user token (user_settings.ics_token).
// Runs with verify_jwt=false so Apple/Google calendar subscribers can fetch it
// without auth. Read-only: it never writes anything.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const esc = (s: unknown) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// RFC 5545 line folding: fold at 73 chars with CRLF + single space.
function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}
const p2 = (n: number) => String(n).padStart(2, "0");
function dtUTC(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}
function dateStamp(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}
function plusOneDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || url.searchParams.get("t");
    if (!token) return new Response("Missing token", { status: 400, headers: cors });

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: us } = await sb
      .from("user_settings")
      .select("user_id, display_name")
      .eq("ics_token", token)
      .maybeSingle();
    if (!us) return new Response("Not found", { status: 404, headers: cors });

    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const { data: events } = await sb
      .from("events")
      .select("id,title,description,location,start_at,end_at,all_day,status,updated_at")
      .eq("user_id", us.user_id)
      .neq("status", "cancelled")
      .gte("start_at", since)
      .order("start_at", { ascending: true })
      .limit(2000);

    const L: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//PrismOS//darasapp.com//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      fold("X-WR-CALNAME:" + esc((us.display_name ? us.display_name + " \u2014 " : "") + "PrismOS")),
      "X-PUBLISHED-TTL:PT1H",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ];
    for (const ev of (events || [])) {
      if (!ev.start_at) continue;
      L.push("BEGIN:VEVENT");
      L.push(fold("UID:" + ev.id + "@prismos.darasapp.com"));
      L.push("DTSTAMP:" + dtUTC(ev.updated_at || ev.start_at));
      if (ev.all_day) {
        L.push("DTSTART;VALUE=DATE:" + dateStamp(ev.start_at));
        // All-day DTEND is exclusive → end date (or start date) + 1 day.
        L.push("DTEND;VALUE=DATE:" + dateStamp(plusOneDay(ev.end_at || ev.start_at)));
      } else {
        L.push("DTSTART:" + dtUTC(ev.start_at));
        L.push("DTEND:" + dtUTC(ev.end_at || ev.start_at));
      }
      L.push(fold("SUMMARY:" + esc(ev.title || "(no title)")));
      if (ev.location) L.push(fold("LOCATION:" + esc(ev.location)));
      if (ev.description) L.push(fold("DESCRIPTION:" + esc(ev.description)));
      L.push("STATUS:CONFIRMED");
      L.push("END:VEVENT");
    }
    L.push("END:VCALENDAR");

    return new Response(L.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="prismos.ics"',
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (e) {
    return new Response("Error: " + ((e as Error)?.message || String(e)), { status: 500, headers: cors });
  }
});
