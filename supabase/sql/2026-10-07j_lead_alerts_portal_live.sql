-- 2026-10-07 lead alerts: portal leads always alert (switch) + one-time late alerts by id.
alter table public.notification_runtime
  add column if not exists portal_live boolean not null default false,
  add column if not exists backfill_lead_ids uuid[] not null default '{}';
comment on column public.notification_runtime.portal_live is 'lead-notify v10: portal leads get a score floor and alert their owner; quiet-hour/rate rules. false = v9 behaviour.';
comment on column public.notification_runtime.backfill_lead_ids is 'lead-notify v10: specific old leads to alert their owner about once (8 AM-9 PM ET); cleared after.';
