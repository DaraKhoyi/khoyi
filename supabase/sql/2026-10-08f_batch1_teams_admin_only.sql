-- =====================================================================
-- Security Batch 1 (8 Oct 2026) — teams and team membership are admin-managed.
-- Closes C2: any agent could create a team (teams_manage) and put anyone in it
-- with any role (tm_manage), which unlocked "Act as" (team-leader path), other
-- people's email through contact_thread_emails, and is_privileged_viewer().
--
--   1. Drop the user write policies on teams / team_members and revoke the
--      table write grants from anon and authenticated. Reads stay as they are.
--      Writes now go only through the admin_* functions (owner / broker_admin,
--      checked by is_recruit_admin()), which is what the Teams screen already
--      uses (src/views/AdminPanels.jsx).
--   2. is_privileged_viewer() no longer trusts team_members roles; it reads
--      agents.role only (owner, broker_admin, team_leader). Live check: the only
--      team 'owner'/'admin' members are Dara (owner) and Josh/Alex (broker_admin),
--      so nobody loses access.
--   3. admin_* team functions: execute revoked from anon/public.
--   4. impersonation_candidates(): matches the tightened impersonate rules —
--      a team leader sees only plain members of teams where they are 'leader',
--      never an owner, broker_admin, or another team leader/admin.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-08f_batch1_teams_admin_only.down.sql
-- =====================================================================

drop policy if exists teams_manage on public.teams;
drop policy if exists tm_manage on public.team_members;
revoke insert, update, delete, truncate on public.teams from anon, authenticated;
revoke insert, update, delete, truncate on public.team_members from anon, authenticated;

create or replace function public.is_privileged_viewer()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists(select 1 from public.agents a where a.auth_user_id=auth.uid() and a.role in ('owner','broker_admin','team_leader'));
$function$;

do $r$
declare f text;
begin
  foreach f in array array[
    'public.admin_teams()', 'public.admin_agent_candidates()', 'public.admin_create_team(text)',
    'public.admin_rename_team(uuid,text)', 'public.admin_delete_team(uuid)',
    'public.admin_add_member(uuid,uuid,text)', 'public.admin_set_member_role(uuid,uuid,text)',
    'public.admin_remove_member(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $r$;

create or replace function public.impersonation_candidates()
 returns table(user_id uuid, name text, email text, role text, is_admin boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select auth.uid() as uid,
           (select a.role from public.agents a where a.auth_user_id = auth.uid()) as my_role,
           (select a.user_id from public.agents a where a.auth_user_id = auth.uid()) as my_owner
  ),
  led_members as (
    select distinct tm2.auth_user_id
    from public.team_members tm1
    join public.team_members tm2 on tm2.team_id = tm1.team_id and tm2.role = 'member'
    where tm1.auth_user_id = auth.uid() and tm1.role = 'leader'
  )
  select a.auth_user_id, coalesce(a.name, a.email), a.email, a.role,
         (a.role in ('owner','broker_admin'))
  from public.agents a, me
  where me.uid is not null
    and a.auth_user_id is not null
    and a.auth_user_id <> me.uid
    and a.user_id = me.my_owner
    and coalesce(a.active, true)
    and (
      (me.my_role = 'owner')
      or (me.my_role = 'broker_admin' and a.role not in ('owner','broker_admin'))
      or (coalesce(me.my_role,'') not in ('owner','broker_admin')
          and a.auth_user_id in (select auth_user_id from led_members)
          and a.role in ('agent'))
    )
  order by coalesce(a.name, a.email);
$function$;
revoke all on function public.impersonation_candidates() from public, anon;
grant execute on function public.impersonation_candidates() to authenticated, service_role;
