-- =====================================================================
-- Security Batch 1 (8 Oct 2026) — "Act as" sessions expire and are revocable.
-- H7 / L1. Works together with the impersonate edge function in this batch:
--   * impersonation_log.session_id  — the auth session impersonate minted
--     (same column + index name as PR #5's 08c, so both can apply in any order).
--   * impersonation_log.expires_at  — 30 minutes after start.
--   * revoke_support_session(uuid)  — service_role only; deletes that auth
--     session (refresh tokens cascade). Same signature/behaviour as PR #5.
--   * expire_support_sessions()     — cron every 5 min: revokes any act-as
--     session past expires_at and stamps ended_at.
--   * impersonation_log writes: revoked from anon/authenticated (only the edge
--     function, as service role, writes it). Reads unchanged (imp_read).
-- ROLLBACK: supabase/sql/rollback/2026-10-08h_batch1_act_as_expiry.down.sql
-- =====================================================================

alter table public.impersonation_log add column if not exists session_id uuid;
alter table public.impersonation_log add column if not exists expires_at timestamptz;
create index if not exists impersonation_log_session_id_idx
  on public.impersonation_log (session_id) where session_id is not null;
create index if not exists impersonation_log_open_idx
  on public.impersonation_log (expires_at) where ended_at is null;

revoke insert, update, delete, truncate on public.impersonation_log from anon, authenticated;

create or replace function public.revoke_support_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null then return false; end if;
  -- Only sessions that impersonate created. Never an agent's own sign-in.
  if not exists (select 1 from public.impersonation_log where session_id = p_session_id) then
    return false;
  end if;
  delete from auth.sessions where id = p_session_id;  -- refresh tokens cascade
  return true;
end $$;
revoke all on function public.revoke_support_session(uuid) from public, anon, authenticated;
grant execute on function public.revoke_support_session(uuid) to service_role;

create or replace function public.expire_support_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; n int := 0;
begin
  for r in
    select id, session_id from public.impersonation_log
    where ended_at is null and expires_at is not null and expires_at < now()
  loop
    if r.session_id is not null then
      delete from auth.sessions where id = r.session_id;
    end if;
    update public.impersonation_log set ended_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_support_sessions() from public, anon, authenticated;
grant execute on function public.expire_support_sessions() to service_role;

do $c$
begin
  if exists (select 1 from cron.job where jobname = 'act-as-expire-5min') then
    perform cron.unschedule('act-as-expire-5min');
  end if;
  perform cron.schedule('act-as-expire-5min', '*/5 * * * *', 'select public.expire_support_sessions();');
end $c$;
