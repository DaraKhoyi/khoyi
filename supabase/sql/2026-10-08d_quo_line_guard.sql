-- 2026-10-08 One Quo line, one owner, and only someone who is on it in Quo.
--
-- quo_settings says which Quo line belongs to which PrismOS user. quo-webhook
-- files a line's incoming texts and calls under that user, and quo-proxy lets
-- that user text FROM the line. Every user could write their own row with any
-- line (RLS only checks the row is theirs, and the app's "already taken" check
-- runs under RLS, so it can never see anyone else's row). So an agent could map
-- himself to Dara's 6295 line, receive Dara's clients' texts and text them as
-- Dara.
--
-- Now, whenever a row's line or number changes (clearing it is always fine):
--   * nobody may take a line or number another user already has;
--   * an end user (a signed-in session) may only take a line that Quo itself
--     lists them on (their sign-in or roster email is one of the line's users,
--     as cached in quo_line_directory by quo-proxy from GET /v1/phone-numbers),
--     and the number must be that line's number. The workspace owner (agents
--     role 'owner') is exempt from the Quo-membership check only;
--   * server-side writes (service role, SQL) skip the membership check;
--     a deliberate reassignment from SQL can set prism.quo_reassign = on.

create table if not exists public.quo_line_directory (
  phone_number_id text primary key,
  number          text,
  name            text,
  member_emails   text[] not null default '{}',
  refreshed_at    timestamptz not null default now()
);
alter table public.quo_line_directory enable row level security;
revoke all on public.quo_line_directory from public, anon, authenticated;
grant all on public.quo_line_directory to service_role;

create or replace function public.quo_settings_line_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := auth.uid();
  pn     text := nullif(btrim(coalesce(NEW.active_phone_number_id, '')), '');
  num    text := right(regexp_replace(coalesce(NEW.active_number, ''), '\D', '', 'g'), 10);
  emails text[];
  ln     record;
begin
  if TG_OP = 'UPDATE'
     and NEW.active_phone_number_id is not distinct from OLD.active_phone_number_id
     and NEW.active_number is not distinct from OLD.active_number then
    return NEW;
  end if;
  if pn is null and num = '' then return NEW; end if;  -- clearing a line is always fine
  if uid is null and coalesce(current_setting('prism.quo_reassign', true), '') = 'on' then
    return NEW;
  end if;

  perform pg_advisory_xact_lock(hashtext('quo_settings_line_guard'));
  if pn is not null and exists (select 1 from public.quo_settings s
      where s.user_id <> NEW.user_id and s.active_phone_number_id = pn) then
    raise exception 'That Quo line is already assigned to another user.' using errcode = '42501';
  end if;
  if num <> '' and exists (select 1 from public.quo_settings s
      where s.user_id <> NEW.user_id
        and right(regexp_replace(coalesce(s.active_number, ''), '\D', '', 'g'), 10) = num) then
    raise exception 'That Quo number is already assigned to another user.' using errcode = '42501';
  end if;

  if uid is null then return NEW; end if;  -- server side: no end-user session
  if NEW.user_id <> uid then
    raise exception 'You can only choose your own Quo line.' using errcode = '42501';
  end if;
  if exists (select 1 from public.agents a where a.auth_user_id = uid and a.role = 'owner') then
    return NEW;
  end if;

  select * into ln from public.quo_line_directory d
   where (pn is not null and d.phone_number_id = pn)
      or (pn is null and right(regexp_replace(coalesce(d.number, ''), '\D', '', 'g'), 10) = num)
   limit 1;
  if not found then
    raise exception 'That Quo line is not known yet. Open the Quo screen once, then choose it again.' using errcode = '42501';
  end if;
  if num <> '' and right(regexp_replace(coalesce(ln.number, ''), '\D', '', 'g'), 10) <> num then
    raise exception 'That number does not belong to that Quo line.' using errcode = '42501';
  end if;
  select array_remove(array[lower(u.email),
         (select lower(a.email) from public.agents a where a.auth_user_id = uid and a.email is not null limit 1)], null)
    into emails from auth.users u where u.id = uid;
  if not (coalesce(ln.member_emails, '{}') && coalesce(emails, '{}')) then
    raise exception 'You are not on that line in Quo. Ask an admin to add you to it in Quo first.' using errcode = '42501';
  end if;
  return NEW;
end $$;
revoke all on function public.quo_settings_line_guard() from public, anon, authenticated;

drop trigger if exists quo_settings_line_guard_trg on public.quo_settings;
create trigger quo_settings_line_guard_trg before insert or update on public.quo_settings
  for each row execute function public.quo_settings_line_guard();
