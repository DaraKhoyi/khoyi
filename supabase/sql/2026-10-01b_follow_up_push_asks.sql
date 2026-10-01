-- 2026-10-01 — THE FOLLOW-UP PUSH ASKS; IT DOES NOT WARN.
--
-- Ray (panel), 1 Oct: anything that reads as "you failed" — a count of
-- set-aside follow-ups, "expired", "last chance" — and he closes the app.
-- This morning's push said "PrismOS sets them aside tomorrow unless you keep
-- them": true, but a deadline read as a threat. Now it is an offer:
--   "From your calls — Send Maria the comps (Maria) and 1 more — still worth
--    doing? Tap to keep or skip."
-- Same timing, same once-only stamp, same quiet hours; only the words change.
-- (The screens change in the same commit: "Pick up where you left off", no
-- number shown anywhere.)

create or replace function public.warn_commitments_before_set_aside()
returns integer
language plpgsql security definer set search_path = public, vault as $$
declare
  v_key text; v_hour int; r record; n int := 0;
begin
  v_hour := extract(hour from (now() at time zone 'America/New_York'))::int;
  if v_hour < 9 or v_hour >= 19 then return 0; end if;   -- nobody's phone buzzes at night
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return 0; end if;

  for r in
    with due as (
      select c.id, c.user_id, c.title, c.created_at, ct.name contact_name,
             public.commitment_set_aside_at(c) aside_at
        from commitments c left join contacts ct on ct.id = c.contact_id
       where c.status = 'proposed' and c.auto_expired_at is null and c.expiry_warned_at is null
         and coalesce(c.fuse, 'near') <> 'immediate'
         and c.user_id is not null
    )
    select user_id, array_agg(id) ids, count(*) n,
           (array_agg(title order by aside_at, created_at))[1] first_title,
           (array_agg(contact_name order by aside_at, created_at))[1] first_who
      from due
     where aside_at > now() and aside_at <= now() + interval '24 hours'
     group by user_id
  loop
    perform net.http_post(
      url := 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', 'From your calls',
        'body', left(coalesce(nullif(r.first_title, ''), 'A follow-up from your calls'), 90)
                || case when r.first_who is not null then ' (' || r.first_who || ')' else '' end
                || case when r.n > 1 then ' and ' || (r.n - 1) || ' more' else '' end
                || ' — still worth doing? Tap to keep or skip.',
        'url', 'https://darasapp.com/',
        'tag', 'commitments-expiring'));
    update commitments set expiry_warned_at = now() where id = any(r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.warn_commitments_before_set_aside() from public, anon, authenticated;
