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

// Repeats counting as busy, and what closes a day, are checked in smoke/recurrence_guard.mjs.

if (problems.length) { console.error(`\n==== BOOKING: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== BOOKING: clean — an office meeting can be booked, typed details are kept, repeats count as busy ====');
