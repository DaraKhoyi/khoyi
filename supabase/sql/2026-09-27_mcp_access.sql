-- 2026-09-27 — PrismOS connector for Claude (prism-mcp): who may use it.
--
-- Sign-in is Supabase's own OAuth 2.1 server (enabled 27 Sep: Authentication >
-- OAuth Server, authorization path /oauth/consent, dynamic registration on).
-- Claude registers itself, the person signs in to PrismOS and approves on
-- darasapp.com/oauth/consent, and Claude receives a token that IS that person's
-- PrismOS session — so every query prism-mcp makes runs under their own
-- row-level security. An agent's Claude sees exactly what the agent sees.
--
-- This table is the second gate: while the connector is new, only the people
-- listed here may use it at all (Dara first, for a week, then the agents).

begin;
create table if not exists public.mcp_access (
  user_id   uuid primary key,
  note      text,
  added_at  timestamptz not null default now()
);
alter table public.mcp_access enable row level security;
revoke all on public.mcp_access from public, anon, authenticated;

create or replace function public.mcp_access_allowed()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from mcp_access where user_id = auth.uid()) $$;
revoke all on function public.mcp_access_allowed() from public, anon;
grant execute on function public.mcp_access_allowed() to authenticated;

insert into public.mcp_access (user_id, note) values
  ('ad06bbc1-a1cb-4716-84d3-36f426ea3187', 'Dara — first user, from 27 Sep 2026')
on conflict (user_id) do nothing;
commit;

-- Usage log for the connector: who called which tool, did it work, how long.
-- Never the arguments or the results (those are client data).
create table if not exists public.mcp_calls (
  id         bigserial primary key,
  user_id    uuid not null,
  client_id  text,
  tool       text not null,
  ok         boolean not null,
  error      text,
  ms         int,
  at         timestamptz not null default now()
);
alter table public.mcp_calls enable row level security;
revoke all on public.mcp_calls from public, anon, authenticated;
