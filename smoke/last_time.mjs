// last_time.mjs — "what did I say last time?", plainly; never how long it has been, never a score.
//
// Ray (panel), 30 Sep: "I always forget what I said last time… if it did that
// one thing I would not feel stupid" — and he closes anything that rates the
// relationship or shows the gap. _shared/lastTime.ts, contact-transact,
// ari-call-prep, contact-research, talk-to-prism, TransactLine.jsx.
//
//   1. NO MODEL: a sentence about elapsed time, gaps or scores is dropped; a
//      plain one about what was said is kept.
//   2. STATIC: the research brief and call prep give the model calendar dates,
//      never "N days ago", and forbid recency framing and scores; Talk to Prism
//      has the same rule; the contact screen and call prep show "Last time".
//   3. LIVE KNOWN ANSWER (one small model call): a planted exchange gives both
//      "you said" and "they said", dated, with no elapsed-time wording.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PAT for part 3. BLOCKS.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

const probe = `
import { plainSentence } from './supabase/functions/_shared/lastTime.ts';
const bad = ["It's been 47 days since you last spoke.", "You haven't reached out in a while.", "You should have followed up sooner.", "Relationship health: 3/10.", "You last emailed 3 weeks ago about the condo."];
const good = ["You sent Maria three Lutz listings under $400K and asked about Saturday.", "They asked whether the seller would cover closing costs.", "You talked about the 12-month lease and the move-in on Nov 1."];
console.log(JSON.stringify({ badKept: bad.filter((s) => plainSentence(s) !== null), goodDropped: good.filter((s) => plainSentence(s) === null) }));
`;
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', probe], { encoding: 'utf8' });
let u = null; try { u = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { problems.push('could not run the plain-sentence check: ' + (r.stderr || '').slice(0, 300)); }
if (u) {
  for (const s of u.badKept) problems.push(`a sentence that judges or counts time would be shown: "${s}"`);
  for (const s of u.goodDropped) problems.push(`a plain sentence about what was said is dropped: "${s}"`);
}

const read = (p) => readFileSync(p, 'utf8');
const research = read('supabase/functions/contact-research/index.ts');
expect(!/days ago\)/.test(research) && /NEVER state or imply how long it has been/.test(research), 'the research brief gives the model "N days ago" or lost its no-recency rule');
const prep = read('supabase/functions/ari-call-prep/index.ts');
expect(!/daysSince\(/.test(prep) && /NEVER mention how long it has been since contact/.test(prep) && /last_time: lastTime/.test(prep), 'call prep counts days, lost its no-recency rule, or no longer returns "last time"');
expect(/never score or rate a relationship/.test(read('supabase/functions/talk-to-prism/index.ts')), 'Talk to Prism lost the no-recency, no-score rule');
expect(/Last time/.test(read('src/views/TransactLine.jsx')) && /lastTime=\{d\?\.last_time\}/.test(read('src/views/AriBriefingView.jsx')), 'the contact screen or call prep no longer shows "Last time"');
expect(/last_time/.test(read('supabase/functions/_shared/prismTools.ts')), 'Talk to Prism / Claude can no longer say what was said last time');

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (URL_ && SVC && PAT) {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const q = async (sql) => { const x = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) }); const j = await x.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j; };
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const tag = crypto.randomBytes(5).toString('hex'), them = `zz.lt.${tag}@example.org`;
  let uid = null, acct = null;
  try {
    const cu = await admin.auth.admin.createUser({ email: `smoke_lt_${Date.now()}@example.com`, password: 'Pw-' + crypto.randomBytes(9).toString('hex'), email_confirm: true }); if (cu.error) throw cu.error;
    uid = cu.data.user.id;
    const [{ k }] = await q(`select decrypted_secret k from vault.decrypted_secrets where name = 'service_role_key'`);
    acct = (await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: `me.${tag}@example.com`, is_active: false }).select('id').single()).data.id;
    const c = (await admin.from('contacts').insert({ user_id: uid, name: 'Maria Zz' + tag, emails: [{ value: them, is_default: true }], type: 'lead' }).select('id').single()).data;
    const m = (id, dir, days, subject, body) => ({ user_id: uid, account_id: acct, provider_message_id: `zzl${tag}${id}`, provider_thread_id: `zzlt${tag}`, direction: dir, subject, labels: [dir === 'inbound' ? 'INBOX' : 'SENT'], internal_date: new Date(Date.now() - days * 864e5).toISOString(), body_text: body,
      from_address: dir === 'inbound' ? them : `me.${tag}@example.com`, to_addresses: dir === 'inbound' ? [{ name: null, email: `me.${tag}@example.com` }] : [{ name: 'Maria', email: them }] });
    await admin.from('email_messages_all').insert([
      m(1, 'outbound', 60, 'Three in Lutz', 'Hi Maria, here are three homes in Lutz under $400K: 18 Oak Ln, 22 Pine Ct and 5 Elm St. Would Saturday at 10 work to see them?'),
      m(2, 'inbound', 55, 'Re: Three in Lutz', 'Saturday works. Can we also ask if the seller on Pine Ct would cover closing costs?'),
    ]);
    const got = await fetch(`${URL_}/functions/v1/contact-transact`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: c.id, force: true }) }).then((x) => x.json());
    const lt = got.last_time || {};
    expect(lt.you && /lutz|oak|pine|elm|saturday|\$400/i.test(lt.you.said), `"what you said last" is missing or wrong: ${JSON.stringify(lt.you)}`);
    expect(lt.them && /closing|pine|saturday/i.test(lt.them.said), `"what they said last" is missing or wrong: ${JSON.stringify(lt.them)}`);
    expect(!/\b\d+\s+(day|week|month)s?\b|ago|a while|haven'?t/i.test(JSON.stringify(lt)), `"last time" speaks of elapsed time: ${JSON.stringify(lt)}`);
  } catch (e) { problems.push('crashed: ' + (e?.message || e)); }
  finally {
    try { if (uid) { await admin.from('ai_usage_log').delete().eq('user_id', uid); await admin.from('profiles').delete().eq('user_id', uid); await admin.from('email_messages_all').delete().eq('user_id', uid); await admin.from('contacts').delete().eq('user_id', uid); if (acct) await admin.from('email_accounts').delete().eq('id', acct); await admin.auth.admin.deleteUser(uid); } }
    catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
  }
} else if (!process.env.CI) problems.push('set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_PAT for the live check');

if (!problems.length) { console.log('==== LAST TIME: clean — what was last said, plainly and dated; never elapsed time, never a score ===='); process.exit(0); }
console.log(`==== LAST TIME: ${problems.length} problem(s) ====`); for (const p of problems) console.log('  ✗ ' + p); process.exit(1);
