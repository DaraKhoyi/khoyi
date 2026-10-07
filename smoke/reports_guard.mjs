// reports_guard.mjs — reconciliation, and the reports books are kept for.
//
// Dara, 6 Oct 2026 (build prompt, part 5): "Bank reconciliation ... Without it
// nobody knows the books are right. It is the one control a CPA checks first."
// "Reports: profit and loss, balance sheet, cash flow, general ledger, trial
// balance; profit by agent, by team, by month; this year against last. Export
// to PDF, CSV and Excel." BLOCKS.
//
// Holds:
//  (static) a report is one table whether it is on screen, in a file or on
//    paper; profit and loss adds up, beside last year and broken down; cash
//    flow starts and ends at the bank; a trial balance that does not balance
//    says so; a file cannot carry a formula into a spreadsheet.
//  (live, two throwaway people) a reconciliation counts each side of a
//    transfer on its own account, cannot be finished while it is off by a
//    cent, locks its entries once finished (re-filing is still allowed),
//    refuses an earlier statement, reopens only for an owner; every report
//    agrees with the entries; a stranger gets nothing.
import { readFileSync } from 'node:fs';
import { cashFlowTable, heldTable, pnlTable, reconciliationTable, tableRows, trialBalanceTable, yearBefore } from '../src/bookReports.js';
import { csvCell, toCsv } from '../src/exportFile.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');
const cell = (t, label, col = 1) => (t.rows.find((r) => r.cells[0] === label) || { cells: [] }).cells[col];

// ── static ─────────────────────────────────────────────────────────────────
const L = [{ category_id: 'a', name: 'Commission Income', class: 'income', amount: 5000 }, { category_id: 'b', name: 'Office Expense', class: 'expense', amount: 285.1 }, { category_id: null, name: 'Money out, no category yet', class: 'expense', amount: 14.9 }];
{ const t = pnlTable(L);
  expect(cell(t, 'Total money in') === 5000 && cell(t, 'Total money out') === 300 && cell(t, 'Left over (profit)') === 4700 && t.net === 4700, `profit and loss does not add up: ${JSON.stringify(t.rows.map((r) => r.cells))}`);
  const c = pnlTable(L, { before: [{ category_id: 'a', name: 'Commission Income', class: 'income', amount: 4000 }, { category_id: 'z', name: 'Rent', class: 'expense', amount: 100 }] });
  expect(c.columns.length === 4 && cell(c, 'Commission Income', 3) === 1000 && cell(c, 'Rent', 2) === 100 && cell(c, 'Rent', 1) === 0 && cell(c, 'Left over (profit)', 2) === 3900 && cell(c, 'Left over (profit)', 3) === 800, `this year beside last is wrong (a category only last year must still show): ${JSON.stringify(c.rows.map((r) => r.cells))}`); }
{ const m = pnlTable([{ category_id: 'a', name: 'Fees', class: 'income', amount: 100, bucket: '2026-02' }, { category_id: 'a', name: 'Fees', class: 'income', amount: 50, bucket: '2026-01' }, { category_id: 'b', name: 'Rent', class: 'expense', amount: 30, bucket: '2026-02' }], { by: 'month' });
  expect(m.columns.join('|') === '|Jan 2026|Feb 2026|Total' && JSON.stringify(m.rows.find((r) => r.cells[0] === 'Fees').cells) === JSON.stringify(['Fees', 50, 100, 150]) && JSON.stringify(m.rows[m.rows.length - 1].cells) === JSON.stringify(['Left over (profit)', 50, 70, 120]), `profit by month is wrong: ${JSON.stringify(m.rows.map((r) => r.cells))}`);
  const a = pnlTable([{ category_id: 'a', name: 'Fees', class: 'income', amount: 100, bucket: 'u1', label: 'Zed' }, { category_id: 'a', name: 'Fees', class: 'income', amount: 7, bucket: null }, { category_id: 'a', name: 'Fees', class: 'income', amount: 9, bucket: 'u2', label: null }], { by: 'agent' });
  expect(a.columns.join('|') === '|An agent you cannot open|Zed|No agent tagged|Total' && cell(a, 'Fees', 4) === 116, `profit by agent is wrong, or drops what is not tagged: ${a.columns.join('|')}`); }
{ const t = cashFlowTable({ begin: 950, change: 4415, lines: [{ section: 'operating', name: 'Commission Income', amount: 5000 }, { section: 'operating', name: 'Office', amount: -285 }, { section: 'cards', name: 'Visa', amount: -300 }] });
  expect(cell(t, 'In the bank at the start') === 950 && cell(t, 'Change in the bank') === 4415 && cell(t, 'In the bank at the end') === 5365, 'cash flow does not start and end at the bank'); }
expect(trialBalanceTable({ lines: [{ class: 'asset', name: 'Bank', debit: 10, credit: 0 }], total_debit: 10, total_credit: 9 }).rows.some((r) => r.kind === 'note') && trialBalanceTable({ lines: [], total_debit: 5, total_credit: 5 }).balanced, 'a trial balance that does not balance is shown without saying so');
expect(heldTable({ lines: [{ contact_id: 'c', name: 'J. Suarez', amount: 500 }, { contact_id: null, amount: 100 }], held: 600, escrow: 700 }).tied === false && heldTable({ lines: [], held: 600, escrow: 600 }).tied, 'escrow that does not match what is owed to others is not called out');
{ const t = reconciliationTable({ account: 'Operating', statement_date: '2026-09-30' }, { begin: 1000, cleared_in: 5000, cleared_out: 550, cleared_balance: 5450, statement: 5450, difference: 0, book_balance: 5375 }, [{ cleared: true, amount: 5000 }, { cleared: false, amount: -75, entry_date: '2026-09-29', payee: 'Check 101' }]);
  expect(cell(t, 'Difference') === 0 && cell(t, 'Balance in the books on that day') === 5375 && t.rows.some((r) => String(r.cells[0]).includes('Check 101')), 'a reconciliation report loses what is outstanding'); }
expect(yearBefore('2024-02-29') === '2023-02-28' && yearBefore('2026-12-31') === '2025-12-31', 'the same days a year before are worked out wrong');
expect(csvCell('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"' && csvCell('-5 off') === "'-5 off" && csvCell(-5) === '-5' && csvCell('a,b') === '"a,b"' && toCsv([['a', 1], ['b', null]]) === 'a,1\r\nb,', 'a report file can carry a formula into a spreadsheet, or mangles a number');
expect(tableRows(pnlTable(L)).some((r) => r[0] === 'MONEY IN') && tableRows(pnlTable(L)).some((r) => r[0] === 'Commission Income' && r[1] === 5000), 'the file does not carry the same rows as the screen, with raw numbers');
const br = code('src/views/BookReports.jsx');
for (const fn of ['book_pnl', 'book_position', 'book_cash_flow', 'book_trial_balance', 'book_general_ledger', 'book_held_by_person']) expect(br.includes(`rpc('${fn}'`), `Reports no longer offers ${fn}`);
expect(/downloadCsv\(/.test(br) && /downloadXlsx\(/.test(br) && /printTables\(/.test(br), 'a report can no longer leave as CSV, Excel and a printed page');
expect(!/from\('transactions'\)/.test(br + code('src/views/Reconcile.jsx')), 'a report or the reconciliation reads entries directly instead of asking the ledger');
const sql = code('supabase/sql/2026-10-07_reconcile_reports.sql');
expect(!/is_brokerage_staff\s*\(|app_role\s*\(/.test(sql) && !/create policy (?![^;]*\bto authenticated\b)[^;]*;/.test(sql), 'the reconciliation rules consult staff status, or a policy does not name its role');

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, json: j }; };
  const person = async (tag) => {
    const email = `smoke_reports_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, rest: call({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }) };
  };
  try {
    const a = await person('a'), b = await person('b'), rest = a.rest;
    await call(H)('POST', 'accounting_access', { user_id: a.id, note: 'gate' });
    const bookId = (((await rest('POST', 'rpc/my_books', {})).json || {}).books || []).find((x) => x.is_mine)?.id;
    if (!bookId) throw new Error('no personal book');
    const cats = (await rest('GET', `tax_categories?book_id=eq.${bookId}&select=id,name&is_archived=eq.false`)).json;
    const office = cats.find((c) => c.name === 'Office Expense')?.id, income = cats.find((c) => c.name === 'Commission Income')?.id;
    await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Checking', p_amount: 1000, p_kind: 'bank' });
    const add = async (row) => (await rest('POST', 'transactions', { book_id: bookId, scope: 'business', account: 'Checking', ...row })).json[0];
    const t1 = await add({ date: '2026-09-03', amount: 5000, payee: 'Title Co', tax_category_id: income });
    const t2 = await add({ date: '2026-09-10', amount: -200, payee: 'Staples', tax_category_id: office });
    const t3 = await add({ date: '2026-09-15', amount: -300, transfer_account: 'Biz Visa' });
    await add({ date: '2026-09-29', amount: -75, payee: 'Check 101', tax_category_id: office });

    // reconciliation
    const r1 = (await rest('POST', 'rpc/recon_start', { p_book: bookId, p_account: 'Checking', p_date: '2026-09-30', p_balance: 5500 })).json;
    let d = (await rest('POST', 'rpc/recon_detail', { p_id: r1 })).json;
    expect(d && d.items.length === 4 && Number(d.numbers.begin) === 1000 && Number(d.numbers.difference) === 4500, `a new reconciliation does not start from the starting balance with every entry to tick: ${JSON.stringify(d && d.numbers)}`);
    const m = (await rest('POST', 'rpc/recon_mark', { p_id: r1, p_on: true, p_items: [{ id: t1.id, side: 'account' }, { id: t2.id, side: 'account' }, { id: t3.id, side: 'account' }, { id: t3.id, side: 'transfer' }] })).json;
    expect(Number(m.cleared_balance) === 5500 && Number(m.cleared_count) === 3 && Number(m.difference) === 0, `ticking counts wrong (the far side of a transfer belongs to the other account's statement): ${JSON.stringify(m)}`);
    await rest('POST', 'rpc/recon_mark', { p_id: r1, p_on: false, p_items: [{ id: t2.id, side: 'account' }] });
    expect(!(await rest('POST', 'rpc/recon_finish', { p_id: r1 })).ok, 'a reconciliation was finished while it was off');
    await rest('POST', 'rpc/recon_mark', { p_id: r1, p_on: true, p_items: [{ id: t2.id, side: 'account' }] });
    expect((await rest('POST', 'rpc/recon_finish', { p_id: r1 })).ok, 'a reconciliation that agrees to the cent could not be finished');
    expect((await rest('PATCH', `transactions?id=eq.${t2.id}`, { amount: -210 })).ok === false && (await rest('PATCH', `transactions?id=eq.${t2.id}`, { is_archived: true })).ok === false, 'a reconciled entry can be changed or removed without reopening the reconciliation');
    expect((await rest('PATCH', `transactions?id=eq.${t2.id}`, { description: 'toner' })).ok, 'a reconciled entry can no longer be re-filed or annotated (only its amount, date and account are locked)');
    expect(!(await rest('POST', 'rpc/recon_start', { p_book: bookId, p_account: 'Checking', p_date: '2026-09-20', p_balance: 1 })).ok, 'a statement earlier than the last reconciled one was accepted');
    const visa = (await rest('POST', 'rpc/recon_start', { p_book: bookId, p_account: 'Biz Visa', p_date: '2026-09-30', p_balance: 300 })).json;
    d = (await rest('POST', 'rpc/recon_detail', { p_id: visa })).json;
    expect(d && d.items.length === 1 && d.items[0].side === 'transfer' && Number(d.items[0].amount) === 300, `the other side of a transfer is not waiting on the other account's statement: ${JSON.stringify(d && d.items)}`);
    const list = (await rest('POST', 'rpc/recon_list', { p_book: bookId })).json;
    const chk = list.accounts.find((x) => x.account === 'Checking');
    expect(chk && chk.last_date === '2026-09-30' && chk.unreconciled === 1 && list.history.length === 1, `the list of accounts does not say where each stands: ${JSON.stringify(chk)}`);
    expect((await rest('POST', 'rpc/recon_reopen', { p_id: r1 })).ok && (await rest('PATCH', `transactions?id=eq.${t2.id}`, { amount: -210 })).ok, 'an owner could not reopen a reconciliation, or its entries stayed locked');

    // reports agree with the entries
    const pnl = pnlTable((await rest('POST', 'rpc/book_pnl', { p_book: bookId, p_from: '2026-01-01', p_to: '2026-12-31' })).json.lines);
    expect(pnl.totalIn === 5000 && pnl.totalOut === 285 && pnl.net === 4715, `profit and loss does not match the entries (a transfer must not count): ${JSON.stringify([pnl.totalIn, pnl.totalOut, pnl.net])}`);
    const byMonth = (await rest('POST', 'rpc/book_pnl', { p_book: bookId, p_by: 'month' })).json.lines;
    expect(byMonth.every((l) => l.bucket === '2026-09') && byMonth.length === 2, 'profit by month puts entries in the wrong month');
    const tb = (await rest('POST', 'rpc/book_trial_balance', { p_book: bookId })).json;
    expect(Number(tb.total_debit) === Number(tb.total_credit) && Number(tb.total_debit) > 0, `the trial balance does not balance: ${tb.total_debit} / ${tb.total_credit}`);
    const cf = (await rest('POST', 'rpc/book_cash_flow', { p_book: bookId, p_from: '2026-01-01', p_to: '2026-12-31' })).json;
    expect(Number(cf.begin) === 1000 && Number(cf.change) === 4415 && cf.lines.some((l) => l.section === 'cards' && Number(l.amount) === -300), `cash flow is wrong: ${JSON.stringify(cf)}`);
    const gl = (await rest('POST', 'rpc/book_general_ledger', { p_book: bookId, p_limit: 3 })).json;
    expect(gl.lines.length === 3 && Number(gl.total) >= 12, 'the general ledger does not list the postings');

    // a stranger
    const s = b.rest;
    expect(((await s('POST', 'rpc/book_pnl', { p_book: bookId })).json?.lines || []).length === 0 && ((await s('POST', 'rpc/book_trial_balance', { p_book: bookId })).json?.lines || []).length === 0
      && ((await s('POST', 'rpc/book_cash_flow', { p_book: bookId })).json?.lines || []).length === 0 && Number((await s('POST', 'rpc/book_general_ledger', { p_book: bookId })).json?.total || 0) === 0
      && ((await s('GET', `book_reconciliations?book_id=eq.${bookId}&select=id`)).json || []).length === 0 && ((await s('GET', `recon_marks?book_id=eq.${bookId}&select=transaction_id`)).json || []).length === 0, 'someone with no seat on the books can read a report or a reconciliation');
    expect(!(await s('POST', 'rpc/recon_list', { p_book: bookId })).ok && !(await s('POST', 'rpc/recon_detail', { p_id: r1 })).ok && !(await s('POST', 'rpc/recon_mark', { p_id: r1, p_items: [], p_on: true })).ok && !(await s('POST', 'rpc/recon_start', { p_book: bookId, p_account: 'Checking', p_date: '2026-10-01', p_balance: 1 })).ok, 'someone with no seat on the books can open or change a reconciliation');
    const health = await call(H)('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run');
    else for (const h of health.json.slice(0, 8)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('reports_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== REPORTS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== REPORTS: clean — a reconciliation finishes only at zero and then locks; the reports add up and say the same thing on screen, in a file and on paper ====');
