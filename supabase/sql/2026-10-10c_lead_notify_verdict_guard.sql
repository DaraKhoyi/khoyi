-- =====================================================================
-- Lead notification verdicts: only the owner, or staff on a Company Lead
-- (10 Oct 2026)
--
-- Judging a lead alert is limited the same way the ln_verdict policy already
-- limits an update. A signed-out caller is refused. A row with no owner does
-- not slip past the check. Staff (owner / broker_admin) may judge a row only
-- when its contact is a Company Lead. The reply includes the sender address
-- only when the caller owns the row.
--
-- The rule is still stored for the owner of the alert, so a staff decision on
-- a Company Lead still teaches that agent's filter.
--
-- Rollback: supabase/sql/rollback/2026-10-10c_lead_notify_verdict_guard.down.sql
--           (by hand only)
-- =====================================================================
begin;
set local lock_timeout = '5s';

create or replace function public.lead_notify_verdict(p_id uuid, p_verdict text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_kind text;
  v_n int := 0;
  v_s text;
  v_owns boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if p_verdict not in ('true_lead', 'not_lead') then
    return jsonb_build_object('ok', false, 'error', 'bad verdict');
  end if;

  select * into r from public.lead_notifications where id = p_id;
  if r is null then
    return jsonb_build_object('ok', false, 'error', 'no such row');
  end if;

  v_owns := r.user_id is not distinct from auth.uid();
  if r.user_id is distinct from auth.uid()
     and not (
       public.is_brokerage_staff()
       and exists (
         select 1 from public.contacts c
          where c.id = r.contact_id and c.company_lead
       )
     ) then
    return jsonb_build_object('ok', false, 'error', 'not yours');
  end if;

  update public.lead_notifications
     set verdict = p_verdict, verdict_at = now(), verdict_by = auth.uid()
   where id = p_id;

  v_s := lower(btrim(coalesce(r.lead_email, '')));
  if v_s <> '' and position('@' in v_s) > 0 then
    v_kind := case when p_verdict = 'true_lead' then 'lead_ok' else 'not_a_lead' end;
    delete from public.lead_sender_rules
     where user_id = r.user_id and lower(sender) = v_s
       and kind = case when p_verdict = 'true_lead' then 'not_a_lead' else 'lead_ok' end;
    insert into public.lead_sender_rules (user_id, sender, kind, note)
      values (r.user_id, v_s, v_kind, 'lead-notification review')
      on conflict (user_id, lower(sender), kind) do update set note = excluded.note;
    if p_verdict = 'not_lead' and r.user_id is not null then
      update public.lead_concierge set status = 'dismissed'
       where user_id = r.user_id and status = 'pending' and lower(lead_email) = v_s;
      get diagnostics v_n = row_count;
    end if;
  end if;

  if v_owns then
    return jsonb_build_object('ok', true, 'verdict', p_verdict, 'sender', r.lead_email, 'cleared', v_n);
  end if;
  return jsonb_build_object('ok', true, 'verdict', p_verdict, 'cleared', v_n);
end $$;

revoke all on function public.lead_notify_verdict(uuid, text) from public, anon;
grant execute on function public.lead_notify_verdict(uuid, text) to authenticated;

commit;
