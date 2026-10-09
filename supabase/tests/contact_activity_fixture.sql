-- Blank database that can take 2026-10-09d. Not applied to production.
-- The live database already has these tables, roles, and auth.uid().

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
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create or replace function public.is_support_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('test.support_session', true), '') = 'on'
$$;

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  auth_user_id uuid,
  name text,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key,
  display_name text
);

create table public.team_members (
  team_id uuid not null,
  auth_user_id uuid not null,
  role text not null default 'member',
  primary key (team_id, auth_user_id)
);

create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
     where tm.team_id = p_team and tm.auth_user_id = auth.uid()
  )
$$;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  type text not null default 'lead',
  email text,
  phone text,
  company text,
  role text,
  notes text,
  tags text[] default '{}',
  status text default 'active',
  priority text default 'normal',
  profession text,
  phones jsonb not null default '[]'::jsonb,
  emails jsonb not null default '[]'::jsonb,
  pronouns text,
  marketing_opt_out boolean not null default false,
  spoken_language text,
  pipeline_stage text,
  recruiting_stage text,
  shared_scope text not null default 'none',
  team_id uuid,
  company_lead boolean not null default false,
  team_lead_team_id uuid,
  home_address text,
  home_city text,
  home_state text,
  home_zip text,
  business_address text,
  business_city text,
  business_state text,
  business_zip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  contact_id uuid references public.contacts(id) on delete cascade,
  channel text,
  direction text,
  occurred_at timestamptz not null default now(),
  brief text,
  created_at timestamptz not null default now(),
  kind text default 'note',
  body text,
  duration_minutes integer,
  follow_up_at timestamptz,
  pinned boolean not null default false,
  updated_at timestamptz not null default now(),
  entity_type text default 'contact',
  entity_id uuid,
  mentions uuid[] not null default '{}',
  tags text[] not null default '{}'
);

create table public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  notes text,
  priority text default 'medium',
  due_date date,
  completed boolean default false,
  status text default 'todo',
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.contacts enable row level security;
alter table public.contact_interactions enable row level security;
alter table public.contact_notes enable row level security;
alter table public.tasks enable row level security;

grant select, insert, update, delete on
  public.contacts, public.contact_interactions, public.contact_notes, public.tasks, public.team_members
  to authenticated;

-- Names are copied onto the activity row. The signed-in role does not get
-- the agents or settings tables.
revoke all on public.agents, public.user_settings from authenticated, anon;
