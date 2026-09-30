-- 2026-09-30 — CAN THEY TRANSACT? On every contact, from their own words, with receipts.
--
-- Marguerite (panel): "If it tells me this person mentioned they're pre-approved
-- at a specific number… I open that before every call." contact-research wrote
-- a LinkedIn-style profile; the one thing she needs was not in it.
-- supabase/functions/_shared/transactFacts.ts reads what the person wrote to the
-- agent (email + texts, never the web), keeps only facts whose quote appears
-- word for word in the message, and writes one line with dates:
--   "Pre-approved at $400K (Guild) — “we got approved for 400”, email Aug 12 · 1–3 months out — text Sep 3"
alter table public.profiles
  add column if not exists transact_facts jsonb,
  add column if not exists transact_line text,
  add column if not exists transact_ask text,
  add column if not exists transact_through timestamptz,
  add column if not exists transact_at timestamptz;

-- Morning refresh (contact-transact sweep): anyone who wrote in the last day, so
-- the line is current when the agent starts. 6:35 ET = 10:35 UTC (EDT).
select cron.unschedule(jobid) from cron.job where jobname = 'contact-transact-morning';
select cron.schedule('contact-transact-morning', '35 10 * * *',
  $$ select public.cron_call('contact-transact-morning', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/contact-transact',
       jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
       '{"sweep":true}'::jsonb) $$);

-- Saved contacts who wrote (email or text) since a moment — for the morning sweep.
create or replace function public.contacts_who_wrote_since(p_since timestamptz, p_limit integer default 300)
returns table(contact_id uuid) language sql stable security definer set search_path = public as $$
  select distinct c.id from contacts c
    join email_messages m on m.user_id = c.user_id and m.direction = 'inbound'
                          and m.internal_date >= p_since and lower(m.from_address) = lower(c.email)
   where c.email is not null
  union
  select distinct c.id from contacts c
    join quo_messages q on q.user_id = c.user_id and q.direction = 'incoming' and q.op_created_at >= p_since
                        and public.phone10(q.from_number) = public.phone10(c.phone)
   where c.phone is not null
  limit greatest(1, least(p_limit, 1000))
$$;
revoke all on function public.contacts_who_wrote_since(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.contacts_who_wrote_since(timestamptz, integer) to service_role;
