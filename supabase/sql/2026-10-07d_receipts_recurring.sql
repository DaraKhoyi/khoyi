-- RECEIPTS THAT FIND THEIR ENTRY, RECURRING ENTRIES THAT ARE WATCHED, AND THE
-- 2026 MILEAGE RATE
--
-- Dara, 6 Oct 2026 (accounting build, part 5):
--   "Receipts. Photograph a receipt; PrismOS reads it and attaches it to the
--    matching bank line automatically."
--   "Recurring entries. Rent, software and franchise fees expected each month;
--    PrismOS notices when one is missing or its amount changed."
--   "Mileage log ... priced at that year's IRS rate."
--
-- THE PROMISES
--  1. A receipt is attached to an entry only when exactly ONE entry in those
--     books has that amount near that day and no receipt yet. Two candidates
--     are shown to the person; none means the receipt becomes a new entry (or
--     waits on a statement line still in review). Attaching changes nothing
--     about the entry but its receipt.
--  2. A receipt's file lives under the book it belongs to, so whoever has a
--     seat on those books can open it, and nobody else.
--  3. The watch on recurring entries only reads the books. It never adds an
--     entry. "Expected" means the books show it in each of the last three
--     full months; nobody has to set anything up.

-- ── 1. The IRS rate for 2026 (Notice 2026-10, checked on irs.gov 6 Oct 2026) ─
-- The row held a placeholder (70 cents, "verify against IRS Notice once
-- published"). No drive had been priced with it.
update public.mileage_rates
   set business_rate = 0.7250, medical_rate = 0.2050, charity_rate = 0.1400,
       notes = 'IRS Notice 2026-10: 72.5 cents business, 20.5 medical, 14 charity. Checked on irs.gov 6 Oct 2026.'
 where year = 2026;

-- ── 2. Receipts ─────────────────────────────────────────────────────────────
-- Is this path one this person may attach in these books?
create or replace function public.receipt_path_ok(p_book uuid, p_path text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_path is not null and p_path !~ '\.\.' and (
           p_path like p_book::text || '/receipts/%'
        or (p_path like auth.uid()::text || '/%' and exists (select 1 from public.books b where b.id = p_book and b.kind = 'personal' and b.owner_user_id = auth.uid())))
$$;
revoke all on function public.receipt_path_ok(uuid, text) from public, anon, authenticated;

-- Entries the receipt could belong to: same amount (a receipt shows it as a
-- positive figure), from three days before the receipt's day (a pre-authorised
-- charge) to ten after (the bank posts later), with no receipt yet.
create or replace function public.receipt_candidates(p_book uuid, p_amount numeric, p_date date)
returns table (id uuid, entry_date date, payee text, amount numeric, account text, from_statement boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.date, coalesce(t.payee, t.description), t.amount, t.account, t.statement_line_id is not null
    from public.transactions t
   where t.book_id = p_book and not t.is_archived and t.receipt_url is null and btrim(coalesce(t.transfer_account, '')) = ''
     and abs(t.amount) = abs(round(p_amount, 2)) and p_amount <> 0
     and t.date between p_date - 3 and p_date + 10
   order by abs(t.date - p_date), t.id limit 6
$$;
revoke all on function public.receipt_candidates(uuid, numeric, date) from public, anon, authenticated;

-- p_transaction given: attach to that entry (the person chose).
-- Otherwise: attach when exactly one entry fits; else one waiting statement
-- line; else say what was found and attach nothing.
create or replace function public.receipt_attach(p_book uuid, p_path text, p_amount numeric, p_date date, p_transaction uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer; v_tx uuid := p_transaction; r record; v_line uuid; v_lines integer;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if not public.receipt_path_ok(p_book, p_path) then raise exception 'That receipt does not belong to these books' using errcode = '42501'; end if;
  if v_tx is null then
    if p_amount is null or p_date is null then return jsonb_build_object('attached', null, 'choices', '[]'::jsonb); end if;
    select count(*), (array_agg(c.id))[1] into v_n, v_tx from public.receipt_candidates(p_book, p_amount, p_date) c;
    if v_n > 1 then
      return jsonb_build_object('attached', null, 'choices', (select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.entry_date, 'payee', c.payee, 'amount', c.amount, 'account', c.account, 'bank', c.from_statement))
                                                                 from public.receipt_candidates(p_book, p_amount, p_date) c));
    end if;
    if v_n = 0 then
      -- still in review on a statement? the receipt waits there with it
      select count(*), (array_agg(l.id))[1] into v_lines, v_line from public.statement_lines l join public.statement_imports i on i.id = l.import_id
       where l.book_id = p_book and l.result is null and i.taken_back_at is null and l.receipt_path is null
         and abs(l.amount) = abs(round(p_amount, 2)) and l.line_date between p_date - 3 and p_date + 10;
      if v_lines = 1 then
        update public.statement_lines set receipt_path = p_path where id = v_line returning payee, line_date into r;
        return jsonb_build_object('attached', 'line', 'id', v_line, 'payee', r.payee, 'date', r.line_date);
      end if;
      return jsonb_build_object('attached', null, 'choices', '[]'::jsonb);
    end if;
  end if;
  perform set_config('prism.learning', 'off', true);
  update public.transactions t set receipt_url = p_path
   where t.id = v_tx and t.book_id = p_book and not t.is_archived and t.receipt_url is null
  returning coalesce(t.payee, t.description) as payee, t.date, t.statement_line_id into r;
  if not found then raise exception 'That entry is not in these books, or already has a receipt' using errcode = 'P0002'; end if;
  return jsonb_build_object('attached', 'entry', 'id', v_tx, 'payee', r.payee, 'date', r.date, 'bank', r.statement_line_id is not null);
end $$;
revoke all on function public.receipt_attach(uuid, text, numeric, date, uuid) from public, anon;
grant execute on function public.receipt_attach(uuid, text, numeric, date, uuid) to authenticated;

-- ── 3. Recurring entries, watched ───────────────────────────────────────────
create table if not exists public.recurring_watch_seen (
  book_id      uuid not null references public.books(id) on delete cascade,
  payee_key    text not null,
  month        date not null,            -- first day of the month the notice was about
  dismissed_by uuid,
  dismissed_at timestamptz not null default now(),
  primary key (book_id, payee_key, month)
);
alter table public.recurring_watch_seen enable row level security;
drop policy if exists recurring_watch_seen_read on public.recurring_watch_seen;
create policy recurring_watch_seen_read on public.recurring_watch_seen for select to authenticated using (book_id in (select public.my_books_readable()));
revoke all on public.recurring_watch_seen from public, anon, authenticated;
grant select on public.recurring_watch_seen to authenticated;

-- What these books pay every month, and whether this month's is missing or a
-- different amount. Runs as the caller: the book's own rules decide.
create or replace function public.book_recurring_watch(p_book uuid, p_today date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with d as (select coalesce(p_today, (now() at time zone 'America/New_York')::date) as today),
  m as (select date_trunc('month', d.today)::date as cur, d.today from d),
  tx as (
    select lower(btrim(t.payee)) as k, max(btrim(t.payee)) as payee, date_trunc('month', t.date)::date as mon,
           sum(-t.amount) as total, count(*) as n, min(extract(day from t.date))::integer as first_day
      from public.transactions t, m
     where t.book_id = p_book and not t.is_archived and t.amount < 0 and btrim(coalesce(t.transfer_account, '')) = '' and btrim(coalesce(t.payee, '')) <> ''
       and t.date >= (m.cur - interval '3 months')::date and t.date <= m.today
     group by 1, 3),
  past as (
    select tx.k, max(tx.payee) as payee, count(*) as months, max(tx.n) as most, max(tx.first_day) as late_day,
           percentile_cont(0.5) within group (order by tx.total) as usual, min(tx.total) as low, max(tx.total) as high
      from tx, m where tx.mon < m.cur group by 1),
  now_ as (select tx.k, tx.total, tx.n from tx, m where tx.mon = m.cur),
  seen as (select s.payee_key from public.recurring_watch_seen s, m where s.book_id = p_book and s.month = m.cur)
  select coalesce(jsonb_agg(jsonb_build_object('key', q.k, 'payee', q.payee, 'kind', q.kind, 'usual', round(q.usual::numeric, 2), 'now', round(coalesce(q.total, 0), 2),
                                              'by_day', q.late_day, 'month', q.cur) order by q.kind desc, q.usual desc), '[]'::jsonb)
    from (
      select p.k, p.payee, p.usual, p.late_day, n.total, m.cur,
             case when n.k is null and extract(day from m.today) > least(p.late_day + 5, 28) then 'missing'
                  when n.k is not null and n.n >= p.most and (n.total < p.low or n.total > p.high) and abs(n.total - p.usual) > greatest(1, p.usual * 0.05) then 'changed' end as kind
        from past p cross join m left join now_ n on n.k = p.k
       where p.months = 3 and p.most <= 2            -- every one of the last three full months, once or twice a month
         and p.k not in (select payee_key from seen)) q
   where q.kind is not null
$$;
revoke all on function public.book_recurring_watch(uuid, date) from public, anon;
grant execute on function public.book_recurring_watch(uuid, date) to authenticated;

create or replace function public.recurring_watch_dismiss(p_book uuid, p_key text, p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  insert into public.recurring_watch_seen (book_id, payee_key, month, dismissed_by)
  values (p_book, lower(btrim(p_key)), date_trunc('month', p_month)::date, auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.recurring_watch_dismiss(uuid, text, date) from public, anon;
grant execute on function public.recurring_watch_dismiss(uuid, text, date) to authenticated;
