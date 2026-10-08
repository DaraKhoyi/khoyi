-- Rollback for 2026-10-08c (run by hand in the SQL editor, only with Dara's yes).
-- Removes the act-as Google-data block. Leaves impersonation_log.session_id
-- (harmless) so the audit trail keeps which session each support visit used.
begin;
do $p$
declare t text;
begin
  foreach t in array array['email_messages_all','email_threads','email_attachments','email_triage',
    'email_review_items','email_known_senders','email_sender_stats','email_intel_runs','email_bounces',
    'gmail_labels','email_aliases','scheduled_emails','email_tracking','calendar_sync_state',
    'google_contacts','google_contacts_sync','events','contact_interactions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists act_as_hides_google on public.%I', t);
    end if;
  end loop;
end $p$;
do $g$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('contact_thread_emails','uncarded_correspondents',
              'lead_concierge_pending','import_google_contact','link_google_contact') loop
    d := pg_get_functiondef(r.oid);
    if position('is_support_session' in d) = 0 then continue; end if;
    d := regexp_replace(d, E'\\n  if public\\.is_support_session\\(\\) then return [^\\n]*; end if;', '', 'g');
    execute d;
  end loop;
end $g$;
-- Functions are left in place (unused once the policies are gone):
--   public.is_support_session(), public.revoke_support_session(uuid)
commit;
