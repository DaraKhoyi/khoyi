-- Blank database for the lead-verdict check. Not applied to production.

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.contacts (
  id uuid primary key,
  company_lead boolean not null default false
);

create table public.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  contact_id uuid,
  lead_email text,
  decision text not null default 'would_send',
  verdict text,
  verdict_at timestamptz,
  verdict_by uuid
);

create table public.lead_sender_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  sender text not null,
  kind text not null,
  note text
);
create unique index lsr_one_per_sender on public.lead_sender_rules (user_id, lower(sender), kind);

create table public.lead_concierge (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  lead_email text,
  status text not null default 'pending'
);

-- Staff in this fixture is one fixed login. Production uses the real check.
create or replace function public.is_brokerage_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = '77777777-7777-7777-7777-777777777777'::uuid
$$;

grant execute on function public.is_brokerage_staff() to authenticated;

grant select, insert, update, delete on
  public.contacts, public.lead_notifications, public.lead_sender_rules, public.lead_concierge
  to authenticated;
