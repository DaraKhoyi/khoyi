-- Money: a balance for each account, the way a check register shows one.
--
-- Dara, 5 Oct 2026: "Yes, I do want a balance displayed per account."
--
-- An account here is the name typed in the Account box of an entry ("Biz Visa").
-- Its balance is a starting balance (0 until the person sets one) plus every
-- entry filed against that name. Names are matched without regard to capitals
-- or stray spaces, so "biz visa" and "Biz Visa " are one account.
--
-- The balance is added up in the database, not on the phone: the screen loads
-- the newest 500 entries, and a balance over 500 entries is not a balance.
--
-- Idempotent. Safe to run twice.

create table if not exists public.money_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  starting_balance numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists money_accounts_user_name on public.money_accounts (user_id, lower(btrim(name)));

alter table public.money_accounts enable row level security;
drop policy if exists money_accounts_own on public.money_accounts;
create policy money_accounts_own on public.money_accounts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.money_accounts from anon, public;
grant select, insert, update, delete on public.money_accounts to authenticated;

-- One row per account the signed-in person has used or named.
-- Runs as the caller: the rules on transactions and money_accounts still apply.
create or replace function public.my_account_balances()
returns table (account text, entries integer, starting_balance numeric, balance numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with tx as (
    select lower(btrim(t.account)) as k,
           mode() within group (order by btrim(t.account)) as shown,
           count(*)::int as n, coalesce(sum(t.amount), 0) as total
      from public.transactions t
     where t.user_id = auth.uid() and t.is_archived = false and btrim(coalesce(t.account, '')) <> ''
     group by 1
  ), ma as (
    select lower(btrim(m.name)) as k, btrim(m.name) as shown, m.starting_balance
      from public.money_accounts m where m.user_id = auth.uid()
  )
  select coalesce(tx.shown, ma.shown), coalesce(tx.n, 0), coalesce(ma.starting_balance, 0),
         coalesce(ma.starting_balance, 0) + coalesce(tx.total, 0)
    from tx full outer join ma on ma.k = tx.k
   order by coalesce(tx.n, 0) desc, 1;
$$;
revoke all on function public.my_account_balances() from public, anon;
grant execute on function public.my_account_balances() to authenticated;

-- Set what an account held before its first entry here.
create or replace function public.set_account_starting_balance(p_account text, p_amount numeric)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_name text := btrim(coalesce(p_account, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if v_name = '' then raise exception 'an account needs a name'; end if;
  if p_amount is null then raise exception 'a starting balance needs an amount'; end if;
  update public.money_accounts set starting_balance = p_amount, updated_at = now()
   where user_id = auth.uid() and lower(btrim(name)) = lower(v_name);
  if not found then
    insert into public.money_accounts (user_id, name, starting_balance) values (auth.uid(), v_name, p_amount);
  end if;
end $$;
revoke all on function public.set_account_starting_balance(text, numeric) from public, anon;
grant execute on function public.set_account_starting_balance(text, numeric) to authenticated;
