-- 2026-09-27 — "Later": postpone a call on today's list, and get another name.
--
-- Dara, a Sunday: "I don't want to click skip on calls I should make and teach
-- the AI things I don't mean. I'd like to postpone these calls for a given
-- number of days because of something I know, and replace the contact with
-- another call."
--
-- Skip never trained anything (it was only logged), but it also did not hold:
-- the person was back on tomorrow's list, and the slot stayed empty. Postpone is
-- the honest version of what he meant:
--   * the person leaves today's list and is not chosen again until the date;
--   * his reason (optional, only he sees it) comes back WITH them — "Back from
--     postponed: after the closing on the 3rd";
--   * the next person due takes the slot, straight away;
--   * nothing about the person's priority, cadence or DISC changes. It is a
--     date he chose, not a lesson.

begin;

create table if not exists public.call_snoozes (
  user_id     uuid not null default auth.uid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  until_day   date not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, contact_id)
);
alter table public.call_snoozes enable row level security;
drop policy if exists call_snoozes_own on public.call_snoozes;
create policy call_snoozes_own on public.call_snoozes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.call_snoozes from public, anon;
grant select, delete on public.call_snoozes to authenticated;

-- Postpone one person p_days days, and put the next person due in their place.
create or replace function public.snooze_call(p_contact uuid, p_days int, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/New_York')::date;
  v_until date;
  v_next uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'postpone between 1 and 365 days'; end if;
  if not exists (select 1 from contacts where id = p_contact and user_id = v_uid) then
    raise exception 'not your contact';
  end if;
  v_until := v_today + p_days;

  insert into call_snoozes (user_id, contact_id, until_day, note)
  values (v_uid, p_contact, v_until, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (user_id, contact_id) do update set until_day = excluded.until_day, note = excluded.note, created_at = now();

  update daily_call_list set done_at = now(), outcome = 'postponed'
   where user_id = v_uid and day = v_today and contact_id = p_contact;
  insert into call_list_log (user_id, contact_id, outcome) values (v_uid, p_contact, 'postponed');

  -- The replacement: the next person due who is not already on today's list.
  select (x->>'id')::uuid into v_next
    from jsonb_array_elements(public.who_to_call_ranked(60)) with ordinality t(x, ord)
   where not exists (select 1 from daily_call_list d where d.user_id = v_uid and d.day = v_today
                       and d.contact_id = (x->>'id')::uuid)
   order by ord limit 1;
  if v_next is not null then
    insert into daily_call_list (user_id, day, contact_id, rank)
    select v_uid, v_today, v_next, coalesce(max(rank), 0) + 1 from daily_call_list where user_id = v_uid and day = v_today
    on conflict do nothing;
    select name into v_name from contacts where id = v_next;
  end if;

  return jsonb_build_object('ok', true, 'until', v_until, 'replacement_id', v_next, 'replacement_name', v_name);
end $$;

-- Undo: bring the person back to today's list, and take the replacement off
-- again if it has not been worked yet.
create or replace function public.unsnooze_call(p_contact uuid, p_replacement uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_today date := (now() at time zone 'America/New_York')::date;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  delete from call_snoozes where user_id = v_uid and contact_id = p_contact;
  update daily_call_list set done_at = null, outcome = null
   where user_id = v_uid and day = v_today and contact_id = p_contact and outcome = 'postponed';
  if p_replacement is not null then
    delete from daily_call_list where user_id = v_uid and day = v_today and contact_id = p_replacement and done_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.snooze_call(uuid, int, text) from public, anon;
revoke all on function public.unsnooze_call(uuid, uuid) from public, anon;
grant execute on function public.snooze_call(uuid, int, text) to authenticated;
grant execute on function public.unsnooze_call(uuid, uuid) to authenticated;

commit;
CREATE OR REPLACE FUNCTION public.who_to_call_ranked(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(x order by score desc, nm), '[]'::jsonb) from (
    select c.name nm,
      (case
        when c.last_communication_direction='inbound'
             and c.last_inbound_at is not null
             and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at)
             and (c.comms_settled_at is null or c.comms_settled_at < c.last_inbound_at) then 100
        when c.cadence_days is not null and (greatest(c.last_contact_at, c.comms_settled_at) is null
             or greatest(c.last_contact_at, c.comms_settled_at) < now() - (c.cadence_days || ' days')::interval)
          then 70 + least(coalesce(extract(day from now() - greatest(c.last_contact_at, c.comms_settled_at)), 30), 29)
        -- A FLOOR, NOT A FILLER. "else 10" made everyone with a phone number
        -- eligible, so this list always found five names even when nobody was
        -- due — which is why four people he had just marked settled were told
        -- back to him as calls to make. Fewer than five is an honest answer.
        -- Settling is itself a decision and counts as a touch for cadence.
        else null
      end) as score,
      jsonb_build_object('id', c.id) x
    from contacts c
    where c.user_id = auth.uid()
      and coalesce(btrim(c.phone), '') <> ''
      and not exists (select 1 from email_accounts ea where ea.user_id = auth.uid()
                        and lower(ea.email_address) = lower(coalesce(c.email,'')))
      and not exists (select 1 from agents ag where ag.auth_user_id = auth.uid()
                        and (lower(coalesce(ag.email,'')) = lower(coalesce(c.email,''))
                             or right(regexp_replace(coalesce(ag.phone,''),'\D','','g'),10) = right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10)))
      -- Someone else answering is still an answer. "They reached out and are
      -- waiting to hear back" stops being true the moment anyone here writes
      -- back: six people on this list had already been answered by Alex or Josh.
      and not exists (
        select 1 from email_messages m
         where m.direction = 'outbound' and m.user_id <> auth.uid()
           and c.last_inbound_at is not null and m.internal_date > c.last_inbound_at
           and coalesce(c.email,'') <> '' and m.to_addresses::text ilike '%' || lower(c.email) || '%')
      -- POSTPONED BY HIM (snooze_call). Something he knows that the app does
      -- not: the client is travelling, waiting on an appraisal, asked for next
      -- week. Not a verdict on the person and nothing is learned from it.
      and not exists (select 1 from call_snoozes s where s.user_id = auth.uid() and s.contact_id = c.id
                        and s.until_day > (now() at time zone 'America/New_York')::date)
      and (
        (c.last_communication_direction='inbound' and c.last_inbound_at is not null
          and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at)
          and (c.comms_settled_at is null or c.comms_settled_at < c.last_inbound_at))
        or (c.cadence_days is not null and (greatest(c.last_contact_at, c.comms_settled_at) is null
            or greatest(c.last_contact_at, c.comms_settled_at) < now() - (c.cadence_days || ' days')::interval))
      )
    order by score desc, c.name
    limit p_limit
  ) s
$function$;
CREATE OR REPLACE FUNCTION public.who_to_call_today(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_uid uuid := auth.uid();
  v_have int;
  v jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;

  select count(*) into v_have from daily_call_list where user_id = v_uid and day = v_today;

  -- First load of the day: choose the five and write them down.
  if v_have = 0 then
    insert into daily_call_list (user_id, day, contact_id, rank)
    select v_uid, v_today, (x->>'id')::uuid, ord
    from jsonb_array_elements(public.who_to_call_ranked(p_limit)) with ordinality as t(x, ord)
    on conflict do nothing;
  end if;

  -- Today's list, minus what has been handled.
  select coalesce(jsonb_agg(x order by d.rank), '[]'::jsonb) into v
  from daily_call_list d
  join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone,
      'disc', pr.primary_letter, 'disc_conf', pr.confidence,
      -- HIS REASON COMES BACK WITH THEM. A postponed call returns carrying the
      -- note he wrote when he postponed it, for a week after it comes due.
      'reason', coalesce(
        case when sn.contact_id is not null
             then 'Back from postponed' || coalesce(': ' || sn.note, '')
             when c.last_communication_direction='inbound'
              and c.last_inbound_at is not null
              and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at)
              and (c.comms_settled_at is null or c.comms_settled_at < c.last_inbound_at)
             then 'They reached out and are waiting to hear back'
             when c.cadence_days is not null and (c.last_contact_at is null
                  or c.last_contact_at < now() - (c.cadence_days || ' days')::interval)
             then 'Past due for a touch'
             when c.last_contact_at is null then 'You haven''t connected yet'
             else 'Worth a check-in' end, 'Worth a check-in')
    ) x
    from contacts c
    left join profiles pr on pr.contact_id = c.id and pr.user_id = v_uid
    left join call_snoozes sn on sn.user_id = v_uid and sn.contact_id = c.id
          and sn.until_day <= v_today and sn.until_day > v_today - 7
    where c.id = d.contact_id and c.user_id = v_uid
  ) t on true
  where d.user_id = v_uid and d.day = v_today and d.done_at is null
    -- The set is locked for the day so it does not churn under him, but a name
    -- he has since SETTLED, or that a teammate has since answered, drops off.
    -- Four people he had just marked settled were still being told back to him.
    and exists (select 1 from contacts c2 where c2.id = d.contact_id and (
         (c2.last_communication_direction = 'inbound' and c2.last_inbound_at is not null
          and (c2.last_outbound_at is null or c2.last_inbound_at > c2.last_outbound_at)
          and (c2.comms_settled_at is null or c2.comms_settled_at < c2.last_inbound_at))
      or (c2.cadence_days is not null and (greatest(c2.last_contact_at, c2.comms_settled_at) is null
          or greatest(c2.last_contact_at, c2.comms_settled_at) < now() - (c2.cadence_days || ' days')::interval))))
    and not exists (select 1 from contacts c3 join email_messages m
           on m.direction = 'outbound' and m.user_id <> v_uid
          and c3.last_inbound_at is not null and m.internal_date > c3.last_inbound_at
          and coalesce(c3.email,'') <> '' and m.to_addresses::text ilike '%' || lower(c3.email) || '%'
         where c3.id = d.contact_id);

  return coalesce(v, '[]'::jsonb);
end $function$;
