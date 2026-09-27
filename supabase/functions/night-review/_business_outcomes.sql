-- business_outcomes(): recorded 27 Sep. The one place ROI is measured. See HANDOFF §8.
CREATE OR REPLACE FUNCTION public.business_outcomes(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- WHAT DID THE AI SPEND PRODUCE? ONE place that answers it (27 Sep), from facts
  -- already recorded — never from outcome rows each function must remember to
  -- write (those drift, like every duplicated writer found this month).
  -- Chain: AI spend -> lead found -> lead answered -> client -> closing -> GCI.
  -- Where a link is missing it says so in blocked_by instead of inventing a
  -- number. Attribution switches on by itself when closings carry the client
  -- (Gold Report "Client"/"Client Email" column, or an extracted contract).
  with gate as (select public.is_brokerage_staff() or auth.role() = 'service_role' ok),
  spend as (
    select case
      when fn in ('lead-concierge','lead-brief','email-reply-draft','ai-followup-draft','ari-rewrite','lead-triage-worker','lead-concierge-send') then 'Leads & replies'
      when fn in ('contact-research','property-research','correspondent-research','correspondent-personalize','unstuck-analyze','contact-identify','disc-analyze') then 'Research'
      when fn in ('chief-of-staff','ari-briefing','ari-briefing-deliver','plan-my-day','day-review','ari-call-prep') then 'Briefings & planning'
      when fn in ('email-nightly-intel','email-intelligence','task-email-ingest','email-to-task','files-intake-scan','files-doc-extract','document-extract') then 'Inbox & documents'
      when fn ~ '^(call-|quo-|recording-|voice-note|calls-to-)' then 'Calls & recordings'
      when fn in ('robot-chat','coach-chat','coach-recording-review') then 'Assistant (Ari)'
      else 'Other' end purpose, cost_usd, fn
    from ai_usage_log where created_at > now() - (p_days || ' days')::interval),
  leads as (
    select lc.* from lead_concierge lc
    where lc.kind = 'lead' and lc.source is not null      -- source is set only by the 21 Sep lead gate
      and lc.first_seen_at > now() - (p_days || ' days')::interval),
  answered as (select * from leads where first_response_at is not null or status in ('sent','handled')),
  co as (select * from brokerage_leads where received_at > now() - (p_days || ' days')::interval),
  closings as (
    select bt.id, bt.address, coalesce(bt.date_paid, bt.date_received) closed_on, bt.gross_commission gci,
           nullif(lower(bt.client_email),'') email,
           array_remove(array[
             nullif(lower(regexp_replace(coalesce(bt.buyer_name,''),'[^A-Za-z ]','','g')),''),
             nullif(lower(regexp_replace(coalesce(bt.seller_name,''),'[^A-Za-z ]','','g')),'')], null) names
    from brokerage_transactions bt
    where coalesce(bt.date_paid, bt.date_received) between current_date - p_days and current_date),
  touches as (   -- every way PrismOS demonstrably touched a person, with when
    select lower(lead_email) email, lower(regexp_replace(coalesce(lead_name,''),'[^A-Za-z ]','','g')) nm, first_seen_at at_, 'lead card (' || coalesce(source,'?') || ')' how from lead_concierge
    union all select lower(lead_email), lower(regexp_replace(coalesce(lead_name,''),'[^A-Za-z ]','','g')), received_at, 'company lead (' || source || ')' from brokerage_leads
    union all select lower(c.email), lower(regexp_replace(coalesce(c.name,''),'[^A-Za-z ]','','g')), l.created_at, 'AI ' || l.fn
      from ai_usage_log l join contacts c on l.subject_type = 'contact' and c.id = l.subject_id),
  attributed as (
    select distinct on (c.id) c.id, c.address, c.closed_on, c.gci, t.how, t.at_
    from closings c join touches t
      on ((c.email is not null and t.email = c.email) or (length(t.nm) > 5 and t.nm = any(c.names)))
     and t.at_::date <= c.closed_on and t.at_ > c.closed_on - interval '365 days'
    order by c.id, t.at_)
  select case when not (select ok from gate) then jsonb_build_object('error','staff or service role only') else jsonb_build_object(
    'window_days', p_days,
    'ai_spend', jsonb_build_object(
      'usd', (select round(coalesce(sum(cost_usd),0)::numeric,2) from spend),
      'calls', (select count(*) from spend),
      'by_purpose', (select coalesce(jsonb_agg(x order by (x->>'usd')::numeric desc),'[]') from (
          select jsonb_build_object('purpose', purpose, 'usd', round(sum(cost_usd)::numeric,2), 'calls', count(*)) x from spend group by purpose) s)),
    'leads', jsonb_build_object(
      'found', (select count(*) from leads),
      'by_source', (select coalesce(jsonb_object_agg(source, n),'{}') from (select source, count(*) n from leads group by 1) s),
      'answered', (select count(*) from answered),
      'answered_within_5_min', (select count(*) from answered where first_response_at <= first_seen_at + interval '5 minutes'),
      'median_minutes_to_answer', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_response_at - first_seen_at)/60))::numeric) from answered where first_response_at is not null),
      'waiting_now', (select count(*) from leads where status = 'pending')),
    'company_leads', jsonb_build_object(
      'found', (select count(*) from co),
      'claimed', (select count(distinct la.lead_id) from lead_assignments la join co on co.id = la.lead_id where la.claimed_at is not null),
      'with_broker_waiting', (select count(*) from brokerage_leads where status = 'with_broker')),
    'cost_per_answered_lead_usd', (select round((select coalesce(sum(cost_usd),0) from spend where purpose = 'Leads & replies') / nullif((select count(*) from answered),0), 2)),
    'closings', jsonb_build_object(
      'count', (select count(*) from closings),
      'gci', (select round(coalesce(sum(gci),0)) from closings),
      'with_client_identity', (select count(*) from closings where email is not null or cardinality(names) > 0)),
    'attributed_to_prismos', jsonb_build_object(
      'closings', (select count(*) from attributed),
      'gci', (select round(coalesce(sum(gci),0)) from attributed),
      'evidence', (select coalesce(jsonb_agg(jsonb_build_object('address', address, 'closed_on', closed_on, 'gci', gci,
                     'first_touch', how, 'touched_on', at_::date) order by closed_on desc),'[]') from attributed)),
    'blocked_by', (select coalesce(jsonb_agg(b),'[]') from (
      select 'No closing in this window records who the client was (the Gold Report has no client column and no contract has been extracted), so no sale can be tied to a lead or to AI spend. Add "Client" and "Client Email" columns to the Gold Report.' b
        where (select count(*) from closings) > 0 and (select count(*) from closings where email is not null or cardinality(names) > 0) = 0
      union all select 'Only ' || (select count(*) from ai_usage_log where subject_id is not null and created_at > now() - (p_days || ' days')::interval) || ' of ' || (select count(*) from spend) || ' AI calls name the contact they were about, so most spend cannot be followed to a person.'
        where (select count(*) from spend) > 0
      union all select 'Lead cards found only in connected mailboxes (' || (select count(*) from email_accounts where 'email' = any(purposes) and reauth_required_at is null) || ' working); leads to everyone else are invisible.'
    ) s),
    'note', 'Attributed means PrismOS surfaced, drafted for or researched the client BEFORE the closing, within a year — evidence, not proof of cause. Leads count only cards from the 21 Sep lead gate.'
  ) end
$function$
;
