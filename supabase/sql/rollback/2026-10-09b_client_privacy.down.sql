-- Rollback for 2026-10-09b_client_privacy.sql (run by hand, only with Dara's yes).
-- Keeps the marker columns (harmless; they hold the brokerage's/team's record).
begin;
set local lock_timeout = '5s';
drop function if exists public.reclaim_team_leads(uuid, uuid);
drop function if exists public.reclaim_company_leads(uuid);
drop function if exists public.team_lead_dashboard(uuid);
drop function if exists public.assign_team_lead(uuid, uuid);
drop function if exists public.link_lead_contact(uuid, uuid);
drop policy if exists la_team_leader_read on public.lead_assignments;
drop policy if exists bl_team_leader_read on public.brokerage_leads;
do $d$
declare t text;
begin
  foreach t in array array['contact_notes','contact_interactions','commitments','quo_calls','tasks','lead_concierge','recordings'] loop
    execute format('drop policy if exists company_lead_staff_read on public.%I', t);
    execute format('drop policy if exists team_lead_leader_read on public.%I', t);
  end loop;
end $d$;
drop policy if exists contacts_team_lead_leader_read on public.contacts;
drop policy if exists contacts_company_lead_staff_read on public.contacts;
drop policy if exists contacts_provided_lead_keep on public.contacts;
drop trigger if exists contacts_lead_marker_guard_trg on public.contacts;
drop function if exists public.contacts_lead_marker_guard();
-- To remove the columns too (loses the markers):
-- alter table public.brokerage_leads drop column if exists team_id, drop column if exists contact_id;
-- alter table public.contacts drop column if exists team_lead_at, drop column if exists team_lead_team_id,
--   drop column if exists company_lead_at, drop column if exists brokerage_lead_id, drop column if exists company_lead;
commit;
