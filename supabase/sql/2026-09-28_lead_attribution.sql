-- 2026-09-28 — WHERE DID EACH CLOSING COME FROM?
--
-- Panel (Merchant + Accountant + Archivist), 28 Sep: "Zero of 24 closings are
-- attributable — the Gold Report has no client column." Dara added CLIENT NAME
-- and CLIENT Email to the Gold Report the same morning, from this point onward.
--
-- Dara: "At the brokerage level we are not actively involved in lead
-- generation. Agents are each doing their own things." So attribution cannot
-- mean "did PrismOS produce this deal". It means: for every closing, WHO was the
-- client, WHERE did that client come from (the agent's own prospecting, a
-- referral, a portal, a company lead…), and HOW FAST were they answered. That
-- is what lets the brokerage decide which lead sources to build.
--
-- Three layers, strongest first:
--   1. What the agent recorded in the Gold Report ("Lead Source" column, when
--      present — sheets-sync stores it in brokerage_transactions.lead_source).
--   2. What PrismOS itself saw: a company lead, a lead card (with its portal),
--      or the agent's contact record (its prospecting system, referral, origin)
--      — matched on the client's email, or name when there is no email.
--   3. Unknown — listed, so someone can fill it in, never guessed.
-- Computed live from recorded facts (no outcome rows to drift out of date).

alter table public.brokerage_transactions add column if not exists lead_source text;
comment on column public.brokerage_transactions.lead_source is
  'Where the client came from, as recorded in the Gold Report "Lead Source" column (sheets-sync). Null when the sheet has no such column or the cell is empty.';

-- Letters only, lower case: "Smith, John " and "john smith" are not equal, but
-- "John Smith" and "john  smith." are. Used on both sides of every name match.
create or replace function public.norm_person_name(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z]', '', 'g'), '')
$$;

-- Free text from a sheet cell, a portal name or a prospecting-system name ->
-- one of a short fixed list, so GCI can be added up by source. Order matters:
-- the first match wins ("Past client referral" is a past client).
create or replace function public.lead_source_bucket(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~* '(not a lead|unattributed|overhead)' then null
    when p ~* '(company lead|brokerage|\moffice\M|\mrog\M|realty one|floor time|up ?time)' then 'Company lead'
    when p ~* '(zillow|realtor\.?com|homes\.?com|redfin|trulia|homesnap|opcity|apartments|rent\.com|pay.at.closing|agent pronto|sold\.com|rocket homes|\mportal)' then 'Online portal / paid leads'
    when p ~* '(past client|repeat|former client|previous client)' then 'Past client'
    when p ~* '(sphere|\msoi\M|friend|family|neighbo|church|network)' then 'Sphere'
    when p ~* 'referr' then 'Referral'
    when p ~* 'open ?house' then 'Open house'
    when p ~* '(\msign\M|rider|drive.?by)' then 'Sign call'
    when p ~* '(tiktok|facebook|instagram|youtube|linkedin|nextdoor|social)' then 'Social media'
    when p ~* '(content|video|blog|webinar|workshop|virtual tour|podcast)' then 'Content & video'
    when p ~* '(\midx\M|website|web site|\msite\M|landing|home.?value|valuation|google|\mseo\M|\mppc\M|\mads?\M|booking)' then 'Own website / ads'
    when p ~* '(\msms\M|text(ing)? (marketing|campaign)|mailer|postcard|direct mail|newsletter|drip|email campaign)' then 'Marketing campaigns'
    when p ~* '(fsbo|expired|\mdoor|knock|cold call|circle|\mfarm|prospect|ferry|dial)' then 'Prospecting'
    when p ~* '(investor|wholesal|flip)' then 'Investor'
    when p ~* 'direct inquiry' then 'Direct inquiry'
    else 'Other' end
$$;

-- One row per closing between p_from and p_to. Staff and the service role see
-- every closing; an agent sees only their own.
create or replace function public.closing_attribution(p_from date, p_to date)
returns table (
  transaction_id uuid, trans_id integer, agent_name text, address text, closed_on date, gci numeric, side text,
  client_name text, client_email text, has_client boolean,
  stated_source text, found_source text, found_how text, found_on date,
  source text, source_bucket text, minutes_to_first_reply integer,
  prismos_saw_first boolean, contact_id uuid, ai_calls integer, ai_usd numeric)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() uid, (public.is_brokerage_staff() or auth.role() = 'service_role') staff),
  cl as (
    select bt.id, bt.trans_id, coalesce(a.name, bt.agent_name_raw) agent_name, a.auth_user_id agent_user, bt.address,
           coalesce(bt.date_paid, bt.date_received) closed_on, bt.gross_commission gci,
           case when bt.buy_side and bt.list_side then 'both sides' when bt.list_side then 'listing' when bt.buy_side then 'buyer' end side,
           nullif(btrim(concat_ws(' & ', nullif(btrim(bt.buyer_name), ''), nullif(btrim(bt.seller_name), ''))), '') client_name,
           nullif(lower(btrim(bt.client_email)), '') client_email,
           array(select lower(btrim(e)) from regexp_split_to_table(coalesce(bt.client_email, ''), '[;,\s]+') e where e like '%@%') emails,
           -- "John & Jane Smith" -> johnsmith? no: keep each named person that is
           -- more than a first name; a bare "John" matches too many people.
           array(select public.norm_person_name(n) from regexp_split_to_table(concat_ws(' & ', bt.buyer_name, bt.seller_name), '\s*(&|\mand\M|,|/|;|\+)\s*') n
                  where length(public.norm_person_name(n)) > 6 and btrim(n) ~ '\s') names,
           nullif(btrim(bt.lead_source), '') stated_source
    from brokerage_transactions bt
    left join agents a on a.id = bt.agent_id
    cross join me
    where bt.kind = 'sale'
      and coalesce(bt.date_paid, bt.date_received) between p_from and p_to
      and (me.staff or (me.uid is not null and a.auth_user_id = me.uid))),
  touch as (   -- every record of this person PrismOS holds, with when and where from
    select 1 rank_, 'company lead' how, lower(btrim(bl.lead_email)) email, public.norm_person_name(bl.lead_name) nm,
           bl.received_at at_, 'Company lead: ' || coalesce(bl.source, 'unknown') src,
           (extract(epoch from (bl.first_response_at - bl.received_at)) / 60)::int mins, null::uuid cid
      from brokerage_leads bl
    union all
    select 2, 'lead card', lower(btrim(lc.lead_email)), public.norm_person_name(lc.lead_name), lc.first_seen_at, lc.source,
           (extract(epoch from (lc.first_response_at - lc.first_seen_at)) / 60)::int, lc.contact_id
      from lead_concierge lc where lc.kind = 'lead'
    union all
    select 3, 'contact', lower(btrim(c.email)), public.norm_person_name(c.name), c.created_at,
           coalesce(case when public.lead_source_bucket(lg.name) is not null then lg.name end,
                    case when c.referred_by_contact_id is not null then 'Referral' end,
                    case c.origin when 'sphere' then 'Sphere' when 'open_house' then 'Open house' when 'booking' then 'Own booking page' end),
           null, c.id
      from contacts c left join lead_gen_systems lg on lg.id = c.lead_gen_system_id),
  hits as (
    select cl.id tid, t.*
    from cl join touch t
      on ((t.email is not null and t.email = any(cl.emails))
          or (cardinality(cl.emails) = 0 and length(t.nm) > 6 and t.nm = any(cl.names)))
     and t.at_::date <= cl.closed_on and t.at_ > cl.closed_on - interval '3 years'),
  best as (   -- the earliest record that says where they came from; company leads first
    select distinct on (tid) tid, how, src, at_, mins from hits where src is not null
    order by tid, rank_, at_),
  firstseen as (select tid, min(at_) at_ from hits group by tid),
  speed as (   -- speed to lead: the first lead record with a reply time
    select distinct on (tid) tid, mins from hits where mins is not null and mins >= 0 order by tid, at_),
  cids as (select distinct tid, cid from hits where cid is not null),
  ai as (
    select x.tid, count(*)::int n, round(sum(l.cost_usd)::numeric, 2) usd, min(x.cid::text)::uuid cid
    from cids x join ai_usage_log l on l.subject_type = 'contact' and l.subject_id = x.cid
    join cl on cl.id = x.tid and l.created_at::date <= cl.closed_on
    group by x.tid)
  select cl.id, cl.trans_id, cl.agent_name, cl.address, cl.closed_on, cl.gci, cl.side,
         cl.client_name, cl.client_email, (cl.client_name is not null or cl.client_email is not null),
         cl.stated_source, b.src, b.how, b.at_::date,
         coalesce(cl.stated_source, b.src),
         public.lead_source_bucket(coalesce(cl.stated_source, b.src)),
         s.mins, (f.at_ is not null),
         coalesce(ai.cid, (select min(cid::text)::uuid from cids where cids.tid = cl.id)),
         coalesce(ai.n, 0), coalesce(ai.usd, 0)
  from cl
  left join best b on b.tid = cl.id
  left join firstseen f on f.tid = cl.id
  left join speed s on s.tid = cl.id
  left join ai on ai.tid = cl.id
$$;
revoke all on function public.closing_attribution(date, date) from public, anon;
grant execute on function public.closing_attribution(date, date) to authenticated, service_role;

-- The brokerage view: closings, GCI and speed to lead BY SOURCE, by agent, and
-- the closings still missing a client or a source (the to-do list that makes
-- the numbers true).
create or replace function public.lead_attribution(p_days integer default 90)
returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from public.closing_attribution(current_date - p_days, current_date)),
  since as (select * from r where closed_on >= date '2026-09-28')   -- the day the client columns were added
  select jsonb_build_object(
    'window_days', p_days,
    'closings', (select count(*) from r),
    'gci', (select round(coalesce(sum(gci), 0)) from r),
    'with_client', (select count(*) from r where has_client),
    'with_source', (select count(*) from r where source_bucket is not null),
    'source_from_sheet', (select count(*) from r where stated_source is not null),
    'source_from_prismos', (select count(*) from r where stated_source is null and found_source is not null),
    'prismos_saw_first', jsonb_build_object('closings', (select count(*) from r where prismos_saw_first),
                                            'gci', (select round(coalesce(sum(gci), 0)) from r where prismos_saw_first)),
    'by_source', (select coalesce(jsonb_agg(x order by (x->>'gci')::numeric desc), '[]') from (
        select jsonb_build_object('source', coalesce(source_bucket, 'Not recorded yet'), 'closings', count(*),
               'gci', round(coalesce(sum(gci), 0)),
               'median_minutes_to_first_reply', percentile_cont(0.5) within group (order by minutes_to_first_reply)) x
        from r group by coalesce(source_bucket, 'Not recorded yet')) s),
    'by_agent', (select coalesce(jsonb_agg(x order by (x->>'gci')::numeric desc), '[]') from (
        select jsonb_build_object('agent', agent_name, 'closings', count(*), 'gci', round(coalesce(sum(gci), 0)),
               'with_client', count(*) filter (where has_client), 'with_source', count(*) filter (where source_bucket is not null)) x
        from r group by agent_name) s),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('agent', agent_name, 'address', address, 'closed_on', closed_on,
                   'gci', gci, 'client', client_name, 'source', source, 'bucket', source_bucket, 'how', coalesce(found_how, 'Gold Report'),
                   'minutes_to_first_reply', minutes_to_first_reply, 'ai_usd', ai_usd) order by closed_on desc), '[]')
                 from r where source_bucket is not null),
    'missing_client_since_columns_added', (select coalesce(jsonb_agg(jsonb_build_object('agent', agent_name, 'address', address,
                   'closed_on', closed_on, 'trans_id', trans_id) order by closed_on desc), '[]') from since where not has_client),
    'sheet_has_lead_source_column', exists (select 1 from brokerage_transactions bt, jsonb_object_keys(bt.raw_row) k
                   where bt.year = extract(year from current_date)::int and lower(k) ~ '^(lead )?source' ),
    'note', 'Source = what the agent recorded in the Gold Report, else the earliest record PrismOS holds of the client (company lead, lead card, or the agent''s contact with its prospecting system). "PrismOS saw first" = PrismOS held a record of the client before the closing — evidence, not proof of cause.')
$$;
revoke all on function public.lead_attribution(integer) from public, anon;
grant execute on function public.lead_attribution(integer) to authenticated, service_role;
