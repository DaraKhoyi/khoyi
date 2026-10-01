// warn_before_set_aside.mjs — a follow-up from a call is never set aside without
// one chance to keep it.
//
// Marguerite + Skeptic (panel), 1 Oct: 248 suggestions were set aside unreviewed;
// only agents who opened the list ever kept one. The day before set-aside, the
// agent gets a push and Today shows exactly those follow-ups.
//
//   1. STATIC (blocks): the SQL warns only near/distant fuses, stays quiet at
//      night, stamps expiry_warned_at so nothing is warned twice, and is
//      scheduled; its set-aside rule matches expire_short_fuse_commitments();
//      Today's card uses the same rule and renders keep/skip in place.
//   2. LIVE (reports, does not block): with SUPABASE_PAT, the job and the column
//      exist in the database. SQL here is applied by hand, so until it is, this
//      says so loudly instead of turning every deploy red.
import { readFileSync } from 'node:fs';

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const sql = read('supabase/sql/2026-10-01_warn_before_set_aside.sql');
const rule = read('supabase/sql/2026-09-29_close_the_loop.sql');
expect(/<> 'immediate'/.test(sql), 'the warning would push about "immediate" promises the review screen hides');
expect(/v_hour < 9 or v_hour >= 19/.test(sql), 'the warning lost its quiet hours (9am–7pm New York)');
expect(/expiry_warned_at is null/.test(sql) && /set expiry_warned_at = now\(\)/.test(sql), 'a suggestion could be warned about more than once');
expect(/interval '24 hours'/.test(sql), 'the warning window is no longer the 24 hours before set-aside');
expect(/cron\.schedule\('commitments-warn-before-set-aside'/.test(sql), 'the warning is never scheduled');
expect(/'service_role_key'/.test(sql) && /functions\/v1\/push-send/.test(sql), 'the warning does not reach push-send with the key it accepts');
for (const [fuse, days] of [['immediate', 3], ['near', 14]]) {
  const re = new RegExp(`when '${fuse}' then interval '${days} days'`);
  expect(re.test(sql) && re.test(rule), `set-aside after ${days} days for '${fuse}' differs between the warning and the hourly rule`);
}
expect(/due_date < public\.today_ny\(\)/.test(rule) && /\(c\.due_date \+ 1\)::timestamp at time zone 'America\/New_York'/.test(sql),
  'the warning and the hourly rule disagree about a suggestion still dated ahead');

const today = read('src/views/TodayView.jsx');
expect(/<SetAsideTomorrow userId=\{myUserId\} \/>/.test(today), 'Today no longer shows the follow-ups being set aside tomorrow');
expect(/const FUSE_DAYS = \{ immediate: 3, near: 14 \}/.test(today) && /\|\| 30\) \* 864e5/.test(today), "Today's set-aside rule differs from the database's");
expect(/fuse\.neq\.immediate/.test(today), "Today's card would list immediate promises the review screen hides");
expect(/onlyIds=\{ids\}/.test(today) && /onlyIds \? onlyIds\.includes\(r\.id\)/.test(read('src/views/CommitmentReview.jsx')), 'the card does not render keep/skip for exactly the follow-ups at risk');

const URL_ = process.env.SUPABASE_URL, PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (URL_ && PAT) {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  try {
    const x = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
      body: JSON.stringify({ query: `select (select count(*) from cron.job where jobname = 'commitments-warn-before-set-aside') jobs,
        (select count(*) from information_schema.columns where table_name = 'commitments' and column_name = 'expiry_warned_at') cols` }) });
    const j = await x.json();
    const r = Array.isArray(j) ? j[0] : null;
    if (!r || Number(r.jobs) !== 1 || Number(r.cols) !== 1) console.log('==== WARN BEFORE SET-ASIDE: SQL NOT APPLIED — run supabase/sql/2026-10-01_warn_before_set_aside.sql ====');
    else console.log('warn_before_set_aside: live job + column present');
  } catch (e) { console.log('warn_before_set_aside: live check skipped — ' + String(e).slice(0, 120)); }
}

if (problems.length) {
  console.log('==== WARN BEFORE SET-ASIDE: FAILED ====');
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('warn_before_set_aside: OK');
