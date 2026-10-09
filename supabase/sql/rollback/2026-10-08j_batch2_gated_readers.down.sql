-- Rollback for 2026-10-08j_batch2_gated_readers.sql (restores the 8 Oct pre-Batch-2 definitions and ACLs)
drop function if exists public.lead_attribution(integer);
alter function public.lead_attribution_all(integer) rename to lead_attribution;
grant execute on function public.lead_attribution(integer) to authenticated, service_role;

create or replace function public.unstuck_agent_credentials(p_user uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_agent_id uuid; v_name text; v jsonb; b jsonb;
begin
  select id, name into v_agent_id, v_name from agents where auth_user_id = p_user limit 1;
  select jsonb_build_object(
    'txns', count(*), 'volume', round(coalesce(sum(gross_sale),0)),
    'avg_price', round(coalesce(avg(gross_sale),0)),
    'list_side', count(*) filter (where list_side is true),
    'cities', (select jsonb_agg(c order by n desc) from (
        select city c, count(*) n from brokerage_transactions
         where agent_id = v_agent_id and city is not null and year >= 2025
         group by city order by n desc limit 4) x)
  ) into v
  from brokerage_transactions where agent_id = v_agent_id and year >= 2025;
  select jsonb_build_object('txns', count(*), 'volume', round(coalesce(sum(gross_sale),0)),
                            'agents', count(distinct agent_id)) into b
  from brokerage_transactions where year >= 2025;
  return jsonb_build_object(
    'agent_name', coalesce(v_name,'Your agent'),
    'agent', coalesce(v,'{}'::jsonb), 'brokerage', coalesce(b,'{}'::jsonb),
    'tier', case when coalesce((v->>'txns')::int,0) >= 20 then 'established'
                 when coalesce((v->>'txns')::int,0) >= 5  then 'active'
                 else 'lean' end);
end;$function$;

create or replace function public.transaction_state(p_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb; bt record;
begin
  v := public.transaction_state_core(p_id);
  if v ? 'error' then return v; end if;
  select key_dates, effective_date, purchase_price, earnest_money into bt from brokerage_transactions where id=p_id;
  return v || jsonb_build_object('key_dates', coalesce(bt.key_dates,'[]'::jsonb),
    'effective_date', bt.effective_date, 'purchase_price', bt.purchase_price, 'earnest_money', bt.earnest_money);
end;$function$;
grant execute on function public.transaction_state(uuid) to public, anon, authenticated, service_role;

drop policy if exists knowledge_read_shared on storage.objects;
create policy knowledge_read_shared on storage.objects for select to authenticated
using (bucket_id = 'knowledge' and exists (select 1 from public.knowledge_sources k where k.original_path = objects.name));

drop function if exists public.is_internal_caller();
