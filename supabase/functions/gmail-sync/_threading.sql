-- Email threading invariants, enforced by the database (installed 27 Sep 2026).
-- Every message is linked to its thread (race-free), and email_threads.message_count
-- is recounted on every insert/delete/move, for EVERY writer — not just gmail-sync.
-- Why: concurrent syncs raced on thread creation and saved 301 messages with
-- thread_id NULL; counts were only recomputed at the end of a sync run, so runs that
-- timed out left 3,517 threads undercounted. Pre-fix values: archive.email_*_pre_fix_20260927.
-- The panel's 'threading is broken' (threads ~= messages) was NOT the cause: 93% of
-- Gmail threads here really are one message, and the grouping matches Gmail's own.

CREATE OR REPLACE FUNCTION public.email_message_link_thread()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ONE rule for "which thread is this message in", for every writer (gmail-sync,
  -- gmail-push, backfills). Until 27 Sep each writer looked the thread up then
  -- inserted it; two concurrent syncs both found nothing, the second insert hit
  -- the (account_id, provider_thread_id) unique key, and its message was saved
  -- with thread_id NULL — 301 of them, 8 Aug to 26 Sep.
  if new.thread_id is null and new.provider_thread_id is not null then
    select id into new.thread_id from email_threads
      where account_id = new.account_id and provider_thread_id = new.provider_thread_id;
    if new.thread_id is null then
      insert into email_threads (user_id, account_id, provider_thread_id, subject, snippet, message_count, labels, last_message_at)
        values (new.user_id, new.account_id, new.provider_thread_id, coalesce(nullif(new.subject,''), '(no subject)'), new.snippet, 0, coalesce(new.labels, '{}'), new.internal_date)
        on conflict (account_id, provider_thread_id) do nothing;
      select id into new.thread_id from email_threads
        where account_id = new.account_id and provider_thread_id = new.provider_thread_id;
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.email_thread_recount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('INSERT','UPDATE') and new.thread_id is not null then
    update email_threads set message_count = (select count(*) from email_messages where thread_id = new.thread_id) where id = new.thread_id;
  end if;
  if tg_op in ('DELETE','UPDATE') and old.thread_id is not null and (tg_op = 'DELETE' or old.thread_id is distinct from new.thread_id) then
    update email_threads set message_count = (select count(*) from email_messages where thread_id = old.thread_id) where id = old.thread_id;
  end if;
  return null;
end $function$
;

CREATE TRIGGER email_message_link_thread_trg BEFORE INSERT ON public.email_messages FOR EACH ROW EXECUTE FUNCTION email_message_link_thread();
CREATE TRIGGER email_thread_recount_trg AFTER INSERT OR DELETE OR UPDATE OF thread_id ON public.email_messages FOR EACH ROW EXECUTE FUNCTION email_thread_recount();
