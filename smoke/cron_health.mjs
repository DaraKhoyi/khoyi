// cron_health.mjs — the scheduled jobs, and whether they are actually working.
//
// Nothing watched them. commitment-nudge could stop firing tomorrow and the
// first sign would be Dara noticing, a week later, that he had stopped getting
// texts. With 62 jobs that is not a hypothetical.
//
// Three failures, in rising order of how well they hide:
//
//   1. The job errored. cron.job_run_details says so. Easy, and nobody looks.
//
//   2. The job has not run when it should have. A disabled or stuck job leaves
//      no error at all — it simply stops, and silence looks exactly like a quiet
//      period.
//
//   3. THE ONE THAT MATTERS: the job "succeeded" and the work still did not
//      happen. Almost every job here is a net.http_post to an edge function.
//      pg_net queues the request and returns an id immediately, so cron records
//      SUCCESS for a call that came back 401. Found on the first run of this
//      check: 24 unauthorized responses in six hours, every one reported as a
//      successful cron run.
//
// Usage: SUPABASE_PAT=... node smoke/cron_health.mjs

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== CRON HEALTH: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

// The Management API rate-limits; back off rather than dying half-checked and
// reporting a crash that reads like a code fault.
async function q(sql, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'User-Agent': 'KhoyiApp/1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
    await new Promise(res => setTimeout(res, 800 * (i + 1) * (i + 1)));
  }
  throw new Error('rate limited');
}

const problems = [];
const notes = [];

// ── 1. jobs that errored ─────────────────────────────────────────────────────
// ONE RULE for errors, here and in section 3: a failure BLOCKS while it is
// current (the job's latest run failed) or a pattern (2+ in 24h). A single
// failure that later successful runs have already superseded is REPORTED, not
// blocking. Without that, one bad run held every deploy for a full day — found
// 26 Sep, when a monitor run that failed once at 19:45 and succeeded every 15
// minutes after would have blocked shipping until 19:45 the next evening. A
// daily job that fails stays blocking until its next run succeeds, so nothing
// real slips through.
const superseded = [];
const failed = await q(`
  with d as (
    select j.jobname, d.status, d.end_time, d.return_message,
           row_number() over (partition by j.jobid order by d.start_time desc) rn
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.end_time > now() - interval '24 hours'
  )
  select jobname, count(*) filter (where status <> 'succeeded') n,
         bool_or(rn = 1 and status <> 'succeeded') latest_failed,
         max(end_time) filter (where status <> 'succeeded')::text last,
         left(coalesce(max(return_message) filter (where status <> 'succeeded'), ''), 100) msg
  from d group by 1
  having count(*) filter (where status <> 'succeeded') > 0
  order by 2 desc`);
for (const f of failed) {
  const entry = { kind: 'errored', job: f.jobname,
    detail: `${f.n} failed run(s) in 24h, last ${f.last}${f.msg ? ' — ' + f.msg.split('\n')[0] : ''}` };
  if (f.latest_failed || Number(f.n) >= 2) problems.push(entry);
  else superseded.push(entry);
}

// ── 2. jobs that have gone quiet ─────────────────────────────────────────────
// Only for jobs that run at least hourly; a monthly job has not "gone quiet"
// because it did not run today, and flagging it would be noise.
const quiet = await q(`
  select j.jobname, j.schedule, max(d.end_time)::text last,
         round(extract(epoch from (now() - max(d.end_time))) / 60) mins_ago
  from cron.job j left join cron.job_run_details d on d.jobid = j.jobid
  where j.active
    and (j.schedule like '%/%' or j.schedule like '0 * * * *')
  group by 1, 2
  order by 4 desc nulls first`);
// A FLAT THRESHOLD IS WRONG FOR A MIXED SCHEDULE. Three hours flagged
// new-listing-sweep-6h, which runs every SIX hours and was working perfectly.
// Derive what "overdue" means from the job's own cron expression: a */15 job is
// late after an hour, a 6-hourly job is not late until well past six.
const overdueFor = (schedule) => {
  // Read the MINUTE and HOUR fields as they actually appear. The first version
  // required the minute to be */N or 0, so "15 */6 * * *" — a six-hourly job
  // that fires at quarter past — matched nothing, fell back to a flat three
  // hours, and was reported dead while working perfectly. Cron expressions in
  // this project use every shape; the parser has to as well.
  const [minute = '', hour = ''] = String(schedule || '').split(/\s+/);
  const perMin = /^\*\/(\d+)$/.exec(minute);
  if (perMin) return Math.max(60, Number(perMin[1]) * 4);   // every N minutes
  const perHour = /^\*\/(\d+)$/.exec(hour);
  if (perHour) return Number(perHour[1]) * 60 * 2;          // every N hours
  if (hour === '*') return 180;                             // hourly
  return 60 * 30;                                           // daily or rarer
};
for (const s of quiet.filter(x => x.mins_ago === null || Number(x.mins_ago) > overdueFor(x.schedule))) problems.push({
  kind: 'silent', job: s.jobname,
  detail: s.last ? `schedule "${s.schedule}" but last ran ${s.mins_ago} minutes ago`
                 : `schedule "${s.schedule}" and has NEVER run`,
});

// ── 3. succeeded, but the HTTP call behind it failed ─────────────────────────
// The important one. pg_net returns as soon as the request is queued, so cron
// cannot see a 401 or a 500 coming back from the edge function.
//
// REWRITTEN 26 Sep. The first version read net._http_response alone, which has
// two faults nobody had measured:
//   * It keeps SIX HOURS, not 24 (pg_net.ttl; we cannot raise it). So "24h"
//     was false, and a daily job that failed at 3am was invisible by 9am.
//   * It has no URL, so failures were reported as "a scheduled call" with a
//     shortlist of suspects. The day it blocked a push it blamed a network blip;
//     the job name, one table away, said all five were quo-call-process.
// public.worker_calls already had both answers: every call made through
// cron_call(), by job name, with its outcome captured every five minutes and
// kept for days. All 50 HTTP jobs now go through cron_call (eight did not
// until 26 Sep, including night-review and commitment-nudge).
//
// And the rule changed, deliberately, because "no response" and "an error
// response" are different facts:
//   BLOCKS  an error status (>= 400) in 24h — the function answered and said no.
//           That is our fault and it repeats; a daily job may only show it once.
//   BLOCKS  a job failing EVERY call in the last hour (workers_failing_every_run,
//           the same SQL the texted alert uses — one rule, one place).
//   BLOCKS  a slow job's proof of work missing (PROOF below).
//   REPORTS a job that sometimes outlives the 30-second wait. The call stops
//           waiting; the function does not stop working. Measured 26 Sep:
//           chief-of-staff never once answered in time in 8 days, and wrote its
//           briefing for all 14 users every morning at 06:01. Blocking deploys
//           on that would be crying wolf — and a guard that cries wolf is turned
//           off. So slow jobs are proved by their OUTPUT instead.
const DAY = `(now() at time zone 'America/New_York')::date`;
const NY_HOUR = `extract(hour from now() at time zone 'America/New_York')`;
const PROOF = {
  // chief-of-staff-daily retired 29 Sep: the Chief of Staff is now a live queue (chief_queue()).
  'email-nightly-intel-daily': {
    what: 'a successful nightly email-intel run in the last 26h (runs 03:30)',
    sql: `select count(*) n from public.email_intel_runs where status = 'ok' and started_at > now() - interval '26 hours'`,
  },
  // The Gold Report import answered ok and imported ZERO rows every day from
  // 22 Sep to 27 Sep (a note row was added above the headers). Proof is rows
  // written, not a 200. Runs 10:00; allow until 11:00 the next day.
  'sheets-sync-daily': {
    what: 'the Gold Report import wrote rows within the last 26 hours',
    sql: `select count(*) n from public.brokerage_transactions where imported_at > now() - interval '26 hours'`,
  },
  // The morning briefing reached Dara on 3 of 10 mornings while every run
  // "succeeded" (26 Sep). Proof here is the DELIVERY: once a user's catch-up
  // window (send_hour + 4h) has closed, today must be stamped delivered. This
  // one counts FAILURES, so it passes at zero and names who missed and why.
  'ari-briefing-deliver-hourly': {
    what: 'every enabled morning briefing delivered once its window has closed',
    missing: `select coalesce(string_agg(coalesce(u.email, p.user_id::text) || ': ' || coalesce(p.last_result, 'never attempted'), '; '), '') who, count(*) n
      from public.ari_briefing_prefs p left join auth.users u on u.id = p.user_id
      where p.enabled
        and extract(hour from now() at time zone coalesce(p.tz, 'America/New_York')) >= coalesce(p.send_hour, 7) + 4
        and coalesce(p.last_delivered_date, date '1900-01-01') < (now() at time zone coalesce(p.tz, 'America/New_York'))::date
        -- a user with no way to receive it is a setup fact, not a delivery failure —
        -- but only if TODAY's run actually looked and said so
        and not (coalesce(p.last_result, '') like 'no delivery channel%'
                 and (p.last_attempt_at at time zone coalesce(p.tz, 'America/New_York'))::date = (now() at time zone coalesce(p.tz, 'America/New_York'))::date)`,
  },
};

const failing = await q(`select * from public.workers_failing_every_run(interval '60 minutes')`);
for (const f of failing) problems.push({
  kind: 'down', job: f.job_name,
  detail: `every call in the last hour failed (${f.fails}/${f.runs}), last ${f.last_status ?? 'no response'} — doing nothing at all`,
});

// Outcomes per job over 24h. Recent calls may not be captured yet, so read the
// live response too — bounded by the created index FIRST: net._http_response
// has no index on id, and an unbounded join by id cost 100s on 26 Sep.
const outcomes = await q(`
  with resp as materialized (
    select id, status_code from net._http_response where created > now() - interval '25 hours'
  ), c as (
    select w.job_name, w.called_at, coalesce(r.status_code, w.outcome_status) sc,
           (r.id is not null or w.outcome_recorded_at is not null) settled
    from public.worker_calls w left join resp r on r.id = w.request_id
    where w.called_at > now() - interval '24 hours' and w.called_at < now() - interval '45 seconds'
  )
  select job_name, count(*) calls,
         count(*) filter (where settled and sc is null) no_resp,
         count(*) filter (where sc >= 400) errs,
         string_agg(distinct sc::text, ',') filter (where sc >= 400) err_codes,
         to_char(max(called_at) filter (where settled and sc is null) at time zone 'America/New_York', 'Dy HH24:MI') last_no_resp,
         to_char(max(called_at) filter (where sc >= 400) at time zone 'America/New_York', 'Dy HH24:MI') last_err,
         (array_agg(sc order by called_at desc) filter (where settled))[1] >= 400 latest_err
  from c group by 1
  having count(*) filter (where settled and sc is null) > 0 or count(*) filter (where sc >= 400) > 0
  order by 4 desc, 3 desc`);
const slow = [];
for (const o of outcomes) {
  if (Number(o.errs) > 0) {
    const entry = { kind: 'http', job: o.job_name,
      detail: `${o.errs} of ${o.calls} calls in 24h answered with an error (${o.err_codes}), last ${o.last_err} NY` };
    // Same rule as section 1: current or repeated blocks; one superseded error reports.
    if (o.latest_err || Number(o.errs) >= 2) problems.push(entry); else superseded.push(entry);
  }
  if (Number(o.no_resp) > 0) slow.push(o);
}
for (const [job, p] of Object.entries(PROOF)) {
  if (p.missing) {
    let r = null;
    try { r = (await q(p.missing))[0]; } catch (e) { r = null; }
    if (!r) problems.push({ kind: 'no-output', job, detail: `proof query failed: ${p.what}` });
    else if (Number(r.n) > 0) problems.push({ kind: 'no-output', job, detail: `${r.n} missed — ${p.what}: ${r.who}` });
    continue;
  }
  let n = -1, why = '';
  try { n = Number((await q(p.sql))[0].n); } catch (e) { n = -1; why = String(e?.message || e).slice(0, 160); }
  // Say WHY the proof query failed — "proof query failed" alone cannot be told
  // apart from a real outage (29 Sep: it failed only inside the full gate).
  if (!(n > 0)) problems.push({ kind: 'no-output', job, detail: `no proof of work: expected ${p.what}${n < 0 ? ' (proof query failed: ' + why + ')' : ''}` });
}

// Failures that no scheduled job owns (a trigger or the app calling out).
// Reported, not blocking: this check is about the jobs.
const orphan = await q(`
  select coalesce(status_code::text, 'no response') code, count(*) n
  from net._http_response r
  where r.created > now() - interval '6 hours' and (r.status_code is null or r.status_code >= 400)
    and not exists (select 1 from public.worker_calls w where w.request_id = r.id)
  group by 1`);

const ok = await q(`select count(*) n from net._http_response
  where created > now() - interval '6 hours' and status_code between 200 and 299`);
notes.push(`${ok[0].n} calls answered OK in the last 6h`);
const jobs = await q(`select count(*) n from cron.job where active`);
notes.push(`${jobs[0].n} active jobs`);

const report = () => {
  if (slow.length) {
    console.log('  Outlived the 30s wait (reported, not blocking — the work usually finishes anyway):');
    for (const o of slow) console.log(`    · ${o.job_name}: ${o.no_resp} of ${o.calls} calls, last ${o.last_no_resp} NY${PROOF[o.job_name] ? ' — output verified' : ''}`);
  }
  for (const e of superseded) console.log(`  · [${e.kind}, since succeeded — reported, not blocking] ${e.job}: ${e.detail}`);
  for (const o of orphan) console.log(`  · ${o.n} non-scheduled call(s) → ${o.code} in the last 6h (reported, not blocking)`);
};
console.log('');
report();
if (!problems.length) {
  console.log(`==== CRON HEALTH: clean — ${notes.join(', ')} ====`);
  process.exit(0);
}
for (const p of problems) {
  console.log(`  ✗ [${p.kind}] ${p.job}`);
  console.log(`      ${p.detail}`);
}
console.log('');
console.log(`  ${notes.join(', ')}.`);
console.log('');
console.log('  A cron job that reports success is not the same as work that happened: pg_net');
console.log('  returns the moment the request is QUEUED, so a 401 from the edge function is');
console.log('  recorded as a successful run. That is why this checks the responses and not');
console.log('  just the job log.');
console.log('');
console.log(`==== CRON HEALTH: ${problems.length} problem(s) ====`);
process.exit(1);
