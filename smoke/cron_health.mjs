// cron_health.mjs — the 62 scheduled jobs, and whether they are actually working.
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
const failed = await q(`
  select j.jobname, count(*) n, max(d.end_time)::text last,
         left(coalesce(max(d.return_message), ''), 100) msg
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where d.end_time > now() - interval '24 hours' and d.status <> 'succeeded'
  group by 1 order by 2 desc`);
for (const f of failed) problems.push({
  kind: 'errored', job: f.jobname,
  detail: `${f.n} failed run(s) in 24h, last ${f.last}${f.msg ? ' — ' + f.msg : ''}`,
});

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
  having max(d.end_time) is null or max(d.end_time) < now() - interval '3 hours'
  order by 4 desc nulls first`);
for (const s of quiet) problems.push({
  kind: 'silent', job: s.jobname,
  detail: s.last ? `schedule "${s.schedule}" but last ran ${s.mins_ago} minutes ago`
                 : `schedule "${s.schedule}" and has NEVER run`,
});

// ── 3. succeeded, but the HTTP call behind it failed ─────────────────────────
// The important one. pg_net returns as soon as the request is queued, so cron
// cannot see a 401 or a 500 coming back from the edge function.
const http = await q(`
  select coalesce(status_code::text, 'no response') code,
         count(*) n, min(created)::text first_seen, max(created)::text last_seen,
         left(coalesce(max(content), ''), 90) body
  from net._http_response
  where created > now() - interval '24 hours' and (status_code is null or status_code >= 400)
  group by 1 order by 2 desc`);
for (const h of http) {
  // net._http_response does NOT record the URL, so a failing response cannot be
  // tied to its job directly. Name the jobs that ran on the same ticks instead
  // and say plainly that it is a shortlist — several jobs fire on the same
  // 15-minute boundary, and pretending to know which one would send whoever
  // reads this to the wrong function.
  let candidates = [];
  try {
    const c = await q(`select distinct j.jobname
      from net._http_response r
      join cron.job_run_details d
        on d.end_time between r.created - interval '90 seconds' and r.created + interval '20 seconds'
      join cron.job j on j.jobid = d.jobid
      where r.created > now() - interval '24 hours'
        and ${h.code === 'no response' ? 'r.status_code is null' : `r.status_code = ${h.code}`}
      limit 8`);
    candidates = c.map(x => x.jobname);
  } catch (_) { /* correlation is best effort */ }
  problems.push({
    kind: 'http', job: `a scheduled call returning ${h.code}`,
    detail: `${h.n} in 24h, from ${h.first_seen} to ${h.last_seen}${h.body ? ' — ' + h.body : ''}` +
      (candidates.length ? `\n      ran on the same tick: ${candidates.join(', ')} (shortlist, not the culprit)` : ''),
  });
}

const ok = await q(`select count(*) n from net._http_response
  where created > now() - interval '24 hours' and status_code between 200 and 299`);
notes.push(`${ok[0].n} scheduled calls succeeded in the last 24h`);
const jobs = await q(`select count(*) n from cron.job where active`);
notes.push(`${jobs[0].n} active jobs`);

console.log('');
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
