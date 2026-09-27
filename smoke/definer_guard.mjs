// definer_guard.mjs — two database-permission mistakes that must not come back.
//
// 1. THE NULL-UID BYPASS. A SECURITY DEFINER function runs with full rights, so
//    its own check is the only lock. Written as
//        if auth.uid() is not null and auth.uid() <> owner then raise ...
//    it is skipped entirely by a caller who is not signed in — their uid IS
//    null. On 27 Sep two functions callable with the public anon key had exactly
//    this: set_tax_id (anyone could overwrite a contact's tax ID) and
//    merge_contacts (anyone could merge and retire another agent's contact).
//    The right shape:
//        if auth.role() is distinct from 'service_role' then
//          if auth.uid() is null then raise exception 'sign in required'; end if;
//          if auth.uid() <> owner and not is_brokerage_staff() then raise ...; end if;
//        end if;
//
// 2. SENSITIVE COLUMNS ON SHARED TABLES. contacts is readable by other agents
//    when a contact is shared (team, brokerage, everyone), so any tax-ID, SSN,
//    account or passport column on it travels with the share. The panel
//    (Fiduciary + Sentinel) flagged contacts.tax_id_last4; on 27 Sep all of it
//    moved to contact_tax_ids (owner + staff only). This fails on any such
//    column on a table whose read policy shares rows — unless it is listed in
//    TRANSITIONAL and holds no data at all.
//
// Needs SUPABASE_PAT. BLOCKS.
// Usage: SUPABASE_PAT=... node smoke/definer_guard.mjs

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== DEFINER GUARD: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

// Columns kept one release so phones on the previous app can still save; a
// trigger blanks them on every write. DROP after 4 Oct 2026, then delete here.
const TRANSITIONAL = new Set(['contacts.tax_id_last4', 'contacts.tax_id_type']);

async function q(sql) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
        body: JSON.stringify({ query: sql }),
      });
      const j = await r.json();
      if (Array.isArray(j)) return j;
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 1000 * 2 ** i));
  }
  console.log('==== DEFINER GUARD: FAILED — could not query the database ====');
  process.exit(1);
}

const bypass = await q(String.raw`
  select p.oid::regprocedure::text sig
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
     and pg_get_functiondef(p.oid) ~* 'auth\.uid\(\)\s+is\s+not\s+null\s+and'
   order by 1`);

const cols = await q(String.raw`
  select c.table_name t, c.column_name col
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.column_name ~* '(ssn|social_security|tax_id|routing|account_number|iban|card_number|cvv|passport|license_num|date_of_birth)'
     and exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.table_name and p.cmd in ('SELECT','ALL')
                    and p.qual ~* '(shared_scope|is_team_member|can_view_recruit)')
   order by 1, 2`);

const bad = [];
for (const r of bypass) bad.push(`${r.sig} — "auth.uid() is not null and …" lets a signed-out caller skip the check`);
for (const { t, col } of cols) {
  const key = `${t}.${col}`;
  if (!TRANSITIONAL.has(key)) { bad.push(`${key} — sensitive column on a table other agents can read through sharing`); continue; }
  const [{ n }] = await q(`select count(*)::int n from public."${t}" where "${col}" is not null`);
  if (n > 0) bad.push(`${key} — transitional column must stay empty, holds ${n} value(s)`);
}

if (!bad.length) {
  console.log(`==== DEFINER GUARD: clean — no signed-out bypass in any callable definer function; no sensitive data on shared tables (${cols.length} transitional column(s), empty) ====`);
  process.exit(0);
}
console.log(`==== DEFINER GUARD: ${bad.length} problem(s) ====`);
for (const b of bad) console.log('  ✗ ' + b);
console.log('  See the header of smoke/definer_guard.mjs for the right shape of each fix.');
process.exit(1);
