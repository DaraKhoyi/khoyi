-- =====================================================================
-- Client data privacy (Dara, 9 Oct 2026; approved to ship 11:55 AM ET)
--   "Make Client data private to each agent, except for Company Leads that we
--    provide to those Agents. Their Clients are theirs ... If an agent leaves,
--    we will not export the records of those Clients for the Agent. We need to
--    be able to track speed to lead, effectiveness of the Agent's support."
--   Revision 11:55 AM: there is NO company phone line today (Dara's Quo line is
--   his own), so nothing existing is classified. Add a team tier: a team
--   leader has over the team's leads what the broker has over Company Leads.
--
-- Rules enforced in the database:
--   R1. An agent's own clients: only the agent (and whoever the agent CHOSE to
--       share with) can read them. Broker and team leader see counts, never content.
--   R2. Company Lead (contacts.company_lead): owner/broker_admin read it and its
--       follow-up (read-only). The agent works it but cannot un-mark or delete it.
--   R3. Team Lead (contacts.team_lead_team_id): the leaders of THAT team read it
--       and its follow-up (read-only). The agent cannot un-mark or delete it.
--   R4. Leads table: brokerage_leads.team_id marks a lead the team provides. Its
--       leaders see it and its assignments (speed to lead), can hand it to a
--       member of their team (assign_team_lead) and get a team dashboard.
--   R5. When an agent leaves: reclaim_company_leads (broker) and
--       reclaim_team_leads (team leader) bring those records back. The agent's
--       OWN clients are never touched.
--   Nothing is marked by this file. Markers are set only by the system (intake,
--   service role) or by link_lead_contact(), which requires the contact to
--   belong to the agent the lead was assigned to AND to match the lead's email
--   or phone, so a private client can never be pulled into view by tagging.
--
-- ROLLBACK: rollback/2026-10-09b_client_privacy.down.sql (by hand only)
-- =====================================================================
begin;
-- Every lock up front, one order, give up fast (dry run once deadlocked with
-- live Quo traffic without this).
set local lock_timeout = '5s';
lock table public.quo_calls, public.contacts, public.contact_notes, public.contact_interactions, public.commitments, public.tasks, public.lead_concierge, public.recordings, public.brokerage_leads, public.lead_assignments in access exclusive mode;

-- A. Markers ---------------------------------------------------------------
alter table public.contacts add column if not exists company_lead boolean not null default false;
alter table public.contacts add column if not exists brokerage_lead_id uuid references public.brokerage_leads(id) on delete set null;
alter table public.contacts add column if not exists company_lead_at timestamptz;
alter table public.contacts add column if not exists team_lead_team_id uuid references public.teams(id) on delete set null;
alter table public.contacts add column if not exists team_lead_at timestamptz;
create index if not exists contacts_company_lead_idx on public.contacts (user_id) where company_lead;
create index if not exists contacts_team_lead_idx on public.contacts (team_lead_team_id) where team_lead_team_id is not null;
alter table public.brokerage_leads add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.brokerage_leads add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists brokerage_leads_team_idx on public.brokerage_leads (team_id) where team_id is not null;
comment on column public.contacts.company_lead is
  'Brokerage-provided client. Owner/broker_admin can read it; the agent cannot un-mark or delete it. 2026-10-09.';
comment on column public.contacts.team_lead_team_id is
  'Team-provided client: the leaders of this team can read it; the agent cannot un-mark or delete it. 2026-10-09.';
comment on column public.brokerage_leads.team_id is
  'Set when a team (not the brokerage) provides this lead. Its leaders see and route it. 2026-10-09.';

-- B. Only the system changes a marker -------------------------------------
--    SECURITY INVOKER on purpose: current_user is 'authenticated' for anything
--    a browser does, and the function owner inside checked definer functions
--    (link_lead_contact) or service_role for intake. Browsers never pass.
create or replace function public.contacts_lead_marker_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return NEW; end if;
  if TG_OP = 'INSERT' then
    NEW.company_lead := false; NEW.brokerage_lead_id := null; NEW.company_lead_at := null;
    NEW.team_lead_team_id := null; NEW.team_lead_at := null;
  else
    NEW.company_lead := OLD.company_lead; NEW.brokerage_lead_id := OLD.brokerage_lead_id;
    NEW.company_lead_at := OLD.company_lead_at;
    NEW.team_lead_team_id := OLD.team_lead_team_id; NEW.team_lead_at := OLD.team_lead_at;
  end if;
  return NEW;
end $$;
revoke all on function public.contacts_lead_marker_guard() from public, anon, authenticated;
drop trigger if exists contacts_lead_marker_guard_trg on public.contacts;
create trigger contacts_lead_marker_guard_trg before insert or update on public.contacts
  for each row execute function public.contacts_lead_marker_guard();

-- C. The agent cannot delete a Company Lead or a Team Lead -----------------
drop policy if exists contacts_provided_lead_keep on public.contacts;
create policy contacts_provided_lead_keep on public.contacts as restrictive for delete to authenticated
  using ((not company_lead or public.is_brokerage_staff())
     and (team_lead_team_id is null or public.leads_team(team_lead_team_id) or public.is_brokerage_staff()));

-- D. Read access (SELECT only, never write) --------------------------------
--    Email-channel rows stay with the mailbox owner (Google Limited Use; 08d).
drop policy if exists contacts_company_lead_staff_read on public.contacts;
create policy contacts_company_lead_staff_read on public.contacts for select to authenticated
  using (company_lead and public.is_brokerage_staff());
drop policy if exists contacts_team_lead_leader_read on public.contacts;
create policy contacts_team_lead_leader_read on public.contacts for select to authenticated
  using (team_lead_team_id is not null and public.leads_team(team_lead_team_id));

do $d$
declare t text;
begin
  foreach t in array array['contact_notes','contact_interactions','commitments','quo_calls','tasks','lead_concierge','recordings'] loop
    execute format('drop policy if exists company_lead_staff_read on public.%I', t);
    execute format($p$create policy company_lead_staff_read on public.%I for select to authenticated
      using (contact_id is not null and public.is_brokerage_staff()
             and exists (select 1 from public.contacts c where c.id = %I.contact_id and c.company_lead))$p$, t, t);
    execute format('drop policy if exists team_lead_leader_read on public.%I', t);
    execute format($p$create policy team_lead_leader_read on public.%I for select to authenticated
      using (contact_id is not null
             and exists (select 1 from public.contacts c where c.id = %I.contact_id
                          and c.team_lead_team_id is not null and public.leads_team(c.team_lead_team_id)))$p$, t, t);
  end loop;
end $d$;

drop policy if exists bl_team_leader_read on public.brokerage_leads;
create policy bl_team_leader_read on public.brokerage_leads for select to authenticated
  using (team_id is not null and public.leads_team(team_id));
drop policy if exists la_team_leader_read on public.lead_assignments;
create policy la_team_leader_read on public.lead_assignments for select to authenticated
  using (exists (select 1 from public.brokerage_leads b where b.id = lead_assignments.lead_id
                  and b.team_id is not null and public.leads_team(b.team_id)));

-- E. Link a lead to the agent's contact (sets the marker) -------------------
create or replace function public.link_lead_contact(p_lead uuid, p_contact uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.brokerage_leads; c public.contacts; v_match boolean;
begin
  select * into b from public.brokerage_leads where id = p_lead;
  if b.id is null then return jsonb_build_object('ok', false, 'error', 'No such lead.'); end if;
  if not (public.is_brokerage_staff() or (b.team_id is not null and public.leads_team(b.team_id))) then
    return jsonb_build_object('ok', false, 'error', 'Only the broker or the team leader can do this.');
  end if;
  if b.origin <> 'company' and b.team_id is null then
    return jsonb_build_object('ok', false, 'error', 'This is the agent''s own lead. It stays theirs.');
  end if;
  select * into c from public.contacts where id = p_contact;
  if c.id is null or not exists (select 1 from public.lead_assignments la where la.lead_id = p_lead and la.agent_user = c.user_id) then
    return jsonb_build_object('ok', false, 'error', 'That contact is not with the agent this lead went to.');
  end if;
  -- NULL-safe on purpose: contacts keep their numbers in phones/emails arrays
  -- and phone/email can be null; a NULL comparison must never count as a match.
  v_match := (b.lead_email is not null and exists (
                select 1 from (select c.email v union all select x->>'value' from jsonb_array_elements(coalesce(c.emails, '[]'::jsonb)) x) e
                 where e.v is not null and lower(e.v) = lower(b.lead_email)))
          or (b.lead_phone is not null and length(regexp_replace(b.lead_phone, '\D', '', 'g')) >= 10 and exists (
                select 1 from (select c.phone v union all select x->>'value' from jsonb_array_elements(coalesce(c.phones, '[]'::jsonb)) x) p
                 where p.v is not null and length(regexp_replace(p.v, '\D', '', 'g')) >= 10
                   and right(regexp_replace(p.v, '\D', '', 'g'), 10) = right(regexp_replace(b.lead_phone, '\D', '', 'g'), 10)));
  if not coalesce(v_match, false) then
    return jsonb_build_object('ok', false, 'error', 'That contact does not match the lead''s email or phone.');
  end if;
  update public.contacts set
    brokerage_lead_id = p_lead,
    company_lead = (b.team_id is null), company_lead_at = case when b.team_id is null then coalesce(company_lead_at, now()) else company_lead_at end,
    team_lead_team_id = coalesce(b.team_id, team_lead_team_id), team_lead_at = case when b.team_id is not null then coalesce(team_lead_at, now()) else team_lead_at end
  where id = p_contact;
  update public.brokerage_leads set contact_id = p_contact where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.link_lead_contact(uuid, uuid) from public, anon;
grant execute on function public.link_lead_contact(uuid, uuid) to authenticated, service_role;

-- F. Team routing: a leader hands a team lead to a member of the team -------
--    In-app only. Sends nothing (no text, no email, no push).
create or replace function public.assign_team_lead(p_lead uuid, p_agent uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.brokerage_leads; v_hop int;
begin
  select * into b from public.brokerage_leads where id = p_lead;
  if b.id is null or b.team_id is null or not public.leads_team(b.team_id) then
    return jsonb_build_object('ok', false, 'error', 'Only this team''s leader can route this lead.');
  end if;
  if not exists (select 1 from public.team_members m where m.team_id = b.team_id and m.auth_user_id = p_agent) then
    return jsonb_build_object('ok', false, 'error', 'That person is not on this team.');
  end if;
  select coalesce(max(hop), 0) + 1 into v_hop from public.lead_assignments where lead_id = p_lead;
  update public.lead_assignments set released_at = now(), release_reason = 'reassigned by team leader'
   where lead_id = p_lead and released_at is null;
  insert into public.lead_assignments (lead_id, agent_user, hop) values (p_lead, p_agent, v_hop);
  update public.brokerage_leads set status = 'assigned', assigned_to = p_agent, assigned_at = now(), assigned_by = auth.uid() where id = p_lead;
  return jsonb_build_object('ok', true, 'hop', v_hop);
end $$;
revoke all on function public.assign_team_lead(uuid, uuid) from public, anon;
grant execute on function public.assign_team_lead(uuid, uuid) to authenticated, service_role;

-- G. Team tracking: speed to lead on the team's own leads (no content) ------
create or replace function public.team_lead_dashboard(p_team uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not public.leads_team(p_team) then '{}'::jsonb else jsonb_build_object(
    'waiting', (select count(*) from public.brokerage_leads b where b.team_id = p_team and b.status in ('unassigned','with_broker')),
    'by_agent', (select coalesce(jsonb_agg(y order by y->>'leads' desc), '[]'::jsonb) from (
       select jsonb_build_object('agent', coalesce(a.name, 'Member'), 'leads', count(*),
         'answered', count(*) filter (where la.first_response_at is not null),
         'within_5_min', count(*) filter (where la.first_response_at <= la.assigned_at + interval '5 minutes'),
         'median_minutes', round((percentile_cont(0.5) within group (
            order by extract(epoch from la.first_response_at - la.assigned_at)/60))::numeric)) y
       from public.lead_assignments la
       join public.brokerage_leads b on b.id = la.lead_id and b.team_id = p_team
       left join public.agents a on a.auth_user_id = la.agent_user
       where la.assigned_at > now() - interval '30 days'
       group by a.name) t)) end
$$;
revoke all on function public.team_lead_dashboard(uuid) from public, anon;
grant execute on function public.team_lead_dashboard(uuid) to authenticated, service_role;

-- H. When an agent leaves ----------------------------------------------------
create or replace function public.reclaim_company_leads(p_agent_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; n_c int; n_n int; n_m int; n_t int;
begin
  if not public.is_brokerage_staff() then return jsonb_build_object('ok', false, 'error', 'Only the broker can do this.'); end if;
  select a.user_id into v_owner from public.agents a where a.auth_user_id = auth.uid() limit 1;
  if v_owner is null or p_agent_user is null or p_agent_user = v_owner then return jsonb_build_object('ok', false, 'error', 'Nothing to reclaim.'); end if;
  update public.contact_notes cn set user_id = v_owner from public.contacts c where c.id = cn.contact_id and c.company_lead and c.user_id = p_agent_user and cn.user_id = p_agent_user;
  get diagnostics n_n = row_count;
  update public.commitments cm set user_id = v_owner from public.contacts c where c.id = cm.contact_id and c.company_lead and c.user_id = p_agent_user and cm.user_id = p_agent_user;
  get diagnostics n_m = row_count;
  update public.tasks t set user_id = v_owner from public.contacts c where c.id = t.contact_id and c.company_lead and c.user_id = p_agent_user and t.user_id = p_agent_user;
  get diagnostics n_t = row_count;
  update public.contacts set user_id = v_owner, team_id = null where company_lead and user_id = p_agent_user;
  get diagnostics n_c = row_count;
  return jsonb_build_object('ok', true, 'contacts', n_c, 'notes', n_n, 'promises', n_m, 'tasks', n_t);
end $$;
revoke all on function public.reclaim_company_leads(uuid) from public, anon;
grant execute on function public.reclaim_company_leads(uuid) to authenticated, service_role;

create or replace function public.reclaim_team_leads(p_agent_user uuid, p_team uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); n_c int; n_n int; n_m int; n_t int;
begin
  if p_team is null or not public.leads_team(p_team) then return jsonb_build_object('ok', false, 'error', 'Only this team''s leader can do this.'); end if;
  if p_agent_user is null or p_agent_user = v_me then return jsonb_build_object('ok', false, 'error', 'Nothing to reclaim.'); end if;
  update public.contact_notes cn set user_id = v_me from public.contacts c where c.id = cn.contact_id and c.team_lead_team_id = p_team and not c.company_lead and c.user_id = p_agent_user and cn.user_id = p_agent_user;
  get diagnostics n_n = row_count;
  update public.commitments cm set user_id = v_me from public.contacts c where c.id = cm.contact_id and c.team_lead_team_id = p_team and not c.company_lead and c.user_id = p_agent_user and cm.user_id = p_agent_user;
  get diagnostics n_m = row_count;
  update public.tasks t set user_id = v_me from public.contacts c where c.id = t.contact_id and c.team_lead_team_id = p_team and not c.company_lead and c.user_id = p_agent_user and t.user_id = p_agent_user;
  get diagnostics n_t = row_count;
  update public.contacts set user_id = v_me, team_id = null where team_lead_team_id = p_team and not company_lead and user_id = p_agent_user;
  get diagnostics n_c = row_count;
  return jsonb_build_object('ok', true, 'contacts', n_c, 'notes', n_n, 'promises', n_m, 'tasks', n_t);
end $$;
revoke all on function public.reclaim_team_leads(uuid, uuid) from public, anon;
grant execute on function public.reclaim_team_leads(uuid, uuid) to authenticated, service_role;

commit;
