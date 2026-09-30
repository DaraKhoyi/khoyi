// lead_reaches_a_person.mjs — a lead alert reaches a phone, or the ladder skips
// that person; an answer from Gmail counts.
//
// Marguerite (panel), 29 Sep: "Lead concierge ran 530 times and sent zero
// replies … nobody ever told the agent a lead was waiting." True: every alert
// the database sent was refused (401), the ladder offered leads to people with
// no alert device, and answering from Gmail left the card "pending" and could
// get the lead taken away. supabase/sql/2026-09-29_lead_reaches_a_person.sql.
// Each gate run proves, with a throwaway person and no real phone involved:
//
//   1. The key the ladder's alert function uses is ACCEPTED by push-send (a
//      real call through the database, answered 200, not 401), and the alert is
//      recorded in push_log ("no devices" for the throwaway).
//   2. A forged "sb_secret_…" key is refused.
//   3. Reachability: no device → not reachable; a working device → reachable;
//      a refusing device → not reachable. The ladder's next pick is never
//      someone PrismOS cannot reach.
//   4. A lead answered from Gmail: lead_was_acted sees it, and the card closes
//      itself (status handled) — and the ladder checks this before moving a lead.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !ANON || !SVC) { console.log('==== LEAD REACHES A PERSON: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
if (!PAT) {
  if (process.env.CI) { console.log('==== LEAD REACHES A PERSON: skipped (no Management token in CI) ===='); process.exit(0); }
  console.log('==== LEAD REACHES A PERSON: FAILED — set SUPABASE_PAT ===='); process.exit(1);
}
const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
  const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
};
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = crypto.randomBytes(4).toString('hex');
const email = `smoke_reach_${Date.now()}@example.com`;
const leadAddr = `zz.lead.${tag}@example.org`;
let uid = null, acct = null;

try {
  const cu = await admin.auth.admin.createUser({ email, password: 'Pw-' + crypto.randomBytes(9).toString('hex'), email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.data.user.id;

  // 1. The ladder's alert key, through the database, to push-send.
  const [src] = await q(`select pg_get_functiondef('public.notify_lead_escalation'::regproc) d`);
  const keyName = (src.d.match(/decrypted_secrets where name = '([a-z_]+)'/) || [])[1];
  expect(!!keyName, 'could not find which key notify_lead_escalation sends alerts with');
  if (keyName) {
    const [{ id }] = await q(`select net.http_post(url := '${URL_}/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${keyName}')),
      body := jsonb_build_object('user_id','${uid}','title','ZZ smoke ${tag}','tag','smoke-${tag}')) id`);
    let resp = null;
    for (let i = 0; i < 20 && !resp; i++) { await sleep(1500); [resp] = await q(`select status_code, content::text c from net._http_response where id = ${id}`); }
    expect(resp && resp.status_code === 200, `the ladder's alerts are refused by push-send (${resp ? resp.status_code + ' ' + String(resp.c).slice(0, 80) : 'no answer'}) — no lead alert from the database reaches a phone`);
    const log = await admin.from('push_log').select('sent, note').eq('user_id', uid).eq('tag', 'smoke-' + tag);
    expect(log.data?.length === 1 && log.data[0].note === 'no devices', `the alert was not recorded in push_log (${JSON.stringify(log.data)})`);
  }

  // 2. A forged service key is refused.
  const forged = await fetch(`${URL_}/functions/v1/push-send`, { method: 'POST',
    headers: { Authorization: 'Bearer sb_secret_forged_' + tag, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: uid, title: 'forged' }) });
  expect(forged.status === 401, `a forged sb_secret_ key was accepted by push-send (${forged.status})`);

  // 3. Reachability.
  const reach = async () => (await q(`select public.lead_reachable('${uid}') r`))[0].r;
  expect(await reach() === false, 'a person with no alert device reads as reachable');
  must(await admin.from('push_subscriptions').insert({ user_id: uid, endpoint: 'https://example.invalid/zz' + tag, p256dh: 'x', auth: 'x' }), 'sub');
  expect(await reach() === true, 'a person with a working alert device reads as unreachable');
  must(await admin.from('push_subscriptions').update({ last_error: '403 refused' }).eq('user_id', uid), 'sub err');
  expect(await reach() === false, 'a person whose only device refuses alerts reads as reachable');
  const [nx] = await q(`select public.next_lead_agent('{}') a, public.lead_reachable(public.next_lead_agent('{}')) ok`);
  expect(nx.a === null || nx.ok === true, 'the ladder would offer the next lead to someone PrismOS cannot reach');

  // 4. Answered from Gmail.
  acct = must(await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: email, is_active: false }).select('id').single(), 'account').id;
  const seen = new Date(Date.now() - 20 * 60e3).toISOString();
  const card = must(await admin.from('lead_concierge').insert({ user_id: uid, kind: 'lead', status: 'pending', lead_email: leadAddr, lead_name: 'ZZ Lead',
    channel: 'email', source: 'realtor.com', first_seen_at: seen, draft: '' }).select('id').single(), 'card');
  const acted = async () => (await q(`select public.lead_was_acted('${uid}', '${leadAddr}', null, '${seen}') a`))[0].a;
  expect(await acted() === false, 'a lead nobody answered reads as answered');
  must(await admin.from('email_messages_all').insert({ user_id: uid, account_id: acct, provider_message_id: 'zzr' + tag, provider_thread_id: 'zzrt' + tag,
    from_address: email, to_addresses: [{ email: leadAddr, name: null }], direction: 'outbound', subject: 'Re: your inquiry', labels: ['SENT'],
    internal_date: new Date(Date.now() - 12 * 60e3).toISOString() }), 'reply');
  expect(await acted() === true, 'an answer sent from Gmail does not count as answering the lead');
  await q(`select public.stamp_first_response()`);
  const after = (await admin.from('lead_concierge').select('status, first_response_at').eq('id', card.id).single()).data;
  expect(after?.status === 'handled' && after?.first_response_at, `a lead answered from Gmail still shows as waiting (${JSON.stringify(after)})`);
  const [esc] = await q(`select pg_get_functiondef('public.escalate_stale_leads'::regproc) d`);
  const iActed = esc.d.indexOf('lead_was_acted('), iMove = esc.d.indexOf("route_lead(r.lead_id, 'no response in time')");
  expect(iActed > 0 && iActed < iMove, 'the ladder can move a lead away from an agent who already answered it by email or phone');
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    if (uid) {
      await admin.from('lead_concierge').delete().eq('user_id', uid);
      await admin.from('email_messages_all').delete().eq('user_id', uid);
      await admin.from('push_subscriptions').delete().eq('user_id', uid);
      await admin.from('push_log').delete().eq('user_id', uid);
      if (acct) await admin.from('email_accounts').delete().eq('id', acct);
      await admin.auth.admin.deleteUser(uid);
    }
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== LEAD REACHES A PERSON: clean — ladder alerts are accepted and logged, forged keys refused, only reachable people get leads, a Gmail answer closes the card ====');
  process.exit(0);
}
console.log(`==== LEAD REACHES A PERSON: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
