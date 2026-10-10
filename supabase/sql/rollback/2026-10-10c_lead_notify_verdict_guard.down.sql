-- Rollback for 2026-10-10c (run by hand, only with Dara's yes).
-- Restores the previous verdict function. Does not reopen it to signed-out callers.
begin;
set local lock_timeout = '5s';

create or replace function public.lead_notify_verdict(p_id uuid, p_verdict text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; v_kind text; v_n int := 0; v_s text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if p_verdict not in ('true_lead','not_lead') then
    return jsonb_build_object('ok', false, 'error', 'bad verdict');
  end if;

  select * into r from lead_notifications where id = p_id;
  if r is null then return jsonb_build_object('ok', false, 'error', 'no such row'); end if;
  if r.user_id <> auth.uid() and not public.is_brokerage_staff() then
    return jsonb_build_object('ok', false, 'error', 'not yours');
  end if;

  update lead_notifications
     set verdict = p_verdict, verdict_at = now(), verdict_by = auth.uid()
   where id = p_id;

  v_s := lower(btrim(coalesce(r.lead_email,'')));
  if v_s <> '' and position('@' in v_s) > 0 then
    v_kind := case when p_verdict = 'true_lead' then 'lead_ok' else 'not_a_lead' end;
    delete from lead_sender_rules
     where user_id = r.user_id and lower(sender) = v_s
       and kind = case when p_verdict = 'true_lead' then 'not_a_lead' else 'lead_ok' end;
    insert into lead_sender_rules (user_id, sender, kind, note)
      values (r.user_id, v_s, v_kind, 'lead-notification review')
      on conflict (user_id, lower(sender), kind) do update set note = excluded.note;
    if p_verdict = 'not_lead' then
      update lead_concierge set status = 'dismissed'
       where user_id = r.user_id and status = 'pending' and lower(lead_email) = v_s;
      get diagnostics v_n = row_count;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'verdict', p_verdict, 'sender', r.lead_email, 'cleared', v_n);
end $$;

revoke all on function public.lead_notify_verdict(uuid, text) from public, anon;
grant execute on function public.lead_notify_verdict(uuid, text) to authenticated;

delete from public._applied_sql where file = '2026-10-10c_lead_notify_verdict_guard.sql';
commit;
