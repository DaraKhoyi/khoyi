-- GETTING A SET OF BOOKS STARTED, AND KEEPING WHAT IS IN THEM
--
-- Dara, 6 Oct 2026 (accounting build, part 5):
--   "Opening balances and history. Guided import of starting balances and
--    prior transactions, so the books are whole from day one."
--   "Records retention. Statements, receipts and the ledger kept for seven
--    years. Full export at any time."
--
-- The pieces already exist: an account's starting balance (Setup), statements
-- brought in for any past period (Add), and reconciliation (Reports). What was
-- missing is one place that says, account by account, which of those three has
-- been done. book_start_status() is that, and it only reads.
--
-- Retention: an entry that is removed is archived, not deleted, and every
-- change is in the record (book_log, which cannot be edited). Statement files
-- have never been deletable from the app. Receipt files in a person's own
-- folder WERE: that permission is withdrawn here.

create or replace function public.book_start_status(p_book uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'starts_on', b.starts_on,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account', btrim(m.name), 'kind', m.kind, 'starting_balance', m.starting_balance,
               'entries', (select count(*) from public.transactions t where t.book_id = p_book and not t.is_archived
                             and (lower(btrim(coalesce(t.account, ''))) = lower(btrim(m.name)) or lower(btrim(coalesce(t.transfer_account, ''))) = lower(btrim(m.name)))),
               'first_entry', (select min(t.date) from public.transactions t where t.book_id = p_book and not t.is_archived and lower(btrim(coalesce(t.account, ''))) = lower(btrim(m.name))),
               'statements', (select count(*) from public.statement_imports i where i.book_id = p_book and i.taken_back_at is null and lower(btrim(i.account)) = lower(btrim(m.name))),
               'statements_from', (select min(coalesce(i.period_from, i.period_to)) from public.statement_imports i where i.book_id = p_book and i.taken_back_at is null and lower(btrim(i.account)) = lower(btrim(m.name))),
               'statements_to', (select max(i.period_to) from public.statement_imports i where i.book_id = p_book and i.taken_back_at is null and lower(btrim(i.account)) = lower(btrim(m.name))),
               'reconciled_through', (select max(r.statement_date) from public.book_reconciliations r where r.book_id = p_book and r.finished_at is not null and r.account_key = lower(btrim(m.name))))
             order by (m.kind = 'bank') desc, m.name)
        from public.money_accounts m where m.book_id = p_book and m.retired_at is null), '[]'::jsonb))
    from public.books b where b.id = p_book
$$;
revoke all on function public.book_start_status(uuid) from public, anon;
grant execute on function public.book_start_status(uuid) to authenticated;

-- A receipt, once stored, stays. (Statements never had a delete rule.)
drop policy if exists receipts_delete_own on storage.objects;
