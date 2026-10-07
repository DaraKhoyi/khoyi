// closings_guard.mjs — closings that post themselves, and the agent's side.
//
// Dara, 6 Oct 2026 (build prompt, part 5): "Closings post themselves ... A
// flawed sheet row is held for a person, not guessed." "The agent's side
// arrives too ... awaiting their approval. Only this one line crosses." BLOCKS.
//
// Holds:
//  (static) every reason the database can hold a closing for has a plain
//    sentence; a held closing is grouped and says what it needs; the closings
//    report adds up; every function in the SQL names who may run it; the
//    screens never write an entry themselves.
//  (live, two throwaway people) what crossed to a person's own books is theirs
//    alone to see and answer; accepting adds one income entry and only once;
//    "it is this one" adds nothing; a stranger can neither see, sync, switch
//    on nor answer anything about closings in the brokerage's books.
//
// The posting itself runs against the one real brokerage book and the real
// Gold Report, so it cannot be exercised here without touching them. It is
// proven by smoke/closings_trial.sql, run inside a transaction that is rolled
// back (see the header of that file) before any change to the SQL ships.
import { readFileSync } from 'node:fs';
import { PART_TEXT, ROW_REASONS, changeText, closingsTable, groupClosings, partNeeds, postsAsWritten, reasonText, sheetGap, sheetLine } from '../src/closings.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

// ── static ─────────────────────────────────────────────────────────────────
const sql = code('supabase/sql/2026-10-07b_closings.sql');
{ // every reason code the database writes has a sentence of its own
  const codes = new Set();
  for (const m of sql.matchAll(/array\['([a-z_]+)'\]/g)) codes.add(m[1]);
  for (const m of sql.matchAll(/v_row \|\| '([a-z_]+)'::text/g)) codes.add(m[1]);
  expect(codes.size >= 10, `the reasons a closing is held for could not be read from the SQL (${codes.size})`);
  for (const c of codes) expect(reasonText(c, { sheet: {}, note: 'x' }) !== c, `a closing can be held for "${c}" and the screen has no sentence for it`);
  for (const c of ROW_REASONS) expect(codes.has(c), `the screen treats "${c}" as a whole-row reason and the database never gives it`);
}
{ const sheet = { gross: 7950, agent: 6415, office: 1335, referral: null, tc: 150, franchise: 275, received: '2026-01-06', paid: '2026-01-07' };
  expect(sheetGap(sheet) === 50 && /\$50\.00 is not accounted for/.test(reasonText('does_not_add_up', { sheet })), 'a closing that does not add up no longer says by how much');
  expect(sheetGap({ gross: 100, agent: 149 }) === -49 && /more than was received/.test(reasonText('does_not_add_up', { sheet: { gross: 100, agent: 149 } })), 'a closing that pays out more than came in is described wrong');
  expect(/received \$7,950\.00 on Jan 6, 2026/.test(sheetLine(sheet)) && /inside the office fee/.test(sheetLine(sheet)), 'the line that shows what the sheet says lost a figure');
  const rows = [{ id: '2', key: '2026-7', part: 'tc', reasons: ['does_not_add_up', 'who_was_paid'], date: '2026-01-07', category_id: 'c', amount: -150, sheet },
    { id: '1', key: '2026-7', part: 'received', reasons: ['does_not_add_up'], date: '2026-01-06', category_id: 'c', amount: 7950, sheet },
    { id: '3', key: '2026-9', part: 'payout', reasons: ['what_for', 'no_date'], date: null, category_id: null, amount: -500, sheet: null }];
  const g = groupClosings(rows);
  expect(g.length === 2 && g[0].parts.map((p) => p.part).join() === 'received,tc' && g[0].reasons.join() === 'does_not_add_up,who_was_paid', 'held closings are not grouped one closing at a time, commission first');
  expect(postsAsWritten(rows[1]) && !postsAsWritten(rows[0]) && partNeeds(rows[0]).payee && partNeeds(rows[2]).date && partNeeds(rows[2]).category && !partNeeds(rows[2]).twin, 'a held part no longer asks for exactly what is missing');
  expect(partNeeds({ reasons: ['maybe_in_books'], date: '2026-01-01', category_id: 'c' }).twin, 'a possible double is no longer put to a person');
  expect(/\$90\.00 \(the books have \$100\.00\)/.test(changeText({ amount: -100, date: '2026-01-01', part: 'agent', payee: 'A', changed: { amount: -90, date: '2026-01-01', payee: 'A' } })) && /no longer on the Gold Report/.test(changeText({ changed: { gone: true } })), 'a sheet change is not described');
  for (const p of ['received', 'agent', 'referral', 'tc', 'payout', 'other']) expect(!!PART_TEXT[p] && sql.includes(`'${p}'`), `the part "${p}" has no name, or the database no longer makes it`); }
{ const t = closingsTable({ by: 'agent', lines: [{ label: 'A', n: 2, gross: 1000, agent: 800, referral: 0, tc: 0, office: 200, franchise: 50, kept: 150 }, { label: 'B', n: 1, gross: 500.1, agent: 400.1, referral: 0, tc: 0, office: 100, franchise: 25, kept: 75 }] });
  const tot = t.rows.find((r) => r.kind === 'total').cells;
  expect(tot[1] === 3 && tot[2] === 1500.1 && tot[8] === 225 && t.plain.includes(1) && t.rows.some((r) => r.kind === 'note'), `the closings report does not add up: ${JSON.stringify(tot)}`); }
// every function names who may run it (Postgres lets everyone run a new function otherwise)
for (const m of sql.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/g)) expect(new RegExp(`revoke all on function public\\.${m[1]}\\(`).test(sql), `${m[1]}() in the closings SQL does not say who may run it`);
expect(!/is_brokerage_staff\s*\(|app_role\s*\(/.test(sql) && !/create policy (?![^;]*\bto authenticated\b)[^;]*;/.test(sql), 'the closings rules consult staff status, or a policy does not name its role');
expect(/closing_postings_one_entry[^;]*where transaction_id is not null and state = 'posted'/.test(sql), 'one entry can stand for two closings again');
expect(!/grant[^;]*(insert|update|delete)[^;]*(closing_postings|book_arrivals|closing_settings)/i.test(sql), 'the app can write the closings tables directly');
const ui = code('src/views/Closings.jsx') + code('src/views/BookArrivals.jsx');
expect(!/from\('transactions'\)\s*\.\s*(insert|update|delete|upsert)/.test(ui) && !/from\('(closing_postings|book_arrivals|closing_settings)'\)/.test(ui), 'a closings screen writes or reads the tables itself instead of asking the database functions');
expect(!/closing_postings|closings_list/.test(code('src/views/BookArrivals.jsx')), 'the agent\'s side reads the brokerage\'s closings');
expect(/rpc\("closings_sync_all"\)/.test(code('supabase/functions/sheets-sync/index.ts')), 'the nightly Gold Report read no longer brings the books up to it');
expect(/book\.kind === 'brokerage'/.test(code('src/views/BookRoom.jsx')) && /Closings/.test(code('src/views/BookRoom.jsx')), 'the brokerage books lost their Closings tab');

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, status: r.status, json: j }; };
  const svc = call(H);
  const person = async (tag) => {
    const email = `smoke_closings_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, rest: call({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }) };
  };
  try {
    const a = await person('a'), b = await person('b');
    await svc('POST', 'accounting_access', { user_id: a.id, note: 'gate' });
    const bookId = (((await a.rest('POST', 'rpc/my_books', {})).json || {}).books || []).find((x) => x.is_mine)?.id;
    if (!bookId) throw new Error('no personal book');
    // The agent's side. Two things crossed; one of them is already in the books by hand.
    const key = 'gate-' + Date.now();
    const mine = (await a.rest('POST', 'transactions', { book_id: bookId, date: '2026-09-12', amount: 4321.09, scope: 'business', account: 'Checking', payee: 'ROG commission' })).json?.[0]?.id;
    const put = await svc('POST', 'book_arrivals', [{ book_id: bookId, closing_key: key + '-1', entry_date: '2026-09-10', amount: 4321.09, payee: 'Realty ONE Group Advantage', memo: '12 Gate Test Ln' },
      { book_id: bookId, closing_key: key + '-2', entry_date: '2026-09-20', amount: 1500.5, payee: 'Realty ONE Group Advantage', memo: '34 Gate Test Ct' }]);
    if (!put.ok) throw new Error('could not stage arrivals: ' + JSON.stringify(put.json).slice(0, 200));
    const [ar1, ar2] = [put.json.find((x) => x.amount === 4321.09).id, put.json.find((x) => x.amount === 1500.5).id];
    const waiting = (await a.rest('POST', 'rpc/arrivals_waiting', { p_book: bookId })).json || [];
    expect(waiting.length === 2 && waiting.find((w) => w.id === ar1)?.twins?.[0]?.id === mine && (waiting.find((w) => w.id === ar2)?.twins || []).length === 0, `what crossed is not listed, or the entry already in the books is not offered as the same money: ${JSON.stringify(waiting).slice(0, 300)}`);
    // a stranger
    expect(((await b.rest('POST', 'rpc/arrivals_waiting', { p_book: bookId })).json || []).length === 0 && ((await b.rest('GET', `book_arrivals?book_id=eq.${bookId}&select=id`)).json || []).length === 0, 'someone else can see what crossed to a person\'s own books');
    expect(!(await b.rest('POST', 'rpc/arrival_decide', { p_id: ar2, p_action: 'accept', p_account: 'Checking' })).ok && !(await b.rest('POST', 'rpc/arrival_decide', { p_id: ar2, p_action: 'decline' })).ok, 'someone else can answer for a person\'s own books');
    expect(!(await a.rest('POST', 'book_arrivals', { book_id: bookId, closing_key: 'x', entry_date: '2026-01-01', amount: 1 })).ok && !(await a.rest('PATCH', `book_arrivals?id=eq.${ar2}`, { amount: 9 })).ok, 'a person can write the arrivals table directly');
    // answers
    expect(!(await a.rest('POST', 'rpc/arrival_decide', { p_id: ar2, p_action: 'accept', p_account: '  ' })).ok, 'a commission can be added with no account');
    const before = ((await a.rest('GET', `transactions?book_id=eq.${bookId}&is_archived=eq.false&select=id`)).json || []).length;
    const same = await a.rest('POST', 'rpc/arrival_decide', { p_id: ar1, p_action: 'already', p_transaction: mine });
    const acc = await a.rest('POST', 'rpc/arrival_decide', { p_id: ar2, p_action: 'accept', p_account: 'Checking' });
    const after = (await a.rest('GET', `transactions?book_id=eq.${bookId}&is_archived=eq.false&select=id,amount,date,entered_via,tax_category_id,payee`)).json || [];
    const added = after.find((t) => t.id === acc.json?.transaction);
    const cat = added ? (await a.rest('GET', `tax_categories?id=eq.${added.tax_category_id}&select=name,kind`)).json?.[0] : null;
    expect(same.ok && acc.ok && after.length === before + 1 && added && Number(added.amount) === 1500.5 && added.date === '2026-09-20' && added.entered_via === 'deal_close' && cat?.kind === 'income', `accepting a commission did not add exactly one income entry: ${JSON.stringify({ same: same.json, acc: acc.json, n: [before, after.length], cat })}`);
    expect(!(await a.rest('POST', 'rpc/arrival_decide', { p_id: ar2, p_action: 'accept', p_account: 'Checking' })).ok && ((await a.rest('POST', 'rpc/arrivals_waiting', { p_book: bookId })).json || []).length === 0, 'the same commission can be added twice');
    expect(!(await a.rest('POST', 'rpc/arrival_decide', { p_id: ar1, p_action: 'already', p_transaction: '00000000-0000-0000-0000-000000000000' })).ok, 'an answered arrival can be answered again');
    // the brokerage's side, from someone with no seat there
    const brokerage = (await svc('GET', 'books?kind=eq.brokerage&select=id')).json?.[0]?.id;
    if (brokerage) {
      for (const [fn, args] of [['closings_list', { p_book: brokerage }], ['closings_sync', { p_book: brokerage, p_limit: 1 }], ['closings_report', { p_book: brokerage, p_from: null, p_to: null }],
        ['closing_settings_save', { p_book: brokerage, p_on: true, p_deposit: 'x', p_pay: null, p_start: '2026-01-01' }], ['closings_sync_all', {}], ['closing_try_post', { p_posting: ar1, p_same_as: null, p_new: true }],
        ['closing_apply', { p_book: brokerage, p_row: ar1 }], ['arrival_offer', { p_posting: ar1 }], ['arrival_withdraw', { p_key: key + '-1' }]]) {
        expect(!(await a.rest('POST', 'rpc/' + fn, args)).ok, `someone with no seat on the brokerage's books can run ${fn}()`);
      }
      expect(((await a.rest('GET', `closing_postings?select=id&limit=1`)).json || []).length === 0 && ((await a.rest('GET', `closing_settings?select=book_id&limit=1`)).json || []).length === 0 && !(await a.rest('GET', 'closing_seen?select=closing_key&limit=1')).ok,
        'someone with no seat on the brokerage\'s books can read its closings');
    }
    const health = await svc('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run');
    else for (const h of health.json.slice(0, 8)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('closings_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== CLOSINGS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== CLOSINGS: clean — a flawed closing waits with its reason; what crosses to an agent is one line, theirs alone to answer ====');
