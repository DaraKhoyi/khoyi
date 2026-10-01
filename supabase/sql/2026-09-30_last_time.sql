-- 2026-09-30 — "WHAT DID I SAY LAST TIME?" — PLAIN, WITH NO JUDGEMENT.
--
-- Ray (panel): "I always forget what I said last time… if it did that one thing
-- I would not feel stupid." And he closes anything that scores the relationship
-- or shows how long it has been. _shared/lastTime.ts writes three sentences —
-- what you last said, what they last said, what the last call was about — each
-- with a calendar date and nothing else. The research brief and call prep no
-- longer state elapsed time ("47 days ago") or grade the relationship.
alter table public.profiles
  add column if not exists last_time jsonb,
  add column if not exists last_time_through timestamptz;
