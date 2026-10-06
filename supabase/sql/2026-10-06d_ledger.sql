-- The ledger: real double-entry underneath, a checkbook on top.
--
-- Dara, 6 Oct 2026 (build prompt, part 3; asked directly and answered
-- "Double-entry underneath"): the person sees money in, money out and what it
-- was for; the database holds balanced journal entries.
--
-- HOW IT FITS WHAT IS ALREADY HERE. Nothing about entering money changes. A row
-- of public.transactions is still the checkbook entry a person types, imports
-- or edits. What is new is that every one of them is POSTED, by the database
-- itself, into a journal:
--   * ledger_accounts  - the chart of accounts. One per money account (bank,
--     card, escrow, cash), one per category, and a few the books keep for
--     themselves (opening balances, uncategorized, personal).
--   * gl_entries / gl_lines - the journal. Each entry has two or more
--     lines; debits equal credits or the database refuses it, whoever asks.
--     Amounts are whole cents (integers).
--   * Posted entries are never edited or deleted. Changing a checkbook entry
--     posts a REVERSAL of what was there (same date, linked to the original)
--     and a NEW entry (linked to the one it replaces). Removing one posts the
--     reversal alone. So the register shows one line; the journal keeps all
--     three.
-- Nobody writes to the journal directly: only the posting triggers below do.
-- Balances, the summary and the statement of position are read FROM the
-- journal, so there is one place the numbers come from. ledger_health() proves
-- the journal and the checkbook agree; the gate runs it for every book.
--
-- Also here: a transfer is ONE entry between two accounts (never income or
-- spending); categories can be assets, liabilities or equity as well as money
-- in / money out; an entry can carry a contact, an agent, a closing, a property
-- and a team; an account or category that has been used can be retired, never
-- deleted.
--
-- Idempotent. Safe to run twice.

-- ── 1. Kinds of category ────────────────────────────────────────────────────
alter table public.tax_categories drop constraint if exists tax_categories_kind_check;
alter table public.tax_categories add constraint tax_categories_kind_check
  check (kind in ('income', 'expense', 'held', 'asset', 'liability', 'equity', 'transfer', 'other'));
alter table public.book_category_templates drop constraint if exists book_category_templates_kind_check;
alter table public.book_category_templates add constraint book_category_templates_kind_check
  check (kind in ('income', 'expense', 'held', 'asset', 'liability', 'equity', 'transfer', 'other'));

update public.book_category_templates set kind = 'transfer'  where name = 'Transfers & Card Payments';
update public.book_category_templates set kind = 'liability' where name = 'Loan Principal';
update public.book_category_templates set kind = 'equity'
 where name in ('Owner Draw', 'Owner Distributions', 'Owner Contributions', 'Partner Distributions', 'Partner Contributions',
                'Member Distributions', 'Estimated Tax Payments', 'Income Tax Payments');
insert into public.book_category_templates (template, name, line, kind, ord, note) values
  ('brokerage', 'Agent Fees Receivable', '—', 'asset', 80, 'Money agents owe the company: fees or costs paid on their behalf, until repaid')
on conflict (template, name) do update set kind = excluded.kind, ord = excluded.ord, note = excluded.note;

-- Categories already in people's books take the finer kind, once.
do $$ begin
  if to_regclass('public._applied_sql') is null or not exists (select 1 from public._applied_sql where file = '2026-10-06d_ledger.sql') then
    update public.tax_categories c set kind = t.kind
      from public.books b, public.book_category_templates t
     where c.book_id = b.id and t.template = b.template and lower(btrim(c.name)) = lower(t.name)
       and c.kind in ('other') and t.kind not in ('other');
    insert into public.tax_categories (book_id, name, schedule_c_line, kind, sort_order, description)
    select b.id, t.name, t.line, t.kind, t.ord, t.note
      from public.books b join public.book_category_templates t on t.template = b.template
     where t.name = 'Agent Fees Receivable' and b.seeded_at is not null
       and not exists (select 1 from public.tax_categories c where c.book_id = b.id and lower(btrim(c.name)) = lower(t.name));
  end if;
end $$;

-- ── 2. What an entry can carry ──────────────────────────────────────────────
alter table public.transactions add column if not exists transfer_account text;   -- the other account, when this entry moves money between two of the book's own
alter table public.transactions add column if not exists contact_id  uuid references public.contacts(id) on delete set null;
alter table public.transactions add column if not exists agent_id    uuid references public.agents(id) on delete set null;
alter table public.transactions add column if not exists closing_id  uuid references public.brokerage_transactions(id) on delete set null;
alter table public.transactions add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.transactions add column if not exists team_id     uuid references public.teams(id) on delete set null;
create index if not exists transactions_by_contact on public.transactions (contact_id) where contact_id is not null;
create index if not exists transactions_by_agent   on public.transactions (book_id, agent_id) where agent_id is not null;
create index if not exists transactions_by_closing on public.transactions (closing_id) where closing_id is not null;

-- Money is whole cents.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_amount_cents') then
    alter table public.transactions add constraint transactions_amount_cents check (amount = round(amount, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'money_accounts_start_cents') then
    alter table public.money_accounts add constraint money_accounts_start_cents check (starting_balance = round(starting_balance, 2));
  end if;
end $$;

-- ── 3. The chart of accounts and the journal ────────────────────────────────
create table if not exists public.ledger_accounts (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.books(id) on delete cascade,
  class            text not null check (class in ('asset', 'liability', 'equity', 'income', 'expense')),
  name             text not null,
  money_account_id uuid references public.money_accounts(id) on delete set null,
  tax_category_id  uuid references public.tax_categories(id) on delete set null,
  system_key       text,                 -- the books' own accounts: opening_equity, uncategorized_income, ...
  retired_at       timestamptz,
  created_at       timestamptz not null default now()
);
create unique index if not exists ledger_accounts_one_per_money    on public.ledger_accounts (money_account_id) where money_account_id is not null;
create unique index if not exists ledger_accounts_one_per_category on public.ledger_accounts (tax_category_id) where tax_category_id is not null;
create unique index if not exists ledger_accounts_one_per_system   on public.ledger_accounts (book_id, system_key) where system_key is not null;
create index if not exists ledger_accounts_by_book on public.ledger_accounts (book_id);

create table if not exists public.gl_entries (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  book_id        uuid not null references public.books(id) on delete cascade,
  entry_date     date not null,
  transaction_id uuid,                   -- the checkbook entry this posts (kept even if that row is later deleted)
  opening_for    uuid,                   -- the money account whose starting balance this posts
  reverses_id    uuid references public.gl_entries(id),   -- this entry undoes that one
  replaces_id    uuid references public.gl_entries(id),   -- this entry stands in place of that (reversed) one
  memo           text,
  posted_at      timestamptz not null default now(),
  posted_by      uuid
);
create unique index if not exists gl_one_reversal on public.gl_entries (reverses_id) where reverses_id is not null;
create index if not exists gl_by_book        on public.gl_entries (book_id, entry_date);
create index if not exists gl_by_transaction on public.gl_entries (transaction_id) where transaction_id is not null;
create index if not exists gl_by_opening     on public.gl_entries (opening_for) where opening_for is not null;

create table if not exists public.gl_lines (
  id           bigint generated always as identity primary key,
  entry_id     uuid not null references public.gl_entries(id) on delete cascade,
  book_id      uuid not null references public.books(id) on delete cascade,
  account_id   uuid not null references public.ledger_accounts(id) on delete cascade,
  debit_cents  bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  constraint gl_line_one_side check ((debit_cents > 0) <> (credit_cents > 0))
);
create index if not exists gl_lines_by_entry   on public.gl_lines (entry_id);
create index if not exists gl_lines_by_account on public.gl_lines (account_id);
create index if not exists gl_lines_by_book    on public.gl_lines (book_id);
create index if not exists gl_by_replaces      on public.gl_entries (replaces_id) where replaces_id is not null;
alter table public.money_accounts add column if not exists retired_at timestamptz;   -- no longer offered; kept, with its history

alter table public.ledger_accounts enable row level security;
alter table public.gl_entries enable row level security;
alter table public.gl_lines   enable row level security;
revoke all on public.ledger_accounts, public.gl_entries, public.gl_lines from public, anon, authenticated;
grant select on public.ledger_accounts, public.gl_entries, public.gl_lines to authenticated;
-- The service key posts through the checkbook like everyone else: it may read
-- the ledger, never write, change, delete or empty it.
revoke insert, update, delete, truncate, references, trigger on public.ledger_accounts, public.gl_entries, public.gl_lines from service_role;
drop policy if exists ledger_accounts_read on public.ledger_accounts;
create policy ledger_accounts_read on public.ledger_accounts for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists gl_entries_read on public.gl_entries;
create policy gl_entries_read on public.gl_entries for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists gl_lines_read on public.gl_lines;
create policy gl_lines_read on public.gl_lines for select to authenticated using (book_id in (select public.my_books_readable()));

-- Entries that stand: not a reversal, and not reversed.
create or replace view public.gl_live with (security_invoker = true) as
  select e.* from public.gl_entries e
   where e.reverses_id is null and not exists (select 1 from public.gl_entries r where r.reverses_id = e.id);
revoke all on public.gl_live from public, anon;
grant select on public.gl_live to authenticated;

-- ── 4. The rules the journal keeps for itself ───────────────────────────────
-- A whole set of books is on its way out (a person's account is being deleted):
-- the ledger stands aside instead of posting into books that will not exist.
create or replace function public.book_is_going(p_book uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from public.books b where b.id = p_book
                      and (b.owner_user_id is null or exists (select 1 from auth.users u where u.id = b.owner_user_id)))
$$;
revoke all on function public.book_is_going(uuid) from public, anon, authenticated, service_role;

-- Never edited, never deleted. Lines go only when the whole book goes.
create or replace function public.gl_locked() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then raise exception 'A posted ledger entry cannot be changed. Correct it with a new entry.' using errcode = '42501'; end if;
  if not public.book_is_going(old.book_id) then raise exception 'A posted ledger entry cannot be deleted' using errcode = '42501'; end if;
  return old;
end $$;
revoke all on function public.gl_locked() from public, anon, authenticated, service_role;
drop trigger if exists trg_gl_locked on public.gl_entries;
create trigger trg_gl_locked before update or delete on public.gl_entries for each row execute function public.gl_locked();
drop trigger if exists trg_gl_locked on public.gl_lines;
create trigger trg_gl_locked before update or delete on public.gl_lines for each row execute function public.gl_locked();

create or replace function public.gl_no_truncate() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'The ledger cannot be emptied' using errcode = '42501'; end $$;
revoke all on function public.gl_no_truncate() from public, anon, authenticated, service_role;
drop trigger if exists trg_gl_no_truncate on public.gl_entries;
create trigger trg_gl_no_truncate before truncate on public.gl_entries for each statement execute function public.gl_no_truncate();
drop trigger if exists trg_gl_no_truncate on public.gl_lines;
create trigger trg_gl_no_truncate before truncate on public.gl_lines for each statement execute function public.gl_no_truncate();

-- A line can only be written while its entry is being written, in the same
-- book, against an account of that book.
create or replace function public.gl_line_shape() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.gl_entries%rowtype;
begin
  select * into e from public.gl_entries where id = new.entry_id;
  if not found then raise exception 'That ledger entry does not exist' using errcode = '23503'; end if;
  if e.posted_at <> now() then raise exception 'A line cannot be added to an entry that is already posted' using errcode = '42501'; end if;
  new.book_id := e.book_id;
  if not exists (select 1 from public.ledger_accounts a where a.id = new.account_id and a.book_id = e.book_id) then
    raise exception 'That account belongs to a different set of books' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.gl_line_shape() from public, anon, authenticated, service_role;
drop trigger if exists trg_gl_line_shape on public.gl_lines;
create trigger trg_gl_line_shape before insert on public.gl_lines for each row execute function public.gl_line_shape();

-- Balanced or rejected. Checked when the work is committed, for every entry
-- written, whoever wrote it.
create or replace function public.gl_balanced() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry uuid := coalesce(to_jsonb(new) ->> 'entry_id', to_jsonb(new) ->> 'id')::uuid; d bigint; c bigint; n integer;
begin
  if not exists (select 1 from public.gl_entries where id = v_entry) then return null; end if;
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*) into d, c, n from public.gl_lines where entry_id = v_entry;
  if n < 2 or d <> c or d = 0 then
    raise exception 'A ledger entry must balance: % cents of debits and % of credits on % line(s)', d, c, n using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function public.gl_balanced() from public, anon, authenticated, service_role;
drop trigger if exists trg_gl_entry_balanced on public.gl_entries;
create constraint trigger trg_gl_entry_balanced after insert on public.gl_entries
  deferrable initially deferred for each row execute function public.gl_balanced();
drop trigger if exists trg_gl_line_balanced on public.gl_lines;
create constraint trigger trg_gl_line_balanced after insert on public.gl_lines
  deferrable initially deferred for each row execute function public.gl_balanced();

-- ── 5. Finding (or opening) the account an entry touches ────────────────────
create or replace function public.ledger_system_account(p_book uuid, p_key text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid; v_class text; v_name text;
begin
  select id into v from public.ledger_accounts where book_id = p_book and system_key = p_key;
  if v is not null then return v; end if;
  select x.class, x.name into v_class, v_name from (values
    ('opening_equity',        'equity',  'Opening balances'),
    ('uncategorized_income',  'income',  'Money in, no category yet'),
    ('uncategorized_expense', 'expense', 'Money out, no category yet'),
    ('personal',              'equity',  'Personal, not business'),
    ('no_account',            'asset',   'No account named')) x(key, class, name) where x.key = p_key;
  if v_class is null then raise exception 'unknown ledger account %', p_key; end if;
  insert into public.ledger_accounts (book_id, class, name, system_key) values (p_book, v_class, v_name, p_key)
  on conflict (book_id, system_key) where system_key is not null do nothing returning id into v;
  if v is null then select id into v from public.ledger_accounts where book_id = p_book and system_key = p_key; end if;
  return v;
end $$;
revoke all on function public.ledger_system_account(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.ledger_category_account(p_cat uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid; c public.tax_categories%rowtype;
begin
  select id into v from public.ledger_accounts where tax_category_id = p_cat;
  if v is not null then return v; end if;
  select * into c from public.tax_categories where id = p_cat;
  if not found then return null; end if;
  insert into public.ledger_accounts (book_id, class, name, tax_category_id, retired_at)
  values (c.book_id, case c.kind when 'income' then 'income' when 'expense' then 'expense' when 'held' then 'liability'
                       when 'liability' then 'liability' when 'asset' then 'asset' when 'transfer' then 'asset' else 'equity' end,
          c.name, c.id, case when c.is_archived then now() end)
  on conflict (tax_category_id) where tax_category_id is not null do nothing returning id into v;
  if v is null then select id into v from public.ledger_accounts where tax_category_id = p_cat; end if;
  return v;
end $$;
revoke all on function public.ledger_category_account(uuid) from public, anon, authenticated, service_role;

-- A money account by the name typed on an entry. Naming a new one opens it.
create or replace function public.ledger_money_account(p_book uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid; m public.money_accounts%rowtype; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then return public.ledger_system_account(p_book, 'no_account'); end if;
  select * into m from public.money_accounts where book_id = p_book and lower(btrim(name)) = lower(v_name);
  if not found then
    -- Named for the first time on an entry: opened as a bank account, or as a
    -- card when the name says so. The kind can be changed under Setup.
    insert into public.money_accounts (book_id, name, kind)
    values (p_book, v_name, case when v_name ~* '(credit|visa|amex|american express|master ?card|\mcard\M)'
                                  and v_name !~* '(debit|checking|savings|bank)' then 'card' else 'bank' end)
    on conflict do nothing;
    select * into m from public.money_accounts where book_id = p_book and lower(btrim(name)) = lower(v_name);
  end if;
  select id into v from public.ledger_accounts where money_account_id = m.id;
  if v is null then
    insert into public.ledger_accounts (book_id, class, name, money_account_id)
    values (p_book, case m.kind when 'card' then 'liability' else 'asset' end, btrim(m.name), m.id)
    on conflict (money_account_id) where money_account_id is not null do nothing returning id into v;
    if v is null then select id into v from public.ledger_accounts where money_account_id = m.id; end if;
  end if;
  return v;
end $$;
revoke all on function public.ledger_money_account(uuid, text) from public, anon, authenticated, service_role;

-- ── 6. Posting ──────────────────────────────────────────────────────────────
-- One entry, two lines. p_cents > 0 puts money INTO account A (debit A, credit
-- B); p_cents < 0 takes it out (credit A, debit B).
create or replace function public.ledger_post(p_book uuid, p_date date, p_tx uuid, p_opening uuid, p_replaces uuid, p_memo text, p_a uuid, p_b uuid, p_cents bigint, p_by uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if p_cents = 0 or p_a is null or p_b is null or p_a = p_b then return null; end if;
  insert into public.gl_entries (book_id, entry_date, transaction_id, opening_for, replaces_id, memo, posted_by)
  values (p_book, p_date, p_tx, p_opening, p_replaces, nullif(left(btrim(coalesce(p_memo, '')), 200), ''), coalesce(auth.uid(), p_by)) returning id into v;
  insert into public.gl_lines (entry_id, book_id, account_id, debit_cents, credit_cents) values
    (v, p_book, p_a, greatest(p_cents, 0), greatest(-p_cents, 0)),
    (v, p_book, p_b, greatest(-p_cents, 0), greatest(p_cents, 0));
  return v;
end $$;
revoke all on function public.ledger_post(uuid, date, uuid, uuid, uuid, text, uuid, uuid, bigint, uuid) from public, anon, authenticated, service_role;

-- Undo a posted entry: the same lines with the sides swapped, on the same date.
create or replace function public.ledger_reverse(p_entry uuid, p_by uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.gl_entries%rowtype; v uuid;
begin
  select * into e from public.gl_entries where id = p_entry;
  if not found then return null; end if;
  insert into public.gl_entries (book_id, entry_date, transaction_id, opening_for, reverses_id, memo, posted_by)
  values (e.book_id, e.entry_date, e.transaction_id, e.opening_for, e.id, e.memo, coalesce(auth.uid(), p_by)) returning id into v;
  insert into public.gl_lines (entry_id, book_id, account_id, debit_cents, credit_cents)
  select v, l.book_id, l.account_id, l.credit_cents, l.debit_cents from public.gl_lines l where l.entry_id = e.id;
  return v;
end $$;
revoke all on function public.ledger_reverse(uuid, uuid) from public, anon, authenticated, service_role;

-- Post one checkbook entry as it stands now.
create or replace function public.ledger_post_tx(p_tx uuid, p_replaces uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions%rowtype; v_a uuid; v_b uuid;
begin
  select * into t from public.transactions where id = p_tx;
  if not found or t.is_archived or t.amount = 0 then return null; end if;
  -- An account that was retired and is named on a new entry is in use again.
  update public.money_accounts set retired_at = null
   where book_id = t.book_id and retired_at is not null
     and lower(btrim(name)) in (lower(btrim(coalesce(t.account, ''))), lower(btrim(coalesce(t.transfer_account, ''))));
  v_a := public.ledger_money_account(t.book_id, t.account);
  if btrim(coalesce(t.transfer_account, '')) <> '' then v_b := public.ledger_money_account(t.book_id, t.transfer_account);
  elsif t.scope is distinct from 'business' then v_b := public.ledger_system_account(t.book_id, 'personal');
  elsif t.tax_category_id is not null then v_b := public.ledger_category_account(t.tax_category_id);
  end if;
  if v_b is null then
    v_b := public.ledger_system_account(t.book_id, case when t.amount > 0 then 'uncategorized_income' else 'uncategorized_expense' end);
  end if;
  return public.ledger_post(t.book_id, t.date, t.id, null, p_replaces, coalesce(t.payee, t.description), v_a, v_b,
                            round(t.amount * 100)::bigint, coalesce(t.updated_by, t.entered_by));
end $$;
revoke all on function public.ledger_post_tx(uuid, uuid) from public, anon, authenticated, service_role;

-- Before an entry is saved: a transfer names two different accounts of the
-- book and is filed under the book's transfer category, so every older report
-- that reads categories leaves it out of income and spending.
create or replace function public.ledger_entry_shape() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if btrim(coalesce(new.transfer_account, '')) = '' then
    -- No longer a transfer: it does not stay filed under the transfer category.
    if tg_op = 'UPDATE' and btrim(coalesce(old.transfer_account, '')) <> '' and new.tax_category_id is not distinct from old.tax_category_id then
      new.tax_category_id := null;
    end if;
    new.transfer_account := null; return new;
  end if;
  new.transfer_account := btrim(new.transfer_account);
  if btrim(coalesce(new.account, '')) = '' then raise exception 'A transfer needs the account the money left' using errcode = '23514'; end if;
  if lower(btrim(new.account)) = lower(new.transfer_account) then raise exception 'A transfer needs two different accounts' using errcode = '23514'; end if;
  new.personal_budget_line_id := null; new.lead_gen_system_id := null; new.recruiting_system_id := null;
  new.tax_category_id := (select c.id from public.tax_categories c
                           where c.book_id = new.book_id and c.kind in ('transfer') order by c.is_archived, c.sort_order limit 1);
  if new.tax_category_id is null then
    insert into public.tax_categories (book_id, name, schedule_c_line, kind, sort_order, description)
    values (new.book_id, 'Transfers & Card Payments', '(not Schedule C)', 'transfer', 91, 'Money moved between your own accounts')
    returning id into new.tax_category_id;
  end if;
  return new;
end $$;
revoke all on function public.ledger_entry_shape() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_3_shape on public.transactions;
create trigger trg_book_3_shape before insert or update on public.transactions for each row execute function public.ledger_entry_shape();

-- After an entry is saved, changed or removed: reverse what was posted for it,
-- post what it says now.
create or replace function public.ledger_on_entry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_book uuid := coalesce(new.book_id, old.book_id); was_live boolean; is_live boolean; v_live uuid; v_by uuid;
begin
  if public.book_is_going(v_book) then return null; end if;
  was_live := tg_op <> 'INSERT' and not old.is_archived and old.amount <> 0;
  is_live  := tg_op <> 'DELETE' and not new.is_archived and new.amount <> 0;
  if tg_op = 'UPDATE' and was_live and is_live
     and row(old.id, old.date, old.amount, lower(btrim(coalesce(old.account, ''))), old.tax_category_id, lower(btrim(coalesce(old.transfer_account, ''))), old.scope)
         is not distinct from
         row(new.id, new.date, new.amount, lower(btrim(coalesce(new.account, ''))), new.tax_category_id, lower(btrim(coalesce(new.transfer_account, ''))), new.scope)
  then return null; end if;
  v_by := case when tg_op = 'DELETE' then coalesce(old.updated_by, old.entered_by) else coalesce(new.updated_by, new.entered_by) end;
  if was_live then
    select e.id into v_live from public.gl_live e where e.transaction_id = old.id order by e.seq desc limit 1;
    if v_live is not null then perform public.ledger_reverse(v_live, v_by); end if;
  end if;
  if is_live then perform public.ledger_post_tx(new.id, v_live); end if;
  return null;
end $$;
revoke all on function public.ledger_on_entry() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_7_post on public.transactions;
create trigger trg_book_7_post after insert or update or delete on public.transactions for each row execute function public.ledger_on_entry();

-- A money account: its ledger account follows its name and kind, and its
-- starting balance is posted as an opening entry (reversed and re-posted when
-- the starting balance is corrected).
create or replace function public.ledger_on_money_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acct uuid; v_live uuid; v_date date; v_closed date; v_class text := case new.kind when 'card' then 'liability' else 'asset' end;
begin
  if public.book_is_going(new.book_id) then return null; end if;
  -- Entries name their account by its name, so the name is the account: a new
  -- name would quietly become a second account.
  if tg_op = 'UPDATE' and lower(btrim(new.name)) <> lower(btrim(old.name)) then
    raise exception 'An account cannot be renamed. Open a new one and move the balance with a transfer.' using errcode = 'P0001';
  end if;
  select b.closed_through, coalesce(b.starts_on, date '1900-01-02') - 1 into v_closed, v_date from public.books b where b.id = new.book_id;
  if tg_op = 'UPDATE' and v_closed is not null and pg_trigger_depth() = 1
     and (old.starting_balance is distinct from new.starting_balance or old.kind is distinct from new.kind) then
    raise exception 'These books are closed through %. Reopen them to change an account''s starting balance or kind.', to_char(v_closed, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
  end if;
  v_acct := public.ledger_money_account(new.book_id, new.name);
  update public.ledger_accounts set name = btrim(new.name), class = v_class, retired_at = new.retired_at
   where id = v_acct and (name is distinct from btrim(new.name) or class is distinct from v_class or retired_at is distinct from new.retired_at);
  if tg_op = 'INSERT' or old.starting_balance is distinct from new.starting_balance then
    select e.id into v_live from public.gl_live e where e.opening_for = new.id order by e.seq desc limit 1;
    if v_live is not null then perform public.ledger_reverse(v_live, null); end if;
    perform public.ledger_post(new.book_id, v_date, null, new.id, v_live, 'Starting balance: ' || btrim(new.name), v_acct,
                               public.ledger_system_account(new.book_id, 'opening_equity'), round(new.starting_balance * 100)::bigint, null);
  end if;
  return null;
end $$;
revoke all on function public.ledger_on_money_account() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_7_ledger on public.money_accounts;
create trigger trg_book_7_ledger after insert or update on public.money_accounts for each row execute function public.ledger_on_money_account();

create or replace function public.ledger_on_category() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acct uuid; v_class text; v_closed date;
begin
  if public.book_is_going(new.book_id) then return null; end if;
  -- What kind of money a category is decides how every past entry under it
  -- reads, so it does not change under a closed period.
  if tg_op = 'UPDATE' and old.kind is distinct from new.kind and pg_trigger_depth() = 1 then
    select b.closed_through into v_closed from public.books b where b.id = new.book_id;
    if v_closed is not null and exists (select 1 from public.transactions t where t.tax_category_id = new.id and t.date <= v_closed) then
      raise exception 'These books are closed through %. Reopen them to change what kind of money "%" is.', to_char(v_closed, 'FMMonth FMDD, YYYY'), new.name using errcode = 'P0001';
    end if;
  end if;
  v_acct := public.ledger_category_account(new.id);
  v_class := case new.kind when 'income' then 'income' when 'expense' then 'expense' when 'held' then 'liability'
                           when 'liability' then 'liability' when 'asset' then 'asset' when 'transfer' then 'asset' else 'equity' end;
  update public.ledger_accounts set name = new.name, class = v_class,
         retired_at = case when new.is_archived then coalesce(retired_at, now()) end
   where id = v_acct and (name is distinct from new.name or class is distinct from v_class or (retired_at is not null) is distinct from new.is_archived);
  return null;
end $$;
revoke all on function public.ledger_on_category() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_7_ledger on public.tax_categories;
create trigger trg_book_7_ledger after insert or update on public.tax_categories for each row execute function public.ledger_on_category();

-- Retired, never deleted, once used.
create or replace function public.ledger_keep_used() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Hold the ledger account while deciding, so an entry being posted to it at
  -- this very moment is seen.
  perform 1 from public.ledger_accounts a
    where (tg_table_name = 'tax_categories' and a.tax_category_id = old.id) or (tg_table_name = 'money_accounts' and a.money_account_id = old.id) for update;
  if pg_trigger_depth() = 1 and not public.book_is_going(old.book_id) and exists (
       select 1 from public.ledger_accounts a join public.gl_lines l on l.account_id = a.id
        where (tg_table_name = 'tax_categories' and a.tax_category_id = old.id) or (tg_table_name = 'money_accounts' and a.money_account_id = old.id)) then
    raise exception '"%" has entries in the ledger. It can be retired, not deleted.', old.name using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.ledger_keep_used() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_6_keep on public.tax_categories;
create trigger trg_book_6_keep before delete on public.tax_categories for each row execute function public.ledger_keep_used();
drop trigger if exists trg_book_6_keep on public.money_accounts;
create trigger trg_book_6_keep before delete on public.money_accounts for each row execute function public.ledger_keep_used();

-- ── 7. Post what is already in the books ────────────────────────────────────
do $$ declare r record; begin
  for r in select id from public.tax_categories loop perform public.ledger_category_account(r.id); end loop;
  for r in select m.* from public.money_accounts m where not exists (select 1 from public.gl_entries e where e.opening_for = m.id) loop
    perform public.ledger_post(r.book_id, (select coalesce(b.starts_on, date '1900-01-02') - 1 from public.books b where b.id = r.book_id), null, r.id, null,
                               'Starting balance: ' || btrim(r.name), public.ledger_money_account(r.book_id, r.name),
                               public.ledger_system_account(r.book_id, 'opening_equity'), round(r.starting_balance * 100)::bigint, null);
  end loop;
  for r in select t.id from public.transactions t
            where not t.is_archived and t.amount <> 0 and not exists (select 1 from public.gl_entries e where e.transaction_id = t.id)
            order by t.date, t.created_at loop
    perform public.ledger_post_tx(r.id, null);
  end loop;
end $$;

-- ── 8. What the screens read: from the journal ──────────────────────────────
-- A balance for each account. Runs as the caller. An account that is no
-- longer used and holds nothing is left off.
create or replace function public.book_account_balances(p_book uuid)
returns table (account text, entries integer, starting_balance numeric, balance numeric, kind text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with used as (
    select k.key, count(*)::int as entries
      from public.transactions t
      cross join lateral (select distinct x.key from unnest(array[lower(btrim(coalesce(t.account, ''))), lower(btrim(coalesce(t.transfer_account, '')))]) x(key) where x.key <> '') k
     where t.book_id = p_book and t.is_archived = false
     group by k.key
  ), bal as (
    select a.money_account_id, sum(l.debit_cents - l.credit_cents) as cents
      from public.ledger_accounts a join public.gl_lines l on l.account_id = a.id
     where a.book_id = p_book and a.money_account_id is not null
     group by a.money_account_id
  )
  select btrim(m.name), coalesce(u.entries, 0), m.starting_balance, round(coalesce(b.cents, 0) / 100.0, 2), m.kind
    from public.money_accounts m
    left join used u on u.key = lower(btrim(m.name))
    left join bal b on b.money_account_id = m.id
   where m.book_id = p_book and (m.retired_at is null or coalesce(b.cents, 0) <> 0)
   order by coalesce(u.entries, 0) desc, 1;
$$;
revoke all on function public.book_account_balances(uuid) from public, anon;
grant execute on function public.book_account_balances(uuid) to authenticated;

-- Stop offering an account (or offer it again). It keeps its history.
create or replace function public.retire_book_account(p_book uuid, p_account text, p_retire boolean default true)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_role := public.book_role(p_book);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Only an owner or admin can change account settings' using errcode = '42501'; end if;
  update public.money_accounts set retired_at = case when p_retire then coalesce(retired_at, now()) end, updated_at = now()
   where book_id = p_book and lower(btrim(name)) = lower(btrim(coalesce(p_account, '')));
  if not found then raise exception 'These books have no account with that name' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.retire_book_account(uuid, text, boolean) from public, anon;
grant execute on function public.retire_book_account(uuid, text, boolean) to authenticated;

-- Money in and out by category for a stretch of time. Transfers and personal
-- entries are not in it. "kind" keeps the four words older phones know.
create or replace function public.book_summary(p_book uuid, p_from date default null, p_to date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with g as (
    select a.id, a.class, a.system_key, c.id as category_id, coalesce(c.name, '') as name, c.kind as cat_kind, coalesce(c.sort_order, 100000) as ord,
           count(distinct e.id)::int as entries, sum(l.credit_cents) as cr, sum(l.debit_cents) as dr
      from public.gl_live e
      join public.gl_lines l on l.entry_id = e.id
      join public.ledger_accounts a on a.id = l.account_id
      left join public.tax_categories c on c.id = a.tax_category_id
     where e.book_id = p_book and e.transaction_id is not null
       and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
       and a.money_account_id is null and coalesce(a.system_key, '') not in ('no_account', 'personal', 'opening_equity')
     group by a.id, a.class, a.system_key, c.id, c.name, c.kind, c.sort_order
  )
  select jsonb_build_object('lines', coalesce(jsonb_agg(jsonb_build_object(
           'category_id', g.category_id, 'name', g.name, 'class', g.class,
           'kind', case when g.category_id is null then 'none' when g.cat_kind in ('income', 'expense', 'held') then g.cat_kind else 'other' end,
           'entries', g.entries, 'money_in', round(g.cr / 100.0, 2), 'money_out', round(g.dr / 100.0, 2))
           order by g.ord, g.name), '[]'::jsonb))
    from g
$$;
revoke all on function public.book_summary(uuid, date, date) from public, anon;
grant execute on function public.book_summary(uuid, date, date) to authenticated;

-- Where the books stand on a day: every account with a balance, by class.
-- "balance" is debits less credits, in dollars; the screen turns what is owed
-- and what is the owners' the right way up.
create or replace function public.book_position(p_book uuid, p_as_of date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with g as (
    select a.id, a.class, a.name, a.system_key, m.kind as account_kind, c.kind as category_kind,
           sum(l.debit_cents - l.credit_cents) as cents
      from public.gl_lines l
      join public.gl_entries e on e.id = l.entry_id
      join public.ledger_accounts a on a.id = l.account_id
      left join public.money_accounts m on m.id = a.money_account_id
      left join public.tax_categories c on c.id = a.tax_category_id
     where l.book_id = p_book and (p_as_of is null or e.entry_date <= p_as_of)
     group by a.id, a.class, a.name, a.system_key, m.kind, c.kind
    having sum(l.debit_cents - l.credit_cents) <> 0
  )
  select jsonb_build_object('lines', coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'class', g.class, 'name', g.name, 'system_key', g.system_key, 'account_kind', g.account_kind,
           'category_kind', g.category_kind, 'balance', round(g.cents / 100.0, 2)) order by g.class, g.name), '[]'::jsonb))
    from g
$$;
revoke all on function public.book_position(uuid, date) from public, anon;
grant execute on function public.book_position(uuid, date) to authenticated;

-- The history of one checkbook entry: what was posted, undone and re-posted.
create or replace function public.book_entry_history(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_book uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select e.book_id into v_book from public.gl_entries e where e.transaction_id = p_tx limit 1;
  if v_book is null then return '[]'::jsonb; end if;
  if public.book_role(v_book) is null then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'date', e.entry_date, 'posted_at', e.posted_at,
        'by', case when e.posted_by is null then 'PrismOS' else public.book_person_label(e.posted_by) end,
        'what', case when e.reverses_id is not null then 'reversed' when e.replaces_id is not null then 'corrected' else 'entered' end,
        'amount', (select round(sum(l.debit_cents) / 100.0, 2) from public.gl_lines l where l.entry_id = e.id),
        'debit', (select string_agg(a.name, ', ') from public.gl_lines l join public.ledger_accounts a on a.id = l.account_id where l.entry_id = e.id and l.debit_cents > 0),
        'credit', (select string_agg(a.name, ', ') from public.gl_lines l join public.ledger_accounts a on a.id = l.account_id where l.entry_id = e.id and l.credit_cents > 0))
      order by e.seq), '[]'::jsonb)
      from public.gl_entries e where e.transaction_id = p_tx);
end $$;
revoke all on function public.book_entry_history(uuid) from public, anon;
grant execute on function public.book_entry_history(uuid) to authenticated;

-- ── 9. The standing checks ──────────────────────────────────────────────────
-- One row per fault; no rows means every set of books is sound. For the gate
-- and the database's own role only.
create or replace function public.ledger_health() returns table (book_id uuid, problem text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' and session_user <> 'postgres' then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  -- every entry balances and has at least two lines
  select e.book_id, format('entry %s does not balance: %s debit, %s credit, %s line(s)', e.id, coalesce(s.d, 0), coalesce(s.c, 0), coalesce(s.n, 0))
    from public.gl_entries e
    left join lateral (select sum(l.debit_cents) d, sum(l.credit_cents) c, count(*) n from public.gl_lines l where l.entry_id = e.id) s on true
   where coalesce(s.n, 0) < 2 or s.d is distinct from s.c
  union all
  -- the trial balance nets to zero
  select l.book_id, format('trial balance is off by %s cents', sum(l.debit_cents - l.credit_cents))
    from public.gl_lines l group by l.book_id having sum(l.debit_cents - l.credit_cents) <> 0
  union all
  -- assets = liabilities + equity + (income - expenses)
  select x.book_id, format('assets %s do not equal liabilities + equity + earnings %s (cents)', x.assets, x.rest)
    from (select l.book_id,
                 coalesce(sum(l.debit_cents - l.credit_cents) filter (where a.class in ('asset')), 0) as assets,
                 coalesce(sum(l.credit_cents - l.debit_cents) filter (where a.class not in ('asset')), 0) as rest
            from public.gl_lines l join public.ledger_accounts a on a.id = l.account_id group by l.book_id) x
   where x.assets <> x.rest
  union all
  -- every checkbook entry that stands is posted exactly once, for its own amount and date
  select t.book_id, format('entry %s (%s, %s) is posted %s time(s), for %s cents on %s', t.id, t.date, t.amount, coalesce(j.n, 0), j.cents, j.d)
    from public.transactions t
    left join lateral (select count(*) n, max(e.entry_date) d, sum(x.cents)::bigint cents
                         from public.gl_live e
                         left join lateral (select sum(l.debit_cents) cents from public.gl_lines l where l.entry_id = e.id) x on true
                        where e.transaction_id = t.id) j on true
   where not t.is_archived and t.amount <> 0
     and (coalesce(j.n, 0) <> 1 or j.d is distinct from t.date or j.cents is distinct from round(abs(t.amount) * 100)::bigint)
  union all
  -- nothing stands in the journal for an entry that is gone
  select e.book_id, format('journal entry %s stands for a checkbook entry that is removed or missing', e.id)
    from public.gl_live e
   where e.transaction_id is not null
     and not exists (select 1 from public.transactions t where t.id = e.transaction_id and not t.is_archived and t.amount <> 0)
  union all
  -- each account's ledger balance equals its starting balance plus its entries
  select m.book_id, format('account "%s": ledger says %s cents, the checkbook adds up to %s', m.name, coalesce(l.cents, 0), round(m.starting_balance * 100)::bigint + coalesce(c.cents, 0))
    from public.money_accounts m
    left join public.ledger_accounts a on a.money_account_id = m.id
    left join lateral (select sum(jl.debit_cents - jl.credit_cents)::bigint cents from public.gl_lines jl where jl.account_id = a.id) l on true
    left join lateral (select sum(case when lower(btrim(coalesce(t.account, ''))) = lower(btrim(m.name)) then round(t.amount * 100) else -round(t.amount * 100) end)::bigint cents
                         from public.transactions t
                        where t.book_id = m.book_id and not t.is_archived
                          and lower(btrim(m.name)) in (lower(btrim(coalesce(t.account, ''))), lower(btrim(coalesce(t.transfer_account, ''))))) c on true
   where coalesce(l.cents, 0) <> round(m.starting_balance * 100)::bigint + coalesce(c.cents, 0)
  union all
  -- no lines sit on an account that belongs to nothing
  select a.book_id, format('ledger account "%s" has entries but is no account, category or system account', a.name)
    from public.ledger_accounts a
   where a.money_account_id is null and a.tax_category_id is null and a.system_key is null
     and exists (select 1 from public.gl_lines l where l.account_id = a.id)
  union all
  -- each standing entry is posted to the accounts its checkbook entry names
  select t.book_id, format('entry %s (%s) is posted to the wrong account', t.id, coalesce(t.payee, t.description, t.account, 'no payee'))
    from public.transactions t
    join public.gl_live e on e.transaction_id = t.id
   where not t.is_archived and t.amount <> 0
     and (not exists (select 1 from public.gl_lines l join public.ledger_accounts a on a.id = l.account_id
                       left join public.money_accounts m on m.id = a.money_account_id
                      where l.entry_id = e.id
                        and case when btrim(coalesce(t.account, '')) = '' then a.system_key is not distinct from 'no_account'
                                 else lower(btrim(m.name)) = lower(btrim(t.account)) end)
       or not exists (select 1 from public.gl_lines l join public.ledger_accounts a on a.id = l.account_id
                       left join public.money_accounts m on m.id = a.money_account_id
                      where l.entry_id = e.id
                        and case when btrim(coalesce(t.transfer_account, '')) <> '' then lower(btrim(m.name)) = lower(btrim(t.transfer_account))
                                 when t.scope is distinct from 'business' then a.system_key is not distinct from 'personal'
                                 when t.tax_category_id is not null then a.tax_category_id = t.tax_category_id
                                 else a.system_key in ('uncategorized_income', 'uncategorized_expense') end));
end $$;
revoke all on function public.ledger_health() from public, anon, authenticated;
grant execute on function public.ledger_health() to service_role;
