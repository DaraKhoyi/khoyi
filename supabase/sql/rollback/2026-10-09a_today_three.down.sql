-- Rollback for 2026-10-09a (run by hand in the SQL editor, only with Dara's yes).
-- The Today cards hide themselves when the function is missing, so this is safe
-- to run with the app live.
begin;
drop function if exists public.today_three();
commit;
