-- Reconciliation, and the reports books are kept for.
--
-- Dara, 6 Oct 2026 (build prompt, part 5): "Bank reconciliation: each month,
-- per account, ticks the ledger against the statement and shows what is
-- unmatched. Without it nobody knows the books are right. It is the one
-- control a CPA checks first." And: "Reports: profit and loss, balance sheet,
-- cash flow, general ledger, trial balance; profit by agent, by team, by
-- month; this year against last."
--
-- RECONCILIATION
--   * book_reconciliations - one per account per statement: the statement's
--     closing date and balance, and where the last one left off.
--   * recon_marks - the entries a person (or the statement itself) has ticked
--     as being on that statement. A transfer has two sides; each side is
--     ticked on its own account's statement.
--   * It finishes only when it agrees to the cent. Finished, its entries are
--     locked: amount, date and account cannot change, and the entry cannot be
--     removed, until an owner or admin reopens the reconciliation (logged).
--   * An entry that came in ON a statement for that account is ticked by
--     itself: the bank already said it happened.
--
-- REPORTS read the ledger (gl_*), as the caller, so the book's own privacy
-- rules decide what anyone sees.
--
-- Idempotent. Safe to run twice.

-- ── 1. Reconciliation: the tables ───────────────────────────────────────────
create table if not exists public.book_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.books(id) on delete cascade,
  account           text not null,
  account_key       text not null,                     -- lower(btrim(account))
  statement_date    date not null,
  statement_balance numeric(14,2) not null,            -- as the books count it: owed on a card is negative
  begin_balance     numeric(14,2) not null,            -- the last finished reconciliation's balance, or the starting balance
  started_by        uuid,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  finished_by       uuid,
  summary           jsonb                              -- what it looked like when it was finished, kept so it can be shown again exactly
);
create unique index if not exists book_reconciliations_one_open on public.book_reconciliations (book_id, account_key) where finished_at is null;
create index if not exists book_reconciliations_by_account on public.book_reconciliations (book_id, account_key, statement_date desc);

create table if not exists public.recon_marks (
  reconciliation_id uuid not null references public.book_reconciliations(id) on delete cascade,
  transaction_id    uuid not null references public.transactions(id) on delete cascade,
  side              text not null check (side in ('account', 'transfer')),   -- which end of the entry is on this account
  book_id           uuid not null references public.books(id) on delete cascade,
  marked_by         uuid,
  marked_at         timestamptz not null default now(),
  primary key (reconciliation_id, transaction_id, side)
);
create index if not exists recon_marks_by_tx on public.recon_marks (transaction_id);
create index if not exists recon_marks_by_book on public.recon_marks (book_id);

alter table public.book_reconciliations enable row level security;
alter table public.recon_marks enable row level security;
revoke all on public.book_reconciliations, public.recon_marks from public, anon, authenticated;
grant select on public.book_reconciliations, public.recon_marks to authenticated;
drop policy if exists book_reconciliations_read on public.book_reconciliations;
create policy book_reconciliations_read on public.book_reconciliations for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists recon_marks_read on public.recon_marks;
create policy recon_marks_read on public.recon_marks for select to authenticated using (book_id in (select public.my_books_readable()));

-- ── 2. Reconciliation: the workings ─────────────────────────────────────────
-- Every entry that could be on this statement: it touches the account, is
-- dated on or before the statement date, and has not been ticked on an earlier
-- FINISHED statement. amount is from this account's side.
create or replace function public.recon_items(p_id uuid)
returns table (transaction_id uuid, side text, entry_date date, amount numeric, payee text, memo text, category text, other_account text,
               split_group uuid, from_statement boolean, cleared boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, s.side, t.date,
         case when s.side in ('account') then t.amount else -t.amount end,
         coalesce(t.payee, t.description), case when t.payee is not null then t.description end,
         c.name, case when s.side in ('account') then t.transfer_account else t.account end,
         t.split_group,
         exists (select 1 from public.statement_lines l join public.statement_imports i on i.id = l.import_id
                  where l.id = t.statement_line_id and lower(btrim(i.account)) = r.account_key),
         exists (select 1 from public.recon_marks m where m.reconciliation_id = r.id and m.transaction_id = t.id and m.side = s.side)
    from public.book_reconciliations r
    join public.transactions t on t.book_id = r.book_id and not t.is_archived and t.amount <> 0 and t.date <= r.statement_date
    cross join lateral (
      select 'account'::text as side where lower(btrim(coalesce(t.account, ''))) = r.account_key
      union all
      select 'transfer' where lower(btrim(coalesce(t.transfer_account, ''))) = r.account_key) s
    left join public.tax_categories c on c.id = t.tax_category_id
   where r.id = p_id
     and not exists (select 1 from public.recon_marks m join public.book_reconciliations o on o.id = m.reconciliation_id
                      where m.transaction_id = t.id and m.side = s.side and o.id <> r.id and o.finished_at is not null)
$$;
revoke all on function public.recon_items(uuid) from public, anon, authenticated, service_role;

create or replace function public.recon_numbers(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'begin', r.begin_balance, 'statement', r.statement_balance,
    'cleared_in', coalesce(sum(i.amount) filter (where i.cleared and i.amount > 0), 0),
    'cleared_out', coalesce(-sum(i.amount) filter (where i.cleared and i.amount < 0), 0),
    'cleared_count', count(*) filter (where i.cleared),
    'cleared_balance', r.begin_balance + coalesce(sum(i.amount) filter (where i.cleared), 0),
    'difference', r.statement_balance - r.begin_balance - coalesce(sum(i.amount) filter (where i.cleared), 0),
    'open_in', coalesce(sum(i.amount) filter (where not i.cleared and i.amount > 0), 0),
    'open_out', coalesce(-sum(i.amount) filter (where not i.cleared and i.amount < 0), 0),
    'open_count', count(*) filter (where not i.cleared),
    'book_balance', r.begin_balance + coalesce(sum(i.amount), 0))
    from public.book_reconciliations r left join public.recon_items(r.id) i on true
   where r.id = p_id group by r.id
$$;
revoke all on function public.recon_numbers(uuid) from public, anon, authenticated, service_role;

-- Start (or pick up) the reconciliation of one account against one statement.
create or replace function public.recon_start(p_book uuid, p_account text, p_date date, p_balance numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text := lower(btrim(coalesce(p_account, ''))); m public.money_accounts%rowtype; last public.book_reconciliations%rowtype; v_id uuid; v_begin numeric;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  select * into m from public.money_accounts where book_id = p_book and lower(btrim(name)) = v_key;
  if not found then raise exception 'These books have no account with that name' using errcode = 'P0002'; end if;
  if p_date is null or p_balance is null then raise exception 'A reconciliation needs the statement''s closing date and closing balance' using errcode = '23514'; end if;
  if p_date > current_date + 1 then raise exception 'That statement date is in the future' using errcode = '23514'; end if;
  select * into last from public.book_reconciliations where book_id = p_book and account_key = v_key and finished_at is not null order by statement_date desc limit 1;
  if last.id is not null and p_date <= last.statement_date then
    raise exception '% is already reconciled through %. Choose a later statement.', btrim(m.name), to_char(last.statement_date, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
  end if;
  v_begin := coalesce(last.statement_balance, m.starting_balance, 0);
  select id into v_id from public.book_reconciliations where book_id = p_book and account_key = v_key and finished_at is null;
  if v_id is not null then
    update public.book_reconciliations set statement_date = p_date, statement_balance = round(p_balance, 2), begin_balance = v_begin where id = v_id;
    delete from public.recon_marks k using public.transactions t where k.reconciliation_id = v_id and t.id = k.transaction_id and t.date > p_date;
  else
    insert into public.book_reconciliations (book_id, account, account_key, statement_date, statement_balance, begin_balance, started_by)
    values (p_book, btrim(m.name), v_key, p_date, round(p_balance, 2), v_begin, auth.uid()) returning id into v_id;
  end if;
  -- What came in on this account's own statements is ticked: the bank said so.
  insert into public.recon_marks (reconciliation_id, transaction_id, side, book_id, marked_by)
  select v_id, i.transaction_id, i.side, p_book, null from public.recon_items(v_id) i where i.from_statement and i.side in ('account') and not i.cleared
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.recon_start(uuid, text, date, numeric) from public, anon;
grant execute on function public.recon_start(uuid, text, date, numeric) to authenticated;

-- Tick or untick entries. p_items: [{id, side}].
create or replace function public.recon_mark(p_id uuid, p_items jsonb, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.book_reconciliations%rowtype;
begin
  select * into r from public.book_reconciliations where id = p_id;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if r.finished_at is not null then raise exception 'That reconciliation is finished. An owner or admin can reopen it.' using errcode = 'P0001'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return public.recon_numbers(p_id); end if;
  if coalesce(p_on, false) then
    insert into public.recon_marks (reconciliation_id, transaction_id, side, book_id, marked_by)
    select p_id, i.transaction_id, i.side, r.book_id, auth.uid()
      from public.recon_items(p_id) i
      join jsonb_array_elements(p_items) e on (e ->> 'id')::uuid = i.transaction_id and (e ->> 'side') = i.side
    on conflict do nothing;
  else
    delete from public.recon_marks k using jsonb_array_elements(p_items) e
     where k.reconciliation_id = p_id and k.transaction_id = (e ->> 'id')::uuid and k.side = (e ->> 'side');
  end if;
  return public.recon_numbers(p_id);
end $$;
revoke all on function public.recon_mark(uuid, jsonb, boolean) from public, anon;
grant execute on function public.recon_mark(uuid, jsonb, boolean) to authenticated;

-- What is held for others on a day, against what the escrow accounts hold.
create or replace function public.book_held_tie(p_book uuid, p_as_of date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'escrow', coalesce(sum(l.debit_cents - l.credit_cents) filter (where m.kind in ('escrow')), 0) / 100.0,
    'held', coalesce(sum(l.credit_cents - l.debit_cents) filter (where c.kind in ('held') or a.system_key in ('opening_held')), 0) / 100.0)
    from public.gl_lines l
    join public.gl_entries e on e.id = l.entry_id
    join public.ledger_accounts a on a.id = l.account_id
    left join public.money_accounts m on m.id = a.money_account_id
    left join public.tax_categories c on c.id = a.tax_category_id
   where l.book_id = p_book and (p_as_of is null or e.entry_date <= p_as_of)
$$;
revoke all on function public.book_held_tie(uuid, date) from public, anon, authenticated, service_role;

create or replace function public.recon_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.book_reconciliations%rowtype; m public.money_accounts%rowtype;
begin
  select * into r from public.book_reconciliations where id = p_id;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_readable()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from public.money_accounts where book_id = r.book_id and lower(btrim(name)) = r.account_key;
  if r.finished_at is not null then
    return jsonb_build_object('rec', to_jsonb(r) - 'summary' || jsonb_build_object('by', public.book_person_label(r.finished_by)), 'kind', m.kind,
                              'numbers', r.summary -> 'numbers', 'items', r.summary -> 'items', 'held', r.summary -> 'held', 'finished', true,
                              'can_write', false, 'can_manage', r.book_id in (select public.my_books_manageable()));
  end if;
  return jsonb_build_object(
    'rec', to_jsonb(r) - 'summary', 'kind', m.kind, 'finished', false,
    'numbers', public.recon_numbers(p_id),
    'held', case when m.kind in ('escrow') then public.book_held_tie(r.book_id, r.statement_date) end,
    'can_write', r.book_id in (select public.my_books_writable()), 'can_manage', r.book_id in (select public.my_books_manageable()),
    'items', coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(i)) order by i.entry_date, i.amount desc, i.transaction_id) from public.recon_items(p_id) i), '[]'::jsonb));
end $$;
revoke all on function public.recon_detail(uuid) from public, anon;
grant execute on function public.recon_detail(uuid) to authenticated;

-- Finish: only when it agrees with the statement to the cent.
create or replace function public.recon_finish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.book_reconciliations%rowtype; n jsonb; v_kind text; v_summary jsonb;
begin
  select * into r from public.book_reconciliations where id = p_id for update;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if r.finished_at is not null then return r.summary; end if;
  n := public.recon_numbers(p_id);
  if (n ->> 'difference')::numeric <> 0 then
    raise exception 'It is still off by %. A reconciliation is finished only when it agrees with the statement to the cent.', to_char(abs((n ->> 'difference')::numeric), 'FM$999,999,990.00') using errcode = 'P0001';
  end if;
  select kind into v_kind from public.money_accounts where book_id = r.book_id and lower(btrim(name)) = r.account_key;
  v_summary := jsonb_build_object('numbers', n,
    'held', case when v_kind in ('escrow') then public.book_held_tie(r.book_id, r.statement_date) end,
    'items', coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(i)) order by i.entry_date, i.amount desc, i.transaction_id) from public.recon_items(p_id) i), '[]'::jsonb));
  update public.book_reconciliations set finished_at = now(), finished_by = auth.uid(), summary = v_summary where id = p_id;
  perform public.book_log_add(r.book_id, 'account_reconciled', null, r.account, null,
                              jsonb_build_object('reconciliation', p_id, 'statement_date', r.statement_date, 'statement_balance', r.statement_balance, 'numbers', n));
  return v_summary;
end $$;
revoke all on function public.recon_finish(uuid) from public, anon;
grant execute on function public.recon_finish(uuid) to authenticated;

-- Reopen the latest finished one (owner or admin), or abandon one in progress.
create or replace function public.recon_reopen(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.book_reconciliations%rowtype;
begin
  select * into r from public.book_reconciliations where id = p_id for update;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if r.finished_at is null then
    delete from public.book_reconciliations where id = p_id;      -- one in progress: put it away, ticks and all
    return;
  end if;
  if r.book_id not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin can reopen a finished reconciliation' using errcode = '42501'; end if;
  if exists (select 1 from public.book_reconciliations o where o.book_id = r.book_id and o.account_key = r.account_key and o.id <> r.id
                and (o.finished_at is null or o.statement_date > r.statement_date)) then
    raise exception 'Only the latest reconciliation of an account can be reopened, and not while another is in progress' using errcode = 'P0001';
  end if;
  update public.book_reconciliations set finished_at = null, finished_by = null, summary = null where id = p_id;
  perform public.book_log_add(r.book_id, 'reconciliation_reopened', null, r.account, null,
                              jsonb_build_object('reconciliation', p_id, 'statement_date', r.statement_date, 'statement_balance', r.statement_balance));
end $$;
revoke all on function public.recon_reopen(uuid) from public, anon;
grant execute on function public.recon_reopen(uuid) to authenticated;

-- Every account: where its reconciliation stands.
create or replace function public.recon_list(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_readable()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account', btrim(m.name), 'kind', m.kind,
               'last_date', f.statement_date, 'last_balance', f.statement_balance, 'last_id', f.id,
               'open_id', o.id, 'open_date', o.statement_date,
               'unreconciled', u.n, 'oldest', u.oldest) order by (m.retired_at is not null), btrim(m.name))
        from public.money_accounts m
        left join lateral (select r.id, r.statement_date, r.statement_balance from public.book_reconciliations r
                            where r.book_id = m.book_id and r.account_key = lower(btrim(m.name)) and r.finished_at is not null order by r.statement_date desc limit 1) f on true
        left join lateral (select r.id, r.statement_date from public.book_reconciliations r
                            where r.book_id = m.book_id and r.account_key = lower(btrim(m.name)) and r.finished_at is null limit 1) o on true
        left join lateral (select count(*) as n, min(t.date) as oldest from public.transactions t
                            where t.book_id = m.book_id and not t.is_archived and t.amount <> 0
                              and lower(btrim(m.name)) in (lower(btrim(coalesce(t.account, ''))), lower(btrim(coalesce(t.transfer_account, ''))))
                              and not exists (select 1 from public.recon_marks k join public.book_reconciliations r on r.id = k.reconciliation_id
                                               where k.transaction_id = t.id and r.finished_at is not null and r.account_key = lower(btrim(m.name)))) u on true
       where m.book_id = p_book and (m.retired_at is null or u.n > 0)), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'account', r.account, 'statement_date', r.statement_date, 'statement_balance', r.statement_balance,
                                          'finished_at', r.finished_at, 'by', public.book_person_label(r.finished_by)) order by r.statement_date desc, r.account)
        from public.book_reconciliations r where r.book_id = p_book and r.finished_at is not null), '[]'::jsonb));
end $$;
revoke all on function public.recon_list(uuid) from public, anon;
grant execute on function public.recon_list(uuid) to authenticated;

-- An entry on a finished reconciliation keeps its amount, date and accounts,
-- and stays in the books, until that reconciliation is reopened.
create or replace function public.recon_entry_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;      -- a change caused by another change (a book being deleted, a category removed)
  if tg_op = 'UPDATE' and not (new.is_archived and not old.is_archived)
     and row(old.amount, old.date, lower(btrim(coalesce(old.account, ''))), lower(btrim(coalesce(old.transfer_account, ''))))
         is not distinct from row(new.amount, new.date, lower(btrim(coalesce(new.account, ''))), lower(btrim(coalesce(new.transfer_account, '')))) then
    return new;
  end if;
  select b.account, b.statement_date into r from public.recon_marks k join public.book_reconciliations b on b.id = k.reconciliation_id
   where k.transaction_id = old.id and b.finished_at is not null order by b.statement_date desc limit 1;
  if found and not public.book_is_going(old.book_id) then
    raise exception 'This entry was reconciled against the % statement for %. An owner or admin can reopen that reconciliation to change it.',
      to_char(r.statement_date, 'FMMonth FMDD, YYYY'), r.account using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.recon_entry_lock() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_5_reconciled on public.transactions;
create trigger trg_book_5_reconciled before update or delete on public.transactions for each row execute function public.recon_entry_lock();

-- ── 3. Reports, read from the ledger as the caller ──────────────────────────
-- A tag's name, if the caller may see it.
create or replace function public.book_tag_label(p_by text, p_id uuid) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select case p_by
    when 'agent'    then (select nullif(btrim(regexp_replace(a.name, '\s*\([^)]*\)', '', 'g')), '') from public.agents a where a.id = p_id)
    when 'team'     then (select t.name from public.teams t where t.id = p_id)
    when 'closing'  then (select concat_ws(' · ', nullif(btrim(coalesce(c.address, '')), ''), to_char(coalesce(c.date_paid, c.date_received), 'Mon FMDD, YYYY')) from public.brokerage_transactions c where c.id = p_id)
    when 'contact'  then (select coalesce(nullif(btrim(coalesce(c.name, '')), ''), c.company) from public.contacts c where c.id = p_id)
    when 'property' then (select coalesce(nullif(btrim(coalesce(p.nickname, '')), ''), p.address) from public.properties p where p.id = p_id)
  end
$$;
revoke all on function public.book_tag_label(text, uuid) from public, anon;
grant execute on function public.book_tag_label(text, uuid) to authenticated;

-- Profit and loss. p_by: null, 'month', 'agent', 'team', 'closing', 'contact', 'property'.
-- One row per category (and per month or tag). amount is the natural way up:
-- money in for income, money out for spending.
create or replace function public.book_pnl(p_book uuid, p_from date default null, p_to date default null, p_by text default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with x as (
    select a.id as account_id, a.class, a.system_key, c.id as category_id, coalesce(c.name, case when a.class in ('income') then 'Money in, no category yet' else 'Money out, no category yet' end) as name,
           coalesce(c.sort_order, 100000) as ord,
           case p_by when 'month' then to_char(e.entry_date, 'YYYY-MM')
                     when 'agent' then t.agent_id::text when 'team' then t.team_id::text when 'closing' then t.closing_id::text
                     when 'contact' then t.contact_id::text when 'property' then t.property_id::text end as bucket,
           e.id as entry_id, l.debit_cents, l.credit_cents
      from public.gl_live e
      join public.gl_lines l on l.entry_id = e.id
      join public.ledger_accounts a on a.id = l.account_id
      left join public.tax_categories c on c.id = a.tax_category_id
      left join public.transactions t on t.id = e.transaction_id
     where e.book_id = p_book and e.transaction_id is not null and a.class in ('income', 'expense')
       and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),
  g as (
    select account_id, class, category_id, name, ord, bucket, count(distinct entry_id)::int as entries,
           case when class in ('income') then sum(credit_cents - debit_cents) else sum(debit_cents - credit_cents) end as cents
      from x group by account_id, class, category_id, name, ord, bucket)
  select jsonb_build_object('by', p_by, 'lines', coalesce(jsonb_agg(jsonb_build_object(
           'category_id', g.category_id, 'name', g.name, 'class', g.class, 'bucket', g.bucket,
           'label', case when g.bucket is null then null when p_by in ('month') then g.bucket else public.book_tag_label(p_by, g.bucket::uuid) end,
           'entries', g.entries, 'amount', round(g.cents / 100.0, 2)) order by g.class desc, g.ord, g.name, g.bucket), '[]'::jsonb))
    from g
$$;
revoke all on function public.book_pnl(uuid, date, date, text) from public, anon;
grant execute on function public.book_pnl(uuid, date, date, text) to authenticated;

-- Trial balance: every ledger account with its debits and credits to a day.
create or replace function public.book_trial_balance(p_book uuid, p_as_of date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with g as (
    select a.id, a.class, a.name, sum(l.debit_cents) as dr, sum(l.credit_cents) as cr
      from public.gl_lines l join public.gl_entries e on e.id = l.entry_id join public.ledger_accounts a on a.id = l.account_id
     where l.book_id = p_book and (p_as_of is null or e.entry_date <= p_as_of)
     group by a.id, a.class, a.name)
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'class', g.class, 'name', g.name,
        'debit', round(greatest(g.dr - g.cr, 0) / 100.0, 2), 'credit', round(greatest(g.cr - g.dr, 0) / 100.0, 2))
        order by array_position(array['asset', 'liability', 'equity', 'income', 'expense'], g.class), g.name) filter (where g.dr <> g.cr), '[]'::jsonb),
    'total_debit', round(coalesce(sum(greatest(g.dr - g.cr, 0)), 0) / 100.0, 2),
    'total_credit', round(coalesce(sum(greatest(g.cr - g.dr, 0)), 0) / 100.0, 2))
    from g
$$;
revoke all on function public.book_trial_balance(uuid, date) from public, anon;
grant execute on function public.book_trial_balance(uuid, date) to authenticated;

-- General ledger: every posting, in order. Reversals are shown; that is the point.
create or replace function public.book_general_ledger(p_book uuid, p_from date default null, p_to date default null, p_limit integer default 2000, p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with x as (
    select e.seq, l.id as line_id, e.entry_date, a.name as account, a.class, l.debit_cents, l.credit_cents, e.memo,
           case when e.reverses_id is not null then 'taken back' when e.replaces_id is not null then 'corrected' when e.opening_for is not null then 'starting balance' else 'entered' end as what,
           e.transaction_id
      from public.gl_entries e join public.gl_lines l on l.entry_id = e.id join public.ledger_accounts a on a.id = l.account_id
     where e.book_id = p_book and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
     order by e.entry_date, e.seq, l.id
     limit least(greatest(coalesce(p_limit, 2000), 1), 5000) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('entry', x.seq, 'date', x.entry_date, 'account', x.account, 'class', x.class,
        'debit', round(x.debit_cents / 100.0, 2), 'credit', round(x.credit_cents / 100.0, 2), 'memo', x.memo, 'what', x.what) order by x.entry_date, x.seq, x.line_id), '[]'::jsonb),
    'total', (select count(*) from public.gl_entries e join public.gl_lines l on l.entry_id = e.id
               where e.book_id = p_book and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)))
    from x
$$;
revoke all on function public.book_general_ledger(uuid, date, date, integer, integer) from public, anon;
grant execute on function public.book_general_ledger(uuid, date, date, integer, integer) to authenticated;

-- Cash flow: where the money in the bank came from and went, for a period.
-- Cash is every money account that is not a card. Each posting that touches
-- cash is filed by what was on its other side.
create or replace function public.book_cash_flow(p_book uuid, p_from date default null, p_to date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with cash as (
    select a.id from public.ledger_accounts a join public.money_accounts m on m.id = a.money_account_id
     where a.book_id = p_book and m.kind not in ('card')),
  begin_bal as (
    select coalesce(sum(l.debit_cents - l.credit_cents), 0) as cents
      from public.gl_lines l join public.gl_entries e on e.id = l.entry_id
     where l.book_id = p_book and l.account_id in (select id from cash) and p_from is not null and e.entry_date < p_from),
  moves as (
    select o.account_id as other, sum(l.debit_cents - l.credit_cents) as cents, count(distinct e.id)::int as entries
      from public.gl_entries e
      join public.gl_lines l on l.entry_id = e.id and l.account_id in (select id from cash)
      join public.gl_lines o on o.entry_id = e.id and o.id <> l.id and o.account_id not in (select id from cash)
     where e.book_id = p_book and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
     group by o.account_id),
  named as (
    select a.name, v.cents, v.entries,
           case when a.system_key in ('opening_equity', 'opening_held') then 'start'
                when a.class in ('income', 'expense') then 'operating'
                when c.kind in ('held') then 'held'
                when m.kind in ('card') or c.kind in ('transfer') then 'cards'
                when a.class in ('equity') then 'owners'
                else 'other' end as section,
           coalesce(c.sort_order, 100000) as ord
      from moves v join public.ledger_accounts a on a.id = v.other
      left join public.tax_categories c on c.id = a.tax_category_id
      left join public.money_accounts m on m.id = a.money_account_id
     where v.cents <> 0)
  select jsonb_build_object(
    'begin', round((select cents from begin_bal) / 100.0, 2),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('section', n.section, 'name', n.name, 'amount', round(n.cents / 100.0, 2), 'entries', n.entries) order by n.section, n.ord, n.name) from named n), '[]'::jsonb),
    'change', round(coalesce((select sum(cents) from named), 0) / 100.0, 2))
$$;
revoke all on function public.book_cash_flow(uuid, date, date) from public, anon;
grant execute on function public.book_cash_flow(uuid, date, date) to authenticated;

-- Held for others, by whose money it is (the contact tagged on each entry).
create or replace function public.book_held_by_person(p_book uuid, p_as_of date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with x as (
    select t.contact_id, sum(l.credit_cents - l.debit_cents) as cents, count(distinct e.id)::int as entries
      from public.gl_lines l
      join public.gl_entries e on e.id = l.entry_id
      join public.ledger_accounts a on a.id = l.account_id
      left join public.tax_categories c on c.id = a.tax_category_id
      left join public.transactions t on t.id = e.transaction_id
     where l.book_id = p_book and (p_as_of is null or e.entry_date <= p_as_of)
       and (c.kind in ('held') or a.system_key in ('opening_held'))
     group by t.contact_id)
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('contact_id', x.contact_id,
        'name', case when x.contact_id is null then null else public.book_tag_label('contact', x.contact_id) end,
        'amount', round(x.cents / 100.0, 2), 'entries', x.entries) order by (x.contact_id is null), x.cents desc) filter (where x.cents <> 0), '[]'::jsonb),
    'held', round(coalesce(sum(x.cents), 0) / 100.0, 2),
    'escrow', (select round(coalesce(sum(l.debit_cents - l.credit_cents), 0) / 100.0, 2)
                 from public.gl_lines l join public.gl_entries e on e.id = l.entry_id
                 join public.ledger_accounts a on a.id = l.account_id join public.money_accounts m on m.id = a.money_account_id
                where l.book_id = p_book and m.kind in ('escrow') and (p_as_of is null or e.entry_date <= p_as_of)))
    from x
$$;
revoke all on function public.book_held_by_person(uuid, date) from public, anon;
grant execute on function public.book_held_by_person(uuid, date) to authenticated;
