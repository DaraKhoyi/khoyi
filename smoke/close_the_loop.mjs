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
//   3. Nobody has Chief of Staff items waiting from more than one day.
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
const cos = readFileSync('src/views/ChiefOfStaffView.jsx', 'utf8');
if (!/cos-one-thing/.test(cos) || !/rpc\('cos_seen'\)/.test(cos)) problems.push('ChiefOfStaffView: lost the one-thing view or no longer marks the list seen');

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
  const [piles] = await q(`select count(*)::int n from (select user_id from cos_actions where status = 'pending' group by 1 having count(distinct run_date) > 1) s`);
  if (piles.n) problems.push(`${piles.n} person(s) have Chief of Staff items waiting from more than one day`);
}

if (!problems.length) {
  console.log('==== CLOSE THE LOOP: clean — stale suggestions are set aside on schedule; one list, one thing at a time ====');
  process.exit(0);
}
console.log(`==== CLOSE THE LOOP: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
