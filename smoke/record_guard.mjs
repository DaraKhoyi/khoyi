// record_guard.mjs — nothing disappears without a line the person can read and undo.
//
// Dara, 4 Oct 2026: "not having things disappear without our knowledge… I would
// like to know about things that might have been done to help me, but resulted in
// important things being missed." Ray: no list of what I let down.
// Holds: (static) the call reader writes down what it leaves out; the page shows
// lines, not counts. (live, with a throwaway person signed in for real) the record
// lists a set-aside follow-up and a left-out suggestion with a reason; the one
// with money in it is offered for a second look; "bring it back" puts each on the
// review list; "remove" takes a line away; a stranger sees nothing. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const fn = read('supabase/functions/call-commitments/index.ts');
for (const r of ['conditional', 'in_the_moment', 'vague', 'not_owed_to_agent', 'unknown_person', 'duplicate'])
  expect(new RegExp(`await leave\\(c, "${r}"\\)`).test(fn), `call-commitments drops "${r}" suggestions without writing them down`);
expect(!/skipped\.\w+\+\+; continue;/.test(fn), 'call-commitments has a drop path that only counts');
expect(/from\("dropped_suggestions"\)\.upsert\(dropped/.test(fn), 'call-commitments no longer saves what it left out');
const page = read('src/views/DoneForYou.jsx');
expect(/rpc\('the_record'/.test(page) && /'the_record_undo'/.test(page) && /'the_record_mark'/.test(page), 'DoneForYou no longer shows the itemised record');
expect(!/second_look\.length\}|items\.length\} (set|left|thing)/.test(page), 'the record page renders a total');
const sql = read('supabase/sql/2026-10-04b_the_record.sql');
expect(/if v_uid is null then return/.test(sql), 'the_record no longer refuses a signed-out caller first');
expect(/Kept for a year, then removed/.test(page) && /select 365/.test(readFileSync('supabase/sql/2026-10-05_item18_decisions.sql', 'utf8')), 'the record no longer says how long set-aside items are kept');

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
  const email = `smoke_record_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  let uid = null;
  try {
    uid = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!uid) throw new Error('no throwaway user');
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    const ins = async (t, row) => { const r = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await r.json(); if (!r.ok) throw new Error(t + ': ' + JSON.stringify(j).slice(0, 160)); return j[0]; };
    const rpc = async (f, args, bearer = tok) => { const r = await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); return r.json(); };
    const get = async (path) => (await fetch(`${URL_}/rest/v1/${path}`, { headers: H })).json();
    const c = await ins('commitments', { user_id: uid, owner: 'me', title: 'Smoke: send the wire instructions for the deposit', quote: 'I will send the wire instructions.', status: 'expired', fuse: 'near', stakes: 'high', created_at: new Date(Date.now() - 16 * 864e5).toISOString(), auto_expired_at: new Date(Date.now() - 864e5).toISOString() });
    const d = await ins('dropped_suggestions', { user_id: uid, owner: 'them', owner_name: 'Smoke Person', title: 'Smoke: send the staging quote over', quote: 'if I get it I will send it', reason: 'conditional', dedupe_key: 'smoke-' + Date.now() });
    const plain = await ins('dropped_suggestions', { user_id: uid, owner: 'them', title: 'Smoke: an ordinary thing to remove later', quote: 'I will check right now', reason: 'in_the_moment', dedupe_key: 'smoke2-' + Date.now() });

    // Dara, 5 Oct 2026: kept for a year, then removed — and the removal is said.
    const old = await ins('commitments', { user_id: uid, owner: 'me', title: 'Smoke: set aside thirteen months ago', quote: 'old', status: 'expired', fuse: 'near', created_at: new Date(Date.now() - 400 * 864e5).toISOString(), auto_expired_at: new Date(Date.now() - 366 * 864e5).toISOString() });
    const young = await ins('commitments', { user_id: uid, owner: 'me', title: 'Smoke: set aside eleven months ago', quote: 'young', status: 'expired', fuse: 'near', created_at: new Date(Date.now() - 360 * 864e5).toISOString(), auto_expired_at: new Date(Date.now() - 330 * 864e5).toISOString() });
    await fetch(`${URL_}/rest/v1/rpc/remove_old_set_aside`, { method: 'POST', headers: H, body: '{}' });
    const left = await get(`commitments?user_id=eq.${uid}&select=id`);
    expect(!left.some((x) => x.id === old.id), 'a follow-up set aside more than a year ago was not removed');
    expect(left.some((x) => x.id === young.id) && left.some((x) => x.id === c.id), 'the yearly removal took something set aside less than a year ago');
    const anonTry = await fetch(`${URL_}/rest/v1/rpc/remove_old_set_aside`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}' });
    expect(!anonTry.ok, 'a signed-in person can run the yearly removal themselves');

    let rec = await rpc('the_record', { p_limit: 20, p_before: null, p_second: 5 });
    expect((rec.items || []).some((x) => x.src === 'tidy' && /set aside more than a year ago/.test(x.what)), 'the yearly removal happened without a line in the record');
    const has = (list, id) => (list || []).some((x) => x.id === id);
    expect(has(rec.items, c.id) && has(rec.items, d.id), 'the record does not list a set-aside follow-up and a left-out suggestion');
    expect((rec.items || []).every((x) => x.what && x.why && x.at), 'a record line is missing what, why or when');
    expect(has(rec.second_look, c.id), 'a set-aside follow-up with money in it is not offered for a second look');
    expect(!Object.keys(rec).some((k) => /count|total|^n$/.test(k)), 'the record returns a total');
    const stranger = await rpc('the_record', { p_limit: 8, p_before: null, p_second: 5 }, ANON);
    expect(!(stranger.items || []).length && !(stranger.second_look || []).length, 'a signed-out caller can read a record');

    await rpc('the_record_undo', { p_src: 'commitment', p_id: c.id });
    await rpc('the_record_undo', { p_src: 'dropped', p_id: d.id });
    await rpc('the_record_mark', { p_src: 'dropped', p_id: plain.id, p_mark: 'removed' });
    const back = await get(`commitments?user_id=eq.${uid}&status=eq.proposed&select=id,title,auto_expired_at`);
    expect(back.some((x) => x.id === c.id), '"bring it back" did not return a set-aside follow-up to the review list');
    expect(back.some((x) => /staging quote/.test(x.title)), '"pick up" did not turn a left-out suggestion into a suggestion');
    expect(back.every((x) => x.auto_expired_at), 'something brought back by hand can be set aside by the clock again');
    rec = await rpc('the_record', { p_limit: 8, p_before: null, p_second: 5 });
    expect(!has(rec.items, c.id) && !has(rec.items, d.id), 'a line that was brought back is still in the record');
    expect(!has(rec.items, plain.id), '"remove" did not take a line out of the record');
    if (!problems.length) console.log('record_guard: live — listed, flagged, brought back, removed, and closed to strangers');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 160)); }
  finally { if (uid) await fetch(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('record_guard: live check not run (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY)');

if (problems.length) {
  console.log(`==== THE RECORD: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== THE RECORD: clean — every automatic action is a line with a reason and a way back; no totals ====');
