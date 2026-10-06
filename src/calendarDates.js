// calendarDates.js — the date arithmetic of the calendar, kept apart from the
// drawing so it can be checked without a browser (smoke/calendar_guard.mjs).
//
// ALL-DAY EVENTS ARE DATES, NOT MOMENTS. They are stored the way Google sends
// them: start = midnight UTC of the first day, end = midnight UTC of the day
// AFTER the last day. Read as a moment, midnight UTC is 8 PM the evening
// before in Tampa, so every birthday, holiday and school closing sat one day
// early. Read the date, never the moment.
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(new Date(iso).toISOString()); return new Date(+m[1], +m[2] - 1, +m[3]); };

// The first day of an all-day event, as a local date.
export const allDayStart = (startIso) => utcDay(startIso);
// The LAST day to show (the stored end is the day after it).
export function allDayEndShown(startIso, endIso) {
  const s = utcDay(startIso);
  if (!endIso) return s;
  const e = utcDay(endIso); e.setDate(e.getDate() - 1);
  return e > s ? e : s;
}
// What to store for an all-day event running from startDate to endDate inclusive.
export function allDayRange(startDate, endDate) {
  const last = (endDate && endDate >= startDate) ? endDate : startDate;
  const [y, m, d] = last.split('-').map(Number);
  const after = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start_at: `${startDate}T00:00:00.000Z`, end_at: `${after}T00:00:00.000Z` };
}

// When the start moves, the end moves with it and the event keeps its length.
export function followStart(was, now) {
  const at = (date, time) => new Date(`${date}T${time || '00:00'}:00`);
  const s0 = at(was.startDate, was.startTime), e0 = at(was.endDate || was.startDate, was.endTime), s1 = at(now.startDate, now.startTime);
  if (isNaN(s0) || isNaN(e0) || isNaN(s1)) return { endDate: now.startDate, endTime: was.endTime };
  const e1 = new Date(s1.getTime() + Math.max(0, e0 - s0));
  return { endDate: ymdOf(e1), endTime: `${pad(e1.getHours())}:${pad(e1.getMinutes())}` };
}

// Why this form cannot be saved, in words; '' when it can.
export function eventFormProblem({ title, allDay, startDate, startTime, endDate, endTime }) {
  if (!String(title || '').trim()) return 'Give the event a title.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) return 'Choose a start date.';
  const end = endDate || startDate;
  if (allDay) return end < startDate ? 'The end date is before the start date.' : '';
  const s = new Date(`${startDate}T${startTime}:00`), e = new Date(`${end}T${endTime}:00`);
  if (isNaN(s)) return 'Choose a start time.';
  if (isNaN(e)) return 'Choose an end time.';
  if (e < s) return 'This event ends before it starts. Change the end, or the start.';
  return '';
}

// Step whole months without skipping one: on the 31st, plain setMonth(+1)
// lands in the month after next.
export function stepMonth(d, delta) {
  const day = d.getDate(), n = new Date(d.getFullYear(), d.getMonth() + delta, 1, d.getHours(), d.getMinutes());
  const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  n.setDate(Math.min(day, last));
  return n;
}
