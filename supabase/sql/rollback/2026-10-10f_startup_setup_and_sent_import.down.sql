-- Rollback for 2026-10-10f: drop the startup RPC and the generic sent import,
-- restore Dara's two hardcoded sent-backfill jobs exactly as they were.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sent-import-queue';
  perform cron.schedule('sent-backfill-khoyi', '*/2 * * * *', $c$ select public.cron_call('sent-backfill-khoyi', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/gmail-sync', jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')), '{"account_id":"af20c735-f861-42cb-9fe0-e7d23a6828ec","force_backfill":true,"labels":["SENT"],"max_initial":400}'::jsonb); $c$);
  perform cron.schedule('sent-backfill-brokerdara', '*/2 * * * *', $c$ select public.cron_call('sent-backfill-brokerdara', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/gmail-sync', jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')), '{"account_id":"c657ec41-ba39-4f9d-8da4-d0a4d88cef5e","force_backfill":true,"labels":["SENT"],"max_initial":400}'::jsonb); $c$);
end $$;
drop function if exists public.queue_sent_imports();
drop function if exists public.my_startup_setup();
alter table public.email_accounts drop column if exists sent_import_runs;
alter table public.email_accounts drop column if exists sent_import_done_at;
