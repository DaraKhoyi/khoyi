// triage_guard.mjs — one rule decides when a notification may reach a phone; and
// what PrismOS learns from a person can be read, forgotten and started over.
//
// 4 Oct 2026: the broker's phone was receiving "N people are waiting on you" up
// to 319 TIMES A DAY. The reply reminder's "one an hour" limit recorded the time
// with an UPDATE on a row his account did not have, so it never held. He had
// said why his briefing was off: "Overwhelmed by all the stuff."
// Holds: (static) every system push asks push_gate(); the limit is an upsert.
// (live, throwaway people signed in for real) in quiet hours a reminder is HELD
// and only the latest of a kind is kept; a lead is held too unless the person
// allows it; outside quiet hours a second reply reminder inside the hour is
// SKIPPED; "a few times a day" holds batchable ones; what was held is delivered
// as one; a muted caller, a lesson and a reason can be read back, forgotten and
// reset — by their owner only. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const send = read('supabase/functions/push-send/index.ts');
expect(/rpc\("push_gate"/.test(send) && /from\("push_held"\)\.insert/.test(send), 'push-send no longer asks the gate, or no longer keeps what it holds');
const gs = read('supabase/functions/gmail-sync/index.ts');
expect(!/\.update\(\{ last_push_at/.test(gs) && /\.upsert\(\{ user_id: account\.user_id, last_push_at/.test(gs), 'the reply reminder records its time with an UPDATE again — it never holds for an account with no row');
const cc = read('supabase/functions/call-commitments/index.ts');
expect(/from\("call_reader_mutes"\)/.test(cc) && /putOffLessons\(db, call\.user_id\)/.test(cc), 'the call reader ignores muted callers or put-off reasons');
expect(/<NotifySettings \/>/.test(read('src/views/SettingsView.jsx')) && /<LearnedPanel \/>/.test(read('src/views/SettingsView.jsx')), 'Settings lost the notification settings or the learned page');
expect(/<ScopeAsk /.test(read('src/App.js')), 'the scope question is not mounted');

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY, PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (URL_ && SVC && ANON && PAT) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
  const q = async (sqlText) => {
    for (let i = 0; i < 6; i++) {
      const x = await fetch('https://api.supabase.com/v1/projects/xlgfspnojjgvkuitcoaf/database/query', { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sqlText }) });
      if (x.ok) return x.json();
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    throw new Error('query failed');
  };
  const made = [];
  const person = async (tag) => {
    const email = `smoke_triage_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, tok };
  };
  try {
    const a = await person('a'), b = await person('b');
    const rpc = async (tok, f, args = {}) => (await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })).json();
    const rest = async (tok, method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }); return { ok: r.ok, json: await r.json().catch(() => null) }; };
    const push = async (tag, title = 'Smoke ' + tag) => (await fetch(`${URL_}/functions/v1/push-send`, { method: 'POST', headers: { Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: a.id, title, body: 'smoke', tag }) })).json();
    const set = (args) => rpc(a.tok, 'set_notify', { p_mode: null, p_digest_hours: null, p_quiet_start: null, p_quiet_end: null, p_urgent_breaks_quiet: null, ...args });
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    const held = async () => (await q(`select tag_class, title from push_held where user_id = '${a.id}' and delivered_at is null order by created_at`));

    // ── quiet hours, set to cover right now ──
    let r = await set({ p_quiet_start: hour, p_quiet_end: (hour + 2) % 24, p_urgent_breaks_quiet: false });
    expect(r && r.ok === true && r.quiet_start === hour, 'a person cannot set their own quiet hours');
    r = await push('owe-reply', 'Smoke first');
    expect(r && /quiet hours/.test(String(r.held || '')), 'in quiet hours a reply reminder was not held: ' + JSON.stringify(r).slice(0, 120));
    await push('owe-reply', 'Smoke second');
    let h = await held();
    expect(h.length === 1 && h[0].title === 'Smoke second', 'held reminders pile up instead of keeping the latest of a kind');
    r = await push('lead-11111111-2222-3333-4444-555555555555');
    expect(r && r.held, 'the person said no leads in quiet hours and one came through');
    r = await push('briefing');
    expect(r && !r.held && !r.skipped, 'the daily briefing, sent at the time the person chose, was held by quiet hours');
    await set({ p_urgent_breaks_quiet: true });
    r = await push('lead-11111111-2222-3333-4444-555555555555');
    expect(r && !r.held && !r.skipped, 'the person allowed leads in quiet hours and one was still held');

    // ── quiet hours off: the hourly limit, held by the gate for every sender ──
    await set({ p_quiet_start: 3, p_quiet_end: 3, p_urgent_breaks_quiet: false });
    r = await push('owe-reply');
    expect(r && !r.held && !r.skipped, 'outside quiet hours a first reply reminder did not go: ' + JSON.stringify(r).slice(0, 120));
    r = await push('owe-reply');
    expect(r && /one reply reminder an hour/.test(String(r.skipped || '')), 'a SECOND reply reminder inside the hour was not skipped — this is the 319-a-day bug');

    // ── a few times a day ──
    r = await set({ p_mode: 'digest', p_digest_hours: [(hour + 5) % 24] });
    expect(r && r.mode === 'digest', 'a person cannot choose "a few times a day"');
    r = await push('commitments-expiring');
    expect(r && /next update/.test(String(r.held || '')), '"a few times a day" did not hold a batchable notification');
    await q('select public.deliver_held_pushes()');
    h = await held();
    expect(h.some((x) => x.tag_class === 'commitments-expiring'), 'a digest was delivered outside the hours the person chose');
    expect(!h.some((x) => x.tag_class === 'lead'), 'what was held overnight was not delivered once quiet hours ended');
    await set({ p_mode: 'live' });
    expect((await set({ p_digest_hours: [9, 10, 11, 12, 13] })).ok === false && (await set({ p_quiet_start: 30 })).ok === false, 'set_notify accepts nonsense');
    expect(Object.keys(await rpc(ANON, 'my_notify')).length === 0 || (await rpc(ANON, 'my_notify')).code, 'a signed-out caller can read notification settings');

    // ── training: read it, forget a line, start over; owner only ──
    const svc = async (t, row) => { const x = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await x.json(); if (!x.ok) throw new Error(t + ': ' + JSON.stringify(j).slice(0, 160)); return j[0]; };
    const contact = await svc('contacts', { user_id: a.id, name: 'Smoke Caller' });
    const c1 = await svc('commitments', { user_id: a.id, owner: 'them', title: 'Smoke: a thing that was not a thing', status: 'dismissed', not_a_thing_at: new Date().toISOString() });
    expect((await rest(a.tok, 'POST', 'call_reader_mutes', { contact_id: contact.id })).ok, 'a person cannot mute a caller');
    expect(!(await rest(b.tok, 'POST', 'call_reader_mutes', { user_id: a.id, contact_id: contact.id })).ok, 'one person can mute a caller for another');
    await rest(a.tok, 'POST', 'chief_snoozes', { user_id: a.id, source_ref: 'smoke:1', until: '2099-01-01', reason: 'too_small' });
    let L = await rpc(a.tok, 'my_learned');
    expect((L.not_things || []).some((x) => x.id === c1.id) && (L.callers || []).some((x) => x.what === 'Smoke Caller') && (L.put_off || []).some((x) => x.reason === 'too_small'), 'what was learned cannot be read back: ' + JSON.stringify(L).slice(0, 200));
    const Lb = await rpc(b.tok, 'my_learned');
    expect(!(Lb.not_things || []).length && !(Lb.callers || []).length, 'one person can read what PrismOS learned from another');
    expect((await rpc(b.tok, 'forget_learned', { p_src: 'not_thing', p_id: c1.id })) === false, 'one person can forget another person\'s lesson');
    expect((await rpc(a.tok, 'forget_learned', { p_src: 'not_thing', p_id: c1.id })) === true, 'a person cannot forget a lesson');
    const after = (await q(`select status, not_a_thing_at from commitments where id = '${c1.id}'`))[0];
    expect(after.status === 'dismissed' && after.not_a_thing_at === null, 'forgetting a lesson changed the item itself, or did not forget');
    expect((await rpc(a.tok, 'reset_learned', { p_section: 'all' })) === true, 'a person cannot start over');
    L = await rpc(a.tok, 'my_learned');
    expect(!(L.callers || []).length && !(L.put_off || []).length && !(L.not_things || []).length, 'starting over left lessons behind');
    if (!problems.length) console.log('triage_guard: live — quiet hours hold, the hour holds, digests hold and deliver, lessons readable, forgettable, resettable, owner only');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 200)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('triage_guard: live check not run (needs SUPABASE_URL, keys and SUPABASE_PAT)');

if (problems.length) {
  console.log(`==== TRAINING AND TRIAGE: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== TRAINING AND TRIAGE: clean — one gate for every notification; what is learned can be read, forgotten and reset ====');
