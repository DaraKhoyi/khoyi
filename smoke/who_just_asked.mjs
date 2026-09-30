// who_just_asked.mjs — a lead card knows who just asked the moment it lands.
//
// Panel (Simplifier + Marguerite + Newcomer), 30 Sep: "a lead arrives, no brief
// fires, nobody knows if the contact can transact."
// supabase/sql/2026-09-30_who_just_asked.sql + lead-qualify / lead-brief /
// lead-concierge. Each gate run proves, with a throwaway agent:
//
//   1. What PrismOS already knows: a saved contact and an earlier email show
//      as facts; a stranger shows nothing (no padding).
//   2. A Zillow per-buyer relay address is read as the buyer, and a Zillow
//      RENTAL is graded as a rental with the rental question (Yordani, 29 Sep,
//      had no readiness at all, then was graded a buyer).
//   3. lead-brief answers the service (arrival) path and can read its card —
//      it asked for a column that did not exist, so every "Who is this?" tap
//      had failed with "not found".
//   4. The card list carries `brief` and `known`; the concierge puts the facts
//      in the alert and writes the brief on arrival (static).
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

// 4. Static.
const conc = readFileSync('supabase/functions/lead-concierge/index.ts', 'utf8');
expect(/factsLine \|\| draft/.test(conc), 'the lead alert no longer leads with the facts (source, what they want, the question to ask)');
expect(conc.indexOf('/functions/v1/lead-brief') > conc.indexOf('functions.invoke("push-send"'), 'the brief is no longer written on arrival, after the alert');
const card = readFileSync('src/views/LeadConcierge.jsx', 'utf8');
expect(/it\.known/.test(card), 'the lead card no longer shows what PrismOS already knows');

if (!PAT || !URL_ || !SVC) {
  if (!process.env.CI) problems.push('set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_PAT for the live checks');
} else {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
  };
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const tag = crypto.randomBytes(5).toString('hex');
  const known = `zz.known.${tag}@example.org`, stranger = `zz.stranger.${tag}@example.org`;
  const relay = `zz${tag}${crypto.randomBytes(6).toString('hex')}@convo.zillow.com`;
  let uid = null, acct = null;
  try {
    const cu = await admin.auth.admin.createUser({ email: `smoke_who_${Date.now()}@example.com`, password: 'Pw-' + crypto.randomBytes(9).toString('hex'), email_confirm: true });
    if (cu.error) throw cu.error;
    uid = cu.data.user.id;
    const [{ k: svcKey }] = await q(`select decrypted_secret k from vault.decrypted_secrets where name = 'service_role_key'`);

    // 1. Known facts.
    await admin.from('contacts').insert({ user_id: uid, name: 'ZZ Known ' + tag, emails: [{ value: known, is_default: true }], type: 'lead' });
    acct = (await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: `me.${tag}@example.com`, is_active: false }).select('id').single()).data.id;
    await admin.from('email_messages_all').insert({ user_id: uid, account_id: acct, provider_message_id: 'zzw' + tag, provider_thread_id: 'zzwt' + tag,
      from_address: known, direction: 'inbound', subject: 'hello', labels: ['INBOX'], internal_date: new Date(Date.now() - 40 * 864e5).toISOString() });
    const facts = async (e) => (await q(`select public.lead_known_facts('${uid}', '${e}', null, now()) f`))[0].f;
    const kf = await facts(known);
    expect(kf.some((x) => /^Already in your contacts/.test(x)) && kf.some((x) => /^Has written to you 1 time before/.test(x)),
      `what PrismOS knows about a saved contact who wrote before is not shown (${JSON.stringify(kf)})`);
    const sf = await facts(stranger);
    expect(Array.isArray(sf) && sf.length === 0, `a stranger is given "known" facts (${JSON.stringify(sf)})`);

    // 2. Zillow relay + rental.
    const c = (await admin.from('lead_concierge').insert({ user_id: uid, kind: 'lead', status: 'pending', source: 'Zillow', channel: 'email',
      lead_email: relay, lead_name: 'Zz Renter', first_seen_at: new Date().toISOString(),
      inbound_text: `Source: Zillow\nProperty: 1 Zz Way, Wesley Chapel, FL, 33543\nNew message 1 Zz Way, Wesley Chapel, FL, 33543. Zz Renter says: I would like to schedule a tour. Send application Reply` })
      .select('id').single()).data;
    const qr = await fetch(`${URL_}/functions/v1/lead-qualify`, { method: 'POST', headers: { Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: relay, force: true }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    const [rd] = await q(`select public.lead_readiness_for('${relay}', null) r`);
    expect(rd.r && rd.r.intent === 'rent' && /move in/i.test(rd.r.ask_next || ''),
      `a Zillow rental lead is not read as a rental with the move-in question (${JSON.stringify(rd.r || qr).slice(0, 200)})`);

    // 3. lead-brief service path reads its card (no AI: a card with nothing to read).
    const empty = (await admin.from('lead_concierge').insert({ user_id: uid, kind: 'lead', status: 'pending', source: 'Zillow', channel: 'email',
      lead_email: stranger, lead_name: 'Zz Empty', first_seen_at: new Date().toISOString() }).select('id').single()).data;
    const br = await fetch(`${URL_}/functions/v1/lead-brief`, { method: 'POST', headers: { Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: empty.id }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    expect(br.ok === true && br.skipped === 'nothing to read', `lead-brief cannot brief a card on arrival (${JSON.stringify(br).slice(0, 160)})`);

    // 4. The card list carries brief and known.
    const [pd] = await q(`select pg_get_functiondef('public.lead_concierge_pending'::regproc) d`);
    expect(pd.d.includes("'brief', lc.brief") && pd.d.includes("'known'"), 'the lead card list no longer carries the brief and what is known');
    void c;
  } catch (e) {
    problems.push('crashed: ' + (e?.message || e));
  } finally {
    try {
      if (uid) {
        await admin.from('ai_usage_log').delete().eq('user_id', uid);
        await admin.from('lead_concierge').delete().eq('user_id', uid);
        await admin.from('lead_readiness').delete().ilike('email', relay);
        await admin.from('email_messages_all').delete().eq('user_id', uid);
        await admin.from('contacts').delete().eq('user_id', uid);
        if (acct) await admin.from('email_accounts').delete().eq('id', acct);
        await admin.auth.admin.deleteUser(uid);
      }
    } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
  }
}

if (!problems.length) {
  console.log('==== WHO JUST ASKED: clean — known facts shown (and none for strangers), Zillow rentals read as rentals, the brief runs on arrival, the alert carries the facts ====');
  process.exit(0);
}
console.log(`==== WHO JUST ASKED: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
