// busy.ts — when is this person's calendar taken? ONE answer, used by both
// booking-availability (which times to offer) and booking-create (is the time
// still free at the moment of booking).
//
// Until 6 Oct 2026 each function asked the events table for rows whose
// start_at fell inside the days being shown. A repeating meeting is stored
// ONCE, on the date of its first occurrence, so every weekly meeting that began
// before this week was invisible: the booking page offered the time, and a
// client could book straight over it. This expands repeats the same way the
// calendar screen does (src/views/CalendarView.jsx, advanceDate).
//
// All-day events do not block a time (a birthday is not a meeting). Cancelled
// events do not block. `excludeEventId` is the booking being rescheduled: its
// own old time must not stop the client choosing a nearby one.

export type Interval = { s: number; e: number };
type Ev = { id: string; start_at: string; end_at: string | null; all_day: boolean | null; status: string | null; recur_freq: string | null; recur_interval: number | null; recur_until: string | null; recur_count: number | null };

// Step a wall-clock moment forward the way a person means it ("every week at
// 10:00" stays 10:00 across the clock change), in the given timezone.
function wallParts(ms: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).reduce((a: Record<string, string>, x) => (a[x.type] = x.value, a), {});
  return { y: +p.year, mo: +p.month, d: +p.day, h: p.hour === "24" ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const w = wallParts(guess, tz);
  const seen = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return guess - (seen - guess);
}

// Every occurrence of one event that touches [fromMs, toMs).
export function occurrences(ev: Ev, fromMs: number, toMs: number, tz: string): Interval[] {
  const start = new Date(ev.start_at).getTime();
  if (isNaN(start)) return [];
  const endRaw = ev.end_at ? new Date(ev.end_at).getTime() : NaN;
  const dur = !isNaN(endRaw) && endRaw > start ? endRaw - start : 3600000;   // a broken or missing end counts as an hour
  if (!ev.recur_freq) return start < toMs && start + dur > fromMs ? [{ s: start, e: start + dur }] : [];
  const step = Math.max(1, ev.recur_interval || 1);
  const until = ev.recur_until ? wallToUtc(+ev.recur_until.slice(0, 4), +ev.recur_until.slice(5, 7), +ev.recur_until.slice(8, 10), 23, 59, 59, tz) : Infinity;
  const max = ev.recur_count || 100000;
  const w = wallParts(start, tz);
  const out: Interval[] = [];
  // Start near the window instead of walking every week since the series began.
  const day = 86400000, gap = fromMs - start - dur;
  let first = 0;
  if (gap > 0) {
    if (ev.recur_freq === "daily") first = Math.floor(gap / (day * step)) - 1;
    else if (ev.recur_freq === "weekly") first = Math.floor(gap / (7 * day * step)) - 1;
    else if (ev.recur_freq === "monthly") first = Math.floor(gap / (31 * day * step)) - 1;
    else if (ev.recur_freq === "yearly") first = Math.floor(gap / (366 * day * step)) - 1;
  }
  for (let i = Math.max(0, first), guard = 0; i < max && guard < 2000; i++, guard++) {
    let y = w.y, mo = w.mo, d = w.d;
    if (ev.recur_freq === "daily") d += i * step;
    else if (ev.recur_freq === "weekly") d += 7 * i * step;
    else if (ev.recur_freq === "monthly") mo += i * step;
    else if (ev.recur_freq === "yearly") y += i * step;
    else break;
    const s = wallToUtc(y, mo, d, w.h, w.mi, w.s, tz);   // Date.UTC rolls an overflowing day or month forward
    if (s >= toMs || s > until) break;
    if (s + dur > fromMs) out.push({ s, e: s + dur });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function busyIntervals(admin: any, userId: string, fromMs: number, toMs: number, tz: string, excludeEventId?: string | null): Promise<Interval[]> {
  const cols = "id, start_at, end_at, all_day, status, recur_freq, recur_interval, recur_until, recur_count";
  const lo = new Date(fromMs - 2 * 86400000).toISOString(), hi = new Date(toMs).toISOString();
  const [once, repeating] = await Promise.all([
    admin.from("events").select(cols).eq("user_id", userId).is("recur_freq", null).gte("start_at", lo).lt("start_at", hi).limit(5000),
    admin.from("events").select(cols).eq("user_id", userId).not("recur_freq", "is", null).lt("start_at", hi).limit(5000),
  ]);
  if (once.error) throw new Error("events: " + once.error.message);
  if (repeating.error) throw new Error("events (repeating): " + repeating.error.message);
  const out: Interval[] = [];
  for (const ev of [...(once.data || []), ...(repeating.data || [])] as Ev[]) {
    if (ev.all_day || ev.status === "cancelled" || !ev.start_at) continue;
    if (excludeEventId && ev.id === excludeEventId) continue;
    out.push(...occurrences(ev, fromMs, toMs, tz));
  }
  return out;
}
