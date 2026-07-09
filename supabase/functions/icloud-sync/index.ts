// icloud-sync — two-way sync between a user's PrismOS events and their dedicated
// "PrismOS" iCloud calendar (CalDAV). Called with a user JWT (sync just me) or the
// service-role key from cron (sync all enabled connections).
//
// Direction & loop-safety:
//   • Push: every active PrismOS event is written to iCloud at a stable href
//     (event.icloud_href, or {calendar}/{event.id}.ics). PrismOS is authoritative
//     for events it owns, so pushing can't loop.
//   • Pull: iCloud resources whose href we don't already track are treated as
//     agent-added events and created in PrismOS; tracked events that vanish from
//     iCloud are cancelled in PrismOS. (Edits to PrismOS-owned events made on the
//     phone are re-asserted by the next push — deep edit reconciliation is a follow-up.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_B64 = Deno.env.get("ICLOUD_ENC_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

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
  if (body != null && !headers["Content-Type"]) headers["Content-Type"] = method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text(), etag: res.headers.get("ETag") };
}
const p2 = (n: number) => String(n).padStart(2, "0");
const esc = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function dtUTC(iso: string) { const d = new Date(iso); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`; }
const dstamp = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
function plus1(iso: string) { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString(); }

function buildVEVENT(ev: any): string {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PrismOS//darasapp.com//EN", "BEGIN:VEVENT"];
  L.push("UID:" + ev.id + "@prismos.darasapp.com");
  L.push("DTSTAMP:" + dtUTC(ev.updated_at || ev.start_at));
  if (ev.all_day) { L.push("DTSTART;VALUE=DATE:" + dstamp(ev.start_at)); L.push("DTEND;VALUE=DATE:" + dstamp(plus1(ev.end_at || ev.start_at))); }
  else { L.push("DTSTART:" + dtUTC(ev.start_at)); L.push("DTEND:" + dtUTC(ev.end_at || ev.start_at)); }
  L.push("SUMMARY:" + esc(ev.title || "(no title)"));
  if (ev.location) L.push("LOCATION:" + esc(ev.location));
  if (ev.description) L.push("DESCRIPTION:" + esc(ev.description));
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}

// Minimal VEVENT parser for pulled events. Handles DATE (all-day), UTC (…Z), and
// TZID/naive local (best-effort: treated as the wall-clock, stored as-is).
function parseICS(text: string) {
  const un = text.replace(/\r?\n[ \t]/g, ""); // unfold
  const get = (re: RegExp) => (re.exec(un) || [])[1] || null;
  const uid = get(/UID:(.+)/);
  const summary = (get(/SUMMARY:(.+)/) || "").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\");
  const location = (get(/LOCATION:(.+)/) || "").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\") || null;
  const description = (get(/DESCRIPTION:(.+)/) || "").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\") || null;
  const dtRaw = (label: string) => (new RegExp(label + "[^:]*:([0-9TZ]+)").exec(un) || [])[1] || null;
  const toIso = (v: string | null, allDay: boolean) => {
    if (!v) return null;
    if (allDay || v.length === 8) { return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`; }
    const y = v.slice(0, 4), mo = v.slice(4, 6), d = v.slice(6, 8), hh = v.slice(9, 11), mi = v.slice(11, 13), ss = v.slice(13, 15) || "00";
    return `${y}-${mo}-${d}T${hh}:${mi}:${ss}${v.endsWith("Z") ? "Z" : "Z"}`; // naive/local treated as UTC (best-effort)
  };
  const allDay = /DTSTART;VALUE=DATE:/.test(un) || (dtRaw("DTSTART")?.length === 8);
  return { uid, summary, location, description, start_at: toIso(dtRaw("DTSTART"), allDay), end_at: toIso(dtRaw("DTEND"), allDay), all_day: allDay };
}

async function syncOne(svc: any, conn: any): Promise<{ pushed: number; pulled: number; deleted: number }> {
  const auth = basic(conn.apple_id, await decrypt(conn.app_password_enc));
  const cal = conn.prismos_calendar_url.replace(/\/$/, "") + "/";
  let pushed = 0, pulled = 0, deleted = 0;

  // ---- PUSH: active PrismOS events → iCloud ----
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data: events } = await svc.from("events")
    .select("id,title,description,location,start_at,end_at,all_day,status,updated_at,icloud_href,icloud_etag")
    .eq("user_id", conn.user_id).gte("start_at", since).limit(2000);
  const knownHrefs = new Set<string>();
  for (const ev of (events || [])) {
    if (!ev.start_at) continue;
    const href = ev.icloud_href || (cal + ev.id + ".ics");
    if (ev.status === "cancelled") {
      if (ev.icloud_href) { await dav("DELETE", href, auth); await svc.from("events").update({ icloud_href: null, icloud_etag: null }).eq("id", ev.id); deleted++; }
      continue;
    }
    knownHrefs.add(href.replace(/^https?:\/\/[^/]+/, ""));
    const needs = !ev.icloud_href || (ev.updated_at && conn.last_synced_at && ev.updated_at > conn.last_synced_at) || !conn.last_synced_at;
    if (needs) {
      const r = await dav("PUT", href, auth, buildVEVENT(ev));
      if (r.status < 300) { await svc.from("events").update({ icloud_href: href, icloud_etag: r.etag || null }).eq("id", ev.id); pushed++; }
    }
  }

  // ---- PULL: iCloud PrismOS calendar → PrismOS ----
  const listing = await dav("PROPFIND", cal, auth,
    '<A:propfind xmlns:A="DAV:"><A:prop><A:getetag/><A:getcontenttype/></A:prop></A:propfind>', { Depth: "1" });
  const present = new Set<string>();
  for (const blk of listing.text.split(/<response/i).slice(1)) {
    const href = (/<href[^>]*>([^<]+)</i.exec(blk) || [])[1];
    if (!href || !/\.ics$/i.test(href)) continue;
    const path = href.replace(/^https?:\/\/[^/]+/, "");
    present.add(path);
    if (knownHrefs.has(path)) continue; // already a PrismOS event
    // Unknown resource → agent added it on their phone → create in PrismOS
    const origin = new URL(cal).origin;
    const full = href.startsWith("http") ? href : origin + href;
    const g = await dav("GET", full, auth);
    if (g.status >= 300) continue;
    const ev = parseICS(g.text);
    if (!ev.start_at) continue;
    // avoid duplicating one we already imported
    const { data: existing } = await svc.from("events").select("id").eq("user_id", conn.user_id).eq("icloud_href", full).maybeSingle();
    if (existing) continue;
    await svc.from("events").insert({
      user_id: conn.user_id, title: ev.summary || "(from iCloud)", description: ev.description, location: ev.location,
      start_at: ev.start_at, end_at: ev.end_at, all_day: ev.all_day, status: "confirmed",
      event_kind: "icloud", icloud_href: full, icloud_etag: g.etag || null,
    });
    pulled++;
  }
  // Deletes: PrismOS events we synced whose iCloud resource is gone → cancel
  for (const ev of (events || [])) {
    if (ev.status === "cancelled" || !ev.icloud_href) continue;
    const path = ev.icloud_href.replace(/^https?:\/\/[^/]+/, "");
    if (!present.has(path)) { await svc.from("events").update({ status: "cancelled", icloud_href: null, icloud_etag: null }).eq("id", ev.id); deleted++; }
  }

  await svc.from("icloud_connections").update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("user_id", conn.user_id);
  return { pushed, pulled, deleted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const isCron = token === SERVICE_ROLE;
    let conns: any[] = [];
    if (isCron) {
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
