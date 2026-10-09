-- =====================================================================
-- "Act as user" never shows the agent's Google data (8 Oct 2026)
--
-- Google OAuth verification (Limited Use) and our own setup screen ("Your
-- broker cannot read your mail") both require that a broker admin or team
-- leader using "Act as user" cannot see the agent's Gmail, Google Calendar or
-- Google Contacts. Before this, impersonate minted a full session for the
-- agent and every row was visible. Approved by Dara 8 Oct 2026, 12:11 PM ET.
--
-- HOW A SUPPORT SESSION IS RECOGNISED
--   impersonate now writes the minted session's id (the `session_id` claim in
--   every Supabase access token; it survives token refresh) into
--   impersonation_log.session_id before it hands the token out. A request is a
--   support session when its JWT's session_id is in that log. The agent's own
--   sign-ins have fresh session ids that never appear there.
--
-- WHAT THIS FILE DOES (idempotent)
--   1. impersonation_log.session_id (+ index).
--   2. public.is_support_session(): true for a support session. SECURITY
--      DEFINER so the policies can read the log; reveals nothing but a boolean
--      about the caller's own session.
--   3. RESTRICTIVE policies (ANDed with the existing "own rows" policies, so
--      nothing anyone could see before becomes visible): during a support
--      session, rows of the Google-sourced tables are invisible and cannot be
--      written. Outside a support session the policies are always true.
--        * Gmail: email_messages_all (and the email_messages view), email_threads,
--          email_attachments, email_triage, email_review_items, email_known_senders,
--          email_sender_stats, email_intel_runs, email_bounces, gmail_labels,
--          email_aliases, scheduled_emails, email_tracking
--        * Google Calendar: events that came from / sync to Google
--          (google_event_id or google_calendar_id set); calendar_sync_state
--        * Google Contacts: google_contacts (and google_contacts_view),
--          google_contacts_sync
--        * Email-derived timeline rows: contact_interactions where channel='email'
--   4. Five SECURITY DEFINER functions that hand Google data straight to the
--      browser get a one-line guard at the top: contact_thread_emails,
--      uncarded_correspondents, lead_concierge_pending (return []),
--      import_google_contact, link_google_contact (refuse).
--   5. public.revoke_support_session(uuid): service_role only; deletes the
--      support session so its refresh token dies when the supervisor leaves.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-08c_act_as_hides_google_data.down.sql
-- (drops the policies and the guard lines; keeps the column, which is harmless).
-- =====================================================================
begin;
-- Fail fast instead of queueing behind live Gmail/sync traffic (a 9 Oct dry run
-- deadlocked on a busy table). A timeout rolls the whole file back; re-run apply-sql.
set local lock_timeout = '5s';

alter table public.impersonation_log add column if not exists session_id uuid;
create index if not exists impersonation_log_session_id_idx
  on public.impersonation_log (session_id) where session_id is not null;

create or replace function public.is_support_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (
      select 1 from public.impersonation_log l
      where l.session_id = (auth.jwt() ->> 'session_id')::uuid
    )
    else false
  end;
$$;
revoke all on function public.is_support_session() from public, anon;
grant execute on function public.is_support_session() to authenticated, service_role;
comment on function public.is_support_session() is
  'True when the caller''s JWT session_id was minted by "Act as user" (impersonation_log.session_id). Used by RESTRICTIVE RLS policies to hide Google data from support sessions.';

-- 3. Restrictive policies --------------------------------------------------
do $p$
declare
  t text;
  whole_tables text[] := array[
    'email_messages_all','email_threads','email_attachments','email_triage',
    'email_review_items','email_known_senders','email_sender_stats','email_intel_runs',
    'email_bounces','gmail_labels','email_aliases','scheduled_emails','email_tracking',
    'calendar_sync_state','google_contacts','google_contacts_sync'];
begin
  foreach t in array whole_tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip %: table not found', t;
      continue;
    end if;
    execute format('drop policy if exists act_as_hides_google on public.%I', t);
    execute format(
      'create policy act_as_hides_google on public.%I as restrictive for all to authenticated
         using (not (select public.is_support_session()))
         with check (not (select public.is_support_session()))', t);
  end loop;
end $p$;

drop policy if exists act_as_hides_google on public.events;
create policy act_as_hides_google on public.events as restrictive for all to authenticated
  using (not (select public.is_support_session()) or (google_event_id is null and google_calendar_id is null))
  with check (not (select public.is_support_session()) or (google_event_id is null and google_calendar_id is null));

drop policy if exists act_as_hides_google on public.contact_interactions;
create policy act_as_hides_google on public.contact_interactions as restrictive for all to authenticated
  using (not (select public.is_support_session()) or coalesce(channel, '') <> 'email')
  with check (not (select public.is_support_session()) or coalesce(channel, '') <> 'email');

-- 4. Guards inside definer functions that bypass RLS ------------------------
do $g$
declare
  r record;
  d text;
  n int;
  guard text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('contact_thread_emails','uncarded_correspondents','lead_concierge_pending',
                         'import_google_contact','link_google_contact')
  loop
    d := pg_get_functiondef(r.oid);
    if position('is_support_session' in d) > 0 then continue; end if;  -- already guarded
    select count(*) into n from regexp_matches(d, '\mbegin\M', 'gi');
    if n <> 1 then
      raise exception '%: expected exactly one BEGIN, found %; not rewriting', r.proname, n;
    end if;
    guard := case when r.proname in ('import_google_contact','link_google_contact')
      then E'begin\n  if public.is_support_session() then return jsonb_build_object(''ok'', false, ''error'', ''Google contacts are private to the agent and hidden during support sessions.''); end if;'
      else E'begin\n  if public.is_support_session() then return ''[]''::jsonb; end if;'
    end;
    d := regexp_replace(d, '\mbegin\M', guard, 'i');
    execute d;
  end loop;
end $g$;

-- 5. Revoke a support session when the supervisor leaves -------------------
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

commit;
