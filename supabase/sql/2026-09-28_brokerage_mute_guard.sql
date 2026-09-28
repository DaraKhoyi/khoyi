-- 2026-09-28 — A SENDER MUTED FOR THE WHOLE BROKERAGE MUST EARN IT, EVERY DAY.
--
-- Panel (Skeptic + Sentinel), 28 Sep: "27 brokerage-wide suppression rules
-- created without the required two-producer gate — any auto-learn event can
-- silence a lead source for all 96 agents."
--
-- What was actually true when checked:
--   * The 27 rows are 12 senders, each muted by 2–3 PRODUCING agents (David
--     Jordan, Grace Botsford, Ola Alhuneidi) — the gate was met. The panel's
--     "from_producers: 0" counted a learned_from column added after these rows
--     were written. Every one is a newsletter or vendor (NAR, Florida Realtors,
--     Stellar MLS digests, Nextdoor, ROG corporate news). No lead was lost.
--   * The mute is by EXACT address, so it cannot silence a whole portal domain.
-- What was really wrong, and is fixed here:
--   1. ANY signed-in agent could write is_brokerage = true on their own row
--      straight through the API (the row policy checks only user_id). One
--      account — or one bug — could mute a sender for everyone. Now the browser
--      cannot write that column at all, and a trigger refuses it from anywhere
--      unless the sender meets the gate below.
--   2. The gate's portal list was hand-typed and missed the Realty ONE Group
--      site, ShowingTime, Homesnap, CINC and others that lead_sources knows.
--      Two brokerage-wide mutes (ROG corporate newsletters) sit on the ROG
--      lead domain. The gate now refuses ANY sender matching an active lead
--      source; agents can still mute those for themselves.
--   3. "Producing" defaulted to TRUE for anyone without an agents row. The gate
--      now needs a real agents row with production_role = 'producing'.
--   4. Promotion was one-way and silent. It now re-checks every brokerage-wide
--      mute daily, un-mutes any that no longer qualify, and logs every change
--      (brokerage_mute_log) for the broker and the panel to see.

-- 1. The single definition of "may this sender be muted for everyone?"
create or replace function public.brokerage_mute_allowed(p_sender text)
returns boolean
language sql stable security definer set search_path = public as $$
  with s as (select lower(btrim(coalesce(p_sender, ''))) v)
  select (select v from s) like '%@%'
    -- never an address a lead source sends from
    and not exists (select 1 from lead_sources ls, s where ls.active and s.v ~ ls.sender_re)
    and (select v from s) !~* '(zillow|realtor\.com|homes\.com|rent\.com|redfin|xomio|kvcore|boomtown|followupboss|opcity|myrealtyonegroup|realtyonegroup|showingtime|homesnap|cinc|sierra|ylopo|realgeeks|lofty|chime|brivity|trulia|apartments\.com|zumper|hotpads)'
    -- nobody has ever vouched for it
    and not exists (select 1 from lead_sender_rules r, s where lower(btrim(r.sender)) = s.v and r.kind = 'lead_ok')
    -- at least two different PRODUCING agents muted it themselves, and the mute is live
    and (select count(distinct r.user_id) from lead_sender_rules r
          join agents a on a.auth_user_id = r.user_id and a.production_role = 'producing', s
         where lower(btrim(r.sender)) = s.v and r.kind in ('not_a_lead', 'blocked', 'unsubscribed')
           and (r.expires_at is null or r.expires_at > now())) >= 2
$$;
revoke all on function public.brokerage_mute_allowed(text) from public, anon, authenticated;
grant execute on function public.brokerage_mute_allowed(text) to service_role;

-- 2. The browser may not write the brokerage flag (or claim how a rule was learned).
revoke all on public.lead_sender_rules from anon;
revoke insert, update on public.lead_sender_rules from authenticated;
grant insert (user_id, sender, kind, note, expires_at) on public.lead_sender_rules to authenticated;
grant update (sender, kind, note, expires_at) on public.lead_sender_rules to authenticated;

-- 3. And nothing else may either, unless the sender meets the gate.
create or replace function public.lead_sender_rules_brokerage_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_brokerage and (tg_op = 'INSERT' or not old.is_brokerage or new.sender is distinct from old.sender) then
    if new.kind not in ('not_a_lead', 'blocked', 'unsubscribed') then
      raise exception 'only a mute can be brokerage-wide (got %)', new.kind;
    end if;
    if not public.brokerage_mute_allowed(new.sender) then
      raise exception 'brokerage-wide mute refused for %: it needs two producing agents, no lead source, and no one vouching for it', new.sender;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lead_sender_rules_brokerage_guard_trg on public.lead_sender_rules;
create trigger lead_sender_rules_brokerage_guard_trg
  before insert or update of is_brokerage, sender, kind on public.lead_sender_rules
  for each row execute function public.lead_sender_rules_brokerage_guard();

-- 4. Every change to a brokerage-wide mute, recorded.
create table if not exists public.brokerage_mute_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  sender text not null,
  action text not null check (action in ('muted', 'unmuted')),
  reason text,
  producers integer
);
alter table public.brokerage_mute_log enable row level security;
drop policy if exists bml_staff_read on public.brokerage_mute_log;
create policy bml_staff_read on public.brokerage_mute_log for select using (public.is_brokerage_staff());
revoke all on public.brokerage_mute_log from anon;
grant select on public.brokerage_mute_log to authenticated;

create or replace function public.promote_shared_sender_rules(p_min_agents integer default 2, p_dry boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_muted int := 0; v_unmuted int := 0; r record;
begin
  -- p_min_agents is kept for the cron call's signature; the gate is fixed at two
  -- producing agents in brokerage_mute_allowed(), the one definition.
  -- A. Un-mute anything brokerage-wide that no longer qualifies.
  for r in select lower(btrim(sender)) s from lead_sender_rules where is_brokerage group by 1 loop
    if not public.brokerage_mute_allowed(r.s) then
      if not p_dry then
        update lead_sender_rules set is_brokerage = false where is_brokerage and lower(btrim(sender)) = r.s;
        insert into brokerage_mute_log (sender, action, reason) values (r.s, 'unmuted',
          case when exists (select 1 from lead_sources ls where ls.active and r.s ~ ls.sender_re) then 'address belongs to a lead source'
               when exists (select 1 from lead_sender_rules x where lower(btrim(x.sender)) = r.s and x.kind = 'lead_ok') then 'someone marked it a real lead'
               else 'fewer than two producing agents still mute it' end);
      end if;
      v_unmuted := v_unmuted + 1;
    end if;
  end loop;
  -- B. Mute for everyone what two producing agents already mute.
  for r in select lower(btrim(x.sender)) s,
                  exists (select 1 from lead_sender_rules y where y.is_brokerage and lower(btrim(y.sender)) = lower(btrim(x.sender))) already
           from lead_sender_rules x
           where x.kind in ('not_a_lead', 'blocked', 'unsubscribed') and not x.is_brokerage group by 1, 2 loop
    if public.brokerage_mute_allowed(r.s) then
      if not p_dry then
        update lead_sender_rules x set is_brokerage = true
          from agents a
         where lower(btrim(x.sender)) = r.s and not x.is_brokerage and x.kind in ('not_a_lead', 'blocked', 'unsubscribed')
           and a.auth_user_id = x.user_id and a.production_role = 'producing';
        -- Log only a NEW brokerage-wide sender, not another agent's row joining one.
        insert into brokerage_mute_log (sender, action, reason, producers)
          select r.s, 'muted', 'two or more producing agents mute it',
                 (select count(distinct x.user_id) from lead_sender_rules x join agents a on a.auth_user_id = x.user_id and a.production_role = 'producing'
                   where lower(btrim(x.sender)) = r.s and x.kind in ('not_a_lead', 'blocked', 'unsubscribed'))
          where not r.already;
      end if;
      if not r.already then v_muted := v_muted + 1; end if;
    end if;
  end loop;
  select jsonb_build_object('dry_run', p_dry, 'senders_muted', v_muted, 'senders_unmuted', v_unmuted) into v;
  return v;
end $$;
revoke all on function public.promote_shared_sender_rules(integer, boolean) from public, anon, authenticated;
grant execute on function public.promote_shared_sender_rules(integer, boolean) to service_role;

-- What the broker and the panel read: every brokerage-wide mute, who backs it,
-- and whether it still meets the gate (it always should — the trigger enforces it).
create or replace function public.brokerage_mutes()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.is_brokerage_staff() or auth.role() = 'service_role') then jsonb_build_object('error', 'staff only') else
  jsonb_build_object(
    'senders', (select coalesce(jsonb_agg(x order by x->>'sender'), '[]') from (
      select jsonb_build_object('sender', r.s,
        'producing_agents', count(distinct r.user_id) filter (where a.production_role = 'producing'),
        'meets_gate', public.brokerage_mute_allowed(r.s),
        'matches_lead_source', exists (select 1 from lead_sources ls where ls.active and r.s ~ ls.sender_re)) x
      from (select lower(btrim(sender)) s, user_id from lead_sender_rules where is_brokerage) r
      left join agents a on a.auth_user_id = r.user_id
      group by r.s) s),
    'recent_changes', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'sender', sender, 'action', action, 'reason', reason) order by at desc), '[]')
                       from (select * from brokerage_mute_log order by at desc limit 20) l)) end
$$;
revoke all on function public.brokerage_mutes() from public, anon;
grant execute on function public.brokerage_mutes() to authenticated, service_role;

delete from public.brokerage_mute_log where action = 'muted' and at::date = '2026-09-28'
  and sender in (select lower(btrim(sender)) from public.lead_sender_rules where is_brokerage and created_at < '2026-09-28');

-- Apply the gate to what exists now (the two ROG newsletter addresses lose
-- brokerage-wide status; each agent's own mute stays).
select public.promote_shared_sender_rules(2, false);
