-- Books: who may see and work in which set of books.
--
-- Dara, 6 Oct 2026: Dara (Broker), Josh and Alexander (Broker Admins) keep the
-- books of Realty ONE Group Advantage in PrismOS; each person keeps their own;
-- a team has books its leader controls, with an assistant the leader can switch
-- on and off. "We don't want a double entry system ... we want it to be
-- checkbook style." And: an agent's own books belong to the agent; the
-- brokerage sees only the brokerage books.
--
-- ONE LEDGER. There is no second transactions table. A "book" is one complete,
-- separate set of accounts, and every row of the existing money tables
-- (transactions, tax_categories, money_accounts, recurring_transactions) now
-- belongs to exactly one book:
--   * a PERSONAL book  - user_id is its owner, exactly as before. Every
--     existing reader that asks for "my rows" (user_id = me) still gets the
--     same rows, so nothing already built changes.
--   * a SHARED book (the brokerage, a team) - user_id is NULL, so no personal
--     reader, report or tax form can ever pick those rows up by accident.
-- A trigger keeps (book_id, user_id) consistent on every write, whatever the
-- caller sends: a phone still on the previous version keeps working.
--
-- ACCESS IS A LIST OF NAMES. public.book_access holds one row per person per
-- book: owner, admin, assistant or read_only, and is_active - the switch.
-- Being Broker or Broker Admin grants NOTHING here; only a row does. The rules
-- are enforced by row-level security on every table, so switching someone off
-- takes effect on their next request, not their next sign-in.
--
-- NOTHING IS LOST, EVERYTHING IS SIGNED. Every entry carries who entered it and
-- who last changed it; public.book_log is an append-only record of every entry
-- added, changed or removed and every change to who has access. No one,
-- including an owner, can edit or delete it.
--
-- Additive. The existing "own rows" rules on the money tables are left in
-- place, so a person's access to their own books never depends on this file.
-- Idempotent. Safe to run twice.

-- ── 0. Rollback copies (archive schema, never public) ───────────────────────
create table if not exists archive.transactions_pre_books_20261006 as select * from public.transactions;
create table if not exists archive.tax_categories_pre_books_20261006 as select * from public.tax_categories;
create table if not exists archive.recurring_transactions_pre_books_20261006 as select * from public.recurring_transactions;
revoke all on archive.transactions_pre_books_20261006, archive.tax_categories_pre_books_20261006, archive.recurring_transactions_pre_books_20261006 from public, anon, authenticated;

-- ── 1. Books, the access list, the record, the release switch ───────────────
create table if not exists public.books (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('personal', 'team', 'brokerage')),
  template       text not null default 'agent' check (template in ('agent', 'team', 'property_management', 'brokerage')),
  name           text not null,
  owner_user_id  uuid references auth.users(id) on delete cascade,   -- the person, for a personal book; NULL for shared books
  principal_user_id uuid references auth.users(id) on delete set null, -- shared books: the one owner nobody else can remove or switch off
  team_id        uuid references public.teams(id) on delete set null,
  basis          text not null default 'cash' check (basis in ('cash', 'accrual')),
  starts_on      date,
  closed_through date,
  seeded_at      timestamptz,
  archived_at    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint books_personal_has_owner check ((kind = 'personal') = (owner_user_id is not null))
);
create unique index if not exists books_one_personal  on public.books (owner_user_id) where kind = 'personal';
create unique index if not exists books_one_brokerage on public.books ((true)) where kind = 'brokerage';
create unique index if not exists books_one_per_team  on public.books (team_id) where team_id is not null;

create table if not exists public.book_access (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,     -- NULL while the person has not signed in yet
  invite_email text,                                                 -- lower case; matched to a CONFIRMED sign-in email
  invite_name  text,
  role         text not null check (role in ('owner', 'admin', 'assistant', 'read_only')),
  is_active    boolean not null default true,                        -- the switch
  granted_by   uuid,
  granted_at   timestamptz not null default now(),
  switched_by  uuid,
  switched_at  timestamptz,
  claimed_at   timestamptz,                                          -- when a waiting seat was taken by the person signing in
  constraint book_access_names_someone check (user_id is not null or invite_email is not null or invite_name is not null)
);
create unique index if not exists book_access_one_per_person on public.book_access (book_id, user_id) where user_id is not null;
create unique index if not exists book_access_one_per_email  on public.book_access (book_id, lower(invite_email)) where user_id is null and invite_email is not null;
create unique index if not exists book_access_one_per_name   on public.book_access (book_id, lower(btrim(invite_name))) where user_id is null and invite_email is null;
create index if not exists book_access_by_user on public.book_access (user_id) where user_id is not null;

create table if not exists public.book_log (
  id            bigint generated always as identity primary key,
  book_id       uuid not null references public.books(id) on delete cascade,
  at            timestamptz not null default now(),
  actor         uuid,
  action        text not null,
  subject_user  uuid,
  subject_label text,
  entry_id      uuid,
  detail        jsonb
);
create index if not exists book_log_by_book  on public.book_log (book_id, at desc);
create index if not exists book_log_by_entry on public.book_log (entry_id) where entry_id is not null;

-- Who the new book screens are switched on for. Everyone else keeps the Money
-- room exactly as it was, unless someone puts them on a shared book's list.
create table if not exists public.accounting_access (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

-- Starter categories for each kind of book. Read only by the database.
create table if not exists public.book_category_templates (
  template   text not null,
  name       text not null,
  line       text not null default '—',      -- Schedule C line, for an agent's own books
  kind       text not null check (kind in ('income', 'expense', 'held', 'other')),
  ord        integer not null,
  meals      boolean not null default false,
  ded        numeric not null default 1,
  locked     boolean not null default false,
  aliases    text[] not null default '{}',   -- names already in use that mean the same thing (lower case)
  note       text,
  primary key (template, name)
);

alter table public.books                   enable row level security;
alter table public.book_access             enable row level security;
alter table public.book_log                enable row level security;
alter table public.accounting_access       enable row level security;
alter table public.book_category_templates enable row level security;
revoke all on public.books, public.book_access, public.book_log, public.accounting_access, public.book_category_templates from public, anon, authenticated;
grant select on public.books, public.book_access, public.book_log to authenticated;

-- ── 2. The four questions every rule asks ───────────────────────────────────
-- Definer functions: they read the access list itself, which nobody may read
-- directly beyond their own rows. A signed-out caller has no row, so gets
-- nothing; they are not callable signed out at all.
create or replace function public.my_books_readable() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.book_id from public.book_access a join public.books b on b.id = a.book_id
   where a.user_id = auth.uid() and a.is_active and b.archived_at is null
$$;
create or replace function public.my_books_writable() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.book_id from public.book_access a join public.books b on b.id = a.book_id
   where a.user_id = auth.uid() and a.is_active and b.archived_at is null and a.role in ('owner', 'admin', 'assistant')
$$;
create or replace function public.my_books_manageable() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.book_id from public.book_access a join public.books b on b.id = a.book_id
   where a.user_id = auth.uid() and a.is_active and b.archived_at is null and a.role in ('owner', 'admin')
$$;
create or replace function public.book_role(p_book uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select a.role from public.book_access a join public.books b on b.id = a.book_id
   where a.book_id = p_book and a.user_id = auth.uid() and a.is_active and b.archived_at is null
$$;
revoke all on function public.my_books_readable(), public.my_books_writable(), public.my_books_manageable(), public.book_role(uuid) from public, anon;
grant execute on function public.my_books_readable(), public.my_books_writable(), public.my_books_manageable(), public.book_role(uuid) to authenticated;

-- A person's name as PrismOS knows it ("Alexander (Broker) Khoyi" -> "Alexander Khoyi").
create or replace function public.book_person_label(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select nullif(btrim(regexp_replace(a.name, '\s*\([^)]*\)', '', 'g')), '') from public.agents a
      where a.auth_user_id = p_user order by a.active desc nulls last, a.created_at limit 1),
    (select nullif(btrim(s.display_name), '') from public.user_settings s where s.user_id = p_user limit 1),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user),
    'Someone')
$$;
revoke all on function public.book_person_label(uuid) from public, anon, authenticated;

create or replace function public.book_log_add(p_book uuid, p_action text, p_subject_user uuid, p_subject_label text, p_entry uuid, p_detail jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.book_log (book_id, actor, action, subject_user, subject_label, entry_id, detail)
  values (p_book, auth.uid(), p_action, p_subject_user, p_subject_label, p_entry, p_detail)
$$;
revoke all on function public.book_log_add(uuid, text, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ── 3. Every money row belongs to one book ──────────────────────────────────
alter table public.transactions           add column if not exists book_id uuid references public.books(id) on delete cascade;
alter table public.transactions           add column if not exists entered_by uuid;
alter table public.transactions           add column if not exists updated_by uuid;
alter table public.tax_categories         add column if not exists book_id uuid references public.books(id) on delete cascade;
alter table public.tax_categories         add column if not exists kind text not null default 'expense';
alter table public.money_accounts         add column if not exists book_id uuid references public.books(id) on delete cascade;
alter table public.money_accounts         add column if not exists kind text not null default 'bank';
alter table public.recurring_transactions add column if not exists book_id uuid references public.books(id) on delete cascade;
alter table public.transactions           alter column user_id drop not null;
alter table public.tax_categories         alter column user_id drop not null;
alter table public.money_accounts         alter column user_id drop not null;
alter table public.recurring_transactions alter column user_id drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tax_categories_kind_check') then
    alter table public.tax_categories add constraint tax_categories_kind_check check (kind in ('income', 'expense', 'held', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'money_accounts_kind_check') then
    alter table public.money_accounts add constraint money_accounts_kind_check check (kind in ('bank', 'card', 'escrow', 'cash', 'other'));
  end if;
end $$;

-- Found on the way: the app writes 'deal_close' (commission income when a deal
-- closes) and 'ari' (an entry added by voice), and the old rule refused both.
alter table public.transactions drop constraint if exists transactions_entered_via_check;
alter table public.transactions add constraint transactions_entered_via_check
  check (entered_via = any (array['manual', 'photo', 'csv', 'email', 'recurring', 'deal', 'deal_close', 'ari']));

create index if not exists transactions_by_book           on public.transactions (book_id, date desc);
create index if not exists tax_categories_by_book         on public.tax_categories (book_id);
create index if not exists recurring_transactions_by_book on public.recurring_transactions (book_id);
create unique index if not exists money_accounts_book_name on public.money_accounts (book_id, lower(btrim(name)));

-- ── 4. Starter categories ───────────────────────────────────────────────────
insert into public.book_category_templates (template, name, line, kind, ord, meals, ded, locked, aliases, note) values
  -- An agent's own books: lined up with Schedule C so the year-end report maps straight across.
  ('agent', 'Commission Income',                'Line 1',            'income',   0, false, 1,   true,  '{}', 'Commissions paid to you'),
  ('agent', 'Other Income',                     'Line 6',            'income',   1, false, 1,   false, '{referral income}', 'Referral fees received and other business income'),
  ('agent', 'Advertising & Marketing',          'Line 8',            'expense', 10, false, 1,   true,  '{marketing,advertising}', null),
  ('agent', 'Vehicle',                          'Line 9',            'expense', 11, false, 1,   false, '{auto (bus.),auto,car & truck}', 'Fuel, repairs, tolls, parking. Mileage is logged under My Drives'),
  ('agent', 'Commissions & Referral Fees Paid', 'Line 10',           'expense', 12, false, 1,   false, '{}', 'Brokerage fees, splits and referral fees you pay'),
  ('agent', 'Contract Labor',                   'Line 11',           'expense', 13, false, 1,   false, '{}', 'Assistants, transaction coordinators, photographers'),
  ('agent', 'Insurance',                        'Line 15',           'expense', 14, false, 1,   false, '{}', 'E&O and business insurance'),
  ('agent', 'Professional Services',            'Line 17',           'expense', 15, false, 1,   false, '{}', 'Legal and accounting'),
  ('agent', 'Office Expense',                   'Line 18',           'expense', 16, false, 1,   false, '{office}', null),
  ('agent', 'Licenses & Taxes',                 'Line 23',           'expense', 17, false, 1,   false, '{}', 'License renewals and business taxes'),
  ('agent', 'Travel',                           'Line 24a',          'expense', 18, false, 1,   false, '{travel & meals}', null),
  ('agent', 'Business Meals',                   'Line 24b',          'expense', 19, true,  0.5, false, '{meals & entertainment,meals}', 'Half is deductible'),
  ('agent', 'Phone & Internet',                 'Line 25',           'expense', 20, false, 1,   false, '{}', null),
  ('agent', 'Dues & Subscriptions',             'Line 27a',          'expense', 21, false, 1,   false, '{}', 'MLS, association dues, software'),
  ('agent', 'Education & Training',             'Line 27a',          'expense', 22, false, 1,   false, '{education & development}', null),
  ('agent', 'Bank & Card Fees',                 'Line 27a',          'expense', 23, false, 1,   false, '{}', null),
  ('agent', 'Other Business Expenses',          'Line 27a',          'expense', 24, false, 1,   false, '{}', null),
  ('agent', 'Estimated Tax Payments',           '(not Schedule C)',  'other',   90, false, 1,   true,  '{}', 'Quarterly payments to the IRS'),
  ('agent', 'Transfers & Card Payments',        '(not Schedule C)',  'other',   91, false, 1,   false, '{}', 'Money moved between your own accounts'),
  ('agent', 'Owner Draw',                       '(not Schedule C)',  'other',   92, false, 1,   false, '{}', 'Money you take out for yourself'),
  -- The brokerage.
  ('brokerage', 'Commission Income',            '—', 'income',   0, false, 1,   false, '{}', 'Gross commissions received'),
  ('brokerage', 'Agent Fees',                   '—', 'income',   1, false, 1,   false, '{}', 'Monthly, transaction and E&O fees collected from agents'),
  ('brokerage', 'Referral Income',              '—', 'income',   2, false, 1,   false, '{}', null),
  ('brokerage', 'Other Income',                 '—', 'income',   3, false, 1,   false, '{}', null),
  ('brokerage', 'Agent Commissions Paid',       '—', 'expense', 10, false, 1,   false, '{}', 'The agent''s share of each closing'),
  ('brokerage', 'Referral Fees Paid',           '—', 'expense', 11, false, 1,   false, '{}', null),
  ('brokerage', 'Franchise Fees & Royalties',   '—', 'expense', 12, false, 1,   false, '{}', 'Paid to Realty ONE Group'),
  ('brokerage', 'Payroll & Staff',              '—', 'expense', 13, false, 1,   false, '{}', null),
  ('brokerage', 'Contract Labor',               '—', 'expense', 14, false, 1,   false, '{}', null),
  ('brokerage', 'Rent & Occupancy',             '—', 'expense', 15, false, 1,   false, '{}', null),
  ('brokerage', 'Utilities, Phone & Internet',  '—', 'expense', 16, false, 1,   false, '{}', null),
  ('brokerage', 'Software & Subscriptions',     '—', 'expense', 17, false, 1,   false, '{}', null),
  ('brokerage', 'MLS & Association Dues',       '—', 'expense', 18, false, 1,   false, '{}', null),
  ('brokerage', 'Advertising & Marketing',      '—', 'expense', 19, false, 1,   false, '{}', null),
  ('brokerage', 'Recruiting',                   '—', 'expense', 20, false, 1,   false, '{}', null),
  ('brokerage', 'Insurance',                    '—', 'expense', 21, false, 1,   false, '{}', 'E&O, liability, workers'' compensation'),
  ('brokerage', 'Professional Services',        '—', 'expense', 22, false, 1,   false, '{}', 'Legal and accounting'),
  ('brokerage', 'Office Expense',               '—', 'expense', 23, false, 1,   false, '{}', null),
  ('brokerage', 'Licenses & Taxes',             '—', 'expense', 24, false, 1,   false, '{}', null),
  ('brokerage', 'Training & Events',            '—', 'expense', 25, false, 1,   false, '{}', null),
  ('brokerage', 'Travel',                       '—', 'expense', 26, false, 1,   false, '{}', null),
  ('brokerage', 'Business Meals',               '—', 'expense', 27, true,  0.5, false, '{}', 'Half is deductible'),
  ('brokerage', 'Bank & Card Fees',             '—', 'expense', 28, false, 1,   false, '{}', null),
  ('brokerage', 'Interest',                     '—', 'expense', 29, false, 1,   false, '{}', null),
  ('brokerage', 'Other Expenses',               '—', 'expense', 30, false, 1,   false, '{}', null),
  ('brokerage', 'Transfers & Card Payments',    '—', 'other',   90, false, 1,   false, '{}', 'Money moved between the company''s own accounts'),
  ('brokerage', 'Owner Distributions',          '—', 'other',   91, false, 1,   false, '{}', null),
  ('brokerage', 'Owner Contributions',          '—', 'other',   92, false, 1,   false, '{}', null),
  ('brokerage', 'Loan Principal',               '—', 'other',   93, false, 1,   false, '{}', 'The part of a loan payment that is not interest'),
  ('brokerage', 'Income Tax Payments',          '—', 'other',   94, false, 1,   false, '{}', null),
  -- A property-management team (Team Blue Koala).
  ('property_management', 'Management Fees',            '—', 'income',   0, false, 1,   false, '{}', null),
  ('property_management', 'Leasing Fees',               '—', 'income',   1, false, 1,   false, '{}', null),
  ('property_management', 'Renewal Fees',               '—', 'income',   2, false, 1,   false, '{}', null),
  ('property_management', 'Maintenance Fees',           '—', 'income',   3, false, 1,   false, '{}', null),
  ('property_management', 'Other Fee Income',           '—', 'income',   4, false, 1,   false, '{}', 'Application, late and other fees the team keeps'),
  ('property_management', 'Team Splits & Commissions Paid', '—', 'expense', 10, false, 1, false, '{}', null),
  ('property_management', 'Brokerage Fees',             '—', 'expense', 11, false, 1,   false, '{}', 'Paid to Realty ONE Group Advantage'),
  ('property_management', 'Payroll & Staff',            '—', 'expense', 12, false, 1,   false, '{}', null),
  ('property_management', 'Contract Labor',             '—', 'expense', 13, false, 1,   false, '{}', null),
  ('property_management', 'Software & Subscriptions',   '—', 'expense', 14, false, 1,   false, '{}', null),
  ('property_management', 'Advertising & Marketing',    '—', 'expense', 15, false, 1,   false, '{}', null),
  ('property_management', 'Insurance',                  '—', 'expense', 16, false, 1,   false, '{}', null),
  ('property_management', 'Professional Services',      '—', 'expense', 17, false, 1,   false, '{}', 'Legal and accounting'),
  ('property_management', 'Office Expense',             '—', 'expense', 18, false, 1,   false, '{}', null),
  ('property_management', 'Phone & Internet',           '—', 'expense', 19, false, 1,   false, '{}', null),
  ('property_management', 'Vehicle',                    '—', 'expense', 20, false, 1,   false, '{}', null),
  ('property_management', 'Licenses & Taxes',           '—', 'expense', 21, false, 1,   false, '{}', null),
  ('property_management', 'Bank & Card Fees',           '—', 'expense', 22, false, 1,   false, '{}', null),
  ('property_management', 'Other Expenses',             '—', 'expense', 23, false, 1,   false, '{}', null),
  ('property_management', 'Rent Collected for Owners',  '—', 'held',    50, false, 1,   false, '{}', 'Not the team''s money: held for the property owner'),
  ('property_management', 'Security Deposits Held',     '—', 'held',    51, false, 1,   false, '{}', 'Not the team''s money: held for the tenant'),
  ('property_management', 'Owner Payouts',              '—', 'held',    52, false, 1,   false, '{}', 'Paid out to property owners'),
  ('property_management', 'Repairs Paid for Owners',    '—', 'held',    53, false, 1,   false, '{}', 'Paid from an owner''s money'),
  ('property_management', 'Deposits Returned',          '—', 'held',    54, false, 1,   false, '{}', null),
  ('property_management', 'Transfers & Card Payments',  '—', 'other',   90, false, 1,   false, '{}', 'Money moved between the team''s own accounts'),
  ('property_management', 'Partner Distributions',      '—', 'other',   91, false, 1,   false, '{}', null),
  ('property_management', 'Partner Contributions',      '—', 'other',   92, false, 1,   false, '{}', null),
  -- A sales team.
  ('team', 'Commission Income',          '—', 'income',   0, false, 1,   false, '{}', null),
  ('team', 'Other Income',               '—', 'income',   1, false, 1,   false, '{}', null),
  ('team', 'Team Splits Paid',           '—', 'expense', 10, false, 1,   false, '{}', 'Paid to team members'),
  ('team', 'Brokerage Fees',             '—', 'expense', 11, false, 1,   false, '{}', null),
  ('team', 'Advertising & Marketing',    '—', 'expense', 12, false, 1,   false, '{}', null),
  ('team', 'Payroll & Staff',            '—', 'expense', 13, false, 1,   false, '{}', null),
  ('team', 'Contract Labor',             '—', 'expense', 14, false, 1,   false, '{}', null),
  ('team', 'Software & Subscriptions',   '—', 'expense', 15, false, 1,   false, '{}', null),
  ('team', 'Insurance',                  '—', 'expense', 16, false, 1,   false, '{}', null),
  ('team', 'Professional Services',      '—', 'expense', 17, false, 1,   false, '{}', null),
  ('team', 'Office Expense',             '—', 'expense', 18, false, 1,   false, '{}', null),
  ('team', 'Travel',                     '—', 'expense', 19, false, 1,   false, '{}', null),
  ('team', 'Business Meals',             '—', 'expense', 20, true,  0.5, false, '{}', 'Half is deductible'),
  ('team', 'Bank & Card Fees',           '—', 'expense', 21, false, 1,   false, '{}', null),
  ('team', 'Other Expenses',             '—', 'expense', 22, false, 1,   false, '{}', null),
  ('team', 'Transfers & Card Payments',  '—', 'other',   90, false, 1,   false, '{}', null),
  ('team', 'Member Distributions',       '—', 'other',   91, false, 1,   false, '{}', null)
on conflict (template, name) do update
  set line = excluded.line, kind = excluded.kind, ord = excluded.ord, meals = excluded.meals, ded = excluded.ded,
      locked = excluded.locked, aliases = excluded.aliases, note = excluded.note;

-- Add the starter categories a book does not have yet. Runs once per book:
-- after that the list is the people's own, and a category they removed stays
-- removed. A name already in use that means the same thing is left alone.
create or replace function public.book_seed_categories(p_book uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.books%rowtype;
begin
  select * into b from public.books where id = p_book;
  if not found or b.seeded_at is not null then return; end if;
  insert into public.tax_categories (book_id, name, schedule_c_line, kind, sort_order, is_meals_partial, deduction_pct, is_locked, description)
  select p_book, t.name, t.line, t.kind, t.ord, t.meals, t.ded, t.locked, t.note
    from public.book_category_templates t
   where t.template = b.template
     and not exists (select 1 from public.tax_categories c
                      where c.book_id = p_book and lower(btrim(c.name)) = any (array[lower(t.name)] || t.aliases));
  update public.books set seeded_at = now() where id = p_book;
end $$;
revoke all on function public.book_seed_categories(uuid) from public, anon, authenticated;

-- A person's own book, made the first time it is needed.
create or replace function public.ensure_personal_book(p_user uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if p_user is null then return null; end if;
  select id into v from public.books where kind = 'personal' and owner_user_id = p_user;
  if v is null then
    insert into public.books (kind, template, name, owner_user_id, created_by)
    values ('personal', 'agent', 'Personal', p_user, p_user)
    on conflict do nothing returning id into v;
    if v is null then select id into v from public.books where kind = 'personal' and owner_user_id = p_user; end if;
  end if;
  insert into public.book_access (book_id, user_id, role, granted_by) values (v, p_user, 'owner', p_user) on conflict do nothing;
  if exists (select 1 from public.accounting_access x where x.user_id = p_user) then perform public.book_seed_categories(v); end if;
  return v;
end $$;
revoke all on function public.ensure_personal_book(uuid) from public, anon, authenticated;

-- ── 5. Existing rows move into their owner's book ───────────────────────────
do $$ declare r record; begin
  for r in
    select distinct user_id from (
      select user_id from public.transactions where book_id is null
      union select user_id from public.tax_categories where book_id is null
      union select user_id from public.money_accounts where book_id is null
      union select user_id from public.recurring_transactions where book_id is null) s
     where user_id is not null
  loop perform public.ensure_personal_book(r.user_id); end loop;
end $$;
update public.transactions t           set book_id = b.id, entered_by = coalesce(t.entered_by, t.user_id) from public.books b where t.book_id is null and b.kind = 'personal' and b.owner_user_id = t.user_id;
update public.tax_categories t         set book_id = b.id from public.books b where t.book_id is null and b.kind = 'personal' and b.owner_user_id = t.user_id;
update public.money_accounts t         set book_id = b.id from public.books b where t.book_id is null and b.kind = 'personal' and b.owner_user_id = t.user_id;
update public.recurring_transactions t set book_id = b.id from public.books b where t.book_id is null and b.kind = 'personal' and b.owner_user_id = t.user_id;
alter table public.transactions           alter column book_id set not null;
alter table public.tax_categories         alter column book_id set not null;
alter table public.money_accounts         alter column book_id set not null;
alter table public.recurring_transactions alter column book_id set not null;

-- What kind of money each existing category is. Once: after that the kind is
-- the people's own choice and a second run must not overrule it.
do $$ begin
  if to_regclass('public._applied_sql') is null or not exists (select 1 from public._applied_sql where file = '2026-10-06b_books.sql') then
    update public.tax_categories set kind = 'other'  where kind = 'expense' and schedule_c_line = '(not Schedule C)';
    update public.tax_categories set kind = 'income' where kind = 'expense' and schedule_c_line is distinct from '(not Schedule C)'
       and (schedule_c_line in ('Line 1', '1', 'Line 6', '6') or name ilike '%income%');
  end if;
end $$;

-- ── 6. The trigger that keeps book and owner consistent ─────────────────────
-- Whatever the caller sends, the row leaves here with book_id set and user_id
-- equal to the book's owner (a person, or NULL for shared books). The security
-- rules then judge that row. So nobody can file a row into a book by claiming
-- to be its owner, and nobody can move a row from one book to another.
create or replace function public.book_row_stamp() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_kind text;
begin
  if tg_op = 'UPDATE' then
    if old.book_id is not null and new.book_id is distinct from old.book_id then
      raise exception 'An entry cannot be moved to another set of books' using errcode = '42501';
    end if;
    if old.book_id is not null then new.user_id := old.user_id; return new; end if;
  end if;
  if new.book_id is null then
    if new.user_id is null then new.user_id := auth.uid(); end if;
    if new.user_id is null then raise exception 'An entry needs a set of books' using errcode = '23502'; end if;
    new.book_id := public.ensure_personal_book(new.user_id);
  end if;
  select b.owner_user_id, b.kind into v_owner, v_kind from public.books b where b.id = new.book_id;
  if v_kind is null then raise exception 'That set of books does not exist' using errcode = '23503'; end if;
  new.user_id := v_owner;
  return new;
end $$;
revoke all on function public.book_row_stamp() from public, anon, authenticated;

-- Entries only: who entered it, who changed it, the category is this book's
-- own, shared books hold business money only, and a closed month stays closed.
create or replace function public.book_entry_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.books%rowtype;
begin
  if tg_op = 'DELETE' then
    select * into b from public.books where id = old.book_id;
    if found and b.closed_through is not null and pg_trigger_depth() = 1 and old.date <= b.closed_through then
      raise exception 'These books are closed through %. An owner or admin can reopen them.', to_char(b.closed_through, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
    end if;
    return old;
  end if;
  select * into b from public.books where id = new.book_id;
  if tg_op = 'INSERT' then
    new.entered_by := coalesce(auth.uid(), new.entered_by, new.user_id);
  else
    new.entered_by := old.entered_by;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  if b.kind <> 'personal' then
    new.scope := 'business'; new.personal_budget_line_id := null; new.lead_gen_system_id := null; new.recruiting_system_id := null; new.deal_id := null;
  end if;
  if new.tax_category_id is not null and not exists (select 1 from public.tax_categories c where c.id = new.tax_category_id and c.book_id = new.book_id) then
    raise exception 'That category belongs to a different set of books' using errcode = '23514';
  end if;
  -- Only a person's own change is held to the closing date. A change caused by
  -- another change (a category being removed, an account being closed) passes.
  if b.closed_through is not null and pg_trigger_depth() = 1
     and (new.date <= b.closed_through or (tg_op = 'UPDATE' and old.date <= b.closed_through)) then
    raise exception 'These books are closed through %. An owner or admin can reopen them.', to_char(b.closed_through, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.book_entry_guard() from public, anon, authenticated;

-- The record. One line per entry added, changed, removed or brought back.
create or replace function public.book_entry_record() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_action text; v_detail jsonb; v_row record;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.books where id = old.book_id) then return null; end if;   -- the whole book is going
    v_row := old; v_action := 'entry_deleted';
    v_detail := to_jsonb(old) - 'ai_raw_extract';
  elsif tg_op = 'INSERT' then
    v_row := new; v_action := 'entry_added';
    v_detail := jsonb_build_object('date', new.date, 'amount', new.amount, 'payee', new.payee, 'account', new.account,
                                   'description', new.description, 'category', new.tax_category_id, 'entered_via', new.entered_via);
  else
    v_row := new;
    select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value)) into v_detail
      from jsonb_each(to_jsonb(new)) n
     where n.value is distinct from (to_jsonb(old) -> n.key) and n.key not in ('updated_at', 'updated_by', 'ai_raw_extract');
    if v_detail is null then return null; end if;
    v_action := case when new.is_archived and not old.is_archived then 'entry_removed'
                     when old.is_archived and not new.is_archived then 'entry_restored' else 'entry_changed' end;
  end if;
  insert into public.book_log (book_id, actor, action, entry_id, subject_label, detail)
  values (v_row.book_id, auth.uid(), v_action, v_row.id, v_row.payee, v_detail);
  return null;
end $$;
revoke all on function public.book_entry_record() from public, anon, authenticated;

drop trigger if exists trg_book_1_stamp on public.transactions;
create trigger trg_book_1_stamp before insert or update on public.transactions for each row execute function public.book_row_stamp();
drop trigger if exists trg_book_2_entry_guard on public.transactions;
create trigger trg_book_2_entry_guard before insert or update or delete on public.transactions for each row execute function public.book_entry_guard();
drop trigger if exists trg_book_9_record on public.transactions;
create trigger trg_book_9_record after insert or update or delete on public.transactions for each row execute function public.book_entry_record();
drop trigger if exists trg_book_1_stamp on public.tax_categories;
create trigger trg_book_1_stamp before insert or update on public.tax_categories for each row execute function public.book_row_stamp();
drop trigger if exists trg_book_1_stamp on public.money_accounts;
create trigger trg_book_1_stamp before insert or update on public.money_accounts for each row execute function public.book_row_stamp();
drop trigger if exists trg_book_1_stamp on public.recurring_transactions;
create trigger trg_book_1_stamp before insert or update on public.recurring_transactions for each row execute function public.book_row_stamp();

-- Categories and accounts decide how past entries read (which kind of money a
-- category is, what an account started with), so changes to them are signed
-- into the record too, and a category used in a closed period cannot be deleted.
create or replace function public.book_setting_record() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_what text := case tg_table_name when 'tax_categories' then 'category' else 'account' end; v_detail jsonb; v_book uuid; v_name text;
begin
  if tg_op = 'DELETE' then
    v_book := old.book_id; v_name := old.name; v_detail := to_jsonb(old);
    if tg_table_name = 'tax_categories' and pg_trigger_depth() = 1 and exists (
         select 1 from public.transactions t join public.books b on b.id = t.book_id
          where t.tax_category_id = old.id and b.closed_through is not null and t.date <= b.closed_through) then
      raise exception 'This category is used by entries in a closed period. Stop using it instead of deleting it.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.books where id = v_book) then return old; end if;   -- the whole book is going
  elsif tg_op = 'INSERT' then
    v_book := new.book_id; v_name := new.name; v_detail := null;
  else
    v_book := new.book_id; v_name := new.name;
    select jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value)) into v_detail
      from jsonb_each(to_jsonb(new)) n
     where n.value is distinct from (to_jsonb(old) -> n.key) and n.key not in ('updated_at', 'sort_order', 'monthly_budget', 'color');
    if v_detail is null then return new; end if;
  end if;
  insert into public.book_log (book_id, actor, action, subject_label, detail)
  values (v_book, auth.uid(), v_what || case tg_op when 'INSERT' then '_added' when 'DELETE' then '_deleted' else '_changed' end, v_name, v_detail);
  return coalesce(new, old);
end $$;
revoke all on function public.book_setting_record() from public, anon, authenticated;
drop trigger if exists trg_book_8_delete_guard on public.tax_categories;
create trigger trg_book_8_delete_guard before delete on public.tax_categories for each row execute function public.book_setting_record();
drop trigger if exists trg_book_9_record on public.tax_categories;
create trigger trg_book_9_record after insert or update on public.tax_categories for each row execute function public.book_setting_record();
drop trigger if exists trg_book_9_record on public.money_accounts;
create trigger trg_book_9_record after insert or update or delete on public.money_accounts for each row execute function public.book_setting_record();

-- The record is append-only for everyone, the database's own roles included.
-- Its lines go only when the whole book goes (a person's account is deleted).
create or replace function public.book_log_locked() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.books where id = old.book_id) then
    raise exception 'The record of changes cannot be edited or deleted' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.book_log_locked() from public, anon, authenticated;
drop trigger if exists trg_book_log_locked on public.book_log;
create trigger trg_book_log_locked before update or delete on public.book_log for each row execute function public.book_log_locked();

-- A person's books go with their account and nowhere else; shared books that
-- hold entries cannot be deleted at all.
create or replace function public.book_delete_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.kind = 'personal' then
    if exists (select 1 from auth.users u where u.id = old.owner_user_id) then
      raise exception 'A person''s books stay with their account' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.transactions t where t.book_id = old.id) then
    raise exception 'These books hold entries and cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.book_delete_guard() from public, anon, authenticated;
drop trigger if exists trg_book_delete_guard on public.books;
create trigger trg_book_delete_guard before delete on public.books for each row execute function public.book_delete_guard();

-- ── 7. The security rules ───────────────────────────────────────────────────
-- Added beside the existing "own rows" rules, never instead of them.
drop policy if exists books_read on public.books;
create policy books_read on public.books for select to authenticated using (id in (select public.my_books_readable()));

drop policy if exists book_access_read on public.book_access;
create policy book_access_read on public.book_access for select to authenticated
  using (user_id = auth.uid() or book_id in (select public.my_books_manageable()));

drop policy if exists book_log_read on public.book_log;
create policy book_log_read on public.book_log for select to authenticated using (book_id in (select public.my_books_manageable()));

drop policy if exists transactions_book_read on public.transactions;
create policy transactions_book_read on public.transactions for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists transactions_book_add on public.transactions;
create policy transactions_book_add on public.transactions for insert to authenticated with check (book_id in (select public.my_books_writable()));
drop policy if exists transactions_book_change on public.transactions;
create policy transactions_book_change on public.transactions for update to authenticated
  using (book_id in (select public.my_books_writable())) with check (book_id in (select public.my_books_writable()));

drop policy if exists tax_categories_book_read on public.tax_categories;
create policy tax_categories_book_read on public.tax_categories for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists tax_categories_book_add on public.tax_categories;
create policy tax_categories_book_add on public.tax_categories for insert to authenticated with check (book_id in (select public.my_books_writable()));
drop policy if exists tax_categories_book_change on public.tax_categories;
create policy tax_categories_book_change on public.tax_categories for update to authenticated
  using (book_id in (select public.my_books_writable())) with check (book_id in (select public.my_books_writable()));

-- Bank account settings: owners and admins only. An assistant may not change them.
drop policy if exists money_accounts_book_read on public.money_accounts;
create policy money_accounts_book_read on public.money_accounts for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists money_accounts_book_add on public.money_accounts;
create policy money_accounts_book_add on public.money_accounts for insert to authenticated with check (book_id in (select public.my_books_manageable()));
drop policy if exists money_accounts_book_change on public.money_accounts;
create policy money_accounts_book_change on public.money_accounts for update to authenticated
  using (book_id in (select public.my_books_manageable())) with check (book_id in (select public.my_books_manageable()));

-- Repeating entries stay the person's own for now (the existing "own rows"
-- rule): the job that posts them (run-recurring-transactions) reads whatever
-- the caller can see and files it as the caller's, so it must not see another
-- book's templates. Shared books get repeating entries when that job is
-- taught about books.
drop policy if exists recurring_transactions_book_read on public.recurring_transactions;
drop policy if exists recurring_transactions_book_add on public.recurring_transactions;
drop policy if exists recurring_transactions_book_change on public.recurring_transactions;

-- Someone helping with a person's books can read that person's personal
-- category names, so a personal entry does not show as "no category".
drop policy if exists personal_budget_lines_book_read on public.personal_budget_lines;
create policy personal_budget_lines_book_read on public.personal_budget_lines for select to authenticated
  using (user_id in (select b.owner_user_id from public.books b where b.kind = 'personal' and b.id in (select public.my_books_readable())));

-- ── 8. Sign-in binds a waiting seat ─────────────────────────────────────────
-- A seat can be named before the person has a PrismOS sign-in. It becomes
-- theirs the first time they open Money with that email CONFIRMED.
-- An assistant or read-only seat named in the last 30 days opens by itself.
-- An owner or admin seat, or an older one, is bound but stays switched OFF
-- until an owner switches it on: an address typed wrong, or one that has
-- changed hands, must never open someone's books on its own.
create or replace function public.book_claim_seats(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text; r record; v_open boolean;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then return; end if;
  for r in select a.id, a.book_id, a.role, a.is_active, coalesce(a.switched_at, a.granted_at) as named_at from public.book_access a
            where a.user_id is null and lower(a.invite_email) = v_email
              and not exists (select 1 from public.book_access x where x.book_id = a.book_id and x.user_id = p_user)
  loop
    v_open := r.is_active and r.role in ('assistant', 'read_only') and r.named_at > now() - interval '30 days';
    update public.book_access set user_id = p_user, invite_email = null, claimed_at = now(), is_active = v_open where id = r.id;
    insert into public.book_log (book_id, actor, action, subject_user, subject_label, detail)
    values (r.book_id, p_user, 'access_claimed', p_user, public.book_person_label(p_user), jsonb_build_object('role', r.role, 'open', v_open));
  end loop;
end $$;
revoke all on function public.book_claim_seats(uuid) from public, anon, authenticated;

-- ── 9. What the screens call ────────────────────────────────────────────────
-- The books this person can open, and what they may do in each.
create or replace function public.my_books() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  perform public.book_claim_seats(v_uid);
  perform public.ensure_personal_book(v_uid);
  select jsonb_build_object(
    'enabled', exists (select 1 from public.accounting_access x where x.user_id = v_uid),
    'books', coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'template', b.template, 'role', a.role,
        'is_mine', (b.kind = 'personal' and b.owner_user_id = v_uid),
        'owner_user_id', b.owner_user_id,
        'label', case when b.kind = 'personal' then public.book_person_label(b.owner_user_id)
                      else coalesce((select t.name from public.teams t where t.id = b.team_id), b.name) end,
        'track_personal', (b.kind = 'personal' and coalesce((select f.track_personal from public.finance_settings f where f.user_id = b.owner_user_id), false)),
        'starts_on', b.starts_on, 'closed_through', b.closed_through)
      order by (b.kind = 'personal' and b.owner_user_id = v_uid) desc, (b.kind = 'brokerage') desc, (b.kind = 'team') desc, b.name), '[]'::jsonb))
    into v_out
    from public.book_access a join public.books b on b.id = a.book_id
   where a.user_id = v_uid and a.is_active and b.archived_at is null;
  return v_out;
end $$;
revoke all on function public.my_books() from public, anon;
grant execute on function public.my_books() to authenticated;

-- Everyone on a book's list. Owners and admins only.
create or replace function public.book_people(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_role text; v_owner uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  v_role := public.book_role(p_book);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Only an owner or admin can see who has access' using errcode = '42501'; end if;
  select coalesce(owner_user_id, principal_user_id) into v_owner from public.books where id = p_book;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'role', a.role, 'is_active', a.is_active,
        'name', case when a.user_id is not null then public.book_person_label(a.user_id) else coalesce(nullif(btrim(a.invite_name), ''), a.invite_email) end,
        'email', case when a.user_id is not null then (select u.email from auth.users u where u.id = a.user_id) else a.invite_email end,
        'waiting_for', case when a.user_id is not null then null when a.invite_email is null then 'email' else 'sign_in' end,
        'is_you', a.user_id is not distinct from v_uid,
        'is_book_owner', (v_owner is not null and a.user_id is not distinct from v_owner),
        'awaiting_ok', (not a.is_active and a.claimed_at is not null and (a.switched_at is null or a.switched_at <= a.claimed_at)),
        'granted_at', a.granted_at, 'switched_at', a.switched_at)
      order by case a.role when 'owner' then 0 when 'admin' then 1 when 'assistant' then 2 else 3 end, a.granted_at), '[]'::jsonb)
      from public.book_access a where a.book_id = p_book);
end $$;
revoke all on function public.book_people(uuid) from public, anon;
grant execute on function public.book_people(uuid) to authenticated;

-- Names for the people whose work is in a book: "entered by Joshua Maples".
create or replace function public.book_names(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if public.book_role(p_book) is null then raise exception 'You do not have access to these books' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_object_agg(s.uid::text, public.book_person_label(s.uid)), '{}'::jsonb)
      from (select a.user_id as uid from public.book_access a where a.book_id = p_book and a.user_id is not null
                                                        and public.book_role(p_book) in ('owner', 'admin')
            union select t.entered_by from public.transactions t where t.book_id = p_book and t.entered_by is not null
            union select t.updated_by from public.transactions t where t.book_id = p_book and t.updated_by is not null) s);
end $$;
revoke all on function public.book_names(uuid) from public, anon;
grant execute on function public.book_names(uuid) to authenticated;

-- The one place that decides whether the caller may change a seat.
--   An owner may change any seat. An admin may change admin, assistant and
--   read-only seats, never an owner's, and may not make anyone an owner.
--   A person's own books always keep that person as owner; a shared book
--   keeps its principal owner (the Broker, or the team's leader); and every
--   book always keeps at least one active owner who can sign in.
create or replace function public.book_seat_check(p_access uuid, p_new_role text, p_removing boolean) returns public.book_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.book_access%rowtype; v_me text; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into a from public.book_access where id = p_access;
  if not found then raise exception 'That person is no longer on the list' using errcode = 'P0002'; end if;
  perform 1 from public.books where id = a.book_id for update;     -- one change to a book's list at a time
  select * into a from public.book_access where id = p_access;
  v_me := public.book_role(a.book_id);
  if v_me is null or v_me not in ('owner', 'admin') then raise exception 'Only an owner or admin can change who has access' using errcode = '42501'; end if;
  if v_me <> 'owner' and (a.role = 'owner' or coalesce(p_new_role, '') = 'owner') then
    raise exception 'Only an owner can change an owner' using errcode = '42501';
  end if;
  select coalesce(owner_user_id, principal_user_id) into v_owner from public.books where id = a.book_id;
  if v_owner is not null and a.user_id is not distinct from v_owner and (p_removing or coalesce(p_new_role, 'owner') <> 'owner') then
    raise exception 'This person always stays an owner of these books' using errcode = '42501';
  end if;
  if a.role = 'owner' and a.is_active and a.user_id is not null and (p_removing or coalesce(p_new_role, 'owner') <> 'owner')
     and not exists (select 1 from public.book_access x where x.book_id = a.book_id and x.id <> a.id and x.role = 'owner' and x.is_active and x.user_id is not null) then
    raise exception 'These books need at least one owner who can sign in' using errcode = '42501';
  end if;
  return a;
end $$;
revoke all on function public.book_seat_check(uuid, text, boolean) from public, anon, authenticated;

-- Put someone on the list, or change what an existing seat may do.
create or replace function public.book_grant(p_book uuid, p_email text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_me text; v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
        v_name text := nullif(btrim(coalesce(p_name, '')), ''); v_user uuid; v_id uuid; a public.book_access%rowtype; v_label text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  v_me := public.book_role(p_book);
  if v_me is null or v_me not in ('owner', 'admin') then raise exception 'Only an owner or admin can give access' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'admin', 'assistant', 'read_only') then raise exception 'Choose what this person may do' using errcode = '22023'; end if;
  if p_role = 'owner' and v_me <> 'owner' then raise exception 'Only an owner can add another owner' using errcode = '42501'; end if;
  -- Sharing one's OWN books is part of what is switched on for a few people first.
  if (select b.kind from public.books b where b.id = p_book) = 'personal'
     and not exists (select 1 from public.accounting_access x where x.user_id = v_uid) then
    raise exception 'Sharing your own books is not switched on for you yet' using errcode = '42501';
  end if;
  if v_email is null and v_name is null then raise exception 'Enter the person''s name or email' using errcode = '22023'; end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'That email address does not look right' using errcode = '22023'; end if;

  if v_email is not null then
    select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null limit 1;
  end if;
  -- An existing seat for the same person: by sign-in, by email, or the name-only seat waiting for an email.
  select * into a from public.book_access x
   where x.book_id = p_book and ((v_user is not null and x.user_id = v_user)
      or (x.user_id is null and v_email is not null and lower(x.invite_email) = v_email)
      or (x.user_id is null and x.invite_email is null and v_name is not null and lower(btrim(x.invite_name)) = lower(v_name)))
   order by (x.user_id is not null) desc limit 1;
  if found then
    perform public.book_seat_check(a.id, p_role, false);
    update public.book_access set role = p_role, is_active = true, user_id = coalesce(user_id, v_user),
           invite_email = case when coalesce(user_id, v_user) is not null then null else coalesce(v_email, invite_email) end,
           invite_name = coalesce(v_name, invite_name), switched_by = v_uid, switched_at = now()
     where id = a.id returning id into v_id;
  else
    insert into public.book_access (book_id, user_id, invite_email, invite_name, role, granted_by)
    values (p_book, v_user, case when v_user is null then v_email end, v_name, p_role, v_uid) returning id into v_id;
  end if;
  v_label := coalesce(case when v_user is not null then public.book_person_label(v_user) end, v_name, v_email);
  perform public.book_log_add(p_book, 'access_granted', v_user, v_label, null, jsonb_build_object('role', p_role, 'waiting', v_user is null, 'was', a.role));
  return jsonb_build_object('id', v_id, 'status', case when v_user is not null then 'active' when v_email is not null then 'waiting_sign_in' else 'waiting_email' end);
end $$;
revoke all on function public.book_grant(uuid, text, text, text) from public, anon;
grant execute on function public.book_grant(uuid, text, text, text) to authenticated;

-- The switch. Off removes access on the person's next request and keeps the
-- seat, the role and everything they entered. On gives the same role back.
create or replace function public.book_set_active(p_access uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.book_access%rowtype;
begin
  a := public.book_seat_check(p_access, null, not p_on);
  if a.user_id is not distinct from auth.uid() and not p_on then raise exception 'You cannot switch yourself off' using errcode = '42501'; end if;
  if a.is_active is not distinct from p_on then return; end if;
  update public.book_access set is_active = p_on, switched_by = auth.uid(), switched_at = now() where id = p_access;
  perform public.book_log_add(a.book_id, case when p_on then 'access_on' else 'access_off' end, a.user_id,
    coalesce(case when a.user_id is not null then public.book_person_label(a.user_id) end, a.invite_name, a.invite_email), null, jsonb_build_object('role', a.role));
end $$;
revoke all on function public.book_set_active(uuid, boolean) from public, anon;
grant execute on function public.book_set_active(uuid, boolean) to authenticated;

create or replace function public.book_set_role(p_access uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.book_access%rowtype;
begin
  if p_role is null or p_role not in ('owner', 'admin', 'assistant', 'read_only') then raise exception 'Choose what this person may do' using errcode = '22023'; end if;
  a := public.book_seat_check(p_access, p_role, false);
  if a.role = p_role then return; end if;
  update public.book_access set role = p_role, switched_by = auth.uid(), switched_at = now() where id = p_access;
  perform public.book_log_add(a.book_id, 'access_role', a.user_id,
    coalesce(case when a.user_id is not null then public.book_person_label(a.user_id) end, a.invite_name, a.invite_email), null, jsonb_build_object('from', a.role, 'to', p_role));
end $$;
revoke all on function public.book_set_role(uuid, text) from public, anon;
grant execute on function public.book_set_role(uuid, text) to authenticated;

-- Take someone off the list altogether. What they entered stays, signed.
create or replace function public.book_remove(p_access uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.book_access%rowtype;
begin
  a := public.book_seat_check(p_access, null, true);
  if a.user_id is not distinct from auth.uid() then raise exception 'You cannot remove yourself' using errcode = '42501'; end if;
  delete from public.book_access where id = p_access;
  perform public.book_log_add(a.book_id, 'access_removed', a.user_id,
    coalesce(case when a.user_id is not null then public.book_person_label(a.user_id) end, a.invite_name, a.invite_email), null, jsonb_build_object('role', a.role));
end $$;
revoke all on function public.book_remove(uuid) from public, anon;
grant execute on function public.book_remove(uuid) to authenticated;

-- Who was given access, switched on or off, and when the books were closed.
create or replace function public.book_history(p_book uuid, p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  v_role := public.book_role(p_book);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Only an owner or admin can see this record' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'action', l.action, 'who', l.subject_label, 'detail', l.detail,
                                               'by', case when l.actor is null then 'PrismOS' else public.book_person_label(l.actor) end) order by l.at desc, l.id desc), '[]'::jsonb)
      from (select * from public.book_log x where x.book_id = p_book and x.entry_id is null
               and (x.action like 'access\_%' or x.action in ('book_created', 'closed', 'reopened')) order by x.at desc, x.id desc limit greatest(1, least(coalesce(p_limit, 60), 300))) l);
end $$;
revoke all on function public.book_history(uuid, integer) from public, anon;
grant execute on function public.book_history(uuid, integer) to authenticated;

-- Close the books through a date, or reopen them (an earlier date, or none).
create or replace function public.book_set_closed_through(p_book uuid, p_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_old date;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  v_role := public.book_role(p_book);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Only an owner or admin can close or reopen the books' using errcode = '42501'; end if;
  if p_date is not null and p_date > public.today_ny() then raise exception 'The books can only be closed through a day that has passed' using errcode = '22023'; end if;
  select closed_through into v_old from public.books where id = p_book;
  if v_old is not distinct from p_date then return; end if;
  update public.books set closed_through = p_date where id = p_book;
  perform public.book_log_add(p_book, case when p_date is null or (v_old is not null and p_date < v_old) then 'reopened' else 'closed' end,
    null, null, null, jsonb_build_object('from', v_old, 'to', p_date));
end $$;
revoke all on function public.book_set_closed_through(uuid, date) from public, anon;
grant execute on function public.book_set_closed_through(uuid, date) to authenticated;

-- A balance for each account in one book. Runs as the caller: the rules above
-- decide what they may see.
create or replace function public.book_account_balances(p_book uuid)
returns table (account text, entries integer, starting_balance numeric, balance numeric, kind text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with tx as (
    select lower(btrim(t.account)) as k,
           mode() within group (order by btrim(t.account)) as shown,
           count(*)::int as n, coalesce(sum(t.amount), 0) as total
      from public.transactions t
     where t.book_id = p_book and t.is_archived = false and btrim(coalesce(t.account, '')) <> ''
     group by 1
  ), ma as (
    select lower(btrim(m.name)) as k, btrim(m.name) as shown, m.starting_balance, m.kind
      from public.money_accounts m where m.book_id = p_book
  )
  select coalesce(ma.shown, tx.shown), coalesce(tx.n, 0), coalesce(ma.starting_balance, 0),
         coalesce(ma.starting_balance, 0) + coalesce(tx.total, 0), coalesce(ma.kind, 'bank')
    from tx full outer join ma on ma.k = tx.k
   order by coalesce(tx.n, 0) desc, 1;
$$;
revoke all on function public.book_account_balances(uuid) from public, anon;
grant execute on function public.book_account_balances(uuid) to authenticated;

-- Name an account, say what it held before its first entry, and what kind it
-- is (bank, card, escrow, cash). Owners and admins only.
create or replace function public.set_book_account(p_book uuid, p_account text, p_amount numeric default null, p_kind text default null)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_name text := btrim(coalesce(p_account, '')); v_role text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_role := public.book_role(p_book);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Only an owner or admin can change account settings' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'an account needs a name'; end if;
  if p_amount is null and p_kind is null then raise exception 'nothing to change'; end if;
  if p_kind is not null and p_kind not in ('bank', 'card', 'escrow', 'cash', 'other') then raise exception 'unknown kind of account'; end if;
  update public.money_accounts set starting_balance = coalesce(p_amount, starting_balance), kind = coalesce(p_kind, kind), updated_at = now()
   where book_id = p_book and lower(btrim(name)) = lower(v_name);
  if not found then
    insert into public.money_accounts (book_id, name, starting_balance, kind) values (p_book, v_name, coalesce(p_amount, 0), coalesce(p_kind, 'bank'));
  end if;
end $$;
revoke all on function public.set_book_account(uuid, text, numeric, text) from public, anon;
grant execute on function public.set_book_account(uuid, text, numeric, text) to authenticated;

-- The two functions phones on the previous version still call now ask the
-- same question of the person's own book: one rule, one place.
create or replace function public.my_personal_book() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return public.ensure_personal_book(auth.uid());
end $$;
revoke all on function public.my_personal_book() from public, anon;
grant execute on function public.my_personal_book() to authenticated;

create or replace function public.my_account_balances()
returns table (account text, entries integer, starting_balance numeric, balance numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select b.account, b.entries, b.starting_balance, b.balance
    from public.book_account_balances((select k.id from public.books k where k.kind = 'personal' and k.owner_user_id = auth.uid())) b
$$;
revoke all on function public.my_account_balances() from public, anon;
grant execute on function public.my_account_balances() to authenticated;

create or replace function public.set_account_starting_balance(p_account text, p_amount numeric)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_amount is null then raise exception 'a starting balance needs an amount'; end if;
  perform public.set_book_account(public.my_personal_book(), p_account, p_amount, null);
end $$;
revoke all on function public.set_account_starting_balance(text, numeric) from public, anon;
grant execute on function public.set_account_starting_balance(text, numeric) to authenticated;

-- Where the money came from and went, by category, for any stretch of time.
-- Added up in the database: the screen holds only the newest entries.
create or replace function public.book_summary(p_book uuid, p_from date default null, p_to date default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with tx as (
    select t.tax_category_id, t.amount from public.transactions t
     where t.book_id = p_book and t.is_archived = false and t.scope = 'business'
       and (p_from is null or t.date >= p_from) and (p_to is null or t.date <= p_to)
  ), g as (
    select c.id, coalesce(c.name, '') as name, coalesce(c.kind, 'none') as kind, coalesce(c.sort_order, 100000) as ord,
           count(*)::int as entries,
           coalesce(sum(tx.amount) filter (where tx.amount > 0), 0) as money_in,
           coalesce(-sum(tx.amount) filter (where tx.amount < 0), 0) as money_out
      from tx left join public.tax_categories c on c.id = tx.tax_category_id
     group by c.id, c.name, c.kind, c.sort_order
  )
  select jsonb_build_object('lines', coalesce(jsonb_agg(jsonb_build_object(
           'category_id', g.id, 'name', g.name, 'kind', g.kind, 'entries', g.entries, 'money_in', g.money_in, 'money_out', g.money_out)
           order by g.ord, g.name), '[]'::jsonb))
    from g
$$;
revoke all on function public.book_summary(uuid, date, date) from public, anon;
grant execute on function public.book_summary(uuid, date, date) to authenticated;

-- "Did I already enter this?" The same amount within three days in the same
-- book, with the same payee or no payee on one side.
create or replace function public.book_possible_duplicates(p_book uuid, p_date date, p_amount numeric, p_payee text, p_skip uuid default null)
returns table (id uuid, date date, amount numeric, payee text, account text, entered_via text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with want as (select regexp_replace(lower(coalesce(p_payee, '')), '[^a-z0-9]', '', 'g') as p)
  select t.id, t.date, t.amount, t.payee, t.account, t.entered_via
    from public.transactions t, want
   where t.book_id = p_book and t.is_archived = false and t.amount = p_amount
     and t.date between p_date - 3 and p_date + 3
     and (p_skip is null or t.id <> p_skip)
     and (want.p = '' or regexp_replace(lower(coalesce(t.payee, '')), '[^a-z0-9]', '', 'g') = ''
          or regexp_replace(lower(coalesce(t.payee, '')), '[^a-z0-9]', '', 'g') like '%' || left(want.p, 6) || '%'
          or want.p like '%' || left(regexp_replace(lower(coalesce(t.payee, '')), '[^a-z0-9]', '', 'g'), 6) || '%')
   order by abs(t.date - p_date), t.created_at desc
   limit 3
$$;
revoke all on function public.book_possible_duplicates(uuid, date, numeric, text, uuid) from public, anon;
grant execute on function public.book_possible_duplicates(uuid, date, numeric, text, uuid) to authenticated;

-- ── 10. A team's books follow its leader ────────────────────────────────────
-- When a team gets a leader the team gets books, owned by that leader. When
-- the leader changes, the new leader becomes an owner and the former leader's
-- seat is switched off (kept, never erased), unless that would leave no owner.
create or replace function public.team_book_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_book uuid; v_team uuid := coalesce(new.team_id, old.team_id); v_name text;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'leader' then
    select id into v_book from public.books where team_id = v_team;
    if v_book is null then
      select name into v_name from public.teams where id = v_team;
      insert into public.books (kind, template, name, team_id, principal_user_id, created_by) values ('team', 'team', coalesce(v_name, 'Team'), v_team, new.auth_user_id, auth.uid()) returning id into v_book;
      perform public.book_seed_categories(v_book);
      perform public.book_log_add(v_book, 'book_created', null, coalesce(v_name, 'Team'), null, null);
    end if;
    insert into public.book_access (book_id, user_id, role, granted_by) values (v_book, new.auth_user_id, 'owner', auth.uid())
    on conflict (book_id, user_id) where user_id is not null do update set role = 'owner', is_active = true, switched_by = auth.uid(), switched_at = now();
    update public.books set principal_user_id = new.auth_user_id where id = v_book and principal_user_id is distinct from new.auth_user_id;
    perform public.book_log_add(v_book, 'access_granted', new.auth_user_id, public.book_person_label(new.auth_user_id), null, jsonb_build_object('role', 'owner', 'because', 'team leader'));
  end if;
  if (tg_op = 'DELETE' and old.role = 'leader') or (tg_op = 'UPDATE' and old.role = 'leader' and new.role <> 'leader') then
    select id into v_book from public.books where team_id = v_team;
    if v_book is not null and exists (select 1 from public.book_access x where x.book_id = v_book and x.user_id <> old.auth_user_id and x.role = 'owner' and x.is_active) then
      update public.book_access set is_active = false, switched_by = auth.uid(), switched_at = now()
       where book_id = v_book and user_id = old.auth_user_id and role = 'owner' and is_active;
      if found then
        perform public.book_log_add(v_book, 'access_off', old.auth_user_id, public.book_person_label(old.auth_user_id), null, jsonb_build_object('role', 'owner', 'because', 'no longer team leader'));
      end if;
    end if;
  end if;
  return null;
end $$;
revoke all on function public.team_book_sync() from public, anon, authenticated;
drop trigger if exists trg_team_book_sync on public.team_members;
create trigger trg_team_book_sync after insert or update of role or delete on public.team_members for each row execute function public.team_book_sync();

-- ── 11. The first books and the first names on them ─────────────────────────
-- Released to three people first (Dara): the Broker and the two Broker Admins.
insert into public.accounting_access (user_id, note)
select u.id, v.note from (values
  ('ad06bbc1-a1cb-4716-84d3-36f426ea3187'::uuid, 'Dara - Broker, from 6 Oct 2026'),
  ('f122858e-ec92-44dc-bea2-a5f629054e82'::uuid, 'Josh Maples - Broker Admin, from 6 Oct 2026'),
  ('122eafc8-37db-41ed-beb6-4cb0c192527d'::uuid, 'Alexander Khoyi - Broker Admin, from 6 Oct 2026')) v(id, note)
  join auth.users u on u.id = v.id
on conflict (user_id) do nothing;

do $$
declare v_dara uuid := 'ad06bbc1-a1cb-4716-84d3-36f426ea3187'; v_josh uuid := 'f122858e-ec92-44dc-bea2-a5f629054e82';
        v_alex uuid := '122eafc8-37db-41ed-beb6-4cb0c192527d'; v_book uuid; r record;
begin
  -- Their own books, with the starter categories.
  for r in select x.user_id from public.accounting_access x loop perform public.ensure_personal_book(r.user_id); end loop;

  if not exists (select 1 from auth.users where id = v_dara) then return; end if;

  -- Realty ONE Group Advantage: Dara owns, Josh and Alexander are admins.
  select id into v_book from public.books where kind = 'brokerage';
  if v_book is null then
    insert into public.books (kind, template, name, starts_on, principal_user_id, created_by)
    values ('brokerage', 'brokerage', 'Realty ONE Group Advantage', date '2026-01-01', v_dara, v_dara) returning id into v_book;
    insert into public.book_log (book_id, action, subject_label) values (v_book, 'book_created', 'Realty ONE Group Advantage');
    insert into public.book_access (book_id, user_id, role, granted_by) values (v_book, v_dara, 'owner', v_dara) on conflict do nothing;
    insert into public.book_access (book_id, user_id, role, granted_by)
    select v_book, u.id, 'admin', v_dara from auth.users u where u.id in (v_josh, v_alex) on conflict do nothing;
  end if;
  perform public.book_seed_categories(v_book);

  -- Team Blue Koala (property management). Tina Danielson is the team leader
  -- and Myra Torres keeps the books; Dara can give and withdraw their access,
  -- and is the one owner nobody else can remove. Tina's seat waits for her to
  -- sign in and for Dara to switch it on; Myra's waits for an email address.
  select id into v_book from public.books where kind = 'team' and template = 'property_management' and name = 'Team Blue Koala';
  if v_book is null then
    insert into public.books (kind, template, name, starts_on, principal_user_id, created_by)
    values ('team', 'property_management', 'Team Blue Koala', date '2026-01-01', v_dara, v_dara) returning id into v_book;
    insert into public.book_log (book_id, action, subject_label) values (v_book, 'book_created', 'Team Blue Koala');
    insert into public.book_access (book_id, user_id, role, granted_by) values (v_book, v_dara, 'owner', v_dara) on conflict do nothing;
    insert into public.book_access (book_id, user_id, invite_email, invite_name, role, granted_by)
    select v_book, a.auth_user_id, case when a.auth_user_id is null then lower(a.email) end, 'Tina Danielson', 'owner', v_dara
      from public.agents a where a.name = 'Tina Danielson' and a.active is not false and (a.email is not null or a.auth_user_id is not null)
     order by a.created_at limit 1
    on conflict do nothing;
    insert into public.book_access (book_id, invite_name, role, granted_by) values (v_book, 'Myra Torres', 'assistant', v_dara) on conflict do nothing;
  end if;
  perform public.book_seed_categories(v_book);
end $$;
