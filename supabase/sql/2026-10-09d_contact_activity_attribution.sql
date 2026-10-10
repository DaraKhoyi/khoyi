-- =====================================================================
-- Shared-contact activity attribution (9 Oct 2026)
--
-- Every note, task, call, text, email, status or stage change, and field
-- edit on a contact records who did it and when. The signed-in user is the
-- actor. A user id sent by the app is not used.
--
-- The original author stays put. A later edit records who edited it and when.
-- Older rows are filled in only where the existing user id is still the person
-- who wrote them. Company Leads and Team Leads are skipped for notes and
-- tasks, because reclaim can move those user ids. Where that is the case the
-- author stays blank and the screen says "author unknown".
--
-- History is readable only by someone who can already read the contact.
-- Email rows stay with the mailbox owner (same rule as 2026-10-08d).
-- Support sessions still cannot see a private client's history (same rule
-- as 2026-10-09c). This file does not change those policies.
--
-- The new functions are triggers. Signed-in users and signed-out users cannot
-- call them.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-09d_contact_activity_attribution.down.sql
--           (by hand only)
-- =====================================================================
begin;
set local lock_timeout = '5s';
lock table public.contacts, public.contact_notes, public.contact_interactions, public.tasks in access exclusive mode;

-- A. Columns ----------------------------------------------------------------
alter table public.contact_interactions
  add column if not exists author_id uuid default auth.uid(),
  add column if not exists author_name text,
  add column if not exists edited_by uuid,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz;

alter table public.contact_notes
  add column if not exists author_id uuid default auth.uid(),
  add column if not exists author_name text,
  add column if not exists edited_by uuid,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz;

alter table public.tasks
  add column if not exists author_id uuid default auth.uid(),
  add column if not exists author_name text,
  add column if not exists edited_by uuid,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists completed_by_name text;

comment on column public.contact_interactions.author_id is
  'Who wrote this. Set from the signed-in user. Never replaced.';
comment on column public.tasks.completed_by is
  'Who marked the task done. Set from the signed-in user. Blank when that is not known.';

-- B. History table ----------------------------------------------------------
create table if not exists public.contact_activity (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  action text not null,
  subject_table text,
  subject_id uuid,
  summary text,
  created_at timestamptz not null default now(),
  constraint contact_activity_action_chk check (action in (
    'note','call','text','email','meeting','interaction_edited',
    'task_created','task_edited','task_completed','task_reopened',
    'status_changed','stage_changed','field_edited'
  ))
);

create index if not exists contact_activity_contact_created_idx
  on public.contact_activity (contact_id, created_at desc);

comment on table public.contact_activity is
  'What happened on a contact, and who did it. Readable only when the contact itself is readable.';

alter table public.contact_activity enable row level security;
revoke all on table public.contact_activity from public, anon, authenticated;
grant select on table public.contact_activity to authenticated;
grant select, insert, update, delete on table public.contact_activity to service_role;

-- Someone who can read the contact can read its history. No other path.
drop policy if exists contact_activity_select on public.contact_activity;
create policy contact_activity_select on public.contact_activity
  for select to authenticated
  using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_activity.contact_id
    )
  );

-- Support sessions keep seeing Company Leads only. Same shape as 2026-10-09c.
drop policy if exists act_as_hides_clients on public.contact_activity;
create policy act_as_hides_clients on public.contact_activity
  as restrictive for all to authenticated
  using (
    not (select public.is_support_session())
    or exists (
      select 1 from public.contacts c
      where c.id = contact_activity.contact_id and c.company_lead
    )
  )
  with check (not (select public.is_support_session()));

-- An email log stays with the person whose mailbox it is.
drop policy if exists contact_activity_email_owner_only on public.contact_activity;
create policy contact_activity_email_owner_only on public.contact_activity
  as restrictive for select to authenticated
  using (
    action is distinct from 'email'
    or actor_id = (select auth.uid())
  );

-- C. Helpers (trigger-only) -------------------------------------------------
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
  -- Names are copied onto a row during a trigger. A direct call is refused
  -- for a signed-in session so this cannot be used as a lookup.
  if pg_trigger_depth() = 0 and auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_actor is null then return null; end if;
  select left(btrim(a.name), 80) into v_name
    from public.agents a
   where a.auth_user_id = p_actor
     and nullif(btrim(a.name), '') is not null
   order by a.created_at
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
  -- A signed-in session always records itself. A server job with no session
  -- keeps the author already stored on the row.
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

-- Refuse to point a row at a contact the caller cannot read.
-- Leaving an existing link as it is remains allowed, so finishing your own
-- task still works after sharing is turned off.
create or replace function public.guard_shared_contact_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' and NEW.contact_id is not distinct from OLD.contact_id then
    return NEW;
  end if;
  if NEW.contact_id is null or auth.uid() is null then
    return NEW;
  end if;
  if not exists (select 1 from public.contacts c where c.id = NEW.contact_id) then
    raise exception 'You cannot attach this to that contact' using errcode = '42501';
  end if;
  return NEW;
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
    if TG_TABLE_NAME = 'tasks' then
      v_done := coalesce(NEW.completed, false) or NEW.status = 'done';
      if v_done and auth.uid() is not null then
        NEW.completed_by := auth.uid();
        NEW.completed_by_name := public.contact_actor_name(auth.uid());
      else
        NEW.completed_by := null;
        NEW.completed_by_name := null;
      end if;
    end if;
    return NEW;
  end if;

  -- Author never moves once it is set. A signed-in session cannot fill a
  -- blank one either. A server job can fill a blank (the backfill) and cannot
  -- change it afterwards. user_id is left alone so reclaim can still move a
  -- Company Lead or Team Lead back to the office without rewriting history.
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
    NEW.edited_by := auth.uid();
    NEW.edited_by_name := public.contact_actor_name(auth.uid());
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
        NEW.completed_by_name := public.contact_actor_name(auth.uid());
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

create or replace function public.log_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bits text[] := '{}';
begin
  if TG_OP <> 'UPDATE' or auth.uid() is null then return null; end if;

  if NEW.status is distinct from OLD.status then
    perform public.record_contact_activity(
      NEW.id, auth.uid(), 'status_changed', 'contacts', NEW.id,
      'Status changed from ' || coalesce(nullif(left(OLD.status, 40), ''), 'blank')
        || ' to ' || coalesce(nullif(left(NEW.status, 40), ''), 'blank'));
  end if;

  if NEW.pipeline_stage is distinct from OLD.pipeline_stage
     or NEW.recruiting_stage is distinct from OLD.recruiting_stage then
    perform public.record_contact_activity(
      NEW.id, auth.uid(), 'stage_changed', 'contacts', NEW.id,
      'Stage changed'
        || case when NEW.pipeline_stage is distinct from OLD.pipeline_stage then
             ' from ' || coalesce(nullif(left(OLD.pipeline_stage, 40), ''), 'blank')
               || ' to ' || coalesce(nullif(left(NEW.pipeline_stage, 40), ''), 'blank')
           else '' end);
  end if;

  if NEW.phone is distinct from OLD.phone or NEW.phones is distinct from OLD.phones then
    v_bits := array_append(v_bits, 'phone');
  end if;
  if NEW.email is distinct from OLD.email or NEW.emails is distinct from OLD.emails then
    v_bits := array_append(v_bits, 'email');
  end if;
  if NEW.name is distinct from OLD.name then v_bits := array_append(v_bits, 'name'); end if;
  if NEW.company is distinct from OLD.company then v_bits := array_append(v_bits, 'company'); end if;
  if NEW.role is distinct from OLD.role then v_bits := array_append(v_bits, 'role'); end if;
  if NEW.type is distinct from OLD.type then v_bits := array_append(v_bits, 'type'); end if;
  if NEW.priority is distinct from OLD.priority then v_bits := array_append(v_bits, 'priority'); end if;
  if NEW.profession is distinct from OLD.profession then v_bits := array_append(v_bits, 'profession'); end if;
  if NEW.tags is distinct from OLD.tags then v_bits := array_append(v_bits, 'tags'); end if;
  if NEW.pronouns is distinct from OLD.pronouns then v_bits := array_append(v_bits, 'pronouns'); end if;
  if NEW.notes is distinct from OLD.notes then v_bits := array_append(v_bits, 'notes'); end if;
  if NEW.marketing_opt_out is distinct from OLD.marketing_opt_out then v_bits := array_append(v_bits, 'marketing preference'); end if;
  if NEW.spoken_language is distinct from OLD.spoken_language then v_bits := array_append(v_bits, 'language'); end if;
  if NEW.shared_scope is distinct from OLD.shared_scope then v_bits := array_append(v_bits, 'sharing'); end if;
  if NEW.home_address is distinct from OLD.home_address
     or NEW.home_city is distinct from OLD.home_city
     or NEW.home_state is distinct from OLD.home_state
     or NEW.home_zip is distinct from OLD.home_zip then
    v_bits := array_append(v_bits, 'home address');
  end if;
  if NEW.business_address is distinct from OLD.business_address
     or NEW.business_city is distinct from OLD.business_city
     or NEW.business_state is distinct from OLD.business_state
     or NEW.business_zip is distinct from OLD.business_zip then
    v_bits := array_append(v_bits, 'business address');
  end if;

  if cardinality(v_bits) > 0 then
    perform public.record_contact_activity(
      NEW.id, auth.uid(), 'field_edited', 'contacts', NEW.id,
      'Edited ' || array_to_string(v_bits, ', '));
  end if;
  return null;
end $$;

revoke all on function public.contact_actor_name(uuid) from public, anon, authenticated;
revoke all on function public.record_contact_activity(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.guard_shared_contact_link() from public, anon, authenticated;
revoke all on function public.stamp_contact_author() from public, anon, authenticated;
revoke all on function public.log_interaction_activity() from public, anon, authenticated;
revoke all on function public.log_note_activity() from public, anon, authenticated;
revoke all on function public.log_task_activity() from public, anon, authenticated;
revoke all on function public.log_contact_changes() from public, anon, authenticated;

-- D. Triggers ---------------------------------------------------------------
drop trigger if exists contact_interactions_guard_link on public.contact_interactions;
create trigger contact_interactions_guard_link
  before insert or update on public.contact_interactions
  for each row execute function public.guard_shared_contact_link();

drop trigger if exists contact_notes_guard_link on public.contact_notes;
create trigger contact_notes_guard_link
  before insert or update on public.contact_notes
  for each row execute function public.guard_shared_contact_link();

drop trigger if exists tasks_guard_link on public.tasks;
create trigger tasks_guard_link
  before insert or update on public.tasks
  for each row execute function public.guard_shared_contact_link();

drop trigger if exists contact_interactions_stamp_author on public.contact_interactions;
create trigger contact_interactions_stamp_author
  before insert or update on public.contact_interactions
  for each row execute function public.stamp_contact_author();

drop trigger if exists contact_notes_stamp_author on public.contact_notes;
create trigger contact_notes_stamp_author
  before insert or update on public.contact_notes
  for each row execute function public.stamp_contact_author();

drop trigger if exists tasks_stamp_author on public.tasks;
create trigger tasks_stamp_author
  before insert or update on public.tasks
  for each row execute function public.stamp_contact_author();

drop trigger if exists contact_interactions_log_activity on public.contact_interactions;
create trigger contact_interactions_log_activity
  after insert or update on public.contact_interactions
  for each row execute function public.log_interaction_activity();

drop trigger if exists contact_notes_log_activity on public.contact_notes;
create trigger contact_notes_log_activity
  after insert or update on public.contact_notes
  for each row execute function public.log_note_activity();

drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity
  after insert or update on public.tasks
  for each row execute function public.log_task_activity();

drop trigger if exists contacts_log_activity on public.contacts;
create trigger contacts_log_activity
  after update on public.contacts
  for each row execute function public.log_contact_changes();

-- E. Read path for people the contact is already shared with -----------------
-- Adds SELECT only. Writes stay with the row owner. Email SELECT stays
-- restricted by the policy from 2026-10-08d, which this file does not drop.
drop policy if exists contact_interactions_visible_with_contact on public.contact_interactions;
create policy contact_interactions_visible_with_contact on public.contact_interactions
  for select to authenticated
  using (
    contact_id is not null
    and exists (
      select 1 from public.contacts c
      where c.id = contact_interactions.contact_id
    )
  );

drop policy if exists contact_notes_visible_with_contact on public.contact_notes;
create policy contact_notes_visible_with_contact on public.contact_notes
  for select to authenticated
  using (
    contact_id is not null
    and exists (
      select 1 from public.contacts c
      where c.id = contact_notes.contact_id
    )
  );

drop policy if exists tasks_visible_with_contact on public.tasks;
create policy tasks_visible_with_contact on public.tasks
  for select to authenticated
  using (
    contact_id is not null
    and exists (
      select 1 from public.contacts c
      where c.id = tasks.contact_id
    )
  );

-- New rows cannot be attached to a contact the caller cannot read.
drop policy if exists contact_interactions_on_visible_contact on public.contact_interactions;
create policy contact_interactions_on_visible_contact on public.contact_interactions
  as restrictive for insert to authenticated
  with check (
    contact_id is null
    or exists (
      select 1 from public.contacts c
      where c.id = contact_interactions.contact_id
    )
  );

drop policy if exists contact_notes_on_visible_contact on public.contact_notes;
create policy contact_notes_on_visible_contact on public.contact_notes
  as restrictive for insert to authenticated
  with check (
    contact_id is null
    or exists (
      select 1 from public.contacts c
      where c.id = contact_notes.contact_id
    )
  );

drop policy if exists tasks_on_visible_contact on public.tasks;
create policy tasks_on_visible_contact on public.tasks
  as restrictive for insert to authenticated
  with check (
    contact_id is null
    or exists (
      select 1 from public.contacts c
      where c.id = tasks.contact_id
    )
  );

-- Keep the mailbox-owner email rule if this database does not have it yet.
-- Where it already exists (2026-10-08d), leave it untouched.
do $email$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'contact_interactions'
       and policyname = 'email_interactions_owner_only'
  ) then
    create policy email_interactions_owner_only on public.contact_interactions
      as restrictive for select to authenticated
      using (coalesce(channel, '') <> 'email' or user_id = (select auth.uid()));
  end if;
end $email$;

-- F. Backfill ----------------------------------------------------------------
-- Interactions: user_id is the session that inserted the row, and reclaim
-- does not rewrite it.
update public.contact_interactions i
   set author_id = i.user_id,
       author_name = public.contact_actor_name(i.user_id)
 where i.author_id is null
   and i.user_id is not null;

-- Notes and tasks on an agent's own clients: reclaim does not move these.
-- Company Leads and Team Leads are left blank on purpose.
update public.contact_notes n
   set author_id = n.user_id,
       author_name = public.contact_actor_name(n.user_id)
  from public.contacts c
 where c.id = n.contact_id
   and n.author_id is null
   and n.user_id is not null
   and not c.company_lead
   and c.team_lead_team_id is null;

update public.tasks t
   set author_id = t.user_id,
       author_name = public.contact_actor_name(t.user_id)
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

commit;
