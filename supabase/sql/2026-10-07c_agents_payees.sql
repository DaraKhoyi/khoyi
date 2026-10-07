-- AGENT ACCOUNTS, 1099 TRACKING, AND THE LIMITS ON SENSITIVE DATA
--
-- Dara, 6 Oct 2026 (accounting build, part 5):
--   "Agent statements. What the brokerage paid them and what they owe: monthly
--    fees, transaction fees, E&O."
--   "1099 tracking. W-9 on file per agent and contractor, totals for the year,
--    flags who crosses the IRS threshold, exports the year-end file. The
--    threshold is stored per tax year and checked against the IRS at build
--    time, not hard-coded."
--   "Sensitive-data limits. Only the last four digits of any account are
--    stored. W-9 tax IDs are encrypted and shown to owners and admins only."
--
-- THE PROMISES
--  1. These are cash-basis books. What an agent OWES is not income until it is
--     paid, so charges live beside the ledger (agent_charges), never in it.
--     What an agent PAID is whatever the books show came in from them under
--     "Agent Fees". Owed = charged - paid.
--  2. A 1099 total is money the books show went OUT to that payee in the
--     calendar year, on the day it moved. Money paid by credit card is shown
--     apart and left out of the form total (the card company reports it).
--     A foreign payee and a corporation are tracked and not filed.
--  3. The IRS figure for a year comes from tax_year_figures. A year with no
--     row is said to be unknown; nothing is assumed for it.
--  4. A tax ID is stored encrypted (the Vault key the contact tax IDs already
--     use), never returned by any list, and shown in full only to an owner or
--     admin of those books through a function that writes their name in the
--     record each time. Everyone else sees the last four digits.
--  5. An account name may carry the last four digits of its number and no more.

-- ── 1. The IRS figures, per tax year ────────────────────────────────────────
create table if not exists public.tax_year_figures (
  tax_year       integer primary key,
  nec_threshold  numeric(12,2) not null,   -- Form 1099-NEC box 1
  rent_threshold numeric(12,2) not null,   -- Form 1099-MISC box 1
  source         text not null,
  checked_on     date not null
);
insert into public.tax_year_figures (tax_year, nec_threshold, rent_threshold, source, checked_on) values
  (2024, 600, 600, 'IRS Instructions for Forms 1099-MISC and 1099-NEC (2024)', date '2026-10-06'),
  (2025, 600, 600, 'IRS Instructions for Forms 1099-MISC and 1099-NEC (2025)', date '2026-10-06'),
  (2026, 2000, 2000, 'IRS Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026): $2,000 for payments made in 2026; may be adjusted for inflation from 2027', date '2026-10-06')
on conflict (tax_year) do nothing;
alter table public.tax_year_figures enable row level security;
drop policy if exists tax_year_figures_read on public.tax_year_figures;
create policy tax_year_figures_read on public.tax_year_figures for select to authenticated using (true);
revoke all on public.tax_year_figures from public, anon, authenticated;
grant select on public.tax_year_figures to authenticated;

-- ── 2. Payees a set of books tracks for 1099s ───────────────────────────────
create table if not exists public.book_payees (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  name         text not null,
  agent_id     uuid references public.agents(id) on delete set null,
  contact_id   uuid references public.contacts(id) on delete set null,
  payee_key    text,                           -- lower-cased payee text, for a payee who is neither
  tax_status   text not null default 'unknown' check (tax_status in ('unknown', 'us_person', 'corporation', 'foreign')),
  form_on_file boolean not null default false, -- a W-9 (or, for a foreign payee, a W-8BEN)
  form_date    date,
  box          text not null default 'nec' check (box in ('nec', 'rent')),
  tin_enc      bytea,
  tin_last4    text,
  tin_kind     text check (tin_kind in ('ssn', 'ein')),
  address      text,
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create unique index if not exists book_payees_one_agent   on public.book_payees (book_id, agent_id)   where agent_id is not null and archived_at is null;
create unique index if not exists book_payees_one_contact on public.book_payees (book_id, contact_id) where contact_id is not null and archived_at is null;
create unique index if not exists book_payees_one_key     on public.book_payees (book_id, payee_key)  where payee_key is not null and agent_id is null and contact_id is null and archived_at is null;
alter table public.book_payees enable row level security;
drop policy if exists book_payees_read on public.book_payees;
create policy book_payees_read on public.book_payees for select to authenticated using (book_id in (select public.my_books_readable()));
revoke all on public.book_payees from public, anon, authenticated;
-- Every column but the encrypted tax ID.
grant select (id, book_id, name, agent_id, contact_id, payee_key, tax_status, form_on_file, form_date, box, tin_last4, tin_kind, address, note, created_at, updated_at, archived_at)
  on public.book_payees to authenticated;

-- p: {name, agent_id, contact_id, tax_status, form_on_file, form_date, box, address, note, archived}
create or replace function public.payee_save(p_book uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_name text := nullif(btrim(coalesce(p ->> 'name', '')), ''); v_agent uuid := nullif(p ->> 'agent_id', '')::uuid; v_contact uuid := nullif(p ->> 'contact_id', '')::uuid;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if v_agent is not null and v_name is null then select ag.name into v_name from public.agents ag where ag.id = v_agent; end if;
  if v_id is null then
    if v_name is null then raise exception 'A payee needs a name' using errcode = '23514'; end if;
    insert into public.book_payees (book_id, name, agent_id, contact_id, payee_key, tax_status, form_on_file, form_date, box, address, note, created_by)
    values (p_book, v_name, v_agent, v_contact, case when v_agent is null and v_contact is null then lower(v_name) end,
            coalesce(nullif(p ->> 'tax_status', ''), 'unknown'), coalesce((p ->> 'form_on_file')::boolean, false), nullif(p ->> 'form_date', '')::date,
            coalesce(nullif(p ->> 'box', ''), 'nec'), nullif(btrim(coalesce(p ->> 'address', '')), ''), nullif(btrim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.book_payees y
       set name = coalesce(v_name, y.name),
           payee_key = case when y.agent_id is null and y.contact_id is null then lower(coalesce(v_name, y.name)) else y.payee_key end,
           tax_status = coalesce(nullif(p ->> 'tax_status', ''), y.tax_status),
           form_on_file = coalesce((p ->> 'form_on_file')::boolean, y.form_on_file),
           form_date = case when p ? 'form_date' then nullif(p ->> 'form_date', '')::date else y.form_date end,
           box = coalesce(nullif(p ->> 'box', ''), y.box),
           address = case when p ? 'address' then nullif(btrim(coalesce(p ->> 'address', '')), '') else y.address end,
           note = case when p ? 'note' then nullif(btrim(coalesce(p ->> 'note', '')), '') else y.note end,
           archived_at = case when p ? 'archived' then case when (p ->> 'archived')::boolean then coalesce(y.archived_at, now()) else null end else y.archived_at end,
           updated_at = now()
     where y.id = v_id and y.book_id = p_book;
    if not found then raise exception 'That payee is not in these books' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'That payee is already on the list for these books' using errcode = '23505';
end $$;
revoke all on function public.payee_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.payee_save(uuid, uuid, jsonb) to authenticated;

-- Store a tax ID. Whoever can keep the books can type one in; it cannot be read back here.
create or replace function public.payee_set_tin(p_id uuid, p_tin text, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare y public.book_payees%rowtype; v_digits text := regexp_replace(coalesce(p_tin, ''), '[^0-9]', '', 'g'); v_key text; v_kind text := nullif(lower(btrim(coalesce(p_kind, ''))), '');
begin
  select * into y from public.book_payees where id = p_id;
  if not found or auth.uid() is null or y.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if v_kind is not null and v_kind not in ('ssn', 'ein') then raise exception 'A tax ID is an SSN or an EIN' using errcode = '23514'; end if;
  if v_digits = '' then
    update public.book_payees set tin_enc = null, tin_last4 = null, tin_kind = null, updated_at = now() where id = p_id;
    perform public.book_log_add(y.book_id, 'tax_id_cleared', null, y.name, null, null);
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  if length(v_digits) <> 9 then raise exception 'A tax ID has 9 digits' using errcode = '23514'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tax_id_key';
  if v_key is null then raise exception 'Tax IDs cannot be stored safely right now. Tell Dara.' using errcode = 'P0001'; end if;
  update public.book_payees set tin_enc = extensions.pgp_sym_encrypt(v_digits, v_key), tin_last4 = right(v_digits, 4), tin_kind = coalesce(v_kind, tin_kind, 'ssn'), updated_at = now() where id = p_id;
  perform public.book_log_add(y.book_id, 'tax_id_stored', null, y.name, null, null);
  return jsonb_build_object('ok', true, 'last4', right(v_digits, 4));
end $$;
revoke all on function public.payee_set_tin(uuid, text, text) from public, anon;
grant execute on function public.payee_set_tin(uuid, text, text) to authenticated;

-- The whole tax ID: owners and admins of those books only, and their name goes in the record.
create or replace function public.payee_reveal_tin(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare y public.book_payees%rowtype; v_key text;
begin
  select * into y from public.book_payees where id = p_id;
  if not found or auth.uid() is null or y.book_id not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin of these books can see a tax ID' using errcode = '42501'; end if;
  if y.tin_enc is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tax_id_key';
  perform public.book_log_add(y.book_id, 'tax_id_seen', null, y.name, null, null);
  return extensions.pgp_sym_decrypt(y.tin_enc, v_key);
end $$;
revoke all on function public.payee_reveal_tin(uuid) from public, anon;
grant execute on function public.payee_reveal_tin(uuid) to authenticated;

-- Which category names are the kind of payment a 1099 is about.
create or replace function public.category_1099_box(p_name text) returns text
language sql immutable as $$
  select case when p_name ~* '^\s*rent' then 'rent'
              when p_name ~* '(contract labor|commission|split|referral fee|professional|legal|accounting|payroll & staff|recruiting)' then 'nec' end
$$;
revoke all on function public.category_1099_box(text) from public, anon;
grant execute on function public.category_1099_box(text) to authenticated;

-- Each money-out entry of the year with the payee it belongs to (or none).
create or replace function public.book_payee_entries(p_book uuid, p_year integer)
returns table (transaction_id uuid, payee_id uuid, amount numeric, by_card boolean, category text, agent_id uuid, contact_id uuid, payee text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, y.id, -t.amount,
         coalesce((select m.kind = 'card' from public.money_accounts m where m.book_id = t.book_id and lower(btrim(m.name)) = lower(btrim(coalesce(t.account, ''))) limit 1), false),
         c.name, t.agent_id, t.contact_id, btrim(coalesce(t.payee, ''))
    from public.transactions t
    left join public.tax_categories c on c.id = t.tax_category_id
    left join lateral (
      select q.id from public.book_payees q
       where q.book_id = t.book_id and q.archived_at is null
         and ((q.agent_id is not null and t.agent_id = q.agent_id
               -- a referral or a TC payment on an agent's closing was not paid to the agent
               and not exists (select 1 from public.closing_postings cp where cp.transaction_id = t.id and cp.part not in ('agent', 'payout')))
           or (q.contact_id is not null and t.contact_id = q.contact_id)
           or (q.payee_key is not null and q.agent_id is null and q.contact_id is null and lower(btrim(coalesce(t.payee, ''))) = q.payee_key))
       order by (q.agent_id is not null) desc, (q.contact_id is not null) desc, q.created_at limit 1) y on true
   where t.book_id = p_book and not t.is_archived and t.scope = 'business' and btrim(coalesce(t.transfer_account, '')) = ''
     and t.date >= make_date(p_year, 1, 1) and t.date <= make_date(p_year, 12, 31)
     and (c.id is null or c.kind = 'expense')
     and (t.amount < 0 or y.id is not null)      -- a refund from a tracked payee comes off their total
$$;
revoke all on function public.book_payee_entries(uuid, integer) from public, anon, authenticated;

create or replace function public.book_1099(p_book uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f public.tax_year_figures%rowtype; v_payees jsonb; v_un jsonb;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_readable()) then raise exception 'You cannot see these books' using errcode = '42501'; end if;
  select * into f from public.tax_year_figures where tax_year = p_year;
  with e as (select * from public.book_payee_entries(p_book, p_year)),
  tot as (select e.payee_id, sum(e.amount) as paid, sum(e.amount) filter (where e.by_card) as by_card, count(*) as entries from e where e.payee_id is not null group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'agent_id', y.agent_id, 'contact_id', y.contact_id, 'tax_status', y.tax_status,
           'form_on_file', y.form_on_file, 'form_date', y.form_date, 'box', y.box, 'last4', y.tin_last4, 'tin_kind', y.tin_kind, 'address', y.address, 'note', y.note,
           'entries', coalesce(t.entries, 0), 'paid', round(coalesce(t.paid, 0), 2), 'by_card', round(coalesce(t.by_card, 0), 2),
           'counts', round(coalesce(t.paid, 0) - coalesce(t.by_card, 0), 2),
           'files', case when f.tax_year is null then null
                         else y.tax_status in ('unknown', 'us_person') and coalesce(t.paid, 0) - coalesce(t.by_card, 0) >= case y.box when 'rent' then f.rent_threshold else f.nec_threshold end end)
         order by coalesce(t.paid, 0) desc, y.name), '[]'::jsonb)
    into v_payees
    from public.book_payees y left join tot t on t.payee_id = y.id
   where y.book_id = p_book and y.archived_at is null;
  -- Paid enough to matter, in the kind of category a 1099 is about, and not on the list.
  with e as (select * from public.book_payee_entries(p_book, p_year)),
  g as (select coalesce(e.agent_id::text, e.contact_id::text, lower(e.payee)) as k, (array_agg(e.agent_id))[1] as agent_id, (array_agg(e.contact_id))[1] as contact_id,
               coalesce((select ag.name from public.agents ag where ag.id = (array_agg(e.agent_id))[1]), max(e.payee)) as label,
               sum(e.amount) filter (where not e.by_card) as paid, count(*) as entries
          from e where e.payee_id is null and e.amount > 0 and public.category_1099_box(e.category) is not null and (e.agent_id is not null or e.contact_id is not null or e.payee <> '')
            and not exists (select 1 from public.closing_postings cp where cp.transaction_id = e.transaction_id and cp.part not in ('agent', 'payout'))
         group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('label', g.label, 'agent_id', g.agent_id, 'contact_id', g.contact_id, 'paid', round(g.paid, 2), 'entries', g.entries) order by g.paid desc), '[]'::jsonb)
    into v_un from (select * from g where coalesce(g.paid, 0) >= coalesce(f.nec_threshold, 600) order by g.paid desc limit 200) g;
  return jsonb_build_object('year', p_year,
    'figures', case when f.tax_year is null then null else jsonb_build_object('nec', f.nec_threshold, 'rent', f.rent_threshold, 'source', f.source, 'checked_on', f.checked_on) end,
    'payees', v_payees, 'untracked', v_un, 'can_write', p_book in (select public.my_books_writable()), 'can_manage', p_book in (select public.my_books_manageable()));
end $$;
revoke all on function public.book_1099(uuid, integer) from public, anon;
grant execute on function public.book_1099(uuid, integer) to authenticated;

-- The year-end file, with whole tax IDs. Owners and admins; recorded.
create or replace function public.book_1099_file(p_book uuid, p_year integer) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare f public.tax_year_figures%rowtype; v_key text; v jsonb;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin of these books can take the year-end file' using errcode = '42501'; end if;
  select * into f from public.tax_year_figures where tax_year = p_year;
  if not found then raise exception 'The IRS figure for % is not in PrismOS yet, so who must be filed for cannot be worked out', p_year using errcode = 'P0001'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tax_id_key';
  with e as (select * from public.book_payee_entries(p_book, p_year)),
  tot as (select e.payee_id, sum(e.amount) filter (where not e.by_card) as counts from e where e.payee_id is not null group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('name', y.name, 'address', y.address, 'tin_kind', y.tin_kind, 'form_on_file', y.form_on_file, 'box', y.box, 'amount', round(t.counts, 2),
           'tin', case when y.tin_enc is null or v_key is null then null else extensions.pgp_sym_decrypt(y.tin_enc, v_key) end) order by y.name), '[]'::jsonb)
    into v
    from public.book_payees y join tot t on t.payee_id = y.id
   where y.book_id = p_book and y.archived_at is null and y.tax_status in ('unknown', 'us_person')
     and t.counts >= case y.box when 'rent' then f.rent_threshold else f.nec_threshold end;
  perform public.book_log_add(p_book, 'tax_file_taken', null, p_year::text, null, jsonb_build_object('payees', jsonb_array_length(v)));
  return jsonb_build_object('year', p_year, 'rows', v);
end $$;
revoke all on function public.book_1099_file(uuid, integer) from public, anon;
grant execute on function public.book_1099_file(uuid, integer) to authenticated;

-- ── 3. What agents owe the brokerage ────────────────────────────────────────
create table if not exists public.agent_fee_schedules (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books(id) on delete cascade,
  agent_id   uuid references public.agents(id) on delete cascade,   -- NULL: every active agent
  kind       text not null check (kind in ('monthly', 'eo', 'other')),
  label      text not null,
  amount     numeric(12,2) not null check (amount > 0),
  every      text not null default 'month' check (every in ('month', 'quarter', 'year')),
  starts_on  date not null,
  ends_on    date,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.agent_charges (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  agent_id    uuid not null references public.agents(id) on delete cascade,
  charge_date date not null,
  kind        text not null check (kind in ('monthly', 'transaction', 'eo', 'other', 'credit')),
  label       text not null,
  amount      numeric(12,2) not null,           -- a credit is below zero
  schedule_id uuid references public.agent_fee_schedules(id) on delete set null,
  period_key  text,
  void_at     timestamptz,
  void_by     uuid,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists agent_charges_once on public.agent_charges (schedule_id, agent_id, period_key) where schedule_id is not null;
create index if not exists agent_charges_by_agent on public.agent_charges (book_id, agent_id, charge_date);
alter table public.agent_fee_schedules enable row level security;
alter table public.agent_charges enable row level security;
drop policy if exists agent_fee_schedules_read on public.agent_fee_schedules;
create policy agent_fee_schedules_read on public.agent_fee_schedules for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists agent_charges_read on public.agent_charges;
create policy agent_charges_read on public.agent_charges for select to authenticated using (book_id in (select public.my_books_readable()));
revoke all on public.agent_fee_schedules, public.agent_charges from public, anon, authenticated;
grant select on public.agent_fee_schedules, public.agent_charges to authenticated;

create or replace function public.agent_book_check(p_book uuid, p_write boolean) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book is null or (p_write and p_book not in (select public.my_books_writable())) or (not p_write and p_book not in (select public.my_books_readable())) then
    raise exception '%', case when p_write then 'You cannot change these books' else 'You cannot see these books' end using errcode = '42501';
  end if;
  if not exists (select 1 from public.books b where b.id = p_book and b.kind = 'brokerage') then raise exception 'Agent accounts belong to the brokerage books' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.agent_book_check(uuid, boolean) from public, anon, authenticated;

-- A standing charge: p = {agent_id (or null for everyone), kind, label, amount, every, starts_on, ends_on}
create or replace function public.agent_schedule_save(p_book uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id;
begin
  perform public.agent_book_check(p_book, true);
  if v_id is null then
    if nullif(btrim(coalesce(p ->> 'label', '')), '') is null or coalesce((p ->> 'amount')::numeric, 0) <= 0 or nullif(p ->> 'starts_on', '') is null then
      raise exception 'A standing charge needs a name, an amount and a first day' using errcode = '23514';
    end if;
    insert into public.agent_fee_schedules (book_id, agent_id, kind, label, amount, every, starts_on, ends_on, created_by)
    values (p_book, nullif(p ->> 'agent_id', '')::uuid, coalesce(nullif(p ->> 'kind', ''), 'monthly'), btrim(p ->> 'label'), round((p ->> 'amount')::numeric, 2),
            coalesce(nullif(p ->> 'every', ''), 'month'), (p ->> 'starts_on')::date, nullif(p ->> 'ends_on', '')::date, auth.uid())
    returning id into v_id;
  else
    -- Only its last day can change: what was already charged stays as charged.
    update public.agent_fee_schedules set ends_on = nullif(p ->> 'ends_on', '')::date where id = v_id and book_id = p_book;
    if not found then raise exception 'That standing charge is not in these books' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.agent_schedule_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.agent_schedule_save(uuid, uuid, jsonb) to authenticated;

-- Bring the standing charges up to today. Safe to call again and again.
create or replace function public.agent_charges_run(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer; v_today date := (now() at time zone 'America/New_York')::date;
begin
  perform public.agent_book_check(p_book, true);
  with due as (
    select s.id as schedule_id, s.kind, s.label, s.amount, d::date as due_on, ag.id as agent_id
      from public.agent_fee_schedules s
      cross join lateral generate_series(s.starts_on::timestamp, least(coalesce(s.ends_on, v_today), v_today)::timestamp,
                                         case s.every when 'year' then interval '1 year' when 'quarter' then interval '3 months' else interval '1 month' end) d
      join public.agents ag on (s.agent_id is null and ag.active and (ag.hire_date is null or ag.hire_date <= d::date)) or ag.id = s.agent_id
     where s.book_id = p_book and s.starts_on >= date '2020-01-01'),
  ins as (
    insert into public.agent_charges (book_id, agent_id, charge_date, kind, label, amount, schedule_id, period_key)
    select p_book, due.agent_id, due.due_on, due.kind, due.label, due.amount, due.schedule_id, to_char(due.due_on, 'YYYY-MM-DD') from due
    on conflict (schedule_id, agent_id, period_key) where schedule_id is not null do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;
revoke all on function public.agent_charges_run(uuid) from public, anon;
grant execute on function public.agent_charges_run(uuid) to authenticated;

-- One charge or credit by hand.
create or replace function public.agent_charge_add(p_book uuid, p_agent uuid, p_date date, p_kind text, p_label text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_kind text := coalesce(nullif(p_kind, ''), 'other'); v_amt numeric := round(coalesce(p_amount, 0), 2);
begin
  perform public.agent_book_check(p_book, true);
  if p_agent is null or not exists (select 1 from public.agents ag where ag.id = p_agent) then raise exception 'Choose the agent' using errcode = '23514'; end if;
  if p_date is null or v_amt = 0 or nullif(btrim(coalesce(p_label, '')), '') is null then raise exception 'A charge needs a day, a name and an amount' using errcode = '23514'; end if;
  if v_kind = 'credit' then v_amt := -abs(v_amt); else v_amt := abs(v_amt); end if;
  insert into public.agent_charges (book_id, agent_id, charge_date, kind, label, amount, created_by)
  values (p_book, p_agent, p_date, v_kind, btrim(p_label), v_amt, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.agent_charge_add(uuid, uuid, date, text, text, numeric) from public, anon;
grant execute on function public.agent_charge_add(uuid, uuid, date, text, text, numeric) to authenticated;

create or replace function public.agent_charge_void(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.agent_charges%rowtype;
begin
  select * into c from public.agent_charges where id = p_id;
  if not found then raise exception 'That charge is not there' using errcode = 'P0002'; end if;
  perform public.agent_book_check(c.book_id, true);
  update public.agent_charges set void_at = case when coalesce(p_on, true) then now() end, void_by = case when coalesce(p_on, true) then auth.uid() end where id = p_id;
end $$;
revoke all on function public.agent_charge_void(uuid, boolean) from public, anon;
grant execute on function public.agent_charge_void(uuid, boolean) to authenticated;

-- What came in from an agent toward what they owe: money in, under Agent Fees, tagged with them.
create or replace function public.agent_payments(p_book uuid, p_agent uuid)
returns table (id uuid, paid_on date, amount numeric, payee text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.date, t.amount, coalesce(t.payee, t.description)
    from public.transactions t join public.tax_categories c on c.id = t.tax_category_id
   where t.book_id = p_book and not t.is_archived and t.amount > 0 and c.kind = 'income' and lower(c.name) = 'agent fees'
     and (p_agent is null or t.agent_id = p_agent) and t.agent_id is not null
$$;
revoke all on function public.agent_payments(uuid, uuid) from public, anon, authenticated;

-- The statement itself. No access check here: the two functions below do that.
create or replace function public.agent_statement_data(p_book uuid, p_agent uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with ch as (select c.* from public.agent_charges c where c.book_id = p_book and c.agent_id = p_agent and c.void_at is null),
  pay as (select * from public.agent_payments(p_book, p_agent)),
  paid as (
    -- what the books show the brokerage paid this agent
    select t.id, t.date, -t.amount as amount, coalesce(t.description, t.payee) as what, c.name as category
      from public.transactions t left join public.tax_categories c on c.id = t.tax_category_id
     where t.book_id = p_book and not t.is_archived and t.agent_id = p_agent and t.amount < 0 and btrim(coalesce(t.transfer_account, '')) = ''
       and (p_from is null or t.date >= p_from) and (p_to is null or t.date <= p_to)
       and not exists (select 1 from public.closing_postings cp where cp.transaction_id = t.id and cp.part not in ('agent', 'payout'))),
  cl as (
    select coalesce(b.date_paid, b.date_received) as d, b.address, b.gross_commission, b.amount_to_agent, b.office_fee, b.referral_1, b.tc_payment
      from public.brokerage_transactions b
     where b.agent_id = p_agent and b.deal_status = 'closed' and b.kind in ('sale', 'commission') and coalesce(b.date_paid, b.date_received) is not null
       and (p_from is null or coalesce(b.date_paid, b.date_received) >= p_from) and (p_to is null or coalesce(b.date_paid, b.date_received) <= p_to))
  select jsonb_build_object(
    'agent', (select jsonb_build_object('id', ag.id, 'name', ag.name) from public.agents ag where ag.id = p_agent),
    'from', p_from, 'to', p_to,
    'closings', (select coalesce(jsonb_agg(jsonb_build_object('date', cl.d, 'address', cl.address, 'gross', cl.gross_commission, 'agent', cl.amount_to_agent, 'office', cl.office_fee,
                          'referral', cl.referral_1, 'tc', cl.tc_payment) order by cl.d), '[]'::jsonb) from cl),
    'paid', (select coalesce(jsonb_agg(jsonb_build_object('date', paid.date, 'amount', paid.amount, 'what', paid.what, 'category', paid.category) order by paid.date), '[]'::jsonb) from paid),
    'paid_total', (select coalesce(sum(paid.amount), 0) from paid),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object('id', ch.id, 'date', ch.charge_date, 'kind', ch.kind, 'label', ch.label, 'amount', ch.amount) order by ch.charge_date, ch.created_at), '[]'::jsonb)
                  from ch where (p_from is null or ch.charge_date >= p_from) and (p_to is null or ch.charge_date <= p_to)),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('date', pay.paid_on, 'amount', pay.amount, 'payee', pay.payee) order by pay.paid_on), '[]'::jsonb)
                   from pay where (p_from is null or pay.paid_on >= p_from) and (p_to is null or pay.paid_on <= p_to)),
    'owed_before', case when p_from is null then 0 else
        (select coalesce(sum(ch.amount), 0) from ch where ch.charge_date < p_from) - (select coalesce(sum(pay.amount), 0) from pay where pay.paid_on < p_from) end,
    'owed', (select coalesce(sum(ch.amount), 0) from ch where p_to is null or ch.charge_date <= p_to) - (select coalesce(sum(pay.amount), 0) from pay where p_to is null or pay.paid_on <= p_to))
$$;
revoke all on function public.agent_statement_data(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.agent_statement(p_book uuid, p_agent uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.agent_book_check(p_book, false);
  return public.agent_statement_data(p_book, p_agent, p_from, p_to);
end $$;
revoke all on function public.agent_statement(uuid, uuid, date, date) from public, anon;
grant execute on function public.agent_statement(uuid, uuid, date, date) to authenticated;

-- An agent's own statement from the brokerage. Their own and nobody else's;
-- while agent accounting is in testing, only for people in the testing group.
create or replace function public.my_agent_statement(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_agent uuid; v_book uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.accounting_access aa where aa.user_id = auth.uid()) then return null; end if;
  select ag.id into v_agent from public.agents ag where ag.auth_user_id = auth.uid() limit 1;
  select b.id into v_book from public.books b where b.kind = 'brokerage' and b.archived_at is null limit 1;
  if v_agent is null or v_book is null then return null; end if;
  return public.agent_statement_data(v_book, v_agent, p_from, p_to);
end $$;
revoke all on function public.my_agent_statement(date, date) from public, anon;
grant execute on function public.my_agent_statement(date, date) to authenticated;

-- Every agent with something charged, paid in, or paid out this year.
create or replace function public.agent_balances(p_book uuid, p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_year integer := coalesce(p_year, extract(year from (now() at time zone 'America/New_York'))::integer);
begin
  perform public.agent_book_check(p_book, false);
  with ch as (select c.agent_id, sum(c.amount) as charged from public.agent_charges c where c.book_id = p_book and c.void_at is null group by 1),
  pay as (select t.agent_id, sum(t.amount) as paid from public.transactions t join public.tax_categories c on c.id = t.tax_category_id
           where t.book_id = p_book and not t.is_archived and t.amount > 0 and t.agent_id is not null and c.kind = 'income' and lower(c.name) = 'agent fees' group by 1),
  outp as (select t.agent_id, sum(-t.amount) as paid_out from public.transactions t
            where t.book_id = p_book and not t.is_archived and t.amount < 0 and t.agent_id is not null and btrim(coalesce(t.transfer_account, '')) = ''
              and t.date >= make_date(v_year, 1, 1) and t.date <= make_date(v_year, 12, 31)
              and not exists (select 1 from public.closing_postings cp where cp.transaction_id = t.id and cp.part not in ('agent', 'payout')) group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('agent_id', ag.id, 'name', ag.name, 'active', ag.active, 'charged', round(coalesce(ch.charged, 0), 2), 'paid', round(coalesce(pay.paid, 0), 2),
           'owed', round(coalesce(ch.charged, 0) - coalesce(pay.paid, 0), 2), 'paid_out', round(coalesce(outp.paid_out, 0), 2)) order by ag.name), '[]'::jsonb)
    into v
    from public.agents ag left join ch on ch.agent_id = ag.id left join pay on pay.agent_id = ag.id left join outp on outp.agent_id = ag.id
   where ch.agent_id is not null or pay.agent_id is not null or outp.agent_id is not null;
  return jsonb_build_object('year', v_year, 'agents', v,
    'schedules', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'agent_id', s.agent_id, 'agent', (select ag.name from public.agents ag where ag.id = s.agent_id), 'kind', s.kind,
                           'label', s.label, 'amount', s.amount, 'every', s.every, 'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.created_at), '[]'::jsonb)
                    from public.agent_fee_schedules s where s.book_id = p_book),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name) order by ag.name), '[]'::jsonb) from public.agents ag where ag.active),
    'can_write', p_book in (select public.my_books_writable()));
end $$;
revoke all on function public.agent_balances(uuid, integer) from public, anon;
grant execute on function public.agent_balances(uuid, integer) to authenticated;

-- ── 4. Only the last four digits of an account number ───────────────────────
create or replace function public.account_name_guard() returns trigger
language plpgsql as $$
declare v text := to_jsonb(new) ->> tg_argv[0];
begin
  -- Seven or more digits in a row (spaces and dashes aside) is an account or card number, not a name.
  if regexp_replace(coalesce(v, ''), '[\s\-]', '', 'g') ~ '\d{7,}' then
    raise exception 'Use only the last four digits of an account number in its name (for example "Checking 4411")' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.account_name_guard() from public, anon, authenticated;
drop trigger if exists trg_account_name_guard on public.money_accounts;
create trigger trg_account_name_guard before insert or update of name on public.money_accounts for each row execute function public.account_name_guard('name');
drop trigger if exists trg_account_name_guard on public.statement_imports;
create trigger trg_account_name_guard before insert or update of account on public.statement_imports for each row execute function public.account_name_guard('account');
