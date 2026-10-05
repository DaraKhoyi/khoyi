-- 2026-10-05 — FOUR OF DARA'S DECISIONS OF 5 OCT (Blueprint item 18).
--
--   1. Set-aside items are kept for 365 days, recoverable the whole time, then
--      removed automatically. (Replaces "kept with no time limit".) The removal
--      is itself a line in the record, so nothing goes without being said.
--        set_aside_keep_days()   ONE RULE for the number.
--        remove_old_set_aside()  the removal; run by the hourly commitment clock.
--        record_removals         one row per person per removal.
--   2. The Drive starting guess is removed. Everyone starts on three items and
--      three goals. Only the style letters still guess (tips pace).
--   3. (The results page is a screen change; nothing here.)
--   4. The long email briefing is retired for everyone: its hourly job is
--      unscheduled and every preference row is switched off. The short morning
--      note (2026-10-04f) is the one morning message.
--   5. Found by the release check while shipping this: the job that stamps a
--      lead's first response took 85 seconds every five minutes and timed out
--      twice in a day. Same answers, now in about a second.
-- Idempotent: safe to run twice.

-- ── 1. A year, then removed ──────────────────────────────────────────────────
create or replace function public.set_aside_keep_days() returns integer
language sql immutable as $$ select 365 $$;
-- Internal: only the database's own functions ask (anon_exposure caught it open).
revoke all on function public.set_aside_keep_days() from public, anon, authenticated;

create table if not exists public.record_removals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  n integer not null check (n > 0)
);
create index if not exists record_removals_user_at on public.record_removals (user_id, at desc);
alter table public.record_removals enable row level security;
drop policy if exists record_removals_own on public.record_removals;
create policy record_removals_own on public.record_removals for select using (user_id = auth.uid());
revoke insert, update, delete on public.record_removals from anon, authenticated;

-- Removes exactly what the record shows as set aside or left out, once it is
-- older than the keep period: the same rows, by the same date, as the_record_rows().
create or replace function public.remove_old_set_aside() returns integer
language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz := now() - make_interval(days => public.set_aside_keep_days()); v_n int := 0;
begin
  create temp table if not exists _gone (user_id uuid, src text, id uuid) on commit drop;
  truncate _gone;
  with d as (
    delete from commitments c
     where c.user_id is not null
       and coalesce(c.auto_expired_at, c.decided_at, c.created_at) < v_cut
       and ((c.status = 'expired' and c.auto_expired_at is not null)
            or (c.status = 'archived' and exists (select 1 from commitment_events e where e.commitment_id = c.id and e.event = 'archived_by_rules' and e.note is not null)))
    returning c.user_id, c.id)
  insert into _gone select user_id, 'commitment', id from d;
  with d as (
    delete from dropped_suggestions s
     where s.picked_up_at is null and s.created_at < v_cut
    returning s.user_id, s.id)
  insert into _gone select user_id, 'dropped', id from d;
  delete from record_marks m using _gone g where m.src = g.src and m.src_id = g.id;
  insert into record_removals (user_id, n) select user_id, count(*) from _gone where user_id is not null group by user_id;
  select count(*) into v_n from _gone;
  return v_n;
end $$;
revoke all on function public.remove_old_set_aside() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_short_fuse_commitments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update public.commitments
     set status = 'expired', auto_expired_at = now()
   where status = 'proposed'
     and auto_expired_at is null            -- brought back by hand: the person decides, not the clock
     -- A promise still dated in the future is not stale (the Fiduciary's point:
     -- a deadline must not vanish from the record before it arrives).
     and (due_date is null or due_date < public.today_ny())
     and created_at < now() - case coalesce(fuse, 'near')
                                when 'immediate' then interval '3 days'
                                when 'near' then interval '14 days'
                                else interval '30 days' end
     and public.dial_level(user_id, 'tidy_followups') <> 'off';   -- THE DIAL (4 Oct)
  get diagnostics n = row_count;
  perform public.remove_old_set_aside();   -- the same clock keeps a year, then removes (5 Oct)
  return n;
end $function$;
revoke all on function public.expire_short_fuse_commitments() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.the_record_rows(p_uid uuid)
 RETURNS TABLE(src text, id uuid, at timestamp with time zone, what text, who text, why text, quote text, undo text, flag text, spot boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and coalesce(lc.handled_at, lc.created_at) > now() - make_interval(days => public.set_aside_keep_days())
  union all
  -- The yearly tidy itself: what was removed, said plainly (5 Oct).
  select 'tidy', r.id, r.at,
         'Removed ' || case when r.n = 1 then 'one item' else r.n || ' items' end || ' set aside more than a year ago',
         null, 'Things I set aside or left out are kept for a year, then removed. You can remove any of them sooner.',
         null, null, null, false
    from record_removals r
   where r.user_id = p_uid and r.at > now() - make_interval(days => public.set_aside_keep_days())
$function$;
revoke all on function public.the_record_rows(uuid) from public, anon, authenticated;

-- ── 2. No Drive guess ────────────────────────────────────────────────────────
create or replace function public.apply_presentation_guess() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_primary text; v_hand jsonb; v_new jsonb := '{}'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  select coalesce(presentation -> 'hand_set', '[]'::jsonb) into v_hand from user_settings where user_id = v_uid;

  -- the style letter only: from the latest assessment, else from the person's own profile
  select k into v_primary
    from (select d.natural_scores from disc_assessments d where d.user_id = v_uid order by d.taken_at desc limit 1) a,
         lateral jsonb_each_text(coalesce(a.natural_scores, '{}'::jsonb)) e(k, val)
   where k in ('D', 'I', 'S', 'C') and val ~ '^-?\d+(\.\d+)?$' order by val::numeric desc limit 1;
  if v_primary is null then
    select p.primary_letter into v_primary from profiles p where p.user_id = v_uid and p.subject_kind = 'owner' and p.primary_letter in ('D', 'I', 'S', 'C') limit 1;
  end if;
  if v_primary is null then
    return jsonb_build_object('ok', true, 'guessed', false) || public.presentation_of(v_uid);
  end if;

  if not (v_hand ? 'tips_pace') then
    v_new := v_new || jsonb_build_object('tips_pace', case when v_primary in ('S', 'C') then 'balanced' else 'light' end);
  end if;
  -- Dara, 5 Oct: Drive results change nothing about how much a person is shown.
  update user_settings set presentation = coalesce(presentation, '{}'::jsonb) || v_new || jsonb_build_object('basis', 'style', 'guessed_at', to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')), updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true, 'guessed', true) || public.presentation_of(v_uid);
end $$;
revoke all on function public.apply_presentation_guess() from public, anon;
grant execute on function public.apply_presentation_guess() to authenticated;

-- ── 4. The long email briefing is retired ────────────────────────────────────
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'ari-briefing-deliver-hourly';
end $$;
update public.ari_briefing_prefs set enabled = false, updated_at = now() where enabled;

-- ── 5. stamp_first_response: the same answers, without the 85 seconds ───────
CREATE OR REPLACE FUNCTION public.stamp_first_response()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  -- 5 Oct 2026: the same answer, worked out once per person instead of once per
  -- card. The old form re-read every sent email for each of ~5,600 unanswered
  -- cards: 85 seconds of every five minutes, and two statement timeouts in a day
  -- (cron_health caught it). Proven identical on 752 cards, 388 of them answered.
  with cand as materialized (
    select c2.id, c2.user_id, c2.status, c2.sent_at, c2.handled_at, c2.first_seen_at, lower(c2.lead_email) em,
           case when c2.lead_phone is not null and length(regexp_replace(c2.lead_phone,'\D','','g')) >= 10 then right(regexp_replace(c2.lead_phone,'\D','','g'),10) end ph
      from lead_concierge c2 where c2.first_response_at is null and c2.first_seen_at > now() - interval '120 days'),
  out_ as materialized (
    select o.user_id, lower(t->>'email') em, o.internal_date
      from email_messages o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.to_addresses)='array' then o.to_addresses else '[]'::jsonb end) t
     where o.direction='outbound' and o.internal_date > now() - interval '121 days' and o.user_id in (select user_id from cand)),
  calls as materialized (
    select q.user_id, right(regexp_replace(coalesce(q.to_number,q.from_number,''),'\D','','g'),10) ph, q.created_at
      from quo_calls q where q.created_at > now() - interval '121 days' and q.user_id in (select user_id from cand)),
  x as (
    select c.id, least(case when c.status = 'sent' then c.sent_at end, c.handled_at,
        (select min(o.internal_date) from out_ o where o.user_id = c.user_id and o.em = c.em and o.internal_date >= c.first_seen_at),
        (select min(k.created_at) from calls k where k.user_id = c.user_id and k.ph = c.ph and k.created_at >= c.first_seen_at)) t
      from cand c)
  update lead_concierge c set first_response_at = x.t from x where c.id = x.id and x.t is not null;
  get diagnostics n = row_count;
  update brokerage_leads b set first_response_at = c.first_response_at from lead_concierge c
   where b.status='assigned' and b.first_response_at is null and c.user_id = b.assigned_to
     and c.first_response_at is not null and c.first_seen_at >= b.assigned_at - interval '1 hour'
     and ((b.lead_email is not null and lower(c.lead_email) = lower(b.lead_email)) or (b.lead_phone is not null and c.lead_phone = b.lead_phone));
  update lead_assignments la set first_response_at = c.first_response_at
    from lead_concierge c, brokerage_leads b
   where la.released_at is null and la.first_response_at is null
     and b.id = la.lead_id and c.user_id = la.agent_user and c.first_response_at is not null
     and c.first_seen_at >= la.assigned_at - interval '1 hour'
     and ((b.lead_email is not null and lower(c.lead_email) = lower(b.lead_email))
       or (b.lead_phone is not null and c.lead_phone = b.lead_phone));

  -- ANSWERED ANYWHERE (29 Sep): a reply from Gmail or a call closes the card.
  -- Left pending, it read as "the concierge did nothing" and kept asking.
  update lead_concierge set status = 'handled', handled_at = coalesce(handled_at, first_response_at)
   where status = 'pending' and first_response_at is not null;

  return n;
end $function$;
revoke all on function public.stamp_first_response() from public, anon, authenticated;
