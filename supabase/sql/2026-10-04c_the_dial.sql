-- 2026-10-04c — THE DIAL: the person sets how much PrismOS does on its own.
--
-- Dara, 4 Oct: "I do want to be able to throttle what is being done for me."
-- The old picker (Manual / Suggest / Batch-approve / Aggressive) was read by
-- nothing and was removed on 4 Oct (v1.10.03). This is its replacement, and the
-- rule it is built on: A LEVEL IS ONLY OFFERED WHERE A JOB OBEYS IT.
--
-- ONE RULE, ONE PLACE: dial_level(user, category) is the only answer to "may
-- PrismOS do this on its own for this person?". Every job asks it — the SQL jobs
-- below directly, the edge functions through _shared/dial.ts.
--
-- Levels (design brief, decision 6): off · suggest · tell · quiet.
--   off      nothing in this category
--   suggest  prepares it and waits for a yes
--   tell     does it, and says so (the record, and a question the day before)
--   quiet    does it, and lists it in the record only
-- Categories that exist today, and the levels each really has:
--   call_followups  follow-ups heard on calls            off | suggest
--   tidy_followups  suggestions left unanswered          off | tell | quiet
--   lead_drafts     draft replies to new leads           off | suggest
--   calendar        put tasks on the calendar            off | tell
--   calls_personal  personal plans heard on calls        off | suggest
-- Pause: automation_paused makes every category 'off' until the person resumes.
-- Locked, at every level (decision 5): nothing written by AI is sent without a
-- yes; mail from someone the person knows always reaches the Inbox.
-- Idempotent: safe to run twice.

alter table public.user_settings add column if not exists dial jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists automation_paused boolean not null default false;

create or replace function public.dial_allowed(p_cat text) returns text[]
language sql immutable as $$
  select case p_cat
    when 'call_followups' then array['off', 'suggest']
    when 'tidy_followups' then array['off', 'tell', 'quiet']
    when 'lead_drafts'    then array['off', 'suggest']
    when 'calendar'       then array['off', 'tell']
    when 'calls_personal' then array['off', 'suggest']
    else array[]::text[] end
$$;

-- The setting as the person chose it (ignores pause). Two categories keep the
-- switch they already had, so there is still one place each is stored.
create or replace function public.dial_chosen(p_user uuid, p_cat text) returns text
language sql stable security definer set search_path = public as $$
  select case p_cat
    when 'calendar'       then case when coalesce((select s.auto_schedule_tasks from user_settings s where s.user_id = p_user), false) then 'tell' else 'off' end
    when 'calls_personal' then case when coalesce((select s.calls_personal from user_settings s where s.user_id = p_user), false) then 'suggest' else 'off' end
    when 'lead_drafts'    then coalesce((select s.dial ->> 'lead_drafts' from user_settings s where s.user_id = p_user),
                                        case when (select l.enabled from lead_concierge_settings l where l.user_id = p_user) is false then 'off' else 'suggest' end)
    when 'call_followups' then coalesce((select s.dial ->> 'call_followups' from user_settings s where s.user_id = p_user), 'suggest')
    when 'tidy_followups' then coalesce((select s.dial ->> 'tidy_followups' from user_settings s where s.user_id = p_user), 'tell')
    else 'off' end
$$;
revoke all on function public.dial_chosen(uuid, text) from public, anon, authenticated;

-- THE RULE. What a job may do right now.
create or replace function public.dial_level(p_user uuid, p_cat text) returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce((select s.automation_paused from user_settings s where s.user_id = p_user), false) then 'off'
              else public.dial_chosen(p_user, p_cat) end
$$;
revoke all on function public.dial_level(uuid, text) from public, anon, authenticated;

-- What the Settings page shows.
create or replace function public.my_dial() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('paused', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object(
    'paused', coalesce((select s.automation_paused from user_settings s where s.user_id = v_uid), false),
    'items', (select jsonb_agg(jsonb_build_object('cat', c, 'level', public.dial_chosen(v_uid, c), 'allowed', to_jsonb(public.dial_allowed(c))) order by ord)
                from unnest(array['call_followups', 'tidy_followups', 'lead_drafts', 'calendar', 'calls_personal']) with ordinality u(c, ord)));
end $$;
revoke all on function public.my_dial() from public, anon;
grant execute on function public.my_dial() to authenticated;

create or replace function public.set_dial(p_cat text, p_level text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  if not (p_level = any (public.dial_allowed(p_cat))) then return jsonb_build_object('ok', false, 'error', 'not a level this category has'); end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  if p_cat = 'calendar' then
    update user_settings set auto_schedule_tasks = (p_level = 'tell'), updated_at = now() where user_id = v_uid;
  elsif p_cat = 'calls_personal' then
    update user_settings set calls_personal = (p_level = 'suggest'), updated_at = now() where user_id = v_uid;
  else
    update user_settings set dial = coalesce(dial, '{}'::jsonb) || jsonb_build_object(p_cat, p_level), updated_at = now() where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true) || public.my_dial();
end $$;
revoke all on function public.set_dial(text, text) from public, anon;
grant execute on function public.set_dial(text, text) to authenticated;

create or replace function public.set_dial_paused(p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'signed out'); end if;
  insert into user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  update user_settings set automation_paused = coalesce(p_paused, false), updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true) || public.my_dial();
end $$;
revoke all on function public.set_dial_paused(boolean) from public, anon;
grant execute on function public.set_dial_paused(boolean) to authenticated;

-- ── The jobs obey ────────────────────────────────────────────────────────────
-- Setting aside: never for a person who turned tidying off (or paused).
create or replace function public.expire_short_fuse_commitments()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
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
  return n;
end $function$;

-- The day-before question: asked at 'tell'. At 'quiet' the person chose not to be
-- asked; at 'off' nothing is going to be set aside, so there is nothing to ask.
create or replace function public.warn_commitments_before_set_aside()
returns integer
language plpgsql security definer set search_path = public, vault as $$
declare
  v_key text; v_hour int; r record; n int := 0;
begin
  v_hour := extract(hour from (now() at time zone 'America/New_York'))::int;
  if v_hour < 9 or v_hour >= 19 then return 0; end if;   -- nobody's phone buzzes at night
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return 0; end if;

  for r in
    with due as (
      select c.id, c.user_id, c.title, c.created_at, ct.name contact_name,
             public.commitment_set_aside_at(c) aside_at
        from commitments c left join contacts ct on ct.id = c.contact_id
       where c.status = 'proposed' and c.auto_expired_at is null and c.expiry_warned_at is null
         and coalesce(c.fuse, 'near') <> 'immediate'
         and c.user_id is not null
         and public.dial_level(c.user_id, 'tidy_followups') = 'tell'   -- THE DIAL (4 Oct)
    )
    select user_id, array_agg(id) ids, count(*) n,
           (array_agg(title order by aside_at, created_at))[1] first_title,
           (array_agg(contact_name order by aside_at, created_at))[1] first_who
      from due
     where aside_at > now() and aside_at <= now() + interval '24 hours'
     group by user_id
  loop
    perform net.http_post(
      url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', 'From your calls',
        'body', left(coalesce(nullif(r.first_title, ''), 'A follow-up from your calls'), 90)
                || case when r.first_who is not null then ' (' || r.first_who || ')' else '' end
                || case when r.n > 1 then ' and ' || (r.n - 1) || ' more' else '' end
                || ' — still worth doing? Tap to keep or skip.',
        'url', 'https://darasapp.com/',
        'tag', 'commitments-expiring'));
    update commitments set expiry_warned_at = now() where id = any(r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.warn_commitments_before_set_aside() from public, anon, authenticated;

-- LOCKED (decision 5): nothing written by AI is sent without a yes. The lead
-- assistant had a timed auto-send path that no screen could switch on and no
-- account used. It now does nothing, so the lock is true and not merely unused.
create or replace function public.lead_concierge_autosweep()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
begin
  return 0;   -- locked: a draft waits for the person's own tap on Send
end;$function$;

-- LOCKED (decision 5): mail from someone the person knows — a contact, or anyone
-- they have written to — always reaches the Inbox's "This week". Until today that
-- depended on Gmail marking the thread important.
create or replace function public.known_sender_reaches_inbox()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.direction = 'inbound' and NEW.thread_id is not null
     and coalesce(NEW.labels, '{}') @> array['INBOX']
     and not (coalesce(NEW.labels, '{}') && array['SPAM', 'TRASH', 'CATEGORY_PROMOTIONS'])
     and exists (select 1 from email_known_senders k where k.user_id = NEW.user_id and k.email = lower(NEW.from_address)) then
    update email_threads
       set flagged_at = coalesce(NEW.internal_date, now()), flagged_why = 'From someone you know'
     where id = NEW.thread_id and flagged_at is null and not coalesce(worth_a_look, false);
  end if;
  return NEW;
end $function$;
revoke all on function public.known_sender_reaches_inbox() from public, anon, authenticated;
-- email_messages is a view over email_messages_all (it hides spam and trash); the
-- trigger belongs on the table the mail is written to.
drop trigger if exists known_sender_reaches_inbox_trg on public.email_messages_all;
create trigger known_sender_reaches_inbox_trg after insert on public.email_messages_all
  for each row execute function public.known_sender_reaches_inbox();

-- This week's mail already here.
update email_threads t
   set flagged_at = t.last_message_at, flagged_why = 'From someone you know'
 where t.last_message_at > now() - interval '7 days' and t.flagged_at is null and not coalesce(t.worth_a_look, false)
   and coalesce(t.labels, '{}') @> array['INBOX'] and not (coalesce(t.labels, '{}') && array['SPAM', 'TRASH', 'CATEGORY_PROMOTIONS'])
   and exists (select 1 from email_messages m join email_known_senders k on k.user_id = t.user_id and k.email = lower(m.from_address)
                where m.thread_id = t.id and m.direction = 'inbound');
