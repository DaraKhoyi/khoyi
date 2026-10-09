-- =====================================================================
-- Security Batch 2 (8 Oct 2026) — internal database functions anyone could call.
-- Audit findings M1, M2, M3 (part), H5 (agent_avg_sale_price).
--
-- A. Worker / cron / edge-function-only functions: EXECUTE revoked from
--    public, anon AND authenticated. service_role keeps it. Every caller was
--    checked on 8 Oct:
--      * src/ (the app) calls none of them (grep for .rpc('<name>')).
--      * edge functions call them only through a SERVICE-ROLE client
--        (gmail-sync, calendar-sync, google-contacts-sync, quo-webhook,
--        sheets-sync, lead-triage-worker).
--      * pg_cron jobs and other SECURITY DEFINER functions run as the owner
--        (postgres), which is not affected.
--      * no RLS policy, view, or SECURITY INVOKER function references them.
-- B. App-facing functions that stay open to signed-in users but are closed
--    to signed-out callers (anon): investor_match_preview, local_market_stats
--    (ListingPresentation / InvestorPipeline screens), ari_attribute_outcomes and
--    ari_score_propensity (Ari briefing; they already lock p_user to the caller
--    whenever someone is signed in, so anon was the only way to pick a user).
-- C. Default privileges: functions created by postgres in public from now on
--    are NOT executable by anon (or PUBLIC). Signed-in users and the service
--    role still get EXECUTE by default, so new app RPCs keep working. A new
--    function that must answer signed-out callers needs an explicit
--    "grant execute ... to anon".
-- ROLLBACK: supabase/sql/rollback/2026-10-08i_batch2_internal_functions_closed.down.sql
-- =====================================================================

do $$
declare
  f text;
  internal text[] := array[
    'public.agent_avg_sale_price(uuid)',
    'public.transaction_state_core(uuid)',
    'public.investor_effective_splits(uuid)',
    'public.investor_engagement_stats(uuid)',
    'public.investor_split_attach_document(uuid, uuid)',
    'public.link_google_contacts(uuid)',
    'public.autolink_event_contacts(uuid, date)',
    'public.recompute_contact_communication(uuid)',
    'public.recompute_contact_comms_one(uuid)',
    'public.lead_was_acted(uuid, text, text, timestamp with time zone)',
    'public.lead_queue_count(uuid)',
    'public.sms_lead_verdict(uuid, text, text)',
    'public.is_important_email(uuid, text, text[], boolean)',
    'public.inbound_kind(uuid, text, text, text)',
    'public.user_has_feature(uuid, text)',
    'public.is_producing_user(uuid)',
    'public.resolve_agent_id(text)',
    'public.match_lead_source(text, text)',
    'public.prune_email_html(integer, boolean)',
    'public.learn_from_dismissals(integer, boolean)',
    'public.lead_concierge_autosweep()',
    'public.lead_retire_judged_junk()',
    'public.refresh_known_senders()',
    'public.refresh_worth_a_look()',
    'public.heal_stuck_disc_folds()',
    'public.morning_brief_fix_payloads()',
    'public.txn_deadline_sweep()',
    'public.capture_worker_outcomes()',
    'public.cron_call(text, text, jsonb, jsonb)'
  ];
  signed_in_only text[] := array[
    'public.investor_match_preview(text, text, text, numeric, text, text, numeric, numeric, numeric, numeric, numeric, numeric)',
    'public.local_market_stats(text, numeric)',
    'public.ari_attribute_outcomes(uuid)',
    'public.ari_score_propensity(uuid)'
  ];
begin
  foreach f in array internal loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array signed_in_only loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- C. New functions start closed to signed-out callers.
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
