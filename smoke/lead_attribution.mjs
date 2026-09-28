// lead_attribution.mjs — every closing is tied to its client and where they came from, correctly.
//
// closing_attribution() (supabase/sql/2026-09-28_lead_attribution.sql) answers
// "where did this deal come from, and how fast was the client answered?" from
// the Gold Report's CLIENT NAME / CLIENT Email (and Lead Source, when the sheet
// has it) plus what PrismOS itself recorded. A wrong answer here would steer
// the brokerage's lead-source spending, so each gate run plants known closings
// in 1999 (outside every live window) and checks the answers:
//
//   A. email matches a company lead -> "Company lead", 4-minute reply, PrismOS saw it first
//   B. the sheet says "Open house" but PrismOS has a Zillow card -> the agent's word wins
//   C. no email; the name matches the agent's contact in a Sphere prospecting system -> "Sphere"
//   D. the only record is dated AFTER the closing -> no source (never back-dated)
//   E. a signed-in person who is not staff and not the agent sees none of it
//
// Everything planted is deleted in `finally`. Needs SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SVC) { console.log('==== LEAD ATTRIBUTION: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const tag = crypto.randomBytes(3).toString('hex');
const email = `smoke_attr_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
let uid = null;
const made = { bt: [], bl: [], lc: [], c: [], lg: [] };
const must = (res, what) => { if (res.error) throw new Error(what + ': ' + res.error.message); return res.data; };

try {
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.data.user.id;

  const tx = (n, extra) => ({ year: 1999, trans_id: 990000 + n, source_tab: 'smoke gate', agent_name_raw: 'ZZ Gate Agent', kind: 'sale',
    buy_side: true, gross_sale: 300000, gross_commission: 9000, date_paid: '1999-06-01', address: `${n} Gate St`, ...extra });
  const bts = must(await admin.from('brokerage_transactions').insert([
    tx(1, { buyer_name: 'Zzalpha Person', client_email: `a.${tag}@example.com` }),
    tx(2, { buyer_name: 'Zzbravo Person', client_email: `b.${tag}@example.com`, lead_source: 'Open house' }),
    tx(3, { buyer_name: `Zzcarol Quinnby${tag}` }),
    tx(4, { buyer_name: 'Zzdelta Person', client_email: `d.${tag}@example.com` }),
  ]).select('id, trans_id'), 'plant closings');
  made.bt = bts.map((r) => r.id);
  const byTid = Object.fromEntries(bts.map((r) => [r.trans_id, r.id]));

  // A: a company lead, answered in 4 minutes. Status dismissed so no router touches it.
  made.bl = must(await admin.from('brokerage_leads').insert({ received_by: uid, received_at: '1999-02-01T15:00:00Z', first_response_at: '1999-02-01T15:04:00Z',
    source: 'realtor.com', lead_name: 'Zzalpha Person', lead_email: `a.${tag}@example.com`, status: 'dismissed', origin: 'company' }).select('id'), 'plant company lead').map((r) => r.id);
  // B: a Zillow lead card (archived: nothing works it). D: a card dated AFTER the closing.
  made.lc = must(await admin.from('lead_concierge').insert([
    { user_id: uid, kind: 'lead', status: 'archived', source: 'Zillow', lead_name: 'Zzbravo Person', lead_email: `b.${tag}@example.com`, first_seen_at: '1999-01-15T12:00:00Z', first_response_at: '1999-01-15T12:30:00Z' },
    { user_id: uid, kind: 'lead', status: 'archived', source: 'Zillow', lead_name: 'Zzdelta Person', lead_email: `d.${tag}@example.com`, first_seen_at: '1999-07-01T12:00:00Z' },
  ]).select('id'), 'plant lead cards').map((r) => r.id);
  // C: the agent's own contact, filed under a Sphere prospecting system, no email on the closing.
  made.lg = must(await admin.from('lead_gen_systems').insert({ user_id: uid, name: 'Sphere of Influence (SOI) & Referral Networks', category: 'traditional', is_active: false })
    .select('id'), 'plant prospecting system').map((r) => r.id);
  made.c = must(await admin.from('contacts').insert({ user_id: uid, name: `Zzcarol Quinnby${tag}`, type: 'lead', lead_gen_system_id: made.lg[0], created_at: '1999-03-01T12:00:00Z' })
    .select('id'), 'plant contact').map((r) => r.id);

  const rows = must(await admin.rpc('closing_attribution', { p_from: '1999-01-01', p_to: '1999-12-31' }), 'closing_attribution');
  const row = (n) => rows.find((r) => r.transaction_id === byTid[990000 + n]) || {};
  expect(rows.length >= 4, `expected the 4 planted closings, got ${rows.length}`);

  const a = row(1);
  expect(a.source_bucket === 'Company lead', `A: bucket ${a.source_bucket}, expected Company lead`);
  expect(a.minutes_to_first_reply === 4, `A: speed to lead ${a.minutes_to_first_reply}, expected 4`);
  expect(a.prismos_saw_first === true && a.has_client === true, 'A: should be a known client PrismOS saw first');

  const b = row(2);
  expect(b.source_bucket === 'Open house' && b.stated_source === 'Open house', `B: the agent's Gold Report source must win (got ${b.source_bucket})`);
  expect(b.found_source === 'Zillow' && b.minutes_to_first_reply === 30, `B: PrismOS's own record should still show (found ${b.found_source}, ${b.minutes_to_first_reply} min)`);

  const c = row(3);
  expect(c.source_bucket === 'Sphere' && c.found_how === 'contact' && c.contact_id === made.c[0], `C: name match to the Sphere contact failed (${c.source_bucket}, ${c.found_how})`);

  const d = row(4);
  expect(d.source_bucket == null && d.prismos_saw_first === false, `D: a record dated after the closing was used (${d.source_bucket})`);

  // E: an ordinary signed-in person (not staff, not the agent) sees nothing.
  const person = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await person.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;
  const seen = await person.rpc('closing_attribution', { p_from: '1999-01-01', p_to: '1999-12-31' });
  expect(!seen.error && Array.isArray(seen.data) && seen.data.length === 0, `E: a non-staff person saw ${seen.data ? seen.data.length : seen.error?.message} closings`);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const an = await anon.rpc('closing_attribution', { p_from: '1999-01-01', p_to: '1999-12-31' });
  expect(an.error || (Array.isArray(an.data) && an.data.length === 0), 'E: a stranger with the public key saw closings');

  // The brokerage summary runs.
  const sum = await admin.rpc('lead_attribution', { p_days: 90 });
  expect(!sum.error && sum.data && Array.isArray(sum.data.by_source), `lead_attribution failed: ${sum.error?.message}`);
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    if (made.bt.length) await admin.from('brokerage_transactions').delete().in('id', made.bt);
    await admin.from('brokerage_transactions').delete().eq('year', 1999).eq('source_tab', 'smoke gate');
    if (made.bl.length) await admin.from('brokerage_leads').delete().in('id', made.bl);
    if (uid) {
      await admin.from('lead_concierge').delete().eq('user_id', uid);
      await admin.from('contacts').delete().eq('user_id', uid);
      await admin.from('lead_gen_systems').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== LEAD ATTRIBUTION: clean — company lead, agent\'s own word, name match and after-the-fact records all attributed correctly; non-staff see nothing ====');
  process.exit(0);
}
console.log(`==== LEAD ATTRIBUTION: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
