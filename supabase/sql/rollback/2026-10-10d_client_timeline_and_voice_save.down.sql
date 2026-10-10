-- by hand only. Removes the Phase 1 feed + voice save; data written by Save stays (plain notes/tasks/promises).
begin;
drop function if exists public.contact_timeline(uuid, timestamptz, int, text[]);
drop function if exists public.save_voice_note(uuid, text, jsonb, jsonb);
drop index if exists public.quo_messages_to_idx;
drop index if exists public.quo_messages_from_idx;
drop index if exists public.email_messages_from_lower_idx;
drop index if exists public.email_messages_to_gin_idx;
drop index if exists public.ci_journal_idx;
commit;
