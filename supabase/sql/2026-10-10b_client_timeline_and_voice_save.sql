-- =====================================================================
-- CRM Phase 1 (Dara approved 10 Oct 2026, 12:44 PM ET):
--   1. contact_timeline(): ONE phone-first feed for a client: calls, texts,
--      emails, notes, journal, tasks, promises, recordings, calendar events.
--   2. save_voice_note(): files a reviewed voice note as a contact note plus
--      the tasks and promises the agent kept. Called only from the Save tap.
--
-- PRIVACY: both functions are SECURITY INVOKER. They read and write through
-- the live row-level security (09b client privacy, 09c act-as hides content,
-- 08d email stays with the mailbox owner). They add no new access:
--   - the feed returns nothing unless the caller can already read the contact
--   - every source row is read as the caller, so each table's own rules apply
--   - texts/emails are matched by the client's phone/email inside the
--     CALLER's own mailbox/line only (quo_messages_own, email RLS)
--   - save_voice_note only writes onto a contact the caller OWNS, and the
--     09c act-as write block (with check) still applies.
-- Indexes: two small ones so the phone/email matches are index lookups.
-- ROLLBACK: rollback/2026-10-10b_client_timeline_and_voice_save.down.sql
-- =====================================================================
begin;
set local lock_timeout = '5s';

create index if not exists quo_messages_to_idx on public.quo_messages (user_id, to_number);
create index if not exists quo_messages_from_idx on public.quo_messages (user_id, from_number);
create index if not exists email_messages_from_lower_idx on public.email_messages_all (user_id, lower(from_address));
create index if not exists email_messages_to_gin_idx on public.email_messages_all using gin (to_addresses jsonb_path_ops);
create index if not exists ci_journal_idx on public.contact_interactions (journal_entry_id) where journal_entry_id is not null;

create or replace function public.contact_timeline(
  p_contact uuid, p_before timestamptz default null, p_limit int default 60, p_kinds text[] default null)
returns table(kind text, item_id uuid, at timestamptz, title text, body text, direction text, meta jsonb)
language plpgsql stable security invoker set search_path = public as $$
declare
  c record; v_uid uuid := auth.uid(); v_before timestamptz := coalesce(p_before, 'infinity');
  v_lim int := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_phones text[] := '{}'; v_emails text[] := '{}'; d text; e text;
begin
  if v_uid is null then return; end if;
  -- RLS decides: no row here = no feed (private client of someone else, act-as, etc.)
  select ct.id, ct.user_id, ct.phone, ct.phones, ct.email, ct.emails into c from contacts ct where ct.id = p_contact;
  if not found then return; end if;

  for d in select regexp_replace(x, '\D', '', 'g') from unnest(array[c.phone]
      || coalesce(array(select coalesce(j->>'number', j->>'value', j #>> '{}') from jsonb_array_elements(case when jsonb_typeof(c.phones)='array' then c.phones else '[]' end) j), '{}')) x
  loop
    d := right(d, 10);
    if length(d) = 10 then v_phones := v_phones || array['+1'||d, '1'||d, d]; end if;
  end loop;
  for e in select lower(trim(x)) from unnest(array[c.email]
      || coalesce(array(select coalesce(j->>'email', j->>'value', j #>> '{}') from jsonb_array_elements(case when jsonb_typeof(c.emails)='array' then c.emails else '[]' end) j), '{}')) x
  loop
    if e like '%@%' then v_emails := v_emails || e; end if;
  end loop;

  return query
  select * from (
    (select 'call'::text, q.id, coalesce(q.completed_at, q.op_created_at), 'Call'::text,
            left(coalesce(q.summary->>'summary', q.summary #>> '{}', ''), 400), q.direction,
            jsonb_build_object('duration', q.duration, 'status', q.status, 'has_recording', q.recording_url is not null)
       from quo_calls q
      where (p_kinds is null or 'call' = any(p_kinds))
        and (q.contact_id = p_contact or (q.user_id = v_uid and q.contact_id is null and q.participant = any(v_phones)))
        and coalesce(q.completed_at, q.op_created_at) < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'text', m.id, m.op_created_at, 'Text', left(m.body, 400), m.direction, '{}'::jsonb
       from quo_messages m
      where (p_kinds is null or 'text' = any(p_kinds)) and cardinality(v_phones) > 0
        and m.user_id = v_uid and (m.from_number = any(v_phones) or m.to_number = any(v_phones))
        and m.op_created_at < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'email', em.id, em.internal_date, coalesce(em.subject, '(no subject)'), left(em.snippet, 300), em.direction,
            jsonb_build_object('thread_id', em.thread_id)
       from email_messages em
      where (p_kinds is null or 'email' = any(p_kinds)) and cardinality(v_emails) > 0
        and em.user_id = v_uid
        and (lower(em.from_address) = any(v_emails)
             or em.to_addresses @> any(array(select jsonb_build_array(jsonb_build_object('email', x)) from unnest(v_emails) x)))
        and em.internal_date < v_before
      order by 3 desc limit v_lim)
    union all
    (select case when ci.channel = 'email' then 'email' when ci.channel in ('text') then 'text'
                 when ci.kind = 'call' then 'call' when ci.journal_entry_id is not null then 'journal' else 'note' end,
            ci.id, ci.occurred_at, initcap(coalesce(ci.kind, 'note')), left(coalesce(ci.brief, ci.body, ''), 400), ci.direction,
            jsonb_build_object('source', 'interaction', 'author', ci.author_name, 'pinned', ci.pinned)
       from contact_interactions ci
      where ci.contact_id = p_contact and ci.occurred_at < v_before
        and (p_kinds is null or (case when ci.channel = 'email' then 'email' when ci.channel = 'text' then 'text'
               when ci.kind = 'call' then 'call' when ci.journal_entry_id is not null then 'journal' else 'note' end) = any(p_kinds))
      order by 3 desc limit v_lim)
    union all
    (select 'note', n.id, n.created_at, 'Note', left(n.body, 400), null::text, jsonb_build_object('author', n.author_name)
       from contact_notes n
      where (p_kinds is null or 'note' = any(p_kinds)) and n.contact_id = p_contact and n.created_at < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'task', t.id, coalesce(t.completed_at, t.due_date::timestamptz, t.created_at), t.title, left(t.notes, 200), null,
            jsonb_build_object('due', t.due_date, 'done', t.completed, 'someday', t.someday)
       from tasks t
      where (p_kinds is null or 'task' = any(p_kinds)) and t.contact_id = p_contact and t.archived_at is null
        and coalesce(t.completed_at, t.due_date::timestamptz, t.created_at) < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'promise', k.id, coalesce(k.due_date::timestamptz, k.created_at), k.title, left(k.quote, 300), k.owner,
            jsonb_build_object('due', k.due_date, 'status', k.status, 'owner', k.owner)
       from commitments k
      where (p_kinds is null or 'promise' = any(p_kinds)) and k.contact_id = p_contact
        and k.status not in ('dismissed') and k.not_a_thing_at is null
        and coalesce(k.due_date::timestamptz, k.created_at) < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'recording', r.id, coalesce(r.recorded_at, r.created_at), coalesce(r.title, 'Recording'),
            left(coalesce(r.summary->>'summary', r.summary #>> '{}', ''), 400), null,
            jsonb_build_object('seconds', r.duration_seconds, 'status', r.transcription_status)
       from recordings r
      where (p_kinds is null or 'recording' = any(p_kinds)) and r.contact_id = p_contact
        and coalesce(r.recorded_at, r.created_at) < v_before
      order by 3 desc limit v_lim)
    union all
    (select 'event', ev.id, ev.start_at, coalesce(ev.title, 'Event'), left(ev.location, 200), null,
            jsonb_build_object('end', ev.end_at, 'all_day', ev.all_day)
       from events ev
      where (p_kinds is null or 'event' = any(p_kinds)) and ev.contact_id = p_contact and ev.start_at < v_before
      order by 3 desc limit v_lim)
  ) feed(kind, item_id, at, title, body, direction, meta)
  where feed.at is not null
  order by feed.at desc
  limit v_lim;
end $$;
comment on function public.contact_timeline(uuid, timestamptz, int, text[]) is
  'CRM Phase 1 unified client feed. SECURITY INVOKER: returns only what the caller''s RLS already allows. 2026-10-10.';
revoke all on function public.contact_timeline(uuid, timestamptz, int, text[]) from public, anon;
grant execute on function public.contact_timeline(uuid, timestamptz, int, text[]) to authenticated;

create or replace function public.save_voice_note(
  p_contact uuid, p_note text, p_tasks jsonb default '[]', p_promises jsonb default '[]')
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare v_uid uuid := auth.uid(); v_note uuid; t jsonb; nt int := 0; np int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_contact is not null and not exists (select 1 from contacts where id = p_contact and user_id = v_uid) then
    raise exception 'you can only file a voice note on your own contact';
  end if;
  if p_contact is not null and coalesce(trim(p_note), '') <> '' then
    insert into contact_notes(user_id, contact_id, body) values (v_uid, p_contact, left(p_note, 4000)) returning id into v_note;
    update contacts set last_contact_at = now() where id = p_contact and user_id = v_uid;
  end if;
  for t in select * from jsonb_array_elements(coalesce(p_tasks, '[]')) loop
    if coalesce(t->>'title', '') <> '' then
      insert into tasks(user_id, contact_id, title, due_date, status, priority_system, assignment_method)
      values (v_uid, p_contact, left(t->>'title', 300), nullif(t->>'due', '')::date, 'open', 'eisenhower', 'self');
      nt := nt + 1;
    end if;
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_promises, '[]')) loop
    if coalesce(t->>'title', '') <> '' then
      insert into commitments(user_id, contact_id, owner, title, due_date, status, confidence, context, dedupe_key)
      values (v_uid, p_contact, case when t->>'owner' = 'them' then 'them' else 'me' end, left(t->>'title', 300),
              nullif(t->>'due', '')::date, 'accepted', 'high', 'voice note', 'voice:' || gen_random_uuid());
      np := np + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'note_id', v_note, 'tasks', nt, 'promises', np);
end $$;
revoke all on function public.save_voice_note(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_voice_note(uuid, text, jsonb, jsonb) to authenticated;
commit;
