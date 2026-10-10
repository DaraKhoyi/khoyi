-- =====================================================================
-- Win the Day, Phase A (10 Oct 2026). Dara approved at 1:45 PM ET.
--
-- 1. pilot_features: per-person switch. NO rows are inserted here, so the new
--    Today is OFF for everyone until brokerage staff add the 10 pilot agents.
--    my_pilot(feature) -> boolean for the signed-in person only.
-- 2. ui_events: counts-only tap tracking. A row is (who, element, action, day).
--    element/action are short slugs enforced by CHECK, so no names, email
--    text, phone numbers or client content can be stored. People can insert
--    only their own rows and cannot read any rows. Staff read COUNTS only via
--    ui_event_counts(days): grouped by element/action, distinct people, no ids.
-- 3. win_the_day_suggestions(): suggestions for Choose My Top 3, for
--    auth.uid() only: the today_three() cards (promises <48h, Company Lead
--    waiting, missed caller), then open tasks due by tomorrow, then active
--    deals. Reads only; never texts or emails.
-- Picks, check-off and roll-to-tomorrow use day_goals (policy day_goals_own).
--
-- ROLLBACK: supabase/sql/rollback/2026-10-10b_win_the_day_pilot.down.sql
-- =====================================================================
begin;

create table if not exists public.pilot_features (
  user_id    uuid not null references auth.users(id) on delete cascade,
  feature    text not null check (feature ~ '^[a-z0-9_]{1,40}$'),
  enabled_at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table public.pilot_features enable row level security;
drop policy if exists pilot_features_read_own on public.pilot_features;
create policy pilot_features_read_own on public.pilot_features for select to authenticated
  using (user_id = auth.uid() or public.is_brokerage_staff());
drop policy if exists pilot_features_staff_write on public.pilot_features;
create policy pilot_features_staff_write on public.pilot_features for all to authenticated
  using (public.is_brokerage_staff()) with check (public.is_brokerage_staff());
revoke all on public.pilot_features from anon;

create or replace function public.my_pilot(p_feature text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.pilot_features f
                 where f.user_id = auth.uid() and f.feature = p_feature);
$$;
revoke all on function public.my_pilot(text) from public, anon;
grant execute on function public.my_pilot(text) to authenticated;

-- The app reads the switch from my_presentation() (already called on Today), so
-- no new request is made before this file is applied and nothing errors.
create or replace function public.my_presentation() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '{}'::jsonb; end if;
  return public.presentation_of(auth.uid())
    || jsonb_build_object('pilots', coalesce((select jsonb_agg(f.feature) from public.pilot_features f where f.user_id = auth.uid()), '[]'::jsonb));
end $$;
revoke all on function public.my_presentation() from public, anon;
grant execute on function public.my_presentation() to authenticated;

create table if not exists public.ui_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  element    text not null check (element ~ '^[a-z0-9_.]{1,48}$'),
  action     text not null default 'tap' check (action ~ '^[a-z_]{1,20}$'),
  day        date not null default public.today_ny(),
  created_at timestamptz not null default now()
);
create index if not exists ui_events_day_el on public.ui_events (day, element);
alter table public.ui_events enable row level security;
drop policy if exists ui_events_insert_own on public.ui_events;
create policy ui_events_insert_own on public.ui_events for insert to authenticated
  with check (user_id = auth.uid());
-- no select/update/delete policy: nobody reads raw rows through the API.
revoke all on public.ui_events from anon;
revoke select, update, delete on public.ui_events from authenticated;
grant insert (element, action) on public.ui_events to authenticated;

create or replace function public.ui_event_counts(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_brokerage_staff() then return jsonb_build_object('ok', false, 'error', 'staff only'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('element', element, 'action', action, 'taps', n, 'people', p) order by n desc)
    from (select element, action, count(*) n, count(distinct user_id) p from public.ui_events
          where day >= public.today_ny() - greatest(1, least(p_days, 90)) group by 1, 2) z), '[]'::jsonb));
end $$;
revoke all on function public.ui_event_counts(int) from public, anon;
grant execute on function public.ui_event_counts(int) to authenticated;

create or replace function public.win_the_day_suggestions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_today date; v_cards jsonb; v_tasks jsonb; v_deals jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'items', '[]'::jsonb); end if;
  v_today := public.today_ny();
  v_cards := coalesce(public.today_three() -> 'cards', '[]'::jsonb);  -- already auth.uid()-scoped
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_tasks from (
    select jsonb_build_object('kind', 'task', 'ref', 'task:' || t.id, 'id', t.id, 'title', t.title,
             'due_date', t.due_date, 'late', t.due_date < v_today) x
    from public.tasks t
    where t.user_id = v_uid and coalesce(t.completed, false) = false and t.archived_at is null
      and t.dropped_at is null and coalesce(t.someday, false) = false
      and t.due_date is not null and t.due_date <= v_today + 1 and t.due_date >= v_today - 30
    order by t.due_date, t.priority nulls last limit 4) q;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_deals from (
    select jsonb_build_object('kind', 'deal', 'ref', 'deal:' || d.id, 'id', d.id,
             'title', 'Move ' || coalesce(nullif(d.name, ''), nullif(d.address, ''), 'your deal') || ' forward',
             'close_date', d.close_date) x
    from public.deals d where d.user_id = v_uid and d.status = 'active'
    order by d.close_date nulls last limit 2) q;
  return jsonb_build_object('ok', true, 'items', v_cards || v_tasks || v_deals);
end $$;
revoke all on function public.win_the_day_suggestions() from public, anon;
grant execute on function public.win_the_day_suggestions() to authenticated;

commit;
