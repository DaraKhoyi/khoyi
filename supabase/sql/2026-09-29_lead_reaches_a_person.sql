-- 2026-09-29 — A LEAD REACHES A PERSON, OR SOMEONE KNOWS IT DID NOT.
--
-- Marguerite (panel): "Lead concierge ran 530 times and sent zero replies … I
-- think the step is that nobody ever told the agent a lead was waiting."
-- She was right, in more ways than the numbers showed:
--
--   1. EVERY alert the database sent was refused. notify_lead_escalation (the
--      ladder's "New lead", "Passed to you", "Lead needs you") called push-send
--      with the signed service JWT, and push-send only recognised the other key
--      format — 401, no phone lit up, nothing recorded. (push-send now uses
--      _shared/serviceCaller.ts and logs every alert to push_log.)
--   2. The ladder offered leads to people PrismOS cannot reach. Josh is on it
--      with no device set up for alerts; company leads went to David Jordan and
--      Kamal, who have none and have not opened the app in months. A 5-minute
--      clock ran down on phones that could never ring.
--   3. An agent who answered from Gmail or the phone was treated as silent: the
--      ladder only saw an in-app "Claim" tap, so it could take a lead away from
--      the agent who had already called the buyer. And the agent's card stayed
--      "pending" forever (Ola answered Lilliam Rawlins in 6 minutes from Gmail;
--      her card still said pending six days later), which is why the concierge
--      looked like it "did nothing".
--   4. The panel's "acted on" for the concierge could only ever be 0: it counted
--      spend tied to a contact, and the concierge never said which card it paid for.
--
-- Of the 530 runs, ~500 were before 21 Sep, when the old gate carded nearly any
-- email; since then there have been 28 cards and 3 real leads.

-- ── Who can PrismOS actually reach? ────────────────────────────────────────
-- A working device: one registered for alerts that has not been refusing them.
-- (push-send now clears last_error on a successful delivery.)
create or replace function public.lead_reachable(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from push_subscriptions p where p.user_id = p_user and p.last_error is null)
$$;
revoke all on function public.lead_reachable(uuid) from public, anon;
grant execute on function public.lead_reachable(uuid) to authenticated, service_role;

-- ── 1. Alerts from the database use a key push-send accepts ────────────────
create or replace function public.notify_lead_escalation(p_lead uuid, p_agent uuid, p_kind text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v brokerage_leads; s lead_routing_settings; v_key text; v_hour int; v_who text; v_title text; v_body text; v_target uuid;
begin
  select * into s from lead_routing_settings where id = 1;
  select * into v from brokerage_leads where id = p_lead;
  v_hour := extract(hour from (now() at time zone 'America/New_York'))::int;
  v_who := coalesce(v.lead_name, v.lead_email, v.lead_phone, 'Someone');
  if p_kind = 'broker' then
    select auth_user_id into v_target from agents where production_role = 'broker' and auth_user_id is not null limit 1;
    v_title := 'Lead needs you: ' || v_who;
    v_body := coalesce(v.source,'Lead') || ' — no agent claimed it';
  else
    v_target := p_agent;
    v_title := case when p_kind = 'escalated' then 'Passed to you: ' || v_who else 'New lead: ' || v_who end;
    v_body := coalesce(v.source,'Lead') || ' — claim it within ' || s.claim_minutes || ' minutes or it moves on';
    if v_hour >= s.quiet_start or v_hour < s.quiet_end then return; end if;   -- clock runs, phone stays quiet
  end if;
  if v_target is null then return; end if;
  -- service_role_key (the key cron_call uses), not service_role_jwt: push-send
  -- refused the JWT with a 401 and no alert from here ever reached a phone.
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object('user_id', v_target, 'title', v_title, 'body', v_body,
      'url', 'https://darasapp.com/', 'tag', 'lead-' || p_lead::text));
end $$;

-- ── 2. The ladder offers a lead only to someone PrismOS can reach ──────────
create or replace function public.next_lead_agent(p_exclude uuid[] default '{}'::uuid[])
returns uuid language sql stable security definer set search_path = public as $$
  select a.auth_user_id from agents a
   where a.lead_eligible and a.active and a.auth_user_id is not null
     and (a.lead_paused_until is null or a.lead_paused_until < now())
     and not (a.auth_user_id = any(p_exclude))
     -- A lead offered to a phone that cannot ring is a lead lost for the whole
     -- claim window. Skip them; with nobody reachable the broker gets it at once.
     and public.lead_reachable(a.auth_user_id)
   order by (select max(la.assigned_at) from lead_assignments la where la.agent_user = a.auth_user_id) nulls first,
            a.name
   limit 1
$$;

do $$
declare d text;
begin
  select pg_get_functiondef('public.route_lead'::regproc) into d;
  -- "Already their contact" also has to be someone who will hear about it.
  if position('and not (c.user_id = any(v_tried))' in d) > 0 and position('lead_reachable(c.user_id)' in d) = 0 then
    d := replace(d, 'and not (c.user_id = any(v_tried))', 'and not (c.user_id = any(v_tried)) and public.lead_reachable(c.user_id)');
  end if;
  execute d;
end $$;

-- ── 3. Answering by email or phone counts, before the ladder moves a lead ──
create or replace function public.escalate_stale_leads()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s lead_routing_settings; v_routed int := 0; v_moved int := 0; v_kept int := 0; r record;
begin
  select * into s from lead_routing_settings where id = 1;
  if s.paused then return jsonb_build_object('paused', true); end if;

  for r in select id from brokerage_leads where status = 'unassigned' and received_at > now() - interval '14 days'
            and not exists (select 1 from lead_assignments la where la.lead_id = brokerage_leads.id and la.released_at is null)
            order by received_at limit 25 loop
    perform public.route_lead(r.id, 'unrouted');
    v_routed := v_routed + 1;
  end loop;

  for r in select la.id, la.lead_id, la.agent_user, la.assigned_at, b.lead_email, b.lead_phone from lead_assignments la
            join brokerage_leads b on b.id = la.lead_id and b.status = 'assigned'
           where la.released_at is null
             and ((la.claimed_at is null and la.assigned_at < now() - (s.claim_minutes || ' minutes')::interval)
               or (la.claimed_at is not null and la.first_response_at is null
                   and la.claimed_at < now() - (s.response_minutes || ' minutes')::interval))
           limit 25 loop
    -- The agent may have answered without opening PrismOS — a Gmail reply, a
    -- call. That IS claiming it. Never take a lead from the person already on it.
    if public.lead_was_acted(r.agent_user, r.lead_email, r.lead_phone, r.assigned_at) then
      update lead_assignments set claimed_at = coalesce(claimed_at, now()), first_response_at = coalesce(first_response_at, now()) where id = r.id;
      update brokerage_leads set first_response_at = coalesce(first_response_at, now()) where id = r.lead_id;
      v_kept := v_kept + 1;
      continue;
    end if;
    perform public.route_lead(r.lead_id, 'no response in time');
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('routed', v_routed, 'escalated', v_moved, 'answered_outside_app', v_kept);
end $$;

-- ── 4. A card closes itself when the person has been answered ──────────────
do $$
declare d text;
begin
  select pg_get_functiondef('public.stamp_first_response'::regproc) into d;
  if position('ANSWERED ANYWHERE' in d) = 0 then
    d := replace(d, E'  return n;\nend',
      E'  -- ANSWERED ANYWHERE (29 Sep): a reply from Gmail or a call closes the card.\n'
      || E'  -- Left pending, it read as "the concierge did nothing" and kept asking.\n'
      || E'  update lead_concierge set status = ''handled'', handled_at = coalesce(handled_at, first_response_at)\n'
      || E'   where status = ''pending'' and first_response_at is not null;\n\n  return n;\nend');
    execute d;
  end if;
end $$;
select public.stamp_first_response();
-- It ran every 30 minutes; a lead is a race. Every 5 now (it is one indexed pass).
select cron.alter_job(jobid, schedule := '*/5 * * * *') from cron.job where jobname = 'stamp-first-response';

-- ── 5. "Acted on" for the concierge means the card was answered ────────────
create or replace function public.ai_spend_with_outcome(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by (x->>'usd')::numeric desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'fn', l.fn,
      'calls', count(*),
      'usd', round(sum(l.cost_usd)::numeric, 2),
      'per_call', round((sum(l.cost_usd)/count(*))::numeric, 4),
      'with_subject', count(*) filter (where l.subject_id is not null),
      -- acted on: a CONTACT touched within 14 days of the spend, or a LEAD CARD
      -- (the concierge, since 29 Sep) whose person was answered, anywhere.
      'acted_on', count(*) filter (where public.spend_acted(l.subject_type, l.subject_id, l.created_at)),
      'acted_pct', round(100.0 * count(*) filter (where public.spend_acted(l.subject_type, l.subject_id, l.created_at))
        / nullif(count(*) filter (where l.subject_id is not null), 0), 0)
    ) x
    from ai_usage_log l
    where l.created_at > now() - (p_days || ' days')::interval
      and (l.user_id = auth.uid() or public.is_brokerage_staff() or auth.role() = 'service_role')
    group by l.fn
  ) s
$$;

create or replace function public.spend_acted(p_type text, p_id uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_type = 'contact' then exists (select 1 from contacts c where c.id = p_id
            and c.last_contact_at between p_at and p_at + interval '14 days')
    when p_type = 'lead_card' then exists (select 1 from lead_concierge lc where lc.id = p_id
            and (lc.first_response_at is not null or lc.status in ('sent', 'handled')))
    else false end
$$;
revoke all on function public.spend_acted(text, uuid, timestamptz) from public, anon, authenticated;

-- ── 6. The broker sees who PrismOS cannot reach ────────────────────────────
do $$
declare d text;
begin
  select pg_get_functiondef('public.speed_to_lead'::regproc) into d;
  if position('can_alert' in d) = 0 then
    d := replace(d, 'jsonb_build_object(''agent'', a.name,', 'jsonb_build_object(''agent'', a.name, ''can_alert'', public.lead_reachable(a.auth_user_id),');
    d := replace(d, 'group by a.name)', 'group by a.name, a.auth_user_id)');
    execute d;
  end if;
end $$;

-- ── 7. Every alert leaves a record; every card says whether it reached anyone ─
create table if not exists public.push_log (
  id bigserial primary key, user_id uuid, title text, tag text,
  sent int not null default 0, failed int not null default 0, note text,
  created_at timestamptz not null default now());
alter table public.push_log enable row level security;
drop policy if exists push_log_read on public.push_log;
create policy push_log_read on public.push_log for select to authenticated using (user_id = auth.uid() or public.is_brokerage_staff());
revoke all on public.push_log from anon;
grant select on public.push_log to authenticated;
create index if not exists push_log_user_at on public.push_log (user_id, created_at desc);
alter table public.push_subscriptions add column if not exists last_ok_at timestamptz, add column if not exists last_error_at timestamptz;
alter table public.lead_concierge add column if not exists alert_reached boolean;
