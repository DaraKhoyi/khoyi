-- 2026-10-04b — THE RECORD: nothing disappears without a line you can read and undo.
--
-- Ray (panel), 2 Oct: "I've probably missed things and I have no idea." Dara,
-- 4 Oct: "not having things disappear without our knowledge… I would like to
-- know about things that might have been done to help me, but resulted in
-- important things being missed." Until today "Done for you" showed COUNTS by
-- kind; and a suggestion the call reader left out was not stored anywhere.
--
-- This file (step 2 of the design brief, decisions 10 and 11):
--   1. dropped_suggestions — what the call reader heard and left out, with why.
--   2. record_marks        — the person's own verdict on a line: right, or removed.
--   3. the_record()        — every automatic action as ONE LINE: what, when, why,
--                            and how to undo it. No totals. Kept with no time limit;
--                            only the person removes a line.
--   4. "Worth a second look" — the lines most likely to have cost something
--      (money, a date, a contract; or the reader was unsure), plus two ordinary
--      ones a day as a spot check, because people stop checking a filter that is
--      usually right.
--   5. the_record_undo() / the_record_mark().
-- Idempotent: safe to run twice.

create table if not exists public.dropped_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  call_id uuid, contact_id uuid, interaction_id uuid,
  owner text, owner_name text,
  title text not null, quote text, next_step text, context text,
  fuse text, stakes text, due_date date, confidence text,
  reason text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  picked_up_at timestamptz, commitment_id uuid
);
create unique index if not exists dropped_suggestions_once on public.dropped_suggestions (user_id, dedupe_key);
create index if not exists dropped_suggestions_recent on public.dropped_suggestions (user_id, created_at desc);
alter table public.dropped_suggestions enable row level security;
drop policy if exists dropped_suggestions_own on public.dropped_suggestions;
create policy dropped_suggestions_own on public.dropped_suggestions for select using (user_id = auth.uid());
revoke insert, update, delete on public.dropped_suggestions from anon, authenticated;

create table if not exists public.record_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  src text not null check (src in ('commitment', 'dropped', 'lead')),
  src_id uuid not null,
  mark text not null check (mark in ('right', 'removed', 'wrong')),
  at timestamptz not null default now(),
  primary key (user_id, src, src_id)
);
alter table public.record_marks enable row level security;
drop policy if exists record_marks_own on public.record_marks;
create policy record_marks_own on public.record_marks for select using (user_id = auth.uid());
revoke insert, update, delete on public.record_marks from anon, authenticated;

create index if not exists lead_concierge_record_idx on public.lead_concierge (user_id, created_at desc) where status in ('dismissed', 'handled');

-- One line per automatic action, for one person. Internal: called only by the_record().
create or replace function public.the_record_rows(p_uid uuid)
returns table (src text, id uuid, at timestamptz, what text, who text, why text, quote text, undo text, flag text, spot boolean)
language sql stable security definer set search_path = public as $$
  -- A follow-up from a call that the clock set aside, or that a second reading retired.
  select 'commitment'::text, c.id,
         coalesce(c.auto_expired_at, c.decided_at, c.created_at),
         c.title, ct.name,
         case when c.status = 'archived' then
                'On a second reading I retired this suggestion: '
                || coalesce(nullif(regexp_replace(coalesce(ev.note, ''), '^rejudged:\s*', ''), ''), 'it did not look like work for you') || '.'
              when coalesce(c.fuse, 'near') = 'immediate' then
                'Heard on a call on ' || to_char(c.created_at at time zone 'America/New_York', 'FMMonth FMDD') || '. It was something for that same day, so I set it aside after three days.'
              when coalesce(c.fuse, 'near') = 'near' then
                'Heard on a call on ' || to_char(c.created_at at time zone 'America/New_York', 'FMMonth FMDD') || '. It was not made a task or skipped within two weeks, so I set it aside.'
              else
                'Heard on a call on ' || to_char(c.created_at at time zone 'America/New_York', 'FMMonth FMDD') || '. It was not made a task or skipped within a month, so I set it aside.'
         end,
         c.quote, 'pick_up'::text,
         case when c.stakes = 'high' then 'Money, a deadline or a contract may be involved.'
              when c.due_date is not null then 'It had a date: ' || to_char(c.due_date, 'FMMonth FMDD') || '.'
              else null end,
         coalesce(c.fuse, 'near') <> 'immediate'
    from commitments c
    left join contacts ct on ct.id = c.contact_id
    left join lateral (select e.note from commitment_events e where e.commitment_id = c.id and e.event = 'archived_by_rules' order by e.at desc limit 1) ev on true
   where c.user_id = p_uid
     and ((c.status = 'expired' and c.auto_expired_at is not null) or (c.status = 'archived' and ev.note is not null))
  union all
  -- Something the call reader heard and left out before it was ever shown.
  select 'dropped', d.id, d.created_at, d.title, coalesce(ct.name, nullif(d.owner_name, '')),
         'Left out because ' || case d.reason
           when 'conditional' then 'it was said as an “if”, not a promise.'
           when 'in_the_moment' then 'it was something done during the call itself.'
           when 'vague' then 'the words were too vague to make a clear task.'
           when 'not_owed_to_agent' then 'it was the other person’s own job, with nothing owed to you.'
           when 'unknown_person' then 'I could not tell who made the promise.'
           when 'duplicate' then 'it looked like something already on your list.'
           else 'it did not look like work for you.' end,
         d.quote, 'pick_up',
         case when d.stakes = 'high' then 'Money, a deadline or a contract may be involved.'
              when d.due_date is not null then 'It had a date: ' || to_char(d.due_date, 'FMMonth FMDD') || '.'
              when d.reason in ('vague', 'unknown_person') then 'I was not sure about this one.'
              else null end,
         d.reason <> 'duplicate'
    from dropped_suggestions d left join contacts ct on ct.id = d.contact_id
   where d.user_id = p_uid and d.picked_up_at is null
  union all
  -- A message that looked like a lead: read and set aside, or closed because it was answered elsewhere.
  select 'lead', lc.id, coalesce(lc.handled_at, lc.created_at),
         case when lc.status = 'handled' then 'Closed a lead card: ' else 'Set aside a message that looked like a lead: ' end
           || coalesce(nullif(lc.lead_name, ''), nullif(lc.lead_email, ''), nullif(lc.lead_phone, ''), 'someone'),
         null,
         case when lc.status = 'handled' then 'You answered them from your own email or phone, so the card was no longer needed.'
              else 'I read it and judged it was not a real inquiry. The message itself is still in your Inbox.' end,
         left(nullif(btrim(coalesce(lc.inbound_text, '')), ''), 240),
         case when lc.status = 'handled' then null else 'real_lead' end,
         case when lc.status <> 'handled' and lc.contact_id is not null then 'This came from someone in your contacts.' else null end,
         lc.status <> 'handled'
    from lead_concierge lc
   where lc.user_id = p_uid and lc.status in ('dismissed', 'handled')
$$;
revoke all on function public.the_record_rows(uuid) from public, anon, authenticated;

-- The page. second_look: flagged lines from the last 30 days nobody has answered,
-- plus two ordinary ones a day (the same two all day). items: newest first, a few
-- at a time. No totals, by design — `more` only says whether there are older lines.
create or replace function public.the_record(p_limit integer default 8, p_before timestamptz default null, p_second integer default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_lim int := greatest(1, least(coalesce(p_limit, 8), 50)); v_sec int := greatest(1, least(coalesce(p_second, 3), 30)); v jsonb;
begin
  if v_uid is null then return jsonb_build_object('second_look', '[]'::jsonb, 'items', '[]'::jsonb, 'more', false, 'second_more', false); end if;
  with rows as materialized (
    select r.* from the_record_rows(v_uid) r
     where not exists (select 1 from record_marks m where m.user_id = v_uid and m.src = r.src and m.src_id = r.id and m.mark = 'removed')
  ),
  open_ as (
    select r.* from rows r
     where r.at > now() - interval '30 days'
       and not exists (select 1 from record_marks m where m.user_id = v_uid and m.src = r.src and m.src_id = r.id)
  ),
  spot as (
    select o.src, o.id from open_ o
     where o.flag is null and o.spot and o.at > now() - interval '14 days'
     order by md5(o.id::text || public.today_ny()::text) limit 2
  ),
  second as (
    select o.*, case when o.flag is not null then o.flag else 'A spot check: one of the ordinary ones.' end as flag_text,
           (o.flag is null) as is_spot
      from open_ o
     where o.flag is not null or exists (select 1 from spot s where s.src = o.src and s.id = o.id)
  ),
  second_page as (select * from second order by is_spot, at desc limit v_sec + 1),
  page as (select * from rows r where p_before is null or r.at < p_before order by r.at desc limit v_lim + 1)
  select jsonb_build_object(
    'second_look', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', id, 'at', at, 'what', what, 'who', who, 'why', why, 'quote', quote, 'undo', undo, 'flag', flag_text) order by is_spot, at desc)
                               from (select * from second_page order by is_spot, at desc limit v_sec) s), '[]'::jsonb),
    'second_more', (select count(*) from second_page) > v_sec,
    'items', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', id, 'at', at, 'what', what, 'who', who, 'why', why, 'quote', quote, 'undo', undo) order by at desc)
                         from (select * from page order by at desc limit v_lim) p), '[]'::jsonb),
    'more', (select count(*) from page) > v_lim
  ) into v;
  return v;
end $$;
revoke all on function public.the_record(integer, timestamptz, integer) from public, anon;
grant execute on function public.the_record(integer, timestamptz, integer) to authenticated;

-- "That was right" / "Remove this line". The person's verdict; nothing else changes.
create or replace function public.the_record_mark(p_src text, p_id uuid, p_mark text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_src not in ('commitment', 'dropped', 'lead') or p_mark not in ('right', 'removed') then return false; end if;
  if not exists (select 1 from the_record_rows(v_uid) r where r.src = p_src and r.id = p_id) then return false; end if;
  insert into record_marks (user_id, src, src_id, mark) values (v_uid, p_src, p_id, p_mark)
  on conflict (user_id, src, src_id) do update set mark = excluded.mark, at = now();
  return true;
end $$;
revoke all on function public.the_record_mark(text, uuid, text) from public, anon;
grant execute on function public.the_record_mark(text, uuid, text) to authenticated;

-- "No, bring it back." A follow-up returns to the review list as a suggestion (and
-- is the person's to decide from then on: the clock never sets it aside again). A
-- left-out suggestion becomes a suggestion for the first time. A lead cannot be
-- un-sent to the past, so the SENDER is remembered as a real source of leads.
create or replace function public.the_record_undo(p_src text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); d dropped_suggestions%rowtype; lc lead_concierge%rowtype; v_new uuid; v_n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  if p_src = 'commitment' then
    update commitments set status = 'proposed', decided_at = null, auto_expired_at = coalesce(auto_expired_at, now())
     where id = p_id and user_id = v_uid and status in ('expired', 'archived');
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
    delete from record_marks where user_id = v_uid and src = 'commitment' and src_id = p_id;
    return jsonb_build_object('ok', true, 'went', 'review');
  elsif p_src = 'dropped' then
    select * into d from dropped_suggestions where id = p_id and user_id = v_uid and picked_up_at is null;
    if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
    insert into commitments (user_id, contact_id, call_id, interaction_id, owner, owner_name, title, quote, next_step, context, fuse, stakes, due_date, confidence, dedupe_key, status, auto_expired_at)
    values (v_uid, d.contact_id, d.call_id, d.interaction_id, case when d.owner in ('me', 'them') then d.owner else 'them' end, d.owner_name, d.title, d.quote, d.next_step, d.context,
            case when d.fuse in ('near', 'distant') then d.fuse else 'near' end, case when d.stakes in ('high', 'normal', 'low') then d.stakes else null end,
            d.due_date, coalesce(d.confidence, 'low'), 'record:' || d.id::text, 'proposed', now())
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_new;
    update dropped_suggestions set picked_up_at = now(), commitment_id = v_new where id = d.id;
    return jsonb_build_object('ok', true, 'went', 'review');
  elsif p_src = 'lead' then
    select * into lc from lead_concierge where id = p_id and user_id = v_uid and status = 'dismissed';
    if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
    if nullif(btrim(coalesce(lc.lead_email, '')), '') is not null then
      insert into lead_sender_rules (user_id, sender, kind, note, learned_from)
      values (v_uid, lower(btrim(lc.lead_email)), 'lead_ok', 'you said a message set aside from this sender was a real lead', 'the_record')
      on conflict do nothing;
      delete from lead_sender_rules where user_id = v_uid and lower(sender) = lower(btrim(lc.lead_email)) and kind = 'not_a_lead' and not coalesce(is_brokerage, false);
    end if;
    insert into record_marks (user_id, src, src_id, mark) values (v_uid, 'lead', p_id, 'wrong')
    on conflict (user_id, src, src_id) do update set mark = 'wrong', at = now();
    return jsonb_build_object('ok', true, 'went', 'inbox', 'sender', lc.lead_email);
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown kind');
end $$;
revoke all on function public.the_record_undo(text, uuid) from public, anon;
grant execute on function public.the_record_undo(text, uuid) to authenticated;
