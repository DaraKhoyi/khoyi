-- Rollback for 2026-10-09d (run by hand, only with Dara's yes).
-- Drops the attribution history and the columns that hold it.
begin;
set local lock_timeout = '5s';
lock table public.contacts, public.contact_notes, public.contact_interactions, public.tasks in access exclusive mode;

drop trigger if exists contacts_log_activity on public.contacts;
drop trigger if exists tasks_log_activity on public.tasks;
drop trigger if exists contact_notes_log_activity on public.contact_notes;
drop trigger if exists contact_interactions_log_activity on public.contact_interactions;
drop trigger if exists tasks_stamp_author on public.tasks;
drop trigger if exists contact_notes_stamp_author on public.contact_notes;
drop trigger if exists contact_interactions_stamp_author on public.contact_interactions;
drop trigger if exists tasks_guard_link on public.tasks;
drop trigger if exists contact_notes_guard_link on public.contact_notes;
drop trigger if exists contact_interactions_guard_link on public.contact_interactions;

drop function if exists public.log_contact_changes();
drop function if exists public.log_task_activity();
drop function if exists public.log_note_activity();
drop function if exists public.log_interaction_activity();
drop function if exists public.stamp_contact_author();
drop function if exists public.guard_shared_contact_link();
drop function if exists public.record_contact_activity(uuid, uuid, text, text, uuid, text);
drop function if exists public.contact_actor_name(uuid);

drop policy if exists tasks_on_visible_contact on public.tasks;
drop policy if exists contact_notes_on_visible_contact on public.contact_notes;
drop policy if exists contact_interactions_on_visible_contact on public.contact_interactions;
drop policy if exists tasks_visible_with_contact on public.tasks;
drop policy if exists contact_notes_visible_with_contact on public.contact_notes;
drop policy if exists contact_interactions_visible_with_contact on public.contact_interactions;

drop table if exists public.contact_activity;

alter table public.tasks
  drop column if exists completed_by_name,
  drop column if exists completed_by,
  drop column if exists edited_at,
  drop column if exists edited_by_name,
  drop column if exists edited_by,
  drop column if exists author_name,
  drop column if exists author_id;

alter table public.contact_notes
  drop column if exists edited_at,
  drop column if exists edited_by_name,
  drop column if exists edited_by,
  drop column if exists author_name,
  drop column if exists author_id;

alter table public.contact_interactions
  drop column if exists edited_at,
  drop column if exists edited_by_name,
  drop column if exists edited_by,
  drop column if exists author_name,
  drop column if exists author_id;

commit;
