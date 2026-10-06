// busy.ts — when is this person's calendar taken? ONE answer, used by both
// booking-availability (which times to offer) and booking-create (is the time
// still free at the moment of booking).
//
// Repeating meetings count: a repeat is stored once, on the date of its first
// occurrence, and is expanded here by the same rule the calendar screen uses
// (recurrence.js, the same file the app reads).
//
// All-day events: a birthday is not a meeting, so an all-day event does NOT
// block — unless it is marked to (events.blocks_time, the "Keep these days
// closed to bookings" tick on the event, for a trip or a day off). Then every
// day it covers is closed, midnight to midnight in the person's own timezone.
//
// Cancelled events do not block. `excludeEventId` is the booking being
// rescheduled: its own old time must not stop the client choosing a nearby one.
// @ts-ignore plain JavaScript shared with the app
import { expand } from "./recurrence.js";

export type Interval = { s: number; e: number };

function wallToUtc(y: number, mo: number, d: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(guess)).reduce((a: Record<string, string>, x) => (a[x.type] = x.value, a), {});
  const seen = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second);
  return guess - (seen - guess);
}

// deno-lint-ignore no-explicit-any
export function intervalsOf(ev: any, fromMs: number, toMs: number, tz: string): Interval[] {
  if (!ev.start_at || ev.status === "cancelled") return [];
  if (!ev.all_day) return expand(ev, fromMs, toMs, tz).map((o: Interval) => ({ s: o.s, e: o.e }));
  if (ev.blocks_time !== true) return [];
  // An all-day event is stored as dates in UTC (start = first day, end = the
  // day after the last). Turn each occurrence into those days in the person's zone.
  const pad = 2 * 86400000;
  return expand(ev, fromMs - pad, toMs + pad, tz).map((o: Interval) => {
    const a = new Date(o.s), b = new Date(o.e);
    return { s: wallToUtc(a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate(), tz), e: wallToUtc(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), tz) };
  }).filter((x: Interval) => x.s < toMs && x.e > fromMs);
}

// deno-lint-ignore no-explicit-any
export async function busyIntervals(admin: any, userId: string, fromMs: number, toMs: number, tz: string, excludeEventId?: string | null): Promise<Interval[]> {
  const cols = "id, start_at, end_at, all_day, status, blocks_time, recur_freq, recur_interval, recur_until, recur_count, recur_rule, recur_exdates";
  const lo = new Date(fromMs - 40 * 86400000).toISOString(), hi = new Date(toMs + 2 * 86400000).toISOString();
  const [once, repeating] = await Promise.all([
    // 40 days back: a long all-day block (a trip) starts well before the days it closes
    admin.from("events").select(cols).eq("user_id", userId).is("recur_freq", null).is("recur_rule", null).gte("start_at", lo).lt("start_at", hi).limit(5000),
    admin.from("events").select(cols).eq("user_id", userId).or("recur_freq.not.is.null,recur_rule.not.is.null").lt("start_at", hi).limit(5000),
  ]);
  if (once.error) throw new Error("events: " + once.error.message);
  if (repeating.error) throw new Error("events (repeating): " + repeating.error.message);
  const out: Interval[] = [];
  for (const ev of [...(once.data || []), ...(repeating.data || [])]) {
    if (excludeEventId && ev.id === excludeEventId) continue;
    out.push(...intervalsOf(ev, fromMs, toMs, tz));
  }
  return out;
}
