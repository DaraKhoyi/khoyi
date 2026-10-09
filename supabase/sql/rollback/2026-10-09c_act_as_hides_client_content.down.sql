-- Rollback for 2026-10-09c (run by hand, only with Dara's yes).
begin;
set local lock_timeout = '5s';
do $d$
declare t text;
begin
  foreach t in array array['contacts','contact_notes','contact_interactions','commitments','quo_calls','tasks','lead_concierge','recordings','quo_messages','journal_entries','deals'] loop
    execute format('drop policy if exists act_as_hides_clients on public.%I', t);
  end loop;
end $d$;
commit;
