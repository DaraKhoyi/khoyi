-- =====================================================================
-- link_quo_call_to_lead v2: Quo calls only touch the call owner's leads (8 Oct 2026)
--
-- ALREADY LIVE. Applied by hand on Oct 8 2026 (Quo backfill fix, Dara approved
-- "Fix the quo backfill" at 4:35 PM ET) and never committed; this file makes the
-- repo match production. Verified Oct 9 2026 9:45 PM ET: pg_get_functiondef on
-- live is byte-identical to the body below.
--
-- Re-running is harmless: CREATE OR REPLACE with the same body keeps the
-- trigger (trg_quo_call_lead), the owner and every grant exactly as they are.
-- No data is touched.
--
-- Changes vs v1:
--  1. Lead lookup and the "known contact" intake check are scoped to the call's
--     owner (NEW.user_id); a call never attaches to, or is blocked by, another
--     account's lead/contact.
--  2. no-answer / missed / voicemail / busy / failed / canceled / abandoned never
--     count as connected (v1 matched 'no-answer' with ilike '%answer%').
-- Rollback (puts v1 back; not recommended): rollback/2026-10-08e_quo_call_lead_scope.down.sql
-- =====================================================================
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.link_quo_call_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ext text; extnorm text; lid uuid; laid uuid; ag uuid; oc text; dir text; conn boolean; missed boolean;
  cur_stage text; ccount int; tcount int; fcontact timestamptz; occ timestamptz;
begin
  ext := case when NEW.direction ilike 'in%' then NEW.from_number else NEW.to_number end;
  if ext is null or ext='' then ext := NEW.participant; end if;
  extnorm := right(regexp_replace(coalesce(ext,''),'[^0-9]','','g'),10);
  if extnorm is null or length(extnorm)<7 then return NEW; end if;

  -- only the call owner's own leads
  select id, assigned_agent_id, stage, call_count, touch_count, first_contact_at
    into lid, ag, cur_stage, ccount, tcount, fcontact
  from public.leads where user_id = NEW.user_id and phone_norm = extnorm and phone_norm <> ''
  order by (assigned_agent_id is not null) desc, created_at desc limit 1;

  -- INTAKE: inbound call from a number the owner has no lead or contact for -> auto-create an unassigned lead
  if lid is null then
    if NEW.direction ilike 'in%' and not exists(
         select 1 from contacts c where c.user_id = NEW.user_id
           and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10) = extnorm and extnorm<>'') then
      insert into public.leads(user_id, name, phone, source, stage, lead_type, temperature, first_contact_at, last_activity_at)
      values (NEW.user_id, coalesce(nullif(NEW.participant,''), ext, 'Inbound caller'), ext, 'Quo inbound', 'new', 'buyer', 'warm', coalesce(NEW.op_created_at,now()), coalesce(NEW.op_created_at,now()))
      returning id into lid;
      ag := null; cur_stage := 'new'; ccount := 0; tcount := 0; fcontact := null;
    else
      return NEW;
    end if;
  end if;

  dir := case when NEW.direction ilike 'in%' then 'inbound' else 'outbound' end;
  missed := coalesce(NEW.status,'') ~* '(no-?answer|miss|voicemail|busy|fail|cancel|abandon)';
  conn := not missed and (NEW.answered_at is not null or coalesce(NEW.duration,0) > 0 or coalesce(NEW.status,'') ~* '^answered$');
  oc := case when conn then 'connected'
            when NEW.status ~* 'voicemail' then 'left_vm'
            when NEW.status ~* '(no-?answer|miss|busy|abandon)' then 'no_answer' else null end;
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
