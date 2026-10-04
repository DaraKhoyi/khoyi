-- 2026-10-04g — THE PRISM EDGE, FOUNDATION (step 6 of the design brief, first part).
--
-- Dara, 4 Oct: "Can you design the amount of stuff you show each user to be
-- finetuned to their behavioral style?… a person's Grit might also play a role."
-- What the evidence allows (research report, 4 Oct): DISC is stable but nothing
-- published shows it predicts how a person responds to a screen; Grit is close
-- to conscientiousness. So (decision 9) the honest design is A STARTING GUESS
-- THE PERSON CAN SEE AND CHANGE — never a verdict, never a hidden rule.
--
-- This file builds only what does not need weeks of usage to be true:
--   • presentation settings — ordinary settings, each one obeyed by a screen:
--       today_items     1 or 3 things under "Needs you today"
--       evening_prompt  whether Today offers "Pick tomorrow's" after 3pm
--       tips_pace       light | balanced | thorough | off (how much PrismOS explains)
--     plus daily_goal_count, which already exists.
--   • apply_presentation_guess() — a starting guess from the person's own
--     results, written ONLY to settings the person has not set by hand.
--     These are coaching-practice guesses, not findings:
--       S or C leaning  → tips 'balanced' (a little more explanation)
--       D or I leaning  → tips 'light'
--       Drive results that suggest follow-through is hard → one item at a time
--       and two goals a day. The cut-off (overall under 45 of 100) is a
--       judgement, not a validated threshold. Nothing on screen says why.
--     A result that looks too good to be true is treated as unknown.
--   • delete_my_assessment() — the person can remove their results.
-- NOT built here (needs usage first): learning from behaviour; a retest offer.
-- Decision 2 stands: no score feeds lead routing, recognition or retention —
-- nothing in this file is read by any such job.
--
-- Also: the morning note now sees repeating calendar events.
-- Idempotent: safe to run twice.

alter table public.user_settings add column if not exists presentation jsonb not null default '{}'::jsonb;

create or replace function public.presentation_of(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today_items', case when (p ->> 'today_items') = '1' then 1 else 3 end,
    'evening_prompt', coalesce((p ->> 'evening_prompt')::boolean, true),
    'tips_pace', case when p ->> 'tips_pace' in ('light', 'balanced', 'thorough', 'off') then p ->> 'tips_pace' else null end,
    'daily_goal_count', coalesce(us.daily_goal_count, 3),
    'basis', coalesce(p ->> 'basis', 'standard'),
    'guessed_at', p ->> 'guessed_at',
    'hand_set', coalesce(p -> 'hand_set', '[]'::jsonb))
  from (select 1) one left join user_settings us on us.user_id = p_uid, lateral (select coalesce(us.presentation, '{}'::jsonb) p) x
$$;
revoke all on function public.presentation_of(uuid) from public, anon, authenticated;

create or replace function public.my_presentation() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '{}'::jsonb; end if;
  return public.presentation_of(auth.uid());
end $$;
revoke all on function public.my_presentation() from public, anon;
grant execute on function public.my_presentation() to authenticated;

-- The person's own choice. Marked as set by hand, so no guess ever moves it again.
create or replace function public.set_presentation(p_key text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  if not ((p_key = 'today_items' and p_value in ('1', '3'))
       or (p_key = 'evening_prompt' and p_value in ('true', 'false'))
       or (p_key = 'tips_pace' and p_value in ('light', 'balanced', 'thorough', 'off'))
       or (p_key = 'daily_goal_count' and p_value in ('1', '2', '3', '4', '5'))) then
    return jsonb_build_object('ok', false, 'error', 'not a choice');
  end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  if p_key = 'daily_goal_count' then
    update user_settings set daily_goal_count = p_value::smallint where user_id = v_uid;
    v := 'null'::jsonb;
  else
    v := case when p_key = 'today_items' then to_jsonb(p_value::int) when p_key = 'evening_prompt' then to_jsonb(p_value::boolean) else to_jsonb(p_value) end;
  end if;
  update user_settings
     set presentation = coalesce(presentation, '{}'::jsonb)
           || case when p_key = 'daily_goal_count' then '{}'::jsonb else jsonb_build_object(p_key, v) end
           || jsonb_build_object('hand_set', (select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
                 from (select jsonb_array_elements_text(coalesce(presentation -> 'hand_set', '[]'::jsonb)) k union select p_key) z)),
         updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true) || public.presentation_of(v_uid);
end $$;
revoke all on function public.set_presentation(text, text) from public, anon;
grant execute on function public.set_presentation(text, text) to authenticated;

-- A starting guess from the person's own results. Touches nothing set by hand.
create or replace function public.apply_presentation_guess() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a record; v_primary text; v_overall int; v_hits int; v_hand jsonb; v_new jsonb := '{}'::jsonb; v_goal smallint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  select coalesce(presentation -> 'hand_set', '[]'::jsonb), daily_goal_count into v_hand, v_goal from user_settings where user_id = v_uid;

  select d.natural_scores, d.drive into a from disc_assessments d where d.user_id = v_uid order by d.taken_at desc limit 1;
  if found then
    select k into v_primary from jsonb_each_text(coalesce(a.natural_scores, '{}'::jsonb)) e(k, val)
     where k in ('D', 'I', 'S', 'C') and val ~ '^-?\d+(\.\d+)?$' order by val::numeric desc limit 1;
    v_overall := case when (a.drive ->> 'overall') ~ '^\d+$' then (a.drive ->> 'overall')::int else null end;
    v_hits := case when (a.drive ->> 'distortionHits') ~ '^\d+$' then (a.drive ->> 'distortionHits')::int else 0 end;
    if v_hits >= 3 then v_overall := null; end if;   -- looks too good to be true: treated as unknown
  else
    -- no in-app assessment: the person's own profile may still hold their style letter
    select p.primary_letter into v_primary from profiles p where p.user_id = v_uid and p.subject_kind = 'owner' and p.primary_letter in ('D', 'I', 'S', 'C') limit 1;
  end if;
  if v_primary is null and v_overall is null then
    return jsonb_build_object('ok', true, 'guessed', false) || public.presentation_of(v_uid);
  end if;

  if v_primary is not null and not (v_hand ? 'tips_pace') then
    v_new := v_new || jsonb_build_object('tips_pace', case when v_primary in ('S', 'C') then 'balanced' else 'light' end);
  end if;
  if v_overall is not null and v_overall < 45 then
    if not (v_hand ? 'today_items') then v_new := v_new || jsonb_build_object('today_items', 1); end if;
    if not (v_hand ? 'daily_goal_count') and v_goal = 3 then update user_settings set daily_goal_count = 2 where user_id = v_uid; end if;
  end if;
  update user_settings set presentation = coalesce(presentation, '{}'::jsonb) || v_new || jsonb_build_object('basis', 'style', 'guessed_at', to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')), updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true, 'guessed', true) || public.presentation_of(v_uid);
end $$;
revoke all on function public.apply_presentation_guess() from public, anon;
grant execute on function public.apply_presentation_guess() to authenticated;

-- Remove my results. The assessment rows go; the Drive and at-work figures leave
-- my own profile; settings I chose by hand stay; the guess is forgotten.
create or replace function public.delete_my_assessment() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  delete from disc_assessments where user_id = v_uid;
  get diagnostics v_n = row_count;
  update profiles set signal_snapshot = coalesce(signal_snapshot, '{}'::jsonb) - 'drive' - 'adaptive', updated_at = now()
   where user_id = v_uid and subject_kind = 'owner';
  -- scores that came only from this assessment are cleared too
  update profiles set d_score = 0, i_score = 0, s_score = 0, c_score = 0, primary_letter = null, secondary_letter = null,
         baseline_d_score = null, baseline_i_score = null, baseline_s_score = null, baseline_c_score = null,
         baseline_primary = null, baseline_secondary = null, baseline_locked = false, baseline_source = null, baseline_taken_at = null,
         source = 'unset', confidence = 'unknown', confidence_pct = null
   where user_id = v_uid and subject_kind = 'owner' and baseline_source = 'self_assessment';
  update user_settings set presentation = (coalesce(presentation, '{}'::jsonb) - 'basis' - 'guessed_at') where user_id = v_uid;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;
revoke all on function public.delete_my_assessment() from public, anon;
grant execute on function public.delete_my_assessment() to authenticated;

-- ── The morning note sees repeating events ──────────────────────────────────
-- An event that repeats is stored once (its first occurrence). Does it fall today?
create or replace function public.event_occurs_on(p_start timestamptz, p_freq text, p_interval int, p_until date, p_day date, p_tz text)
returns boolean language sql immutable as $$
  select case
    when p_freq is null or p_freq = '' then (p_start at time zone p_tz)::date = p_day
    when (p_start at time zone p_tz)::date > p_day or (p_until is not null and p_until < p_day) then false
    when p_freq = 'daily' then (p_day - (p_start at time zone p_tz)::date) % greatest(1, coalesce(p_interval, 1)) = 0
    when p_freq = 'weekly' then (p_day - (p_start at time zone p_tz)::date) % (7 * greatest(1, coalesce(p_interval, 1))) = 0
    when p_freq = 'monthly' then extract(day from p_day) = extract(day from (p_start at time zone p_tz))
         and ((extract(year from p_day) * 12 + extract(month from p_day)) - (extract(year from (p_start at time zone p_tz)) * 12 + extract(month from (p_start at time zone p_tz))))::int % greatest(1, coalesce(p_interval, 1)) = 0
    when p_freq = 'yearly' then to_char(p_day, 'MM-DD') = to_char(p_start at time zone p_tz, 'MM-DD')
         and (extract(year from p_day) - extract(year from (p_start at time zone p_tz)))::int % greatest(1, coalesce(p_interval, 1)) = 0
    else false end
$$;

create or replace function public.morning_note_for(p_uid uuid, p_tz text default 'America/New_York')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date; v_bits text[] := array[]::text[]; v_items jsonb := '[]'::jsonb;
        e record; d record; v_goals text[]; v_n int; s text;
begin
  begin v_today := (now() at time zone coalesce(nullif(p_tz, ''), 'America/New_York'))::date;
  exception when others then p_tz := 'America/New_York'; v_today := (now() at time zone p_tz)::date; end;

  -- 1. the first thing on today's calendar that has not already finished —
  --    including an event that repeats and lands on today
  select x.title, x.at_ into e from (
    select ev.title,
           ((v_today::text || ' ' || to_char(ev.start_at at time zone p_tz, 'HH24:MI:SS'))::timestamp at time zone p_tz) at_,
           coalesce(ev.end_at, ev.start_at) - ev.start_at dur
      from events ev
     where ev.user_id = p_uid and not coalesce(ev.all_day, false) and coalesce(ev.status, '') <> 'cancelled'
       and coalesce(ev.event_kind, '') <> 'task_block'
       and public.event_occurs_on(ev.start_at, ev.recur_freq, ev.recur_interval, ev.recur_until, v_today, p_tz)
  ) x where x.at_ + x.dur >= now() order by x.at_ limit 1;
  if found then
    s := 'First up: ' || trim(to_char(e.at_ at time zone p_tz, 'FMHH12:MI AM')) || ' — ' || left(coalesce(nullif(btrim(e.title), ''), 'an appointment'), 70);
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
