// booking-availability — public (verify_jwt=false). Computes bookable slots for
// an agent's public booking page from: work schedule (hours) − Flexible-Hours
// day overrides − Google/calendar busy times − buffer − min-notice.
// POST { slug, from?: 'YYYY-MM-DD', days?: number, duration?: number }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DURATIONS = [30, 60, 90, 120];
const MEETING_TYPES = [
  { id: "phone", label: "Phone call", needsAddress: false },
  { id: "zoom", label: "Zoom", needsAddress: false },
  { id: "google_meet", label: "Google Meet", needsAddress: false },
  { id: "office", label: "Office meeting", needsAddress: true, office: true },
  { id: "property", label: "Property showing", needsAddress: true },
  { id: "other", label: "Other location", needsAddress: true },
];

// wall-clock (Y,M,D,h,m) in a timezone -> UTC epoch ms
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(guess)).reduce((a: any, x) => (a[x.type] = x.value, a), {});
  const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? 0 : p.hour), +p.minute, +p.second);
  return guess - (seen - guess);
}
const hm = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return { h: h || 0, m: m || 0 }; };
const fmtLabel = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || "").toLowerCase().trim();
    const duration = DURATIONS.includes(+body.duration) ? +body.duration : 30;
    const days = Math.min(Math.max(+body.days || 14, 1), 31);
    if (!slug) return json({ ok: false, error: "missing slug" }, 400);

    // resolve agent
    const { data: us } = await admin.from("user_settings").select("user_id, display_name, booking_enabled, office_address, booking_slug")
      .eq("booking_slug", slug).maybeSingle();
    if (!us) return json({ ok: false, error: "not_found" }, 404);
    if (!us.booking_enabled) return json({ ok: true, enabled: false, agent: { name: us.display_name || "" } });
    const userId = us.user_id;

    // schedule
    const { data: scheds } = await admin.from("schedules").select("*").eq("user_id", userId);
    const sched = (scheds || []).find((s: any) => s.is_default) || (scheds || [])[0];
    const tz = sched?.timezone || "America/New_York";
    const hours = sched?.hours || {};
    const buffer = (sched?.buffer_minutes ?? 0) * 60000;
    const minNotice = 120 * 60000; // 2 hours
    const nowMs = Date.now();

    // date range (start from `from` or today, in agent tz)
    const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.from || "") ? body.from : todayParts;

    // busy events across the whole range
    const rangeStartUtc = wallToUtc(+startDate.slice(0, 4), +startDate.slice(5, 7), +startDate.slice(8, 10), 0, 0, tz);
    const rangeEndUtc = rangeStartUtc + days * 86400000 + 86400000;
    const { data: evs } = await admin.from("events").select("start_at, end_at, all_day, status")
      .eq("user_id", userId).gte("start_at", new Date(rangeStartUtc - 86400000).toISOString()).lte("start_at", new Date(rangeEndUtc).toISOString());
    const busy = (evs || []).filter((e: any) => e.start_at && e.end_at && e.status !== "cancelled")
      .map((e: any) => {
        if (e.all_day) return null; // all-day: treated as free for bookings unless it's a block; skip
        return { s: new Date(e.start_at).getTime() - buffer, e: new Date(e.end_at).getTime() + buffer };
      }).filter(Boolean) as { s: number; e: number }[];

    // flexible-hours overrides in range
    const { data: flex } = await admin.from("flexible_hours").select("date, rules").eq("user_id", userId)
      .gte("date", startDate).lte("date", new Date(rangeEndUtc).toISOString().slice(0, 10));
    const flexBy: Record<string, any[]> = {};
    for (const f of flex || []) flexBy[f.date] = f.rules || [];

    const out: any[] = [];
    for (let i = 0; i < days; i++) {
      const dUtc0 = wallToUtc(+startDate.slice(0, 4), +startDate.slice(5, 7), +startDate.slice(8, 10), 0, 0, tz) + i * 86400000;
      const dp = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(dUtc0 + 6 * 3600000));
      const py = +dp.find(x => x.type === "year")!.value, pm = +dp.find(x => x.type === "month")!.value, pd = +dp.find(x => x.type === "day")!.value;
      const dateStr = `${py}-${String(pm).padStart(2, "0")}-${String(pd).padStart(2, "0")}`;
      const wdKey = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(dUtc0 + 6 * 3600000)).toLowerCase().slice(0, 3);
      const rules = flexBy[dateStr] || [];
      if (rules.some((r: any) => r.type === "block_day")) { out.push({ date: dateStr, weekday: wdKey, slots: [] }); continue; }

      let windows: [number, number][] = (hours[wdKey] || []).map((w: any) => [w[0], w[1]] as [number, number]);
      // start_later / stop_early
      const sl = rules.find((r: any) => r.type === "start_later"); const se = rules.find((r: any) => r.type === "stop_early");
      if (sl) { const { h, m } = hm(sl.time); const lim = h + m / 60; windows = windows.map(([a, b]) => [Math.max(a, lim), b] as [number, number]); }
      if (se) { const { h, m } = hm(se.time); const lim = h + m / 60; windows = windows.map(([a, b]) => [a, Math.min(b, lim)] as [number, number]); }
      // build free intervals (UTC ms) from windows, then subtract flex blocks + busy
      let free: { s: number; e: number }[] = windows.filter(([a, b]) => b > a).map(([a, b]) => ({
        s: wallToUtc(py, pm, pd, Math.floor(a), Math.round((a % 1) * 60), tz),
        e: wallToUtc(py, pm, pd, Math.floor(b), Math.round((b % 1) * 60), tz),
      }));
      const subtract = (arr: { s: number; e: number }[], cut: { s: number; e: number }) => {
        const res: { s: number; e: number }[] = [];
        for (const iv of arr) {
          if (cut.e <= iv.s || cut.s >= iv.e) { res.push(iv); continue; }
          if (cut.s > iv.s) res.push({ s: iv.s, e: cut.s });
          if (cut.e < iv.e) res.push({ s: cut.e, e: iv.e });
        }
        return res;
      };
      for (const r of rules) if (r.type === "block") {
        const a = hm(r.start), b = hm(r.end);
        free = subtract(free, { s: wallToUtc(py, pm, pd, a.h, a.m, tz), e: wallToUtc(py, pm, pd, b.h, b.m, tz) });
      }
      for (const b of busy) free = subtract(free, b);
      // enforce min-notice / not-in-past
      const earliest = nowMs + minNotice;
      free = free.map(iv => ({ s: Math.max(iv.s, earliest), e: iv.e })).filter(iv => iv.e > iv.s);

      // slice into slots (30-min steps), duration must fit
      const step = 30 * 60000, dur = duration * 60000, slots: any[] = [];
      for (const iv of free) {
        // align start up to next :00/:30 in agent tz
        let t = iv.s;
        const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(new Date(t));
        const mm = +p; const addMin = mm % 30 === 0 ? 0 : (30 - (mm % 30));
        t += addMin * 60000;
        for (; t + dur <= iv.e; t += step) slots.push({ iso: new Date(t).toISOString(), label: fmtLabel(new Date(t).toISOString(), tz) });
      }
      out.push({ date: dateStr, weekday: wdKey, slots });
    }

    return json({
      ok: true, enabled: true,
      agent: { name: us.display_name || "", office_address: us.office_address || "", timezone: tz, slug },
      durations: DURATIONS, meeting_types: MEETING_TYPES, duration, days: out,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
