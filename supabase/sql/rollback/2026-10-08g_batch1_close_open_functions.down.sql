-- Rollback for 2026-10-08g_batch1_close_open_functions.sql (run by hand).
begin;
grant execute on function public.notify_lead_escalation(uuid, uuid, text) to public, anon, authenticated;
grant execute on function public.prune_cron_history(integer) to public, anon, authenticated;
grant execute on function public.prune_worker_calls() to public, anon, authenticated;
create or replace function public.brokerage_scoreboard(p_owner uuid)
 returns table(agent_id uuid, auth_user_id uuid, name text, team text, is_me boolean, gci_ytd numeric, deals_closed bigint, pipeline_gci numeric, contacts bigint, tasks_done_30d bigint)
 language sql security definer set search_path to 'public'
as $function$
  with ag as (
    select id, auth_user_id, name, team
    from public.agents
    where user_id = p_owner and coalesce(active, true) = true
  )
  select
    ag.id, ag.auth_user_id, ag.name, ag.team,
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
grant execute on function public.brokerage_scoreboard(uuid) to public, anon, authenticated;
commit;
