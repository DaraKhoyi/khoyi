// open_reads.mjs — system wiring is staff-only; nothing skips row-level security.
//
// The Sentinel (panel), 29 Sep: app_config and agent_aliases were readable by
// every signed-in account (and, it turned out, by strangers). Fixed in
// supabase/sql/2026-09-29_close_open_reads.sql. Each gate run proves, with a
// throwaway NON-staff agent:
//
//   1. They can read the one setting the app needs (licensing_enforced).
//   2. They cannot read any other app_config setting (one is planted for the run).
//   3. They cannot read agent_aliases.
//   4. Live structure: every view runs as the person asking (security_invoker),
//      and every "everyone may read" rule is on a known list of shared reference
//      data. A new one fails the gate until someone decides it belongs there.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !ANON || !SVC) { console.log('==== OPEN READS: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

// Shared reference data every signed-in agent may read, with the reason.
const OPEN_TO_AGENTS = {
  mileage_rates: 'IRS mileage rates',
  txn_milestone_defs: 'standard transaction milestones',
  teaching_lessons: 'in-app lessons',
  teaching_triggers: 'when lessons appear',
  lead_gen_system_templates: 'lead-generation system templates',
};

const email = `smoke_openreads_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
const plantKey = 'zz_smoke_secret_' + crypto.randomBytes(4).toString('hex');
let uid = null;
try {
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.data.user.id;
  const r0 = await admin.from('app_config').insert({ key: plantKey, value: 'staff only' });
  if (r0.error) throw new Error('plant: ' + r0.error.message);
  const agent = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await agent.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;

  const lic = await agent.from('app_config').select('key').eq('key', 'licensing_enforced');
  expect(!lic.error && lic.data?.length === 1, `an agent cannot read licensing_enforced — the app needs it (${lic.error?.message || lic.data?.length})`);
  const other = await agent.from('app_config').select('key').eq('key', plantKey);
  expect(!other.data?.length, 'an agent can read a staff-only app_config setting');
  const al = await agent.from('agent_aliases').select('id').limit(1);
  expect(!al.data?.length, 'an agent can read agent_aliases (staff only)');

  if (PAT) {
    const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
    const q = async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
      const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
    };
    const views = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text, '') ilike '%security_invoker=true%'`);
    for (const v of views) problems.push(`view ${v.relname} skips row-level security (needs security_invoker = true)`);
    const open = await q(`select distinct tablename from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL') and qual = 'true'`);
    for (const o of open) if (!OPEN_TO_AGENTS[o.tablename]) problems.push(`${o.tablename} is readable by every account (a "true" read rule) — tighten it or add it to OPEN_TO_AGENTS with the reason`);
  } else if (!process.env.CI) problems.push('set SUPABASE_PAT to run the structure checks');
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    await admin.from('app_config').delete().eq('key', plantKey);
    if (uid) await admin.auth.admin.deleteUser(uid);
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== OPEN READS: clean — agents see only the settings they need, aliases are staff-only, every view obeys row-level security ====');
  process.exit(0);
}
console.log(`==== OPEN READS: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
