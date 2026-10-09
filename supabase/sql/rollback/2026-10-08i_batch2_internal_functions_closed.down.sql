-- Rollback for 2026-10-08i_batch2_internal_functions_closed.sql
-- Restores the exact pre-Batch-2 ACLs recorded live on 8 Oct (=X public, anon, authenticated, service_role; two were authenticated-only).
do $$
declare f text;
  was_anon_and_auth text[] := array[
    'public.agent_avg_sale_price(uuid)','public.transaction_state_core(uuid)','public.investor_effective_splits(uuid)',
    'public.investor_engagement_stats(uuid)','public.investor_split_attach_document(uuid, uuid)','public.link_google_contacts(uuid)',
    'public.autolink_event_contacts(uuid, date)','public.recompute_contact_communication(uuid)','public.recompute_contact_comms_one(uuid)',
    'public.lead_was_acted(uuid, text, text, timestamp with time zone)','public.lead_queue_count(uuid)','public.sms_lead_verdict(uuid, text, text)',
    'public.is_important_email(uuid, text, text[], boolean)','public.inbound_kind(uuid, text, text, text)','public.user_has_feature(uuid, text)',
    'public.is_producing_user(uuid)','public.resolve_agent_id(text)','public.match_lead_source(text, text)',
    'public.learn_from_dismissals(integer, boolean)','public.lead_concierge_autosweep()','public.refresh_known_senders()',
    'public.refresh_worth_a_look()','public.heal_stuck_disc_folds()','public.morning_brief_fix_payloads()',
    'public.txn_deadline_sweep()','public.capture_worker_outcomes()',
    'public.investor_match_preview(text, text, text, numeric, text, text, numeric, numeric, numeric, numeric, numeric, numeric)',
    'public.local_market_stats(text, numeric)','public.ari_attribute_outcomes(uuid)','public.ari_score_propensity(uuid)'];
  was_auth_only text[] := array['public.prune_email_html(integer, boolean)','public.lead_retire_judged_junk()'];
begin
  foreach f in array was_anon_and_auth loop execute format('grant execute on function %s to public, anon, authenticated, service_role', f); end loop;
  foreach f in array was_auth_only loop execute format('grant execute on function %s to authenticated, service_role', f); end loop;
end $$;
-- cron_call was already closed to anon/authenticated before Batch 2; nothing to restore.
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres grant execute on functions to public;
