-- 2026-10-04d — GOALS FOR THE DAY: the day belongs to the person.
--
-- Dara, 4 Oct: "the ability to look at all the outstanding things and pick 3
-- things from the back log or current items to schedule as Goals for the Day."
-- Design brief, decisions 7 and 8: three by default (one to five); chosen by the
-- person, in their own words; nobody else sees them unless the person shares.
-- Every coaching school puts the agent's own agenda before the inbox, so these
-- sit at the top of Today, above everything inbound.
--
--   day_goals                 one row per goal per day. No score is ever stored.
--   goal_candidates(day)      a short list to choose from — offered, never picked.
--   my_contract_deadlines()   the band ABOVE the goals: dated contract steps in the
--                             next week. Outside the goals; never counted in them.
--   chief_queue               the "pick today's must-dos" nudge stands down once
--                             the person has goals for today.
-- Idempotent: safe to run twice.

create table if not exists public.day_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  pos smallint not null default 1,
  text text not null check (length(btrim(text)) > 0 and length(text) <= 300),
  when_text text check (when_text is null or length(when_text) <= 200),
  task_id uuid,
  commitment_id uuid,
  done_at timestamptz,
  -- how an unfinished goal was closed at the end of the day; never "failed"
  outcome text check (outcome is null or outcome in ('tomorrow', 'date', 'someday', 'let_go')),
  moved_to date,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists day_goals_user_day on public.day_goals (user_id, day);
alter table public.day_goals enable row level security;
drop policy if exists day_goals_own on public.day_goals;
-- Decision 8: the person's alone. No staff, broker or admin policy exists.
create policy day_goals_own on public.day_goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.user_settings add column if not exists daily_goal_count smallint not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_daily_goal_count_range') then
    alter table public.user_settings add constraint user_settings_daily_goal_count_range check (daily_goal_count between 1 and 5);
  end if;
end $$;
-- When the person last opened Today — only so a person back after a week is
-- welcomed, not presented with a backlog. Never shown to anyone, never an age.
alter table public.user_settings add column if not exists last_open_at timestamptz;

-- At most five a day, whatever the screen does.
create or replace function public.day_goals_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from day_goals g where g.user_id = NEW.user_id and g.day = NEW.day) >= 5 then
    raise exception 'Five goals is the most for one day.';
  end if;
  return NEW;
end $$;
revoke all on function public.day_goals_cap() from public, anon, authenticated;
drop trigger if exists day_goals_cap_trg on public.day_goals;
create trigger day_goals_cap_trg before insert on public.day_goals for each row execute function public.day_goals_cap();

-- A short list to choose from: what is already dated for that day or earlier and
-- matters most, then promises the person made that fall due. Offered, never chosen.
create or replace function public.goal_candidates(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_day date := coalesce(p_day, public.today_ny()); v jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  with picked as (select task_id, commitment_id from day_goals where user_id = v_uid and day = v_day),
  t as (
    select 'task'::text src, tk.id, tk.title, case when tk.due_date is not null then 'On your list for ' || to_char(tk.due_date, 'FMMonth FMDD') else 'On your task list' end hint,
           case when tk.eisenhower_quadrant = 'A' then 0 when tk.eisenhower_quadrant = 'B' then 1 else 2 end rank_, tk.due_date
      from tasks tk
     where tk.user_id = v_uid and not coalesce(tk.completed, false) and tk.dropped_at is null
       and coalesce(tk.status, '') not in ('done', 'completed', 'archived', 'someday')
       and (tk.due_date <= v_day or tk.eisenhower_quadrant = 'A')
       and not exists (select 1 from picked p where p.task_id = tk.id)
     order by 5, tk.due_date nulls last limit 4
  ),
  c as (
    select 'promise'::text src, cm.id, cm.title, 'You said you would' || coalesce(' — ' || ct.name, '') hint, 0 rank_, cm.due_date
      from commitments cm left join contacts ct on ct.id = cm.contact_id
     where cm.user_id = v_uid and cm.status = 'accepted' and cm.owner = 'me' and cm.due_date is not null and cm.due_date <= v_day
       and not exists (select 1 from picked p where p.commitment_id = cm.id)
     order by cm.due_date limit 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('src', src, 'id', id, 'title', title, 'hint', hint) order by rank_, due_date nulls last), '[]'::jsonb)
    into v from (select * from c union all select * from t) x;
  return v;
end $$;
revoke all on function public.goal_candidates(date) from public, anon;
grant execute on function public.goal_candidates(date) to authenticated;

-- Contract dates in the next week, for the person whose deal it is. Stated
-- plainly, with the date. Locked: no setting hides this (decision 5).
create or replace function public.my_contract_deadlines(p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_today date := public.today_ny(); v_days int := greatest(1, least(coalesce(p_days, 7), 30)); v jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  with d as (
    select coalesce(nullif(k.value ->> 'label', ''), 'Contract date') label, (k.value ->> 'date')::date due, coalesce(bt.address, 'A deal') about
      from brokerage_transactions bt join agents a on a.id = bt.agent_id,
           lateral jsonb_array_elements(case when jsonb_typeof(bt.key_dates) = 'array' then bt.key_dates else '[]'::jsonb end) k
     where a.auth_user_id = v_uid and bt.deal_status = 'active' and (k.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select coalesce(nullif(f.label, ''), initcap(replace(coalesce(f.kind, 'deadline'), '_', ' '))), f.due_date, 'A file'
      from file_deadlines f
     where f.user_id = v_uid and f.due_date is not null and coalesce(f.status, '') not in ('done', 'completed', 'cancelled', 'dismissed')
    union all
    select 'Closing', dl.close_date, coalesce(nullif(dl.address, ''), nullif(dl.name, ''), 'A deal')
      from deals dl
     where dl.user_id = v_uid and dl.close_date is not null and dl.status in ('under_contract', 'closing')   -- a signed contract; a listing's hoped-for date is not a deadline
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'date', due, 'about', about) order by due), '[]'::jsonb)
    into v from d where due between v_today and v_today + v_days;
  return v;
end $$;
revoke all on function public.my_contract_deadlines(integer) from public, anon;
grant execute on function public.my_contract_deadlines(integer) to authenticated;

-- The queue's "pick today's must-dos" nudge stands down once the person has
-- chosen goals for today — they already did what it asks.
do $$
declare v_def text; v_old text := 'and coalesce(t.status, '''') not in (''done'', ''completed'', ''archived'', ''someday'')
    group by me.today having count(*) > 0';
  v_new text := 'and coalesce(t.status, '''') not in (''done'', ''completed'', ''archived'', ''someday'')
       and not exists (select 1 from day_goals g where g.user_id = me.uid and g.day = me.today)
    group by me.today having count(*) > 0';
begin
  select pg_get_functiondef('public.chief_queue(integer)'::regprocedure) into v_def;
  if position('from day_goals g' in v_def) > 0 then return; end if;   -- already applied
  if position(v_old in v_def) = 0 then raise exception 'chief_queue: the task nudge was not where this patch expects it'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, 'Pick today’s must-dos from your task list', 'Choose what really happens today');
  v_def := replace(v_def, 'Some of your A tasks slipped past their date. Choose what really happens today; move or drop the rest.',
                          'Some of your most important tasks are dated earlier than today. Pick your goals for today, and move or let go of the rest.');
  execute v_def;
end $$;
