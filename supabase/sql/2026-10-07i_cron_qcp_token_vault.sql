-- =====================================================================
-- Move the QCP_TOKEN out of pg_cron command text and into Vault (7 Oct 2026)
--
-- Seven cron jobs called their edge function with the shared QCP_TOKEN
-- pasted inline as an x-internal-token header. cron.job (and every row of
-- cron.job_run_details) keeps the command text, so anyone with database
-- read access could copy the token. The other cron jobs here already read
-- their key from Vault at run time
--   (select decrypted_secret from vault.decrypted_secrets where name = ...)
-- and this does the same.
--
-- What it does (idempotent, contains no secret):
--   1. If Vault has no 'qcp_token' yet, it copies the value out of the
--      crash-monitor-10min job's own command into Vault secret 'qcp_token'.
--   2. In the 7 jobs below, it replaces the quoted literal with the Vault
--      lookup. The header value sent is byte-for-byte the same, so the
--      functions (which compare it with their QCP_TOKEN secret) see no
--      change. Schedules are untouched.
-- A re-run finds the secret in Vault and no literal left, so it changes nothing.
--
-- Not covered here: 5 jobs that send the same token as "x-qcp-token" inside
-- a JSON literal (night-review, panel-merge, commitment-nudge,
-- panel-draft-nightly, discovery-sweep). That is a different edit, left for
-- a separate change.
-- If QCP_TOKEN is ever rotated: update the function secret AND
--   select vault.update_secret((select id from vault.secrets where name='qcp_token'), '<new>');
-- =====================================================================
do $mig$
declare
  v_tok  text;
  v_expr constant text := '(select decrypted_secret from vault.decrypted_secrets where name = ''qcp_token'' limit 1)';
  r      record;
  n      int := 0;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'qcp_token' limit 1;
  if v_tok is null then
    select (regexp_match(command, '''x-internal-token''\s*,\s*''([^'']+)'''))[1] into v_tok
      from cron.job where jobname = 'crash-monitor-10min';
    if v_tok is null or length(v_tok) < 20 then
      raise exception 'qcp_token: not in Vault and no inline token found in crash-monitor-10min; nothing done';
    end if;
    perform vault.create_secret(v_tok, 'qcp_token',
      'QCP_TOKEN (edge-function secret) sent by pg_cron jobs as x-internal-token. Must equal the QCP_TOKEN function secret.');
  end if;

  for r in
    select jobid, jobname, command from cron.job
     where jobname in ('crash-monitor-10min', 'quo-call-process-10min', 'recording-process-10min',
                       'recording-transcribe-poll-2min', 'sync-agent-profiles-15min',
                       'scheduled-email-send-5min', 'lead-triage-10min')
       and position('''' || v_tok || '''' in command) > 0
  loop
    perform cron.alter_job(r.jobid, command := replace(r.command, '''' || v_tok || '''', v_expr));
    n := n + 1;
  end loop;

  -- The lookup the jobs now run must give back exactly the same value.
  if (select decrypted_secret from vault.decrypted_secrets where name = 'qcp_token' limit 1) is distinct from v_tok then
    raise exception 'qcp_token: Vault value does not match; rolled back';
  end if;
  raise notice 'qcp_token: % job(s) switched to the Vault lookup', n;
end $mig$;
