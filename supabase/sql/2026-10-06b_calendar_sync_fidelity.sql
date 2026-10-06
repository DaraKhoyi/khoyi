-- Calendar: keep what Google says about a repeating event, know when a change
-- did not reach Google, and let an all-day event close a day to bookings.
--
-- Dara, 6 Oct 2026: "Fix them all, please" — the five things found while
-- looking into Josh's booking report.
--
-- Idempotent. Safe to run twice.

-- 1. The repeat rule exactly as Google gives it ("every Monday, Wednesday and
--    Friday", "the second Tuesday"). Until now only how-often and until-when
--    were kept, so those showed on one weekday and were overwritten in Google
--    when the event was edited here. recur_freq/interval/until/count remain
--    for events made in PrismOS; when recur_rule is present it wins.
alter table public.events add column if not exists recur_rule text[];
-- Single occurrences of a repeating event that were cancelled or moved.
alter table public.events add column if not exists recur_exdates timestamptz[];
-- 2. Why the last attempt to send this event to Google failed, in words.
alter table public.events add column if not exists push_error text;
-- 3. An all-day event that closes its day(s) to bookings (a trip, a day off).
--    Birthdays and holidays are all-day too and must not, so this is off
--    unless the person says so.
alter table public.events add column if not exists blocks_time boolean;

alter table public.events drop constraint if exists events_sync_status_check;
alter table public.events add constraint events_sync_status_check
  check (sync_status = any (array['local', 'synced', 'pending_push', 'pending_pull', 'conflict', 'push_failed']));

-- 4. Each person's calendar is re-read in full once by the new sync, so the
--    rules above are filled in for events already here. calendar-sync does a
--    full read whenever rules_version is behind the version it was built for.
alter table public.calendar_sync_state add column if not exists rules_version integer not null default 0;

-- 5. Events that end before they start. The form allowed it until v1.16.07;
--    Google refuses them, so they never synced. Give each the form's default
--    length (one hour) and queue it to go up.
update public.events
   set end_at = start_at + interval '1 hour', sync_status = 'pending_push', updated_at = now()
 where end_at < start_at and coalesce(all_day, false) = false;
