// recurrence_guard.mjs — ONE rule for when a repeating event happens, ONE for
// which day an event belongs to, and Google's own repeat rule is never lost.
//
// Dara, 6 Oct 2026: "Fix them all, please." What was wrong, each pinned here:
//   • Five places worked repeats out for themselves (calendar, Today, Plan My
//     Day, the booking server, the task scheduler) and each differed: Plan My
//     Day and the task scheduler ignored repeats entirely.
//   • "Monday, Wednesday and Friday" showed on one weekday; "the second
//     Tuesday" on a fixed date; a monthly repeat on the 31st drifted.
//   • Editing a Google event here replaced its rule with the plain form.
//   • One occurrence cancelled or moved in Google still showed at its old time.
//   • A change Google refused stayed "pending" for ever, silently, and blocked
//     Google's later changes from arriving.
//   • An all-day trip could not close its days to bookings.
// Static, no credentials. BLOCKS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
process.env.TZ = 'America/New_York';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => fs.readFileSync(p, 'utf8');
const bundle = (entry) => { const out = path.join(os.tmpdir(), 'guard_' + path.basename(entry).replace(/\W/g, '_') + '_' + process.pid + '.mjs'); buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' }); return out; };

// ── one home
expect(/^\s*export \* from '\.\.\/supabase\/functions\/_shared\/recurrence\.js';\s*$/m.test(read('src/recurrence.js')) && read('src/recurrence.js').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length === 1, 'src/recurrence.js is no longer just a pointer to the shared rule — there are two copies again');
for (const f of ['src/views/CalendarView.jsx', 'src/views/TodayView.jsx', 'src/views/PlanMyDayModal.jsx', 'src/views/GoalsBand.jsx', 'supabase/functions/_shared/busy.ts', 'supabase/functions/task-autoschedule/index.ts', 'supabase/functions/booking-availability/index.ts', 'supabase/functions/booking-create/index.ts']) {
  const t = read(f);
  expect(!/recur_freq === ['"](daily|weekly|monthly|yearly)['"]\s*\)|advanceDate\(|setMonth\(n\.getMonth\(\) \+ interval\)/.test(t), `${f} works out repeats for itself again — use the shared rule (src/recurrence.js / src/occurrences.js)`);
}
expect(/occurrencesBetween\(events, winStart, winEnd\)/.test(read('src/views/CalendarView.jsx')), 'the calendar no longer expands repeats through src/occurrences.js');
expect(/onDay\(allEvents, new Date\(\)\)/.test(read('src/views/PlanMyDayModal.jsx')), 'Plan My Day no longer sees today through src/occurrences.js — it will plan over repeating meetings');
expect(/onDay\(events, new Date\(\)\)/.test(read('src/views/TodayView.jsx')), 'the Today screen works out today\'s events for itself again');
expect(/from "\.\.\/_shared\/recurrence\.js"/.test(read('supabase/functions/task-autoschedule/index.ts')), 'the task scheduler no longer treats repeating meetings as busy');

// ── the rule itself
const { expand, describeRule, parseRule } = await import(bundle('supabase/functions/_shared/recurrence.js'));
const t = (s) => new Date(s).getTime();
const days = (a, tz = 'America/New_York') => a.map((x) => new Date(x.s).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })).join(' ; ');
const ev = (o) => ({ id: 'x', start_at: '2026-01-05T15:00:00Z', end_at: '2026-01-05T16:00:00Z', ...o });   // Mon 5 Jan 2026, 10:00 in Tampa
for (const tz of [undefined, 'America/New_York']) {
  const where = tz ? 'on the server' : 'on screen';
  expect(days(expand(ev({ recur_rule: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'] }), t('2026-10-05T04:00:00Z'), t('2026-10-12T04:00:00Z'), tz)) === 'Mon, Oct 5, 10:00 AM ; Wed, Oct 7, 10:00 AM ; Fri, Oct 9, 10:00 AM', `${where}: "Monday, Wednesday and Friday" is wrong (and 10:00 must stay 10:00 after the clocks change)`);
  expect(days(expand(ev({ start_at: '2026-01-13T15:00:00Z', end_at: '2026-01-13T16:00:00Z', recur_rule: ['RRULE:FREQ=MONTHLY;BYDAY=2TU'] }), t('2026-10-01T04:00:00Z'), t('2026-12-31T05:00:00Z'), tz)) === 'Tue, Oct 13, 10:00 AM ; Tue, Nov 10, 10:00 AM ; Tue, Dec 8, 10:00 AM', `${where}: "the second Tuesday of the month" is wrong`);
  expect(days(expand(ev({ start_at: '2026-01-31T15:00:00Z', end_at: '2026-01-31T16:00:00Z', recur_freq: 'monthly' }), t('2026-01-01T05:00:00Z'), t('2026-08-01T04:00:00Z'), tz)) === 'Sat, Jan 31, 10:00 AM ; Tue, Mar 31, 10:00 AM ; Sun, May 31, 10:00 AM ; Fri, Jul 31, 10:00 AM', `${where}: a monthly repeat on the 31st drifts (it must simply skip the short months)`);
  expect(days(expand(ev({ recur_rule: ['RRULE:FREQ=MONTHLY;BYDAY=-1FR'] }), t('2026-10-01T04:00:00Z'), t('2026-12-01T05:00:00Z'), tz)) === 'Fri, Oct 30, 10:00 AM ; Fri, Nov 27, 10:00 AM', `${where}: "the last Friday" is wrong`);
  expect(expand(ev({ recur_rule: ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5'] }), t('2026-01-01T05:00:00Z'), t('2027-01-01T05:00:00Z'), tz).length === 5, `${where}: a repeat with a set number of times is miscounted`);
  expect(days(expand(ev({ recur_rule: ['RRULE:FREQ=WEEKLY', 'EXDATE;TZID=America/New_York:20260112T100000'], recur_exdates: ['2026-01-19T15:00:00Z'] }), t('2026-01-01T05:00:00Z'), t('2026-02-01T05:00:00Z'), tz)) === 'Mon, Jan 5, 10:00 AM ; Mon, Jan 26, 10:00 AM', `${where}: an occurrence cancelled or moved in Google still shows at its old time`);
  expect(expand(ev({ recur_rule: ['RRULE:FREQ=DAILY;UNTIL=20260108T045959Z'] }), t('2026-01-01T05:00:00Z'), t('2026-02-01T05:00:00Z'), tz).length === 3, `${where}: a repeat runs past its end date`);
  expect(days(expand(ev({ start_at: '2022-01-04T15:00:00Z', end_at: '2022-01-04T16:00:00Z', recur_freq: 'weekly' }), t('2026-10-04T04:00:00Z'), t('2026-10-11T04:00:00Z'), tz)) === 'Tue, Oct 6, 10:00 AM', `${where}: a weekly meeting that began years ago is missing this week`);
}
expect(expand({ id: 'b', all_day: true, start_at: '2020-06-08T00:00:00Z', end_at: '2020-06-09T00:00:00Z', recur_rule: ['RRULE:FREQ=YEARLY'] }, t('2026-01-01T00:00:00Z'), t('2028-01-01T00:00:00Z'), 'America/New_York').map((x) => new Date(x.s).toISOString().slice(0, 10)).join(' ') === '2026-06-08 2027-06-08', 'a yearly all-day event (a birthday) lands on the wrong date');
expect(expand({ id: 'c', all_day: true, start_at: '2024-02-29T00:00:00Z', end_at: '2024-03-01T00:00:00Z', recur_freq: 'yearly' }, t('2024-01-01T00:00:00Z'), t('2030-01-01T00:00:00Z')).length === 2, 'a 29 February repeat turns into 1 March for good');
expect(describeRule(ev({ recur_rule: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'] })) === 'Every week on Mon, Wed, Fri' && parseRule(ev({})) === null, 'the repeat is no longer put into words for the event form');

// ── which day an event belongs to
const O = await import(bundle('src/occurrences.js'));
const trip = { id: 'trip', all_day: true, start_at: '2026-10-18T00:00:00Z', end_at: '2026-11-03T00:00:00Z', title: 'Cruise' };
const dinner = { id: 'din', start_at: '2026-10-06T23:00:00Z', end_at: '2026-10-07T05:30:00Z', title: 'Dinner' };   // 7:00 PM to 1:30 AM in Tampa
const idx = O.indexByDay(O.occurrencesBetween([trip, dinner, { id: 'bd', all_day: true, start_at: '2026-10-06T00:00:00Z', end_at: '2026-10-07T00:00:00Z', title: 'Birthday' }], new Date(2026, 9, 1), new Date(2026, 10, 30)));
const on = (k) => (idx.get(k) || []).map((e) => e.title).sort().join(',');
expect(on('2026-10-06') === 'Birthday,Dinner' && on('2026-10-05') === '', 'an all-day event sits on the evening before its date again');
expect(on('2026-10-07') === 'Dinner' && new Date(idx.get('2026-10-07')[0].start_at).getHours() === 0, 'an event running past midnight does not appear on the second day');
expect(on('2026-10-18') === 'Cruise' && on('2026-10-25') === 'Cruise' && on('2026-11-02') === 'Cruise' && on('2026-11-03') === '', 'a many-day all-day event shows on its first day only, or runs a day long');
expect(O.onDay([{ id: 'w', start_at: '2025-01-07T15:00:00Z', end_at: '2025-01-07T16:00:00Z', recur_freq: 'weekly', title: 'Sales meeting' }], new Date(2026, 9, 6)).length === 1, 'a repeating meeting is not on today\'s list (Plan My Day would plan over it)');

// ── what closes a day to bookings
const { intervalsOf } = await import(bundle('supabase/functions/_shared/busy.ts'));
const F = t('2026-10-20T04:00:00Z'), T = t('2026-10-21T04:00:00Z'), tzNY = 'America/New_York';
expect(intervalsOf({ all_day: true, start_at: '2026-10-20T00:00:00Z', end_at: '2026-10-21T00:00:00Z' }, F, T, tzNY).length === 0, 'a birthday closes the day to bookings');
{ const b = intervalsOf({ ...trip, blocks_time: true }, F, T, tzNY); expect(b.length === 1 && b[0].s <= F && b[0].e >= T, 'an all-day event marked "closed to bookings" does not close its days'); }
expect(intervalsOf({ ...trip, blocks_time: true }, t('2026-11-03T05:00:00Z'), t('2026-11-04T05:00:00Z'), tzNY).length === 0, 'a closed trip keeps the day after it ends closed too');
expect(intervalsOf({ status: 'cancelled', start_at: '2026-10-20T15:00:00Z', end_at: '2026-10-20T16:00:00Z' }, F, T, tzNY).length === 0, 'a cancelled event still blocks its time');

// ── Google sync keeps what Google said, and says when a change did not arrive
const sync = read('supabase/functions/calendar-sync/index.ts');
expect(/recur_rule: rule,/.test(sync) && /if \(!isUpdate\) g\.recurrence = ev\.recur_rule;/.test(sync), 'the sync no longer keeps Google\'s own repeat rule, or sends a simplified rule over it when an event is edited');
expect(/sync_status: "push_failed"/.test(sync) && /push_error: problem!\.why/.test(sync) && !/catch \(_\) \{ \/\* skip individual failures \*\/ \}/.test(sync), 'a change Google refuses is skipped in silence again');
expect(/timeZone: tz/.test(sync) && /g\.transparency = ev\.blocks_time === true \? "opaque" : "transparent"/.test(sync), 'events go to Google without a timezone, or all-day events no longer say free/busy');
expect(/lifted\.set\(g\.recurringEventId/.test(sync) && /recur_exdates: \[/.test(sync) && !/if \(g\.recurringEventId\) continue;/.test(sync), 'single cancelled or moved occurrences are ignored again');
expect(/RULES_VERSION = 2/.test(sync) && /rules_version: RULES_VERSION/.test(sync), 'existing calendars are no longer re-read once to pick up the kept rules');
const cal = read('src/views/CalendarView.jsx');
expect(/const patch = changed \? \{ \.\.\.data, sync_status: wants, push_error: null \} : data;/.test(cal), 'linking a contact to an event queues an edit to Google again');
expect(/data-testid="event-blocks"/.test(cal) && /data-testid="event-push-error"/.test(cal) && /data-testid="event-rule"/.test(cal), 'the event form lost the closed-to-bookings tick, the not-in-Google notice, or the repeat in words');

// ── a finger on a task block scrolls the day
const blk = read('src/views/DayTaskBlock.jsx');
expect(/HOLD_MS = \d+/.test(blk) && /if \(!p\.lifted\) \{[^}]*p\.strayed = true/.test(blk) && /onPointerCancel=\{cancelPress\}/.test(blk) && !/touchAction:'pan-x'/.test(blk + cal), 'a task block can be dragged without a press and hold again — scrolling the day will move tasks');
expect(/\.day-event-block\.task-block \{ touch-action: pan-x pan-y;/.test(read('src/index.css')), 'the task block stops the page scrolling under a finger again');

// ── Plan My Day and bookings
const plan = read('src/views/PlanMyDayModal.jsx');
expect(!/\.in\('sync_status', \['local', 'pending_push'\]\)/.test(plan) && /calendar-delete/.test(plan) && /setEvents\(fresh\)/.test(plan), 'Plan My Day leaves its old calendar blocks behind again, or does not show the new ones');
const cancel = read('supabase/functions/booking-cancel/index.ts');
expect(/push-send/.test(cancel) && /gmail-send/.test(cancel) && /METHOD:CANCEL/.test(cancel) && /if \(!b\.rescheduled\)/.test(cancel), 'a cancelled booking tells nobody again');
expect(/confirmDialog\(`Cancel \$\{bk\.client_name\}/.test(read('src/views/BookingsManagerModal.jsx')), 'an agent can cancel a booking, emailing the client, without being asked first');
expect(/const lost = \(rivals \|\| \[\]\)\.some/.test(read('supabase/functions/booking-create/index.ts')), 'two clients can take the same time in the same second again');

if (problems.length) { console.error(`\n==== RECURRENCE: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== RECURRENCE: clean — one repeat rule, one day rule, Google\'s rule kept, refused changes said ====');
