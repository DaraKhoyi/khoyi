-- Who may judge a lead alert.
-- Runs after 2026-10-10c. The whole check rolls back.

begin;

create or replace function pg_temp.ok(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FAIL: %', msg;
  end if;
end $$;

insert into public.contacts (id, company_lead) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', true);

insert into public.lead_notifications (id, user_id, contact_id, lead_email) values
  ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner-private@example.com'),
  ('22222222-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'company-lead@example.com'),
  ('33333333-dddd-dddd-dddd-dddddddddddd', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'nobody@example.com');

insert into public.lead_concierge (user_id, lead_email, status)
values ('11111111-1111-1111-1111-111111111111', 'company-lead@example.com', 'pending');

-- Signed-out callers cannot execute it, and a session with no user is refused.
select pg_temp.ok(
  not has_function_privilege('anon', 'public.lead_notify_verdict(uuid, text)', 'execute')
  and not has_function_privilege('public', 'public.lead_notify_verdict(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.lead_notify_verdict(uuid, text)', 'execute'),
  'signed-out role can still execute the verdict');

set local role anon;
do $$
begin
  perform public.lead_notify_verdict('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not_lead');
  raise exception 'FAIL: signed-out role ran the verdict';
exception when insufficient_privilege then
  null;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select pg_temp.ok(
  (public.lead_notify_verdict('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not_lead') ->> 'ok') = 'false',
  'a session with no user was accepted');
select pg_temp.ok(
  (select verdict is null from public.lead_notifications where id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'a signed-out call changed the row');

-- Another agent is refused.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select pg_temp.ok(
  (public.lead_notify_verdict('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not_lead') ->> 'error') = 'not yours',
  'another agent was allowed to judge a private lead');
select pg_temp.ok(
  (select verdict is null from public.lead_notifications where id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'another agent changed the row');

-- A missing owner id does not let another agent through.
select pg_temp.ok(
  (public.lead_notify_verdict('33333333-dddd-dddd-dddd-dddddddddddd', 'not_lead') ->> 'ok') = 'false',
  'a row with no owner was judged by someone else');

-- Staff is refused on a private lead.
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
select pg_temp.ok(
  (public.lead_notify_verdict('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not_lead') ->> 'error') = 'not yours',
  'staff was allowed to judge a private lead');
select pg_temp.ok(
  (select verdict is null from public.lead_notifications where id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'staff changed a private lead');

-- Staff may judge a Company Lead, and the reply does not include the address.
select pg_temp.ok(
  (with s as (
     select public.lead_notify_verdict('22222222-cccc-cccc-cccc-cccccccccccc', 'not_lead') as j
   )
   select (j ->> 'ok') = 'true' and not (j ? 'sender') and j::text not like '%@%' from s),
  'staff could not judge a company lead, or the address was returned');

-- The second call above already ran. Re-read from the first successful write.
select pg_temp.ok(
  (select verdict = 'not_lead' and verdict_by = '77777777-7777-7777-7777-777777777777'::uuid
     from public.lead_notifications where id = '22222222-cccc-cccc-cccc-cccccccccccc'),
  'company-lead verdict was not stored');

select pg_temp.ok(
  exists (
    select 1 from public.lead_sender_rules
     where user_id = '11111111-1111-1111-1111-111111111111'
       and lower(sender) = 'company-lead@example.com'
       and kind = 'not_a_lead'
  ),
  'the rule was not stored for the owner of the alert');

select pg_temp.ok(
  (select status = 'dismissed' from public.lead_concierge where lead_email = 'company-lead@example.com'),
  'the pending company-lead card was not dismissed');

-- The owner can judge their own private lead, and does see their own address.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select pg_temp.ok(
  (with s as (
     select public.lead_notify_verdict('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'true_lead') as j
   )
   select (j ->> 'ok') = 'true' and (j ->> 'sender') = 'owner-private@example.com' from s),
  'the owner could not judge their own lead');
select pg_temp.ok(
  (select verdict = 'true_lead' and verdict_by = '11111111-1111-1111-1111-111111111111'::uuid
     from public.lead_notifications where id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'the owner verdict was not stored');

reset role;
rollback;
