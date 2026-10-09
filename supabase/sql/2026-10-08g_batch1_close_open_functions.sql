-- =====================================================================
-- Security Batch 1 (8 Oct 2026) — functions anyone on the internet could call.
--   * notify_lead_escalation  (H4: fake "New lead" pushes to any phone)
--   * prune_cron_history      (M2: wipe all cron run history)
--   * prune_worker_calls      (M2: wipe worker logs)
--   -> EXECUTE revoked from public, anon, authenticated; service_role keeps it.
--      Callers checked live: route_lead() (security definer, owner postgres),
--      cron 'cron-history-prune-daily' (postgres), check_worker_health() via cron
--      'worker-monitor-15min' (postgres). None run as anon/authenticated.
--   * brokerage_scoreboard    (H5: every agent's GCI + login ids, signed out)
--   -> EXECUTE revoked from public, anon. Signed-in users keep it because every
--      agent's "How I'm doing" screen calls it, but it now answers only for the
--      caller's own brokerage, and hides other agents' login ids unless the
--      caller is owner/broker_admin.
-- ROLLBACK: supabase/sql/rollback/2026-10-08g_batch1_close_open_functions.down.sql
-- =====================================================================

revoke all on function public.notify_lead_escalation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.notify_lead_escalation(uuid, uuid, text) to service_role;
revoke all on function public.prune_cron_history(integer) from public, anon, authenticated;
grant execute on function public.prune_cron_history(integer) to service_role;
revoke all on function public.prune_worker_calls() from public, anon, authenticated;
grant execute on function public.prune_worker_calls() to service_role;

create or replace function public.brokerage_scoreboard(p_owner uuid)
 returns table(agent_id uuid, auth_user_id uuid, name text, team text, is_me boolean, gci_ytd numeric, deals_closed bigint, pipeline_gci numeric, contacts bigint, tasks_done_30d bigint)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with gate as (
    select (coalesce(auth.role(), '') = 'service_role' or p_owner = public.app_owner()) as ok,
           (coalesce(auth.role(), '') = 'service_role' or public.is_brokerage_staff()) as staff
  ),
  ag as (
    select a.id, a.auth_user_id, a.name, a.team
    from public.agents a, gate
    where gate.ok and a.user_id = p_owner and coalesce(a.active, true) = true
  )
  select
    ag.id,
    case when (select staff from gate) or ag.auth_user_id = auth.uid() then ag.auth_user_id end,
    ag.name, ag.team,
    (ag.auth_user_id is not null and ag.auth_user_id = auth.uid()) as is_me,
    coalesce((select sum(coalesce(d.gross_commission, coalesce(d.sale_price,0)*coalesce(d.commission_pct,0)/100))
              from public.deals d
              where d.user_id = ag.auth_user_id and d.status = 'closed'
                and d.close_date >= date_trunc('year', now())::date), 0) as gci_ytd,
    coalesce((select count(*) from public.deals d
              where d.user_id = ag.auth_user_id and d.status = 'closed'
                and d.close_date >= date_trunc('year', now())::date), 0) as deals_closed,
    coalesce((select sum(coalesce(d.gross_commission, coalesce(d.sale_price,0)*coalesce(d.commission_pct,0)/100))
              from public.deals d
              where d.user_id = ag.auth_user_id
                and d.status in ('lead','active','under_contract','closing')), 0) as pipeline_gci,
    coalesce((select count(*) from public.contacts c where c.user_id = ag.auth_user_id), 0) as contacts,
    coalesce((select count(*) from public.tasks t
              where t.user_id = ag.auth_user_id and t.completed = true
                and coalesce(t.completed_at, t.updated_at) >= now() - interval '30 days'), 0) as tasks_done_30d
  from ag
  order by gci_ytd desc nulls last, deals_closed desc;
$function$;
revoke all on function public.brokerage_scoreboard(uuid) from public, anon;
grant execute on function public.brokerage_scoreboard(uuid) to authenticated, service_role;
