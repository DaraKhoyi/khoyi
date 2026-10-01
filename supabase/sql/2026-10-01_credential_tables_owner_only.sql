-- 2026-10-01 — CREDENTIAL TABLES: ONE OWNER, CHECKED NIGHTLY, NOT ASSUMED.
--
-- Sentinel (panel), 1 Oct: email_accounts and cloud_tokens hold OAuth refresh
-- tokens. RLS is on (221/221), but nobody had looked at the policy TEXT. "A
-- single policy that checks the wrong uid column would expose all 96 mailboxes
-- from one compromised account." Coverage counts cannot show that.
--
-- Two other things were found while answering it:
--   * The deploy gate's credential check (smoke/definer_guard.mjs) read
--     SUPABASE_PAT; CI provides SUPABASE_ACCESS_TOKEN. So its database half —
--     "no browser role can read a token column" — has been skipping itself on
--     every deploy since 27 Sep. Fixed in the same commit.
--   * Policies are only one route around row security. A VIEW owned by postgres
--     reads the table as its owner, and a SECURITY DEFINER function runs with
--     owner rights — either one, granted to the browser, skips every policy.
--
-- What this does, for the four credential tables (email_accounts, cloud_tokens,
-- user_ai_keys, icloud_connections):
--   1. Whatever policies exist are dropped and replaced by the one shape the
--      app actually relies on: a signed-in person sees, updates and deletes
--      THEIR OWN rows (user_id = auth.uid()), nothing else. The app's reads of
--      email_accounts carry no user filter (ActivityTimeline, AriBriefing,
--      Tracker) — they already assume this. Everything cross-agent (broker
--      adoption, sending, sync) runs as the service role in edge functions.
--      cloud_tokens and user_ai_keys get no browser policy at all.
--   2. Grants re-asserted exactly as 27 Sep intended: nothing for anon; token
--      columns never selectable or writable by the browser.
--   3. public.credential_posture() — what is TRUE now, not what was intended:
--      RLS on, every policy owner-scoped, no browser grant on a token column,
--      no browser-readable view over these tables, no browser-callable definer
--      function that touches a token column. Returns findings (empty = clean).
--      night-review shows it to the panel nightly; smoke/credential_scope.mjs
--      blocks a deploy on any finding and also PROVES it with two real logins.
--   4. This file refuses to apply (rolls back) if 1–2 did not take.

begin;

do $$
declare t text; p record;
begin
  foreach t in array array['email_accounts','cloud_tokens','user_ai_keys','icloud_connections'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- email_accounts: own rows only; token columns invisible (27 Sep grants, re-asserted).
create policy email_accounts_own_select on public.email_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy email_accounts_own_update on public.email_accounts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy email_accounts_own_delete on public.email_accounts for delete to authenticated using (user_id = (select auth.uid()));
-- Everything off (Supabase's default grants include TRUNCATE, which ignores RLS),
-- then back only what the app uses.
revoke all on public.email_accounts from authenticated;
grant delete on public.email_accounts to authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'email_accounts'
     and column_name not in ('access_token', 'refresh_token');
  execute format('grant select (%s) on public.email_accounts to authenticated', cols);
end $$;
grant update (is_active) on public.email_accounts to authenticated;

-- cloud_tokens, user_ai_keys: service role only.
revoke all on public.cloud_tokens from authenticated;
do $$ begin
  if to_regclass('public.user_ai_keys') is not null then execute 'revoke all on public.user_ai_keys from authenticated'; end if;
end $$;

-- icloud_connections: own row only; the browser may see status, switch it on/off, delete it.
create policy icloud_own_select on public.icloud_connections for select to authenticated using (user_id = (select auth.uid()));
create policy icloud_own_update on public.icloud_connections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy icloud_own_delete on public.icloud_connections for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.icloud_connections from authenticated;
grant select (user_id, apple_id, enabled, status, last_error, last_synced_at, created_at, updated_at) on public.icloud_connections to authenticated;
grant update (enabled) on public.icloud_connections to authenticated;
grant delete on public.icloud_connections to authenticated;

-- ── What is true right now ───────────────────────────────────────────────────
create or replace function public.credential_posture()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  f jsonb := '[]'::jsonb;
  tabs text[] := array['email_accounts','cloud_tokens','user_ai_keys','icloud_connections'];
  tok constant text := '(refresh_token|access_token|app_password|_enc$|_pgp$|api_key|secret)';
  r record;
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role only';
  end if;

  -- RLS on.
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
            and c.relname = any(tabs) and not c.relrowsecurity loop
    f := f || jsonb_build_object('table', r.relname, 'problem', 'row level security is off');
  end loop;

  -- Every policy: browser-facing, and scoped to the row's OWN user_id.
  for r in select tablename, policyname, cmd, roles, coalesce(qual, '') qual, coalesce(with_check, '') wc
             from pg_policies where schemaname = 'public' and tablename = any(tabs) loop
    if r.tablename in ('cloud_tokens', 'user_ai_keys') then
      f := f || jsonb_build_object('table', r.tablename, 'policy', r.policyname, 'problem', 'service-role-only table has a browser policy');
    elsif 'anon' = any(r.roles) or 'public' = any(r.roles) then
      f := f || jsonb_build_object('table', r.tablename, 'policy', r.policyname, 'problem', 'policy applies to signed-out callers');
    elsif (r.cmd <> 'INSERT' and r.qual !~ '^\(?\s*user_id = \(\s*SELECT auth\.uid\(\) AS uid\s*\)\s*\)?$')
       or (r.wc <> '' and r.wc !~ '^\(?\s*user_id = \(\s*SELECT auth\.uid\(\) AS uid\s*\)\s*\)?$') then
      f := f || jsonb_build_object('table', r.tablename, 'policy', r.policyname, 'cmd', r.cmd, 'problem', 'not scoped to the row''s own user_id');
    end if;
  end loop;

  -- No browser grant on the tables that are service-only; no browser access to any token column.
  for r in select t.relname, rl from pg_class t cross join unnest(array['anon','authenticated']) rl
            where t.relnamespace = 'public'::regnamespace and t.relname = any(tabs)
              and (rl = 'anon' or t.relname in ('cloud_tokens','user_ai_keys'))
              and (has_table_privilege(rl, t.oid, 'select') or has_table_privilege(rl, t.oid, 'insert')
                or has_table_privilege(rl, t.oid, 'update') or has_table_privilege(rl, t.oid, 'delete')) loop
    f := f || jsonb_build_object('table', r.relname, 'role', r.rl, 'problem', 'browser role holds a table grant');
  end loop;
  -- TRUNCATE skips row security entirely; no browser role may hold it on any of these.
  for r in select t.relname, rl from pg_class t cross join unnest(array['anon','authenticated']) rl
            where t.relnamespace = 'public'::regnamespace and t.relname = any(tabs)
              and has_table_privilege(rl, t.oid, 'truncate') loop
    f := f || jsonb_build_object('table', r.relname, 'role', r.rl, 'problem', 'browser role can TRUNCATE (bypasses row security)');
  end loop;
  for r in select c.table_name, c.column_name, rl from information_schema.columns c cross join unnest(array['anon','authenticated']) rl
            where c.table_schema = 'public' and c.table_name = any(tabs) and c.column_name ~* tok and c.column_name !~* '^has_'
              and (has_column_privilege(rl, format('public.%I', c.table_name), c.column_name, 'select')
                or has_column_privilege(rl, format('public.%I', c.table_name), c.column_name, 'insert')
                or has_column_privilege(rl, format('public.%I', c.table_name), c.column_name, 'update')) loop
    f := f || jsonb_build_object('table', r.table_name, 'column', r.column_name, 'role', r.rl, 'problem', 'browser can read or write a credential column');
  end loop;

  -- Views over these tables that the browser can read (a view reads as its owner).
  for r in select distinct v.oid::regclass::text vname
             from pg_depend d join pg_rewrite w on w.oid = d.objid join pg_class v on v.oid = w.ev_class
            where d.refobjid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname = any(tabs))
              and v.relkind in ('v','m') and v.oid <> d.refobjid
              and (has_table_privilege('anon', v.oid, 'select') or has_table_privilege('authenticated', v.oid, 'select')) loop
    f := f || jsonb_build_object('view', r.vname, 'problem', 'browser-readable view over a credential table');
  end loop;

  -- Definer functions the browser can call that touch a token column.
  for r in select p.oid::regprocedure::text sig from pg_proc p
            where p.prosecdef and p.pronamespace = 'public'::regnamespace
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
              and p.prosrc ~* '(refresh_token|access_token|app_password_pgp|app_password_enc)'
              and p.proname <> 'credential_posture' loop
    f := f || jsonb_build_object('function', r.sig, 'problem', 'browser-callable definer function touches a token column');
  end loop;

  return f;
end $$;
revoke all on function public.credential_posture() from public, anon, authenticated;
grant execute on function public.credential_posture() to service_role;

-- Refuse to apply if the parts this file controls did not take.
do $$
declare bad jsonb;
begin
  select coalesce(jsonb_agg(x), '[]') into bad from jsonb_array_elements(public.credential_posture()) x
   where x ? 'table';
  if jsonb_array_length(bad) > 0 then raise exception 'credential posture still wrong after the fix: %', bad; end if;
end $$;

commit;
notify pgrst, 'reload schema';
