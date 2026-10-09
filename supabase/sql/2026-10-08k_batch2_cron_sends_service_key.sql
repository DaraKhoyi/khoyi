-- =====================================================================
-- Security Batch 2 (8 Oct 2026) — two cron jobs called their function with
-- no credential at all, because the function checked nothing. sheets-sync and
-- usage-report-monthly now require the service role (_shared/guard.ts), so
-- their jobs send the Vault-held service key in the Authorization header, the
-- same way the other cron_call jobs already do. The key is read from Vault at
-- run time; it is never written into the job text.
-- ROLLBACK: supabase/sql/rollback/2026-10-08k_batch2_cron_sends_service_key.down.sql
-- =====================================================================
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'sheets-sync-daily';
  if j is not null then
    perform cron.alter_job(j, command := $cmd$select public.cron_call('sheets-sync-daily', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/sheets-sync', jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), '{}'::jsonb)$cmd$);
  end if;
  select jobid into j from cron.job where jobname = 'usage-report-monthly';
  if j is not null then
    perform cron.alter_job(j, command := $cmd$select public.cron_call('usage-report-monthly', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/usage-report-monthly', jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), '{}'::jsonb)$cmd$);
  end if;
end $$;
