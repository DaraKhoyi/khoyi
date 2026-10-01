// credential_scope.mjs — one agent can never reach another agent's mailbox.
//
// Sentinel (panel), 1 Oct: email_accounts and cloud_tokens hold OAuth refresh
// tokens; RLS coverage was confirmed but the policy SCOPE never was. One policy
// on the wrong uid column would expose every mailbox from one stolen login.
// (2026-10-01_credential_tables_owner_only.sql)
//
//   1. POSTURE: public.credential_posture() must return no findings — RLS on,
//      every policy scoped to the row's own user_id, no browser grant on a token
//      column, no TRUNCATE, no browser-readable view or browser-callable definer
//      function over the tokens.
//   2. PROOF, with two real throwaway logins (A and B) through the public API
//      exactly as a phone would call it: B cannot see A's account, cannot change
//      it, cannot delete it; neither can read a token — not even their own;
//      neither can read cloud_tokens.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY and SUPABASE_PAT
// (or SUPABASE_ACCESS_TOKEN). BLOCKS — a credential check that skips itself is
// how definer_guard's database half went unrun from 27 Sep to 1 Oct.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !ANON || !SVC || !PAT) {
  console.log('==== CREDENTIAL SCOPE: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT ====');
  process.exit(1);
}
const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
const problems = [];

async function q(sql) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
      const j = await r.json();
      if (Array.isArray(j)) return j;
      if (r.status < 500 && r.status !== 429) throw new Error(JSON.stringify(j).slice(0, 300));
    } catch (e) { if (i === 4) throw e; }
    await new Promise((s) => setTimeout(s, 1000 * 2 ** i));
  }
}

// 1. Posture
try {
  const [{ v }] = await q('select public.credential_posture() v');
  for (const x of v || []) problems.push(`${x.table || x.view || x.function}${x.policy ? ' / policy ' + x.policy : ''}${x.column ? '.' + x.column : ''}${x.role ? ' (' + x.role + ')' : ''} — ${x.problem}`);
} catch (e) { problems.push('could not read credential_posture(): ' + String(e.message || e).slice(0, 200)); }

// 2. Proof with two logins
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const tag = crypto.randomBytes(5).toString('hex');
const pw = 'Pw-' + crypto.randomBytes(12).toString('hex');
const made = [];
async function login(label) {
  const email = `smoke_cred_${label}_${tag}@example.com`;
  const cu = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (cu.error) throw cu.error;
  made.push(cu.data.user.id);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password: pw });
  if (s.error) throw s.error;
  return { id: cu.data.user.id, c };
}
let acctA = null;
try {
  const A = await login('a'), B = await login('b');
  const ins = await admin.from('email_accounts').insert({ user_id: A.id, provider: 'google', email_address: `a.${tag}@example.com`,
    is_active: false, refresh_token: 'smoke-not-a-real-token-' + tag, access_token: 'smoke-not-a-real-token-' + tag }).select('id').single();
  if (ins.error) throw ins.error;
  acctA = ins.data.id;

  const seen = await B.c.from('email_accounts').select('id').eq('id', acctA);
  if (seen.error || (seen.data || []).length) problems.push(`agent B could see agent A's email account (${seen.error ? seen.error.message : (seen.data || []).length + ' row'})`);
  const all = await B.c.from('email_accounts').select('id');
  if ((all.data || []).some((r) => r.id === acctA)) problems.push("an unfiltered read by agent B returned agent A's account");
  await B.c.from('email_accounts').update({ is_active: true }).eq('id', acctA);
  await B.c.from('email_accounts').delete().eq('id', acctA);
  const after = await admin.from('email_accounts').select('id,is_active').eq('id', acctA).maybeSingle();
  if (!after.data) problems.push("agent B deleted agent A's email account");
  else if (after.data.is_active === true) problems.push("agent B changed agent A's email account (switched it on)");

  for (const [who, cl] of [['agent A (own row)', A.c], ['agent B', B.c]]) {
    const t = await cl.from('email_accounts').select('refresh_token').eq('id', acctA);
    if (!t.error && (t.data || []).some((r) => r.refresh_token)) problems.push(`${who} could read a refresh token`);
    const ct = await cl.from('cloud_tokens').select('*').limit(1);
    if (!ct.error && (ct.data || []).length) problems.push(`${who} could read cloud_tokens`);
  }
  const own = await A.c.from('email_accounts').select('id').eq('id', acctA);
  if ((own.data || []).length !== 1) problems.push('agent A cannot see their OWN email account — the app would break (' + (own.error?.message || '0 rows') + ')');
} catch (e) {
  problems.push('could not run the two-login proof: ' + String(e.message || e).slice(0, 200));
} finally {
  if (acctA) await admin.from('email_accounts').delete().eq('id', acctA);
  for (const id of made) { try { await admin.auth.admin.deleteUser(id); } catch (_) {} }
}

if (problems.length) {
  console.log(`==== CREDENTIAL SCOPE: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== CREDENTIAL SCOPE: clean — policies owner-only; another agent cannot see, change or delete an account; no browser reads a token ====');
