-- =====================================================================
-- Startup setup check + sent-mail import for everyone (10 Oct 2026)
--
-- Dara, 3:58 PM ET Oct 10: on startup, prompt anyone without a GCI goal; send
-- anyone not connected to Google (mail, calendar, contacts), or disconnected,
-- to reconnect. For all current and future users.
--   my_startup_setup()   signed-in caller only: do I have an annual GCI goal
--                        (this year's agent_goals row or finance_settings), and MY Google accounts' scopes/health.
--                        Booleans and scope names only; never tokens.
--   queue_sent_imports() cron: imports sent mail for any Gmail account that has
--                        not had it yet, in at most 8 runs per account (~3,200
--                        messages back). Replaces the two cron jobs that were
--                        hardcoded to Dara's mailboxes.
-- Idempotent. Rollback: rollback/2026-10-10f_startup_setup_and_sent_import.down.sql
-- =====================================================================
set local lock_timeout = '5s';

create or replace function public.my_startup_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_agent uuid;
  v_year int := extract(year from public.today_ny())::int;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  select id into v_agent from agents where auth_user_id = v_uid limit 1;
  return jsonb_build_object(
    'year', v_year,
    'has_agent', v_agent is not null,
    -- Two stores hold the goal: agent_goals (per year; Agent Production, first
    -- run) and finance_settings.annual_gci_goal (Today's GCI gauge, Blueprint).
    -- Either counts; the prompt saves to both so every screen agrees.
    'has_goal', exists (select 1 from agent_goals g where g.agent_id = v_agent and g.year = v_year and coalesce(g.gci_goal, 0) > 0)
             or exists (select 1 from finance_settings f where f.user_id = v_uid and coalesce(f.annual_gci_goal, 0) > 0),
    'google', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'email_address', e.email_address,
        'is_active', e.is_active is not false,
        'purposes', coalesce(to_jsonb(e.purposes), '[]'::jsonb),
        'scopes', coalesce(to_jsonb(e.scopes), '[]'::jsonb),
        'revoked', e.reauth_required_at is not null
                   or coalesce(e.last_sync_error, '') ilike '%invalid_grant%'
                   or e.has_refresh_token is false
      ) order by e.created_at)
      from email_accounts e
      where e.user_id = v_uid and e.provider = 'google'), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_startup_setup() from public, anon;
grant execute on function public.my_startup_setup() to authenticated;

-- Sent-mail import, once per Gmail account.
alter table public.email_accounts add column if not exists sent_import_runs int not null default 0;
alter table public.email_accounts add column if not exists sent_import_done_at timestamptz;

-- Dara's two mailboxes were imported by the old jobs (back to 2011 and 2022).
update public.email_accounts set sent_import_done_at = coalesce(sent_import_done_at, now()), sent_import_runs = greatest(sent_import_runs, 8)
 where id in ('af20c735-f861-42cb-9fe0-e7d23a6828ec', 'c657ec41-ba39-4f9d-8da4-d0a4d88cef5e');

create or replace function public.queue_sent_imports()
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare r record; n int := 0;
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  for r in
    select e.id from email_accounts e
     where e.provider = 'google' and e.is_active is not false and e.sent_import_done_at is null
       and e.reauth_required_at is null and e.has_refresh_token is not false
       and exists (select 1 from unnest(e.scopes) s where s like '%gmail%')
     order by e.sent_import_runs, e.created_at
     limit 3
  loop
    perform public.cron_call('sent-import-' || left(r.id::text, 8),
      'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/gmail-sync',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
      jsonb_build_object('account_id', r.id, 'force_backfill', true, 'labels', jsonb_build_array('SENT'), 'max_initial', 400));
    update email_accounts set sent_import_runs = sent_import_runs + 1,
           sent_import_done_at = case when sent_import_runs + 1 >= 8 then now() else null end
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.queue_sent_imports() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('sent-backfill-khoyi', 'sent-backfill-brokerdara', 'sent-import-queue');
  perform cron.schedule('sent-import-queue', '*/5 * * * *', 'select public.queue_sent_imports();');
end $$;
