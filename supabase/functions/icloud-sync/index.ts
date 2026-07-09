// icloud-sync — PULLS each agent's personal iCloud calendars INTO PrismOS as
// read-only "personal/busy" blocks (event_kind='icloud_personal'), so PrismOS can
// see their whole day (business already lives in Google/PrismOS; this adds the
// personal side) and never books over personal time. Pull-only — nothing is
// written back to iCloud, so no duplication. Runs per-user (JWT) or all (cron).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_B64 = Deno.env.get("ICLOUD_ENC_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

async function decrypt(b64: string) {
  const raw = Uint8Array.from(atob(ENC_KEY_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12)));
}
const basic = (e: string, p: string) => "Basic " + btoa(e + ":" + p);
async function dav(method: string, url: string, auth: string, body?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Authorization: auth, "User-Agent": "PrismOS/1.0", ...extra };
  if (body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
}
const p2 = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
const xmlUnescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#13;/g, "\r").replace(/&#10;/g, "\n").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

// Convert a wall-clock time in an IANA zone to a correct UTC ISO string (handles DST).
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): string {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const m: any = {}; for (const p of dtf.formatToParts(new Date(guess))) m[p.type] = p.value;
    const asZone = Date.UTC(+m.year, +m.month - 1, +m.day, (+m.hour) % 24, +m.minute, +m.second);
    return new Date(guess - (asZone - guess)).toISOString();
  } catch { return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(); }
}
function parseDT(line: string | null): { iso: string; allDay: boolean } | null {
  if (!line) return null;
  const m = /:([0-9T]+Z?)\s*$/.exec(line) || /:([0-9T]+Z?)/.exec(line);
  if (!m) return null;
  const v = m[1];
  const tz = /TZID=([^;:]+)/.exec(line);
  const isDate = /VALUE=DATE(?![-])/.test(line) || /^\d{8}$/.test(v);
  if (isDate) return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`, allDay: true };
  const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8), h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +(v.slice(13, 15) || "0");
  if (v.endsWith("Z")) return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15) || "00"}Z`, allDay: false };
  if (tz) return { iso: zonedToUtc(y, mo, d, h, mi, s, tz[1]), allDay: false };
  return { iso: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(), allDay: false };
}
const lineOf = (block: string, name: string) => (new RegExp("^" + name + "[^\\r\\n]*", "im").exec(block) || [])[0] || null;
function field(block: string, name: string) {
  const m = new RegExp("^" + name + "[^:\\r\\n]*:(.*)$", "im").exec(block);
  return m ? m[1].trim().replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\") : null;
}

async function pullOne(svc: any, conn: any) {
  const auth = basic(conn.apple_id, await decrypt(conn.app_password_enc));
  const home = conn.calendar_home_url;
  if (!home) return { calendars: 0, imported: 0, removed: 0, error: "no calendar home" };
  const origin = new URL(home).origin;

  // List the agent's personal calendars (VEVENT-capable), skipping the old dedicated "PrismOS".
  const list = await dav("PROPFIND", home, auth,
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><A:displayname/><A:resourcetype/><C:supported-calendar-component-set/></A:prop></A:propfind>', { Depth: "1" });
  const cals: { url: string; name: string }[] = [];
  for (const blk of list.text.split(/<response/i).slice(1)) {
    const href = (/<href[^>]*>([^<]+)</i.exec(blk) || [])[1];
    const name = ((/displayname[^>]*>([^<]*)</i.exec(blk) || [])[1] || "").trim();
    if (!href || !/VEVENT/i.test(blk) || name === "PrismOS") continue;
    cals.push({ url: href.startsWith("http") ? href : origin + href, name });
  }

  const now = Date.now();
  const start = stamp(new Date(now - 30 * 864e5)), end = stamp(new Date(now + 120 * 864e5));
  const present = new Map<string, any>();
  for (const cal of cals) {
    const rep = await dav("REPORT", cal.url, auth,
      `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data><C:expand start="${start}" end="${end}"/></C:calendar-data></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${start}" end="${end}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`, { Depth: "1" });
    for (const resp of rep.text.split(/<response/i).slice(1)) {
      const rhref = ((/<href[^>]*>([^<]+)</i.exec(resp) || [])[1] || "").replace(/^https?:\/\/[^/]+/, "");
      const cd = /calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z]*:?calendar-data>/i.exec(resp);
      if (!cd) continue;
      const ics = xmlUnescape(cd[1]).replace(/\r?\n[ \t]/g, "");
      for (const chunk of ics.split(/BEGIN:VEVENT/i).slice(1)) {
        const block = "BEGIN:VEVENT" + chunk.split(/END:VEVENT/i)[0];
        const ds = parseDT(lineOf(block, "DTSTART")); if (!ds) continue;
        const de = parseDT(lineOf(block, "DTEND"));
        const recid = field(block, "RECURRENCE-ID") || "";
        const key = rhref + "#" + (recid || ds.iso);
        present.set(key, {
          user_id: conn.user_id, title: field(block, "SUMMARY") || "(busy)",
          start_at: ds.iso, end_at: de ? de.iso : ds.iso, all_day: ds.allDay,
          location: field(block, "LOCATION"), status: "confirmed",
          event_kind: "icloud_personal", category: cal.name || "Personal",
          icloud_href: key, updated_at: new Date().toISOString(),
        });
      }
    }
  }

  const { data: existing } = await svc.from("events").select("id,icloud_href").eq("user_id", conn.user_id).eq("event_kind", "icloud_personal");
  const rows = [...present.values()];
  for (let i = 0; i < rows.length; i += 200) await svc.from("events").upsert(rows.slice(i, i + 200), { onConflict: "user_id,icloud_href" });
  const toDelete = (existing || []).filter((e: any) => !present.has(e.icloud_href)).map((e: any) => e.id);
  for (let i = 0; i < toDelete.length; i += 200) await svc.from("events").delete().in("id", toDelete.slice(i, i + 200));

  await svc.from("icloud_connections").update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("user_id", conn.user_id);
  return { calendars: cals.length, imported: present.size, removed: toDelete.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const isCron = token === SERVICE_ROLE;
    let conns: any[] = [];
    if (isCron) { const { data } = await svc.from("icloud_connections").select("*").eq("enabled", true); conns = data || []; }
    else {
      const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + token } } });
      const { data: { user } } = await asUser.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const { data } = await svc.from("icloud_connections").select("*").eq("user_id", user.id).eq("enabled", true); conns = data || [];
    }
    const results: any[] = [];
    for (const c of conns) {
      try { results.push({ user_id: c.user_id, ...(await pullOne(svc, c)) }); }
      catch (e) { await svc.from("icloud_connections").update({ status: "error", last_error: String((e as Error)?.message || e) }).eq("user_id", c.user_id); results.push({ user_id: c.user_id, error: String((e as Error)?.message || e) }); }
    }
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
