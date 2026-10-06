// goals_guard.mjs — the day's goals belong to the person, and are never a score.
//
// Dara, 4 Oct 2026: "pick 3 things from the back log or current items to schedule
// as Goals for the Day." Design brief decisions 7 and 8.
// Holds: (static) the band is on Today above everything inbound; it renders no
// "N of M", no streak, no red. (live, two throwaway people signed in for real)
// a goal is saved and read back by its owner; ANOTHER signed-in person cannot see
// it; a sixth goal in one day is refused; the short list offers a dated task and
// never picks; a closing in three days appears in the contract band and one a
// month out does not; the queue's "choose what happens today" nudge stands down
// once goals exist; a signed-out caller gets nothing. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const today = read('src/views/TodayView.jsx');
expect(today.indexOf('<GoalsBand') > 0 && today.indexOf('<GoalsBand') < today.indexOf('<HandledLine') && today.indexOf('<GoalsBand') < today.indexOf('<LeadConcierge'), 'Goals for the Day is not above what is inbound on Today');
const band = read('src/views/GoalsBand.jsx').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
expect(!/\} of \{|\bstreak\b|done\.length\}\s*\/|#ef4444|var\(--red\)/i.test(band), 'the goals band renders a score, a streak or red');
// Dara, 6 Oct 2026: a suggestion that is already done can be settled on the spot.
for (const id of ['cand-add', 'cand-done', 'cand-delete', 'cand-not']) expect(band.includes(`data-testid="${id}"`), `a suggested goal lost its "${id}" answer — the person can only Add, even when it is already done`);
expect(/c\.src !== 'task' && <button[^>]*data-testid="cand-not"/.test(band), '"Not a thing" is offered on the person\'s own tasks — it is only for follow-ups PrismOS heard on a call');
expect(/dropped_at: now/.test(band) && !/from\('tasks'\)\.delete\(|from\('commitments'\)\.delete\(/.test(band), 'deleting a suggestion erases it — it must be let go and kept, so it can be undone');
expect(/label: 'Undo'/.test(band), 'settling a suggestion can no longer be undone');
expect(/rpc\('goal_candidates'/.test(band) && /rpc\('my_contract_deadlines'/.test(band), 'the goals band lost its short list or the contract-date band');
expect(/data-testid="close-day"/.test(band) && /What got done today/.test(band), 'the end of the day no longer shows what got done first');
const sql = read('supabase/sql/2026-10-04d_goals_for_the_day.sql');
expect(/for all using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/.test(sql), 'day_goals is no longer the person\'s alone');

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
  const made = [];
  const person = async (tag) => {
    const email = `smoke_goals_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, tok };
  };
  try {
    const a = await person('a'), b = await person('b');
    const as = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
    const rest = async (tok, method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: as(tok), body: body ? JSON.stringify(body) : undefined }); return { ok: r.ok, json: await r.json().catch(() => null) }; };
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const plus = (n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const svc = async (t, row) => { const r = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await r.json(); if (!r.ok) throw new Error(t + ': ' + JSON.stringify(j).slice(0, 160)); return j[0]; };

    const task = await svc('tasks', { user_id: a.id, title: 'Smoke: call the lender about the Bayshore file', due_date: plus(-2), eisenhower_quadrant: 'A', completed: false });
    await svc('deals', { user_id: a.id, name: 'Smoke soon', side: 'buyer', address: '1 Smoke St', close_date: plus(3), status: 'under_contract' });
    await svc('deals', { user_id: a.id, name: 'Smoke later', side: 'buyer', address: '2 Smoke St', close_date: plus(30), status: 'under_contract' });

    const queueHasNudge = async () => { const q = await rest(a.tok, 'POST', 'rpc/chief_queue', { p_limit: 60 }); const items = Array.isArray(q.json) ? q.json : (q.json?.items || []); return items.some((i) => i.kind === 'tasks'); };
    expect(await queueHasNudge(), 'with an important task dated earlier and no goals yet, the queue does not offer to choose the day');

    const cands = (await rest(a.tok, 'POST', 'rpc/goal_candidates', { p_day: day })).json;
    expect(Array.isArray(cands) && cands.some((c) => c.id === task.id), 'the short list does not offer a dated, important task');
    expect((await rest(a.tok, 'GET', `day_goals?day=eq.${day}&select=id`)).json.length === 0, 'offering a short list created a goal — PrismOS must never pick');

    const g = await rest(a.tok, 'POST', 'day_goals', { day, text: 'Maria knows where her loan stands', task_id: task.id });
    expect(g.ok && g.json?.[0]?.user_id === a.id, 'a person cannot save their own goal');
    expect((await rest(a.tok, 'GET', `day_goals?day=eq.${day}&select=text`)).json?.[0]?.text === 'Maria knows where her loan stands', 'a goal is not kept in the person\'s own words');
    expect(((await rest(b.tok, 'GET', `day_goals?select=id`)).json || []).length === 0, 'ANOTHER signed-in person can read someone\'s goals');
    expect(!(await rest(b.tok, 'POST', 'day_goals', { user_id: a.id, day, text: 'planted by someone else' })).ok, 'another person can write a goal into someone\'s day');
    for (let i = 0; i < 4; i++) await rest(a.tok, 'POST', 'day_goals', { day, text: 'Smoke goal ' + i });
    expect(!(await rest(a.tok, 'POST', 'day_goals', { day, text: 'a sixth' })).ok, 'a sixth goal in one day was accepted');
    expect(!(await queueHasNudge()), 'the person chose goals and the queue still nags them to choose the day');

    const dl = (await rest(a.tok, 'POST', 'rpc/my_contract_deadlines', { p_days: 7 })).json;
    expect(Array.isArray(dl) && dl.some((d) => d.about === '1 Smoke St') && !dl.some((d) => d.about === '2 Smoke St'), 'the contract band does not show a closing three days out (or shows one a month out)');
    expect(((await rest(b.tok, 'POST', 'rpc/my_contract_deadlines', { p_days: 7 })).json || []).length === 0, 'someone else\'s contract dates are shown to another person');
    const anon = await fetch(`${URL_}/rest/v1/rpc/goal_candidates`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_day: day }) }).then((r) => r.json());
    expect(!Array.isArray(anon) || anon.length === 0, 'a signed-out caller gets a short list');   // refused outright, or empty
    if (!problems.length) console.log('goals_guard: live — own words kept, private to the person, capped at five, offered not picked, contract dates shown, nudge stands down');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 180)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('goals_guard: live check not run (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY)');

if (problems.length) {
  console.log(`==== GOALS FOR THE DAY: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== GOALS FOR THE DAY: clean — the person\'s own, above the inbox, never a score ====');
