-- 2026-09-30 — EVERY AI CALL NAMES THE PERSON IT WAS ABOUT, AUTOMATICALLY.
--
-- The Archivist + the Merchant (panel): "2,866 of 2,872 AI calls carry no
-- contact_id — the ROI chain from spend to person to deal can never be closed."
-- Dara: "If you can fix it, do so. It's better for things to be automatic."
--
-- Nobody tags anything. Each function records what it was ALREADY working on —
-- an email thread, a call, a lead card, a contact, or just the other person's
-- address — and this trigger turns that into the person (contact_id), plus the
-- address itself (subject_email / subject_phone) so a closing can be matched
-- even when the person was never saved as a contact. Calls that are not about
-- one person (a chat with Prism, a briefing, planning the day) say so
-- (about = 'no_one'), so they stop counting as "missing".
--
-- smoke/ai_subject_guard.mjs fails the gate if a function that spends AI does
-- not say what it was about, and proves the trigger resolves each kind.

alter table public.ai_usage_log
  add column if not exists contact_id uuid,
  add column if not exists subject_email text,
  add column if not exists subject_phone text,
  add column if not exists about text;
create index if not exists ai_usage_log_contact on public.ai_usage_log (contact_id) where contact_id is not null;
create index if not exists ai_usage_log_subject_email on public.ai_usage_log (subject_email) where subject_email is not null;

-- Functions whose AI work is not about one person. Kept here, in one place, with
-- the gate checking that every AI-spending function is either on it or names
-- its subject.
create or replace function public.ai_fn_not_about_a_person(p_fn text)
returns boolean language sql immutable as $$
  select p_fn in (
    'robot-chat', 'talk-to-prism', 'coach-chat',                      -- conversations with Prism
    'ari-briefing', 'ari-briefing-deliver', 'chief-of-staff', 'plan-my-day', 'day-review',
    'journal-analyze', 'task-dedupe', 'task-autoschedule', 'voice-note', 'email-to-task',
    'knowledge-ask', 'knowledge-ingest', 'knowledge-enrich', 'myvoice-synthesize',
    'unstuck-analyze', 'correspondent-research', 'correspondent-compliance', 'correspondent-personalize',
    'files-intake-scan', 'files-doc-extract', 'document-extract', 'recording-process',
    'panel-draft', 'night-review', 'usage-report-monthly', 'coach-recording-review')
$$;

create or replace function public.ai_usage_subject()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_phone text; v_cid uuid; v_mine text[];
begin
  v_email := nullif(lower(btrim(new.subject_email)), '');
  v_phone := public.phone10(new.subject_phone);
  select coalesce(array_agg(lower(email_address)), '{}') into v_mine from email_accounts where user_id = new.user_id;

  if new.subject_type = 'contact' then
    v_cid := new.subject_id;
  elsif new.subject_type = 'lead_card' then
    select lc.contact_id, coalesce(v_email, lower(lc.lead_email)), coalesce(v_phone, public.phone10(lc.lead_phone))
      into v_cid, v_email, v_phone from lead_concierge lc where lc.id = new.subject_id;
  elsif new.subject_type = 'call' then
    select q.contact_id, coalesce(v_phone, public.phone10(case when q.direction = 'outgoing' then q.to_number else q.from_number end))
      into v_cid, v_phone from quo_calls q where q.id = new.subject_id;
  elsif new.subject_type = 'commitment' then
    select c.contact_id into v_cid from commitments c where c.id = new.subject_id;
  elsif new.subject_type in ('email_thread', 'email_message') and v_email is null then
    -- The other person: the latest sender who is not you, else whom you wrote to.
    select coalesce(
      (select lower(m.from_address) from email_messages_all m
        where (case when new.subject_type = 'email_thread' then m.thread_id else m.id end) = new.subject_id
          and m.direction = 'inbound' and not (lower(m.from_address) = any(v_mine))
        order by m.internal_date desc limit 1),
      (select lower(t->>'email') from email_messages_all m,
              jsonb_array_elements(case when jsonb_typeof(m.to_addresses) = 'array' then m.to_addresses else '[]'::jsonb end) t
        where (case when new.subject_type = 'email_thread' then m.thread_id else m.id end) = new.subject_id
          and m.direction = 'outbound' and not (lower(t->>'email') = any(v_mine))
        order by m.internal_date desc limit 1))
      into v_email;
  end if;

  -- An address or number is enough: find their contact in this person's book.
  if v_cid is null and v_email is not null then
    select c.id into v_cid from contacts c where c.user_id = new.user_id and lower(c.email) = v_email
     order by c.updated_at desc nulls last limit 1;
  end if;
  if v_cid is null and v_phone is not null then
    select c.id into v_cid from contacts c where c.user_id = new.user_id and public.phone10(c.phone) = v_phone
     order by c.updated_at desc nulls last limit 1;
  end if;
  if v_email is null and v_cid is not null then select lower(c.email) into v_email from contacts c where c.id = v_cid; end if;

  new.contact_id := coalesce(new.contact_id, v_cid);
  new.subject_email := v_email;
  new.subject_phone := v_phone;
  new.about := case when new.contact_id is not null or v_email is not null or v_phone is not null then 'person'
                    when public.ai_fn_not_about_a_person(new.fn) then 'no_one' end;
  return new;
end $$;

drop trigger if exists ai_usage_subject_trg on public.ai_usage_log;
create trigger ai_usage_subject_trg before insert on public.ai_usage_log
  for each row execute function public.ai_usage_subject();

-- Existing rows: the ones that already named a contact, and the no-one kinds.
update public.ai_usage_log set contact_id = subject_id, about = 'person' where subject_type = 'contact' and contact_id is null;
update public.ai_usage_log set about = 'no_one' where about is null and public.ai_fn_not_about_a_person(fn);

-- Past lead-concierge spend: each draft was logged seconds before its card was
-- made, for the same agent. Pair them (within 2 minutes, nearest card) so the
-- concierge's history is not lost.
update public.ai_usage_log l set subject_type = 'lead_card', subject_id = x.card, contact_id = x.cid,
       subject_email = x.em, subject_phone = x.ph, about = 'person'
  from (select distinct on (l2.id) l2.id lid, lc.id card, lc.contact_id cid, lower(lc.lead_email) em, public.phone10(lc.lead_phone) ph
          from ai_usage_log l2 join lead_concierge lc on lc.user_id = l2.user_id
           and lc.created_at between l2.created_at - interval '5 seconds' and l2.created_at + interval '2 minutes'
         where l2.fn = 'lead-concierge' and l2.subject_id is null
         order by l2.id, abs(extract(epoch from lc.created_at - l2.created_at))) x
 where l.id = x.lid;

-- ── Outcomes read the person, whichever way the call named them ────────────
create or replace function public.ai_spend_with_outcome(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by (x->>'usd')::numeric desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'fn', l.fn,
      'calls', count(*),
      'usd', round(sum(l.cost_usd)::numeric, 2),
      'per_call', round((sum(l.cost_usd)/count(*))::numeric, 4),
      'not_about_a_person', count(*) filter (where l.about = 'no_one'),
      'with_subject', count(*) filter (where l.about = 'person'),
      'acted_on', count(*) filter (where public.spend_acted_row(l.subject_type, l.subject_id, l.contact_id, l.created_at)),
      'acted_pct', round(100.0 * count(*) filter (where public.spend_acted_row(l.subject_type, l.subject_id, l.contact_id, l.created_at))
        / nullif(count(*) filter (where l.about = 'person'), 0), 0)
    ) x
    from ai_usage_log l
    where l.created_at > now() - (p_days || ' days')::interval
      and (l.user_id = auth.uid() or public.is_brokerage_staff() or auth.role() = 'service_role')
    group by l.fn
  ) s
$$;

create or replace function public.spend_acted_row(p_type text, p_id uuid, p_contact uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_type = 'lead_card' then public.spend_acted('lead_card', p_id, p_at)
    when p_contact is not null then public.spend_acted('contact', p_contact, p_at)
    else false end
$$;
revoke all on function public.spend_acted_row(text, uuid, uuid, timestamptz) from public, anon, authenticated;

-- Closings: AI spent on the client counts whether it named their contact or
-- only their address.
do $$
declare d text;
begin
  select pg_get_functiondef('public.closing_attribution(date,date)'::regprocedure) into d;
  if position('l.subject_email = any(cl.emails)' in d) = 0 then
    d := replace(d,
$old$    select x.tid, count(*)::int n, round(sum(l.cost_usd)::numeric, 2) usd, min(x.cid::text)::uuid cid
    from cids x join ai_usage_log l on l.subject_type = 'contact' and l.subject_id = x.cid
    join cl on cl.id = x.tid and l.created_at::date <= cl.closed_on
    group by x.tid)$old$,
$new$    -- Named by contact OR only by address (30 Sep: the trigger fills both).
    select cl.id tid, count(*)::int n, round(sum(l.cost_usd)::numeric, 2) usd, min(l.contact_id::text)::uuid cid
    from cl join ai_usage_log l
      on l.created_at::date <= cl.closed_on and l.created_at > cl.closed_on - interval '3 years'
     and (l.contact_id in (select c2.cid from cids c2 where c2.tid = cl.id)
          or (l.subject_email is not null and l.subject_email = any(cl.emails)))
    group by cl.id)$new$);
    if position('l.subject_email = any(cl.emails)' in d) = 0 then raise exception 'closing_attribution: ai block not found'; end if;
    execute d;
  end if;
end $$;

-- The blocker now counts only calls that were about a person.
do $$
declare d text;
begin
  select pg_get_functiondef('public.business_outcomes(integer)'::regprocedure) into d;
  if position('about a person name them' in d) = 0 then
    d := replace(d,
$old$      union all select 'Only ' || (select count(*) from ai_usage_log where subject_id is not null and created_at > now() - (p_days || ' days')::interval) || ' of ' || (select count(*) from spend) || ' AI calls name the contact they were about, so most spend cannot be followed to a person.'
        where (select count(*) from spend) > 0$old$,
$new$      union all select 'Of ' || x.should || ' AI calls about a person, ' || x.named || ' about a person name them (' || x.no_one || ' more were not about one person — chat, briefings, planning). Calls before 30 Sep 2026 were not recorded this way.'
        from (select count(*) filter (where about is distinct from 'no_one') should, count(*) filter (where about = 'person') named,
                     count(*) filter (where about = 'no_one') no_one
                from ai_usage_log where created_at > now() - (p_days || ' days')::interval) x
       where x.named < x.should$new$);
    if position('about a person name them' in d) = 0 then raise exception 'business_outcomes: blocker line not found'; end if;
    execute d;
  end if;
end $$;

-- ── Deals and transactions (30 Sep, second pass) ───────────────────────────
-- Work on a transaction's documents or a deal's plan is about the DEAL — better
-- than a person for tying spend to a closing: a transaction id IS the closing.
create or replace function public.ai_fn_not_about_a_person(p_fn text)
returns boolean language sql immutable as $$
  select p_fn in (
    'robot-chat', 'talk-to-prism', 'coach-chat',                      -- conversations with Prism
    'ari-briefing', 'ari-briefing-deliver', 'chief-of-staff', 'plan-my-day', 'day-review',
    'journal-analyze', 'journal-daily-summary', 'journal-period-summary', 'journal-search',
    'task-dedupe', 'task-autoschedule', 'task-quadrant-suggest', 'task-email-ingest', 'voice-note', 'email-to-task',
    'knowledge-ask', 'knowledge-ingest', 'knowledge-enrich', 'brain-embed', 'brain-semantic-search',
    'document-search', 'calls-to-knowledge', 'myvoice-synthesize', 'playbook-parse', 'parse-receipt',
    'unstuck-analyze', 'correspondent-research', 'correspondent-compliance', 'correspondent-personalize',
    'ari-disc-broadcast',                                                -- one message to a group
    'disc-readout', 'sync-agent-profiles',                              -- about an AGENT, not a client
    'commitment-rejudge',                                               -- a batch across many calls
    'recording-identify', 'recording-transcribe-poll',                  -- finding out who it was
    'files-intake-scan', 'files-doc-extract', 'document-extract', 'recording-process',
    'panel-draft', 'night-review', 'usage-report-monthly', 'coach-recording-review')
$$;

do $$
declare d text;
begin
  select pg_get_functiondef('public.ai_usage_subject'::regproc) into d;
  if position('''transaction''' in d) = 0 then
    d := replace(d, $o$  elsif new.subject_type = 'commitment' then$o$,
$n$  elsif new.subject_type = 'transaction' then
    select coalesce(v_email, nullif(lower(split_part(btrim(bt.client_email), ',', 1)), '')) into v_email
      from brokerage_transactions bt where bt.id = new.subject_id;
  elsif new.subject_type = 'commitment' then$n$);
    d := replace(d, $o$  new.about := case when new.contact_id is not null$o$,
$n$  new.about := case when new.subject_type in ('transaction', 'deal') and new.subject_id is not null then 'deal'
                    when new.contact_id is not null$n$);
    execute d;
  end if;
end $$;
update public.ai_usage_log set about = 'no_one' where about is null and public.ai_fn_not_about_a_person(fn);

-- A closing counts the AI spent on its own transaction documents too.
do $$
declare d text;
begin
  select pg_get_functiondef('public.closing_attribution(date,date)'::regprocedure) into d;
  if position('l.subject_type = ''transaction'' and l.subject_id = cl.id' in d) = 0 then
    d := replace(d, $o$          or (l.subject_email is not null and l.subject_email = any(cl.emails)))$o$,
$n$          or (l.subject_email is not null and l.subject_email = any(cl.emails))
          or (l.subject_type = 'transaction' and l.subject_id = cl.id))$n$);
    if position('l.subject_type = ''transaction'' and l.subject_id = cl.id' in d) = 0 then raise exception 'closing_attribution: txn line not found'; end if;
    execute d;
  end if;
end $$;

-- ── Recover history where the moment gives it away (30 Sep) ────────────────
-- Each call job logs its spend in the same minute it stamps the call; each
-- inbox triage logs in the same minute it writes the thread's triage. Pair on
-- (same person, nearest within 2 minutes). Nightly inbox reads left no per-thread
-- stamp, so their history stays unattributed rather than guessed.
update public.ai_usage_log l set subject_type = 'call', subject_id = x.qid, contact_id = coalesce(l.contact_id, x.cid), subject_phone = x.ph, about = 'person'
  from (select distinct on (l2.id) l2.id lid, qc.id qid, qc.contact_id cid,
               public.phone10(case when qc.direction = 'outgoing' then qc.to_number else qc.from_number end) ph
          from ai_usage_log l2 join quo_calls qc on qc.user_id = l2.user_id
           and (case l2.fn when 'quo-call-process' then qc.processed_at when 'call-commitments' then qc.commitments_read_at else qc.enriched_at end)
               between l2.created_at - interval '5 seconds' and l2.created_at + interval '2 minutes'
         where l2.fn in ('quo-call-process', 'call-commitments', 'call-enrich') and l2.subject_id is null
         order by l2.id, abs(extract(epoch from (case l2.fn when 'quo-call-process' then qc.processed_at when 'call-commitments' then qc.commitments_read_at else qc.enriched_at end) - l2.created_at))) x
 where l.id = x.lid;

update public.ai_usage_log l set subject_type = 'email_thread', subject_id = x.tid, about = 'person',
       subject_email = x.em, contact_id = (select c.id from contacts c where c.user_id = l.user_id and lower(c.email) = x.em order by c.updated_at desc nulls last limit 1)
  from (select distinct on (l2.id) l2.id lid, et.thread_id tid,
               (select lower(m.from_address) from email_messages_all m where m.thread_id = et.thread_id and m.direction = 'inbound' order by m.internal_date desc limit 1) em
          from ai_usage_log l2 join email_triage et on et.user_id = l2.user_id
           and et.created_at between l2.created_at - interval '2 minutes' and l2.created_at + interval '2 minutes'
         where l2.fn = 'email-intelligence' and l2.subject_id is null
         order by l2.id, abs(extract(epoch from et.created_at - l2.created_at))) x
 where l.id = x.lid and x.em is not null;

-- ── A closing learns its client from its own contract (30 Sep) ─────────────
-- txn-contract-extract reads buyers and sellers off the signed contract but held
-- them for someone to confirm — a step nobody takes. The names are facts on a
-- signed document; they now go straight onto the transaction when its buyer /
-- seller are still empty (never overwriting what a person typed), so the
-- closing can be matched to the client without anyone doing anything.
create or replace function public.txn_parties_from_contract()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contract_data is null or new.contract_data is not distinct from old.contract_data then return new; end if;
  if nullif(btrim(new.buyer_name), '') is null then
    new.buyer_name := nullif(array_to_string(array(select btrim(x) from jsonb_array_elements_text(coalesce(new.contract_data->'buyers', '[]')) x where btrim(x) <> ''), ' & '), '');
  end if;
  if nullif(btrim(new.seller_name), '') is null then
    new.seller_name := nullif(array_to_string(array(select btrim(x) from jsonb_array_elements_text(coalesce(new.contract_data->'sellers', '[]')) x where btrim(x) <> ''), ' & '), '');
  end if;
  return new;
end $$;
drop trigger if exists txn_parties_from_contract_trg on public.brokerage_transactions;
create trigger txn_parties_from_contract_trg before update of contract_data on public.brokerage_transactions
  for each row execute function public.txn_parties_from_contract();
