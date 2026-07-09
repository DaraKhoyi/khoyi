// icloud-sync — PULL-ONLY. Reads each agent's personal iCloud calendars and
// mirrors their events into PrismOS as read-only, color-separated "personal/busy"
// blocks (event_kind='icloud_personal'), so PrismOS can see the agent's whole day
// (business + personal) and never book over personal time. It never writes to iCloud.
// Called with a user JWT (sync me) or the service-role/sb_secret key from cron (all).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_B64 = Deno.env.get("ICLOUD_ENC_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const PERSONAL_COLOR = "#7c83a3";

async function encKey() {
  const raw = Uint8Array.from(atob(ENC_KEY_B64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function decrypt(b64: string) {
  const key = await encKey();
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new TextDecoder().decode(pt);
}
const basic = (email: string, pw: string) => "Basic " + btoa(email + ":" + pw);
async function dav(method: string, url: string, auth: string, body?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Authorization: auth, "User-Agent": "PrismOS/1.0", ...extra };
  if (body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
}
const p2 = (n: number) => String(n).padStart(2, "0");
function utcStamp(d: Date) { return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`; }
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#13;/g, "").replace(/&amp;/g, "&");

function parseVEVENT(ics: string) {
  const un = ics.replace(/\r?\n[ \t]/g, "");
  const g = (re: RegExp) => (re.exec(un) || [])[1] || null;
  const clean = (v: string | null) => v == null ? null : v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
  const dRaw = (label: string) => (new RegExp(label + "[^:\\r\\n]*:([0-9TZ]+)").exec(un) || [])[1] || null;
  const isDate = new RegExp("DTSTART;[^:\\r\\n]*VALUE=DATE:").test(un) || (dRaw("DTSTART")?.length === 8);
  const toIso = (v: string | null) => {
    if (!v) return null;
    if (v.length === 8) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`;
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15) || "00"}Z`;
  };
  const rrule = g(/RRULE:(.+)/);
  let recur_freq: string | null = null, recur_interval: number | null = null, recur_until: string | null = null, recur_count: number | null = null;
  if (rrule) {
    const f = /FREQ=([A-Z]+)/.exec(rrule); recur_freq = f ? f[1].toLowerCase() : null;
    const iv = /INTERVAL=(\d+)/.exec(rrule); recur_interval = iv ? Number(iv[1]) : null;
    const u2 = /UNTIL=([0-9T]+)/.exec(rrule); recur_until = u2 ? `${u2[1].slice(0, 4)}-${u2[1].slice(4, 6)}-${u2[1].slice(6, 8)}` : null;
    const co = /COUNT=(\d+)/.exec(rrule); recur_count = co ? Number(co[1]) : null;
    if (!["daily", "weekly", "monthly", "yearly"].includes(recur_freq || "")) recur_freq = null;
  }
  return {
    title: clean(g(/SUMMARY:(.+)/)) || "Busy",
    location: clean(g(/LOCATION:(.+)/)),
    description: clean(g(/DESCRIPTION:(.+)/)),
    start_at: toIso(dRaw("DTSTART")),
    end_at: toIso(dRaw("DTEND")),
    all_day: isDate,
    recur_freq, recur_interval, recur_until, recur_count,
  };
}

async function syncOne(svc: any, conn: any) {
  const auth = basic(conn.apple_id, await decrypt(conn.app_password_enc));
  const home = conn.calendar_home_url;
  if (!home) throw new Error("no calendar_home_url");

  const list = await dav("PROPFIND", home, auth,
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><A:displayname/><A:resourcetype/><C:supported-calendar-component-set/></A:prop></A:propfind>', { Depth: "1" });
  const origin = new URL(home).origin;
  const cals: { href: string; name: string }[] = [];
  for (const blk of list.text.split(/<response/i).slice(1)) {
    const href = (/<href[^>]*>([^<]+)</i.exec(blk) || [])[1];
    const name = (/displayname[^>]*>([^<]*)</i.exec(blk) || [])[1] || "";
    const isCal = /<C:calendar|:calendar\/>|<calendar/i.test(blk);
    const vevent = /VEVENT/i.test(blk);
    if (href && isCal && vevent) cals.push({ href: href.startsWith("http") ? href : origin + href, name: name.trim() });
  }

  const start = utcStamp(new Date(Date.now() - 30 * 24 * 3600 * 1000));
  const end = utcStamp(new Date(Date.now() + 365 * 24 * 3600 * 1000));
  const seen = new Set<string>();
  let pulled = 0, updated = 0;

  for (const cal of cals) {
    const rep = await dav("REPORT", cal.href, auth,
      `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${start}" end="${end}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`,
      { Depth: "1" });
    for (const blk of rep.text.split(/<response/i).slice(1)) {
      const href = (/<href[^>]*>([^<]+)</i.exec(blk) || [])[1];
      const etag = (/getetag[^>]*>([^<]*)</i.exec(blk) || [])[1] || null;
      const cdm = /<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/i.exec(blk);
      if (!href || !cdm) continue;
      const ics = unxml(cdm[1]);
      const vb = /BEGIN:VEVENT[\s\S]*?END:VEVENT/i.exec(ics);
      if (!vb) continue;
      const ev = parseVEVENT(vb[0]);
      if (!ev.start_at) continue;
      const full = href.startsWith("http") ? href : origin + href;
      seen.add(full);
      const row = {
        user_id: conn.user_id, title: ev.title, description: ev.description, location: ev.location,
        start_at: ev.start_at, end_at: ev.end_at, all_day: ev.all_day,
        recur_freq: ev.recur_freq, recur_interval: ev.recur_interval, recur_until: ev.recur_until, recur_count: ev.recur_count,
        status: "confirmed", event_kind: "icloud_personal", category: "personal", color: PERSONAL_COLOR,
        icloud_href: full, icloud_etag: etag, updated_at: new Date().toISOString(),
      };
      const { data: existing } = await svc.from("events").select("id,icloud_etag").eq("user_id", conn.user_id).eq("icloud_href", full).maybeSingle();
      if (existing) {
        if (existing.icloud_etag !== etag) { await svc.from("events").update(row).eq("id", existing.id); updated++; }
      } else {
        await svc.from("events").insert(row); pulled++;
      }
    }
  }

  let deleted = 0;
  const { data: mine } = await svc.from("events").select("id,icloud_href").eq("user_id", conn.user_id).eq("event_kind", "icloud_personal");
  for (const e of (mine || [])) {
    if (e.icloud_href && !seen.has(e.icloud_href)) { await svc.from("events").delete().eq("id", e.id); deleted++; }
  }

  await svc.from("icloud_connections").update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("user_id", conn.user_id);
  return { calendars: cals.length, pulled, updated, deleted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    let conns: any[] = [];
    if (token === SERVICE_ROLE) {
      const { data } = await svc.from("icloud_connections").select("*").eq("enabled", true);
      conns = data || [];
    } else {
      const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + token } } });
      const { data: { user } } = await asUser.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const { data } = await svc.from("icloud_connections").select("*").eq("user_id", user.id).eq("enabled", true);
      conns = data || [];
    }
    const results: any[] = [];
    for (const c of conns) {
      try { results.push({ user_id: c.user_id, ...(await syncOne(svc, c)) }); }
      catch (e) { await svc.from("icloud_connections").update({ status: "error", last_error: String((e as Error)?.message || e) }).eq("user_id", c.user_id); results.push({ user_id: c.user_id, error: String((e as Error)?.message || e) }); }
    }
    return new Response(JSON.stringify({ ok: true, synced: results.length, results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
