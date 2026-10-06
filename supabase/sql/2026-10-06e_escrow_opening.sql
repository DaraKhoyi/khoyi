-- An escrow account's starting balance is other people's money, not the owners'.
--
-- Found by looking at the first statement of position (6 Oct 2026): every
-- starting balance was posted against "Opening balances" (the owners' share),
-- so $48,000 sitting in escrow on day one read as $48,000 of the owners' own.
-- Now the starting balance of an account marked ESCROW is posted against
-- "Held for others at the start" (owed back), and changing an account to or
-- from escrow re-posts its opening entry the same way a corrected starting
-- balance does: a reversal plus a new entry.
--
-- Idempotent. Safe to run twice.
create or replace function public.ledger_system_account(p_book uuid, p_key text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid; v_class text; v_name text;
begin
  select id into v from public.ledger_accounts where book_id = p_book and system_key = p_key;
  if v is not null then return v; end if;
  select x.class, x.name into v_class, v_name from (values
    ('opening_equity',        'equity',    'Opening balances'),
    ('opening_held',          'liability', 'Held for others at the start'),
    ('uncategorized_income',  'income',    'Money in, no category yet'),
    ('uncategorized_expense', 'expense',   'Money out, no category yet'),
    ('personal',              'equity',    'Personal, not business'),
    ('no_account',            'asset',     'No account named')) x(key, class, name) where x.key = p_key;
  if v_class is null then raise exception 'unknown ledger account %', p_key; end if;
  insert into public.ledger_accounts (book_id, class, name, system_key) values (p_book, v_class, v_name, p_key)
  on conflict (book_id, system_key) where system_key is not null do nothing returning id into v;
  if v is null then select id into v from public.ledger_accounts where book_id = p_book and system_key = p_key; end if;
  return v;
end $$;
revoke all on function public.ledger_system_account(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.ledger_on_money_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acct uuid; v_live uuid; v_date date; v_closed date; v_class text := case new.kind when 'card' then 'liability' else 'asset' end;
        v_was_escrow boolean := tg_op = 'UPDATE' and old.kind in ('escrow'); v_is_escrow boolean := new.kind in ('escrow');
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
  if tg_op = 'INSERT' or old.starting_balance is distinct from new.starting_balance or v_was_escrow is distinct from v_is_escrow then
    select e.id into v_live from public.gl_live e where e.opening_for = new.id order by e.seq desc limit 1;
    if v_live is not null then perform public.ledger_reverse(v_live, null); end if;
    perform public.ledger_post(new.book_id, v_date, null, new.id, v_live, 'Starting balance: ' || btrim(new.name), v_acct,
                               public.ledger_system_account(new.book_id, case when v_is_escrow then 'opening_held' else 'opening_equity' end),
                               round(new.starting_balance * 100)::bigint, null);
  end if;
  return null;
end $$;
revoke all on function public.ledger_on_money_account() from public, anon, authenticated, service_role;

-- Exactly one of each, with the grants above (CREATE OR REPLACE can overload or drop grants).
do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('ledger_system_account', 'ledger_on_money_account')) <> 2 then
    raise exception 'ledger_system_account / ledger_on_money_account: expected exactly one of each';
  end if;
end $$;
