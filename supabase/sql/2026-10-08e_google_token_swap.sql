-- =====================================================================
-- Google tokens encrypted at rest: compare-and-swap for the backfill (8 Oct 2026)
--
-- The tokens are encrypted in the edge functions (_shared/googleTokens.ts, key
-- GOOGLE_TOKEN_KEY, never stored in the database). The google-token-seal
-- function rewrites existing rows from plain text to "enc:v1:..." (or back, to
-- roll back). It must not overwrite a token that a sync or a reconnect changed
-- while it was working, so each rewrite is "set it to NEW only if it is still
-- OLD". The values travel in the POST body of an RPC, never in a URL, so no
-- token lands in an API log.
--
-- Service role only. SECURITY INVOKER (the service role already bypasses RLS),
-- so credential_posture() has nothing to flag. Idempotent.
-- Rollback: drop function public.google_token_swap(uuid, text, text, text);
-- =====================================================================
begin;

create or replace function public.google_token_swap(p_id uuid, p_field text, p_old text, p_new text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare n int;
begin
  if p_field = 'refresh_token' then
    update public.email_accounts set refresh_token = p_new
     where id = p_id and refresh_token is not distinct from p_old;
  elsif p_field = 'access_token' then
    update public.email_accounts set access_token = p_new
     where id = p_id and access_token is not distinct from p_old;
  else
    raise exception 'google_token_swap: unknown field %', p_field;
  end if;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.google_token_swap(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.google_token_swap(uuid, text, text, text) to service_role;

commit;
notify pgrst, 'reload schema';
