// ai_subject_guard.mjs — every AI call says who (or what deal) it was about.
//
// The Archivist + the Merchant (panel), 30 Sep: "2,866 of 2,872 AI calls carry
// no contact_id — the ROI chain from spend to person to deal can never be
// closed." Dara: "It's better for things to be automatic."
// supabase/sql/2026-09-30_ai_spend_names_its_person.sql: functions record what
// they were already working on; a trigger turns it into the person.
//
//   1. STATIC: every edge function that logs AI spend passes a subject
//      (subjectType / subjectEmail / subject_type / subject_email) or is on the
//      not-about-a-person list, ai_fn_not_about_a_person(). A new function that
//      does neither fails here — so the gap cannot quietly reopen.
//   2. LIVE, known answers, with a throwaway person: a contact, an email thread,
//      a bare address, a lead card, a transaction — each resolves to the right
//      person or deal; a chat is "no_one"; an unlisted function with no subject
//      stays unresolved (counted as missing, not hidden).
//   3. Closings count spend matched by contact, by address, or by transaction.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

let q = null;
if (PAT && URL_) {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
  };
}

// 1. Static.
const LOGS = /logAiUsage\(|logEmbeddingUsage\(|logTtsUsage\(|logUsage\(|from\("ai_usage_log"\)\.insert/;
const NAMES = /subjectType|subjectEmail|subject_type|subject_email/;
const fns = readdirSync('supabase/functions').filter((d) => !d.startsWith('_') && existsSync(`supabase/functions/${d}/index.ts`));
const silent = fns.filter((d) => { const s = readFileSync(`supabase/functions/${d}/index.ts`, 'utf8'); return LOGS.test(s) && !NAMES.test(s); });
let exempt = new Set();
if (q && silent.length) {
  const rows = await q(`select f, public.ai_fn_not_about_a_person(f) ok from unnest(array[${silent.map((s) => `'${s}'`).join(',')}]) f`);
  exempt = new Set(rows.filter((r) => r.ok).map((r) => r.f));
} else if (!q && !process.env.CI) problems.push('set SUPABASE_PAT to read the not-about-a-person list');
if (q) for (const d of silent) if (!exempt.has(d)) problems.push(`${d} spends AI without saying who it was about — pass subjectType/subjectId or subjectEmail to the logger, or add it to ai_fn_not_about_a_person() if it is truly not about one person`);

// 2 & 3. Live.
if (q && SVC) {
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const tag = crypto.randomBytes(4).toString('hex');
  const person = `zz.person.${tag}@example.org`;
  let uid = null, acct = null;
  try {
    const cu = await admin.auth.admin.createUser({ email: `smoke_subj_${Date.now()}@example.com`, password: 'Pw-' + crypto.randomBytes(9).toString('hex'), email_confirm: true });
    if (cu.error) throw cu.error;
    uid = cu.data.user.id;
    const contact = (await admin.from('contacts').insert({ user_id: uid, name: 'ZZ Subject ' + tag, emails: [{ value: person, is_default: true }], type: 'lead' }).select('id').single()).data;
    acct = (await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: `me.${tag}@example.com`, is_active: false }).select('id').single()).data.id;
    const thread = (await admin.from('email_threads').insert({ user_id: uid, account_id: acct, provider_thread_id: 'zzst' + tag, labels: ['INBOX'], subject: 's' }).select('id').single()).data;
    await admin.from('email_messages_all').insert({ user_id: uid, account_id: acct, thread_id: thread.id, provider_message_id: 'zzsm' + tag, provider_thread_id: 'zzst' + tag,
      from_address: person, direction: 'inbound', subject: 's', labels: ['INBOX'], internal_date: new Date().toISOString() });
    const card = (await admin.from('lead_concierge').insert({ user_id: uid, kind: 'lead', status: 'archived', lead_email: person, lead_name: 'ZZ', channel: 'email' }).select('id').single()).data;

    const log = async (extra) => {
      const r = await admin.from('ai_usage_log').insert({ user_id: uid, fn: extra.fn || 'zz-smoke-fn', model: 'claude-sonnet-4-6', input_tokens: 1, output_tokens: 1, cost_usd: 0, ...extra, fn: extra.fn || 'zz-smoke-fn' })
        .select('contact_id, subject_email, about').single();
      if (r.error) throw new Error('log: ' + r.error.message);
      return r.data;
    };
    const a = await log({ subject_type: 'contact', subject_id: contact.id });
    expect(a.contact_id === contact.id && a.about === 'person', `a contact subject did not resolve (${JSON.stringify(a)})`);
    const b = await log({ subject_type: 'email_thread', subject_id: thread.id });
    expect(b.contact_id === contact.id && b.subject_email === person, `an email thread did not resolve to the sender's contact (${JSON.stringify(b)})`);
    const c = await log({ subject_email: person.toUpperCase() });
    expect(c.contact_id === contact.id, `a bare address did not resolve to the contact (${JSON.stringify(c)})`);
    const d = await log({ subject_type: 'lead_card', subject_id: card.id });
    expect(d.contact_id === contact.id && d.subject_email === person, `a lead card did not resolve (${JSON.stringify(d)})`);
    const e = await log({ subject_type: 'transaction', subject_id: crypto.randomUUID() });
    expect(e.about === 'deal', `a transaction subject is not recorded as a deal (${JSON.stringify(e)})`);
    const f = await log({ fn: 'talk-to-prism' });
    expect(f.about === 'no_one', `a chat with Prism is not marked "not about one person" (${JSON.stringify(f)})`);
    const g = await log({});
    expect(g.about === null && g.contact_id === null, `an unlisted function with no subject is hidden instead of counted as missing (${JSON.stringify(g)})`);

    const [ca] = await q(`select pg_get_functiondef('public.closing_attribution(date,date)'::regprocedure) d`);
    expect(ca.d.includes('l.subject_email = any(cl.emails)') && ca.d.includes("l.subject_type = 'transaction' and l.subject_id = cl.id"),
      'closings no longer count AI spend matched by address or by transaction');
    const [tg] = await q(`select count(*)::int n from pg_trigger where tgname = 'txn_parties_from_contract_trg' and not tgisinternal`);
    expect(tg.n === 1, 'a closing no longer learns its buyer and seller from its own contract');
  } catch (e2) {
    problems.push('crashed: ' + (e2?.message || e2));
  } finally {
    try {
      if (uid) {
        await admin.from('ai_usage_log').delete().eq('user_id', uid);
        await admin.from('lead_concierge').delete().eq('user_id', uid);
        await admin.from('email_messages_all').delete().eq('user_id', uid);
        await admin.from('email_threads').delete().eq('user_id', uid);
        await admin.from('contacts').delete().eq('user_id', uid);
        if (acct) await admin.from('email_accounts').delete().eq('id', acct);
        await admin.auth.admin.deleteUser(uid);
      }
    } catch (e3) { problems.push('cleanup failed: ' + (e3?.message || e3)); }
  }
}

if (!problems.length) {
  console.log(`==== AI SUBJECT: clean — every AI-spending function names who it was about or is on the not-about-a-person list; contacts, threads, addresses, lead cards and transactions resolve ====`);
  process.exit(0);
}
console.log(`==== AI SUBJECT: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
