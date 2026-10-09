-- Rollback for 2026-10-08f_batch1_teams_admin_only.sql (run by hand).
begin;
grant insert, update, delete on public.teams to authenticated;
grant insert, update, delete on public.team_members to authenticated;
drop policy if exists teams_manage on public.teams;
create policy teams_manage on public.teams for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists tm_manage on public.team_members;
create policy tm_manage on public.team_members for all
  using (auth.uid() = (select t.owner_id from public.teams t where t.id = team_members.team_id))
  with check (auth.uid() = (select t.owner_id from public.teams t where t.id = team_members.team_id));
create or replace function public.is_privileged_viewer()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists(select 1 from public.agents a where a.auth_user_id=auth.uid() and a.role in ('owner','broker_admin','team_leader'))
      or exists(select 1 from public.team_members m where m.auth_user_id=auth.uid() and m.role in ('owner','admin'));
$function$;
create or replace function public.impersonation_candidates()
 returns table(user_id uuid, name text, email text, role text, is_admin boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select auth.uid() as uid,
           (select a.role from public.agents a where a.auth_user_id = auth.uid()) as my_role
  ),
  led_members as (
    select distinct tm2.auth_user_id
    from public.team_members tm1
    join public.team_members tm2 on tm2.team_id = tm1.team_id
    where tm1.auth_user_id = auth.uid() and tm1.role in ('leader','admin','owner')
  )
  select a.auth_user_id, coalesce(a.name, a.email), a.email, a.role,
         (a.role in ('owner','broker_admin'))
  from public.agents a, me
  where a.auth_user_id is not null
    and a.auth_user_id <> me.uid
    and coalesce(a.active, true)
    and (
      (me.my_role = 'owner')
      or (me.my_role = 'broker_admin' and a.role <> 'owner')
      or (coalesce(me.my_role,'') not in ('owner','broker_admin')
          and a.auth_user_id in (select auth_user_id from led_members)
          and a.role not in ('owner','broker_admin'))
    )
  order by coalesce(a.name, a.email);
$function$;
do $r$
declare f text;
begin
  foreach f in array array[
    'public.admin_teams()', 'public.admin_agent_candidates()', 'public.admin_create_team(text)',
    'public.admin_rename_team(uuid,text)', 'public.admin_delete_team(uuid)',
    'public.admin_add_member(uuid,uuid,text)', 'public.admin_set_member_role(uuid,uuid,text)',
    'public.admin_remove_member(uuid,uuid)', 'public.impersonation_candidates()'] loop
    execute format('grant execute on function %s to public, anon', f);
  end loop;
end $r$;
commit;
