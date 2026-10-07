-- Connector keys: a second way into the PrismOS connector, for assistants that
-- cannot do the sign-in-and-approve step Claude does.
--
-- Dara, 7 Oct 2026: "if we don't have an MCP key, you need to create one for
-- Grokbot." Some assistants only accept a pasted key.
--
-- What a key is: a long random string that stands for ONE person. Whoever holds
-- it can use the connector's tools as that person, and sees exactly what that
-- person sees in the app: the same row-level security, the same tool list, the
-- same rule that nothing is emailed or texted. It is not a database key and
-- opens nothing outside the connector.
--
-- How it is kept: only a fingerprint (SHA-256) is stored. The key itself is
-- shown once, when it is made, and cannot be read back by anyone, this
-- database included. A key can be revoked at any time and stops working at once.
--
-- Idempotent. Safe to run twice.

create table if not exists public.mcp_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,            -- the first characters, so the person can tell keys apart
  key_hash     text not null unique,     -- SHA-256 of the key; the key itself is never stored
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists mcp_keys_user on public.mcp_keys (user_id);

alter table public.mcp_keys enable row level security;
drop policy if exists mcp_keys_own_read on public.mcp_keys;
create policy mcp_keys_own_read on public.mcp_keys for select to authenticated using (user_id = auth.uid());
revoke all on public.mcp_keys from anon, public;
revoke insert, update, delete on public.mcp_keys from authenticated;
-- the fingerprint is not for the browser either
revoke select on public.mcp_keys from authenticated;
grant select (id, user_id, name, key_prefix, created_at, last_used_at, revoked_at) on public.mcp_keys to authenticated;

-- Make a key. Returns it ONCE. Only for people the connector is switched on for.
create or replace function public.create_mcp_key(p_name text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_key text; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from mcp_access where user_id = v_uid) then raise exception 'The PrismOS connector is not switched on for your account.'; end if;
  if v_name = '' then raise exception 'Give the key a name, such as the assistant it is for.'; end if;
  if (select count(*) from mcp_keys where user_id = v_uid and revoked_at is null) >= 5 then raise exception 'You have five keys in use. Revoke one first.'; end if;
  -- 244 random bits, from two version-4 UUIDs
  v_key := 'prism_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into mcp_keys (user_id, name, key_prefix, key_hash)
  values (v_uid, left(v_name, 60), left(v_key, 12), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));
  return v_key;
end $$;
revoke all on function public.create_mcp_key(text) from public, anon;
grant execute on function public.create_mcp_key(text) to authenticated;

-- Switch a key off. It stops working at once and cannot be switched back on.
create or replace function public.revoke_mcp_key(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update mcp_keys set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'That key was not found, or is already revoked.'; end if;
end $$;
revoke all on function public.revoke_mcp_key(uuid) from public, anon;
grant execute on function public.revoke_mcp_key(uuid) to authenticated;
