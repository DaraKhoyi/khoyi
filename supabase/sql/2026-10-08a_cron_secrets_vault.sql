-- =====================================================================
-- Move the remaining inline secrets out of pg_cron command text into Vault (8 Oct 2026)
--
-- Follows 2026-10-07i (QCP_TOKEN as x-internal-token, 7 jobs). 17 more jobs
-- still had a secret pasted into their command, readable by anyone with
-- database read access in cron.job and in every cron.job_run_details row:
--   * QCP_TOKEN as "x-qcp-token" inside a JSON literal: night-review,
--     panel-merge, commitment-nudge, panel-draft-nightly, discovery-sweep.
--   * The sb_secret service-role key as 'Bearer <key>': icloud-sync-20min.
--     It equals Vault 'service_role_key', which 25 other jobs already read.
--   * Four more x-internal-token values (names follow the function secret
--     each one is checked against):
--       email_intel_token  email-nightly-intel-daily, lead-lifecycle-3h,
--                          listing-presentation-sweep-6h, new-lead-sweep-2h,
--                          new-listing-sweep-6h, post-close-sweep-6h
--       ingest_token       bounce-scan-10min, dropbox-sync-10min, pending-process-3min
--       research_token     agent-research-drip-10min
--       cube_token         cube-acr-sync-5min
--
-- What it does (idempotent, contains no secret):
--   1. Creates each missing Vault secret by copying the value out of a job's
--      own command text.
--   2. Swaps each literal for the run-time lookup
--        (select decrypted_secret from vault.decrypted_secrets where name = ... limit 1)
--      - x-qcp-token JSON: '{"Content-Type":"application/json","x-qcp-token":"<v>"}'::jsonb
--        becomes '{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('x-qcp-token', <lookup>)
--      - icloud: 'Bearer <key>' becomes 'Bearer ' || <lookup>
--      The headers sent are identical; schedules are untouched.
--   3. Fails (and changes nothing) if any of these values is still inline afterwards.
-- A re-run finds the secrets in Vault and no literal left, so it changes nothing.
-- Rotating any of these later: update the function secret AND the Vault secret
--   (vault.update_secret((select id from vault.secrets where name = '<name>'), '<new>')).
-- =====================================================================
do $mig$
declare
  r   record;
  v   text;
  n   int := 0;
  all_jobs constant text[] := array[
    'email-nightly-intel-daily','lead-lifecycle-3h','listing-presentation-sweep-6h','new-lead-sweep-2h',
    'new-listing-sweep-6h','post-close-sweep-6h','bounce-scan-10min','dropbox-sync-10min','pending-process-3min',
    'agent-research-drip-10min','cube-acr-sync-5min','icloud-sync-20min',
    'night-review','panel-merge','commitment-nudge','panel-draft-nightly','discovery-sweep'];
begin
  -- 1. Vault secrets for the four x-internal-token values.
  for r in select * from (values
      ('email_intel_token', 'email-nightly-intel-daily', 'x-internal-token that pg_cron sends to email-nightly-intel, lead-lifecycle and the orchestrate-* sweeps (EMAIL_INTEL_TOKEN).'),
      ('ingest_token',      'bounce-scan-10min',         'x-internal-token that pg_cron sends to bounce-scan, dropbox-sync and pending-process (INGEST_TOKEN function secret).'),
      ('research_token',    'agent-research-drip-10min', 'x-internal-token that pg_cron sends to agent-research-drip (RESEARCH_TOKEN function secret).'),
      ('cube_token',        'cube-acr-sync-5min',        'x-internal-token that pg_cron sends to cube-acr-sync (CUBE_TOKEN function secret).')
    ) s(name, src, descr)
  loop
    if not exists (select 1 from vault.secrets where name = r.name) then
      select (regexp_match(command, '''x-internal-token''\s*,\s*''([^'']+)'''))[1] into v from cron.job where jobname = r.src;
      if v is null or length(v) < 20 then
        raise exception '%: not in Vault and no inline value found in %; nothing done', r.name, r.src;
      end if;
      perform vault.create_secret(v, r.name, r.descr);
    end if;
  end loop;

  -- 2a. x-internal-token literals.
  for r in
    select j.jobid, j.command, s.name from cron.job j
    join (values
      ('email_intel_token', array['email-nightly-intel-daily','lead-lifecycle-3h','listing-presentation-sweep-6h',
                                  'new-lead-sweep-2h','new-listing-sweep-6h','post-close-sweep-6h']),
      ('ingest_token',      array['bounce-scan-10min','dropbox-sync-10min','pending-process-3min']),
      ('research_token',    array['agent-research-drip-10min']),
      ('cube_token',        array['cube-acr-sync-5min'])
    ) s(name, jobs) on j.jobname = any (s.jobs)
  loop
    v := (select decrypted_secret from vault.decrypted_secrets where name = r.name limit 1);
    if v is not null and position('''' || v || '''' in r.command) > 0 then
      perform cron.alter_job(r.jobid, command := replace(r.command, '''' || v || '''',
        format('(select decrypted_secret from vault.decrypted_secrets where name = %L limit 1)', r.name)));
      n := n + 1;
    end if;
  end loop;

  -- 2b. x-qcp-token inside a JSON literal.
  v := (select decrypted_secret from vault.decrypted_secrets where name = 'qcp_token' limit 1);
  if v is null then raise exception 'Vault qcp_token missing (2026-10-07i_cron_qcp_token_vault.sql must run first)'; end if;
  for r in
    select jobid, command from cron.job
     where jobname in ('night-review','panel-merge','commitment-nudge','panel-draft-nightly','discovery-sweep')
       and position(',"x-qcp-token":"' || v || '"}''::jsonb' in command) > 0
  loop
    perform cron.alter_job(r.jobid, command := replace(r.command, ',"x-qcp-token":"' || v || '"}''::jsonb',
      '}''::jsonb || jsonb_build_object(''x-qcp-token'', (select decrypted_secret from vault.decrypted_secrets where name = ''qcp_token'' limit 1))'));
    n := n + 1;
  end loop;

  -- 2c. icloud-sync: inline service-role key.
  v := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  if v is null then raise exception 'Vault service_role_key missing'; end if;
  for r in
    select jobid, command from cron.job
     where jobname = 'icloud-sync-20min' and position('''Bearer ' || v || '''' in command) > 0
  loop
    perform cron.alter_job(r.jobid, command := replace(r.command, '''Bearer ' || v || '''',
      '''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''service_role_key'' limit 1)'));
    n := n + 1;
  end loop;

  -- 3. Nothing may be left inline.
  if exists (
    select 1 from cron.job j join vault.decrypted_secrets s
      on s.name in ('qcp_token','service_role_key','email_intel_token','ingest_token','research_token','cube_token')
     where j.jobname = any (all_jobs) and position(s.decrypted_secret in j.command) > 0) then
    raise exception 'a secret is still inline in a cron job; rolled back';
  end if;
  raise notice 'cron secrets: % job(s) switched to Vault lookups', n;
end $mig$;
