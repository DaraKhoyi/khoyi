// dial_guard.mjs — a level is only offered where a job obeys it.
//
// Dara, 4 Oct 2026: "I do want to be able to throttle what is being done for me."
// The picker this replaces offered four levels and was read by nothing; an agent
// who chose "Manual" was told nothing acts on its own, and that was not true.
// Holds: (static) every job that acts on its own asks the one rule; the screen
// saves through it. (live, a throwaway person signed in for real) tidying turned
// off means a stale suggestion is NOT set aside; turned back on, it is; pause
// turns every category off and keeps the choices; a level a category does not
// have is refused; a signed-out caller gets nothing; the auto-send path is shut.
// BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const asks = { 'call-commitments': 'call_followups', 'quo-call-process': 'call_followups', 'lead-concierge': 'lead_drafts', 'task-autoschedule': 'calendar' };
for (const [fn, cat] of Object.entries(asks))
  expect(new RegExp(`dialLevel\\(\\w+, [\\w.]+, "${cat}"\\)`).test(read(`supabase/functions/${fn}/index.ts`)), `${fn} acts without asking the dial about ${cat}`);
expect(/dialLevel\(db, userId, "calls_personal"\)/.test(read('supabase/functions/_shared/lessons.ts')), 'the personal-plans rule no longer asks the dial');
expect(/rpc\("dial_level"/.test(read('supabase/functions/_shared/dial.ts')), '_shared/dial.ts no longer asks dial_level()');
const sql = read('supabase/sql/2026-10-04c_the_dial.sql');
expect(/dial_level\(user_id, 'tidy_followups'\) <> 'off'/.test(sql), 'the set-aside job no longer asks the dial');
expect(/dial_level\(c\.user_id, 'tidy_followups'\) = 'tell'/.test(sql), 'the day-before question no longer asks the dial');
const ui = read('src/views/DialSettings.jsx');
expect(/rpc\('set_dial'/.test(ui) && /rpc\('set_dial_paused'/.test(ui) && /rpc\('my_dial'\)/.test(ui), 'the dial screen no longer saves through set_dial()');
expect(!/from\('user_settings'\)\s*\.(update|upsert)/.test(ui), 'the dial screen writes settings directly instead of through set_dial()');
expect(/<DialSettings /.test(read('src/views/SettingsView.jsx')), 'Settings no longer shows the dial');

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
  const email = `smoke_dial_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  let uid = null;
  try {
    uid = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!uid) throw new Error('no throwaway user');
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    const rpc = async (f, args = {}, bearer = tok) => (await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })).json();
    const level = async (cat) => (await q(`select public.dial_level('${uid}', '${cat}') l`))[0].l;
    const status = async () => (await q(`select status from commitments where user_id = '${uid}'`))[0].status;

    // A brand-new person, with no settings row: the defaults, and nothing more.
    expect(await level('tidy_followups') === 'tell' && await level('calendar') === 'off' && await level('calls_personal') === 'off' && await level('call_followups') === 'suggest' && await level('lead_drafts') === 'suggest', 'the defaults for a new person changed');
    await q(`insert into commitments (user_id, owner, title, status, fuse, stakes, created_at) values ('${uid}','me','Smoke: a suggestion nobody answered','proposed','near','normal', now() - interval '20 days')`);

    // Off means off: the clock leaves it alone.
    let r = await rpc('set_dial', { p_cat: 'tidy_followups', p_level: 'off' });
    expect(r && r.ok === true, 'set_dial refused a level the category has');
    await q('select public.expire_short_fuse_commitments()');
    expect(await status() === 'proposed', 'tidying was turned OFF and a suggestion was set aside anyway');
    // Pause beats every choice, and keeps the choice.
    await rpc('set_dial', { p_cat: 'tidy_followups', p_level: 'quiet' });
    r = await rpc('set_dial_paused', { p_paused: true });
    expect(r && r.paused === true, 'pause did not save');
    expect(await level('tidy_followups') === 'off' && await level('call_followups') === 'off' && await level('lead_drafts') === 'off', 'paused, and a category is still on');
    await q('select public.expire_short_fuse_commitments()');
    expect(await status() === 'proposed', 'everything was PAUSED and a suggestion was set aside anyway');
    r = await rpc('set_dial_paused', { p_paused: false });
    expect((r.items || []).find((i) => i.cat === 'tidy_followups')?.level === 'quiet', 'pausing lost the person\'s own choice');
    // On again: now it is set aside.
    await q('select public.expire_short_fuse_commitments()');
    expect(await status() === 'expired', 'tidying is on and a stale suggestion was not set aside');
    // The two older switches are the same setting, not a copy.
    await rpc('set_dial', { p_cat: 'calendar', p_level: 'tell' });
    await rpc('set_dial', { p_cat: 'calls_personal', p_level: 'suggest' });
    const us = (await q(`select auto_schedule_tasks, calls_personal from user_settings where user_id = '${uid}'`))[0];
    expect(us.auto_schedule_tasks === true && us.calls_personal === true, 'the dial and the older switches disagree');
    // Refusals.
    r = await rpc('set_dial', { p_cat: 'calendar', p_level: 'quiet' });
    expect(r && r.ok === false, 'set_dial accepted a level the category does not have');
    r = await rpc('set_dial', { p_cat: 'lead_drafts', p_level: 'tell' });
    expect(r && r.ok === false, 'set_dial would let lead replies be sent without a yes');
    const anon = await rpc('my_dial', {}, ANON);
    expect(!(anon.items || []).length, 'a signed-out caller can read a dial');
    const direct = await rpc('dial_level', { p_user: uid, p_cat: 'calendar' });
    expect(direct && direct.code, 'a signed-in browser can ask about any person\'s dial');
    expect((await q('select public.lead_concierge_autosweep() n'))[0].n === 0, 'the lead auto-send path is open again');
    if (!problems.length) console.log('dial_guard: live — off holds, pause holds, on acts, bad levels refused, strangers refused');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 160)); }
  finally { if (uid) await fetch(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('dial_guard: live check not run (needs SUPABASE_URL, keys and SUPABASE_PAT)');

if (problems.length) {
  console.log(`==== THE DIAL: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== THE DIAL: clean — every level offered is obeyed by the job it names; pause stops everything; nothing is sent without a yes ====');
