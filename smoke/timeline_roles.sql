-- Rollback-only role check for the CRM Phase 1 timeline (used by timeline_access.mjs).
-- Writes one throwaway support-session row and one attempted Save; the RAISE at the
-- end aborts the transaction, so nothing persists. Reports ids-free counts only.
do $t$
declare o uuid; a uuid; oc uuid; s uuid := gen_random_uuid(); n_o int; n_a int; n_x int; sv text := 'allowed'; an boolean;
begin
  select c.user_id, c.id into o, oc from contacts c join quo_calls q on q.contact_id = c.id
   where not c.company_lead and c.team_lead_team_id is null and coalesce(c.shared_scope, 'none') = 'none'
   group by 1, 2 order by count(*) desc limit 1;
  select u.id into a from auth.users u where u.id <> o and exists (select 1 from contacts where user_id = u.id) limit 1;
  insert into impersonation_log(actor_user_id, target_user_id, actor_role, session_id, expires_at) values (a, o, 'owner', s, now() + interval '1 hour');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select count(*) into n_o from contact_timeline(oc);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n_a from contact_timeline(oc);
  begin perform save_voice_note(oc, 'role check'); exception when others then sv := 'blocked'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'session_id', s)::text, true);
  select count(*) into n_x from contact_timeline(oc);
  perform set_config('role', 'postgres', true);
  an := has_function_privilege('anon', 'public.contact_timeline(uuid,timestamptz,int,text[])', 'execute');
  raise exception 'ROLES {"owner":%,"other_agent":%,"other_save":"%","act_as":%,"anon":%}', n_o, n_a, sv, n_x, case when an then 'true' else 'false' end;
end $t$;
