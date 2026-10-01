-- 2026-10-01 — ONE APP THAT MAKES EVERYTHING ELSE DISAPPEAR.
--
-- Josh (iPhone), 1 Oct, and Dara: "Make my life simpler, not busier." Opening
-- Today showed "1 of 84", a reply owed on a three-month-old email, 2,406 inbox
-- items and a wall of cards. "The app knows time elapsed. That's not the same
-- thing as importance." Ray had been saying the same thing nightly.
--
-- Two database halves:
--   1. chief_queue — the ONE queue Today reads — now says WHO a person is and
--      WHEN as a date, looks back two weeks not three, honours "No reply
--      needed", and absorbs the two kinds the old "Do this next" card held
--      (an email that did not arrive; a document that asks for something), so
--      that card can go without anything being lost.
--   2. done_for_you() — "PrismOS handled N things for you; these wait for your
--      OK." The ledger of what the AI did, with a per-kind "looks right" stamp.

create or replace function public.chief_queue(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() uid, public.today_ny() today),
  items as (
    -- promise: one item per CALL (the card decides every suggestion from it)
    select 10 ord, 'promise' kind, 'call:' || coalesce(c.call_id::text, c.id::text) ref,
           case when count(*) = 1 then max(c.title) else count(*) || ' possible follow-ups' end title,
           coalesce('Heard on your call with ' || max(ct.name), 'Heard on one of your calls') why,
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
    -- An email that did not arrive (was the old "Do this next" card's; ONE SYSTEM).
    select 25, 'bounce', 'bounce:' || b.id, 'An email did not arrive: ' || coalesce(nullif(b.original_subject, ''), '(no subject)'),
           'It did not reach ' || coalesce(array_to_string(b.failed_recipients, ', '), 'the recipient') || coalesce('. ' || b.fix_hint, ''),
           jsonb_build_object('bounce_id', b.id, 'to', b.failed_recipients[1], 'subject', b.original_subject), 1, b.bounced_at
      from email_bounces b cross join me
     where b.user_id = me.uid and not coalesce(b.handled, false) and b.bounced_at > now() - interval '7 days'
    union all
    -- A document PrismOS read that asks for something (signature, initials, a date).
    select 35, 'doc', 'doc:' || doc.id, coalesce(nullif(doc.action_label, ''), 'A document needs you') || coalesce(': ' || doc.title, ''),
           coalesce(left(doc.summary, 160), 'From a document PrismOS read for you'),
           jsonb_build_object('document_id', doc.id), 2, doc.created_at
      from documents doc cross join me
     where doc.user_id = me.uid and doc.action_needed and doc.status = 'ready' and doc.created_at > now() - interval '30 days'
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
           -- WHO they are first, then WHEN, as a date (house rule: never "N days ago").
           coalesce(nullif(ctype.label, ''), initcap(replace(nullif(ct.type, ''), '_', ' ')), 'Contact')
             || ' · wrote ' || case when (ct.last_inbound_at at time zone 'America/New_York')::date = me.today then 'today'
                                    when (ct.last_inbound_at at time zone 'America/New_York')::date = me.today - 1 then 'yesterday'
                                    else to_char(ct.last_inbound_at at time zone 'America/New_York', 'Dy Mon FMDD') end
             || coalesce(' by ' || ct.last_communication_channel, '') || ' and is waiting on you',
           jsonb_build_object('contact_id', ct.id, 'email', ct.email, 'name', ct.name, 'who', coalesce(ctype.label, ct.type)), 2, ct.last_inbound_at
      from contacts ct cross join me
      left join contact_types ctype on ctype.id = ct.type
     where ct.user_id = me.uid and ct.last_communication_direction = 'inbound'
       -- not yourself (your own address saved as a contact)
       and lower(coalesce(ct.email, '')) <> lower(coalesce((select email from auth.users where id = me.uid), '~'))
       and not exists (select 1 from agents ag where ag.auth_user_id = me.uid and lower(ag.name) = lower(ct.name))
       -- Josh, 1 Oct: a three-month-old email "is not something you should worry
       -- about today." Two weeks, and "No reply needed" is honoured.
       and ct.last_inbound_at between now() - interval '14 days' and now() - interval '6 hours'
       and (ct.no_reply_needed_at is null or ct.no_reply_needed_at < ct.last_inbound_at)
    union all
    select 60, 'plan', 'run:' || r.id,
           case r.agent when 'new_lead' then 'New-lead plan ready to approve' when 'post_close' then 'Post-close plan ready to approve'
                        when 'new_listing' then 'New-listing plan ready to approve' else 'A plan is ready to approve' end,
           coalesce(left(r.summary, 160), 'Review it and approve or skip'), jsonb_build_object('run_id', r.id), 2, r.created_at
      from agent_runs r cross join me
     where r.user_id = me.uid and r.status = 'prepared' and r.created_at > now() - interval '14 days'
    union all
    select 70, 'deal', 'deal:' || d.id, coalesce(d.name, d.client_name, d.address, 'A deal') || ' has not moved',
           'Still at "' || d.status || '" — no change since ' || to_char(coalesce(d.status_changed_at, d.updated_at) at time zone 'America/New_York', 'Mon FMDD'),
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
           case when count(*) = 1 then 'Move ' || max(ct.name) || ' forward' else 'Recruits are waiting to hear from you' end,
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
$function$

;

-- ── What PrismOS did for you ───────────────────────────────────────────────
create table if not exists public.done_for_you_ack (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  acked_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.done_for_you_ack enable row level security;
drop policy if exists dfy_ack_own on public.done_for_you_ack;
create policy dfy_ack_own on public.done_for_you_ack for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.done_for_you_ack from anon;

-- Each item: what was done, how many, whether it waits for the person's OK,
-- and where to look. "Informational" kinds count only since the person last
-- said "Looks right" (or the last p_hours); "needs your OK" kinds count what is
-- waiting now, whenever it arrived, because waiting is the point.
create or replace function public.done_for_you(p_hours integer default 24)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() uid, now() - make_interval(hours => greatest(1, least(p_hours, 24 * 14))) floor_),
  since as (
    select k.kind, greatest(me.floor_, coalesce(a.acked_at, me.floor_)) at_
      from me cross join unnest(array['mail_quiet','mail_worth','not_leads','set_aside','groomed']) k(kind)
      left join done_for_you_ack a on a.user_id = me.uid and a.kind = k.kind),
  s as (select kind, at_ from since),
  items as (
    select 'mail_worth' kind, 'Picked out the email worth reading' label,
           'From everything that arrived, these are the ones from people and about things that matter.' detail,
           count(*) n, false needs_ok, 'inbox' go, 'week' go_sub, 10 ord
      from email_threads t, me where t.user_id = me.uid and t.worth_a_look
       and t.last_message_at > (select at_ from s where kind = 'mail_worth')
    union all
    select 'mail_quiet', 'Kept email out of your way',
           'Newsletters, notices and automated mail. Nothing is deleted — it is under Inbox → Everything else.',
           count(*), false, 'inbox', 'quiet', 20
      from email_threads t, me where t.user_id = me.uid and not coalesce(t.worth_a_look, false)
       and coalesce(t.labels, '{}') && array['INBOX','UNREAD']
       and t.last_message_at > (select at_ from s where kind = 'mail_quiet')
    union all
    select 'not_leads', 'Checked messages that looked like leads',
           'Read and set aside — not real inquiries.', count(*), false, null, null, 30
      from lead_concierge lc, me where lc.user_id = me.uid and lc.status in ('dismissed', 'not_a_lead')
       and lc.created_at > (select at_ from s where kind = 'not_leads')
    union all
    select 'set_aside', 'Tidied away older suggestions from your calls',
           'Nothing is lost — you can pick any of them back up.', count(*), false, 'review', null, 40
      from commitments c, me where c.user_id = me.uid and c.auto_expired_at > (select at_ from s where kind = 'set_aside')
    union all
    select 'groomed', 'Moved old tasks out of the way',
           'Parked or archived as you chose. One tap brings any back.', count(*), false, 'tasks', null, 50
      from task_groom_log g, me where g.user_id = me.uid and g.created_at > (select at_ from s where kind = 'groomed')
    union all
    select 'lead_drafts', 'Drafted replies to new leads', 'Written in your voice. Nothing is sent until you tap Send.',
           count(*), true, 'today', null, 1
      from lead_concierge lc, me where lc.user_id = me.uid and lc.status = 'pending' and lc.kind = 'lead'
    union all
    select 'heard', 'Caught follow-ups from your calls', 'Make each one a task, or skip it.',
           count(*), true, 'review', null, 2
      from commitments c, me where c.user_id = me.uid and c.status = 'proposed' and c.auto_expired_at is null
       and coalesce(c.fuse, 'near') <> 'immediate'
    union all
    select 'plans', 'Prepared plans for your deals and leads', 'Approve, change or skip each step.',
           count(*), true, 'agentruns', null, 3
      from agent_runs r, me where r.user_id = me.uid and r.status = 'prepared' and r.created_at > now() - interval '14 days'
    union all
    select 'people', 'Found people in your email who are not in your contacts', 'Add the ones that matter; the rest stay out.',
           count(*), true, 'contacts', 'found', 4
      from discovered_correspondents d, me where d.user_id = me.uid and d.status = 'proposed'
       and d.created_at > now() - interval '7 days' and coalesce(d.sent_count, 0) > 0
  )
  select jsonb_build_object(
    'handled', coalesce((select sum(n) from items where not needs_ok), 0),
    'waiting', coalesce((select sum(n) from items where needs_ok), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'detail', detail, 'n', n,
                                 'needs_ok', needs_ok, 'go', go, 'go_sub', go_sub) order by needs_ok desc, ord)
                         from items where n > 0), '[]'::jsonb))
$$;
revoke all on function public.done_for_you(integer) from public, anon;
grant execute on function public.done_for_you(integer) to authenticated, service_role;

-- "Looks right" for the informational kinds: count from now on.
-- Signed out is refused outright (definer_guard: never "auth.uid() is not null and …").
create or replace function public.done_for_you_ack(p_kinds text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  insert into done_for_you_ack (user_id, kind, acked_at)
  select auth.uid(), k, now() from unnest(p_kinds) k
   where k in ('mail_quiet','mail_worth','not_leads','set_aside','groomed')
  on conflict (user_id, kind) do update set acked_at = excluded.acked_at;
end $$;
revoke all on function public.done_for_you_ack(text[]) from public, anon;
grant execute on function public.done_for_you_ack(text[]) to authenticated;
