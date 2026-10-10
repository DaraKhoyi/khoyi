-- Two-agent check for shared-contact attribution.
-- Runs against a database that already has 2026-10-09d applied.
-- The whole check rolls back. It is not part of apply-sql.
--
-- A shares a contact with B (same team). C is not on that share.
-- A adds a note. B completes a task. Each can read the other's name.
-- C can read nothing. A client-sent user id is ignored. The author does not move.

begin;

create or replace function pg_temp.ok(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FAIL: %', msg;
  end if;
end $$;

-- Owner policies, the same shape the live database already has.
-- Created here only because this database was blank.
drop policy if exists contact_interactions_own on public.contact_interactions;
create policy contact_interactions_own on public.contact_interactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists contact_notes_own on public.contact_notes;
create policy contact_notes_own on public.contact_notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists tasks_own on public.tasks;
create policy tasks_own on public.tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or company_lead
    or (
      shared_scope = 'team'
      and team_id is not null
      and public.is_team_member(team_id)
    )
  );

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- People.
-- A 1111... B 2222... C 3333... team 4444... Dee (display name only) 5555...
insert into public.team_members (team_id, auth_user_id, role) values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'member'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'member');

insert into public.agents (user_id, auth_user_id, name) values
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Agent A'),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Agent B');

insert into public.user_settings (user_id, display_name) values
  ('55555555-5555-5555-5555-555555555555', 'Dee'),
  ('66666666-6666-6666-6666-666666666666', 'hidden@example.com');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

insert into public.contacts (id, user_id, name, shared_scope, team_id)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Shared Client',
  'team',
  '44444444-4444-4444-4444-444444444444'
);

insert into public.contacts (id, user_id, name, shared_scope)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'Private Client',
  'none'
);

-- A client-sent author is ignored. The signed-in user is A.
insert into public.contact_interactions (user_id, author_id, contact_id, kind, body)
values (
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'note',
  'A left this note'
);

select pg_temp.ok(
  (select author_id = '11111111-1111-1111-1111-111111111111'::uuid
      and user_id = '11111111-1111-1111-1111-111111111111'::uuid
      and author_name = 'Agent A'
     from public.contact_interactions
    where body = 'A left this note'),
  'note actor was not forced to the signed-in user');

select pg_temp.ok(
  (select action = 'note' and actor_id = '11111111-1111-1111-1111-111111111111'::uuid and actor_name = 'Agent A'
     from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and summary = 'Added a note'),
  'note history did not record A');

-- Author does not move. An edit records the editor.
update public.contact_interactions
   set author_id = '22222222-2222-2222-2222-222222222222',
       author_name = 'Agent B',
       body = 'A left this note, then edited it'
 where body = 'A left this note';

select pg_temp.ok(
  (select author_id = '11111111-1111-1111-1111-111111111111'::uuid
      and author_name = 'Agent A'
      and edited_by = '11111111-1111-1111-1111-111111111111'::uuid
      and edited_by_name = 'Agent A'
      and edited_at is not null
     from public.contact_interactions
    where body = 'A left this note, then edited it'),
  'author changed, or the edit was not recorded');

-- Status change is history, without copying a phone number into it.
update public.contacts
   set status = 'warm', phone = '555-0100'
 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select pg_temp.ok(
  (select actor_name = 'Agent A' and summary like 'Status changed from%'
     from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and action = 'status_changed'),
  'status change was not attributed to A');

select pg_temp.ok(
  (select summary = 'Edited phone' and summary not like '%555%'
     from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and action = 'field_edited'),
  'field edit copied the value or missed the phone');

-- Email log stays with A.
insert into public.contact_interactions (user_id, contact_id, kind, channel, body)
values (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'email', 'email', 'mailbox text'
);

-- B completes a task on the shared contact.
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select pg_temp.ok(
  (select author_name = 'Agent A' and body = 'A left this note, then edited it'
     from public.contact_interactions
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and kind = 'note'),
  'B could not see A''s note and name');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_interactions
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and channel = 'email'),
  'B could read A''s email log');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and action = 'email'),
  'B could read A''s email history');

select pg_temp.ok(
  (select actor_name = 'Agent A'
     from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and action = 'status_changed'),
  'B could not see who changed status');

insert into public.tasks (user_id, title, contact_id, completed)
values (
  '11111111-1111-1111-1111-111111111111',
  'Call the client',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  false
);

select pg_temp.ok(
  (select user_id = '22222222-2222-2222-2222-222222222222'::uuid
      and author_id = '22222222-2222-2222-2222-222222222222'::uuid
      and author_name = 'Agent B'
      and completed_by is null
     from public.tasks
    where title = 'Call the client'),
  'task author was not B');

update public.tasks
   set completed = true,
       completed_by = '11111111-1111-1111-1111-111111111111',
       completed_by_name = 'Agent A'
 where title = 'Call the client';

select pg_temp.ok(
  (select completed_by = '22222222-2222-2222-2222-222222222222'::uuid
      and completed_by_name = 'Agent B'
      and author_id = '22222222-2222-2222-2222-222222222222'::uuid
     from public.tasks
    where title = 'Call the client'),
  'completer was taken from the client instead of the signed-in user');

select pg_temp.ok(
  (select actor_name = 'Agent B' and summary = 'Completed a task: Call the client'
     from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and action = 'task_completed'),
  'completion history did not name B');

-- B cannot hang a task on A's private client.
do $$
begin
  insert into public.tasks (user_id, title, contact_id)
  values ('22222222-2222-2222-2222-222222222222', 'Should not land', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  raise exception 'FAIL: B attached a task to a private contact';
exception when insufficient_privilege then
  null;
end $$;

select pg_temp.ok(
  (select count(*) = 0 from public.tasks where title = 'Should not land'),
  'private-contact task was stored');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_interactions
    where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'B could read the private contact''s notes');

-- C is not on the share.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

select pg_temp.ok(
  (select count(*) = 0 from public.contacts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'C could read the shared contact');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_interactions
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'C could read notes');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'C could read history');

select pg_temp.ok(
  (select count(*) = 0 from public.tasks
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'C could read the task');

do $$
begin
  insert into public.contact_interactions (user_id, contact_id, kind, body)
  values ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'note', 'C should not write');
  raise exception 'FAIL: C wrote a note on a contact C cannot see';
exception when insufficient_privilege then
  null;
end $$;

-- A sees B's name on the completed task.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select pg_temp.ok(
  (select completed_by_name = 'Agent B' and author_name = 'Agent B'
     from public.tasks
    where title = 'Call the client'),
  'A could not see that B completed the task');

select pg_temp.ok(
  (select actor_name = 'Agent B'
     from public.contact_activity
    where action = 'task_completed'),
  'A could not see B on the timeline history');

-- Reopen keeps the original author and records who reopened.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
update public.tasks set completed = false, title = 'Call the client again' where title = 'Call the client';

select pg_temp.ok(
  (select author_name = 'Agent B'
      and completed_by is null
      and edited_by_name = 'Agent B'
     from public.tasks
    where title = 'Call the client again'),
  'reopen did not keep the author or clear the completer');

select pg_temp.ok(
  exists (
    select 1 from public.contact_activity
     where action = 'task_reopened' and actor_name = 'Agent B'
  ),
  'reopen was not recorded');

-- A second person editing (the office reclaim path runs as the caller but
-- bypasses row security) cannot replace the author. user_id may move.
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
update public.contact_interactions
   set user_id = '22222222-2222-2222-2222-222222222222',
       author_id = '22222222-2222-2222-2222-222222222222',
       author_name = 'Agent B'
 where body = 'A left this note, then edited it';

select pg_temp.ok(
  (select user_id = '22222222-2222-2222-2222-222222222222'::uuid
      and author_id = '11111111-1111-1111-1111-111111111111'::uuid
      and author_name = 'Agent A'
     from public.contact_interactions
    where body = 'A left this note, then edited it'),
  'moving the row owner rewrote the author');

-- Backfill: own-client rows get an author. Company Lead rows do not.
reset role;
select set_config('request.jwt.claim.sub', '', true);

insert into public.contacts (id, user_id, name, company_lead)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Company Lead', true);

insert into public.contacts (id, user_id, name)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Own Client');

alter table public.contact_notes disable trigger user;
alter table public.tasks disable trigger user;
insert into public.contact_notes (user_id, contact_id, body, author_id)
values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'lead note', null),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'own note', null);
insert into public.tasks (user_id, title, contact_id, author_id)
values
  ('11111111-1111-1111-1111-111111111111', 'lead task', 'cccccccc-cccc-cccc-cccc-cccccccccccc', null),
  ('11111111-1111-1111-1111-111111111111', 'own task', 'dddddddd-dddd-dddd-dddd-dddddddddddd', null);
alter table public.contact_notes enable trigger user;
alter table public.tasks enable trigger user;

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

select pg_temp.ok(
  (select author_id is null from public.contact_notes where body = 'lead note'),
  'company-lead note was given an author the data does not support');
select pg_temp.ok(
  (select author_id = '11111111-1111-1111-1111-111111111111'::uuid and author_name = 'Agent A'
     from public.contact_notes where body = 'own note'),
  'own-client note was not backfilled');
select pg_temp.ok(
  (select author_id is null from public.tasks where title = 'lead task'),
  'company-lead task was given an author the data does not support');
select pg_temp.ok(
  (select author_name = 'Agent A' from public.tasks where title = 'own task'),
  'own-client task was not backfilled');

-- No agent name and no usable display name means no name, not a guess.
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.contact_interactions (user_id, contact_id, kind, body)
values ('66666666-6666-6666-6666-666666666666', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'note', 'no name on file');

select pg_temp.ok(
  (select author_id = '66666666-6666-6666-6666-666666666666'::uuid and author_name is null
     from public.contact_interactions where body = 'no name on file'),
  'a missing name was filled in');

insert into public.contact_interactions (user_id, contact_id, kind, body)
values ('55555555-5555-5555-5555-555555555555', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'note', 'display name only');

select pg_temp.ok(
  (select author_name = 'Dee' from public.contact_interactions where body = 'display name only'),
  'display name was not used when no agent name exists');

-- A direct call cannot look up a name or write history, even as the table owner
-- while a session is signed in. Triggers are the only path.
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
begin
  perform public.contact_actor_name('22222222-2222-2222-2222-222222222222'::uuid);
  raise exception 'FAIL: name lookup ran outside a trigger';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  perform public.record_contact_activity(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'note', 'contact_notes', null, 'forged');
  raise exception 'FAIL: history was written outside a trigger';
exception when insufficient_privilege then
  null;
end $$;

-- Signed-in users cannot call the trigger functions.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.contact_actor_name(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_contact_activity(uuid, uuid, text, text, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.stamp_contact_author()', 'execute')
  and not has_function_privilege('authenticated', 'public.stamp_commitment_author()', 'execute')
  and not has_function_privilege('anon', 'public.record_contact_activity(uuid, uuid, text, text, uuid, text, text)', 'execute')
  and to_regprocedure('public.record_contact_activity(uuid,uuid,text,text,uuid,text)') is null,
  'attribution functions are callable from the API');

do $$
begin
  insert into public.contact_activity (contact_id, action, summary)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'note', 'forged');
  raise exception 'FAIL: a signed-in user inserted history directly';
exception when insufficient_privilege then
  null;
end $$;

-- Support session: private history hidden, company-lead history still visible.
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.contacts (id, user_id, name, company_lead)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Office Lead', true);
insert into public.contact_interactions (user_id, contact_id, kind, body)
values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'note', 'office note');

select set_config('test.support_session', 'on', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select pg_temp.ok(
  (select count(*) = 0 from public.contact_activity
    where contact_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'a support session could read private-client history');

select pg_temp.ok(
  (select count(*) > 0 from public.contact_activity
    where contact_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'a support session could not read company-lead history');

reset role;
select set_config('test.support_session', 'off', true);

-- A note written on a private contact keeps its author. Sharing later lets
-- B read that byline. C still cannot. A broker still cannot read the private
-- client, or this team share.
drop policy if exists commitments_own on public.commitments;
create policy commitments_own on public.commitments
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

insert into public.contacts (id, user_id, name, shared_scope)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '11111111-1111-1111-1111-111111111111',
  'Later Shared',
  'none'
);

insert into public.contact_interactions (user_id, contact_id, kind, body)
values (
  '22222222-2222-2222-2222-222222222222',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'note',
  'Written while private'
);

insert into public.commitments (user_id, contact_id, title, quote, status)
values (
  '22222222-2222-2222-2222-222222222222',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Send the disclosure',
  'secret quote should stay off the timeline',
  'proposed'
);

select pg_temp.ok(
  (select shared_scope = 'none' from public.contacts where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'contact was shared before the note');

select pg_temp.ok(
  (select author_id = '11111111-1111-1111-1111-111111111111'::uuid
      and author_name = 'Agent A'
     from public.contact_interactions
    where body = 'Written while private'),
  'a private note did not record A');

select pg_temp.ok(
  (select actor_name = 'Agent A'
     from public.contact_activity
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      and summary = 'Added a note'),
  'history was not written before the contact was shared');

select pg_temp.ok(
  (select author_name = 'Agent A' and decided_by is null
     from public.commitments
    where title = 'Send the disclosure'),
  'commitment author was not A');

update public.commitments
   set status = 'done',
       decided_by = '22222222-2222-2222-2222-222222222222',
       decided_by_name = 'Agent B'
 where title = 'Send the disclosure';

select pg_temp.ok(
  (select decided_by = '11111111-1111-1111-1111-111111111111'::uuid
      and decided_by_name = 'Agent A'
      and author_name = 'Agent A'
     from public.commitments
    where title = 'Send the disclosure'),
  'commitment decision was taken from the client');

select pg_temp.ok(
  (select actor_name = 'Agent A'
      and summary = 'Completed a commitment: Send the disclosure'
      and summary not like '%secret quote%'
     from public.contact_activity
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      and action = 'commitment_decided'),
  'commitment completion was not attributed to A');

-- Pinning is not an edit and does not write another history row.
insert into public.contact_interactions (user_id, contact_id, kind, body)
values (
  '11111111-1111-1111-1111-111111111111',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'note',
  'Pin me'
);

update public.contact_interactions
   set pinned = true
 where body = 'Pin me';

select pg_temp.ok(
  (select edited_by is null and author_name = 'Agent A'
     from public.contact_interactions
    where body = 'Pin me'),
  'pinning recorded an editor');

select pg_temp.ok(
  (select count(*) = 1 from public.contact_activity
    where subject_table = 'contact_interactions'
      and summary = 'Added a note'
      and contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      and subject_id = (select id from public.contact_interactions where body = 'Pin me')),
  'pinning wrote another history row');

-- Still private: B sees none of it.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select pg_temp.ok(
  (select count(*) = 0 from public.contact_interactions
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'B could read a private note before it was shared');

select pg_temp.ok(
  (select count(*) = 0 from public.contact_activity
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'B could read private history before it was shared');

-- A shares the contact with the team.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
update public.contacts
   set shared_scope = 'team',
       team_id = '44444444-4444-4444-4444-444444444444'
 where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select pg_temp.ok(
  (select author_name = 'Agent A' and body = 'Written while private'
     from public.contact_interactions
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      and body = 'Written while private'),
  'after sharing, B could not see A''s byline');

select pg_temp.ok(
  (select actor_name = 'Agent A'
     from public.contact_activity
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      and action = 'commitment_decided'),
  'after sharing, B could not see who completed the commitment');

select pg_temp.ok(
  (select count(*) = 0 from public.commitments
    where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'sharing revealed the commitment row itself');

-- C is still outside the share.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

select pg_temp.ok(
  (select count(*) = 0 from public.contacts where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.contact_interactions where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.contact_activity where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.tasks where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.commitments where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'C could read a contact C was not shared with');

-- Broker. Staff can read a Company Lead. A private client stays closed,
-- including one that was later shared only with a team.
reset role;
create or replace function public.is_brokerage_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = '77777777-7777-7777-7777-777777777777'::uuid
$$;
grant execute on function public.is_brokerage_staff() to authenticated;

select pg_temp.ok(
  (select count(*) = 0 from pg_policies
    where schemaname = 'public'
      and tablename in ('contact_interactions','contact_notes','tasks','commitments','contact_activity')
      and coalesce(qual, '') ilike '%is_brokerage_staff%'
      and policyname <> 'company_lead_staff_read'),
  'attribution added a broker read');

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);

select pg_temp.ok(
  (select count(*) = 0 from public.contacts where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  and (select count(*) = 0 from public.contact_interactions where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  and (select count(*) = 0 from public.contact_notes where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  and (select count(*) = 0 from public.tasks where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  and (select count(*) = 0 from public.contact_activity where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  and (select count(*) = 0 from public.commitments where contact_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'broker could read a private client');

select pg_temp.ok(
  (select count(*) = 0 from public.contacts where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.contact_interactions where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')
  and (select count(*) = 0 from public.contact_activity where contact_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'broker could read a team-shared client');

select pg_temp.ok(
  (select count(*) > 0 from public.contacts where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  and (select count(*) > 0 from public.contact_interactions where body = 'office note'),
  'broker could not read a company lead');

reset role;

rollback;
