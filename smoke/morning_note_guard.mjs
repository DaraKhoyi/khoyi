// morning_note_guard.mjs — the morning note is short, and never a count.
//
// Until 4 Oct 2026 every person with a phone set up got this at 8am:
//   "Today: 53 emails worth a look · 25 owed replies · 84 going cold. Tap to handle."
// Dara had switched his briefing off: "Overwhelmed by all the stuff."
// Holds: (live) the job that runs no longer builds counts of mail, replies or
// contacts; for a throwaway person the note asks the question when no goals are
// chosen and says the goals in the person's own words when they are; it names a
// closing that is three days out; the person can turn it off and move its hour;
// nonsense hours are refused. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const sql = readFileSync('supabase/sql/2026-10-04f_short_morning_note.sql', 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
expect(!/worth a look|owed repl|going cold|v_cold|v_owe|v_leads/.test(sql), 'the morning note counts mail, replies or contacts again');
expect(/coalesce\(us\.morning_note, true\)/.test(sql) && /morning_note_hour/.test(sql), 'the morning note ignores the person\'s own switch or hour');

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
  const email = `smoke_note_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  let uid = null;
  try {
    const live = (await q(`select pg_get_functiondef('public.morning_brief_run(uuid)'::regprocedure) d`))[0].d;
    expect(!/going cold|owed repl|worth a look/.test(live), 'the LIVE 8am job still sends counts of mail, replies and cold contacts');
    uid = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!uid) throw new Error('no throwaway user');
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    const rpc = async (f, args = {}, bearer = tok) => (await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })).json();
    const svc = async (t, row) => { const x = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await x.json(); if (!x.ok) throw new Error(t + ': ' + JSON.stringify(j).slice(0, 160)); return j[0]; };
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const plus = (n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const note = async () => (await q(`select public.morning_note_for('${uid}', 'America/New_York') n`))[0].n;

    let n = await note();
    expect(/What three things would make today a win\?$/.test(n.headline), 'with no goals chosen the note does not ask the question: ' + n.headline);
    await svc('deals', { user_id: uid, name: 'Smoke soon', side: 'buyer', address: '9 Smoke Ave', close_date: plus(3), status: 'under_contract' });
    await svc('day_goals', { user_id: uid, day, text: 'Maria knows where her loan stands' });
    await svc('contacts', { user_id: uid, name: 'Cold Smoke', cadence_days: 30 });
    n = await note();
    expect(/Your goals: Maria knows where her loan stands/.test(n.headline), 'the note does not say the goals in the person\'s own words: ' + n.headline);
    expect(/Closing is .* — 9 Smoke Ave/.test(n.headline), 'the note does not name a closing three days out: ' + n.headline);
    expect(!/\b\d+\s+(emails?|owed|repl|people|going cold|contacts?)\b/i.test(n.headline), 'the note carries a count: ' + n.headline);
    const card = await rpc('morning_brief_today');
    expect(card && card.headline === n.headline, 'the card on Today and the notification say different things');
    let r = await rpc('set_morning_note', { p_on: false, p_hour: null });
    expect(r && r.ok === true && r.on === false, 'a person cannot turn the morning note off');
    r = await rpc('set_morning_note', { p_on: true, p_hour: 6 });
    expect(r && r.hour === 6, 'a person cannot move the morning note');
    expect((await rpc('set_morning_note', { p_on: null, p_hour: 22 })).ok === false, 'the morning note accepts an evening hour');
    const anon = await rpc('morning_brief_today', {}, ANON);
    expect(anon === null || anon?.code, 'a signed-out caller gets a morning note');
    if (!problems.length) console.log('morning_note_guard: live — the question or the goals, a contract date, no counts; the person\'s own switch and hour');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 200)); }
  finally { if (uid) await fetch(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('morning_note_guard: live check not run (needs SUPABASE_URL, keys and SUPABASE_PAT)');

if (problems.length) {
  console.log(`==== MORNING NOTE: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== MORNING NOTE: clean — first appointment, contract dates, the person\'s goals; never a count ====');
