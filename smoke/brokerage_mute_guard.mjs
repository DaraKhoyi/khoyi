// brokerage_mute_guard.mjs — nobody can silence a sender for the whole brokerage without the gate.
//
// Panel (Skeptic + Sentinel), 28 Sep: a brokerage-wide mute drops mail from a
// sender for every agent. The gate (supabase/sql/2026-09-28_brokerage_mute_guard.sql):
// two PRODUCING agents mute it themselves, nobody vouched for it, and it is not
// an address any lead source sends from. Each gate run proves:
//
//   1. A signed-in agent cannot set is_brokerage through the API — insert or update.
//   2. Even the service role cannot mark a sender with only ONE producing agent.
//   3. Even with two producing agents, a lead-source address (zillow) is refused.
//   4. With two producing agents on an ordinary newsletter, it is allowed.
//   5. Every live brokerage-wide mute meets the gate right now.
//
// Uses two throwaway users with agents rows; everything is deleted in `finally`.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SVC) { console.log('==== BROKERAGE MUTE GUARD: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const tag = crypto.randomBytes(4).toString('hex');
const news = `zz-gate-news-${tag}@example.org`, portal = `zz-gate-${tag}@zillow.com`;
const users = [];

async function mkUser(n) {
  const email = `smoke_mute_${n}_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  const id = cu.data.user.id;
  const ag = await admin.from('agents').insert({ user_id: id, auth_user_id: id, name: `ZZ Gate Mute ${n}`, email, production_role: 'producing', active: false }).select('id').single();
  if (ag.error) throw new Error('agents row: ' + ag.error.message);
  users.push({ id, agentId: ag.data.id });
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await c.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;
  return { id, c };
}

try {
  const a = await mkUser('a'), b = await mkUser('b');

  // 1. The browser cannot write the flag.
  let r = await a.c.from('lead_sender_rules').insert({ user_id: a.id, sender: news, kind: 'not_a_lead', is_brokerage: true });
  expect(!!r.error, 'an agent INSERTED a brokerage-wide mute straight through the API');
  r = await a.c.from('lead_sender_rules').insert({ user_id: a.id, sender: news, kind: 'not_a_lead' }).select('id').single();
  expect(!r.error && r.data, `an agent could not add their own ordinary mute (${r.error?.message})`);
  r = await a.c.from('lead_sender_rules').update({ is_brokerage: true }).eq('user_id', a.id).eq('sender', news);
  expect(!!r.error, 'an agent UPDATED their mute to brokerage-wide through the API');

  // 2. One producing agent is not enough, even for the service role.
  r = await admin.from('lead_sender_rules').update({ is_brokerage: true }).eq('user_id', a.id).eq('sender', news);
  expect(!!r.error, 'service role marked a sender brokerage-wide with only ONE producing agent');

  // 4. Two producing agents on a newsletter: allowed.
  await admin.from('lead_sender_rules').insert({ user_id: b.id, sender: news, kind: 'not_a_lead' });
  r = await admin.from('lead_sender_rules').update({ is_brokerage: true }).eq('sender', news).select('id');
  expect(!r.error && (r.data || []).length === 2, `two producing agents could not make a newsletter brokerage-wide (${r.error?.message})`);

  // 3. Two producing agents on a lead-source address: refused.
  await admin.from('lead_sender_rules').insert([{ user_id: a.id, sender: portal, kind: 'not_a_lead' }, { user_id: b.id, sender: portal, kind: 'not_a_lead' }]);
  r = await admin.from('lead_sender_rules').update({ is_brokerage: true }).eq('sender', portal);
  expect(!!r.error, 'a lead-source (zillow) address was made brokerage-wide');

  // 5. Every live brokerage-wide mute meets the gate.
  const m = await admin.rpc('brokerage_mutes');
  const bad = (m.data?.senders || []).filter((s) => !s.meets_gate && s.sender !== news);
  expect(!m.error && bad.length === 0, `live brokerage-wide mutes failing the gate: ${bad.map((s) => s.sender).join(', ') || m.error?.message}`);
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    await admin.from('lead_sender_rules').delete().in('sender', [news, portal]);
    for (const u of users) {
      await admin.from('agents').delete().eq('id', u.agentId);
      await admin.auth.admin.deleteUser(u.id);
    }
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== BROKERAGE MUTE GUARD: clean — the browser cannot set a brokerage-wide mute; one agent or a lead-source address is refused; every live mute meets the gate ====');
  process.exit(0);
}
console.log(`==== BROKERAGE MUTE GUARD: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
