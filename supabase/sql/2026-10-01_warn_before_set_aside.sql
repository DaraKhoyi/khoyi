-- 2026-10-01 — A FOLLOW-UP IS NEVER SET ASIDE WITHOUT ONE CHANCE TO KEEP IT.
--
-- Panel (Marguerite + Skeptic), 1 Oct: 248 suggestions from calls were set
-- aside unreviewed. The 55% "acted on" rate is real but describes only agents
-- who opened the list; everyone else's suggestions aged out in silence. "A tool
-- that extracts a commitment and then silently archives it gives agents a false
-- sense of coverage." Their fix: a push 24 hours before it is set aside, while
-- it is still actionable.
--
-- What this does:
--   * commitment_set_aside_at(c) — the moment expire_short_fuse_commitments()
--     (29 Sep, hourly at :17) will set a suggestion aside. ONE definition of the
--     rule, so the warning, the Today card and the expiry can never disagree.
--   * warn_commitments_before_set_aside() — hourly at :47, 9am–7pm New York.
--     Anything set aside within the next 24 hours gets ONE push per agent per
--     run ("Send Maria the comps — and 2 more"), and is stamped
--     expiry_warned_at so it is never warned twice. Overnight items wait for
--     the 9am run; the latest any warning lands is ~11 hours before set-aside.
--   * Only 'near' and 'distant' fuses. 'immediate' promises ("I'll call you
--     right back") are hidden from the review screen on purpose — measured 91%
--     dismissed as already moot — so a push about something the screen will not
--     show would be a broken promise of its own. night-review now reports the
--     set-asides split by fuse so the panel sees which ones were actionable.
--   * Nothing here changes WHEN anything is set aside, and a suggestion the
--     agent brings back stays until they decide (unchanged).

alter table public.commitments add column if not exists expiry_warned_at timestamptz;

-- When the hourly rule will set this suggestion aside (null = never: already
-- decided, or brought back by hand). Mirrors expire_short_fuse_commitments():
-- old enough for its fuse AND not still dated ahead (due_date < today in NY).
create or replace function public.commitment_set_aside_at(c public.commitments)
returns timestamptz language sql stable set search_path = public as $$
  select case when c.status <> 'proposed' or c.auto_expired_at is not null then null
    else greatest(
      c.created_at + case coalesce(c.fuse, 'near')
                       when 'immediate' then interval '3 days'
                       when 'near' then interval '14 days'
                       else interval '30 days' end,
      case when c.due_date is null then '-infinity'::timestamptz
           else ((c.due_date + 1)::timestamp at time zone 'America/New_York') end)
  end
$$;
grant execute on function public.commitment_set_aside_at(public.commitments) to authenticated, service_role;

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
        'title', case when r.n = 1 then 'Keep this follow-up?' else 'Keep these ' || r.n || ' follow-ups?' end,
        'body', left(coalesce(nullif(r.first_title, ''), 'A follow-up from your calls'), 90)
                || case when r.first_who is not null then ' (' || r.first_who || ')' else '' end
                || case when r.n > 1 then ' and ' || (r.n - 1) || ' more' else '' end
                || ' — PrismOS sets ' || case when r.n = 1 then 'it' else 'them' end
                || ' aside tomorrow unless you keep ' || case when r.n = 1 then 'it' else 'them' end || '.',
        'url', 'https://darasapp.com/',
        'tag', 'commitments-expiring'));
    update commitments set expiry_warned_at = now() where id = any(r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.warn_commitments_before_set_aside() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'commitments-warn-before-set-aside';
select cron.schedule('commitments-warn-before-set-aside', '47 * * * *', $$ select public.warn_commitments_before_set_aside() $$);
