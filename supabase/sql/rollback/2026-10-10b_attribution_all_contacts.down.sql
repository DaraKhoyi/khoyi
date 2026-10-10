-- Rollback for 2026-10-10b (run by hand, only with Dara's yes).
-- Removes commitment attribution and restores the 9 Oct history recorder.
-- Does not drop agents_auth_user_id_uniq (that index belongs to 2026-10-08e).
begin;
set local lock_timeout = '5s';
lock table public.contacts, public.contact_notes, public.contact_interactions,
           public.tasks, public.commitments, public.contact_activity
  in access exclusive mode;

drop trigger if exists commitments_log_activity on public.commitments;
drop trigger if exists commitments_stamp_author on public.commitments;
drop trigger if exists commitments_guard_link on public.commitments;

drop function if exists public.log_commitment_activity();
drop function if exists public.stamp_commitment_author();

delete from public.contact_activity
 where action in ('commitment_recorded', 'commitment_decided');

alter table public.contact_activity drop constraint if exists contact_activity_action_chk;
alter table public.contact_activity add constraint contact_activity_action_chk check (action in (
  'note','call','text','email','meeting','interaction_edited',
  'task_created','task_edited','task_completed','task_reopened',
  'status_changed','stage_changed','field_edited'
));

alter table public.commitments
  drop column if exists decided_by_name,
  drop column if exists decided_by,
  drop column if exists edited_at,
  drop column if exists edited_by_name,
  drop column if exists edited_by,
  drop column if exists author_name,
  drop column if exists author_id;

-- Six-argument recorder from 2026-10-09d. Created before the seven-argument
-- one is dropped so the loggers below can be pointed back at it.
create or replace function public.record_contact_activity(
  p_contact uuid,
  p_actor uuid,
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_summary text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := p_actor;
  v_name text;
begin
  if pg_trigger_depth() = 0 and auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_contact is null or p_action is null then return; end if;
  if auth.uid() is not null then
    v_actor := auth.uid();
  end if;
  if v_actor is not null then
    v_name := public.contact_actor_name(v_actor);
  end if;
  insert into public.contact_activity
    (contact_id, actor_id, actor_name, action, subject_table, subject_id, summary)
  values
    (p_contact, v_actor, v_name, p_action, p_subject_table, p_subject_id, left(p_summary, 200));
end $$;

create or replace function public.log_interaction_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_summary text;
  v_content boolean;
begin
  if NEW.contact_id is null then return null; end if;
  v_action := case
    when coalesce(NEW.channel, '') = 'email' or NEW.kind = 'email' then 'email'
    when NEW.kind = 'call' or NEW.channel in ('phone', 'call') then 'call'
    when NEW.kind = 'text' or NEW.channel = 'text' then 'text'
    when NEW.kind = 'meeting' or NEW.channel = 'in_person' then 'meeting'
    else 'note'
  end;
  if TG_OP = 'UPDATE' then
    v_content := NEW.body is distinct from OLD.body
      or NEW.brief is distinct from OLD.brief
      or NEW.kind is distinct from OLD.kind
      or NEW.channel is distinct from OLD.channel
      or NEW.direction is distinct from OLD.direction
      or NEW.occurred_at is distinct from OLD.occurred_at
      or NEW.duration_minutes is distinct from OLD.duration_minutes
      or NEW.follow_up_at is distinct from OLD.follow_up_at
      or NEW.tags is distinct from OLD.tags
      or NEW.mentions is distinct from OLD.mentions;
    if not v_content or auth.uid() is null then return null; end if;
    if v_action = 'email' then
      v_summary := 'Edited an email log';
    else
      v_action := 'interaction_edited';
      v_summary := 'Edited an entry';
    end if;
  else
    v_summary := case v_action
      when 'email' then 'Logged an email'
      when 'call' then 'Logged a call'
      when 'text' then 'Logged a text'
      when 'meeting' then 'Logged a meeting'
      else 'Added a note'
    end;
  end if;
  perform public.record_contact_activity(NEW.contact_id, NEW.author_id, v_action, 'contact_interactions', NEW.id, v_summary);
  return null;
end $$;

create or replace function public.log_note_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.contact_id is null then return null; end if;
  if TG_OP = 'UPDATE' then
    if NEW.body is not distinct from OLD.body or auth.uid() is null then return null; end if;
    perform public.record_contact_activity(NEW.contact_id, NEW.author_id, 'note', 'contact_notes', NEW.id, 'Edited a note');
  else
    perform public.record_contact_activity(NEW.contact_id, NEW.author_id, 'note', 'contact_notes', NEW.id, 'Added a note');
  end if;
  return null;
end $$;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done boolean;
  v_was boolean;
  v_title text;
begin
  if NEW.contact_id is null then return null; end if;
  v_title := left(coalesce(nullif(btrim(NEW.title), ''), 'Untitled'), 120);
  v_done := coalesce(NEW.completed, false) or coalesce(NEW.status, '') = 'done';
  if TG_OP = 'INSERT' then
    perform public.record_contact_activity(NEW.contact_id, NEW.author_id, 'task_created', 'tasks', NEW.id, 'Created a task: ' || v_title);
    if v_done then
      perform public.record_contact_activity(NEW.contact_id, NEW.author_id, 'task_completed', 'tasks', NEW.id, 'Completed a task: ' || v_title);
    end if;
    return null;
  end if;
  if auth.uid() is null
     and NEW.title is not distinct from OLD.title
     and NEW.notes is not distinct from OLD.notes
     and NEW.due_date is not distinct from OLD.due_date
     and NEW.priority is not distinct from OLD.priority
     and NEW.completed is not distinct from OLD.completed
     and NEW.status is not distinct from OLD.status
     and NEW.contact_id is not distinct from OLD.contact_id then
    return null;
  end if;
  if OLD.contact_id is null then
    perform public.record_contact_activity(NEW.contact_id, NEW.author_id, 'task_created', 'tasks', NEW.id, 'Created a task: ' || v_title);
  end if;
  v_was := coalesce(OLD.completed, false) or coalesce(OLD.status, '') = 'done';
  if v_done and not v_was then
    perform public.record_contact_activity(NEW.contact_id, coalesce(auth.uid(), NEW.author_id), 'task_completed', 'tasks', NEW.id, 'Completed a task: ' || v_title);
  elsif (not v_done) and v_was and auth.uid() is not null then
    perform public.record_contact_activity(NEW.contact_id, auth.uid(), 'task_reopened', 'tasks', NEW.id, 'Reopened a task: ' || v_title);
  elsif auth.uid() is not null and (
      NEW.title is distinct from OLD.title
      or NEW.notes is distinct from OLD.notes
      or NEW.due_date is distinct from OLD.due_date
      or NEW.priority is distinct from OLD.priority
    ) then
    perform public.record_contact_activity(NEW.contact_id, auth.uid(), 'task_edited', 'tasks', NEW.id, 'Edited a task: ' || v_title);
  end if;
  return null;
end $$;

drop function if exists public.record_contact_activity(uuid, uuid, text, text, uuid, text, text);

revoke all on function public.record_contact_activity(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.log_interaction_activity() from public, anon, authenticated;
revoke all on function public.log_note_activity() from public, anon, authenticated;
revoke all on function public.log_task_activity() from public, anon, authenticated;

comment on table public.contact_activity is
  'What happened on a contact, and who did it. Readable only when the contact itself is readable.';

commit;
