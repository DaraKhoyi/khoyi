-- 2026-10-02b — WHAT IS AT STAKE decides whether a follow-up may be hidden.
--
-- Panel (Skeptic + Ray), 2 Oct: "144 commitments expired via the immediate fuse
-- with zero warnings — the most urgent follow-ups are the ones silently buried."
-- Ray: "I've probably missed things and I have no idea." Dara: "I need to get
-- rid of the noise, but we can't let important things get away — undone."
--
-- Both were right, about different halves of the same pile. Reading the items:
--   "Return home in ~5 minutes", "Send the meeting link", "Get showered and
--   ready by 1:30"                                   — noise; hiding them is correct.
--   "Call title company to authorize key release at closing", "Reduce MLS listing
--   price to $3,995,000", "Call bank to resolve the declined $1,150 payment",
--   "Bradley to email the outcome of the call to the opposing attorney"
--                                                    — hidden by the same rule.
-- The mistake was one word doing two jobs. `fuse` records HOW SOON someone said
-- they would do a thing; it was being used as HOW LITTLE IT MATTERS. "I'll call
-- title right now" is immediate and it is the closing.
--
-- So there are now two questions, asked separately:
--   fuse   — how soon does it go stale?            (immediate | near | distant)
--   stakes — what does it cost if it never happens? (high | normal | low)
--            high = money moving, a contract or its deadlines, a closing, a
--            legal or compliance matter. In real estate these are the things
--            that cost a deal, a deposit or a licence.
-- THE RULE: only something that is BOTH immediate AND not high-stakes is hidden
-- as moot. A high-stakes promise is never stored as 'immediate' — it becomes
-- 'near', which means, with no other rule changing: it is shown for review, it
-- is on Today ahead of ordinary suggestions, it gets the day-before warning, and
-- if it is set aside it is on the list of things that can be brought back.
-- "A follow-up is never set aside without one chance to keep it" now holds for
-- everything that matters, and the noise stays gone.
--
-- Who decides stakes: the model that reads the call (call-commitments, which is
-- told what high stakes means in this business). commitment_stakes_rule() is the
-- floor for rows that arrive without a judgement, and for the backfill.
-- Idempotent.

alter table public.commitments add column if not exists stakes text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commitments_stakes_check') then
    alter table public.commitments add constraint commitments_stakes_check check (stakes is null or stakes in ('high', 'normal', 'low'));
  end if;
end $$;

create or replace function public.commitment_stakes_rule(p_text text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_text ~* '(\$\s?\d|\m(wire (transfer|instructions|funds|payment)|disbursement|pay-?off|escrow|earnest|deposit|emd|rent check|invoice|commission|refund|payment|overdraft|transfer (the )?(money|funds)|price (reduction|change|drop)|reduc\w+ (the )?(mls |listing )?price|offer|counter-?offer)\M)'
      or p_text ~* '\m(contract|addendum|amendment|extension|due diligence|inspection|contingenc\w+|closing|appraisal|underwrit\w+|loan|lender|title (company|agent|work|commitment)|deed|survey|lease|renewal|evict\w+|disclosure|listing agreement|mls|notar\w+|signed|signing|signature|operating agreement|permit|key release|lockbox)\M'
      or p_text ~* '\m(attorney|lawyer|court|lawsuit|dispute|compliance|cancel\w*|petition)\M'
      then 'high'
    when p_text ~* '(in (like )?(\d+|a few|five|ten|a couple( of)?) (minutes|min)\M|right back|call (you|me) back|on my way|\mbe there\M|\mride\M|shower|meeting link|calendar invit|get ready|hit the road)'
      then 'low'
    else 'normal' end
$$;

create or replace function public.commitment_stamp_stakes()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.stakes is null then
    NEW.stakes := public.commitment_stakes_rule(coalesce(NEW.title, '') || ' ' || coalesce(NEW.quote, '') || ' ' || coalesce(NEW.context, ''));
  end if;
  -- High stakes is never "moot within hours".
  if NEW.stakes = 'high' and NEW.fuse = 'immediate' then NEW.fuse := 'near'; end if;
  return NEW;
end $$;

drop trigger if exists commitment_stamp_stakes_trg on public.commitments;
create trigger commitment_stamp_stakes_trg before insert or update of stakes, fuse, title
  on public.commitments for each row execute function public.commitment_stamp_stakes();

-- Backfill: every existing row gets a judgement (the trigger lifts the fuse of
-- the high-stakes ones, which puts the set-aside ones on the bring-back list).
update public.commitments
   set stakes = public.commitment_stakes_rule(coalesce(title, '') || ' ' || coalesce(quote, '') || ' ' || coalesce(context, ''))
 where stakes is null;

-- The recent ones are still worth one look: high-stakes follow-ups the old rule
-- set aside in the last ten days come back for review. Older ones are not put
-- back on Today — a pile is its own kind of noise — but they are now on the
-- "set aside" list, where nothing consequential was before.
update public.commitments
   set status = 'proposed', auto_expired_at = null, expiry_warned_at = null
 where status = 'expired' and stakes = 'high' and created_at > now() - interval '10 days'
   and auto_expired_at is not null;

-- Today: a call that left something high-stakes goes ahead of ordinary
-- suggestions, and says why. Patched in place (the function is long and other
-- migrations own the rest of it).
do $$
declare d text;
begin
  select pg_get_functiondef('public.chief_queue(integer)'::regprocedure) into d;
  if position('c.stakes' in d) = 0 then
    if position('2 priority, max(c.created_at) at_' in d) = 0
       or position($s$coalesce('Heard on your call with ' || max(ct.name), 'Heard on one of your calls') why,$s$ in d) = 0 then
      raise exception 'chief_queue has changed shape — patch 2026-10-02b by hand';
    end if;
    d := replace(d, '2 priority, max(c.created_at) at_',
                    $s$case when bool_or(c.stakes = 'high') then 1 else 2 end priority, max(c.created_at) at_$s$);
    d := replace(d, $s$coalesce('Heard on your call with ' || max(ct.name), 'Heard on one of your calls') why,$s$,
                    $s$coalesce('Heard on your call with ' || max(ct.name), 'Heard on one of your calls')
             || case when bool_or(c.stakes = 'high') then ' — money, a deadline or a contract is involved' else '' end why,$s$);
    execute d;
  end if;
end $$;
