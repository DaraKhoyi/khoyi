-- Rollback for 2026-10-10b (run by hand, only with Dara's yes). The app falls back
-- to the current Today when my_pilot() is missing, so this is safe with the app live.
begin;
create or replace function public.my_presentation() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '{}'::jsonb; end if;
  return public.presentation_of(auth.uid());
end $$;
revoke all on function public.my_presentation() from public, anon;
grant execute on function public.my_presentation() to authenticated;
drop function if exists public.win_the_day_suggestions();
drop function if exists public.ui_event_counts(int);
drop function if exists public.my_pilot(text);
drop table if exists public.ui_events;
drop table if exists public.pilot_features;
commit;
