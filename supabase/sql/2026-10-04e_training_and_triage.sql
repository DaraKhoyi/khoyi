-- 2026-10-04e — TRAINING AND TRIAGE (step 5 of the design brief).
--
-- TRIAGE. Found on 4 Oct: the broker's phone received "N people are waiting on
-- you" up to 319 TIMES A DAY (118, 189, 319 on three days running), each to four
-- devices. The sender's "at most one an hour" rule remembered the last push with
-- an UPDATE on notification_prefs — and his account had no row, so the update
-- changed nothing and the limit never held. Asked why his 7am briefing was off,
-- he had said: "Overwhelmed by all the stuff."
--
-- ONE RULE, ONE PLACE: push_gate(user, tag) decides whether a notification may
-- reach a phone now. Every push already goes through push-send; push-send now
-- asks. So a limit can no longer depend on each sender remembering to keep one.
--   urgent    a new lead, a contract date        — at once; in quiet hours too unless the person says no
--   scheduled the daily briefing                 — at the time the person chose
--   prompt    a broken connection, the brief…    — at once outside quiet hours
--   batchable reply reminders, "still worth doing?" — at once, or in the person's digests
-- Held notifications are kept (push_held, the latest per kind) and delivered as
-- ONE notification at the next allowed moment. Nothing is dropped.
--
-- TRAINING. "I want to train my AI" (Dara, 2 Oct). What PrismOS learns from a
-- person is now something they can read, forget one line of, or start over:
-- my_learned(), forget_learned(), reset_learned(). New things it can learn: a
-- caller it should stop taking suggestions from, and why something was put off.
-- Idempotent: safe to run twice.

-- ── 1. Per-person notification settings ─────────────────────────────────────
alter table public.user_settings add column if not exists notify_mode text not null default 'live';
alter table public.user_settings add column if not exists digest_hours smallint[] not null default '{9,13,17}';
alter table public.user_settings add column if not exists quiet_start smallint not null default 21;
alter table public.user_settings add column if not exists quiet_end smallint not null default 8;
-- TRUE by default: a new lead or a contract date reaches the person at night exactly
-- as it did before this gate existed. The person can turn that off.
alter table public.user_settings add column if not exists urgent_breaks_quiet boolean not null default true;
alter table public.user_settings alter column urgent_breaks_quiet set default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_notify_mode_ck') then
    alter table public.user_settings add constraint user_settings_notify_mode_ck check (notify_mode in ('live', 'digest'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_settings_quiet_hours_ck') then
    alter table public.user_settings add constraint user_settings_quiet_hours_ck check (quiet_start between 0 and 23 and quiet_end between 0 and 23);
  end if;
end $$;

-- The row the old hourly limit needed. Every person with mail connected has one now.
insert into public.notification_prefs (user_id)
select distinct a.user_id from public.email_accounts a where a.user_id is not null
on conflict (user_id) do nothing;

create table if not exists public.push_held (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tag_class text not null,          -- the tag without its id, so one kind keeps one line
  title text, body text, url text, tag text,
  why text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create unique index if not exists push_held_one_waiting on public.push_held (user_id, tag_class) where delivered_at is null;
alter table public.push_held enable row level security;
drop policy if exists push_held_own on public.push_held;
create policy push_held_own on public.push_held for select using (user_id = auth.uid());
revoke insert, update, delete on public.push_held from anon, authenticated;

create or replace function public.push_class(p_tag text) returns text
language sql immutable as $$
  select case
    when p_tag is null or p_tag = '' then 'prompt'
    when p_tag like 'lead-%' or p_tag in ('concierge', 'contract-date') then 'urgent'
    when p_tag in ('push-test', 'alert-test') or p_tag like 'smoke-%' then 'test'
    when p_tag in ('morning-brief', 'briefing') then 'scheduled'   -- the person chose the time it arrives
    when p_tag in ('owe-reply', 'commitments-expiring') then 'batchable'
    else 'prompt' end
$$;

create or replace function public.push_local_hour(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  select nullif(btrim(s.timezone), '') into v_tz from user_settings s where s.user_id = p_user;
  begin
    return extract(hour from (now() at time zone coalesce(v_tz, 'America/New_York')))::int;
  exception when others then
    return extract(hour from (now() at time zone 'America/New_York'))::int;   -- an unrecognised zone name
  end;
end $$;
revoke all on function public.push_local_hour(uuid) from public, anon, authenticated;

-- THE RULE. action: send | hold | skip.
create or replace function public.push_gate(p_user uuid, p_tag text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_class text := public.push_class(p_tag); s record; v_hour int; v_quiet boolean;
begin
  if v_class in ('test', 'scheduled') then return jsonb_build_object('action', 'send'); end if;
  select coalesce(us.notify_mode, 'live') mode, coalesce(us.quiet_start, 21) qs, coalesce(us.quiet_end, 8) qe, coalesce(us.urgent_breaks_quiet, true) brk
    into s from (select 1) one left join user_settings us on us.user_id = p_user;
  v_hour := public.push_local_hour(p_user);
  v_quiet := case when s.qs = s.qe then false
                  when s.qs < s.qe then v_hour >= s.qs and v_hour < s.qe
                  else v_hour >= s.qs or v_hour < s.qe end;
  -- Reply reminders: at most one an hour, whoever sends them and however often mail arrives.
  if p_tag = 'owe-reply' and exists (select 1 from push_log l where l.user_id = p_user and l.tag = 'owe-reply'
        and l.created_at > now() - interval '60 minutes' and coalesce(l.note, '') not like 'held%' and coalesce(l.note, '') not like 'skipped%') then
    return jsonb_build_object('action', 'skip', 'why', 'skipped: one reply reminder an hour');
  end if;
  if v_quiet then
    if v_class = 'urgent' and s.brk then return jsonb_build_object('action', 'send'); end if;
    return jsonb_build_object('action', 'hold', 'why', 'held: quiet hours');
  end if;
  if s.mode = 'digest' and v_class = 'batchable' then
    return jsonb_build_object('action', 'hold', 'why', 'held: for your next update');
  end if;
  return jsonb_build_object('action', 'send');
end $$;
revoke all on function public.push_gate(uuid, text) from public, anon, authenticated;

-- Deliver what was held, as ONE notification, at the next allowed moment:
-- after quiet hours end; and in digest mode only at the person's chosen hours.
create or replace function public.deliver_held_pushes() returns integer
language plpgsql security definer set search_path = public, vault as $$
declare v_key text; u record; r record; s record; v_hour int; v_quiet boolean; v_all boolean; n int := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return 0; end if;
  for u in select distinct h.user_id from push_held h where h.delivered_at is null loop
    select coalesce(us.notify_mode, 'live') mode, coalesce(us.quiet_start, 21) qs, coalesce(us.quiet_end, 8) qe, coalesce(us.digest_hours, '{9,13,17}') hours
      into s from (select 1) one left join user_settings us on us.user_id = u.user_id;
    v_hour := public.push_local_hour(u.user_id);
    v_quiet := case when s.qs = s.qe then false when s.qs < s.qe then v_hour >= s.qs and v_hour < s.qe else v_hour >= s.qs or v_hour < s.qe end;
    continue when v_quiet;
    -- "A few times a day": batchable ones wait for a chosen hour. Anything else that
    -- was held (overnight) goes out as soon as quiet hours end.
    v_all := s.mode = 'live' or v_hour = any (s.hours);
    select count(*) n, array_agg(h.id) ids, (array_agg(h.title order by h.created_at desc))[1:3] titles, (array_agg(h.url order by h.created_at desc))[1] url
      into r from push_held h
     where h.user_id = u.user_id and h.delivered_at is null and (v_all or public.push_class(h.tag) <> 'batchable');
    continue when coalesce(r.n, 0) = 0;
    continue when exists (select 1 from push_log l where l.user_id = u.user_id and l.tag = 'digest' and l.created_at > now() - interval '50 minutes');
    perform net.http_post(
      url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('user_id', u.user_id, 'digest', true, 'tag', 'digest',
        'title', case when r.n = 1 then coalesce(r.titles[1], 'PrismOS') else 'Kept for you' end,
        'body', case when r.n = 1 then 'Held until now, as you asked.' else array_to_string(r.titles, ' · ') end,
        'url', coalesce(r.url, 'https://darasapp.com/')));
    update push_held set delivered_at = now() where id = any (r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.deliver_held_pushes() from public, anon, authenticated;
do $$ begin
  -- only if missing: re-scheduling would discard the job's run history
  if not exists (select 1 from cron.job where jobname = 'held-pushes-15min') then
    perform cron.schedule('held-pushes-15min', '1-59/15 * * * *', $c$ select public.deliver_held_pushes() $c$);
  end if;
end $$;

create or replace function public.my_notify() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select jsonb_build_object('mode', coalesce(us.notify_mode, 'live'), 'digest_hours', to_jsonb(coalesce(us.digest_hours, '{9,13,17}')),
           'quiet_start', coalesce(us.quiet_start, 21), 'quiet_end', coalesce(us.quiet_end, 8), 'urgent_breaks_quiet', coalesce(us.urgent_breaks_quiet, true),
           'devices', (select count(*) from push_subscriptions p where p.user_id = v_uid))
    into v from (select 1) one left join user_settings us on us.user_id = v_uid;
  return v;
end $$;
revoke all on function public.my_notify() from public, anon;
grant execute on function public.my_notify() to authenticated;

create or replace function public.set_notify(p_mode text default null, p_digest_hours smallint[] default null, p_quiet_start smallint default null, p_quiet_end smallint default null, p_urgent_breaks_quiet boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  if p_mode is not null and p_mode not in ('live', 'digest') then return jsonb_build_object('ok', false, 'error', 'not a choice'); end if;
  if p_digest_hours is not null and (coalesce(array_length(p_digest_hours, 1), 0) not between 1 and 4
       or exists (select 1 from unnest(p_digest_hours) h where h not between 0 and 23)) then
    return jsonb_build_object('ok', false, 'error', 'one to four times a day, on the hour');
  end if;
  if (p_quiet_start is not null and p_quiet_start not between 0 and 23) or (p_quiet_end is not null and p_quiet_end not between 0 and 23) then
    return jsonb_build_object('ok', false, 'error', 'not an hour');
  end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  update user_settings set notify_mode = coalesce(p_mode, notify_mode),
         digest_hours = coalesce((select array_agg(h order by h) from (select distinct h from unnest(p_digest_hours) h) x), digest_hours),
         quiet_start = coalesce(p_quiet_start, quiet_start), quiet_end = coalesce(p_quiet_end, quiet_end),
         urgent_breaks_quiet = coalesce(p_urgent_breaks_quiet, urgent_breaks_quiet), updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true) || public.my_notify();
end $$;
revoke all on function public.set_notify(text, smallint[], smallint, smallint, boolean) from public, anon;
grant execute on function public.set_notify(text, smallint[], smallint, smallint, boolean) to authenticated;

-- Transaction notifications carry a tag, and a contract date is marked as one.
drop function if exists public.notify_txn(uuid, text, text, text);
create or replace function public.notify_txn(p_user_id uuid, p_title text, p_body text, p_url text default 'https://darasapp.com/', p_tag text default 'transaction')
 returns void language plpgsql security definer set search_path to 'public', 'net', 'vault'
as $function$
declare v_key text;
begin
  if p_user_id is null then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'body', p_body, 'url', p_url, 'tag', p_tag),
    timeout_milliseconds := 8000);
exception when others then return;  -- never let a push failure break the transaction op
end;$function$;
-- (grants left as they were: this is called from triggers that run as the signed-in person)
do $$
declare v_def text; v_old text := 'on '' || to_char((d->>''date'')::date,''FMMon FMDD''),
            ''https://darasapp.com/'');';
begin
  select pg_get_functiondef('public.txn_deadline_sweep()'::regprocedure) into v_def;
  if position('''contract-date''' in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then raise exception 'txn_deadline_sweep: the notify call was not where this patch expects it'; end if;
  execute replace(v_def, v_old, 'on '' || to_char((d->>''date'')::date,''FMMon FMDD''),
            ''https://darasapp.com/'', ''contract-date'');');
end $$;

-- ── 2. Training ─────────────────────────────────────────────────────────────
alter table public.commitments add column if not exists brought_back_at timestamptz;
alter table public.dropped_suggestions add column if not exists teach boolean not null default true;
alter table public.chief_snoozes add column if not exists reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chief_snoozes_reason_ck') then
    alter table public.chief_snoozes add constraint chief_snoozes_reason_ck check (reason is null or reason in ('wrong_time', 'wrong_person', 'not_mine', 'too_small'));
  end if;
end $$;

-- "Stop suggesting follow-ups from calls with this person."
create table if not exists public.call_reader_mutes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);
alter table public.call_reader_mutes enable row level security;
drop policy if exists call_reader_mutes_own on public.call_reader_mutes;
create policy call_reader_mutes_own on public.call_reader_mutes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What was brought back by hand before today already counts as a lesson.
update public.commitments c set brought_back_at = e.at
  from (select distinct on (commitment_id) commitment_id, at from public.commitment_events
         where to_status = 'proposed' and from_status in ('expired', 'archived') and actor is not null order by commitment_id, at desc) e
 where e.commitment_id = c.id and c.brought_back_at is null;

-- Bringing a follow-up back from the record stamps it, so the lesson can be seen and forgotten.
do $$
declare v_def text; v_old text := 'set status = ''proposed'', decided_at = null, auto_expired_at = coalesce(auto_expired_at, now())';
begin
  select pg_get_functiondef('public.the_record_undo(text, uuid)'::regprocedure) into v_def;
  if position('brought_back_at = now()' in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then raise exception 'the_record_undo: the restore was not where this patch expects it'; end if;
  execute replace(v_def, v_old, v_old || ', brought_back_at = now()');
end $$;

-- Everything PrismOS has learned from this person, in plain lists.
create or replace function public.my_learned() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'not_things', coalesce((select jsonb_agg(x order by x.at desc) from (
        select 'not_thing' src, c.id::text id, c.title what, c.not_a_thing_at at from commitments c
         where c.user_id = v_uid and c.not_a_thing_at is not null order by c.not_a_thing_at desc limit 60) x), '[]'::jsonb),
    'brought_back', coalesce((select jsonb_agg(x order by x.at desc) from (
        select 'brought_commitment' src, c.id::text id, c.title what, c.brought_back_at at from commitments c where c.user_id = v_uid and c.brought_back_at is not null
        union all
        select 'brought_dropped', d.id::text, d.title, d.picked_up_at from dropped_suggestions d where d.user_id = v_uid and d.picked_up_at is not null and d.teach
        order by 4 desc limit 60) x), '[]'::jsonb),
    'callers', coalesce((select jsonb_agg(x order by x.at desc) from (
        select 'caller' src, m.contact_id::text id, coalesce(ct.name, 'Someone no longer in your contacts') what, m.created_at at
          from call_reader_mutes m left join contacts ct on ct.id = m.contact_id where m.user_id = v_uid) x), '[]'::jsonb),
    'put_off', coalesce((select jsonb_agg(x order by x.at desc) from (
        select 'put_off' src, s.source_ref id, s.reason, s.created_at at,
               coalesce((select string_agg(c.title, ' · ') from commitments c where c.user_id = v_uid and s.source_ref = 'call:' || c.call_id::text), 'Something on your list') what
          from chief_snoozes s where s.user_id = v_uid and s.reason is not null order by s.created_at desc limit 60) x), '[]'::jsonb),
    'senders', coalesce((select jsonb_agg(x order by x.at desc) from (
        select 'sender' src, r.id::text id, r.sender what, r.kind, r.created_at at
          from lead_sender_rules r where r.user_id = v_uid and not coalesce(r.is_brokerage, false) order by r.created_at desc limit 300) x), '[]'::jsonb),
    'brokerage_senders', coalesce((select jsonb_agg(distinct r.sender) from lead_sender_rules r where coalesce(r.is_brokerage, false)), '[]'::jsonb));
end $$;
revoke all on function public.my_learned() from public, anon;
grant execute on function public.my_learned() to authenticated;

-- Forget one line. Nothing else about the item changes: a dismissed suggestion
-- stays dismissed; only the lesson drawn from it goes.
create or replace function public.forget_learned(p_src text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int := 0;
begin
  if v_uid is null then return false; end if;
  if p_src = 'not_thing' then update commitments set not_a_thing_at = null where user_id = v_uid and id::text = p_id and not_a_thing_at is not null;
  elsif p_src = 'brought_commitment' then update commitments set brought_back_at = null where user_id = v_uid and id::text = p_id;
  elsif p_src = 'brought_dropped' then update dropped_suggestions set teach = false where user_id = v_uid and id::text = p_id;
  elsif p_src = 'caller' then delete from call_reader_mutes where user_id = v_uid and contact_id::text = p_id;
  elsif p_src = 'put_off' then update chief_snoozes set reason = null where user_id = v_uid and source_ref = p_id;
  elsif p_src = 'sender' then delete from lead_sender_rules where user_id = v_uid and id::text = p_id and not coalesce(is_brokerage, false);
  else return false; end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.forget_learned(text, text) from public, anon;
grant execute on function public.forget_learned(text, text) to authenticated;

-- Start over, one kind at a time or everything. Brokerage-wide rules are not the
-- person's to reset and are untouched.
create or replace function public.reset_learned(p_section text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_section not in ('not_things', 'brought_back', 'callers', 'put_off', 'senders', 'all') then return false; end if;
  if p_section in ('not_things', 'all') then update commitments set not_a_thing_at = null where user_id = v_uid and not_a_thing_at is not null; end if;
  if p_section in ('brought_back', 'all') then
    update commitments set brought_back_at = null where user_id = v_uid and brought_back_at is not null;
    update dropped_suggestions set teach = false where user_id = v_uid and teach and picked_up_at is not null;
  end if;
  if p_section in ('callers', 'all') then delete from call_reader_mutes where user_id = v_uid; end if;
  if p_section in ('put_off', 'all') then update chief_snoozes set reason = null where user_id = v_uid and reason is not null; end if;
  if p_section in ('senders', 'all') then delete from lead_sender_rules where user_id = v_uid and not coalesce(is_brokerage, false); end if;
  return true;
end $$;
revoke all on function public.reset_learned(text) from public, anon;
grant execute on function public.reset_learned(text) to authenticated;
