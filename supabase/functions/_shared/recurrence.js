// recurrence.js — when does a repeating event happen? ONE answer.
//
// The calendar screen, Plan My Day and the booking page each used to work this
// out for themselves, and each got something different wrong:
//   • "every Monday, Wednesday and Friday" showed on one weekday only;
//   • "the second Tuesday of the month" showed on a fixed date;
//   • a monthly repeat on the 31st drifted to the 3rd and stayed there;
//   • one occurrence cancelled or moved in Google still showed at its old time;
//   • Plan My Day did not see repeating meetings at all.
// This file is the single place the rule is read. It is plain JavaScript with
// no imports, and lives with the server's shared code so the booking functions
// can use it; the app reads the very same file through src/recurrence.js.
//
// An event repeats by `recur_rule` (the rule exactly as Google gives it, an
// array of "RRULE:…" / "EXDATE…" lines) when present, otherwise by the plain
// fields an event made in PrismOS has (recur_freq, recur_interval, recur_until,
// recur_count). `recur_exdates` lists single occurrences taken out of a series.
//
// Times are worked out on the wall clock, the way a person means them: "every
// Tuesday at 10:00" stays 10:00 when the clocks change. `tz` is an IANA zone
// name; leave it out to use the device's own zone (fast, used on screen). An
// all-day event is a date, so it is always worked out in UTC.

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY = 86400000;
const fmts = new Map();
const fmt = (tz) => { let f = fmts.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); fmts.set(tz, f); } return f; };

function wall(ms, tz) {
  const d = new Date(ms);
  if (!tz) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  if (tz === 'UTC') return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  const p = {}; for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: p.hour === '24' ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}
function toMs(y, mo, d, h, mi, s, tz) {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return guess;
  const w = wall(guess, tz);
  return guess - (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - guess);
}
// Civil-calendar helpers: a day as a count of days, free of any timezone.
const dayNo = (y, mo, d) => Math.round(Date.UTC(y, mo - 1, d) / DAY);
const fromDayNo = (n) => { const d = new Date(n * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const dowOf = (n) => new Date(n * DAY).getUTCDay();
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function stamp(text, tzid) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(text || '').trim());
  if (!m) return null;
  if (!m[4]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), dateOnly: true, y: +m[1], mo: +m[2], d: +m[3] };
  if (m[7]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), dateOnly: false };
  return { ms: toMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], tzid || 'UTC'), dateOnly: false };
}

// Read the rule into one shape, whichever way the event carries it. null = does not repeat.
export function parseRule(ev) {
  const ex = [];
  for (const x of (ev.recur_exdates || [])) { const t = new Date(x).getTime(); if (!isNaN(t)) ex.push(t); }
  const lines = Array.isArray(ev.recur_rule) ? ev.recur_rule.filter((l) => typeof l === 'string') : [];
  for (const l of lines) {
    if (!/^EXDATE/i.test(l)) continue;
    const i = l.indexOf(':'); if (i < 0) continue;
    const tzid = (/TZID=([^;:]+)/i.exec(l.slice(0, i)) || [])[1];
    for (const v of l.slice(i + 1).split(',')) { const t = stamp(v, tzid); if (t) ex.push(t.ms); }
  }
  const line = lines.find((l) => /^RRULE:/i.test(l));
  const FREQ = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  if (line) {
    const p = {}; for (const kv of line.replace(/^RRULE:/i, '').split(';')) { const [k, v] = kv.split('='); if (k && v) p[k.toUpperCase()] = v; }
    const freq = FREQ[String(p.FREQ || '').toUpperCase()];
    if (!freq) return null;
    const until = p.UNTIL ? stamp(p.UNTIL) : null;
    const nums = (t) => String(t || '').split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n !== 0);
    const byday = String(p.BYDAY || '').split(',').map((t) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(t.trim())).filter(Boolean).map((m) => ({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] }));
    return { freq, interval: Math.max(1, parseInt(p.INTERVAL, 10) || 1), count: p.COUNT ? Math.max(1, parseInt(p.COUNT, 10)) : null, until, byday, bymonthday: nums(p.BYMONTHDAY), bymonth: nums(p.BYMONTH).filter((n) => n >= 1 && n <= 12), bysetpos: nums(p.BYSETPOS), wkst: WD[String(p.WKST || 'MO').toUpperCase()] ?? 1, exdates: ex };
  }
  if (!ev.recur_freq || !FREQ[String(ev.recur_freq).toUpperCase()]) return null;
  const u = ev.recur_until ? stamp(String(ev.recur_until).slice(0, 10).replace(/-/g, '')) : null;
  return { freq: ev.recur_freq, interval: Math.max(1, ev.recur_interval || 1), count: ev.recur_count || null, until: u, byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1, exdates: ex };
}

// The days of one month the rule picks, as day-of-month numbers, in order.
function monthDays(rule, y, mo, startDay) {
  const n = daysIn(y, mo); let out = [];
  if (rule.bymonthday.length) out = rule.bymonthday.map((d) => (d > 0 ? d : n + 1 + d)).filter((d) => d >= 1 && d <= n);
  else if (rule.byday.length) {
    for (const b of rule.byday) {
      const all = []; for (let d = 1; d <= n; d++) if (dowOf(dayNo(y, mo, d)) === b.wd) all.push(d);
      if (!b.n) out.push(...all); else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) out.push(pick); }
    }
  } else if (startDay <= n) out = [startDay];      // "the 31st" simply does not happen in a 30-day month
  out = [...new Set(out)].sort((a, b) => a - b);
  if (rule.bysetpos.length) out = rule.bysetpos.map((p) => (p > 0 ? out[p - 1] : out[out.length + p])).filter((d) => d != null).sort((a, b) => a - b);
  return out;
}

// Every occurrence of `ev` that touches [fromMs, toMs): [{ s, e, first }].
export function expand(ev, fromMs, toMs_, tz) {
  const start = new Date(ev.start_at).getTime();
  if (isNaN(start)) return [];
  const endRaw = ev.end_at ? new Date(ev.end_at).getTime() : NaN;
  const dur = !isNaN(endRaw) && endRaw > start ? endRaw - start : 3600000;    // a missing or broken end counts as an hour
  const rule = parseRule(ev);
  if (!rule) return start < toMs_ && start + dur > fromMs ? [{ s: start, e: start + dur, first: true }] : [];
  const zone = ev.all_day ? 'UTC' : (tz || null);
  const w = wall(start, zone), d0 = dayNo(w.y, w.mo, w.d);
  const until = rule.until ? (rule.until.dateOnly ? toMs(rule.until.y, rule.until.mo, rule.until.d, 23, 59, 59, zone) : rule.until.ms) : Infinity;
  const gone = new Set(rule.exdates);
  const goneDay = ev.all_day ? new Set(rule.exdates.map((t) => Math.floor(t / DAY))) : null;
  const k = rule.interval;
  // The candidate days of period p, as day numbers in order.
  const period = (p) => {
    if (rule.freq === 'daily') return [d0 + p * k];
    if (rule.freq === 'weekly') {
      const week0 = d0 - ((dowOf(d0) - rule.wkst + 7) % 7) + p * k * 7;
      const wds = rule.byday.length ? rule.byday.map((b) => b.wd) : [dowOf(d0)];
      return [...new Set(wds.map((wd) => week0 + ((wd - rule.wkst + 7) % 7)))].sort((a, b) => a - b);
    }
    if (rule.freq === 'monthly') {
      const idx = (w.y * 12 + (w.mo - 1)) + p * k, y = Math.floor(idx / 12), mo = (idx % 12) + 1;
      return monthDays(rule, y, mo, w.d).map((d) => dayNo(y, mo, d));
    }
    const y = w.y + p * k, months = rule.bymonth.length ? [...rule.bymonth].sort((a, b) => a - b) : [w.mo];
    const out = []; for (const mo of months) for (const d of monthDays(rule, y, mo, w.d)) out.push(dayNo(y, mo, d));
    return out;
  };
  // Without a fixed number of times, begin near the window instead of walking
  // every week since the series started.
  let p = 0;
  if (!rule.count) {
    const gap = fromMs - dur - start;
    if (gap > 0) {
      const unit = rule.freq === 'daily' ? DAY : rule.freq === 'weekly' ? 7 * DAY : rule.freq === 'monthly' ? 31 * DAY : 366 * DAY;
      p = Math.max(0, Math.floor(gap / (unit * k)) - 1);
    }
  }
  const out = []; let made = 0;
  for (let guard = 0; guard < 4000 && out.length < 5000; guard++, p++) {
    for (const n of period(p)) {
      const [y, mo, d] = fromDayNo(n);
      const s = toMs(y, mo, d, w.h, w.mi, w.s, zone);
      if (s < start) continue;
      if (rule.count && ++made > rule.count) return out;
      if (s > until || s >= toMs_) return out;
      if (gone.has(s) || (goneDay && goneDay.has(Math.floor(s / DAY)))) continue;
      if (s + dur > fromMs) out.push({ s, e: s + dur, first: s === start });
    }
  }
  return out;
}

// The rule in a person's words, for the event form ("Every week on Mon, Wed, Fri").
export function describeRule(ev) {
  const r = parseRule(ev); if (!r) return '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], nth = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let t = r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
  if (r.byday.length) t += ' on ' + (r.byday.some((b) => b.n) ? r.byday.map((b) => `the ${nth[b.n] || b.n + 'th'} ${names[b.wd]}`).join(', ') : r.byday.map((b) => names[b.wd]).join(', '));
  else if (r.bymonthday.length) t += ' on day ' + r.bymonthday.join(', ');
  if (r.count) t += `, ${r.count} times`;
  return t;
}
