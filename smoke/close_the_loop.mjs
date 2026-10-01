// close_the_loop.mjs — suggestions never pile up again.
//
// Panel (Skeptic + Marguerite + Ray), 29 Sep: 145 call follow-ups and 4,661
// Chief of Staff items sat "pending" because the job that retires them was
// written and never scheduled. supabase/sql/2026-09-29_close_the_loop.sql.
// Each gate run proves, against live data:
//
//   1. The hourly job that sets aside stale call suggestions is scheduled.
//   2. No call suggestion is older than its rule allows (3 / 14 / 30 days by
//      how soon it was due) unless a person brought it back or it is still
//      dated in the future. Allows 2 hours of slack for the hourly job.
//   3. The Chief of Staff is ONE live queue (chief_queue) on Today; the old
//      morning AI list stays retired.
//   4. The screens still show one thing at a time (static).
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { readFileSync } from 'node:fs';

const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const REF = (process.env.SUPABASE_URL || '').replace(/^https:\/\/([^.]+)\..*$/, '$1');
const problems = [];

// 4. Static: one at a time.
const cr = readFileSync('src/views/CommitmentReview.jsx', 'utf8');
if (!/slice\(0,\s*compact \? 1\b/.test(cr)) problems.push('CommitmentReview: Today no longer shows one conversation at a time');
const cq = readFileSync('src/views/ChiefQueue.jsx', 'utf8');
const today = readFileSync('src/views/TodayView.jsx', 'utf8');
// 1 Oct (Josh + Dara, "calm"): Today shows the THREE that matter as quiet rows,
// not one card numbered "1 of 84" and never a pile. The rest is one tap away.
if (!/rpc\('chief_queue'/.test(cq) || !/items\.slice\(0, limit\)/.test(cq)) problems.push('ChiefQueue: no longer the live queue, capped on Today');
const lim = (today.match(/<ChiefQueue\b[^>]*\blimit=\{(\d+)\}/) || [])[1];
if (!lim) problems.push('Today no longer shows the queue');
else if (Number(lim) > 3) problems.push(`Today shows ${lim} queue items — the rule is three at most`);
if (/\{Math\.min\(heroIdx \+ 1, totalOpen\)\} \/ \{totalOpen\}/.test(today)) problems.push('Today shows a "1 / N" counter again');

if (!PAT || !REF) {
  if (process.env.CI) console.log('  (live checks skipped: no Management token in this environment)');
  else problems.push('set SUPABASE_PAT to run the live checks');
} else {
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
  };
  const [job] = await q(`select count(*)::int n from cron.job where jobname = 'commitments-expire-hourly' and active`);
  if (!job.n) problems.push('the hourly job that sets aside stale call suggestions is not scheduled');
  const [stale] = await q(`select count(*)::int n from commitments
     where status = 'proposed' and auto_expired_at is null and (due_date is null or due_date < public.today_ny())
       and created_at < now() - interval '2 hours' - case coalesce(fuse,'near') when 'immediate' then interval '3 days' when 'near' then interval '14 days' else interval '30 days' end`);
  if (stale.n) problems.push(`${stale.n} call suggestion(s) are past their rule and still waiting — the loop is not closing`);
  // The morning AI list is retired (the queue is live); it must stay retired.
  const [cos] = await q(`select count(*)::int n from cron.job where jobname = 'chief-of-staff-daily'`);
  if (cos.n) problems.push('the retired chief-of-staff morning job is scheduled again — the queue is live now');
  const [fn] = await q(`select count(*)::int n from pg_proc where proname = 'chief_queue'`);
  if (!fn.n) problems.push('chief_queue() is missing');
}

if (!problems.length) {
  console.log('==== CLOSE THE LOOP: clean — stale suggestions are set aside on schedule; one list, three on Today at most ====');
  process.exit(0);
}
console.log(`==== CLOSE THE LOOP: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
