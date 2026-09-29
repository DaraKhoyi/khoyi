-- 2026-09-29 — CLOSE THE LOOP: nothing piles up, one thing at a time.
--
-- Panel (Skeptic + Marguerite + Ray), 29 Sep: "Chief-of-staff has queued 111
-- proposals untouched for 30+ days — the loop has never closed once."
-- Marguerite: a backlog that looks like a month of failure is the screen she
-- would walk away from. Ray: 145 "proposed" reads as a score of how far behind
-- he is. Their fix: stop accumulating; surface one item, seen, before the next.
-- Dara: "Part of the problem is I'm not pushing through … other agents are not
-- using the app. Implement something that'll make their recommendation work."
--
-- What was found:
--   * Call follow-ups ("Heard on your calls"): 145 waiting, 144 of them marked
--     "immediate" (due within days). expire_short_fuse_commitments() — written
--     so those would retire after three days — was NEVER SCHEDULED. So they
--     never left. That is the "loop never closed".
--   * Chief of Staff: 4,661 "pending" items for 8 people. Only TODAY's list is
--     ever shown, so the old rows were invisible leftovers — but each morning
--     it paid to build a new list for people who never opened the last one.
--
-- The fix, in the database half (the screens change in the same commit):
--   1. Unreviewed SUGGESTIONS are set aside on a schedule, by how soon the
--      promise was due: immediate after 3 days, near after 14, distant after
--      30 — never one still dated in the future. This was switched off once
--      because "expired" read as a verdict on the agent (Ray) and vanished
--      silently (Fiduciary). So: the screens never say "expired" — they say
--      PrismOS set its older suggestions aside, show how many, and bring any
--      back in one tap. Status 'expired' in the table; nothing is learned
--      from it (only a person's Skip teaches). These are the app's guesses
--      from calls, not tasks the person accepted.
--   2. A follow-up the person brings back stays until they decide.
--   3. Chief of Staff marks yesterday's untouched list expired when it builds
--      today's, and builds a new one only for someone who SAW the last one
--      (cos_runs.seen_at, set when the screen opens). Opening the screen
--      builds a fresh one on the spot.

-- 1 + 2. Follow-ups.
create or replace function public.expire_short_fuse_commitments()
returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.commitments
     set status = 'expired', auto_expired_at = now()
   where status = 'proposed'
     and auto_expired_at is null            -- brought back by hand: the person decides, not the clock
     -- A promise still dated in the future is not stale (the Fiduciary's point:
     -- a deadline must not vanish from the record before it arrives).
     and (due_date is null or due_date < public.today_ny())
     and created_at < now() - case coalesce(fuse, 'near')
                                when 'immediate' then interval '3 days'
                                when 'near' then interval '14 days'
                                else interval '30 days' end;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_short_fuse_commitments() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'commitments-expire-hourly';
select cron.schedule('commitments-expire-hourly', '17 * * * *', $$ select public.expire_short_fuse_commitments() $$);

-- Bring one back (from the "expired" list on the Commitments screen).
create or replace function public.restore_commitment(p_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  update public.commitments set status = 'proposed', decided_at = null
   where id = p_id and user_id = auth.uid() and status = 'expired'
  returning true
$$;
revoke all on function public.restore_commitment(uuid) from public, anon;
grant execute on function public.restore_commitment(uuid) to authenticated;

-- 3. Chief of Staff.
alter table public.cos_runs add column if not exists seen_at timestamptz;

create or replace function public.cos_seen()
returns boolean
language sql security definer set search_path = public as $$
  update public.cos_runs set seen_at = now()
   where user_id = auth.uid() and run_date = (now() at time zone 'America/New_York')::date and seen_at is null
  returning true
$$;
revoke all on function public.cos_seen() from public, anon;
grant execute on function public.cos_seen() to authenticated;

-- The leftovers: every untouched item from an earlier day.
update public.cos_actions set status = 'expired'
 where status = 'pending' and run_date < (now() at time zone 'America/New_York')::date;

-- Retire the backlog now, by the same rule the hourly job uses.
select public.expire_short_fuse_commitments();

-- The morning job calls with the service key, which the function now requires
-- for the every-agent run (it spends AI for everyone). The old header carried a
-- token the function never checked.
select cron.unschedule(jobid) from cron.job where jobname = 'chief-of-staff-daily';
select cron.schedule('chief-of-staff-daily', '0 10 * * *', $$select public.cron_call('chief-of-staff-daily', 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/chief-of-staff', jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), '{}'::jsonb);$$);
