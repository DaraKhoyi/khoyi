-- 2026-10-08 Quo rows keep their owner.
-- quo-sync used to upsert every backfilled text and call with user_id = the
-- CALLER. Smoke-test accounts opened the Quo screen, took Dara's rows, and the
-- auth.users ON DELETE CASCADE removed them when the account was deleted
-- (~52k inserts / ~52k deletes on quo_messages; the same on quo_calls).
-- quo-sync v18 now files rows under the line owner and never overwrites an
-- existing row. This trigger makes the database refuse an owner change on any
-- path (old code, a webhook refresh, a client update): user_id stays as it was.
-- A deliberate reassignment sets the transaction-local flag first:
--   select set_config('prism.quo_reassign', 'on', true);
-- The user_id FKs stay ON DELETE CASCADE on purpose: deleting a real account
-- still removes that person's own texts and calls, and now nobody else's rows
-- can ever come to belong to a throwaway account.
create or replace function public.quo_keep_owner() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('prism.quo_reassign', true), '') = 'on' then
    return NEW;
  end if;
  NEW.user_id := OLD.user_id;
  return NEW;
end $$;
revoke all on function public.quo_keep_owner() from public, anon, authenticated;

drop trigger if exists quo_keep_owner_trg on public.quo_messages;
create trigger quo_keep_owner_trg before update on public.quo_messages
  for each row when (old.user_id is distinct from new.user_id)
  execute function public.quo_keep_owner();

drop trigger if exists quo_keep_owner_trg on public.quo_calls;
create trigger quo_keep_owner_trg before update on public.quo_calls
  for each row when (old.user_id is distinct from new.user_id)
  execute function public.quo_keep_owner();
