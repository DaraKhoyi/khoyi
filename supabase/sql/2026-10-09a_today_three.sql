-- =====================================================================
-- Today: three things, one tap each (9 Oct 2026)
--
-- Dara approved the compressed CRM plan at 9:24 AM ET ("Yes to all 3"). First
-- move: a phone-first Today with THREE cards, led by promises due within 48
-- hours, then the next best actions: overdue Company Lead follow-ups and
-- missed callers. In-app only: this function reads, it never texts or emails.
--
-- public.today_three() returns, for the signed-in person ONLY (auth.uid()):
--   { ok: true, cards: [ up to 3 ] }
--   Slot 1 = the most urgent promise you made (late first, then due today,
--            then due in the next 2 days). Status accepted or proposed.
--   Slot 2 = your oldest Company Lead (brokerage_leads.origin = 'company')
--            assigned to you and not answered after 5 minutes.
--   Slot 3 = the person who called you, was not answered, and has not been
--            called or texted back since (last 7 days).
--   An empty slot is filled from the others in that order. Rows set aside
--   with "Not today" (chief_snoozes, until > today) are skipped.
--
-- SECURITY: SECURITY DEFINER only because agents cannot read brokerage_leads
-- (staff-only) and need the name/phone of the Company Lead assigned TO THEM.
-- Every source is filtered to auth.uid(); nothing about another person is
-- returned. No auth.uid() (signed out, cron) -> empty. anon cannot execute.
--
-- ROLLBACK: supabase/sql/rollback/2026-10-09a_today_three.down.sql
-- =====================================================================
begin;

create or replace function public.today_three()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  p jsonb; l jsonb; c jsonb; v_all jsonb; v_out jsonb := '[]'::jsonb; v_seen text[] := '{}'; e jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'cards', '[]'::jsonb); end if;
  v_today := public.today_ny();

  -- 1. Promises I made, due within 48 hours (or already late, still open).
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'due_date'), '[]'::jsonb) into p from (
    select jsonb_build_object(
      'kind', 'promise', 'ref', 'commitment:' || cm.id, 'id', cm.id, 'status', cm.status,
      'title', cm.title, 'who', coalesce(ct.name, nullif(cm.owner_name, '')),
      'contact_id', cm.contact_id, 'phone', ct.phone,
      'due_date', cm.due_date, 'late', cm.due_date < v_today, 'stakes', cm.stakes,
      'rank', case when cm.due_date < v_today then 0 when cm.due_date = v_today then 1 else 2 end) x
    from public.commitments cm
    left join public.contacts ct on ct.id = cm.contact_id and ct.user_id = v_uid
    where cm.user_id = v_uid and cm.owner = 'me' and cm.status in ('accepted', 'proposed')
      and cm.due_date is not null and cm.due_date <= v_today + 2
      and cm.due_date >= v_today - 14
      and not exists (select 1 from public.chief_snoozes s where s.user_id = v_uid
                       and s.source_ref = 'commitment:' || cm.id and s.until > v_today)
    order by cm.due_date limit 3) q;

  -- 2. Company Leads assigned to me, not answered after 5 minutes.
  select coalesce(jsonb_agg(x order by x->>'assigned_at'), '[]'::jsonb) into l from (
    select jsonb_build_object(
      'kind', 'company_lead', 'ref', 'lead:' || la.id, 'id', la.id,
      'who', coalesce(nullif(bl.lead_name, ''), bl.lead_phone, bl.lead_email, 'New lead'),
      'phone', bl.lead_phone, 'email', bl.lead_email, 'source', bl.source,
      'property', bl.property, 'assigned_at', la.assigned_at) x
    from public.lead_assignments la
    join public.brokerage_leads bl on bl.id = la.lead_id and bl.origin = 'company'
    where la.agent_user = v_uid and la.released_at is null and la.first_response_at is null
      and la.assigned_at < now() - interval '5 minutes'
      and not exists (select 1 from public.chief_snoozes s where s.user_id = v_uid
                       and s.source_ref = 'lead:' || la.id and s.until > v_today)
    order by la.assigned_at limit 3) q;

  -- 3. Missed callers not called or texted back since (last 7 days).
  with missed as (
    select right(regexp_replace(coalesce(qc.from_number, ''), '\D', '', 'g'), 10) num,
           max(coalesce(qc.op_created_at, qc.created_at)) last_at, count(*) times,
           (array_agg(qc.contact_id order by coalesce(qc.op_created_at, qc.created_at) desc) filter (where qc.contact_id is not null))[1] contact_id,
           (array_agg(qc.from_number order by coalesce(qc.op_created_at, qc.created_at) desc))[1] phone
      from public.quo_calls qc
     where qc.user_id = v_uid and qc.direction in ('incoming', 'inbound')
       and coalesce(qc.op_created_at, qc.created_at) > now() - interval '7 days'
       and (qc.status in ('no-answer', 'missed', 'busy', 'canceled', 'failed')
            or (qc.status is null and qc.answered_at is null and coalesce(qc.duration, 0) = 0))
     group by 1)
  select coalesce(jsonb_agg(x order by x->>'last_at' desc), '[]'::jsonb) into c from (
    select jsonb_build_object(
      'kind', 'missed_call', 'ref', 'missed:' || m.num,
      'who', coalesce(ct.name, m.phone), 'named', ct.name is not null,
      'contact_id', m.contact_id, 'phone', m.phone, 'last_at', m.last_at, 'times', m.times) x
    from missed m
    left join public.contacts ct on ct.id = m.contact_id and ct.user_id = v_uid
    where length(m.num) = 10
      -- answered or returned since: any later call either way that connected, or any later text out
      and not exists (select 1 from public.quo_calls q2 where q2.user_id = v_uid
                        and right(regexp_replace(coalesce(case when q2.direction in ('outgoing','outbound') then q2.to_number else q2.from_number end, ''), '\D', '', 'g'), 10) = m.num
                        and coalesce(q2.op_created_at, q2.created_at) > m.last_at
                        and (q2.direction in ('outgoing', 'outbound') or q2.answered_at is not null or q2.status = 'completed'))
      and not exists (select 1 from public.quo_messages qm where qm.user_id = v_uid and qm.direction = 'outgoing'
                        and right(regexp_replace(coalesce(qm.to_number, ''), '\D', '', 'g'), 10) = m.num
                        and coalesce(qm.op_created_at, qm.created_at) > m.last_at)
      and not exists (select 1 from public.chief_snoozes s where s.user_id = v_uid
                       and s.source_ref = 'missed:' || m.num and s.until > v_today)
    order by m.last_at desc limit 3) q;

  -- One of each first (promise, lead, caller), then fill empty slots in that order.
  v_all := jsonb_build_array(p->0, l->0, c->0) || (p - 0) || (l - 0) || (c - 0);
  for e in select value from jsonb_array_elements(v_all) loop
    exit when jsonb_array_length(v_out) >= 3;
    if e is null or e = 'null'::jsonb or (e->>'ref') = any(v_seen) then continue; end if;
    v_out := v_out || jsonb_build_array(e - 'rank');
    v_seen := v_seen || (e->>'ref');
  end loop;
  return jsonb_build_object('ok', true, 'cards', v_out);
end $$;

revoke all on function public.today_three() from public, anon;
grant execute on function public.today_three() to authenticated, service_role;
comment on function public.today_three() is
  'Today: the three things for the signed-in person (promise due within 48h, overdue Company Lead, missed caller). Reads only; never sends. 2026-10-09.';

commit;
