-- CLOSINGS POST THEMSELVES, AND THE AGENT'S SIDE ARRIVES TOO
--
-- Dara, 6 Oct 2026 (accounting build, part 5): "Closings post themselves. Each
-- Gold Report closing creates the brokerage entry: gross commission, the
-- agent's share, franchise fees, and what the brokerage keeps. A flawed sheet
-- row is held for a person, not guessed." and "The agent's side arrives too.
-- The same closing appears as commission income in the agent's own book,
-- awaiting their approval. Only this one line crosses."
--
-- What the Gold Report says about one closing (checked against 2026: 216 of
-- 244 sales add up this way, the rest are held):
--     gross commission received
--       = amount paid to the agent + gross office fee + referral + TC payment
--   and the franchise cost (ROG Corp. Cost) is INSIDE the gross office fee.
--
-- THE PROMISES
--  1. These are cash-basis books. A closing puts in the books only money that
--     moved through the brokerage's bank: the commission received (on the day
--     received), the agent's share paid (on the day paid), a referral paid, a
--     TC paid. The franchise cost is NOT posted here: it is paid to the
--     franchisor later, from the bank, and is recorded when the bank shows it.
--     The closings report shows it beside each closing all the same.
--  2. Nothing is guessed. A row that does not add up, has no agent, an
--     impossible date, or a payment the sheet does not explain is HELD with
--     the reason in plain words, until a person posts it or sets it aside.
--  3. A closing never doubles money already in the books. Before posting, the
--     same amount in the same account within a week is looked for. Exactly one
--     match that came in on a bank statement is taken as the same money and is
--     filed (category, agent, closing) rather than added again. Anything less
--     certain is held and a person says.
--  4. The sheet changing later never rewrites the books silently. A posted
--     part whose sheet figures changed is flagged; a person accepts or keeps.
--  5. Only one line crosses to an agent: the amount the brokerage paid them
--     and the address, into a waiting list in THEIR books that only they (and
--     whoever they gave a seat) can read. The brokerage cannot see whether it
--     was accepted. For now this is offered only to people on
--     accounting_access (Dara: agent accounting is in testing).
--  6. Everything a person calls is bounded (signed-in requests get 8 seconds).

-- ── 0. An entry may now say it came from a closing ──────────────────────────
alter table public.transactions drop constraint if exists transactions_entered_via_check;
alter table public.transactions add constraint transactions_entered_via_check
  check (entered_via = any (array['manual', 'photo', 'csv', 'ofx', 'scan', 'email', 'recurring', 'deal', 'deal_close', 'ari', 'closing']));

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.closing_settings (
  book_id         uuid primary key references public.books(id) on delete cascade,
  is_on           boolean not null default false,
  deposit_account text,          -- where commissions land
  pay_account     text,          -- where agents are paid from
  start_on        date,
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);

create table if not exists public.closing_postings (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.books(id) on delete cascade,
  closing_key    text not null,                 -- year-TransID: the sheet's own name for the row
  closing_id     uuid,                          -- brokerage_transactions.id when last seen (may change on re-import)
  part           text not null check (part in ('received', 'agent', 'referral', 'tc', 'payout', 'other')),
  sheet_date     date,
  sheet_amount   numeric(14,2) not null,        -- what the sheet said, signed (in +, out -)
  sheet_agent_id uuid,
  entry_date     date,
  amount         numeric(14,2) not null,
  account        text,
  category_id    uuid references public.tax_categories(id) on delete set null,
  agent_id       uuid references public.agents(id) on delete set null,
  payee          text,
  memo           text,
  state          text not null default 'held' check (state in ('held', 'posted', 'set_aside')),
  reasons        text[] not null default '{}',
  note           text,
  transaction_id uuid references public.transactions(id) on delete set null,
  adopted        boolean not null default false,  -- filed onto money already in the books
  sheet_changed  jsonb,
  decided_by     uuid,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (book_id, closing_key, part)
);
create index if not exists closing_postings_by_state on public.closing_postings (book_id, state);
-- One entry stands for one part of one closing, never two.
create unique index if not exists closing_postings_one_entry on public.closing_postings (transaction_id) where transaction_id is not null and state = 'posted';

create table if not exists public.closing_seen (
  book_id     uuid not null references public.books(id) on delete cascade,
  closing_key text not null,
  sheet_hash  text not null,
  problem     text,                 -- the row could not be read at all; shown on the screen
  seen_at     timestamptz not null default now(),
  primary key (book_id, closing_key)
);

-- What crossed to an agent's own books, waiting for them.
create table if not exists public.book_arrivals (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.books(id) on delete cascade,
  closing_key    text not null,
  entry_date     date not null,
  amount         numeric(14,2) not null,
  payee          text,
  memo           text,
  state          text not null default 'waiting' check (state in ('waiting', 'accepted', 'already', 'declined')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (book_id, closing_key)
);
create index if not exists book_arrivals_waiting on public.book_arrivals (book_id) where state = 'waiting';

alter table public.closing_settings enable row level security;
alter table public.closing_postings enable row level security;
alter table public.closing_seen     enable row level security;
alter table public.book_arrivals    enable row level security;
drop policy if exists closing_settings_read on public.closing_settings;
create policy closing_settings_read on public.closing_settings for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists closing_postings_read on public.closing_postings;
create policy closing_postings_read on public.closing_postings for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists book_arrivals_read on public.book_arrivals;
create policy book_arrivals_read on public.book_arrivals for select to authenticated using (book_id in (select public.my_books_readable()));
revoke all on public.closing_settings, public.closing_postings, public.closing_seen, public.book_arrivals from public, anon, authenticated;
grant select on public.closing_settings, public.closing_postings, public.book_arrivals to authenticated;

-- ── 2. Reading one sheet row ────────────────────────────────────────────────
create or replace function public.closing_key_of(b public.brokerage_transactions) returns text
language sql immutable as $$
  select case when b.trans_id is not null then b.year::text || '-' || b.trans_id::text
              else b.year::text || '-' || coalesce(b.source_tab, 'sheet') || '#' || coalesce(b.source_row::text, b.id::text) end
$$;

create or replace function public.closing_hash_of(b public.brokerage_transactions) returns text
language sql immutable as $$
  select md5(concat_ws('|', coalesce(b.kind, ''), coalesce(b.deal_status, ''), coalesce(b.agent_id::text, ''), coalesce(b.gross_commission::text, ''),
                       coalesce(b.amount_to_agent::text, ''), coalesce(b.office_fee::text, ''), coalesce(b.referral_1::text, ''), coalesce(b.rog_corp_cost::text, ''),
                       coalesce(b.tc_payment::text, ''), coalesce(b.date_received::text, ''), coalesce(b.date_paid::text, ''),
                       coalesce(b.raw_row ->> 'Referral Payment date', ''), coalesce(b.title_agent, ''), coalesce(b.address, ''), coalesce(b.notes, ''), 'v1'))
$$;

create or replace function public.closing_try_date(p text) returns date
language plpgsql immutable as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::date;
exception when others then return null;
end $$;
revoke all on function public.closing_key_of(public.brokerage_transactions) from public, anon;
revoke all on function public.closing_hash_of(public.brokerage_transactions) from public, anon;
revoke all on function public.closing_try_date(text) from public, anon;
grant execute on function public.closing_key_of(public.brokerage_transactions), public.closing_hash_of(public.brokerage_transactions) to authenticated, service_role;

create or replace function public.closing_category(p_book uuid, p_name text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.tax_categories c where c.book_id = p_book and lower(c.name) = lower(p_name) and coalesce(c.is_archived, false) = false order by c.created_at limit 1
$$;

-- The parts of one row and what is wrong with each. Pure reading: no writes.
create or replace function public.closing_parts(p_book uuid, b public.brokerage_transactions)
returns table (part text, sheet_date date, sheet_amount numeric, category_id uuid, agent_id uuid, payee text, memo text, reasons text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g numeric := round(coalesce(b.gross_commission, 0), 2); a numeric := round(coalesce(b.amount_to_agent, 0), 2);
  o numeric := round(coalesce(b.office_fee, 0), 2);       f numeric := round(coalesce(b.referral_1, 0), 2);
  c numeric := round(coalesce(b.rog_corp_cost, 0), 2);    t numeric := round(coalesce(b.tc_payment, 0), 2);
  v_row text[] := '{}'; v_agent text; v_what text; v_lo date; v_hi date;
  v_today date := (now() at time zone 'America/New_York')::date; v_ref date; v_note text := nullif(btrim(coalesce(b.notes, '')), '');
begin
  select ag.name into v_agent from public.agents ag where ag.id = b.agent_id;
  v_agent := coalesce(nullif(btrim(v_agent), ''), nullif(btrim(b.agent_name_raw), ''), 'Agent not named');
  v_what := left(concat_ws(' · ', nullif(btrim(b.address), ''), v_agent, 'Gold Report ' || b.year || coalesce(' #' || b.trans_id, '')), 300);
  v_lo := make_date(b.year, 1, 1) - 92; v_hi := least(make_date(b.year, 12, 31) + 92, v_today + 1);
  v_ref := public.closing_try_date(b.raw_row ->> 'Referral Payment date');

  if b.agent_id is null then v_row := v_row || 'no_agent'::text; end if;
  -- Without the sheet's own number a row has no lasting name: it never posts by itself.
  if b.trans_id is null then v_row := v_row || 'no_trans_id'::text; end if;
  if least(g, a, o, f, c, t) < 0 then v_row := v_row || 'negative'::text; end if;

  if b.kind in ('sale', 'commission') then
    if g <= 0 and (a > 0 or o > 0 or f > 0 or t > 0) then v_row := v_row || 'no_gross'::text;
    elsif abs(g - a - o - f - t) >= 0.01 then v_row := v_row || 'does_not_add_up'::text; end if;
    if b.date_paid is not null and b.date_received is not null and b.date_paid < b.date_received - 3 then v_row := v_row || 'paid_before_received'::text; end if;

    if g > 0 then
      return query select 'received'::text, b.date_received, g, public.closing_category(p_book, 'Commission Income'), b.agent_id,
        coalesce(nullif(btrim(b.title_agent), ''), 'Commission received'), v_what,
        v_row || case when b.date_received is null then array['no_date'] when b.date_received not between v_lo and v_hi then array['odd_date'] else '{}'::text[] end;
    end if;
    if a > 0 then
      return query select 'agent'::text, b.date_paid, -a, public.closing_category(p_book, 'Agent Commissions Paid'), b.agent_id, v_agent, v_what,
        v_row || case when b.date_paid is null then array['no_date'] when b.date_paid not between v_lo and v_hi then array['odd_date'] else '{}'::text[] end;
    end if;
    if t > 0 then
      return query select 'tc'::text, b.date_paid, -t, public.closing_category(p_book, 'Contract Labor'), b.agent_id, 'Transaction coordinator'::text, v_what,
        v_row || array['who_was_paid'] || case when b.date_paid is null then array['no_date'] when b.date_paid not between v_lo and v_hi then array['odd_date'] else '{}'::text[] end;
    end if;
  else
    -- A row with no commission behind it: a payment to someone, for a reason
    -- only the note explains. A person says what it was for.
    if a > 0 then
      return query select 'payout'::text, b.date_paid, -a, null::uuid, b.agent_id, v_agent, left(concat_ws(' · ', v_what, v_note), 400),
        v_row || array['what_for'] || case when b.date_paid is null then array['no_date'] when b.date_paid not between v_lo and v_hi then array['odd_date'] else '{}'::text[] end;
    end if;
    if o > 0 then
      return query select 'other'::text, coalesce(b.date_received, b.date_paid), o, public.closing_category(p_book, 'Agent Fees'), b.agent_id, v_agent,
        left(concat_ws(' · ', v_what, v_note), 400),
        v_row || array['what_for'] || case when coalesce(b.date_received, b.date_paid) is null then array['no_date'] else '{}'::text[] end;
    end if;
  end if;
  if f > 0 then
    return query select 'referral'::text, v_ref, -f, public.closing_category(p_book, 'Referral Fees Paid'), b.agent_id, 'Referral'::text,
      left(concat_ws(' · ', v_what, v_note), 400),
      v_row || array['who_was_paid'] || case when v_ref is null then array['no_date'] when v_ref not between v_lo and v_hi then array['odd_date'] else '{}'::text[] end;
  end if;
end $$;
revoke all on function public.closing_parts(uuid, public.brokerage_transactions) from public, anon, authenticated;
revoke all on function public.closing_category(uuid, text) from public, anon, authenticated;

-- ── 3. The agent's side ─────────────────────────────────────────────────────
-- Offer one posted agent payment to that agent's own books. Quietly does
-- nothing when the agent has no sign-in or is not yet in the testing group.
create or replace function public.arrival_offer(p_posting uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.closing_postings%rowtype; v_user uuid; v_book uuid; v_from text;
begin
  select * into x from public.closing_postings where id = p_posting;
  if not found or x.part <> 'agent' or x.state <> 'posted' or x.agent_id is null or x.entry_date is null then return; end if;
  select ag.auth_user_id into v_user from public.agents ag where ag.id = x.agent_id;
  if v_user is null or not exists (select 1 from public.accounting_access aa where aa.user_id = v_user) then return; end if;
  v_book := public.ensure_personal_book(v_user);
  select b.name into v_from from public.books b where b.id = x.book_id;
  insert into public.book_arrivals (book_id, closing_key, entry_date, amount, payee, memo)
  values (v_book, x.closing_key, x.entry_date, abs(x.amount), v_from, split_part(coalesce(x.memo, ''), ' · ', 1))
  on conflict (book_id, closing_key) do update
     set entry_date = excluded.entry_date, amount = excluded.amount, memo = excluded.memo
   where public.book_arrivals.state = 'waiting';
end $$;
revoke all on function public.arrival_offer(uuid) from public, anon, authenticated;

-- What was offered and not yet answered is taken back when the brokerage's
-- own entry leaves its books or moves to another agent.
create or replace function public.arrival_withdraw(p_key text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.book_arrivals a where a.closing_key = p_key and a.state = 'waiting'
$$;
revoke all on function public.arrival_withdraw(text) from public, anon, authenticated;

-- Someone newly in the testing group gets what was already paid to them.
create or replace function public.arrivals_for_new_tester() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select c.id from public.closing_postings c join public.agents ag on ag.id = c.agent_id
            where ag.auth_user_id = new.user_id and c.part = 'agent' and c.state = 'posted' limit 2000 loop
    perform public.arrival_offer(r.id);
  end loop;
  return null;
exception when others then return null;   -- never blocks giving someone access
end $$;
revoke all on function public.arrivals_for_new_tester() from public, anon, authenticated;
drop trigger if exists trg_arrivals_for_new_tester on public.accounting_access;
create trigger trg_arrivals_for_new_tester after insert on public.accounting_access for each row execute function public.arrivals_for_new_tester();

create or replace function public.arrivals_waiting(p_book uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'date', a.entry_date, 'amount', a.amount, 'payee', a.payee, 'memo', a.memo,
           'twins', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'date', t.date, 'payee', coalesce(t.payee, t.description), 'account', t.account) order by abs(t.date - a.entry_date)), '[]'::jsonb)
                       from public.transactions t
                      where t.book_id = a.book_id and not t.is_archived and t.amount = a.amount and t.date between a.entry_date - 10 and a.entry_date + 10
                        and not exists (select 1 from public.book_arrivals o where o.transaction_id = t.id)))
         order by a.entry_date, a.id), '[]'::jsonb)
    from public.book_arrivals a where a.book_id = p_book and a.state = 'waiting'
$$;
revoke all on function public.arrivals_waiting(uuid) from public, anon;
grant execute on function public.arrivals_waiting(uuid) to authenticated;

-- p_action: accept (add it, into p_account) | already (it is p_transaction) | decline | bring_back
create or replace function public.arrival_decide(p_id uuid, p_action text, p_account text default null, p_transaction uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.book_arrivals%rowtype; v_tx uuid; v_cat uuid;
begin
  select * into a from public.book_arrivals where id = p_id for update;
  if not found or auth.uid() is null or a.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if p_action = 'bring_back' then
    if a.state <> 'declined' then raise exception 'Only something you turned away can be brought back' using errcode = 'P0001'; end if;
    update public.book_arrivals set state = 'waiting', decided_at = null where id = p_id;
    return jsonb_build_object('state', 'waiting');
  end if;
  if a.state <> 'waiting' then raise exception 'That one was already answered' using errcode = 'P0001'; end if;
  if p_action = 'accept' then
    if btrim(coalesce(p_account, '')) = '' then raise exception 'Choose the account it was paid into' using errcode = '23514'; end if;
    select c.id into v_cat from public.tax_categories c
     where c.book_id = a.book_id and c.kind = 'income' and coalesce(c.is_archived, false) = false
     order by (lower(c.name) like 'commission%') desc, c.created_at limit 1;
    perform set_config('prism.learning', 'off', true);
    insert into public.transactions (book_id, date, amount, scope, account, payee, description, tax_category_id, entered_via)
    values (a.book_id, a.entry_date, a.amount, 'business', btrim(p_account), a.payee, a.memo, v_cat, 'deal_close') returning id into v_tx;
    update public.book_arrivals set state = 'accepted', transaction_id = v_tx, decided_at = now() where id = p_id;
  elsif p_action = 'already' then
    if not exists (select 1 from public.transactions t where t.id = p_transaction and t.book_id = a.book_id and not t.is_archived) then
      raise exception 'That entry is not in these books' using errcode = 'P0002';
    end if;
    update public.book_arrivals set state = 'already', transaction_id = p_transaction, decided_at = now() where id = p_id;
  elsif p_action = 'decline' then
    update public.book_arrivals set state = 'declined', decided_at = now() where id = p_id;
  else
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  return jsonb_build_object('state', (select state from public.book_arrivals where id = p_id), 'transaction', v_tx);
end $$;
revoke all on function public.arrival_decide(uuid, text, text, uuid) from public, anon;
grant execute on function public.arrival_decide(uuid, text, text, uuid) to authenticated;

-- ── 4. Posting one part ─────────────────────────────────────────────────────
-- Entries that could be the same money: same account, same amount, within a
-- week, not already tied to a closing.
create or replace function public.closing_twins(p_posting uuid) returns table (id uuid, entry_date date, payee text, sure boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  -- sure: the bank said it happened, or a person already tied that entry to this very closing.
  select t.id, t.date, coalesce(t.payee, t.description), (t.statement_line_id is not null or (x.closing_id is not null and t.closing_id = x.closing_id))
    from public.closing_postings x join public.transactions t on t.book_id = x.book_id
   where x.id = p_posting and x.entry_date is not null and not t.is_archived and t.amount = x.amount
     and lower(btrim(coalesce(t.account, ''))) = lower(btrim(coalesce(x.account, '')))
     and t.date between x.entry_date - 7 and x.entry_date + 7
     and (t.closing_id is null or t.closing_id = x.closing_id) and btrim(coalesce(t.transfer_account, '')) = '' and t.split_group is null
     and not exists (select 1 from public.closing_postings o where o.transaction_id = t.id and o.state = 'posted' and o.id <> x.id)
   order by abs(t.date - x.entry_date), t.id
$$;
revoke all on function public.closing_twins(uuid) from public, anon, authenticated;

-- Returns true when the part is now in the books. Never raises: what stops it
-- is written on the part as a reason.
create or replace function public.closing_try_post(p_posting uuid, p_same_as uuid, p_new boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.closing_postings%rowtype; v_tx uuid := p_same_as; v_n integer; v_one uuid; v_sure boolean; v_adopt boolean := p_same_as is not null; v_by uuid;
begin
  select * into x from public.closing_postings where id = p_posting for update;
  if not found or x.state <> 'held' then return false; end if;
  if x.entry_date is null or x.category_id is null or btrim(coalesce(x.account, '')) = '' then
    update public.closing_postings set reasons = (select array_agg(distinct r) from unnest(reasons || case when x.entry_date is null then array['no_date'] when x.category_id is null then array['what_for'] else array['no_account'] end) r),
           updated_at = now() where id = p_posting;
    return false;
  end if;
  if v_tx is null and not coalesce(p_new, false) then
    select count(*), (array_agg(w.id))[1], bool_and(w.sure) into v_n, v_one, v_sure from public.closing_twins(p_posting) w;
    if v_n = 1 and v_sure then v_tx := v_one; v_adopt := true;
    elsif v_n >= 1 then
      update public.closing_postings set reasons = (select array_agg(distinct r) from unnest(reasons || array['maybe_in_books']) r), updated_at = now() where id = p_posting;
      return false;
    end if;
  end if;
  begin
    perform set_config('prism.learning', 'off', true);
    if v_tx is not null then
      -- Filing it by hand, in effect: it stops following whatever rule filed it before.
      update public.transactions t set tax_category_id = x.category_id, agent_id = coalesce(x.agent_id, t.agent_id), rule_id = null,
             closing_id = (select b.id from public.brokerage_transactions b where b.id = x.closing_id)
       where t.id = v_tx and t.book_id = x.book_id and not t.is_archived and t.amount = x.amount
         and not exists (select 1 from public.closing_postings o where o.transaction_id = t.id and o.state = 'posted' and o.id <> x.id);
      if not found then raise exception 'That entry is not in these books for the same amount, or already stands for another closing'; end if;
    else
      select coalesce(auth.uid(), s.updated_by) into v_by from public.closing_settings s where s.book_id = x.book_id;
      insert into public.transactions (book_id, date, amount, scope, account, payee, description, tax_category_id, agent_id, closing_id, entered_via, entered_by)
      values (x.book_id, x.entry_date, x.amount, 'business', btrim(x.account), x.payee, x.memo, x.category_id, x.agent_id,
              (select b.id from public.brokerage_transactions b where b.id = x.closing_id), 'closing', v_by) returning id into v_tx;
    end if;
    update public.closing_postings set state = 'posted', transaction_id = v_tx, adopted = v_adopt, reasons = '{}', note = null, sheet_changed = null, updated_at = now() where id = p_posting;
  exception when others then
    update public.closing_postings set reasons = (select array_agg(distinct r) from unnest(reasons || array['could_not_post']) r), note = left(sqlerrm, 300), updated_at = now() where id = p_posting;
    return false;
  end;
  if x.part = 'agent' then
    begin perform public.arrival_offer(p_posting); exception when others then null; end;
  end if;
  return true;
end $$;
revoke all on function public.closing_try_post(uuid, uuid, boolean) from public, anon, authenticated;

-- ── 5. Bringing the books up to the sheet ───────────────────────────────────
create or replace function public.closing_apply(p_book uuid, p_row uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.brokerage_transactions%rowtype; s public.closing_settings%rowtype; p record; x public.closing_postings%rowtype;
        v_key text; v_start date; v_parts text[] := '{}'; v_acct text;
begin
  select * into b from public.brokerage_transactions where id = p_row;
  if not found then return; end if;
  select * into s from public.closing_settings where book_id = p_book;
  v_start := coalesce(s.start_on, (select bk.starts_on from public.books bk where bk.id = p_book), date '2026-01-01');
  v_key := public.closing_key_of(b);

  for p in select * from public.closing_parts(p_book, b) loop
    -- Money that moved before these books began is not theirs to record.
    if p.sheet_date is not null and p.sheet_date < v_start then continue; end if;
    -- A row from the year before with no date on it cannot be shown to belong to these books.
    if p.sheet_date is null and b.year < extract(year from v_start)::integer then continue; end if;
    v_parts := v_parts || p.part;
    v_acct := case when p.sheet_amount > 0 then s.deposit_account else coalesce(nullif(btrim(s.pay_account), ''), s.deposit_account) end;
    select * into x from public.closing_postings where book_id = p_book and closing_key = v_key and part = p.part for update;
    if not found then
      insert into public.closing_postings (book_id, closing_key, closing_id, part, sheet_date, sheet_amount, sheet_agent_id, entry_date, amount, account, category_id, agent_id, payee, memo, reasons)
      values (p_book, v_key, b.id, p.part, p.sheet_date, p.sheet_amount, p.agent_id, p.sheet_date, p.sheet_amount, v_acct, p.category_id, p.agent_id, p.payee, p.memo, p.reasons)
      returning * into x;
      if cardinality(p.reasons) = 0 then perform public.closing_try_post(x.id, null, false); end if;
    elsif x.state = 'held' and (x.decided_by is null or (x.sheet_date, x.sheet_amount, x.sheet_agent_id) is distinct from (p.sheet_date, p.sheet_amount, p.agent_id)) then
      -- Still waiting: read it fresh. If a person had answered and the sheet's
      -- figures moved since, their answer was about other figures and is dropped.
      update public.closing_postings
         set closing_id = b.id, sheet_date = p.sheet_date, sheet_amount = p.sheet_amount, sheet_agent_id = p.agent_id, entry_date = p.sheet_date, amount = p.sheet_amount, account = v_acct,
             category_id = p.category_id, agent_id = p.agent_id, payee = p.payee, memo = p.memo, reasons = p.reasons, note = null,
             decided_by = null, decided_at = null, updated_at = now()
       where id = x.id;
      if cardinality(p.reasons) = 0 then perform public.closing_try_post(x.id, null, false); end if;
    elsif x.state = 'posted' then
      update public.closing_postings
         set closing_id = b.id,
             sheet_changed = case when (x.sheet_date, x.sheet_amount, x.sheet_agent_id) is distinct from (p.sheet_date, p.sheet_amount, p.agent_id)
                                  then jsonb_build_object('date', p.sheet_date, 'amount', p.sheet_amount, 'agent_id', p.agent_id, 'payee', p.payee) else null end,
             updated_at = now()
       where id = x.id and (closing_id is distinct from b.id or sheet_changed is not null or (x.sheet_date, x.sheet_amount, x.sheet_agent_id) is distinct from (p.sheet_date, p.sheet_amount, p.agent_id));
      -- The sheet row was read in again under a new id: the entry keeps pointing at its closing.
      if x.closing_id is distinct from b.id then
        begin update public.transactions set closing_id = b.id where id = x.transaction_id and closing_id is distinct from b.id; exception when others then null; end;
      end if;
    else
      update public.closing_postings set closing_id = b.id, sheet_date = p.sheet_date, sheet_amount = p.sheet_amount, sheet_agent_id = p.agent_id, updated_at = now()
       where id = x.id and (closing_id is distinct from b.id or (sheet_date, sheet_amount, sheet_agent_id) is distinct from (p.sheet_date, p.sheet_amount, p.agent_id));
    end if;
  end loop;

  -- A part the sheet no longer has.
  delete from public.closing_postings c where c.book_id = p_book and c.closing_key = v_key and not (c.part = any (v_parts)) and c.state = 'held';
  update public.closing_postings c set sheet_changed = jsonb_build_object('gone', true), updated_at = now()
   where c.book_id = p_book and c.closing_key = v_key and not (c.part = any (v_parts)) and c.state = 'posted' and c.sheet_changed is null;

  insert into public.closing_seen (book_id, closing_key, sheet_hash) values (p_book, v_key, public.closing_hash_of(b))
  on conflict (book_id, closing_key) do update set sheet_hash = excluded.sheet_hash, problem = null, seen_at = now();
end $$;
revoke all on function public.closing_apply(uuid, uuid) from public, anon, authenticated;

-- A bounded pass. The screen (or the nightly job) calls it until left = 0.
create or replace function public.closings_sync(p_book uuid, p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.closing_settings%rowtype; r record; v_year integer; v_left integer; v_n integer := 0; v_lim integer;
        -- No role claim at all means a direct database connection (the nightly job, a migration): every request through the API carries one.
        v_service boolean := auth.role() is null or auth.role() = 'service_role';
begin
  v_lim := greatest(1, least(coalesce(p_limit, 25), case when v_service then 500 else 60 end));
  if not v_service and (auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable())) then
    raise exception 'You cannot change these books' using errcode = '42501';
  end if;
  if not exists (select 1 from public.books b where b.id = p_book and b.kind = 'brokerage') then raise exception 'Closings belong to the brokerage books' using errcode = 'P0001'; end if;
  select * into s from public.closing_settings where book_id = p_book;
  if not found or not s.is_on or btrim(coalesce(s.deposit_account, '')) = '' then return jsonb_build_object('on', false, 'left', 0); end if;
  -- The year before the start too: a December closing can be paid in January.
  v_year := extract(year from coalesce(s.start_on, (select b.starts_on from public.books b where b.id = p_book), date '2026-01-01'))::integer - 1;
  -- One pass at a time for a set of books.
  perform pg_advisory_xact_lock(hashtextextended('prism.closings:' || p_book::text, 0));

  -- An entry a person took out of the books by hand stays out.
  for r in update public.closing_postings c set state = 'set_aside', note = 'removed_by_hand', decided_at = now(), updated_at = now()
            where c.book_id = p_book and c.state = 'posted'
              and not exists (select 1 from public.transactions t where t.id = c.transaction_id and not t.is_archived)
            returning c.closing_key, c.part loop
    if r.part = 'agent' then perform public.arrival_withdraw(r.closing_key); end if;
  end loop;
  -- ... and one they put back is in the books again.
  update public.closing_postings c set state = 'posted', note = null, updated_at = now()
   where c.book_id = p_book and c.state = 'set_aside' and c.note = 'removed_by_hand'
     and exists (select 1 from public.transactions t where t.id = c.transaction_id and not t.is_archived)
     and not exists (select 1 from public.closing_postings o where o.transaction_id = c.transaction_id and o.state = 'posted');

  -- Rows that left the sheet, or are no longer closed.
  for r in select cs.closing_key from public.closing_seen cs
            where cs.book_id = p_book
              and cs.closing_key not in (select public.closing_key_of(b) from public.brokerage_transactions b where b.deal_status = 'closed' and b.year >= v_year)
            limit 200 loop
    delete from public.closing_postings c where c.book_id = p_book and c.closing_key = r.closing_key and c.state = 'held';
    update public.closing_postings c set sheet_changed = jsonb_build_object('gone', true), updated_at = now()
     where c.book_id = p_book and c.closing_key = r.closing_key and c.state = 'posted' and c.sheet_changed is null;
    delete from public.closing_seen cs where cs.book_id = p_book and cs.closing_key = r.closing_key;
  end loop;

  for r in select b.id from public.brokerage_transactions b
            left join public.closing_seen cs on cs.book_id = p_book and cs.closing_key = public.closing_key_of(b)
           where b.deal_status = 'closed' and b.year >= v_year and (cs.closing_key is null or cs.sheet_hash <> public.closing_hash_of(b))
           order by b.year, b.trans_id nulls last, b.id limit v_lim loop
    begin
      perform public.closing_apply(p_book, r.id);
    exception when others then
      -- A row that cannot be read at all is named on the screen and not tried
      -- again until the sheet changes it; it never stops the rows after it.
      insert into public.closing_seen (book_id, closing_key, sheet_hash, problem)
      select p_book, public.closing_key_of(b), public.closing_hash_of(b), left(sqlerrm, 300) from public.brokerage_transactions b where b.id = r.id
      on conflict (book_id, closing_key) do update set sheet_hash = excluded.sheet_hash, problem = excluded.problem, seen_at = now();
    end;
    v_n := v_n + 1;
  end loop;

  select count(*) into v_left from public.brokerage_transactions b
    left join public.closing_seen cs on cs.book_id = p_book and cs.closing_key = public.closing_key_of(b)
   where b.deal_status = 'closed' and b.year >= v_year and (cs.closing_key is null or cs.sheet_hash <> public.closing_hash_of(b));
  return jsonb_build_object('on', true, 'done', v_n, 'left', v_left);
end $$;
revoke all on function public.closings_sync(uuid, integer) from public, anon;
grant execute on function public.closings_sync(uuid, integer) to authenticated, service_role;

-- The nightly job, after the Gold Report is read.
create or replace function public.closings_sync_all() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v jsonb; v_i integer; v_out jsonb := '[]'::jsonb;
begin
  for r in select s.book_id from public.closing_settings s where s.is_on loop
    v_i := 0;
    loop
      v := public.closings_sync(r.book_id, 200); v_i := v_i + 1;
      exit when coalesce((v ->> 'left')::integer, 0) = 0 or coalesce((v ->> 'done')::integer, 0) = 0 or v_i >= 40;
    end loop;
    v_out := v_out || jsonb_build_object('book', r.book_id, 'left', v -> 'left');
  end loop;
  return v_out;
end $$;
revoke all on function public.closings_sync_all() from public, anon, authenticated;
grant execute on function public.closings_sync_all() to service_role;

-- ── 6. What a person does ───────────────────────────────────────────────────
create or replace function public.closing_settings_save(p_book uuid, p_on boolean, p_deposit text, p_pay text, p_start date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_dep text; v_pay text; v_on boolean := coalesce(p_on, false);
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin of these books can change this' using errcode = '42501'; end if;
  if not exists (select 1 from public.books b where b.id = p_book and b.kind = 'brokerage') then raise exception 'Closings belong to the brokerage books' using errcode = 'P0001'; end if;
  -- The accounts must be ones these books already have, spelled as the books
  -- spell them: a near-miss would open a second account and hide every match.
  select btrim(m.name) into v_dep from public.money_accounts m where m.book_id = p_book and m.retired_at is null and lower(btrim(m.name)) = lower(btrim(coalesce(p_deposit, '')));
  select btrim(m.name) into v_pay from public.money_accounts m where m.book_id = p_book and m.retired_at is null and lower(btrim(m.name)) = lower(btrim(coalesce(p_pay, '')));
  if btrim(coalesce(p_deposit, '')) <> '' and v_dep is null then raise exception 'These books have no account named %', btrim(p_deposit) using errcode = 'P0002'; end if;
  if btrim(coalesce(p_pay, '')) <> '' and v_pay is null then raise exception 'These books have no account named %', btrim(p_pay) using errcode = 'P0002'; end if;
  if v_on and v_dep is null then raise exception 'Choose the account commissions are deposited into' using errcode = '23514'; end if;
  if v_on and p_start is null then raise exception 'Choose the day to start from' using errcode = '23514'; end if;
  insert into public.closing_settings (book_id, is_on, deposit_account, pay_account, start_on, updated_by)
  values (p_book, v_on, v_dep, v_pay, p_start, auth.uid())
  on conflict (book_id) do update set is_on = excluded.is_on, deposit_account = excluded.deposit_account, pay_account = excluded.pay_account,
                                      start_on = excluded.start_on, updated_by = excluded.updated_by, updated_at = now();
  -- What is still waiting follows the accounts as they are now.
  update public.closing_postings c set account = case when c.amount > 0 then v_dep else coalesce(v_pay, v_dep) end, updated_at = now()
   where c.book_id = p_book and c.state = 'held' and v_dep is not null
     and c.account is distinct from case when c.amount > 0 then v_dep else coalesce(v_pay, v_dep) end;
  perform public.book_log_add(p_book, case when v_on then 'closings_on' else 'closings_off' end, null, v_dep, null,
                              jsonb_build_object('deposit', v_dep, 'pay', v_pay, 'start', p_start));
  return (select to_jsonb(s) from public.closing_settings s where s.book_id = p_book);
end $$;
revoke all on function public.closing_settings_save(uuid, boolean, text, text, date) from public, anon;
grant execute on function public.closing_settings_save(uuid, boolean, text, text, date) to authenticated;

-- p_action: post | post_new | same | set_aside | bring_back | accept_change | keep
create or replace function public.closing_decide(p_id uuid, p_action text, p_date date default null, p_payee text default null,
                                                 p_category uuid default null, p_same_as uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.closing_postings%rowtype; v_ok boolean; v_date date; v_amt numeric; v_agent uuid;
begin
  select * into x from public.closing_postings where id = p_id for update;
  if not found or auth.uid() is null or x.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;

  if p_action in ('post', 'post_new', 'same') then
    if x.state <> 'held' then raise exception 'That one is not waiting' using errcode = 'P0001'; end if;
    if p_action = 'same' and p_same_as is null then raise exception 'Choose the entry it is the same as' using errcode = '23514'; end if;
    if p_category is not null and not exists (select 1 from public.tax_categories c where c.id = p_category and c.book_id = x.book_id) then
      raise exception 'That category belongs to a different set of books' using errcode = '23514';
    end if;
    if p_date is not null and p_date > (now() at time zone 'America/New_York')::date + 1 then raise exception 'That date is in the future' using errcode = '23514'; end if;
    update public.closing_postings
       set entry_date = coalesce(p_date, entry_date), payee = coalesce(nullif(btrim(coalesce(p_payee, '')), ''), payee),
           category_id = coalesce(p_category, category_id), decided_by = auth.uid(), decided_at = now(),
           reasons = '{}', note = null, updated_at = now()
     where id = p_id returning * into x;
    if x.entry_date is null then raise exception 'It needs the date the money moved' using errcode = '23514'; end if;
    if x.category_id is null then raise exception 'Choose what it was for' using errcode = '23514'; end if;
    v_ok := public.closing_try_post(p_id, case when p_action = 'same' then p_same_as end, p_action = 'post_new');
  elsif p_action = 'set_aside' then
    if x.state <> 'held' then raise exception 'That one is not waiting' using errcode = 'P0001'; end if;
    update public.closing_postings set state = 'set_aside', decided_by = auth.uid(), decided_at = now(), note = 'set_aside_by_hand', updated_at = now() where id = p_id;
  elsif p_action = 'bring_back' then
    if x.state <> 'set_aside' then raise exception 'That one was not set aside' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.brokerage_transactions b where b.deal_status = 'closed' and public.closing_key_of(b) = x.closing_key) then
      raise exception 'That closing is no longer on the Gold Report, so there is nothing to bring back' using errcode = 'P0001';
    end if;
    if x.transaction_id is not null and exists (select 1 from public.transactions t where t.id = x.transaction_id and not t.is_archived)
       and not exists (select 1 from public.closing_postings o where o.transaction_id = x.transaction_id and o.state = 'posted') then
      -- Its entry is in the books after all.
      update public.closing_postings set state = 'posted', note = null, decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
    else
      update public.closing_postings set state = 'held', decided_by = null, decided_at = null, note = null, transaction_id = null, adopted = false, updated_at = now() where id = p_id;
      delete from public.closing_seen cs where cs.book_id = x.book_id and cs.closing_key = x.closing_key;   -- read the sheet again
    end if;
  elsif p_action = 'accept_change' then
    if x.state <> 'posted' or x.sheet_changed is null then raise exception 'Nothing changed on the sheet for that one' using errcode = 'P0001'; end if;
    perform set_config('prism.learning', 'off', true);
    if coalesce((x.sheet_changed ->> 'gone')::boolean, false) then
      if x.adopted then
        -- The bank's line stays in the books; it only stops standing for this closing.
        begin update public.transactions set closing_id = null where id = x.transaction_id; exception when others then null; end;
        update public.closing_postings set state = 'set_aside', note = 'left_the_sheet', sheet_changed = null, transaction_id = null, decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
      else
        update public.transactions set is_archived = true where id = x.transaction_id and not is_archived;
        update public.closing_postings set state = 'set_aside', note = 'left_the_sheet', sheet_changed = null, decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
      end if;
      if x.part = 'agent' then perform public.arrival_withdraw(x.closing_key); end if;
    else
      v_date := (x.sheet_changed ->> 'date')::date; v_amt := (x.sheet_changed ->> 'amount')::numeric; v_agent := (x.sheet_changed ->> 'agent_id')::uuid;
      if x.adopted then
        -- Tied to a line from the bank: the bank's amount and date stand.
        if v_amt is distinct from x.amount then raise exception 'This one is tied to a line from the bank, and the bank''s amount stands. Keep the books as they are, or fix the sheet.' using errcode = 'P0001'; end if;
        update public.transactions set agent_id = v_agent where id = x.transaction_id and not is_archived and agent_id is distinct from v_agent;
      else
        update public.transactions set date = coalesce(v_date, date), amount = v_amt, agent_id = v_agent,
               payee = case when x.part in ('agent', 'payout') then coalesce(x.sheet_changed ->> 'payee', payee) else payee end
         where id = x.transaction_id and not is_archived;
        if not found then raise exception 'That entry is no longer in the books' using errcode = 'P0002'; end if;
      end if;
      update public.closing_postings set sheet_date = v_date, sheet_amount = v_amt, sheet_agent_id = v_agent, agent_id = v_agent,
             entry_date = case when x.adopted then entry_date else coalesce(v_date, entry_date) end, amount = case when x.adopted then amount else v_amt end,
             payee = case when x.part in ('agent', 'payout') then coalesce(x.sheet_changed ->> 'payee', payee) else payee end,
             sheet_changed = null, decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
      if x.part = 'agent' then
        if v_agent is distinct from x.agent_id then perform public.arrival_withdraw(x.closing_key); end if;
        perform public.arrival_offer(p_id);
      end if;
    end if;
  elsif p_action = 'keep' then
    if x.state <> 'posted' or x.sheet_changed is null then raise exception 'Nothing changed on the sheet for that one' using errcode = 'P0001'; end if;
    update public.closing_postings
       set sheet_date = case when sheet_changed ? 'gone' then sheet_date else (sheet_changed ->> 'date')::date end,
           sheet_amount = case when sheet_changed ? 'gone' then sheet_amount else (sheet_changed ->> 'amount')::numeric end,
           sheet_agent_id = case when sheet_changed ? 'gone' then sheet_agent_id else (sheet_changed ->> 'agent_id')::uuid end,
           sheet_changed = null, decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
  else
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  select * into x from public.closing_postings where id = p_id;
  return jsonb_build_object('state', x.state, 'reasons', x.reasons, 'note', x.note);
end $$;
revoke all on function public.closing_decide(uuid, text, date, text, uuid, uuid) from public, anon;
grant execute on function public.closing_decide(uuid, text, date, text, uuid, uuid) to authenticated;

-- ── 7. What the screen reads ────────────────────────────────────────────────
-- p_view: held | changed | posted | set_aside
create or replace function public.closings_list(p_book uuid, p_view text default 'held', p_limit integer default 60, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_counts jsonb; v_set jsonb; v_wait integer := 0; v_year integer;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_readable()) then raise exception 'You cannot see these books' using errcode = '42501'; end if;
  select to_jsonb(s) into v_set from public.closing_settings s where s.book_id = p_book;
  select jsonb_build_object(
           'held', count(*) filter (where c.state = 'held'),
           'changed', count(*) filter (where c.state = 'posted' and c.sheet_changed is not null),
           'posted', count(*) filter (where c.state = 'posted'),
           'set_aside', count(*) filter (where c.state = 'set_aside'))
    into v_counts from public.closing_postings c where c.book_id = p_book;
  if coalesce((v_set ->> 'is_on')::boolean, false) then
    v_year := extract(year from coalesce((v_set ->> 'start_on')::date, (select b.starts_on from public.books b where b.id = p_book), date '2026-01-01'))::integer - 1;
    select count(*) into v_wait from public.brokerage_transactions b
      left join public.closing_seen cs on cs.book_id = p_book and cs.closing_key = public.closing_key_of(b)
     where b.deal_status = 'closed' and b.year >= v_year and (cs.closing_key is null or cs.sheet_hash <> public.closing_hash_of(b));
  end if;
  select coalesce(jsonb_agg(q.j order by q.ord_date desc nulls first, q.k, q.part), '[]'::jsonb) into v_rows from (
    select c.closing_key as k, c.part, coalesce(c.entry_date, b.date_paid, b.date_received) as ord_date,
           jsonb_build_object('id', c.id, 'key', c.closing_key, 'part', c.part, 'state', c.state, 'reasons', c.reasons, 'note', c.note,
             'date', c.entry_date, 'amount', c.amount, 'account', c.account, 'payee', c.payee, 'category_id', c.category_id,
             'category', (select tc.name from public.tax_categories tc where tc.id = c.category_id),
             'agent', coalesce((select ag.name from public.agents ag where ag.id = c.agent_id), b.agent_name_raw),
             'address', b.address, 'kind', b.kind, 'trans_id', b.trans_id, 'year', b.year, 'sheet_note', b.notes,
             'adopted', c.adopted, 'changed', c.sheet_changed, 'transaction_id', c.transaction_id,
             'sheet', case when b.id is null then null else jsonb_build_object('gross', b.gross_commission, 'agent', b.amount_to_agent, 'office', b.office_fee,
                        'referral', b.referral_1, 'tc', b.tc_payment, 'franchise', b.rog_corp_cost, 'received', b.date_received, 'paid', b.date_paid) end,
             'twins', case when 'maybe_in_books' = any (c.reasons) then
                        (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'date', w.entry_date, 'payee', w.payee, 'bank', w.sure)), '[]'::jsonb) from public.closing_twins(c.id) w)
                      else '[]'::jsonb end) as j
      from public.closing_postings c left join public.brokerage_transactions b on b.id = c.closing_id
     where c.book_id = p_book
       and case coalesce(p_view, 'held') when 'held' then c.state = 'held' when 'changed' then c.state = 'posted' and c.sheet_changed is not null
                when 'posted' then c.state = 'posted' else c.state = 'set_aside' end
     order by coalesce(c.entry_date, b.date_paid, b.date_received) desc nulls first, c.closing_key, c.part
     limit greatest(1, least(coalesce(p_limit, 60), 200)) offset greatest(coalesce(p_offset, 0), 0)) q;
  return jsonb_build_object('settings', v_set, 'counts', v_counts, 'unread', v_wait, 'rows', v_rows,
                            'problems', (select coalesce(jsonb_agg(jsonb_build_object('key', cs.closing_key, 'problem', cs.problem)), '[]'::jsonb) from public.closing_seen cs where cs.book_id = p_book and cs.problem is not null),
                            'can_write', p_book in (select public.my_books_writable()), 'can_manage', p_book in (select public.my_books_manageable()));
end $$;
revoke all on function public.closings_list(uuid, text, integer, integer) from public, anon;
grant execute on function public.closings_list(uuid, text, integer, integer) to authenticated;

-- Closings as the sheet has them, for a period: what came in, where it went,
-- and what the brokerage kept. p_by: closing | agent | month.
-- The day a closing counts is the day its commission was received (or, with no
-- such day, the day the agent was paid).
create or replace function public.closings_report(p_book uuid, p_from date, p_to date, p_by text default 'agent') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_readable()) then raise exception 'You cannot see these books' using errcode = '42501'; end if;
  if not exists (select 1 from public.books b where b.id = p_book and b.kind = 'brokerage') then raise exception 'Closings belong to the brokerage books' using errcode = 'P0001'; end if;
  with rows as (
    select b.kind, b.gross_commission, b.amount_to_agent, b.referral_1, b.tc_payment, b.office_fee, b.rog_corp_cost,
           coalesce(b.date_received, b.date_paid) as d, public.closing_key_of(b) as ckey, nullif(btrim(b.address), '') as address,
           coalesce(ag.name, nullif(btrim(b.agent_name_raw), ''), 'Agent not named') as agent
      from public.brokerage_transactions b left join public.agents ag on ag.id = b.agent_id
     where b.deal_status = 'closed' and coalesce(b.date_received, b.date_paid) is not null
       and (p_from is null or coalesce(b.date_received, b.date_paid) >= p_from) and (p_to is null or coalesce(b.date_received, b.date_paid) <= p_to)),
  keyed as (
    select r.*,
           case coalesce(p_by, 'agent') when 'month' then to_char(r.d, 'YYYY-MM') when 'closing' then to_char(r.d, 'YYYY-MM-DD') || ' ' || r.ckey else lower(r.agent) end as k,
           case coalesce(p_by, 'agent') when 'month' then to_char(r.d, 'Mon YYYY') when 'closing' then concat_ws(' · ', to_char(r.d, 'Mon FMDD'), r.address, r.agent) else r.agent end as label
      from rows r),
  g as (
    select x.k, min(x.label) as label, count(*) filter (where x.kind in ('sale', 'commission')) as n,
           sum(coalesce(x.gross_commission, 0)) as gross, sum(coalesce(x.amount_to_agent, 0)) as agent, sum(coalesce(x.referral_1, 0)) as referral,
           sum(coalesce(x.tc_payment, 0)) as tc, sum(coalesce(x.office_fee, 0)) as office, sum(coalesce(x.rog_corp_cost, 0)) as franchise
      from keyed x group by x.k)
  select jsonb_build_object('by', coalesce(p_by, 'agent'),
           'lines', coalesce(jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n, 'gross', round(g.gross, 2), 'agent', round(g.agent, 2), 'referral', round(g.referral, 2),
                      'tc', round(g.tc, 2), 'office', round(g.office, 2), 'franchise', round(g.franchise, 2), 'kept', round(g.office - g.franchise, 2))
                    order by case when coalesce(p_by, 'agent') = 'agent' then -g.gross end, g.k), '[]'::jsonb))
    into v from g;
  return v;
end $$;
revoke all on function public.closings_report(uuid, date, date, text) from public, anon;
grant execute on function public.closings_report(uuid, date, date, text) to authenticated;

-- ── 8. The bank's side of the same promise ──────────────────────────────────
-- statement_find_twins() from 2026-10-06f, with ONE change: an entry a closing
-- put in the books is looked for within a week of the bank's date, not three
-- days. The Gold Report's "date received" is when the office logged the check;
-- the bank can show it several days later, and a closing must not be doubled.
create or replace function public.statement_find_twins(p_import uuid, p_line uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; l record; v_acct text; v_tx uuid; v_ln uuid; v_n integer := 0;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found then return 0; end if;
  v_acct := lower(btrim(i.account));
  if p_line is not null then   -- its date or amount changed: look again from nothing
    update public.statement_lines set twin_transaction_id = null, twin_line_id = null, twin_answer = null where id = p_line and import_id = p_import and result is null;
  end if;
  -- The bank's own id for a line, if it gave one, settles it on any date. The
  -- nth line carrying an id is paired with the nth entry carrying it.
  with mine as (
    select x.id, x.external_id, x.amount, row_number() over (partition by x.external_id, x.amount order by x.line_no) as rn
      from public.statement_lines x
     where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
       and x.twin_transaction_id is null and x.twin_line_id is null and x.external_id is not null and x.amount <> 0),
  theirs as (
    select g.id, g.external_id, g.amount, row_number() over (partition by g.external_id, g.amount order by g.id) as rn
      from (select (array_agg(t.id order by t.created_at, t.id))[1] as id, t.external_id, sum(t.amount) as amount,
                   min(lower(btrim(coalesce(t.account, '')))) as account
              from public.transactions t
             where t.book_id = i.book_id and not t.is_archived and t.external_id in (select m.external_id from mine m)
               and not exists (select 1 from public.statement_lines s where s.id = t.statement_line_id and s.import_id = p_import)
             group by coalesce(t.split_group, t.id), t.external_id) g
     where g.account in (v_acct, '')      -- a bank's id means something only within one account
       and not exists (select 1 from public.statement_lines o where o.import_id = p_import and o.twin_transaction_id = g.id)),
  hit as (
    update public.statement_lines x set twin_transaction_id = t.id
      from mine m join theirs t on t.external_id = m.external_id and t.amount = m.amount and t.rn = m.rn
     where x.id = m.id returning 1)
  select count(*) into v_n from hit;
  -- The same, against lines still waiting in other uploads for this account.
  with mine as (
    select x.id, x.external_id, x.amount, row_number() over (partition by x.external_id, x.amount order by x.line_no) as rn
      from public.statement_lines x
     where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
       and x.twin_transaction_id is null and x.twin_line_id is null and x.external_id is not null and x.amount <> 0),
  theirs as (
    select o.id, o.external_id, o.amount, row_number() over (partition by o.external_id, o.amount order by oi.created_at, o.line_no) as rn
      from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id
     where o.book_id = i.book_id and o.import_id <> p_import and o.result is null and oi.taken_back_at is null
       and lower(btrim(oi.account)) = v_acct and o.external_id in (select m.external_id from mine m)
       and not exists (select 1 from public.statement_lines c where c.import_id = p_import and c.twin_line_id = o.id)),
  hit as (
    update public.statement_lines x set twin_line_id = t.id
      from mine m join theirs t on t.external_id = m.external_id and t.amount = m.amount and t.rn = m.rn
     where x.id = m.id returning 1)
  select v_n + count(*) into v_n from hit;
  for l in select * from public.statement_lines x
            where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
              and x.twin_transaction_id is null and x.twin_line_id is null and x.line_date is not null and x.amount <> 0
            order by x.line_no
  loop
    v_tx := null; v_ln := null;
    if true then
      with items as (
        select (array_agg(t.id order by t.created_at, t.id))[1] as id, min(t.date) as date, sum(t.amount) as amount,
               min(lower(btrim(coalesce(t.account, '')))) as account, min(lower(btrim(coalesce(t.transfer_account, '')))) as other,
               min(t.payee) as payee, bool_or(coalesce(s.import_id = p_import, false)) as same_import
          from public.transactions t
          left join public.statement_lines s on s.id = t.statement_line_id
         where t.book_id = i.book_id and not t.is_archived and (t.date between l.line_date - 3 and l.line_date + 3
                or (t.entered_via = 'closing' and t.date between l.line_date - 7 and l.line_date + 7))
         group by coalesce(t.split_group, t.id))
      select x.id into v_tx from items x
       where not x.same_import
         and ((x.amount = l.amount and (x.account in (v_acct, '') or (l.payee_key <> '' and lower(public.clean_payee(x.payee)) = l.payee_key)))
              or (x.other = v_acct and x.amount = -l.amount))
         and not exists (select 1 from public.statement_lines o where o.import_id = p_import and o.twin_transaction_id = x.id)
       order by (x.account = v_acct) desc, abs(x.date - l.line_date), x.id limit 1;
    end if;
    if v_tx is null then
      select o.id into v_ln from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id
       where o.book_id = i.book_id and o.import_id <> p_import and o.result is null and oi.taken_back_at is null
         and lower(btrim(oi.account)) = v_acct and o.amount = l.amount
         and (o.line_date between l.line_date - 3 and l.line_date + 3 or (l.external_id is not null and o.external_id = l.external_id))
         and not exists (select 1 from public.statement_lines c where c.import_id = p_import and c.twin_line_id = o.id)
       order by abs(o.line_date - l.line_date), o.line_no limit 1;
    end if;
    if v_tx is not null or v_ln is not null then
      update public.statement_lines set twin_transaction_id = v_tx, twin_line_id = v_ln where id = l.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.statement_find_twins(uuid, uuid) from public, anon, authenticated, service_role;
