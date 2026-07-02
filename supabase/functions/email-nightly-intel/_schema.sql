-- ── Nightly email intelligence: tables ────────────────────────────────
create table if not exists public.email_intel_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.email_accounts(id) on delete cascade,
  user_id uuid not null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  since_ts timestamptz,
  through_ts timestamptz,
  scanned int default 0,
  bulk_skipped int default 0,
  ai_reviewed int default 0,
  flagged int default 0,
  unsub_recos int default 0,
  ai_calls int default 0,
  status text default 'running',
  error text
);

create table if not exists public.email_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid references public.email_accounts(id) on delete cascade,
  thread_id uuid,
  provider_thread_id text,
  provider_message_id text,
  from_address text,
  from_name text,
  subject text,
  received_at timestamptz,
  category text,
  action text,
  priority int default 0,
  summary text,
  reasons jsonb default '{}'::jsonb,
  needs_review boolean default true,
  status text default 'open',
  model text,
  prompt_version text,
  created_at timestamptz default now(),
  unique (account_id, provider_message_id)
);

create table if not exists public.email_sender_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid references public.email_accounts(id) on delete cascade,
  sender_address text not null,
  sender_domain text,
  display_name text,
  first_seen timestamptz,
  last_seen timestamptz,
  msg_count_total int default 0,
  msg_count_30d int default 0,
  bulk_count int default 0,
  opened_count int default 0,
  replied boolean default false,
  is_bulk boolean default false,
  list_unsubscribe text,
  list_unsubscribe_post boolean default false,
  unsubscribe_recommended boolean default false,
  recommend_reason text,
  status text default 'active',
  updated_at timestamptz default now(),
  unique (account_id, sender_address)
);

-- indexes
create index if not exists idx_eri_user_status on public.email_review_items(user_id, status, needs_review, received_at desc);
create index if not exists idx_eri_account on public.email_review_items(account_id, created_at desc);
create index if not exists idx_ess_user_reco on public.email_sender_stats(user_id, unsubscribe_recommended, msg_count_30d desc);
create index if not exists idx_ess_account on public.email_sender_stats(account_id, status);
create index if not exists idx_eir_account on public.email_intel_runs(account_id, started_at desc);

-- ── RLS: owner sees own rows; service role bypasses ───────────────────
alter table public.email_intel_runs   enable row level security;
alter table public.email_review_items enable row level security;
alter table public.email_sender_stats enable row level security;

drop policy if exists eir_own on public.email_intel_runs;
create policy eir_own on public.email_intel_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists eri_own on public.email_review_items;
create policy eri_own on public.email_review_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists ess_own on public.email_sender_stats;
create policy ess_own on public.email_sender_stats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
