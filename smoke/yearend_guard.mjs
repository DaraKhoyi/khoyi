// yearend_guard.mjs — the year-end package, the full export, and getting a
// set of books started.
//
// Dara, 6 Oct 2026 (build prompt, part 5): "Year-end package. One button:
// reports, 1099 list, Schedule C mapping and all receipts, as a bundle for the
// CPA." "Opening balances and history ... so the books are whole from day
// one." "Records retention ... Full export at any time." BLOCKS.
//
// Holds:
//  (static) the Schedule C mapping adds up and never hides an expense that has
//    no line; the bundle's READ ME lists whatever could not be included; the
//    bundle is built from the same report functions as the screen; a stored
//    receipt can no longer be deleted from the app.
//  (live, two throwaway people) the start-up checklist reports each account's
//    starting balance and nothing to a stranger.
// The bundle itself is built in a real browser by smoke/look_yearend.mjs,
// which unpacks it and lists what is inside.
import { readFileSync } from 'node:fs';
import { entriesRows, readMe, scheduleCTable } from '../src/yearEndTables.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

{ const cats = [{ id: 'a', schedule_c_line: 'Line 8' }, { id: 'b', schedule_c_line: '18' }, { id: 'c', schedule_c_line: '(not Schedule C)' }, { id: 'd', schedule_c_line: null }];
  const t = scheduleCTable([{ class: 'income', name: 'Commission', amount: 5000, category_id: 'x' }, { class: 'expense', name: 'Ads', amount: 300.1, category_id: 'a' }, { class: 'expense', name: 'Office', amount: 99.9, category_id: 'b' },
    { class: 'expense', name: 'Gym', amount: 50, category_id: 'c' }, { class: 'expense', name: 'Misc', amount: 25, category_id: 'd' }, { class: 'expense', name: 'No category', amount: 10, category_id: null }, { class: 'held', name: 'Rent held', amount: 900 }], cats);
  const row = (label) => (t.rows.find((r) => r.cells[0] === label) || { cells: [] }).cells;
  expect(row('Gross receipts (Schedule C line 1)')[2] === 5000 && row('Total Line 8')[2] === 300.1 && row('Total Line 18')[2] === 99.9 && row('Expenses on a Schedule C line')[2] === 400
    && t.rows.findIndex((r) => r.cells[0] === 'Line 8') < t.rows.findIndex((r) => r.cells[0] === 'Line 18') && t.rows.some((r) => r.kind === 'note' && /\$85\.00/.test(r.cells[0])) && !JSON.stringify(t).includes('Rent held'),
  `the Schedule C mapping is wrong or hides what has no line: ${JSON.stringify(t.rows.map((r) => r.cells))}`); }
{ const rows = entriesRows([{ id: '1', date: '2026-03-01', amount: '-12.50', account: 'Visa', payee: '=cmd', tax_category_id: 'a', receipt_url: 'p', scope: 'business' }], [{ id: 'a', name: 'Ads' }]);
  expect(rows[0][0] === 'Date' && rows[1][1] === -12.5 && rows[1][6] === 'Ads' && rows[1][9] === 'yes' && rows[1][11] === '1', 'the list of entries lost a column'); }
{ const m = readMe({ title: 'T', year: 2026, counts: { reports: 8, entries: 3, receipts: 1, statements: 2, drives: 0, payees: 1 }, missing: ['receipts: 2026-03-01 Ads could not be fetched'], withFiles: true });
  expect(/WHAT IS NOT HERE\r\n  receipts: 2026-03-01 Ads could not be fetched/.test(m) && /cash basis/.test(m) && /last four digits/.test(m) && /seven years/.test(m), 'the READ ME no longer lists what could not be included');
  expect(/Nothing was left out/.test(readMe({ title: 'T', year: null, counts: { reports: 1, entries: 0, receipts: 0, statements: 0, drives: 0, payees: 0 }, missing: [], withFiles: true })), 'a complete bundle does not say it is complete'); }
const ye = code('src/yearEnd.js');
for (const fn of ['book_pnl', 'book_position', 'book_cash_flow', 'book_trial_balance', 'book_general_ledger', 'book_1099', 'recon_list']) expect(ye.includes(`'${fn}'`), `the bundle no longer includes ${fn}`);
expect(/missing\.push/.test(ye) && /READ ME\.txt/.test(ye) && /storage\.from\(bucket\)\.download/.test(ye) && /statement_imports/.test(ye), 'the bundle no longer carries the receipts and statements, or no longer admits what it could not fetch');
expect(!/payee_reveal_tin|book_1099_file/.test(ye), 'the bundle carries whole tax IDs: those leave only through the owner-only year-end file');
expect(/buildBundle/.test(code('src/views/YearEnd.jsx')) && /year: y/.test(code('src/views/YearEnd.jsx')) && /run\(null\)/.test(code('src/views/YearEnd.jsx')), 'the year-end package or the full export lost its button');
const sql = code('supabase/sql/2026-10-07e_start_and_keep.sql');
expect(/drop policy if exists receipts_delete_own on storage\.objects/.test(sql) && !/create policy[^;]*for delete[^;]*(receipts|statements)/i.test(sql), 'a stored receipt or statement can be deleted from the app');
expect(/security invoker/.test(sql) && /revoke all on function public\.book_start_status\(uuid\) from public, anon/.test(sql), 'the start-up checklist does not run under the book\'s own rules');
expect(/BookStart/.test(code('src/views/BookRoom.jsx')) && /book\.statements \? \[\{ id: 'setup'/.test(code('src/views/AccountingViews.jsx')), 'the start-up checklist or the Setup tab for a person\'s own books is gone');

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, status: r.status, json: j }; };
  const person = async (tag) => {
    const email = `smoke_yearend_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, rest: call({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }) };
  };
  try {
    const a = await person('a'), b = await person('b'), rest = a.rest;
    const bookId = (((await rest('POST', 'rpc/my_books', {})).json || {}).books || []).find((x) => x.is_mine)?.id;
    if (!bookId) throw new Error('no personal book');
    await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Gate Checking', p_amount: 1250.5, p_kind: 'bank' });
    await rest('POST', 'transactions', { book_id: bookId, date: '2026-02-03', amount: -20, scope: 'business', account: 'Gate Checking', payee: 'x' });
    const st = (await rest('POST', 'rpc/book_start_status', { p_book: bookId })).json;
    const acct = (st?.accounts || []).find((x) => x.account === 'Gate Checking');
    expect(acct && Number(acct.starting_balance) === 1250.5 && acct.entries === 1 && acct.first_entry === '2026-02-03' && acct.statements === 0 && acct.reconciled_through === null, `the start-up checklist misreports an account: ${JSON.stringify(acct)}`);
    expect((await b.rest('POST', 'rpc/book_start_status', { p_book: bookId })).json == null, 'a stranger can read another person\'s start-up checklist');
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('yearend_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== YEAR-END: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== YEAR-END: clean — the bundle is the screen\'s own figures, says what it could not include, and carries no whole tax ID ====');
