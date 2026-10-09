-- =====================================================================
-- Security Batch 2 (8 Oct 2026) — readers that answered for anyone.
--   H5  lead_attribution()            GCI by agent and source, any signed-in user
--   H5  unstuck_agent_credentials(u)  any agent's volume, price and cities
--   M3  transaction_state(id)         stage, price, earnest money by id, signed out
--   M5  knowledge_read_shared         a user could point their own knowledge row
--                                     at someone else's file path and download it
--
-- is_internal_caller(): true for the service role and for direct database
-- sessions with no API caller (pg_cron, other definer functions run from
-- cron). False for anon and for every signed-in user.
-- ROLLBACK: supabase/sql/rollback/2026-10-08j_batch2_gated_readers.down.sql
-- =====================================================================

create or replace function public.is_internal_caller()
 returns boolean language sql stable set search_path to ''
as $$ select coalesce(auth.role(), '') = 'service_role' or auth.role() is null $$;
revoke all on function public.is_internal_caller() from public, anon;
grant execute on function public.is_internal_caller() to authenticated, service_role;

-- ── lead_attribution: owner / broker admin (Deal attribution card on the broker
--    goal roster) and the service role (night-review, smoke). The body is kept
--    unchanged under a private name; the public name is a gate in front of it.
alter function public.lead_attribution(integer) rename to lead_attribution_all;
revoke all on function public.lead_attribution_all(integer) from public, anon, authenticated;
grant execute on function public.lead_attribution_all(integer) to service_role;

create function public.lead_attribution(p_days integer default 90)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (public.is_internal_caller() or public.is_brokerage_staff()) then
    return jsonb_build_object('error', 'owner or broker admin only');
  end if;
  return public.lead_attribution_all(p_days);
end $$;
revoke all on function public.lead_attribution(integer) from public, anon;
grant execute on function public.lead_attribution(integer) to authenticated, service_role;

-- ── unstuck_agent_credentials: the agent themself, staff, or the service role.
--    Anyone else gets the brokerage-wide totals only (what unstuck-report shows
--    when an agent has no history), never another agent's numbers.
create or replace function public.unstuck_agent_credentials(p_user uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_agent_id uuid; v_name text; v jsonb; b jsonb;
begin
  if public.is_internal_caller() or p_user = auth.uid() or public.is_brokerage_staff() then
    select id, name into v_agent_id, v_name from agents where auth_user_id = p_user limit 1;
  end if;

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
revoke all on function public.unstuck_agent_credentials(uuid) from public, anon;
grant execute on function public.unstuck_agent_credentials(uuid) to authenticated, service_role;

-- ── transaction_state: same rule as the row itself (bt_read): staff, or the
--    agent on the deal. Anyone else gets the same answer as a missing id.
create or replace function public.transaction_state(p_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb; bt record;
begin
  if not (public.is_internal_caller() or public.txn_can_edit(p_id)) then
    return jsonb_build_object('error','not found');
  end if;
  v := public.transaction_state_core(p_id);
  if v ? 'error' then return v; end if;
  select key_dates, effective_date, purchase_price, earnest_money into bt from brokerage_transactions where id=p_id;
  return v || jsonb_build_object('key_dates', coalesce(bt.key_dates,'[]'::jsonb),
    'effective_date', bt.effective_date, 'purchase_price', bt.purchase_price, 'earnest_money', bt.earnest_money);
end;$function$;
revoke all on function public.transaction_state(uuid) from public, anon;
grant execute on function public.transaction_state(uuid) to authenticated, service_role;

-- ── knowledge bucket: a shared knowledge row opens a file only if the row
--    belongs to the person whose folder the file is in.
drop policy if exists knowledge_read_shared on storage.objects;
create policy knowledge_read_shared on storage.objects for select to authenticated
using (
  bucket_id = 'knowledge'
  and exists (
    select 1 from public.knowledge_sources k
    where k.original_path = objects.name
      and k.user_id::text = (storage.foldername(objects.name))[1]
  )
);
