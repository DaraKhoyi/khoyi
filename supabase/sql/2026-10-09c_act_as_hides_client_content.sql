-- =====================================================================
-- Requires PR #10 (08c: public.is_support_session()). Merge this PR only AFTER #10,
-- so apply-sql runs 08c before this file (it applies new files in name order).
-- "Act as" (a support session) stops seeing an agent's PRIVATE client content.
-- Company Leads stay visible (they are brokerage records, R2). Counts in the
-- broker's own screens are unaffected (those run as the broker, not as act-as).
-- Closes the largest gap against "the broker sees counts, never content" (H7).
-- ROLLBACK: rollback/2026-10-09c_act_as_hides_client_content.down.sql
-- =====================================================================
begin;
-- Take every lock up front, in one order, and give up fast: the dry run
-- deadlocked once against live Quo traffic without this.
set local lock_timeout = '5s';
lock table public.quo_calls, public.quo_messages, public.contacts, public.contact_notes, public.contact_interactions, public.commitments, public.tasks, public.lead_concierge, public.recordings, public.journal_entries, public.deals in access exclusive mode;
drop policy if exists act_as_hides_clients on public.contacts;
create policy act_as_hides_clients on public.contacts as restrictive for all to authenticated
  using (not (select public.is_support_session()) or company_lead)
  with check (not (select public.is_support_session()) or company_lead);

do $d$
declare t text;
begin
  -- tables that point at a contact: hidden unless that contact is a Company Lead
  foreach t in array array['contact_notes','contact_interactions','commitments','quo_calls','tasks','lead_concierge','recordings'] loop
    execute format('drop policy if exists act_as_hides_clients on public.%I', t);
    execute format($p$create policy act_as_hides_clients on public.%I as restrictive for all to authenticated
      using (not (select public.is_support_session())
             or exists (select 1 from public.contacts c where c.id = %I.contact_id and c.company_lead))
      with check (not (select public.is_support_session()))$p$, t, t);
  end loop;
  -- tables with no contact link: hidden entirely during a support session
  foreach t in array array['quo_messages','journal_entries','deals'] loop
    execute format('drop policy if exists act_as_hides_clients on public.%I', t);
    execute format($p$create policy act_as_hides_clients on public.%I as restrictive for all to authenticated
      using (not (select public.is_support_session())) with check (not (select public.is_support_session()))$p$, t);
  end loop;
end $d$;
commit;
