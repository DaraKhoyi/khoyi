-- 2026-09-30 — "WHO JUST ASKED": READY WHEN THE LEAD LANDS, NOT WHEN SOMEONE ASKS.
--
-- Panel (Simplifier + Marguerite + Newcomer): "lead-concierge and
-- contact-research run in parallel with no link — a lead arrives, no brief
-- fires, nobody knows if the contact can transact." Their fix was to run
-- contact-research (web research, ~30 cents, a page long) when a lead is
-- claimed. The better one, already half-built and never joined up:
--
--   * lead-qualify (can they act: budget, area, pre-approval, timeline, the one
--     question to ask) already runs on arrival — but it dropped every Zillow
--     email lead, because Zillow's per-buyer relay address looked like "the
--     portal". Fixed in the function.
--   * lead-brief (three lines from their own words, a fraction of a cent) only
--     ran when someone tapped "Who is this?" — 0 times in 514 cards — and read
--     nothing for portal leads. Now it runs on arrival for every recognised lead,
--     reading the portal message too, and states what PrismOS already knows.
--   * What PrismOS already knows about the person was never shown: already your
--     contact, written to you before, closed with the brokerage before. That is
--     plain lookups, no AI — lead_known_facts() below.
--   * The phone alert now carries the facts ("Zillow · rental · Wesley Chapel ·
--     Ask: move-in date?"), so the decision to call is made on the lock screen.
--
-- contact-research stays a deliberate, on-request tool: searching the web for a
-- stranger who sent one email is slow, costly, and more than the moment needs.

create or replace function public.lead_known_facts(p_user uuid, p_email text, p_phone text, p_before timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (select nullif(lower(btrim(p_email)), '') em, public.phone10(p_phone) p10),
  c as (   -- already in THIS agent's book (never another agent's — ownership rule)
    select ct.name, ct.created_at, ct.last_contact_at from contacts ct, k
     where ct.user_id = p_user
       and ((k.em is not null and lower(ct.email) = k.em) or (k.p10 is not null and public.phone10(ct.phone) = k.p10))
     order by ct.last_contact_at desc nulls last limit 1),
  w as (   -- they have written to this agent before this inquiry
    select count(*) n, min(m.internal_date) first_at from email_messages m, k
     where m.user_id = p_user and m.direction = 'inbound' and k.em is not null
       and lower(m.from_address) = k.em and m.internal_date < p_before - interval '10 minutes'),
  t as (   -- closed with the brokerage before (a fact about the company's client, no agent named)
    select bt.address, coalesce(bt.date_paid, bt.date_received) d from brokerage_transactions bt, k
     where k.em is not null and bt.kind = 'sale' and bt.client_email ilike '%' || k.em || '%'
     order by 2 desc nulls last limit 1)
  select coalesce(jsonb_agg(line) filter (where line is not null), '[]'::jsonb) from (
    select 'Already in your contacts' || coalesce(' as ' || (select name from c), '')
           || coalesce(' — last in touch ' || to_char((select last_contact_at from c), 'Mon FMDD, YYYY'), '') line
     where exists (select 1 from c)
    union all
    select 'Has written to you ' || n || ' time' || case when n = 1 then '' else 's' end || ' before (first ' || to_char(first_at, 'Mon YYYY') || ')'
      from w where n > 0
    union all
    select 'Past client of the brokerage — closed ' || coalesce(address, 'a sale') || coalesce(' in ' || extract(year from d)::int, '')
      from t
  ) s
$$;
revoke all on function public.lead_known_facts(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lead_known_facts(uuid, text, text, timestamptz) to service_role;

-- The card list carries the brief and what is known, so the card shows them
-- without a tap. (It never returned `brief`, so even a written brief was invisible.)
do $$
declare d text;
begin
  select pg_get_functiondef('public.lead_concierge_pending'::regproc) into d;
  if position('''known''' in d) = 0 then
    d := replace(d,
      $o$    'readiness', case when lc.kind = 'lead' then public.lead_readiness_for(lc.lead_email, lc.lead_phone) end$o$,
      $n$    'readiness', case when lc.kind = 'lead' then public.lead_readiness_for(lc.lead_email, lc.lead_phone) end,
    'brief', lc.brief,
    'known', case when lc.kind = 'lead' then public.lead_known_facts(lc.user_id, lc.lead_email, lc.lead_phone, lc.first_seen_at) end$n$);
    if position('''known''' in d) = 0 then raise exception 'lead_concierge_pending: readiness line not found'; end if;
    execute d;
  end if;
end $$;
