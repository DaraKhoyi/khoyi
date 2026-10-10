-- =====================================================================
-- L5: the broker sees COUNTS of agents' own lead alerts, never their content (10 Oct 2026)
--
-- Dara, 6:46 AM ET Oct 10: limit Lead Notify Review to counts only for agents'
-- own leads; Company Leads can stay in full. Matches the 9 Oct privacy rule
-- ("you see counts, never content").
--   lead_notifications  read/verdict: your own rows; owner/broker_admin also
--                       rows about a Company Lead (contacts.company_lead).
--   push_log            read: your own rows only.
--   lead_notify_counts()      staff only: per agent totals (no names, no text).
--   broker_missed_alert_counts() staff only: per agent, alerts in the last 7
--                       days that reached no device (Adoption screen).
-- Idempotent. Rollback: rollback/2026-10-10a_lead_notify_counts_only.down.sql
-- =====================================================================
set local lock_timeout = '5s';

drop policy if exists ln_own on public.lead_notifications;
create policy ln_own on public.lead_notifications for select
  using (user_id = auth.uid() or (public.is_brokerage_staff() and exists (
    select 1 from public.contacts c where c.id = lead_notifications.contact_id and c.company_lead)));

drop policy if exists ln_verdict on public.lead_notifications;
create policy ln_verdict on public.lead_notifications for update
  using (user_id = auth.uid() or (public.is_brokerage_staff() and exists (
    select 1 from public.contacts c where c.id = lead_notifications.contact_id and c.company_lead)))
  with check (user_id = auth.uid() or (public.is_brokerage_staff() and exists (
    select 1 from public.contacts c where c.id = lead_notifications.contact_id and c.company_lead)));

drop policy if exists push_log_read on public.push_log;
create policy push_log_read on public.push_log for select to authenticated using (user_id = auth.uid());

create or replace function public.lead_notify_counts(p_days int default 30)
returns table (user_id uuid, total bigint, alerted bigint, held bigint, judged bigint, last_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select n.user_id, count(*), count(*) filter (where n.sent_at is not null),
         count(*) filter (where n.sent_at is null), count(*) filter (where n.verdict is not null), max(n.created_at)
    from public.lead_notifications n
   where public.is_brokerage_staff()
     and n.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
   group by n.user_id
$$;

create or replace function public.broker_missed_alert_counts()
returns table (user_id uuid, missed bigint)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, count(*) from public.push_log p
   where public.is_brokerage_staff() and p.sent = 0 and coalesce(p.tag, '') <> 'push-test'
     and p.created_at > now() - interval '7 days' and p.user_id is not null
   group by p.user_id
$$;

revoke all on function public.lead_notify_counts(int) from public, anon;
revoke all on function public.broker_missed_alert_counts() from public, anon;
grant execute on function public.lead_notify_counts(int) to authenticated;
grant execute on function public.broker_missed_alert_counts() to authenticated;
