-- 2026-09-27 — lead readiness: can this person actually buy, and when?
--
-- Marguerite (panel): "I am not going to answer 568 things to close 1 deal. The
-- number that matters is whether the lead could ever buy." Two separate faults:
--
--   1. THE NUMBER WAS WRONG. The panel's 568 "surfaced" were 30 days of cards,
--      566 of them made by the score-based gate retired on 21 Sep (no source).
--      Since the new gate, real leads arrive at a few a week. A 22.71% answer
--      rate over mostly-noise is a busy number, as she said. lead_funnel()
--      replaces it: recognised leads only, answered, answered inside five
--      minutes, CONVERSATION (the lead wrote back), readiness known, ready.
--   2. NOTHING SAID WHO COULD BUY. lead_readiness holds, per PERSON (a buyer who
--      inquires three times is one buyer), what is known: pre-approval or cash,
--      timeline, budget, areas, must-sell-first, already has an agent, repeat
--      inquiries, closed with us before — each fact with the words it came from
--      — a grade, and the one question to ask next. Written by the lead-qualify
--      edge function; read only through the lead RPCs below.
--
-- Pre-approval is only ever known because the buyer SAID it (CINC's badge is the
-- buyer's own answer on a registration form too). Portal leads do not carry it,
-- so the first reply now asks it and offers a lender, and lead-qualify reads the
-- answer when it comes back.

begin;

create table if not exists public.lead_readiness (
  id                uuid primary key default gen_random_uuid(),
  email             text,
  phone10           text,
  name              text,
  intent            text not null default 'buy' check (intent in ('buy','rent','sell')),
  grade             text not null default 'unknown' check (grade in ('ready','active','early','unknown')),
  facts             jsonb not null default '{}'::jsonb,
  signals           jsonb not null default '[]'::jsonb,
  ask_next          text,
  inquiries         int not null default 0,
  first_inquiry_at  timestamptz,
  last_inquiry_at   timestamptz,
  lead_replied_at   timestamptz,
  evidence_through  timestamptz,
  updated_at        timestamptz not null default now()
);
create unique index if not exists lead_readiness_email_uq on public.lead_readiness (lower(email)) where email is not null;
create unique index if not exists lead_readiness_phone_uq on public.lead_readiness (phone10) where phone10 is not null;
alter table public.lead_readiness enable row level security;
revoke all on public.lead_readiness from public, anon, authenticated;

create or replace function public.phone10(p text) returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '')
$$;

-- Internal: the readiness a card should show. Callers are definer RPCs that have
-- already decided the viewer may see this lead.
create or replace function public.lead_readiness_for(p_email text, p_phone text)
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select to_jsonb(r) - 'id' - 'email' - 'phone10'
    from lead_readiness r
   where (p_email is not null and lower(r.email) = lower(p_email))
      or (public.phone10(p_phone) is not null and r.phone10 = public.phone10(p_phone))
   order by (p_email is not null and lower(r.email) = lower(p_email)) desc, r.updated_at desc
   limit 1
$$;
revoke all on function public.lead_readiness_for(text, text) from public, anon, authenticated;

-- The agent's lead cards, now carrying readiness.
create or replace function public.lead_concierge_pending()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', lc.id, 'kind', lc.kind, 'source', lc.source,
    'needs_claim', exists (select 1 from lead_assignments la join brokerage_leads bl on bl.id = la.lead_id
       where la.agent_user = lc.user_id and la.released_at is null and la.claimed_at is null
         and ((bl.lead_email is not null and lower(bl.lead_email) = lower(lc.lead_email))
           or (bl.lead_phone is not null and bl.lead_phone = lc.lead_phone)
           or (bl.lead_name is not null and lower(bl.lead_name) = lower(coalesce(lc.lead_name,''))))), 'lead_name', lc.lead_name, 'lead_phone', lc.lead_phone,
    'lead_email', lc.lead_email, 'channel', lc.channel,
    'inbound_text', lc.inbound_text, 'draft', lc.draft,
    'draft_subject', lc.draft_subject, 'first_seen_at', lc.first_seen_at,
    'contact_id', coalesce(lc.contact_id, c.id), 'contact_name', c.name,
    'message_id', m.id, 'thread_id', m.thread_id,
    'full_body', coalesce(nullif(m.body_text,''), m.snippet),
    'subject', m.subject, 'triage', t.category, 'triage_summary', t.summary,
    'account_id', m.account_id, 'provider_thread_id', m.provider_thread_id,
    'provider_message_id', m.provider_message_id, 'is_mine', true,
    'readiness', case when lc.kind = 'lead' then public.lead_readiness_for(lc.lead_email, lc.lead_phone) end
  ) order by lc.first_seen_at desc) into v
  from lead_concierge lc
  left join contacts c on c.user_id = lc.user_id and lower(c.email) = lower(lc.lead_email)
  left join lateral (
    select id, thread_id, body_text, snippet, subject, account_id,
           provider_thread_id, provider_message_id
    from email_messages
    where user_id = lc.user_id and lower(from_address) = lower(lc.lead_email)
    order by internal_date desc limit 1) m on true
  left join email_triage t on t.thread_id = m.thread_id and t.user_id = lc.user_id
  where lc.status = 'pending' and lc.user_id = auth.uid()
    and not exists (
      select 1 from lead_sender_rules r
      where (r.user_id = lc.user_id or r.is_brokerage) and lower(r.sender) = lower(lc.lead_email)
        and r.kind in ('not_a_lead','unsubscribed','blocked'));
  return coalesce(v, '[]'::jsonb);
end;$function$;

-- The broker's routing queue, now carrying readiness — so the ready buyer goes
-- to the agent most likely to close, first.
create or replace function public.brokerage_lead_queue()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select case when not public.is_brokerage_staff() then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
    'id', b.id, 'source', b.source, 'lead_name', b.lead_name, 'lead_email', b.lead_email, 'lead_phone', b.lead_phone,
    'property', b.property, 'subject', b.subject, 'excerpt', b.excerpt, 'received_at', b.received_at,
    'minutes_waiting', round(extract(epoch from now() - b.received_at)/60),
    'received_by', (select name from agents where auth_user_id = b.received_by limit 1),
    'readiness', public.lead_readiness_for(b.lead_email, b.lead_phone)) order by b.received_at desc)
   from brokerage_leads b where b.status in ('unassigned','with_broker') and b.received_at > now() - interval '30 days'), '[]'::jsonb) end
$function$;

-- THE FUNNEL: the numbers that say whether leads are turning into business.
-- Recognised leads only (a source template, a referral, the IDX/franchise site,
-- or a stranger stating intent), counted once per PERSON. Staff or service role.
create or replace function public.lead_funnel(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not (public.is_brokerage_staff() or auth.role() = 'service_role') then
    return jsonb_build_object('error', 'staff only');
  end if;
  with arrivals as (
    select lower(lead_email) email, public.phone10(lead_phone) p10, first_seen_at at, first_response_at resp
      from lead_concierge
     where kind = 'lead' and source is not null and status not in ('not_a_lead', 'trash')
       and first_seen_at > now() - make_interval(days => p_days)
    union all
    select lower(lead_email), public.phone10(lead_phone), received_at, first_response_at
      from brokerage_leads where received_at > now() - make_interval(days => p_days)
  ), people as (
    -- count(distinct at): one email copied to two mailboxes is one inquiry.
    select coalesce(email, p10) who, min(at) first_at, min(resp) first_resp, count(distinct at) inquiries,
           max(email) email, max(p10) p10
      from arrivals where coalesce(email, p10) is not null group by 1
  ), graded as (
    select p.*, r.grade, r.lead_replied_at,
           (r.facts -> 'preapproval' ->> 'value') pre
      from people p
      left join lead_readiness r on (p.email is not null and lower(r.email) = p.email) or (p.p10 is not null and r.phone10 = p.p10)
  )
  select jsonb_build_object(
    'days', p_days,
    'leads', count(*),
    'answered', count(*) filter (where first_resp is not null),
    'answered_in_5_min', count(*) filter (where first_resp <= first_at + interval '5 minutes'),
    'lead_wrote_back', count(*) filter (where lead_replied_at is not null),
    'preapproval_known', count(*) filter (where pre is not null),
    'ready', count(*) filter (where grade = 'ready'),
    'active', count(*) filter (where grade = 'active'),
    'early', count(*) filter (where grade = 'early'),
    'unknown', count(*) filter (where grade is null or grade = 'unknown'),
    'repeat_inquirers', count(*) filter (where inquiries > 1),
    -- Cards the gate showed that were NOT recognised leads. Should sit near zero;
    -- if it climbs, the gate is leaking noise onto agents' phones again.
    'noise_cards', (select count(*) from lead_concierge
                     where kind = 'lead' and source is null and first_seen_at > now() - make_interval(days => p_days)
                       and first_seen_at > '2026-09-22'::timestamptz)
  ) into v from graded;
  return v;
end;$function$;
revoke all on function public.lead_funnel(int) from public, anon;
grant execute on function public.lead_funnel(int) to authenticated, service_role;

commit;

-- Every 15 minutes: re-read anyone who wrote since last time (their answer to
-- "are you pre-approved?" lands here). Service-role JWT from Vault.
select cron.schedule('lead-qualify-15min', '*/15 * * * *', $$
  select public.cron_call('lead-qualify-15min',
    'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/lead-qualify',
    jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_jwt')),
    '{}'::jsonb) $$)
 where not exists (select 1 from cron.job where jobname = 'lead-qualify-15min');
