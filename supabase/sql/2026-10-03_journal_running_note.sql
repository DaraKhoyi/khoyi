-- 2026-10-03 — the Journal's "note you keep coming back to".
--
-- Dara, 3 Oct: "I don't want a little window inside the page… Optimize the
-- screen so that I can do one big note and keep coming back to it. Save its
-- current state as I work on it and go away from it and then come back to it
-- during the day."
--
-- journal_entries.kind = 'running' is the day's one long note: saved as it is
-- typed, reopened where it was left. One per person per day — the index makes a
-- second one impossible, so two phones can never fork the day's note. Short
-- notes ('text', 'voice') are unchanged and unlimited.
-- user_settings.journal_button: the floating "back to my note" button (default
-- on; it only ever appears once today's note has been started). Idempotent.
create unique index if not exists journal_entries_one_running_per_day
  on public.journal_entries (user_id, day) where kind = 'running';
alter table public.user_settings add column if not exists journal_button boolean not null default true;
