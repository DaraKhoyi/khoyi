-- =====================================================================
-- L6: retire the Oct 8 Quo/lead cleanup backup tables on Nov 7, not today (9 Oct 2026)
--
-- Security audit L6. Six backup tables from the Oct 8 Quo restore and lead
-- cleanup (RLS on, no policies, no anon/authenticated grants, so not exposed):
--   _lead_activity_dupes_20261008, _lead_activity_fix_20261008,
--   _lead_activity_fix2_20261008, _lead_counters_20261008, _lead_fix2_20261008,
--   _quo_restore_20261008
-- They are the only undo for that cleanup, so they are kept for 30 days.
-- This file drops NOTHING now. It schedules a one-time pg_cron job for
-- Sat Nov 7 2026 10:00 AM ET (15:00 UTC; Eastern time is back on EST by then) that drops them and
-- then unschedules itself. Every drop is IF EXISTS, so a re-run is harmless,
-- and cron.schedule upserts by name.
-- To keep them longer: select cron.unschedule('drop-oct8-backups-nov7');
-- Rollback: rollback/2026-10-09e_drop_oct8_backups_on_nov7.down.sql (before Nov 7).
-- =====================================================================
select cron.schedule('drop-oct8-backups-nov7', '0 15 7 11 *', $job$
  drop table if exists public._lead_activity_dupes_20261008, public._lead_activity_fix_20261008,
    public._lead_activity_fix2_20261008, public._lead_counters_20261008,
    public._lead_fix2_20261008, public._quo_restore_20261008;
  select cron.unschedule('drop-oct8-backups-nov7');
$job$);
