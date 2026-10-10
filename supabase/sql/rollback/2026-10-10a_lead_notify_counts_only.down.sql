-- Rollback L5: staff read every agent's lead alerts and push log again.
set local lock_timeout = '5s';
drop policy if exists ln_own on public.lead_notifications;
create policy ln_own on public.lead_notifications for select using ((user_id = auth.uid()) or public.is_brokerage_staff());
drop policy if exists ln_verdict on public.lead_notifications;
create policy ln_verdict on public.lead_notifications for update using ((user_id = auth.uid()) or public.is_brokerage_staff()) with check ((user_id = auth.uid()) or public.is_brokerage_staff());
drop policy if exists push_log_read on public.push_log;
create policy push_log_read on public.push_log for select to authenticated using ((user_id = auth.uid()) or public.is_brokerage_staff());
drop function if exists public.lead_notify_counts(int);
drop function if exists public.broker_missed_alert_counts();
delete from public._applied_sql where file = '2026-10-10a_lead_notify_counts_only.sql';
