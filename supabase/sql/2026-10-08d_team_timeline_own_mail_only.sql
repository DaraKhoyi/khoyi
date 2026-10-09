-- =====================================================================
-- A contact's email timeline shows only YOUR OWN mailbox (8 Oct 2026)
--
-- FOUND during the Google verification review (Dara approved "go with all 6",
-- 12:11 PM ET, including making "Your broker cannot read your mail" true).
-- This is a SEPARATE FILE so it can be dropped from the PR on its own if Dara
-- prefers to keep shared team timelines and disclose them instead.
--
-- Before: contact_thread_emails() returned, for a team-shared contact, the
-- messages (up to 20,000 characters of body each) from EVERY team member's
-- synced Gmail, and contact_interactions_shared_read let team members read
-- the email-channel interaction rows (subject/brief) written from someone
-- else's mailbox. That is one agent's Google data shown to other people:
-- outside Google's Limited Use rules and contrary to the setup screen.
--
-- After:
--   1. contact_thread_emails() reads only the caller's own mailbox. Team
--      members still see the shared contact, its notes, calls and texts.
--   2. A RESTRICTIVE policy keeps email-channel contact_interactions visible
--      only to the mailbox owner. Non-email interactions are unchanged.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-08d_team_timeline_own_mail_only.down.sql
-- =====================================================================
begin;
-- Fail fast instead of queueing behind live Gmail/sync traffic (a 9 Oct dry run
-- deadlocked on a busy table). A timeout rolls the whole file back; re-run apply-sql.
set local lock_timeout = '5s';

do $f$
declare
  d text;
  old_cte text := E'select tm.auth_user_id uid from team_members tm\n     where v_team is not null and is_team_member(v_team) and tm.team_id = v_team\n    union\n    select auth.uid()';
begin
  d := pg_get_functiondef('public.contact_thread_emails(uuid,integer)'::regprocedure);
  if position('own mailbox only (2026-10-08d)' in d) > 0 then
    return; -- already applied
  end if;
  if position(old_cte in d) = 0 then
    raise exception 'contact_thread_emails: team CTE not found as expected; not rewriting';
  end if;
  d := replace(d, old_cte, E'-- own mailbox only (2026-10-08d): Google data is never shown to teammates\n    select auth.uid() uid');
  execute d;
end $f$;

drop policy if exists email_interactions_owner_only on public.contact_interactions;
create policy email_interactions_owner_only on public.contact_interactions
  as restrictive for select to authenticated
  using (coalesce(channel, '') <> 'email' or user_id = (select auth.uid()));

commit;
