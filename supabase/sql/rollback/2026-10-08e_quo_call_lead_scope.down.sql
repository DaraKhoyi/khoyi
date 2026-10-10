-- Rollback: restores link_quo_call_to_lead v1 (cross-account lead matching, 'no-answer' counted as connected).
-- Only the function; the Oct 8 data fixes are NOT reverted here (see /workspace/fixes/quo-backfill/rollback_quo_lead_fixes.sql).
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.link_quo_call_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ext text; extnorm text; lid uuid; laid uuid; ag uuid; oc text; dir text; conn boolean;
  cur_stage text; ccount int; tcount int; fcontact timestamptz; occ timestamptz;
begin
  ext := case when NEW.direction ilike 'in%' then NEW.from_number else NEW.to_number end;
  if ext is null or ext='' then ext := NEW.participant; end if;
  extnorm := right(regexp_replace(coalesce(ext,''),'[^0-9]','','g'),10);
  if extnorm is null or length(extnorm)<7 then return NEW; end if;

  select id, assigned_agent_id, stage, call_count, touch_count, first_contact_at
    into lid, ag, cur_stage, ccount, tcount, fcontact
  from public.leads where phone_norm = extnorm and phone_norm <> ''
  order by (assigned_agent_id is not null) desc, created_at desc limit 1;

  -- INTAKE: inbound call from an unknown number (no lead, no contact) -> auto-create an unassigned lead
  if lid is null then
    if NEW.direction ilike 'in%' and not exists(
         select 1 from contacts c where right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10) = extnorm and extnorm<>'') then
      insert into public.leads(user_id, name, phone, source, stage, lead_type, temperature, first_contact_at, last_activity_at)
      values (NEW.user_id, coalesce(nullif(NEW.participant,''), ext, 'Inbound caller'), ext, 'Quo inbound', 'new', 'buyer', 'warm', coalesce(NEW.op_created_at,now()), coalesce(NEW.op_created_at,now()))
      returning id into lid;
      ag := null; cur_stage := 'new'; ccount := 0; tcount := 0; fcontact := null;
    else
      return NEW;
    end if;
  end if;

  dir := case when NEW.direction ilike 'in%' then 'inbound' else 'outbound' end;
  conn := (coalesce(NEW.duration,0) > 0) or NEW.status ilike '%complet%' or NEW.status ilike '%answer%';
  oc := case when conn then 'connected'
            when NEW.status ilike '%voicemail%' then 'left_vm'
            when NEW.status ilike '%miss%' or NEW.status ilike '%no%' then 'no_answer' else null end;
  occ := coalesce(NEW.op_created_at, NEW.created_at, now());

  select id into laid from public.lead_activities where quo_call_id = NEW.id limit 1;
  if laid is not null then
    update public.lead_activities set direction=dir, outcome=oc, duration_seconds=NEW.duration, occurred_at=occ where id=laid;
    return NEW;
  end if;

  insert into public.lead_activities(user_id, lead_id, agent_id, actor_role, type, direction, outcome, duration_seconds, notes, quo_call_id, occurred_at)
  values (NEW.user_id, lid, ag, 'agent', 'call', dir, oc, NEW.duration, 'OpenPhone call', NEW.id, occ);

  update public.leads set
    call_count = coalesce(ccount,0)+1,
    touch_count = coalesce(tcount,0)+1,
    last_activity_at = greatest(coalesce(last_activity_at,'epoch'::timestamptz), occ),
    first_contact_at = coalesce(fcontact, case when conn then occ else null end),
    stage = case when conn and stage in ('new','assigned','attempting') then 'contacted' else stage end
  where id = lid;
  return NEW;
end; $function$;
-- After Dara is happy: drop table public._lead_fix2_20261008, public._lead_activity_fix2_20261008;
