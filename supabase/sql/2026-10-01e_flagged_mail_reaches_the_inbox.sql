-- 2026-10-01e — what the overnight read finds reaches the Inbox (1 Oct 2026).
--
-- The panel (Simplifier + Accountant): "email-nightly-intel fired 1,205 times in
-- 30 days with zero actions recorded… confirm its output surfaces somewhere an
-- agent acts on it." It did not. The overnight read wrote to email_review_items,
-- shown only on a separate "Email Review" screen: 3,460 items open, 9 ever acted
-- on, the last on 16 Sep. Meanwhile it WAS finding things the Inbox's "This
-- week" never showed — an MLS compliance notice, a bank fraud alert, an invoice
-- with a due date — because those senders are not contacts and Gmail did not
-- mark them important.
--
-- ONE RULE, ONE PLACE: there is one list of mail worth a look, and it is the
-- Inbox. So:
--   1. A thread the overnight read calls urgent or needing a reply is stamped
--      (flagged_at, flagged_why) and thread_worth_a_look's verdict includes it.
--      It appears in "This week" with one plain line saying why. No new screen,
--      no new count.
--   2. The overnight read stops paying to re-read senders it has only ever
--      called promotional — 212 of the last 543 calls (39%), none of which
--      mattered.
-- Idempotent: safe to run twice.

alter table public.email_threads add column if not exists flagged_at timestamptz;
alter table public.email_threads add column if not exists flagged_why text;

-- 1a. The verdict: the existing rule, OR the overnight read flagged it (and it
--     is not spam or trash).
create or replace function public.stamp_worth_a_look()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  NEW.worth_a_look := public.thread_worth_a_look(NEW.is_important, NEW.labels,
      (select skips_inbox from email_accounts where id = NEW.account_id))
    or (NEW.flagged_at is not null and not (coalesce(NEW.labels, '{}') && array['SPAM', 'TRASH']));
  return NEW;
end $function$;

drop trigger if exists stamp_worth_a_look_trg on public.email_threads;
create trigger stamp_worth_a_look_trg before insert or update of labels, is_important, flagged_at
  on public.email_threads for each row execute function public.stamp_worth_a_look();

create or replace function public.refresh_worth_a_look()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  update email_accounts a set skips_inbox = coalesce((
    select (count(*) >= 50 and count(*) filter (where m.labels @> array['INBOX'])::numeric / count(*) < 0.10)
    from email_messages m where m.account_id = a.id and m.direction = 'inbound'
      and m.internal_date > now() - interval '30 days'), false);
  update email_threads t set worth_a_look = (public.thread_worth_a_look(t.is_important, t.labels, a.skips_inbox)
        or (t.flagged_at is not null and not (coalesce(t.labels, '{}') && array['SPAM', 'TRASH'])))
    from email_accounts a
   where a.id = t.account_id
     and t.worth_a_look is distinct from (public.thread_worth_a_look(t.is_important, t.labels, a.skips_inbox)
        or (t.flagged_at is not null and not (coalesce(t.labels, '{}') && array['SPAM', 'TRASH'])));
  get diagnostics n = row_count;
  return n;
end $function$;

-- 1b. The overnight read's verdict stamps the thread. In the database, so every
--     writer of email_review_items gets it and none can forget.
create or replace function public.review_item_flags_thread()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.thread_id is not null and NEW.category in ('urgent', 'requires_response') and NEW.status = 'open' then
    update email_threads
       set flagged_at = coalesce(NEW.received_at, now()),
           flagged_why = nullif(btrim(NEW.summary), '')
     where id = NEW.thread_id
       and (flagged_at is distinct from coalesce(NEW.received_at, now()) or flagged_why is distinct from nullif(btrim(NEW.summary), ''));
  end if;
  return NEW;
end $function$;
revoke all on function public.review_item_flags_thread() from public, anon, authenticated;

drop trigger if exists review_item_flags_thread_trg on public.email_review_items;
create trigger review_item_flags_thread_trg after insert or update of category, summary, status
  on public.email_review_items for each row execute function public.review_item_flags_thread();

-- 1c. Bring in what is still waiting: flagged in the last four days and unread.
--     (Older ones stay where they are — the point is this week, not a backlog.)
update email_threads t
   set flagged_at = coalesce(r.received_at, r.created_at), flagged_why = nullif(btrim(r.summary), '')
  from (select distinct on (thread_id) thread_id, received_at, created_at, summary
          from email_review_items
         where category in ('urgent', 'requires_response') and status = 'open'
           and created_at > now() - interval '4 days'
         order by thread_id, created_at desc) r
 where t.id = r.thread_id and t.has_unread and t.flagged_at is null
   and not (coalesce(t.labels, '{}') && array['SPAM', 'TRASH']);

-- 2. Do not pay to re-read a sender the overnight read has only ever called
--    promotional or spam (three or more times). A contact is always read.
create or replace function public.email_ai_candidates(p_account uuid, p_since timestamp with time zone, p_limit integer)
 returns table(thread_id uuid, provider_thread_id text, provider_message_id text, from_address text, from_name text, subject text, snippet text, body_text text, received_at timestamp with time zone)
 language sql security definer set search_path to 'public'
as $function$
  with only_promo as (
    select lower(r.from_address) addr
      from public.email_review_items r
     where r.account_id = p_account and r.from_address is not null
     group by 1
    having count(*) >= 3 and bool_and(r.category in ('promotional', 'spam'))
  )
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
    and (
      not exists (select 1 from only_promo o where o.addr = lower(m.from_address))
      or exists (select 1 from public.email_accounts a join public.contacts c on c.user_id = a.user_id
                  where a.id = p_account and lower(c.email) = lower(m.from_address))
    )
  order by m.thread_id, m.internal_date desc
  limit greatest(p_limit,0);
$function$;
revoke all on function public.email_ai_candidates(uuid, timestamptz, integer) from public, anon, authenticated;
