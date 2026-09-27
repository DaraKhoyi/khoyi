-- 2026-09-27 — tax IDs leave the shared contacts table.
--
-- The panel (Fiduciary + Sentinel) asked whether contacts.tax_id_last4 could be
-- read across agents. It could: contacts_select lets other people read a contact
-- when it is shared (shared_scope 'everyone' = every agent; 'team'; 'brokerage'),
-- when it is an our_agent/agent_lost row on a team, or a recruit. A last-four and
-- SSN/EIN type on any such row went with it. Zero rows held one on the day of
-- the fix, so nothing was exposed; the design was the problem.
--
-- While checking, two worse holes turned up in the same code:
--   * set_tax_id() and merge_contacts() were executable by the PUBLIC anon key
--     and guarded with `if auth.uid() is not null and auth.uid() <> owner ...`.
--     A caller with no sign-in has a NULL uid, so the guard was skipped: anyone
--     holding a contact's id could overwrite its tax ID, or merge (and retire)
--     another agent's contact. Now: signed-in owner or brokerage staff, or the
--     service role; nothing for anon.
--
-- The new shape:
--   contact_tax_ids   — the ONLY place any part of a tax ID lives. enc (the
--                       encrypted number) is granted to no app role at all.
--                       last4 + tax_id_type are readable by the contact's
--                       CURRENT owner and brokerage staff — never via sharing.
--   contacts          — tax_id_last4 / tax_id_type are kept one release as
--                       always-NULL columns (a trigger blanks them) so phones
--                       still running the previous app can save contacts.
--                       DROP THEM after 4 Oct 2026 (HANDOFF §13).

begin;

-- 1. The protected table gains the readable parts.
alter table public.contact_tax_ids
  add column if not exists last4 text check (last4 ~ '^[0-9]{4}$'),
  add column if not exists tax_id_type text check (tax_id_type in ('ssn','ein'));

update public.contact_tax_ids t
   set last4 = c.tax_id_last4, tax_id_type = lower(c.tax_id_type)
  from public.contacts c
 where c.id = t.contact_id and c.tax_id_last4 is not null;

-- Owner is looked up LIVE from contacts, so a contact reassigned when an agent
-- leaves follows its new owner instead of the stamp taken when it was stored.
drop policy if exists contact_tax_ids_owner_or_staff on public.contact_tax_ids;
create policy contact_tax_ids_owner_or_staff on public.contact_tax_ids
  for select to authenticated
  using (
    public.is_brokerage_staff()
    or exists (select 1 from public.contacts c
                where c.id = contact_tax_ids.contact_id and c.user_id = auth.uid())
  );
revoke all on public.contact_tax_ids from public, anon, authenticated;
grant select (contact_id, last4, tax_id_type, updated_at) on public.contact_tax_ids to authenticated;

-- 2. The shared table stops carrying them.
update public.contacts set tax_id_last4 = null, tax_id_type = null
 where tax_id_last4 is not null or tax_id_type is not null;

create or replace function public.contacts_strip_tax_id()
returns trigger language plpgsql as $$
begin
  new.tax_id_last4 := null;
  new.tax_id_type  := null;
  return new;
end $$;
drop trigger if exists contacts_strip_tax_id_trg on public.contacts;
create trigger contacts_strip_tax_id_trg before insert or update on public.contacts
  for each row execute function public.contacts_strip_tax_id();

-- 3. set_tax_id: signed-in owner or staff (or service role). Stores type with the
--    number; p_value NULL = change the type of the number already on file.
drop function if exists public.set_tax_id(uuid, text, text);
create function public.set_tax_id(p_contact uuid, p_value text, p_type text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp', 'vault'
as $function$
declare v_key text; v_digits text; v_owner uuid; v_type text; v_n int;
begin
  select user_id into v_owner from contacts where id = p_contact;
  if v_owner is null then raise exception 'contact not found'; end if;
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then raise exception 'sign in required'; end if;
    if auth.uid() <> v_owner and not public.is_brokerage_staff() then
      insert into tax_id_access_log (actor, contact_id, action) values (auth.uid(), p_contact, 'DENIED');
      raise exception 'not your contact';
    end if;
  end if;

  v_type := nullif(lower(trim(coalesce(p_type, ''))), '');
  if v_type is not null and v_type not in ('ssn', 'ein') then
    raise exception 'tax ID type must be ssn or ein';
  end if;

  if p_value is null then
    update contact_tax_ids set tax_id_type = coalesce(v_type, tax_id_type), updated_at = now(), updated_by = auth.uid()
     where contact_id = p_contact;
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'on_file', v_n > 0);
  end if;

  v_digits := regexp_replace(p_value, '[^0-9]', '', 'g');
  if v_digits = '' then
    delete from contact_tax_ids where contact_id = p_contact;
    insert into tax_id_access_log (actor, contact_id, action) values (auth.uid(), p_contact, 'cleared');
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  if length(v_digits) <> 9 then raise exception 'a tax ID must be 9 digits'; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tax_id_key';
  insert into contact_tax_ids (contact_id, user_id, enc, last4, tax_id_type, updated_by)
  values (p_contact, v_owner, extensions.pgp_sym_encrypt(v_digits, v_key), right(v_digits, 4),
          coalesce(v_type, 'ssn'), auth.uid())
  on conflict (contact_id) do update
     set enc = excluded.enc, last4 = excluded.last4,
         tax_id_type = coalesce(v_type, contact_tax_ids.tax_id_type, 'ssn'),
         user_id = excluded.user_id, updated_at = now(), updated_by = excluded.updated_by;
  insert into tax_id_access_log (actor, contact_id, action) values (auth.uid(), p_contact, 'stored');
  return jsonb_build_object('ok', true, 'last4', right(v_digits, 4));
end $function$;
revoke all on function public.set_tax_id(uuid, text, text) from public, anon;
grant execute on function public.set_tax_id(uuid, text, text) to authenticated, service_role;

-- reveal_tax_id already requires staff and logs every reveal; strangers need not reach it.
revoke all on function public.reveal_tax_id(uuid) from public, anon;
grant execute on function public.reveal_tax_id(uuid) to authenticated, service_role;

-- The access log is an audit trail: staff may read it, nobody may edit it.
revoke all on public.tax_id_access_log from anon;
revoke insert, update, delete, truncate on public.tax_id_access_log from authenticated;

-- 4. merge_contacts: same NULL-uid hole (see header).
CREATE OR REPLACE FUNCTION public.merge_contacts(p_keep uuid, p_drop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid; v_keep contacts; v_drop contacts; r record;
  v_moved jsonb := '{}'::jsonb; v_n int; v_total int := 0;
begin
  if p_keep = p_drop then raise exception 'cannot merge a contact into itself'; end if;
  select * into v_keep from contacts where id = p_keep;
  select * into v_drop from contacts where id = p_drop;
  if v_keep.id is null or v_drop.id is null then raise exception 'contact not found'; end if;
  -- Both must belong to the caller. A merge crossing users would be a data leak
  -- dressed as a convenience.
  if v_keep.user_id <> v_drop.user_id then raise exception 'contacts belong to different users'; end if;
  v_user := v_keep.user_id;
  -- The old guard only ran when a uid was present, so a caller with no sign-in
  -- (NULL uid) skipped it entirely. Fixed 27 Sep 2026.
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then raise exception 'sign in required'; end if;
    if auth.uid() <> v_user and not public.is_brokerage_staff() then
      raise exception 'not your contact';
    end if;
  end if;

  for r in
    select c.relname tbl, a.attname col
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and a.attname in ('contact_id','primary_contact_id','client_contact_id','owner_contact_id',
                        'from_contact_id','to_contact_id','lead_contact_id')
      and c.relname <> 'contact_merges'
  loop
    -- A unique constraint can refuse the move (both contacts already have a
    -- profiles row, say). Repoint what can move; leave the rest attached to the
    -- row being retired, which the snapshot preserves. Losing the move is
    -- recoverable; losing the whole merge to one collision is not.
    begin
      execute format('update public.%I set %I = $1 where %I = $2', r.tbl, r.col, r.col)
        using p_keep, p_drop;
      get diagnostics v_n = row_count;
    exception when others then
      v_n := -1;
    end;
    if v_n <> 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_n);
      if v_n > 0 then v_total := v_total + v_n; end if;
    end if;
  end loop;

  -- The polymorphic rail has no FK, so it needs naming explicitly.
  begin
    update entity_links set target_id = p_keep where target_id = p_drop and target_type = 'contact';
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object('entity_links.target_id', v_n); v_total := v_total + v_n; end if;
  exception when others then null; end;

  -- FIELD BY FIELD, KEEP WINS, BLANKS FILL FROM THE OTHER. Never overwrite
  -- something Dara can see with something he cannot.
  update contacts set
    name             = coalesce(nullif(btrim(v_keep.name),''), v_drop.name),
    email            = coalesce(nullif(btrim(v_keep.email),''), v_drop.email),
    phone            = coalesce(nullif(btrim(v_keep.phone),''), v_drop.phone),
    notes            = case when coalesce(btrim(v_drop.notes),'') = '' then v_keep.notes
                            when coalesce(btrim(v_keep.notes),'') = '' then v_drop.notes
                            else v_keep.notes || E'\n\n--- merged from duplicate ---\n' || v_drop.notes end,
    updated_at       = now()
  where id = p_keep;

  insert into contact_merges (user_id, kept_id, merged_id, merged_snapshot, moved, merged_by)
  values (v_user, p_keep, p_drop, to_jsonb(v_drop), v_moved, auth.uid());

  delete from contacts where id = p_drop;
  return jsonb_build_object('ok', true, 'kept', p_keep, 'rows_moved', v_total, 'detail', v_moved);
end $function$;
revoke all on function public.merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid) to authenticated, service_role;

commit;
