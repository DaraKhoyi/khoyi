-- Rollback for 2026-10-08h_batch1_act_as_expiry.sql (run by hand).
-- Keeps the session_id / expires_at columns and revoke_support_session (harmless,
-- and PR #5 uses them). Restores authenticated's table grants.
begin;
select cron.unschedule('act-as-expire-5min') where exists (select 1 from cron.job where jobname = 'act-as-expire-5min');
drop function if exists public.expire_support_sessions();
drop index if exists public.impersonation_log_open_idx;
grant insert, update, delete on public.impersonation_log to authenticated;
commit;
