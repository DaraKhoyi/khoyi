-- Rollback for 2026-10-08e_batch1_agents_lockdown.sql (run by hand; apply-sql ignores this folder).
begin;
drop trigger if exists agents_guard on public.agents;
drop function if exists public.agents_guard();
drop policy if exists agents_owner_all on public.agents;
drop policy if exists agents_own on public.agents;
create policy agents_own on public.agents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop function if exists public.is_brokerage_owner();
drop index if exists public.agents_auth_user_id_uniq;
create or replace function public.admin_link_agent_by_email(p_agent_id uuid, p_email text)
 returns table(ok boolean, msg text, linked_uid uuid)
 language plpgsql security definer set search_path to 'public', 'auth'
as $function$
declare v_owner uuid; v_target uuid; v_email text := lower(trim(p_email));
begin
  select user_id into v_owner from public.agents where id = p_agent_id;
  if v_owner is null then return query select false, 'Agent not found', null::uuid; return; end if;
  if auth.uid() is distinct from v_owner then return query select false, 'Not authorized', null::uuid; return; end if;
  select id into v_target from auth.users where lower(email) = v_email limit 1;
  if v_target is null then return query select false, 'No login found with that email yet. Ask the agent to sign up first.', null::uuid; return; end if;
  if exists (select 1 from public.agents where auth_user_id = v_target and id <> p_agent_id) then
    return query select false, 'That login is already linked to another agent.', null::uuid; return; end if;
  update public.agents set auth_user_id = v_target, updated_at = now() where id = p_agent_id;
  return query select true, 'Linked', v_target;
end; $function$;
grant execute on function public.admin_link_agent_by_email(uuid, text) to public, anon, authenticated;
grant execute on function public.admin_unlink_agent(uuid) to public, anon, authenticated;
commit;
