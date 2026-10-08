-- =====================================================================
-- public.retry_stuck_recordings(): QCP_TOKEN out of the function body (8 Oct 2026)
--
-- Follows 2026-10-07i / 2026-10-08a (cron command text). This SECURITY DEFINER
-- function (run by pg_cron job 79 'retry-stuck-recordings', every 5 min) had
-- QCP_TOKEN pasted inline as its x-internal-token header, so anyone who could
-- read pg_proc (or call pg_get_functiondef) could read the token. It was also
-- executable by PUBLIC/anon/authenticated through the REST API.
--
-- What it does (idempotent, contains no secret):
--   1. Swaps the literal for the run-time lookup
--        (select decrypted_secret from vault.decrypted_secrets where name = 'qcp_token' limit 1)
--      via the function's own pg_get_functiondef text. Nothing else in the
--      function changes; the header sent is identical.
--   2. Revokes EXECUTE from PUBLIC, anon and authenticated. Nothing in the app
--      calls it (no rpc('retry_stuck_recordings') in the repo or the deployed
--      front end, no API log hits); only job 79 calls it, as postgres (owner).
--      service_role keeps its explicit grant.
--   3. Fails (and changes nothing) if any of the 7 cron Vault secrets is still
--      inline in any function outside the system schemas.
-- A re-run finds no literal and the grants already gone, so it changes nothing.
-- =====================================================================
do $mig$
declare
  v   text := (select decrypted_secret from vault.decrypted_secrets where name = 'qcp_token' limit 1);
  d   text;
  lit text;
begin
  if v is null then raise exception 'Vault qcp_token missing; nothing done'; end if;

  -- 1. Inline token -> Vault lookup.
  d   := pg_get_functiondef('public.retry_stuck_recordings(integer)'::regprocedure);
  lit := '''x-internal-token'',''' || v || '''';
  if position(lit in d) > 0 then
    execute replace(d, lit,
      '''x-internal-token'',(select decrypted_secret from vault.decrypted_secrets where name = ''qcp_token'' limit 1)');
    raise notice 'retry_stuck_recordings: token switched to Vault lookup';
  end if;

  -- 2. Not callable from the API.
  revoke execute on function public.retry_stuck_recordings(integer) from public, anon, authenticated;
  grant  execute on function public.retry_stuck_recordings(integer) to service_role;

  -- 3. No known secret left in any function body.
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join vault.decrypted_secrets s
        on s.name in ('qcp_token','service_role_key','service_role_jwt','email_intel_token',
                      'ingest_token','research_token','cube_token')
     where n.nspname not in ('pg_catalog','information_schema','vault','pgsodium')
       and position(s.decrypted_secret in coalesce(p.prosrc, '')) > 0) then
    raise exception 'a secret is still inline in a function body; rolled back';
  end if;
end $mig$;
