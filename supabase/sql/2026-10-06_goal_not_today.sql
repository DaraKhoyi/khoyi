-- Goals: "Not today" on a suggested goal.
--
-- Dara, 6 Oct 2026: "Yes, add Not Today". A suggestion can be real and still
-- not belong to today. Not today hides it from the short list for THAT day
-- only and changes nothing about the task or the follow-up itself: it is
-- offered again tomorrow. Kept in the database, not on the phone, so the next
-- suggestion moves up into its place and every device agrees.
--
-- Idempotent. Safe to run twice.

create table if not exists public.goal_not_today (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  src        text not null check (src in ('task', 'promise')),
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day, src, ref_id)
);
alter table public.goal_not_today enable row level security;
drop policy if exists goal_not_today_own on public.goal_not_today;
create policy goal_not_today_own on public.goal_not_today for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.goal_not_today from anon, public;
grant select, insert, delete on public.goal_not_today to authenticated;

-- The short list, now leaving out anything set aside for this day.
create or replace function public.goal_candidates(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_day date := coalesce(p_day, public.today_ny()); v jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  with picked as (select task_id, commitment_id from day_goals where user_id = v_uid and day = v_day),
  skip as (select src, ref_id from goal_not_today where user_id = v_uid and day = v_day),
  t as (
    select 'task'::text src, tk.id, tk.title, case when tk.due_date is not null then 'On your list for ' || to_char(tk.due_date, 'FMMonth FMDD') else 'On your task list' end hint,
           case when tk.eisenhower_quadrant = 'A' then 0 when tk.eisenhower_quadrant = 'B' then 1 else 2 end rank_, tk.due_date
      from tasks tk
     where tk.user_id = v_uid and not coalesce(tk.completed, false) and tk.dropped_at is null
       and coalesce(tk.status, '') not in ('done', 'completed', 'archived', 'someday')
       and (tk.due_date <= v_day or tk.eisenhower_quadrant = 'A')
       and not exists (select 1 from picked p where p.task_id = tk.id)
       and not exists (select 1 from skip s where s.src = 'task' and s.ref_id = tk.id)
     order by 5, tk.due_date nulls last limit 4
  ),
  c as (
    select 'promise'::text src, cm.id, cm.title, 'You said you would' || coalesce(' — ' || ct.name, '') hint, 0 rank_, cm.due_date
      from commitments cm left join contacts ct on ct.id = cm.contact_id
     where cm.user_id = v_uid and cm.status = 'accepted' and cm.owner = 'me' and cm.due_date is not null and cm.due_date <= v_day
       and not exists (select 1 from picked p where p.commitment_id = cm.id)
       and not exists (select 1 from skip s where s.src = 'promise' and s.ref_id = cm.id)
     order by cm.due_date limit 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('src', src, 'id', id, 'title', title, 'hint', hint) order by rank_, due_date nulls last), '[]'::jsonb)
    into v from (select * from c union all select * from t) x;
  return v;
end $function$;
revoke all on function public.goal_candidates(date) from public, anon;
grant execute on function public.goal_candidates(date) to authenticated;
