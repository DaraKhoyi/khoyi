// booking_guard.mjs — the public booking page can always be finished.
//
// Josh, 6 Oct 2026 (iPad): changing a phone meeting to an office meeting ended
// in "Please enter the meeting address" with no address box anywhere to enter
// one, and the page felt locked. What was wrong, each pinned here:
//   • An office meeting demanded an address from the visitor, who is given no
//     box for it (the office's address is the agent's, shown read-only).
//   • Every tap redrew the page and wiped the name, email, phone and notes
//     already typed.
//   • A dropped connection left the button on "Booking…" for good.
//   • The agent's own settings said the office address was "under About you
//     above"; it was on a different settings page.
//   • Repeating meetings did not count as busy, so a client could book over one.
//   • A booking that failed to save was still announced as "You're booked!".
// Static, no credentials. BLOCKS.
import fs from 'node:fs';
import { transformSync } from 'esbuild';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => fs.readFileSync(p, 'utf8');

const page = read('public/book.html');
expect(/t\.needsAddress&&!t\.office&&!address/.test(page) && !/if\(t\.needsAddress&&!address\)/.test(page), 'the booking page demands an address for an office meeting again — the visitor has no box to enter one');
expect(/function keep\(\)/.test(page) && /function render\(\)\{\s*keep\(\);/.test(page), 'the booking page no longer keeps what the visitor typed when it redraws');
expect(/catch\(e\)\{return \{ok:false,error:"network"\};\}/.test(page) && /AbortController/.test(page), 'a dropped connection can leave the booking button stuck again');
expect(!/toISOString\(\)\.slice\(0,10\)/.test(page), 'the booking page works out "today" in London time again (wrong after 8 PM in Tampa)');
expect(/font-size:16px;color:var\(--ink\)/.test(page), 'booking page boxes are under 16px again — iPhones zoom the page when one is tapped');
for (const code of ['slot_taken', 'address_required', 'too_soon', 'too_far', 'type_unavailable', 'could_not_save', 'network', 'rate_limited']) expect(page.includes(code + ':"'), `the booking page has no plain words for "${code}" — the visitor is told only that something went wrong`);

expect(/A confirmation email could not be sent just now/.test(page), 'the booking page says a confirmation was sent when none was');
const create = read('supabase/functions/booking-create/index.ts'), avail = read('supabase/functions/booking-availability/index.ts');
expect(/if \(type\.office\) location = address \|\| us\.office_address \|\| /.test(create), 'the server no longer accepts an office meeting without an address from the visitor');
expect(/busyIntervals\(/.test(create) && /busyIntervals\(/.test(avail), 'the booking functions stopped using the shared answer for "taken" (_shared/busy.ts) — repeating meetings will be booked over');
expect(/if \(evErr \|\| !ev\?\.id\) return json\(\{ ok: false, error: "could_not_save" \}/.test(create) && /if \(bkErr\)/.test(create), 'a booking that fails to save is announced as booked again');
const settings = read('src/views/SettingsView.jsx');
expect(/data-testid="booking-office-address"/.test(settings) && !/is set under “About you” above/.test(settings), 'the booking settings lost their office address box, or point to another page for it again');
expect(/NOT cancelled/.test(read('src/views/BookingsManagerModal.jsx')), 'cancelling a booking reports success even when it failed');

// ── repeats count as busy, in Tampa time across the clock change
const js = transformSync(read('supabase/functions/_shared/busy.ts'), { loader: 'ts', format: 'esm' }).code;
const { occurrences } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const tz = 'America/New_York', t = (s) => new Date(s).getTime(), at = (a) => a.map((x) => new Date(x.s).toISOString().slice(0, 16)).join(',');
const weekly = { id: 'a', start_at: '2025-01-07T15:00:00Z', end_at: '2025-01-07T16:00:00Z', recur_freq: 'weekly', recur_interval: 1 };   // Tuesdays 10:00 in Tampa
expect(at(occurrences(weekly, t('2026-10-04T04:00:00Z'), t('2026-10-11T04:00:00Z'), tz)) === '2026-10-06T14:00', 'a weekly meeting that began last year is not counted as busy this week (or is counted at the wrong hour after the clock change)');
expect(occurrences({ ...weekly, recur_until: '2026-09-30' }, t('2026-10-04T04:00:00Z'), t('2026-10-11T04:00:00Z'), tz).length === 0, 'a repeating meeting that has ended still blocks time');
expect(occurrences({ ...weekly, recur_freq: 'daily', recur_count: 3 }, t('2025-01-01T00:00:00Z'), t('2025-02-01T00:00:00Z'), tz).length === 3, 'a repeat with a set number of times is miscounted');
expect(at(occurrences({ ...weekly, recur_freq: 'yearly', recur_interval: 2 }, t('2027-01-01T05:00:00Z'), t('2027-02-01T05:00:00Z'), tz)) === '2027-01-07T15:00', 'an every-other-year repeat is miscounted');
expect(occurrences({ id: 'b', start_at: '2026-10-06T14:00:00Z', end_at: '2026-10-06T13:00:00Z', recur_freq: null }, t('2026-10-06T14:30:00Z'), t('2026-10-06T15:00:00Z'), tz).length === 1, 'an event with a broken end time blocks nothing');

if (problems.length) { console.error(`\n==== BOOKING: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== BOOKING: clean — an office meeting can be booked, typed details are kept, repeats count as busy ====');
