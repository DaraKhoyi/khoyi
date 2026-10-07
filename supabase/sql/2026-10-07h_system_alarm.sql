-- =====================================================================
-- PrismOS system alarm  (PREPARED 7 Oct 2026 — NOT APPLIED)
-- Catches any worker / edge function failing > 5% in the last hour,
-- calendar-sync specifically, pg_cron job failures, prism-mcp tool
-- errors, and monitors that stopped running. Pushes Dara's phone.
--
-- Why a new check: worker_monitor (check_worker_health) only fires when a
-- job fails EVERY run for 60 minutes, and only writes agent_runs (no push).
-- calendar-sync failed 28% of calls for days and nothing said a word.
--
-- Data it can see from Postgres (edge logs are NOT queryable from SQL):
--   * public.worker_calls  + net._http_response : every cron_call job and
--     its HTTP status (pg_net keeps responses ~6 h; capture_worker_outcomes
--     copies them into worker_calls.outcome_status every 5 min).
--   * net._http_response.content of calendar-poll : per-user calendar-sync
--     results (status + error) — the only place calendar-sync's own answers
--     are visible in the database.
--   * cron.job_run_details : SQL cron jobs that errored.
--   * public.mcp_calls : prism-mcp tool calls (ok / error).
--   * heartbeats: did each monitor actually run recently?
--
-- Alert path to the phone: public.notify_txn(...) -> pg_net -> edge
-- function push-send (service key from Vault) -> push_gate (Dara's quiet
-- hours 9 PM–8 AM ET; tag 'system-alert' is class 'prompt' so it is HELD
-- overnight and delivered by deliver_held_pushes after 8 AM) -> Web Push to
-- his 4 registered devices. Every attempt lands in push_log.
--
-- Spam control:
--   * one open alert per problem (unique key while unresolved);
--   * a NEW problem pushes at most once; a still-open problem re-reminds
--     at most once every 24 h;
--   * one push per run summarises ALL open problems (so a held overnight
--     push, which push-send collapses to the latest per tag, is complete);
--   * at most 1 push per 30 min and 6 per day for tag 'system-alert';
--   * 'slow' (cron gave up waiting at 30 s, function may still finish) is
--     severity 'info': recorded and shown in Ari's report, never pushed;
--   * auto-resolves after 30 quiet minutes (hysteresis, no flapping).
-- =====================================================================

create table if not exists public.system_alerts (
  id              uuid primary key default gen_random_uuid(),
  key             text not null,              -- 'worker:<job>', 'calendar-sync', 'cron:<job>', 'mcp', 'heartbeat:<job>'
  severity        text not null default 'fail' check (severity in ('fail','info')),
  title           text not null,
  detail          text,
  runs            int,
  fails           int,
  rate            numeric,
  opened_at       timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  resolved_at     timestamptz,
  last_notified_at timestamptz,
  notify_count    int not null default 0
);
create unique index if not exists system_alerts_one_open on public.system_alerts (key) where resolved_at is null;
create index if not exists system_alerts_opened on public.system_alerts (opened_at desc);
alter table public.system_alerts enable row level security;   -- no policies: only postgres / service_role
revoke all on public.system_alerts from anon, authenticated;

-- ---------------------------------------------------------------------
-- What is failing right now? Read-only; safe to call any time.
-- ---------------------------------------------------------------------
create or replace function public.system_error_rates(p_window interval default interval '60 minutes')
returns table(key text, severity text, title text, runs bigint, fails bigint, rate numeric, detail text)
language sql stable security definer
set search_path to 'public', 'net', 'cron', 'pg_temp'
as $fn$
  with resp as materialized (            -- bound by the created index first (see workers_failing_every_run)
    select r.id, r.status_code, r.timed_out, r.content
    from net._http_response r
    where r.created > now() - p_window - interval '2 minutes'
  ),
  calls as (
    select w.job_name, w.request_id, coalesce(resp.status_code, w.outcome_status) sc,
           (resp.id is not null and resp.status_code is null) or coalesce(resp.timed_out, false) as slow,
           resp.content
    from public.worker_calls w left join resp on resp.id = w.request_id
    where w.called_at > now() - p_window and w.called_at < now() - interval '45 seconds'
  ),
  workers as (
    select 'worker:' || job_name as key,
           count(*) runs,
           count(*) filter (where sc >= 300) fails,
           count(*) filter (where sc is null and slow) slow,
           (array_agg(sc order by sc desc nulls last))[1] worst
    from calls group by job_name
  ),
  cal as (                                -- calendar-sync answers, read out of calendar-poll's responses
    select count(*) runs,
           count(*) filter (where coalesce((e->>'status')::int, 500) >= 500) fails,
           count(distinct e->>'user_id') filter (where coalesce((e->>'status')::int, 500) >= 500) users,
           left(regexp_replace(max(e->>'error') filter (where coalesce((e->>'status')::int, 500) >= 500), '\s+', ' ', 'g'), 90) sample
    from calls c,
         lateral jsonb_array_elements(case when c.content like '{%"results"%' then c.content::jsonb -> 'results' else '[]'::jsonb end) e
    where c.job_name like 'calendar-poll%'
  ),
  cronf as (
    select 'cron:' || j.jobname as key, count(*) runs, count(*) filter (where d.status = 'failed') fails,
           left(max(d.return_message) filter (where d.status = 'failed'), 90) sample
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - p_window and d.status in ('succeeded','failed')
    group by j.jobname
  ),
  mcp as (
    select count(*) runs, count(*) filter (where not ok) fails, left(max(error) filter (where not ok), 90) sample
    from public.mcp_calls where at > now() - p_window
  ),
  beats(job, max_age) as (values          -- the watchers themselves
    ('worker-monitor-15min',             interval '35 minutes'),
    ('worker-outcome-capture-5min',      interval '15 minutes'),
    ('held-pushes-15min',                interval '35 minutes'),
    ('crash-monitor-10min',              interval '25 minutes'),
    ('google-connection-watch-10min',    interval '25 minutes'),
    ('calendar-poll-every-1min',         interval '10 minutes')
  ),
  heart as (
    select b.job, greatest(
             (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
               where j.jobname = b.job and d.status = 'succeeded' and d.start_time > now() - interval '1 day'),
             (select max(w.called_at) from public.worker_calls w
               where w.job_name = b.job and w.called_at > now() - interval '1 day' and w.outcome_status between 200 and 299)
           ) last_ok, b.max_age
    from beats b
    where exists (select 1 from cron.job j where j.jobname = b.job and j.active)
  )
  select w.key, 'fail', format('%s is failing', substr(w.key, 8)), w.runs, w.fails,
         round(w.fails::numeric / w.runs, 3), format('%s of %s runs failed in the last hour (worst HTTP %s).', w.fails, w.runs, w.worst)
    from workers w where w.fails >= 3 and w.fails::numeric / w.runs > 0.05
  union all
  select w.key || ':slow', 'info', format('%s is slow', substr(w.key, 8)), w.runs, w.slow,
         round(w.slow::numeric / w.runs, 3), format('%s of %s runs went past the 30 s cron wait (the function may still finish).', w.slow, w.runs)
    from workers w where w.slow >= 3 and w.slow::numeric / w.runs >= 0.5
  union all
  select 'calendar-sync', 'fail', 'Calendar sync is failing', c.runs, c.fails, round(c.fails::numeric / c.runs, 3),
         format('%s of %s calendar syncs failed for %s user(s) in the last hour. e.g. %s', c.fails, c.runs, c.users, coalesce(c.sample, 'no message'))
    from cal c where c.runs > 0 and c.fails >= 3 and c.fails::numeric / c.runs > 0.05
  union all
  select c.key, 'fail', format('Scheduled job %s is erroring', substr(c.key, 6)), c.runs, c.fails, round(c.fails::numeric / c.runs, 3),
         format('%s of %s runs failed. %s', c.fails, c.runs, coalesce(c.sample, ''))
    from cronf c where c.fails >= 2 and c.fails::numeric / c.runs > 0.05
  union all
  select 'mcp', 'fail', 'Prism MCP tools are erroring', m.runs, m.fails, round(m.fails::numeric / m.runs, 3),
         format('%s of %s tool calls failed. %s', m.fails, m.runs, coalesce(m.sample, ''))
    from mcp m where m.runs > 0 and m.fails >= 3 and m.fails::numeric / m.runs > 0.05
  union all
  select 'heartbeat:' || h.job, 'fail', format('Monitor %s stopped running', h.job), null, null, null,
         format('Last good run: %s.', coalesce(to_char(h.last_ok at time zone 'America/New_York', 'Mon DD HH12:MI AM') || ' ET', 'none in 24 h'))
    from heart h where h.last_ok is null or h.last_ok < now() - h.max_age
$fn$;
revoke all on function public.system_error_rates(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Open / refresh / resolve alerts, and push Dara when something NEW breaks.
-- Runs every 10 minutes from pg_cron.
-- ---------------------------------------------------------------------
create or replace function public.check_system_alarms()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_owner constant uuid := 'ad06bbc1-a1cb-4716-84d3-36f426ea3187';   -- Dara (same owner check_worker_health uses)
  r record; v_new int := 0; v_due int := 0; v_body text; v_title text; v_open int;
begin
  for r in select * from public.system_error_rates(interval '60 minutes') loop
    update public.system_alerts a
       set last_seen_at = now(), detail = r.detail, runs = r.runs, fails = r.fails, rate = r.rate, title = r.title
     where a.key = r.key and a.resolved_at is null;
    if not found then
      insert into public.system_alerts (key, severity, title, detail, runs, fails, rate)
      values (r.key, r.severity, r.title, r.detail, r.runs, r.fails, r.rate);
      if r.severity = 'fail' then
        v_new := v_new + 1;
        insert into public.agent_runs (user_id, agent, status, summary)
        values (v_owner, 'system_alarm', 'error', r.title || ': ' || r.detail);
      end if;
    end if;
  end loop;

  -- Resolve after 30 quiet minutes (no flapping).
  update public.system_alerts set resolved_at = now()
   where resolved_at is null and last_seen_at < now() - interval '30 minutes';

  -- Who needs a push? New, or still open and last reminded > 24 h ago.
  select count(*) into v_due from public.system_alerts
   where resolved_at is null and severity = 'fail'
     and (last_notified_at is null or last_notified_at < now() - interval '24 hours');
  if v_due = 0 then return v_new; end if;

  -- Global caps for this tag: 1 per 30 min, 6 per day.
  if exists (select 1 from public.push_log where user_id = v_owner and tag = 'system-alert' and created_at > now() - interval '30 minutes')
     or (select count(*) from public.push_log where user_id = v_owner and tag = 'system-alert' and created_at > now() - interval '24 hours') >= 6 then
    return v_new;
  end if;

  select count(*), string_agg(title, ' · ' order by opened_at) into v_open, v_body
    from public.system_alerts where resolved_at is null and severity = 'fail';
  v_title := case when v_open = 1 then 'PrismOS: 1 problem needs a look' else format('PrismOS: %s problems need a look', v_open) end;

  perform public.notify_txn(v_owner, v_title, left(v_body, 220), 'https://darasapp.com/', 'system-alert');

  update public.system_alerts set last_notified_at = now(), notify_count = notify_count + 1
   where resolved_at is null and severity = 'fail';
  return v_new;
end $fn$;
revoke all on function public.check_system_alarms() from public, anon, authenticated;

-- Every 10 minutes, offset from the other monitors (:03, :13, ...).
select cron.schedule('system-alarm-10min', '3-59/10 * * * *', $$select public.check_system_alarms()$$);
