-- 2026-09-30 — THE LIBRARY CAN HOLD A TALK, AND EVERY AGENT CAN OPEN IT.
--
-- Dara: "Store these files in PrismOS and make them available to everyone using
-- the app" (Ricky Caruth's talk: cleaned audio, transcript, summary). Three
-- things stood in the way:
--
--   1. A shared file could not be opened by anyone but its owner. The storage
--      rule for the `knowledge` bucket was "your own folder only", so a "Whole
--      brokerage" item showed its title to every agent and its file to nobody.
--      Now: you can read a library file exactly when you can see its library
--      entry (knowledge_sources' own row-level security decides — brokerage
--      scope for every signed-in agent, team scope for the team).
--   2. Long recordings could not be transcribed. knowledge-ingest waited ~2
--      minutes for the transcript inside one request; a 72-minute talk takes
--      far longer, so it failed ("try a shorter clip"). Now long audio is handed
--      to the transcription service and collected by a 2-minute poll
--      (knowledge-transcribe-poll), with speakers and timestamps kept.
--   3. Anyone could publish to the whole brokerage through the function (the
--      screen hid the option, the server did not). Now staff only — the library
--      is what Prism answers from.

alter table public.knowledge_sources
  add column if not exists transcript_job text,
  add column if not exists transcript jsonb,          -- [{start_ms,end_ms,speaker,text}]
  add column if not exists speaker_names jsonb,       -- {"A":"Ricky Caruth","B":"Audience"}
  add column if not exists duration_s numeric;

drop policy if exists knowledge_read_shared on storage.objects;
create policy knowledge_read_shared on storage.objects for select to authenticated
  using (bucket_id = 'knowledge'
         and exists (select 1 from public.knowledge_sources k where k.original_path = storage.objects.name));

select cron.unschedule(jobid) from cron.job where jobname = 'knowledge-transcribe-poll';
select cron.schedule('knowledge-transcribe-poll', '*/2 * * * *',
  $$ select public.cron_call('knowledge-transcribe-poll', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/knowledge-ingest',
       jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
       '{"poll_transcripts":true}'::jsonb) $$);
