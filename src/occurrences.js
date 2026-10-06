// occurrences.js — which events fall on which day, for every screen that asks.
//
// The calendar, the week and year views and Plan My Day each used to decide
// this for themselves from an event's START alone. So: Plan My Day did not see
// repeating meetings; an all-day event belonged to the evening before; a trip
// spanning two weeks showed on its first day only; a dinner running past
// midnight drew as a sliver. One place now:
//   occurrencesBetween  — every occurrence in a span, repeats expanded
//                         (src/recurrence.js), all-day events placed on their
//                         dates (src/calendarDates.js).
//   indexByDay / onDay  — the events touching a given day, each trimmed to the
//                         part of it that lies in that day.
import { expand } from './recurrence';
import { allDayStart, allDayEndShown } from './calendarDates';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const repeats = (ev) => !!(ev && (ev.recur_freq || (Array.isArray(ev.recur_rule) && ev.recur_rule.length)));

export function occurrencesBetween(events, from, to) {
  const F = from.getTime(), T = to.getTime(), out = [];
  for (const raw of events || []) {
    if (!raw || !raw.start_at) continue;
    const rep = repeats(raw);
    for (const o of expand(raw, raw.all_day ? F - 2 * DAY : F, raw.all_day ? T + 2 * DAY : T)) {
      let s = o.s, e = o.e;
      if (raw.all_day) {
        // stored as dates (UTC midnight start, the day after the last day as end)
        const sIso = new Date(o.s).toISOString(), last = allDayEndShown(sIso, new Date(o.e).toISOString());
        last.setHours(23, 59, 0, 0);
        s = allDayStart(sIso).getTime(); e = last.getTime();
        if (!(s < T && e > F)) continue;
      }
      out.push({ ...raw, id: o.first ? raw.id : `${raw.id}__r${o.s}`, start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString(), _masterId: raw.id, _recurInstance: rep && !o.first });
    }
  }
  return out;
}

// Map of 'YYYY-MM-DD' -> the events touching that local day, earliest first.
// An event spanning several days appears on each, trimmed to that day
// (_fullStart/_fullEnd keep the whole span).
export function indexByDay(list) {
  const map = new Map();
  for (const ev of list || []) {
    const s = new Date(ev.start_at).getTime(); let e = ev.end_at ? new Date(ev.end_at).getTime() : s;
    if (!(e > s)) e = s + 1;
    const first = new Date(s); first.setHours(0, 0, 0, 0);
    for (let d = first, n = 0; d.getTime() < e && n < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), n++) {
      const dayStart = d.getTime(), dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const a = Math.max(s, dayStart), b = Math.min(e, dayEnd - 60000);
      const whole = a === s && e <= dayEnd;
      const piece = whole ? ev : { ...ev, start_at: new Date(a).toISOString(), end_at: new Date(Math.max(a, b)).toISOString(), _fullStart: ev.start_at, _fullEnd: ev.end_at, _continues: true };
      const k = dayKey(d); let arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); }
      arr.push(piece);
    }
  }
  for (const arr of map.values()) arr.sort((x, y) => new Date(x.start_at) - new Date(y.start_at));
  return map;
}

// The events touching one day (repeats expanded). For screens that need a single day.
export function onDay(events, day) {
  const a = new Date(day.getFullYear(), day.getMonth(), day.getDate()), b = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return indexByDay(occurrencesBetween(events, a, b)).get(dayKey(a)) || [];
}
