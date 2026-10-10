-- Rollback L6 (only works before Nov 7 2026): keep the backup tables.
select cron.unschedule('drop-oct8-backups-nov7') where exists (select 1 from cron.job where jobname = 'drop-oct8-backups-nov7');
delete from public._applied_sql where file = '2026-10-09e_drop_oct8_backups_on_nov7.sql';
