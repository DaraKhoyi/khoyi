-- =====================================================================
-- Attribution on every contact (10 Oct 2026)
--
-- Who did it is recorded on every contact, shared or not. Sharing later
-- reveals history that was already written. It does not start a new record.
--
-- This file does not add a way to read a contact. Notes, tasks, calls,
-- texts, and emails stay on the rules from 9 Oct. Email logs stay with the
-- mailbox owner. A support session still cannot see a private client.
-- A broker still cannot read a private client's notes, tasks, or history.
--
-- Commitments are included because accepting, finishing, or setting one
-- aside is a completion. The commitment row itself stays with its owner.
-- The timeline line is history on the contact, so it follows the contact.
--
-- A name is looked up once per write, through the existing index on
-- agents.auth_user_id, and then copied onto the row. A later write that
-- already has the name does not look it up again. Pinning a row, or a
-- server job touching a clock column, does not look a name up at all.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-10b_attribution_all_contacts.down.sql
--           (by hand only)
-- =====================================================================
begin;
set local lock_timeout = '5s';
lock table public.contacts, public.contact_notes, public.contact_interactions,
           public.tasks, public.commitments, public.contact_activity
  in access exclusive mode;

-- The name lookup is one index read. Production already has this index
-- (2026-10-08e). Created here so a database that does not is not scanning.
create unique index if not exists agents_auth_user_id_uniq
  on public.agents (auth_user_id) where auth_user_id is not null;

-- A. One lookup, then reuse the name ---------------------------------------
create or replace function public.contact_actor_name(p_actor uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if pg_trigger_depth() = 0 and auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_actor is null then return null; end if;
  select left(btrim(a.name), 80) into v_name
    from public.agents a
   where a.auth_user_id = p_actor
     and nullif(btrim(a.name), '') is not null
   limit 1;
  if v_name is not null then return v_name; end if;
  select left(btrim(s.display_name), 80) into v_name
    from public.user_settings s
   where s.user_id = p_actor
     and nullif(btrim(s.display_name), '') is not null
     and position('@' in s.display_name) = 0
   limit 1;
  return v_name;
end $$;

-- p_actor_name is the name already copied onto the row. When it belongs to
-- the actor being stored, it is reused and agents is not read again.
drop function if exists public.record_contact_activity(uuid, uuid, text, text, uuid, text);
drop function if exists public.record_contact_activity(uuid, uuid, text, text, uuid, text, text);

create function public.record_contact_activity(
  p_contact uuid,
  p_actor uuid,
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_summary text,
  p_actor_name text default null
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
  v_name := nullif(left(btrim(coalesce(p_actor_name, '')), 80), '');
  if v_name is null or p_actor is distinct from v_actor then
    if v_actor is not null then
      v_name := public.contact_actor_name(v_actor);
    else
      v_name := null;
    end if;
  end if;
  insert into public.contact_activity
    (contact_id, actor_id, actor_name, action, subject_table, subject_id, summary)
  values
    (p_contact, v_actor, v_name, p_action, p_subject_table, p_subject_id, left(p_summary, 200));
end $$;

create or replace function public.stamp_contact_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content boolean := false;
  v_done boolean := false;
  v_was boolean := false;
  v_name text;
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null then
      NEW.user_id := auth.uid();
      NEW.author_id := auth.uid();
    else
      NEW.author_id := NEW.user_id;
    end if;
    v_name := public.contact_actor_name(NEW.author_id);
    NEW.author_name := v_name;
    NEW.edited_by := null;
    NEW.edited_by_name := null;
    NEW.edited_at := null;
    if TG_TABLE_NAME = 'tasks' then
      v_done := coalesce(NEW.completed, false) or NEW.status = 'done';
      if v_done and auth.uid() is not null then
        NEW.completed_by := auth.uid();
        NEW.completed_by_name := v_name;
      else
        NEW.completed_by := null;
        NEW.completed_by_name := null;
      end if;
    end if;
    return NEW;
  end if;

  if auth.uid() is not null then
    NEW.author_id := OLD.author_id;
    NEW.author_name := OLD.author_name;
  else
    if OLD.author_id is not null then NEW.author_id := OLD.author_id; end if;
    if OLD.author_name is not null then NEW.author_name := OLD.author_name; end if;
  end if;

  if TG_TABLE_NAME = 'contact_interactions' then
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
  elsif TG_TABLE_NAME = 'contact_notes' then
    v_content := NEW.body is distinct from OLD.body;
  elsif TG_TABLE_NAME = 'tasks' then
    v_content := NEW.title is distinct from OLD.title
      or NEW.notes is distinct from OLD.notes
      or NEW.due_date is distinct from OLD.due_date
      or NEW.priority is distinct from OLD.priority;
  end if;

  if v_content and auth.uid() is not null then
    v_name := public.contact_actor_name(auth.uid());
    NEW.edited_by := auth.uid();
    NEW.edited_by_name := v_name;
    NEW.edited_at := now();
  else
    NEW.edited_by := OLD.edited_by;
    NEW.edited_by_name := OLD.edited_by_name;
    NEW.edited_at := OLD.edited_at;
  end if;

  if TG_TABLE_NAME = 'tasks' then
    v_done := coalesce(NEW.completed, false) or coalesce(NEW.status, '') = 'done';
    v_was := coalesce(OLD.completed, false) or coalesce(OLD.status, '') = 'done';
    if v_done and not v_was then
      if auth.uid() is not null then
        NEW.completed_by := auth.uid();
        if v_name is null then
          v_name := public.contact_actor_name(auth.uid());
        end if;
        NEW.completed_by_name := v_name;
      else
        NEW.completed_by := OLD.completed_by;
        NEW.completed_by_name := OLD.completed_by_name;
      end if;
    elsif (not v_done) and v_was then
      NEW.completed_by := null;
      NEW.completed_by_name := null;
    else
      NEW.completed_by := OLD.completed_by;
      NEW.completed_by_name := OLD.completed_by_name;
    end if;
  end if;

  return NEW;
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
    perform public.record_contact_activity(
      NEW.contact_id, auth.uid(), v_action, 'contact_interactions', NEW.id, v_summary, NEW.edited_by_name);
  else
    v_summary := case v_action
      when 'email' then 'Logged an email'
      when 'call' then 'Logged a call'
      when 'text' then 'Logged a text'
      when 'meeting' then 'Logged a meeting'
      else 'Added a note'
    end;
    perform public.record_contact_activity(
      NEW.contact_id, NEW.author_id, v_action, 'contact_interactions', NEW.id, v_summary, NEW.author_name);
  end if;
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
    perform public.record_contact_activity(
      NEW.contact_id, auth.uid(), 'note', 'contact_notes', NEW.id, 'Edited a note', NEW.edited_by_name);
  else
    perform public.record_contact_activity(
      NEW.contact_id, NEW.author_id, 'note', 'contact_notes', NEW.id, 'Added a note', NEW.author_name);
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
    perform public.record_contact_activity(
      NEW.contact_id, NEW.author_id, 'task_created', 'tasks', NEW.id, 'Created a task: ' || v_title, NEW.author_name);
    if v_done then
      perform public.record_contact_activity(
        NEW.contact_id, coalesce(auth.uid(), NEW.author_id), 'task_completed', 'tasks', NEW.id,
        'Completed a task: ' || v_title,
        case when auth.uid() is not null then NEW.completed_by_name else NEW.author_name end);
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
    perform public.record_contact_activity(
      NEW.contact_id, NEW.author_id, 'task_created', 'tasks', NEW.id, 'Created a task: ' || v_title, NEW.author_name);
  end if;
  v_was := coalesce(OLD.completed, false) or coalesce(OLD.status, '') = 'done';
  if v_done and not v_was then
    perform public.record_contact_activity(
      NEW.contact_id, coalesce(auth.uid(), NEW.author_id), 'task_completed', 'tasks', NEW.id,
      'Completed a task: ' || v_title,
      case when auth.uid() is not null then NEW.completed_by_name else NEW.author_name end);
  elsif (not v_done) and v_was and auth.uid() is not null then
    perform public.record_contact_activity(
      NEW.contact_id, auth.uid(), 'task_reopened', 'tasks', NEW.id, 'Reopened a task: ' || v_title, NEW.edited_by_name);
  elsif auth.uid() is not null and (
      NEW.title is distinct from OLD.title
      or NEW.notes is distinct from OLD.notes
      or NEW.due_date is distinct from OLD.due_date
      or NEW.priority is distinct from OLD.priority
    ) then
    perform public.record_contact_activity(
      NEW.contact_id, auth.uid(), 'task_edited', 'tasks', NEW.id, 'Edited a task: ' || v_title, NEW.edited_by_name);
  end if;
  return null;
end $$;

-- B. Commitments ------------------------------------------------------------
-- Same author rules. user_id can still move when a lead is reclaimed.
-- decided_by is set only when a signed-in person changes the status.
alter table public.commitments
  add column if not exists author_id uuid default auth.uid(),
  add column if not exists author_name text,
  add column if not exists edited_by uuid,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz,
  add column if not exists decided_by uuid,
  add column if not exists decided_by_name text;

comment on column public.commitments.author_id is
  'Who the commitment was recorded for. Set from the signed-in user, or from the row owner when a server job writes it. Never replaced.';
comment on column public.commitments.decided_by is
  'Who accepted, finished, or set aside the commitment. Blank when a server job changed the status.';

alter table public.contact_activity drop constraint if exists contact_activity_action_chk;
alter table public.contact_activity add constraint contact_activity_action_chk check (action in (
  'note','call','text','email','meeting','interaction_edited',
  'task_created','task_edited','task_completed','task_reopened',
  'status_changed','stage_changed','field_edited',
  'commitment_recorded','commitment_decided'
));

create or replace function public.stamp_commitment_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content boolean := false;
  v_name text;
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null then
      NEW.user_id := auth.uid();
      NEW.author_id := auth.uid();
    else
      NEW.author_id := NEW.user_id;
    end if;
    NEW.author_name := public.contact_actor_name(NEW.author_id);
    NEW.edited_by := null;
    NEW.edited_by_name := null;
    NEW.edited_at := null;
    NEW.decided_by := null;
    NEW.decided_by_name := null;
    return NEW;
  end if;

  if auth.uid() is not null then
    NEW.author_id := OLD.author_id;
    NEW.author_name := OLD.author_name;
  else
    if OLD.author_id is not null then NEW.author_id := OLD.author_id; end if;
    if OLD.author_name is not null then NEW.author_name := OLD.author_name; end if;
  end if;

  -- A clock column (nudge, expiry warning) is not an edit and not a decision.
  if auth.uid() is null then
    NEW.edited_by := OLD.edited_by;
    NEW.edited_by_name := OLD.edited_by_name;
    NEW.edited_at := OLD.edited_at;
    NEW.decided_by := OLD.decided_by;
    NEW.decided_by_name := OLD.decided_by_name;
    return NEW;
  end if;

  v_content := NEW.title is distinct from OLD.title
    or NEW.next_step is distinct from OLD.next_step
    or NEW.due_date is distinct from OLD.due_date
    or NEW.quote is distinct from OLD.quote;
  if v_content then
    v_name := public.contact_actor_name(auth.uid());
    NEW.edited_by := auth.uid();
    NEW.edited_by_name := v_name;
    NEW.edited_at := now();
  else
    NEW.edited_by := OLD.edited_by;
    NEW.edited_by_name := OLD.edited_by_name;
    NEW.edited_at := OLD.edited_at;
  end if;

  if NEW.status is distinct from OLD.status then
    if v_name is null then
      v_name := public.contact_actor_name(auth.uid());
    end if;
    NEW.decided_by := auth.uid();
    NEW.decided_by_name := v_name;
  else
    NEW.decided_by := OLD.decided_by;
    NEW.decided_by_name := OLD.decided_by_name;
  end if;
  return NEW;
end $$;

create or replace function public.log_commitment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_summary text;
begin
  if NEW.contact_id is null then return null; end if;
  v_title := left(coalesce(nullif(btrim(NEW.title), ''), 'Untitled'), 120);
  if TG_OP = 'INSERT' or OLD.contact_id is null then
    perform public.record_contact_activity(
      NEW.contact_id, NEW.author_id, 'commitment_recorded', 'commitments', NEW.id,
      'Recorded a commitment: ' || v_title, NEW.author_name);
  end if;
  if TG_OP = 'UPDATE' and auth.uid() is not null and NEW.status is distinct from OLD.status then
    v_summary := case NEW.status
      when 'done' then 'Completed a commitment: '
      when 'dismissed' then 'Set aside a commitment: '
      when 'accepted' then 'Accepted a commitment: '
      else 'Updated a commitment: '
    end;
    perform public.record_contact_activity(
      NEW.contact_id, auth.uid(), 'commitment_decided', 'commitments', NEW.id,
      v_summary || v_title, NEW.decided_by_name);
  end if;
  return null;
end $$;

revoke all on function public.contact_actor_name(uuid) from public, anon, authenticated;
revoke all on function public.record_contact_activity(uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.stamp_contact_author() from public, anon, authenticated;
revoke all on function public.log_interaction_activity() from public, anon, authenticated;
revoke all on function public.log_note_activity() from public, anon, authenticated;
revoke all on function public.log_task_activity() from public, anon, authenticated;
revoke all on function public.stamp_commitment_author() from public, anon, authenticated;
revoke all on function public.log_commitment_activity() from public, anon, authenticated;

drop trigger if exists commitments_guard_link on public.commitments;
create trigger commitments_guard_link
  before insert or update on public.commitments
  for each row execute function public.guard_shared_contact_link();

drop trigger if exists commitments_stamp_author on public.commitments;
create trigger commitments_stamp_author
  before insert or update on public.commitments
  for each row execute function public.stamp_commitment_author();

drop trigger if exists commitments_log_activity on public.commitments;
create trigger commitments_log_activity
  after insert or update on public.commitments
  for each row execute function public.log_commitment_activity();

-- C. Backfill ---------------------------------------------------------------
-- Same proof rules as 9 Oct. A blank author stays blank. A known author
-- with a blank name gets the name. Completions are not guessed.
update public.contact_interactions i
   set author_id = i.user_id
 where i.author_id is null
   and i.user_id is not null;

update public.contact_interactions i
   set author_name = public.contact_actor_name(i.author_id)
 where i.author_id is not null
   and i.author_name is null;

update public.contact_notes n
   set author_id = n.user_id
  from public.contacts c
 where c.id = n.contact_id
   and n.author_id is null
   and n.user_id is not null
   and not c.company_lead
   and c.team_lead_team_id is null;

update public.contact_notes n
   set author_name = public.contact_actor_name(n.author_id)
 where n.author_id is not null
   and n.author_name is null;

update public.tasks t
   set author_id = t.user_id
 where t.author_id is null
   and t.user_id is not null
   and (
     t.contact_id is null
     or exists (
       select 1 from public.contacts c
        where c.id = t.contact_id
          and not c.company_lead
          and c.team_lead_team_id is null
     )
   );

update public.tasks t
   set author_name = public.contact_actor_name(t.author_id)
 where t.author_id is not null
   and t.author_name is null;

update public.tasks t
   set completed_by_name = public.contact_actor_name(t.completed_by)
 where t.completed_by is not null
   and t.completed_by_name is null;

update public.commitments cm
   set author_id = cm.user_id
 where cm.author_id is null
   and cm.user_id is not null
   and (
     cm.contact_id is null
     or exists (
       select 1 from public.contacts c
        where c.id = cm.contact_id
          and not c.company_lead
          and c.team_lead_team_id is null
     )
   );

update public.commitments cm
   set author_name = public.contact_actor_name(cm.author_id)
 where cm.author_id is not null
   and cm.author_name is null;

update public.contact_activity a
   set actor_name = public.contact_actor_name(a.actor_id)
 where a.actor_id is not null
   and a.actor_name is null;

comment on table public.contact_activity is
  'What happened on a contact, and who did it. Written for every contact. Readable only when the contact itself is readable.';

commit;
