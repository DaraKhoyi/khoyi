-- Rollback for 2026-10-08d (run by hand in the SQL editor, only with Dara's yes).
-- Restores team-wide email timelines on shared contacts.
begin;
drop policy if exists email_interactions_owner_only on public.contact_interactions;
do $f$
declare d text;
begin
  d := pg_get_functiondef('public.contact_thread_emails(uuid,integer)'::regprocedure);
  if position('own mailbox only (2026-10-08d)' in d) = 0 then return; end if;
  d := replace(d, E'-- own mailbox only (2026-10-08d): Google data is never shown to teammates\n    select auth.uid() uid',
               E'select tm.auth_user_id uid from team_members tm\n     where v_team is not null and is_team_member(v_team) and tm.team_id = v_team\n    union\n    select auth.uid()');
  execute d;
end $f$;
commit;
