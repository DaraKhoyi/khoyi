-- "CAN THESE BOOKS BE RELIED ON YET?" — the definition of done, read from the
-- books themselves.
--
-- Dara, accounting build prompt part 6: "Done means all of these are true ...
-- A real month of the brokerage's bank statements, imported by CSV and again
-- by scan, produces the same lines, with duplicates caught. A payee corrected
-- once is categorized on the next import with no one touching it ... That
-- month reconciles to the bank's closing balance to the cent ... The gate's
-- ledger checks pass for every book."
--
-- Several of those can only become true when real statements go in, which is
-- Dara's to do. So the books say where they stand: book_go_live() answers each
-- test from what is actually in them. It only reads. It is for the people who
-- run a set of books (owner or admin), because it names who is on the list.

create or replace function public.book_go_live(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.books%rowtype; v jsonb;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin of these books can see this' using errcode = '42501'; end if;
  select * into b from public.books where id = p_book;
  with acct as (
    select lower(btrim(m.name)) as k, btrim(m.name) as name, m.kind from public.money_accounts m where m.book_id = p_book and m.retired_at is null and m.kind in ('bank', 'card', 'escrow')),
  imp as (
    select lower(btrim(i.account)) as k, i.id, case when i.via = 'scan' then 'scan' else 'file' end as how, i.period_from, i.period_to
      from public.statement_imports i where i.book_id = p_book and i.taken_back_at is null and i.read_at is not null),
  rec as (
    select r.account_key as k, max(r.statement_date) as through, count(*) as n from public.book_reconciliations r where r.book_id = p_book and r.finished_at is not null group by 1),
  -- the same account's same stretch of days, brought in both ways
  both_ways as (
    select f.k, greatest(f.period_from, s.period_from) as d1, least(f.period_to, s.period_to) as d2, s.id as scan_id
      from imp f join imp s on s.k = f.k and f.how = 'file' and s.how = 'scan'
     where f.period_from is not null and s.period_from is not null and f.period_to is not null and s.period_to is not null
       and least(f.period_to, s.period_to) - greatest(f.period_from, s.period_from) >= 20)
  select jsonb_build_object(
    'book', jsonb_build_object('kind', b.kind, 'starts_on', b.starts_on, 'closed_through', b.closed_through),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('who', case when a.user_id is null then coalesce(nullif(btrim(a.invite_name), ''), a.invite_email, 'Someone not yet named') else public.book_person_label(a.user_id) end,
                        'role', a.role, 'on', a.is_active, 'signed_in', a.user_id is not null, 'has_email', a.user_id is not null or a.invite_email is not null) order by a.role, a.granted_at), '[]'::jsonb)
                 from public.book_access a where a.book_id = p_book),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('account', acct.name, 'kind', acct.kind,
                        'statements', (select count(*) from imp where imp.k = acct.k),
                        'reconciled_through', (select rec.through from rec where rec.k = acct.k)) order by acct.name), '[]'::jsonb) from acct),
    'both_ways', (select coalesce(jsonb_agg(jsonb_build_object('account', (select acct.name from acct where acct.k = bw.k), 'from', bw.d1, 'to', bw.d2,
                        'caught', (select count(*) from public.statement_lines l where l.import_id = bw.scan_id and l.result = 'duplicate'),
                        'added_twice', (select count(*) from public.statement_lines l where l.import_id = bw.scan_id and l.result = 'posted' and l.twin_answer is null and l.line_date between bw.d1 and bw.d2))), '[]'::jsonb)
                    from both_ways bw),
    'rules', jsonb_build_object(
        'confirmed', (select count(*) from public.payee_rules r where r.book_id = p_book and r.trusted),
        'filed_for_you', (select count(*) from public.statement_lines l where l.book_id = p_book and l.result = 'posted' and l.auto_posted)),
    'waiting', jsonb_build_object(
        'statement_lines', (select count(*) from public.statement_lines l join public.statement_imports i on i.id = l.import_id where l.book_id = p_book and l.result is null and i.taken_back_at is null),
        'no_category', (select count(*) from public.transactions t where t.book_id = p_book and not t.is_archived and t.tax_category_id is null and btrim(coalesce(t.transfer_account, '')) = '' and t.scope = 'business'),
        'closings', (select count(*) from public.closing_postings c where c.book_id = p_book and c.state = 'held')),
    'closings_on', (select s.is_on from public.closing_settings s where s.book_id = p_book),
    'ledger_faults', (select count(*) from public.ledger_health() h where h.book_id = p_book),
    'entries', (select count(*) from public.transactions t where t.book_id = p_book and not t.is_archived))
    into v;
  return v;
end $$;
revoke all on function public.book_go_live(uuid) from public, anon;
grant execute on function public.book_go_live(uuid) to authenticated;
