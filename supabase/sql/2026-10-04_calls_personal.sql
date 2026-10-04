-- 2026-10-04 — what the AI overhears on a call is work only, unless asked (4 Oct 2026).
--
-- Ray (panel): 142 set-aside follow-ups and a "Get showered and ready" item —
-- "the app is tracking things that will make an agent feel watched, not helped."
-- Dara's decision the same day (design brief, decision 4): OFF by default.
-- What a person adds to their own list is welcome whatever it is about; what the
-- call reader picks up is limited to their work unless they turn this on in
-- Settings. Read by supabase/functions/_shared/lessons.ts (personalRule).
-- Idempotent: safe to run twice.
alter table public.user_settings add column if not exists calls_personal boolean not null default false;
