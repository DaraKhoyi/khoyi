// can_they_transact.mjs — "can they transact?" from their own words, with receipts.
//
// Marguerite (panel), 30 Sep: "a sentence that says 'mentioned pre-approval at
// $400K in August email' she opens every morning." _shared/transactFacts.ts,
// contact-transact, contact-research, ari-call-prep, prismTools.
//
//   1. RECEIPTS (no model): a fact whose quote is not in the message is dropped;
//      a real one keeps its date and channel; the agent's words quoted back in a
//      reply are not the buyer's.
//   2. LIVE KNOWN ANSWER (one small model call): a planted buyer who wrote
//      "pre-approved with Guild Mortgage for $400,000" and later "we have to
//      sell our condo first", with the agent's "> are you approved for 500k?"
//      quoted underneath → the line says Pre-approved at $400K (Guild), Must
//      sell first, and never 500K. A contact who wrote nothing → "Nothing said yet".
//   3. WIRED: research, call prep, Talk to Prism / Claude, the contact screen,
//      and the morning refresh.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PAT for part 2. BLOCKS.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

// 1. Receipts, no model.
const probe = `
import { verifyFacts, transactLine, ownPart } from './supabase/functions/_shared/transactFacts.ts';
const msgs = [
  { at: '2026-08-12T15:00:00Z', via: 'email', text: 'We got pre-approved with Guild for $400,000.' },
  { at: '2026-09-03T15:00:00Z', via: 'text', text: 'hoping to move in the next couple months' },
];
const raw = {
  preapproval: { value: 'yes', quote: 'We got pre-approved with Guild for $400,000.', msg: 1 },
  preapproval_amount: { value: 400000, quote: 'for $400,000', msg: 1 },
  lender: { value: 'Guild', quote: 'pre-approved with Guild', msg: 2 },          // wrong msg number, real quote
  must_sell_first: { value: true, quote: 'we must sell our house first', msg: 2 }, // invented
  timeline: { value: '1-3m', quote: 'move in the next couple months', msg: 2 },
};
const f = verifyFacts(raw, msgs);
const t = transactLine(f);
const own = ownPart('Sounds good.\\n\\nOn Mon, Aug 4, 2026 at 9:00 AM Dara wrote:\\n> Are you pre-approved for 500k?');
console.log(JSON.stringify({ keys: Object.keys(f).sort(), preAt: f.preapproval && f.preapproval.at, lenderAt: f.lender && f.lender.at, line: t.line, own }));
`;
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', probe], { encoding: 'utf8' });
let u = null;
try { u = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { problems.push('could not run the receipt check: ' + (r.stderr || '').slice(0, 300)); }
if (u) {
  expect(!u.keys.includes('must_sell_first'), 'a fact with no receipt (an invented quote) was kept');
  expect(u.keys.includes('preapproval') && u.keys.includes('preapproval_amount') && u.keys.includes('timeline'), `real facts were dropped (${u.keys})`);
  expect(u.lenderAt === '2026-08-12T15:00:00Z', 'a real quote under the wrong message number was not traced to the right message');
  expect(/Pre-approved at \$400K \(Guild\)/.test(u.line) && /email Aug 12/.test(u.line) && /text Sep 3/.test(u.line), `the line lacks the amount, lender or dated receipts: ${u.line}`);
  expect(!/500/.test(u.own) && /Sounds good/.test(u.own), `the agent's quoted words were not stripped from the buyer's message: ${JSON.stringify(u.own)}`);
}

// 3. Wired (static).
const read = (p) => readFileSync(p, 'utf8');
expect(/refreshTransact\(/.test(read('supabase/functions/contact-research/index.ts')), 'contact-research no longer reads "can they transact"');
expect(/transact:\s*transact \?/.test(read('supabase/functions/ari-call-prep/index.ts')), 'call prep no longer carries "can they transact"');
expect(/can_they_transact/.test(read('supabase/functions/_shared/prismTools.ts')), 'Talk to Prism / Claude can no longer answer "can they transact"');
expect(/<TransactLine contactId=/.test(read('src/views/ContactDetailModal.jsx')) && /<TransactLine t=/.test(read('src/views/AriBriefingView.jsx')), 'the contact screen or call prep no longer shows the line');

// 2. Live known answer.
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (URL_ && SVC && PAT) {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const q = async (sql) => {
    const x = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await x.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
  };
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const tag = crypto.randomBytes(5).toString('hex');
  const buyer = `zz.buyer.${tag}@example.org`;
  let uid = null, acct = null;
  try {
    const [{ n: sched }] = await q(`select count(*)::int n from cron.job where jobname = 'contact-transact-morning' and active`);
    expect(sched === 1, 'the morning "can they transact" refresh is not scheduled');
    const cu = await admin.auth.admin.createUser({ email: `smoke_transact_${Date.now()}@example.com`, password: 'Pw-' + crypto.randomBytes(9).toString('hex'), email_confirm: true });
    if (cu.error) throw cu.error;
    uid = cu.data.user.id;
    const [{ k }] = await q(`select decrypted_secret k from vault.decrypted_secrets where name = 'service_role_key'`);
    acct = (await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: `me.${tag}@example.com`, is_active: false }).select('id').single()).data.id;
    const c = (await admin.from('contacts').insert({ user_id: uid, name: 'Zz Buyer ' + tag, emails: [{ value: buyer, is_default: true }], type: 'lead' }).select('id').single()).data;
    const quiet = (await admin.from('contacts').insert({ user_id: uid, name: 'Zz Quiet ' + tag, emails: [{ value: `zz.quiet.${tag}@example.org`, is_default: true }], type: 'lead' }).select('id').single()).data;
    const mail = (id, days, body) => ({ user_id: uid, account_id: acct, provider_message_id: `zzt${tag}${id}`, provider_thread_id: `zztt${tag}`, from_address: buyer,
      direction: 'inbound', subject: 'House hunting', labels: ['INBOX'], internal_date: new Date(Date.now() - days * 864e5).toISOString(), body_text: body });
    await admin.from('email_messages_all').insert([
      mail(1, 40, 'Hi! Quick update: we got pre-approved with Guild Mortgage for $400,000 last week. Hoping to be in a place by spring.'),
      mail(2, 10, 'Also, we have to sell our condo first before we can close.\n\nOn Mon, Aug 4, 2026 at 9:00 AM Agent wrote:\n> Are you approved for 500k?'),
    ]);
    const call = (id) => fetch(`${URL_}/functions/v1/contact-transact`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: id, force: true }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    const got = await call(c.id);
    expect(/Pre-approved at \$400K/.test(got.line || '') && /Guild/.test(got.line || ''), `the buyer's own pre-approval ($400K, Guild) is not in the line: ${got.line || JSON.stringify(got).slice(0, 200)}`);
    expect(/Must sell first/.test(got.line || ''), `"we have to sell our condo first" is not in the line: ${got.line}`);
    expect(!/500/.test(got.line || ''), `the agent's quoted "500k" was credited to the buyer: ${got.line}`);
    const none = await call(quiet.id);
    expect(/^Nothing said yet/.test(none.line || '') && !!none.ask, `a contact who wrote nothing is given facts: ${JSON.stringify(none).slice(0, 200)}`);
  } catch (e) {
    problems.push('crashed: ' + (e?.message || e));
  } finally {
    try {
      if (uid) {
        await admin.from('ai_usage_log').delete().eq('user_id', uid);
        await admin.from('profiles').delete().eq('user_id', uid);
        await admin.from('email_messages_all').delete().eq('user_id', uid);
        await admin.from('contacts').delete().eq('user_id', uid);
        if (acct) await admin.from('email_accounts').delete().eq('id', acct);
        await admin.auth.admin.deleteUser(uid);
      }
    } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
  }
} else if (!process.env.CI) problems.push('set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_PAT for the live check');

if (!problems.length) {
  console.log('==== CAN THEY TRANSACT: clean — own words only, every fact with its receipt, invented quotes dropped, the agent\'s quoted words never credited to the buyer ====');
  process.exit(0);
}
console.log(`==== CAN THEY TRANSACT: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
