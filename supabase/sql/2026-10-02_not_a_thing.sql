-- 2026-10-02 — "Not a thing": the person teaches PrismOS what not to raise.
--
-- Dara, 2 Oct: "I want to train my AI to give me relevant items. Delete should
-- be non-judgemental. Not a thing should teach the AI it brought up something
-- that maybe it shouldn't have."
--
-- Three ways to close something heard on a call, each meaning one thing:
--   Done        — it happened.                      status = 'done'
--   Delete      — off my list, no judgement.        status = 'dismissed'
--   Not a thing — PrismOS should not have raised it. status = 'dismissed'
--                                                    + not_a_thing_at
-- The stamp is the lesson. call-commitments reads the person's most recent ones
-- (supabase/functions/_shared/lessons.ts) and is told not to raise their like
-- again. Each person teaches only their own PrismOS. Undo clears the stamp.
-- Idempotent.
alter table public.commitments add column if not exists not_a_thing_at timestamptz;
create index if not exists commitments_not_a_thing_idx on public.commitments (user_id, not_a_thing_at desc)
  where not_a_thing_at is not null;
