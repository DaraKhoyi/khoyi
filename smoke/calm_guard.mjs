#!/usr/bin/env node
// calm_guard.mjs — the app stays calm (1 Oct 2026).
//
// Josh, after a week on his iPhone: "Your brain isn't going 'my system handled
// everything', it's going '84 more things to do today'." Dara: "I was feeling
// the same — overwhelmed." Ray had been saying it nightly. The fix was a set of
// rules, and rules erode one reasonable-looking commit at a time — a count added
// back to a badge, a seventh item on the menu, "Worth a look" without its
// seven-day window. This check holds the line. BLOCKS.
//
//   1. The menu opens on five screens and More — never the full list again.
//   2. No badge is a count of how much exists (contacts.length, unread totals).
//      A badge is a dot that means "this needs you".
//   3. Today shows at most three queue items, has no "1 / N" counter, no floating
//      microphone, and reports what PrismOS did (HandledLine).
//   4. The inbox opens on THIS WEEK's mail worth a look; the rest is an archive.
//   5. Contacts does not headline a count, and suggests a touch only for people
//      whose relationship is the business.
//   6. Live: chief_queue looks back two weeks for replies, never says "N days
//      ago", honours "No reply needed"; done_for_you() exists.
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const problems = [];

// 1 — the menu
const mc = read('src/menuConfig.js');
const top = mc.slice(mc.indexOf('  return ['), mc.indexOf("{ label: 'More'"));
const topCount = (top.match(/\{ label: '/g) || []).length;
if (!/\{ label: 'More'/.test(mc)) problems.push('menu: the More group is gone — the full list is back at the top');
else if (topCount > 5) problems.push(`menu: ${topCount} entries above More — the rule is five`);

// 2 — badges
const app = read('src/App.js');
for (const bad of ['badge: contacts.length', 'badge: openTaskCount', 'badge: unreadEmailCount ||', 'badge: properties.length',
  'badge: investments.length', 'badge: brain.length', 'badge: reviewCount']) {
  if (app.includes(bad)) problems.push(`menu badge counts inventory again: "${bad}"`);
}
if (!/const barBadges = \{[^}]*> 0/.test(app)) problems.push('room bar badges are counts again — they should be needs-you dots');
if (!/worth_a_look', true\)\.gte\('last_message_at'/.test(app)) problems.push('the Inbox badge counts every unread email again');

// 3 — Today
const today = read('src/views/TodayView.jsx');
const lim = (today.match(/<ChiefQueue\b[^>]*\blimit=\{(\d+)\}/) || [])[1];
if (!lim || Number(lim) > 3) problems.push('Today: the queue is not capped at three');
if (/totalOpen\}/.test(today)) problems.push('Today: a "1 / N" counter is back');
if (!/<HandledLine\b/.test(today)) problems.push('Today: "what PrismOS did for you" is gone');
if (/<VoiceNote [^>]*\/>/.test(today) && !/<VoiceNote [^>]*inline/.test(today)) problems.push('Today: the floating microphone is back');

// 3b — a row about a person lets you read what they said, in place (Dara, 1 Oct)
const cqSrc = read('src/views/ChiefQueue.jsx');
if (!/<RecentWith contactId=\{p\.contact_id\}/.test(cqSrc)) problems.push('Today: tapping a person no longer shows what they said');
if (/days? ago/.test(read('src/views/RecentWith.jsx').replace(/\/\/[^\n]*/g, ''))) problems.push('RecentWith says "N days ago" (house rule: a date)');

// 4 — Inbox
const inbox = read('src/views/InboxView.jsx');
if (!/return 'week';/.test(inbox)) problems.push('Inbox: does not open on This week');
if (!/eq\('worth_a_look', true\)\.gte\('last_message_at', weekAgo\)/.test(inbox)) problems.push('Inbox: "This week" lost its seven-day window');
if (!/tab === 'quiet'/.test(inbox)) problems.push('Inbox: the "Everything else" archive is gone');

// 4b — one inbox, not two (panel, 1 Oct): what the overnight read flags lands in
// "This week" with its reason; the separate review pile does not come back.
if (/view: 'email_review'/.test(mc)) problems.push('menu: the separate "Email Review" pile is back — flagged mail belongs in the Inbox');
if (/needsReviewCount/.test(app)) problems.push('App: the overnight-review count is back (it inflated "to clear" with email that had its own screen)');
if (!/thread\.flagged_why/.test(inbox)) problems.push('Inbox: a flagged email no longer says why it is on the list');

// 5 — Contacts
const contacts = read('src/views/ContactsView.jsx');
if (/\{contacts\.length\} contacts/.test(contacts)) problems.push('Contacts: the header counts contacts again');
if (!/RELATIONSHIP_IS_THE_BUSINESS\.has\(c\.type\)/.test(contacts)) problems.push('Contacts: "due for a touch" ignores who the person is');

// 6 — live database
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (PAT) {
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/xlgfspnojjgvkuitcoaf/database/query', { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 160)); return j;
  };
  try {
    const [cq] = await q(`select pg_get_functiondef('public.chief_queue(integer)'::regprocedure) d`);
    if (/days ago/.test(cq.d.replace(/--[^\n]*/g, ''))) problems.push('chief_queue says "N days ago" again (house rule: a date, never a count)');
    if (!/interval '14 days' and now\(\) - interval '6 hours'/.test(cq.d)) problems.push('chief_queue looks back further than two weeks for replies');
    if (!/no_reply_needed_at/.test(cq.d)) problems.push('chief_queue ignores "No reply needed"');
    const [fl] = await q(`select pg_get_functiondef('public.stamp_worth_a_look'::regproc) d,
      (select count(*)::int from pg_trigger where tgname = 'review_item_flags_thread_trg') trg,
      pg_get_functiondef('public.email_ai_candidates'::regproc) c`);
    if (!/flagged_at is not null/.test(fl.d) || !fl.trg) problems.push('what the overnight email read flags no longer reaches the Inbox (stamp_worth_a_look / review_item_flags_thread)');
    if (!/only_promo/.test(fl.c)) problems.push('the overnight email read is paying to re-read promo-only senders again (email_ai_candidates)');
    const [dfy] = await q(`select count(*)::int n from pg_proc where proname in ('done_for_you', 'done_for_you_ack')`);
    if (dfy.n < 2) problems.push('done_for_you() / done_for_you_ack() is missing');
  } catch (e) { problems.push('could not read the live functions: ' + e.message); }
} else if (!process.env.CI) problems.push('set SUPABASE_PAT to check the live queue');

if (!problems.length) {
  console.log('==== CALM: clean — five and More; dots not counts; three on Today; this week in the Inbox; importance before any nudge ====');
  process.exit(0);
}
console.log(`==== CALM: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
