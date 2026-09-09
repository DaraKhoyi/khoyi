// What time is it, and what day is it?
//
// PrismOS runs on NEW YORK TIME, always. The brokerage is in Tampa and nearly
// every agent is Eastern, so a date in this app means a New York date. The
// device supplies the INSTANT; it never supplies the ZONE. Dara in Budapest and
// Josh in Lutz must see the same "today", and a task due Tuesday must not read
// as Monday because someone opened the app on a plane.
//
// THE BUG THIS REPLACES. Thirty places computed today as:
//
//     new Date().toISOString().slice(0, 10)
//
// toISOString() is UTC. From 8pm Eastern (7pm in winter) until midnight, UTC has
// already rolled over, so the app writes and compares TOMORROW'S date while the
// user is still in today. That is why times appeared in the future, and why a
// task logged in the evening could land on the wrong day. Verified against the
// live database: at the time of writing Postgres reported current_date as
// 2026-09-09 while New York was still on 2026-09-08.
//
// ALWAYS THE IANA ZONE, NEVER AN OFFSET. 'America/New_York' asks the zone
// database whether it is EST or EDT on that specific date. A hardcoded -05:00 is
// wrong for eight months of the year, and -04:00 is wrong for the other four —
// the exact arithmetic that produces an hour of drift twice a year and is
// invisible in between.

export const ZONE = 'America/New_York';

// en-CA formats as YYYY-MM-DD, which is what we compare and store.
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** The current instant. The device clock is trusted for WHEN, never for WHERE. */
export const now = () => new Date();

/** Today's date in New York, as YYYY-MM-DD. Use instead of toISOString().slice(0,10). */
export function todayNY(d) {
  return dayFmt.format(d || new Date());
}

/** Any date as its New York calendar day, YYYY-MM-DD. */
export const dayNY = (d) => dayFmt.format(d instanceof Date ? d : new Date(d));

/** Is this timestamp today in New York? */
export const isTodayNY = (d) => !!d && dayNY(d) === todayNY();

/** Days between two instants, counted in New York calendar days, not 24-hour blocks. */
export function daysBetweenNY(a, b) {
  const [ay, am, ad] = dayNY(a).split('-').map(Number);
  const [by, bm, bd] = dayNY(b || new Date()).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** New York wall-clock parts. Hour is 0-23. */
export function partsNY(d) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(d || new Date())) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: p.hour === '24' ? 0 : +p.hour,   // some engines emit 24 for midnight
    minute: +p.minute, second: +p.second,
  };
}

/** The New York UTC offset in minutes on a given date — +DST aware. */
export function offsetMinutesNY(d) {
  const at = d || new Date();
  const p = partsNY(at);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant of New York midnight starting that day. */
export function startOfDayNY(d) {
  const day = dayNY(d || new Date());
  const guess = new Date(day + 'T00:00:00Z');
  // Subtract the offset that applies ON THAT DAY, so the boundary is right in
  // both EST and EDT and across the two days a year when the offset changes.
  return new Date(guess.getTime() - offsetMinutesNY(guess) * 60000);
}

/** The instant just before the next New York midnight. */
export const endOfDayNY = (d) =>
  new Date(startOfDayNY(d).getTime() + 86400000 - 1);

/** Display helpers, all pinned to New York. */
export const timeNY = (d, opts) => new Intl.DateTimeFormat('en-US',
  { timeZone: ZONE, hour: 'numeric', minute: '2-digit', ...(opts || {}) })
  .format(d instanceof Date ? d : new Date(d));

export const dateNY = (d, opts) => new Intl.DateTimeFormat('en-US',
  { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', ...(opts || {}) })
  .format(d instanceof Date ? d : new Date(d));

/** True when the device is not on New York time — for a one-line note in the UI. */
export function deviceIsElsewhere() {
  try {
    const dev = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!dev || dev === ZONE) return false;
    // Same offset right now (e.g. America/Toronto) is not "elsewhere" to a user.
    const a = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hour12: false }).format(new Date());
    const b = new Intl.DateTimeFormat('en-US', { timeZone: dev, hour: 'numeric', hour12: false }).format(new Date());
    return a !== b;
  } catch (_) { return false; }
}

export default { ZONE, now, todayNY, dayNY, isTodayNY, daysBetweenNY, partsNY, startOfDayNY, endOfDayNY, timeNY, dateNY, deviceIsElsewhere };
