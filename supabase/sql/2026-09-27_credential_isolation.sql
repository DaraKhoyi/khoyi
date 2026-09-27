-- 2026-09-27 — third-party credentials: out of the browser, key out of the functions.
--
-- The panel (Fiduciary + Sentinel) asked where the key for
-- icloud_connections.app_password_enc lived. Answer: in an edge-function
-- environment variable (ICLOUD_ENC_KEY), read by icloud-connect and icloud-sync.
-- Checking that turned up three more problems, one much larger:
--
--   * EVERY AGENT'S GOOGLE TOKENS WERE SENT TO THEIR BROWSER. email_accounts
--     holds each agent's Gmail/Calendar refresh token in plain text, and the app
--     loaded the table with select('*') on every start — so the token that grants
--     standing access to the mailbox sat in every phone's memory. Anyone who
--     stole a PrismOS session (or ran script in the page) got Gmail access that
--     outlives the session. 9 accounts.
--   * The owner could READ their iCloud ciphertext and REWRITE their
--     calendar_home_url. icloud-sync sends the Apple ID + app password to that
--     URL every 20 minutes, so one hijacked PrismOS session could point it at
--     any server and collect the Apple credential in plain text — no function
--     compromise needed.
--   * anon (the public key) held table grants on all three credential tables.
--     RLS blocked it, but a grant that should not exist is one policy mistake
--     from a leak.
--
-- After this:
--   * No browser session can SELECT access_token, refresh_token or any iCloud
--     password column. The app sees has_refresh_token (true/false) instead.
--     Consequence: select('*') on these tables from the browser now FAILS — list
--     columns (src/helpers.js EMAIL_ACCOUNT_COLS). smoke/definer_guard.mjs checks.
--   * The iCloud key lives in Supabase Vault ('icloud_key'), not in any function.
--     Encrypt/decrypt happen inside the database, through two functions only the
--     service role may call. icloud-connect no longer handles a key at all.
--   * The browser may only switch an iCloud connection on/off or delete it.
--
-- Honest limit: every edge function holds the service-role key, so a fully
-- compromised function could still ask the database to decrypt. What this buys
-- is that the key is never in a function's environment, logs or memory, it can
-- be rotated in one place, and plaintext exists only for the seconds a sync
-- runs. Apple app-specific passwords are also revocable by the agent at
-- account.apple.com at any time — the final kill switch.

begin;

-- ── Google (email_accounts) ─────────────────────────────────────────────────
alter table public.email_accounts
  add column if not exists has_refresh_token boolean generated always as (refresh_token is not null) stored;

revoke all on public.email_accounts from anon;

-- The browser-side revoke is STAGED: the build before v1.08.75 loads this table
-- with select('*'), which fails the moment a column is withheld. Phones pick up
-- the new build the next time the app opens, so the revoke runs by itself at
-- 03:00 EDT on 28 Sep and then removes its own job. definer_guard verifies the
-- job exists until then, and the revoke after.
create or replace function public.email_accounts_hide_tokens()
returns void language plpgsql security definer set search_path to 'public'
as $f$
declare cols text;
begin
  revoke select, insert, update on public.email_accounts from authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'email_accounts'
     and column_name not in ('access_token', 'refresh_token');
  execute format('grant select (%s) on public.email_accounts to authenticated', cols);
  grant update (is_active) on public.email_accounts to authenticated;
  perform cron.unschedule(jobid) from cron.job where jobname = 'email-accounts-hide-tokens-once';
end $f$;
revoke all on function public.email_accounts_hide_tokens() from public, anon, authenticated;
select cron.schedule('email-accounts-hide-tokens-once', '0 7 28 9 *',
                     'select public.email_accounts_hide_tokens(); notify pgrst, ''reload schema'';')
 where not exists (select 1 from cron.job where jobname = 'email-accounts-hide-tokens-once');

-- ── Dropbox / cloud (cloud_tokens) — no policies, service role only ─────────
revoke all on public.cloud_tokens from anon, authenticated;

-- ── Personal AI keys (user_ai_keys) — read only by edge functions (service
--    role); the browser manages them through ai-key-manage. 0 rows today. ──────
revoke all on public.user_ai_keys from anon, authenticated;

-- ── iCloud ──────────────────────────────────────────────────────────────────
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'icloud_key',
                           'Encrypts icloud_connections.app_password_pgp. Rotate: re-encrypt every row, then replace.')
 where not exists (select 1 from vault.secrets where name = 'icloud_key');

alter table public.icloud_connections add column if not exists app_password_pgp bytea;
alter table public.icloud_connections alter column app_password_enc drop not null;  -- legacy column, emptied as rows migrate

create or replace function public.icloud_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer
set search_path to 'public', 'pg_temp', 'vault'
as $$
declare v_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role only'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'icloud_key';
  if v_key is null then raise exception 'icloud_key missing from vault'; end if;
  update icloud_connections
     set app_password_pgp = extensions.pgp_sym_encrypt(p_password, v_key),
         app_password_enc = null, updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'no iCloud connection for that user'; end if;
end $$;

create or replace function public.icloud_get_password(p_user uuid)
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp', 'vault'
as $$
declare v_key text; v_enc bytea;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role only'; end if;
  select app_password_pgp into v_enc from icloud_connections where user_id = p_user;
  if v_enc is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'icloud_key';
  return extensions.pgp_sym_decrypt(v_enc, v_key);
end $$;

revoke all on function public.icloud_set_password(uuid, text) from public, anon, authenticated;
revoke all on function public.icloud_get_password(uuid) from public, anon, authenticated;
grant execute on function public.icloud_set_password(uuid, text) to service_role;
grant execute on function public.icloud_get_password(uuid) to service_role;

revoke all on public.icloud_connections from anon, authenticated;
grant select (user_id, apple_id, enabled, status, last_error, last_synced_at, created_at, updated_at)
  on public.icloud_connections to authenticated;
grant update (enabled) on public.icloud_connections to authenticated;
grant delete on public.icloud_connections to authenticated;

commit;
