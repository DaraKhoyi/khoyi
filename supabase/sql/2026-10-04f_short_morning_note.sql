-- 2026-10-04f — THE MORNING NOTE, REBUILT SHORT (design brief, decision 12).
--
-- Dara switched his briefing off on 27 Sep. Asked why: "Overwhelmed by all the
-- stuff." What every person with a phone set up was still receiving at 8am:
--   "Today: 53 emails worth a look · 25 owed replies · 84 going cold. Tap to handle."
-- Three inventory counts on a lock screen, before the day has started — the
-- opposite of the calm rule ("no inventory counts") and of Ray's ("nothing an
-- agent sees counts what they did not do").
--
-- The morning note now says, in this order and nothing else:
--   1. the first thing on the calendar today
--   2. a contract date that falls today or within three days
--   3. the goals the person chose for today, in their own words — or the question
-- No counts of mail, replies or contacts. Ever.
--   • user_settings.morning_note / morning_note_hour — the person's own switch and hour.
--   • contract_deadlines_for(user, days) — one rule for contract dates, shared by
--     the band on Today (my_contract_deadlines) and this note.
-- Idempotent: safe to run twice.

alter table public.user_settings add column if not exists morning_note boolean not null default true;
alter table public.user_settings add column if not exists morning_note_hour smallint not null default 8;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_morning_note_hour_ck') then
    alter table public.user_settings add constraint user_settings_morning_note_hour_ck check (morning_note_hour between 4 and 12);
  end if;
end $$;

-- ONE RULE for "contract dates coming up", for a named person. Internal.
create or replace function public.contract_deadlines_for(p_uid uuid, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.today_ny(); v_days int := greatest(0, least(coalesce(p_days, 7), 30)); v jsonb;
begin
  if p_uid is null then return '[]'::jsonb; end if;
  with d as (
    select coalesce(nullif(k.value ->> 'label', ''), 'Contract date') label, (k.value ->> 'date')::date due, coalesce(bt.address, 'A deal') about
      from brokerage_transactions bt join agents a on a.id = bt.agent_id,
           lateral jsonb_array_elements(case when jsonb_typeof(bt.key_dates) = 'array' then bt.key_dates else '[]'::jsonb end) k
     where a.auth_user_id = p_uid and bt.deal_status = 'active' and (k.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select coalesce(nullif(f.label, ''), initcap(replace(coalesce(f.kind, 'deadline'), '_', ' '))), f.due_date, 'A file'
      from file_deadlines f
     where f.user_id = p_uid and f.due_date is not null and coalesce(f.status, '') not in ('done', 'completed', 'cancelled', 'dismissed')
    union all
    select 'Closing', dl.close_date, coalesce(nullif(dl.address, ''), nullif(dl.name, ''), 'A deal')
      from deals dl
     where dl.user_id = p_uid and dl.close_date is not null
       and dl.status in ('under_contract', 'closing')   -- a signed contract; a listing's hoped-for date is not a deadline
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'date', due, 'about', about) order by due), '[]'::jsonb)
    into v from d where due between v_today and v_today + v_days;
  return v;
end $$;
revoke all on function public.contract_deadlines_for(uuid, integer) from public, anon, authenticated;

create or replace function public.my_contract_deadlines(p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return public.contract_deadlines_for(auth.uid(), greatest(1, coalesce(p_days, 7)));
end $$;
revoke all on function public.my_contract_deadlines(integer) from public, anon;
grant execute on function public.my_contract_deadlines(integer) to authenticated;

-- The words of the note for one person, for one day. Used by the 8am job and by
-- the card on Today, so the lock screen and the app always say the same thing.
create or replace function public.morning_note_for(p_uid uuid, p_tz text default 'America/New_York')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date; v_bits text[] := array[]::text[]; v_items jsonb := '[]'::jsonb;
        e record; d record; v_goals text[]; v_n int; s text;
begin
  begin v_today := (now() at time zone coalesce(nullif(p_tz, ''), 'America/New_York'))::date;
  exception when others then p_tz := 'America/New_York'; v_today := (now() at time zone p_tz)::date; end;

  -- 1. the first thing on today's calendar that has not already finished
  select ev.title, ev.start_at into e from events ev
   where ev.user_id = p_uid and not coalesce(ev.all_day, false) and coalesce(ev.status, '') <> 'cancelled'
     and coalesce(ev.event_kind, '') <> 'task_block'
     and (ev.start_at at time zone p_tz)::date = v_today and coalesce(ev.end_at, ev.start_at) >= now()
   order by ev.start_at limit 1;
  if found then
    s := 'First up: ' || trim(to_char(e.start_at at time zone p_tz, 'FMHH12:MI AM')) || ' — ' || left(coalesce(nullif(btrim(e.title), ''), 'an appointment'), 70);
    v_bits := v_bits || s; v_items := v_items || jsonb_build_array(jsonb_build_object('icon', 'alert', 'label', s, 'payload', 'calendar'));
  end if;

  -- 2. contract dates today or within three days: stated plainly, with the date
  for d in select x ->> 'label' label, (x ->> 'date')::date due, x ->> 'about' about
             from jsonb_array_elements(public.contract_deadlines_for(p_uid, 3)) x order by 2 limit 2 loop
    s := d.label || case when d.due = v_today then ' is today' else ' is ' || to_char(d.due, 'FMDay, FMMonth FMDD') end || ' — ' || d.about;
    v_bits := v_bits || s; v_items := v_items || jsonb_build_array(jsonb_build_object('icon', 'alert', 'label', s, 'payload', 'today'));
  end loop;

  -- 3. the goals the person chose for today, in their words — or the question
  select array_agg(left(g.text, 60) order by g.pos, g.created_at) into v_goals
    from day_goals g where g.user_id = p_uid and g.day = v_today and g.done_at is null and g.outcome is null;
  select coalesce(us.daily_goal_count, 3) into v_n from (select 1) one left join user_settings us on us.user_id = p_uid;
  if coalesce(array_length(v_goals, 1), 0) > 0 then
    s := 'Your goals: ' || array_to_string(v_goals, ' · ');
  else
    s := 'What ' || case coalesce(v_n, 3) when 1 then 'one thing' when 2 then 'two things' when 4 then 'four things' when 5 then 'five things' else 'three things' end || ' would make today a win?';
  end if;
  v_bits := v_bits || s; v_items := v_items || jsonb_build_array(jsonb_build_object('icon', 'signal', 'label', s, 'payload', 'today'));

  return jsonb_build_object('headline', array_to_string(v_bits, '. ') || case when right(s, 1) = '?' then '' else '.' end, 'items', v_items, 'day', v_today);
end $$;
revoke all on function public.morning_note_for(uuid, text) from public, anon, authenticated;

-- The job. Same schedule (hourly); each person at their own hour; once a day.
create or replace function public.morning_brief_run(p_force_user uuid default null)
 returns integer language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r record; n int := 0; v_key text; v_url text; v_today date; v jsonb;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  v_url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send';
  for r in
    select distinct on (a.user_id) a.user_id, coalesce(nullif(btrim(us.timezone), ''), 'America/New_York') tz
    from agents a left join user_settings us on us.user_id = a.user_id
    where a.user_id is not null
      and (p_force_user is not null and a.user_id = p_force_user
           or (p_force_user is null
               and coalesce(us.morning_note, true)
               and public.push_local_hour(a.user_id) = coalesce(us.morning_note_hour, 8)
               and exists(select 1 from push_subscriptions ps where ps.user_id=a.user_id)))
    order by a.user_id, a.id
  loop
    v := public.morning_note_for(r.user_id, r.tz);
    v_today := (v ->> 'day')::date;
    if exists(select 1 from morning_brief mb where mb.user_id=r.user_id and mb.brief_date=v_today) then continue; end if;
    insert into morning_brief(user_id, brief_date, headline, items, lead_count, deadline_count, cold_count, pushed_at)
    values (r.user_id, v_today, v ->> 'headline', v -> 'items', 0, 0, 0, now());
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body := jsonb_build_object('user_id', r.user_id, 'title', 'Good morning', 'body', v ->> 'headline', 'url','https://darasapp.com/', 'tag','morning-brief'));
    n := n + 1;
  end loop;
  return n;
end;$function$;
revoke all on function public.morning_brief_run(uuid) from public, anon, authenticated;

-- The card on Today reads the same words, made fresh, so goals chosen after 8am show.
create or replace function public.morning_brief_today()
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then return null; end if;
  v := public.morning_note_for(v_uid, (select coalesce(nullif(btrim(us.timezone), ''), 'America/New_York') from (select 1) one left join user_settings us on us.user_id = v_uid));
  return jsonb_build_object('headline', v ->> 'headline', 'items', v -> 'items', 'brief_date', v ->> 'day');
end $function$;
revoke all on function public.morning_brief_today() from public, anon;
grant execute on function public.morning_brief_today() to authenticated;

-- The person's own switch and hour.
create or replace function public.set_morning_note(p_on boolean default null, p_hour smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  if p_hour is not null and p_hour not between 4 and 12 then return jsonb_build_object('ok', false, 'error', 'a morning hour, 4 am to noon'); end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  update user_settings set morning_note = coalesce(p_on, morning_note), morning_note_hour = coalesce(p_hour, morning_note_hour), updated_at = now() where user_id = v_uid;
  return (select jsonb_build_object('ok', true, 'on', us.morning_note, 'hour', us.morning_note_hour) from user_settings us where us.user_id = v_uid);
end $$;
revoke all on function public.set_morning_note(boolean, smallint) from public, anon;
grant execute on function public.set_morning_note(boolean, smallint) to authenticated;

-- Settings read: the notification settings now include the morning note.
create or replace function public.my_notify() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select jsonb_build_object('mode', coalesce(us.notify_mode, 'live'), 'digest_hours', to_jsonb(coalesce(us.digest_hours, '{9,13,17}')),
           'quiet_start', coalesce(us.quiet_start, 21), 'quiet_end', coalesce(us.quiet_end, 8), 'urgent_breaks_quiet', coalesce(us.urgent_breaks_quiet, true),
           'morning_note', coalesce(us.morning_note, true), 'morning_note_hour', coalesce(us.morning_note_hour, 8),
           'devices', (select count(*) from push_subscriptions p where p.user_id = v_uid))
    into v from (select 1) one left join user_settings us on us.user_id = v_uid;
  return v;
end $$;
revoke all on function public.my_notify() from public, anon;
grant execute on function public.my_notify() to authenticated;
