-- 2026-09-29 — AN EMAIL YOU DELETED IS GONE FROM PRISMOS TOO.
--
-- Josh (via Dara): "If I delete something in my email, the app should get rid of
-- the email too. The app is telling me to answer emails I deleted in Gmail
-- already." Dara: "Fix this wherever it exists and for everyone."
--
-- Why it happened, three ways:
--   1. Deleting in Gmail MOVES the message to Trash (a label change). The sync
--      only acted on permanent deletes, so PrismOS never learned it was deleted.
--   2. Even a message PrismOS knew was in Trash (deleted from inside the app,
--      48 of them) or Spam (4,987) still counted: 24 database functions and the
--      screens read email_messages, and almost none excluded Trash/Spam.
--   3. A contact's "last time they wrote" never went backwards — so once a
--      deleted email had set it, "reply to them" stayed for good.
--
-- The fix is ONE choke point instead of 24 patches: the table is renamed
-- email_messages_all, and email_messages becomes a view of it WITHOUT Trash and
-- Spam. Everything that already reads email_messages — every function, screen
-- and edge function — stops seeing deleted mail at once, and anything written
-- later cannot forget to. Only the sync and the app's own Trash/Undo read
-- email_messages_all. The view is security_invoker, so row-level security on the
-- table applies exactly as before. (A column added to the table later must be
-- added to the view too — `create or replace view` with the same select.)
--
-- And when a message goes into or out of Trash/Spam (from Gmail, or from inside
-- the app), a trigger puts the conversation, the contact's "waiting on you" and
-- any open lead card right straight away.

alter table if exists public.email_messages rename to email_messages_all;

create or replace view public.email_messages with (security_invoker = true) as
  select * from public.email_messages_all
   where not (coalesce(labels, '{}') && array['TRASH', 'SPAM']);

revoke all on public.email_messages from anon;
grant select, insert, update, delete on public.email_messages to authenticated;
grant all on public.email_messages to service_role;
comment on view public.email_messages is
  'Mail the person has NOT deleted (no TRASH/SPAM). Read this. Only gmail-sync and gmail-trash use email_messages_all. See supabase/sql/2026-09-29_deleted_email_is_gone.sql.';

-- When a message's Trash/Spam status changes, set the rest right.
create or replace function public.email_trash_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was_gone boolean := coalesce(old.labels, '{}') && array['TRASH', 'SPAM'];
  now_gone boolean := coalesce(new.labels, '{}') && array['TRASH', 'SPAM'];
  c record;
begin
  if was_gone = now_gone then return null; end if;

  -- The conversation: Gmail's thread labels are the union of its messages'.
  if new.thread_id is not null then
    update email_threads t
       set labels = coalesce((select array_agg(distinct l) from email_messages_all m, unnest(m.labels) l where m.thread_id = t.id), '{}'),
           message_count = (select count(*) from email_messages v where v.thread_id = t.id),
           worth_a_look = case when now_gone and not exists (select 1 from email_messages v where v.thread_id = t.id) then false else t.worth_a_look end,
           has_unread = case when now_gone and not exists (select 1 from email_messages v where v.thread_id = t.id) then false else t.has_unread end
     where t.id = new.thread_id;
  end if;

  -- The person: "they wrote and are waiting" must follow what is left.
  if new.direction = 'inbound' and coalesce(new.from_address, '') <> '' then
    for c in select id, last_inbound_at from contacts
              where user_id = new.user_id and lower(email) = lower(new.from_address) loop
      if now_gone and c.last_inbound_at is not null and c.last_inbound_at <= new.internal_date then
        -- recompute keeps the later of what it finds and what was stored, so the
        -- stored time set by the deleted message has to go first.
        update contacts set last_inbound_at = null where id = c.id;
      end if;
      perform public.recompute_contact_comms_one(c.id);
    end loop;

    -- An open lead card whose only mail from that person was just deleted.
    if now_gone then
      update lead_concierge lc set status = 'archived', handled_at = coalesce(lc.handled_at, now())
       where lc.user_id = new.user_id and lc.status = 'pending'
         and lower(coalesce(lc.lead_email, '')) = lower(new.from_address)
         and not exists (select 1 from email_messages v
                          where v.user_id = new.user_id and v.direction = 'inbound' and lower(v.from_address) = lower(new.from_address));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists email_trash_changed_trg on public.email_messages_all;
create trigger email_trash_changed_trg after update of labels on public.email_messages_all
  for each row execute function public.email_trash_changed();

-- The sync reports what Gmail says is in Trash/Spam (daily, and whenever its
-- change feed is too old to trust). Marks the ones PrismOS still thinks are live.
create or replace function public.email_mark_gone(p_account uuid, p_ids text[], p_label text default 'TRASH')
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_label not in ('TRASH', 'SPAM') then raise exception 'label must be TRASH or SPAM'; end if;
  update email_messages_all
     set labels = array_append(array_remove(array_remove(coalesce(labels, '{}'), 'INBOX'), 'UNREAD'), p_label)
   where account_id = p_account and provider_message_id = any(p_ids)
     and not (coalesce(labels, '{}') && array[p_label]);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.email_mark_gone(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.email_mark_gone(uuid, text[], text) to service_role;

-- Put right what is ALREADY stuck: contacts whose "last wrote" came from mail
-- that is now in Trash or Spam.
do $$
declare r record;
begin
  for r in
    select distinct ct.id
      from contacts ct
      join email_messages_all m on m.user_id = ct.user_id and lower(m.from_address) = lower(ct.email)
     where m.direction = 'inbound' and coalesce(m.labels, '{}') && array['TRASH', 'SPAM']
       and ct.last_inbound_at is not null and ct.last_inbound_at <= m.internal_date
  loop
    update contacts set last_inbound_at = null where id = r.id;
    perform public.recompute_contact_comms_one(r.id);
  end loop;
end $$;

-- Threads that are wholly deleted should not wait in Important / Inbox.
update email_threads t set worth_a_look = false, has_unread = false,
       labels = coalesce((select array_agg(distinct l) from email_messages_all m, unnest(m.labels) l where m.thread_id = t.id), t.labels)
 where exists (select 1 from email_messages_all m where m.thread_id = t.id)
   and not exists (select 1 from email_messages v where v.thread_id = t.id);

-- "Nothing left" means nobody is waiting. recompute_contact_comms_one kept the
-- old direction when it found no message either way; once a deleted email was
-- the only one, that left the person "waiting on you" forever.
do $$
declare d text;
begin
  select pg_get_functiondef('public.recompute_contact_comms_one'::regproc) into d;
  if position('WHEN v_in IS NULL AND v_out IS NULL THEN last_communication_direction' in d) > 0 then
    execute replace(d, 'WHEN v_in IS NULL AND v_out IS NULL THEN last_communication_direction',
                       'WHEN v_in IS NULL AND v_out IS NULL THEN NULL');
  end if;
end $$;

-- Re-run for contacts the first pass left "waiting" with nothing behind it.
do $$ declare r record; begin
  for r in select id from contacts where last_communication_direction = 'inbound' and last_inbound_at is null loop
    perform public.recompute_contact_comms_one(r.id);
  end loop; end $$;

-- A conversation counts the messages you can see (the recount trigger reads the
-- view); bring every count in line once.
update email_threads t set message_count = x.c
  from (select t2.id, (select count(*) from email_messages v where v.thread_id = t2.id) c from email_threads t2) x
 where x.id = t.id and t.message_count is distinct from x.c;
