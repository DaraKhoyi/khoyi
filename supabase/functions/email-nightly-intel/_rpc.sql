-- Per-account sender rollup: counts, bulk, opens, whether we ever replied.
create or replace function public.email_sender_rollup(p_account uuid, p_days int)
returns table (
  addr text, display_name text, sender_domain text,
  msg_count int, msg_count_30d int, bulk_count int, opened_count int,
  first_seen timestamptz, last_seen timestamptz, replied boolean
)
language sql security definer set search_path=public as $$
  with inb as (
    select lower(from_address) addr, from_name, internal_date, is_read,
      (labels && array['SPAM','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_FORUMS']) as bulk
    from public.email_messages
    where account_id = p_account and direction = 'inbound'
      and from_address is not null and from_address <> ''
      and internal_date > now() - (p_days || ' days')::interval
  ),
  sent as (
    select distinct lower(r->>'email') addr
    from public.email_messages m, jsonb_array_elements(coalesce(m.to_addresses,'[]'::jsonb)) r
    where m.account_id = p_account and m.direction = 'outbound'
  )
  select i.addr,
    (array_agg(i.from_name order by i.internal_date desc))[1] as display_name,
    split_part(i.addr,'@',2) as sender_domain,
    count(*)::int as msg_count,
    count(*) filter (where i.internal_date > now()-interval '30 days')::int as msg_count_30d,
    count(*) filter (where i.bulk)::int as bulk_count,
    count(*) filter (where i.is_read)::int as opened_count,
    min(i.internal_date) as first_seen,
    max(i.internal_date) as last_seen,
    exists(select 1 from sent s where s.addr = i.addr) as replied
  from inb i
  group by i.addr;
$$;

-- Non-bulk, unread, un-reviewed inbound threads since a watermark (latest msg per thread).
create or replace function public.email_ai_candidates(p_account uuid, p_since timestamptz, p_limit int)
returns table (
  thread_id uuid, provider_thread_id text, provider_message_id text,
  from_address text, from_name text, subject text, snippet text,
  body_text text, received_at timestamptz
)
language sql security definer set search_path=public as $$
  select distinct on (m.thread_id)
    m.thread_id, m.provider_thread_id, m.provider_message_id,
    m.from_address, m.from_name, m.subject, m.snippet, m.body_text, m.internal_date
  from public.email_messages m
  where m.account_id = p_account
    and m.direction = 'inbound'
    and coalesce(m.is_read,false) = false
    and m.internal_date > p_since
    and not (coalesce(m.labels,'{}') && array['SPAM','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_FORUMS','TRASH','DRAFT'])
    and not exists (
      select 1 from public.email_review_items r
      where r.account_id = m.account_id and r.provider_message_id = m.provider_message_id
    )
  order by m.thread_id, m.internal_date desc
  limit greatest(p_limit,0);
$$;

revoke all on function public.email_sender_rollup(uuid,int) from public, anon, authenticated;
revoke all on function public.email_ai_candidates(uuid,timestamptz,int) from public, anon, authenticated;
