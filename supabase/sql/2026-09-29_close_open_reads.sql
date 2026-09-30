-- 2026-09-29 — NOTHING IS READABLE BY A STRANGER, AND SYSTEM WIRING IS STAFF-ONLY.
--
-- The Sentinel (panel): "app_config and agent_aliases are SELECT-open to all
-- authenticated users — worth tightening before the beta expands to 96 agents."
-- Dara: "Fix what needs to be fixed."
--
-- It was wider than that. Their read rules said `true` for EVERY role, and the
-- anonymous role (the public key that ships inside the web app) had SELECT, so
-- anyone on the internet could read them — not just signed-in agents. A sweep of
-- every table and view as a stranger then found more:
--
--   * lead_queue_v and overdue_waiting_on were views WITHOUT security_invoker, so
--     they ran as their owner and skipped row-level security entirely: any
--     stranger could read every agent's pending leads (name, email, phone, the
--     words they wrote) and every late promise (title, quote, contact name).
--     Nothing in the app reads either view. Now they run as the person asking.
--   * Brokerage-wide knowledge (documents, facts, passages), brokerage
--     announcements, and the shared reference lists (tags, contact types, mileage
--     rates, milestone definitions, lessons, lead-gen templates) were readable
--     without signing in. They are for agents: signed-in only now.
--   * app_config: an agent may read only the settings the app itself needs
--     (today just licensing_enforced); everything else is owner/broker-admin.
--   * agent_aliases (who is who under other spellings): staff only. The only
--     reader is brokerage-import, which uses the server key.
--
-- idx_listings stays public on purpose: IDX listings marked for display are
-- published listings. smoke/anon_exposure.mjs now sweeps TABLES as well as
-- functions, and smoke/open_reads.mjs proves the staff-only rules.

-- 1. The two views obey row-level security, and a stranger cannot touch them.
alter view public.lead_queue_v set (security_invoker = true);
alter view public.overdue_waiting_on set (security_invoker = true);
revoke all on public.lead_queue_v, public.overdue_waiting_on from anon;

-- 2. app_config: only the browser-safe keys for agents; the rest for owner / broker admin.
revoke all on public.app_config from anon;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated
  using (key in ('licensing_enforced') or public.app_role() in ('owner', 'broker_admin'));
alter policy app_config_write on public.app_config to authenticated;

-- 3. agent_aliases: staff only.
revoke all on public.agent_aliases from anon;
drop policy if exists al_read on public.agent_aliases;
create policy al_read on public.agent_aliases for select to authenticated using (public.is_brokerage_staff());
alter policy al_write on public.agent_aliases to authenticated;

-- 4. Agent-facing content: signed-in only (the rules themselves are unchanged).
alter policy kc_read on public.knowledge_chunks to authenticated;
alter policy kf_read on public.knowledge_facts to authenticated;
alter policy ks_read on public.knowledge_sources to authenticated;
alter policy announcements_read on public.announcements to authenticated;
alter policy tags_read on public.tags to authenticated;
alter policy ct_select on public.contact_types to authenticated;
alter policy mileage_rates_read on public.mileage_rates to authenticated;
alter policy tmd_read on public.txn_milestone_defs to authenticated;
alter policy teaching_lessons_read on public.teaching_lessons to authenticated;
alter policy teaching_triggers_read on public.teaching_triggers to authenticated;
