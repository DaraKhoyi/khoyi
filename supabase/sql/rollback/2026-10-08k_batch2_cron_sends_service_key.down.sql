-- Rollback for 2026-10-08k (only needed together with reverting the guard on the two functions)
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'sheets-sync-daily';
  if j is not null then perform cron.alter_job(j, command := $cmd$ select public.cron_call('sheets-sync-daily', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/sheets-sync', jsonb_build_object('Content-Type','application/json'), '{}'::jsonb) $cmd$); end if;
  select jobid into j from cron.job where jobname = 'usage-report-monthly';
  if j is not null then perform cron.alter_job(j, command := $cmd$select public.cron_call('usage-report-monthly', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/usage-report-monthly', jsonb_build_object('Content-Type','application/json'), '{}'::jsonb)$cmd$); end if;
end $$;
