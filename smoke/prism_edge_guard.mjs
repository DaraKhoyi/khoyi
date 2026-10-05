// prism_edge_guard.mjs — a starting guess the person can see and change; never a verdict.
//
// Dara, 4 Oct 2026: tune how much each person is shown to their behavioural style
// and Grit. Decisions 1, 2, 3 and 9: results are seen by the agent, the Broker and
// Broker admins; never used for leads, recognition or retention; the test is an
// invitation; and the tuning is a guess, with no scientific claim.
// Holds: (static) the test says who sees the results BEFORE the first question
// and cannot begin without a tick; results can be removed; no screen calls anyone
// "low grit"; no lead, routing or roster job reads the presentation settings.
// (live, a throwaway person) with no results the settings are the standard ones;
// a guess fills in only what was not set by hand; a hand-set value is never
// moved by a later guess; a result that looks too good to be true changes
// nothing; removing results removes them. BLOCKS.
import { readFileSync, readdirSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

const test = read('src/views/DiscAssessmentView.jsx');
expect(/data-testid="assessment-consent"/.test(test) && /you, your Broker, and the Broker’s admins/.test(test), 'the assessment no longer says who can see the results before it starts');
expect(/disabled=\{!name\.trim\(\) \|\| !agreed\}/.test(test), 'the assessment can begin without the person acknowledging who sees it');
expect(/never used for:<\/strong> deciding who gets leads, recognition, or whether anyone stays/.test(test), 'the assessment no longer says what results are never used for');
expect(/rpc\('delete_my_assessment'\)/.test(test), 'a person can no longer remove their results');
for (const f of readdirSync('src/views').filter((x) => /\.jsx?$/.test(x))) {
  const t = read('src/views/' + f).split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n');
  if (/low[- ]grit|low drive|lacks? grit/i.test(t)) problems.push(`${f} labels a person by their Drive result`);
}
// Dara, 5 Oct 2026: the results page says it in words; the numbers only on request.
expect(/data-testid="show-my-numbers"/.test(test) && /function DriveWords/.test(test), 'the results page no longer offers the numbers on request');
expect(!/Drive \{res\.drive\?\.overall\}\/100<\/span><\/div>/.test(test) && /\{nums \? <span data-testid="drive-overall">/.test(test), 'the results page shows the Drive number without being asked');
{ const ro = test.slice(test.indexOf('function buildReadout'), test.indexOf('COMPONENT'));
  expect(!/out of 100|pressure point|\$\{low1\[1\]\}|\$\{low2\[1\]\}|\$\{drive\.overall\}|\$\{maxGap\}/.test(ro), 'the written read states a score or names a "pressure point"');
  expect(/never state a score/.test(read('supabase/functions/disc-readout/index.ts')), 'the AI-written read is no longer told to leave the numbers out'); }
const guessSql = read('supabase/sql/2026-10-05_item18_decisions.sql');
expect(!/drive|overall/i.test(guessSql.slice(guessSql.indexOf('create or replace function public.apply_presentation_guess'), guessSql.indexOf('revoke all on function public.apply_presentation_guess')).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')), 'the starting guess reads the Drive result again');
const panel = read('src/views/PresentationPanel.jsx');
expect(/not a finding/.test(panel) && /your choice always wins/i.test(panel), 'the settings no longer say the tuning is a guess the person can override');
expect(!/drive|grit|\bDISC\b|overall/i.test(panel.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'the presentation settings name a score or a trait');
// Decision 2: nothing that routes leads or ranks people reads these settings or the results.
for (const dir of readdirSync('supabase/functions')) {
  if (!/^(lead-|orchestr|roster|agent-research|new-lead)/.test(dir)) continue;
  let t = ''; try { t = read(`supabase/functions/${dir}/index.ts`); } catch (_) { continue; }
  if (/disc_assessments|presentation_of|\.presentation\b|drive->|natural_scores/.test(t)) problems.push(`${dir} reads assessment results or presentation settings — decision 2 forbids it`);
}

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
    const email = `smoke_edge_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    return { id, tok };
  };
  try {
    const a = await person('a'), b = await person('b');
    const rpc = async (tok, f, args = {}) => (await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })).json();
    const take = async (who, natural, drive) => { const x = await fetch(`${URL_}/rest/v1/disc_assessments`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${who.tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: who.id, agent_name: 'Smoke', natural_scores: natural, adaptive: natural, drive }) }); if (!x.ok) throw new Error('assessment: ' + (await x.text()).slice(0, 140)); };

    let p = await rpc(a.tok, 'my_presentation');
    expect(p.basis === 'standard' && p.today_items === 3 && p.evening_prompt === true && p.daily_goal_count === 3, 'a new person does not start on the standard settings');
    let g = await rpc(a.tok, 'apply_presentation_guess');
    expect(g.ok === true && g.guessed === false && g.basis === 'standard', 'with no results, a guess was made anyway');

    // the person sets one thing by hand; then takes the assessment
    await rpc(a.tok, 'set_presentation', { p_key: 'today_items', p_value: '3' });
    await take(a, { D: 20, I: 30, S: 70, C: 55 }, { overall: 38, sub: { E: 40, R: 35, D: 38, F: 39 }, distortionHits: 0 });
    g = await rpc(a.tok, 'apply_presentation_guess');
    expect(g.guessed === true && g.basis === 'style', 'results were saved and no starting guess was made');
    expect(g.tips_pace === 'balanced', 'the guess did not fill in a setting the person had not touched');
    expect(g.today_items === 3, 'a later guess MOVED a setting the person had set by hand');
    // Dara, 5 Oct 2026: Drive results change nothing about how much a person is shown.
    expect(g.daily_goal_count === 3 && g.today_items === 3, 'a Drive result changed how many goals or items a person is shown');
    await rpc(a.tok, 'set_presentation', { p_key: 'daily_goal_count', p_value: '4' });
    g = await rpc(a.tok, 'apply_presentation_guess');
    expect(g.daily_goal_count === 4, 'the person chose four goals and a guess changed it back');
    expect((await rpc(a.tok, 'set_presentation', { p_key: 'today_items', p_value: '9' })).ok === false, 'set_presentation accepts a value no screen obeys');

    // too good to be true: nothing changes
    await take(b, { D: 60, I: 60, S: 60, C: 60 }, { overall: 20, sub: {}, distortionHits: 4 });
    const gb = await rpc(b.tok, 'apply_presentation_guess');
    expect(gb.today_items === 3 && gb.daily_goal_count === 3, 'a result flagged as too good to be true still changed how much the person is shown');
    expect(!JSON.stringify(await rpc(b.tok, 'my_presentation')).includes('38'), 'one person can see something of another person\'s results');

    // removal
    const del = await rpc(a.tok, 'delete_my_assessment');
    expect(del.ok === true && del.removed === 1, 'a person could not remove their results');
    expect(Number((await q(`select count(*) n from disc_assessments where user_id = '${a.id}'`))[0].n) === 0, 'removed results are still stored');
    p = await rpc(a.tok, 'my_presentation');
    expect(p.basis === 'standard' && p.daily_goal_count === 4, 'removing results did not forget the guess, or lost the person\'s own choices');
    const anon = await rpc(ANON, 'my_presentation');
    expect(anon.code || Object.keys(anon).length === 0, 'a signed-out caller can read presentation settings');
    if (!problems.length) console.log('prism_edge_guard: live — standard by default; a guess fills only untouched settings; hand-set values hold; suspect results change nothing; results removable');
  } catch (e) { problems.push('live check could not run: ' + String(e).slice(0, 200)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('prism_edge_guard: live check not run (needs SUPABASE_URL, keys and SUPABASE_PAT)');

if (problems.length) {
  console.log(`==== PRISM EDGE: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== PRISM EDGE: clean — consent before the first question; a visible, editable starting guess; no labels; nothing feeds lead routing ====');
