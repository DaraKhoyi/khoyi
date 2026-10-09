-- =====================================================================
-- Security Batch 1 (8 Oct 2026, approved by Dara 9:21 PM ET) — agents table.
-- Closes C1 (anyone could insert their own agents row with role 'owner'),
-- H6 (team leader could move their own row to another team; broker_admin
-- could promote anyone to owner) and M9 (role helpers read "the first row").
--
--   1. One login per agent row: UNIQUE (auth_user_id) where not null.
--      Live check before writing this: 0 duplicates.
--   2. agents_own (ALL, auth.uid() = user_id) is replaced by an owner-only
--      policy: the caller must ALREADY hold the brokerage's owner row.
--      A brand-new account owns nothing, so it can no longer bootstrap itself.
--   3. BEFORE INSERT/UPDATE/DELETE guard trigger. Only the brokerage owner (or
--      the service role / cron, which carry no auth.uid()) may set or change
--      role, team, user_id or auth_user_id, edit the owner's row, or touch a
--      broker_admin's row. Nobody but the owner can create an owner or a
--      broker_admin. The one self-service path kept: claim_agent_profile(),
--      where a signed-in user with a CONFIRMED email links themselves to an
--      unlinked plain-agent row carrying that same email.
--   4. admin_link_agent_by_email: message no longer says "ask them to sign up"
--      (public sign-up is off; use Create login).
--
-- ROLLBACK: supabase/sql/rollback/2026-10-08e_batch1_agents_lockdown.down.sql
-- =====================================================================

-- 1 ------------------------------------------------------------------
create unique index if not exists agents_auth_user_id_uniq
  on public.agents (auth_user_id) where auth_user_id is not null;

-- 2 ------------------------------------------------------------------
create or replace function public.is_brokerage_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agents a
    where a.auth_user_id = auth.uid() and a.user_id = auth.uid() and a.role = 'owner'
  );
$$;
revoke all on function public.is_brokerage_owner() from public, anon;
grant execute on function public.is_brokerage_owner() to authenticated, service_role;

drop policy if exists agents_own on public.agents;
drop policy if exists agents_owner_all on public.agents;
create policy agents_owner_all on public.agents
  for all
  using (auth.uid() = user_id and public.is_brokerage_owner())
  with check (auth.uid() = user_id and public.is_brokerage_owner());

-- 3 ------------------------------------------------------------------
create or replace function public.agents_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_email text;
  v_confirmed boolean;
begin
  -- Service role, cron and direct database sessions carry no user. A signed-out
  -- (anon) caller is never trusted, even through a definer function.
  if v_uid is null then
    if coalesce(auth.role(), '') = 'anon' then
      raise exception 'agents: sign in required' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select exists (
    select 1 from public.agents a
    where a.auth_user_id = v_uid and a.user_id = v_uid and a.role = 'owner'
  ) into v_is_owner;

  if v_is_owner then
    -- The owner manages their own brokerage only.
    if tg_op in ('INSERT','UPDATE') and new.user_id is distinct from v_uid then
      raise exception 'agents: rows must belong to your brokerage' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.role in ('owner','broker_admin') or old.auth_user_id is not null then
      raise exception 'agents: only the brokerage owner can remove an admin or a linked login' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.role, 'agent') not in ('agent','team_leader') then
      raise exception 'agents: only the brokerage owner can add an owner or a brokerage admin' using errcode = '42501';
    end if;
    if new.auth_user_id is not null then
      raise exception 'agents: only the brokerage owner can link a login (admins use Create login)' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE by someone who is not the owner.
  if old.role = 'owner' then
    raise exception 'agents: only the owner can edit the owner''s row' using errcode = '42501';
  end if;
  if old.role = 'broker_admin' and old.auth_user_id is distinct from v_uid then
    raise exception 'agents: only the owner can edit a brokerage admin''s row' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.team is distinct from old.team then
    raise exception 'agents: only the brokerage owner can change role or team' using errcode = '42501';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id then
    -- Self-claim (claim_agent_profile): an unlinked plain-agent row whose email
    -- is the caller's confirmed sign-in email, linked to the caller only.
    select lower(u.email), (u.email_confirmed_at is not null)
      into v_email, v_confirmed
      from auth.users u where u.id = v_uid;
    if not (old.auth_user_id is null
            and new.auth_user_id = v_uid
            and old.role in ('agent','team_leader')
            and coalesce(v_confirmed, false)
            and v_email is not null
            and lower(coalesce(old.email, '')) = v_email) then
      raise exception 'agents: only the brokerage owner can change which login an agent uses' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.agents_guard() from public, anon, authenticated;

drop trigger if exists agents_guard on public.agents;
create trigger agents_guard
  before insert or update or delete on public.agents
  for each row execute function public.agents_guard();

-- 4 ------------------------------------------------------------------
create or replace function public.admin_link_agent_by_email(p_agent_id uuid, p_email text)
 returns table(ok boolean, msg text, linked_uid uuid)
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare v_owner uuid; v_target uuid; v_email text := lower(trim(p_email));
begin
  select user_id into v_owner from public.agents where id = p_agent_id;
  if v_owner is null then return query select false, 'Agent not found', null::uuid; return; end if;
  if auth.uid() is distinct from v_owner then return query select false, 'Not authorized', null::uuid; return; end if;
  select id into v_target from auth.users where lower(email) = v_email limit 1;
  if v_target is null then return query select false, 'No login found with that email. Use Create login to make one.', null::uuid; return; end if;
  if exists (select 1 from public.agents where auth_user_id = v_target and id <> p_agent_id) then
    return query select false, 'That login is already linked to another agent.', null::uuid; return; end if;
  update public.agents set auth_user_id = v_target, updated_at = now() where id = p_agent_id;
  return query select true, 'Linked', v_target;
end; $function$;
revoke all on function public.admin_link_agent_by_email(uuid, text) from public, anon;
grant execute on function public.admin_link_agent_by_email(uuid, text) to authenticated, service_role;
revoke all on function public.admin_unlink_agent(uuid) from public, anon;
grant execute on function public.admin_unlink_agent(uuid) to authenticated, service_role;
