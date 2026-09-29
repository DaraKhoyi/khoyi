-- 2026-09-29 — ONE SYSTEM: the Chief of Staff is a live queue on Today.
--
-- Dara: "Do we need two systems?" then "Make the chief of staff capable of doing
-- all that would be missed by eliminating the other system, and let's do the
-- right thing for the app."
--
-- Before: two piles. "Heard on your calls" on Today (145 waiting), and a
-- separate Chief of Staff screen that an AI job rebuilt every morning (4,661
-- items never touched; last acted on 29 Jul; ~$2.35/month). They overlapped,
-- and neither closed its loop.
--
-- After: ONE queue, computed LIVE from the facts (no morning AI job, no stale
-- snapshot, nothing to go out of date), shown on Today as "Your one thing now",
-- one item at a time, with the full list a tap away. It carries everything
-- both systems did:
--   promise  — a promise PrismOS heard on a call, waiting for your call (perishable: first)
--   chase    — someone promised you something and it is late
--   deadline — a date from your documents in the next 7 days
--   tasks    — ONE nudge to pick today's must-dos when A tasks have slipped (the list stays on Tasks)
--   reply    — someone reached out 6h–21 days ago and is waiting on you
--   plan     — a prepared new-lead / listing plan waiting for approval (last 14 days)
--   deal     — a live deal stuck at the same stage 10+ days
--   review   — a deal closed in the last 30 days: ask for the review and referral
--   recruit  — ONE nudge when recruits have sat at a stage 14+ days
-- "Not today" hides an item until tomorrow; "Done" hides it for good (for items
-- with no natural finish, like a review ask). Items that finish themselves (a
-- task completed, a reply sent, a promise decided) simply leave the queue.

create table if not exists public.chief_snoozes (
  user_id uuid not null,
  source_ref text not null,
  until date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, source_ref)
);
alter table public.chief_snoozes enable row level security;
drop policy if exists chief_snoozes_own on public.chief_snoozes;
create policy chief_snoozes_own on public.chief_snoozes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.chief_snoozes from anon;
grant select, insert, update, delete on public.chief_snoozes to authenticated;

create or replace function public.chief_queue(p_limit integer default 40)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() uid, public.today_ny() today),
  items as (
    -- promise: one item per CALL (the card decides every suggestion from it)
    select 10 ord, 'promise' kind, 'call:' || coalesce(c.call_id::text, c.id::text) ref,
           case when count(*) = 1 then max(c.title) else count(*) || ' possible follow-ups' end title,
           'Heard on your call with ' || coalesce(max(ct.name), 'a contact') why,
           jsonb_build_object('call_id', c.call_id, 'commitment_id', min(c.id::text)) payload, 2 priority, max(c.created_at) at_
      from contacts ct right join commitments c on ct.id = c.contact_id join me on c.user_id = me.uid
     where c.user_id = me.uid and c.status = 'proposed'
       and coalesce(c.fuse, 'near') <> 'immediate'   -- same rule as the call card: "call you right back" is moot by review time
     group by coalesce(c.call_id::text, c.id::text), c.call_id
    union all
    select 20, 'chase', 'commitment:' || c.id, c.title,
           coalesce(case when c.owner_name ~* '^\s*(me\M|unknown|the agent|$)' then null else c.owner_name end, ct.name, 'They') || ' promised this by ' || to_char(c.due_date, 'Mon FMDD') || ' — it is late',
           jsonb_build_object('commitment_id', c.id), 1, c.due_date::timestamptz
      from contacts ct right join commitments c on ct.id = c.contact_id join me on c.user_id = me.uid
     where c.user_id = me.uid and c.status = 'accepted' and c.owner = 'them' and c.due_date < me.today
    union all
    select 30, 'deadline', 'kd:' || f.source_id || ':' || f.fact_key, f.fact_key || coalesce(': ' || f.value_text, ''),
           'Due ' || to_char(f.value_date, 'Dy Mon FMDD') || ', from your documents',
           jsonb_build_object('title', f.fact_key || ' (' || coalesce(f.value_text, f.value_date::text) || ')', 'due_date', f.value_date),
           case when f.value_date <= me.today + 1 then 1 else 2 end, f.value_date::timestamptz
      from knowledge_facts f cross join me
     where f.user_id = me.uid and f.fact_type in ('deadline', 'date') and f.superseded_by is null
       and f.value_date between me.today and me.today + 7
    union all
    -- ONE task item, not the task list. The list is its own screen (and Plan my
    -- day); copying hundreds of overdue tasks here would rebuild the very pile
    -- this queue replaces. It asks for the one decision that clears the day.
    select 40, 'tasks', 'tasks:' || me.today, 'Pick today’s must-dos from your task list',
           'Some of your A tasks slipped past their date. Choose what really happens today; move or drop the rest.',
           jsonb_build_object('overdue_a', count(*)), 2, now()
      from tasks t cross join me
     where t.user_id = me.uid and not coalesce(t.completed, false) and t.due_date < me.today and t.eisenhower_quadrant = 'A'
       and coalesce(t.status, '') not in ('done', 'completed', 'archived', 'someday')
    group by me.today having count(*) > 0
    union all
    select 50, 'reply', 'reply:' || ct.id, 'Reply to ' || ct.name,
           'They reached out ' || case when (me.today - (ct.last_inbound_at at time zone 'America/New_York')::date) <= 1 then 'yesterday'
             else (me.today - (ct.last_inbound_at at time zone 'America/New_York')::date) || ' days ago' end
             || coalesce(' by ' || ct.last_communication_channel, '') || ' and are waiting on you',
           jsonb_build_object('contact_id', ct.id, 'email', ct.email, 'name', ct.name), 2, ct.last_inbound_at
      from contacts ct cross join me
     where ct.user_id = me.uid and ct.last_communication_direction = 'inbound'
       -- not yourself (your own address saved as a contact)
       and lower(coalesce(ct.email, '')) <> lower(coalesce((select email from auth.users where id = me.uid), '~'))
       and not exists (select 1 from agents ag where ag.auth_user_id = me.uid and lower(ag.name) = lower(ct.name))
       and ct.last_inbound_at between now() - interval '21 days' and now() - interval '6 hours'
    union all
    select 60, 'plan', 'run:' || r.id,
           case r.agent when 'new_lead' then 'New-lead plan ready to approve' when 'post_close' then 'Post-close plan ready to approve'
                        when 'new_listing' then 'New-listing plan ready to approve' else 'A plan is ready to approve' end,
           coalesce(left(r.summary, 160), 'Review it and approve or skip'), jsonb_build_object('run_id', r.id), 2, r.created_at
      from agent_runs r cross join me
     where r.user_id = me.uid and r.status = 'prepared' and r.created_at > now() - interval '14 days'
    union all
    select 70, 'deal', 'deal:' || d.id, coalesce(d.name, d.client_name, d.address, 'A deal') || ' has not moved',
           'At "' || d.status || '" for ' || (me.today - (coalesce(d.status_changed_at, d.updated_at) at time zone 'America/New_York')::date) || ' days',
           jsonb_build_object('deal_id', d.id), 2, coalesce(d.status_changed_at, d.updated_at)
      from deals d cross join me
     where d.user_id = me.uid and d.status not in ('closed', 'lost', 'dead', 'archived', 'withdrawn', 'cancelled', 'sold', 'lead')
       and coalesce(d.status_changed_at, d.updated_at) < now() - interval '10 days'
    union all
    select 80, 'review', 'review:' || d.id, 'Ask ' || coalesce(d.client_name, 'your client') || ' for a review and a referral',
           'Closed ' || to_char(d.close_date, 'Mon FMDD') || ' — the best moment to ask is in the first month',
           jsonb_build_object('deal_id', d.id, 'title', 'Ask ' || coalesce(d.client_name, 'the client') || ' for a review and a referral'), 3, d.close_date::timestamptz
      from deals d cross join me
     where d.user_id = me.uid and d.status = 'closed' and d.close_date >= me.today - 30
    union all
    -- ONE recruiting nudge (a bulk import left dozens at "lead" for months;
    -- one item each would bury everything else). Names the one furthest along.
    select 90, 'recruit', 'recruit:' || me.today,
           case when count(*) = 1 then 'Move ' || max(ct.name) || ' forward' else count(*) || ' recruits have gone quiet' end,
           'Furthest along: ' || (array_agg(ct.name || ' (' || ct.recruiting_stage || ')' order by (ct.recruiting_stage = 'lead'), ct.recruiting_stage_changed_at desc))[1]
             || '. Pick one to move forward today.',
           jsonb_build_object('count', count(*)), 3, max(ct.recruiting_stage_changed_at)
      from contacts ct cross join me
     where ct.user_id = me.uid and ct.recruiting_stage is not null and ct.recruiting_stage not in ('signed', 'lost', 'hired')
       and ct.recruiting_stage_changed_at < now() - interval '14 days'
     group by me.today having count(*) > 0
  ),
  live as (
    select i.* from items i cross join me
     where not exists (select 1 from chief_snoozes s where s.user_id = me.uid and s.source_ref = i.ref and s.until > me.today)
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'ref', ref, 'title', title, 'why', why, 'payload', payload, 'priority', priority)
                   order by ord, priority, at_ desc nulls last), '[]'::jsonb)
    from (select * from live order by ord, priority, at_ desc nulls last limit greatest(1, least(p_limit, 100))) x
$$;
revoke all on function public.chief_queue(integer) from public, anon;
grant execute on function public.chief_queue(integer) to authenticated;

-- Retire the morning AI job: the queue is live now, and the morning brief
-- (ari-briefing) already writes the day's narrative. Old cos_* rows stay as history.
select cron.unschedule(jobid) from cron.job where jobname = 'chief-of-staff-daily';
