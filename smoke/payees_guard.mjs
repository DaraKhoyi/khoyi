// payees_guard.mjs — 1099 tracking, agent accounts, and the limits on
// sensitive data.
//
// Dara, 6 Oct 2026 (build prompt, part 5): "1099 tracking ... The threshold is
// stored per tax year and checked against the IRS at build time, not
// hard-coded." "Agent statements. What the brokerage paid them and what they
// owe." "Only the last four digits of any account are stored. W-9 tax IDs are
// encrypted and shown to owners and admins only." BLOCKS.
//
// Holds:
//  (static) a payee's standing follows the year's own IRS line and never a
//    number written into the code; a foreign payee and a corporation are never
//    told to file; a year with no figure assumes nothing; a statement adds up;
//    every function in the SQL names who may run it; no list returns a tax ID.
//  (live, two throwaway people) money paid by card is left off the form total;
//    a tax ID goes in, comes back only as four digits, cannot be read from the
//    table, and is shown whole only to an owner, with a line in the record; a
//    stranger sees nothing; an account name cannot carry a whole account
//    number; agent accounts open only on the brokerage's books.
// The brokerage side (agent charges and statements) runs on the one real
// brokerage book: smoke/payees_trial.sql proves it inside a rolled-back
// transaction.
import { readFileSync } from 'node:fs';
import { figuresLine, payeeStanding, payeesTable, statementTables, yearEndRows } from '../src/payees.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

// ── static ─────────────────────────────────────────────────────────────────
const F = { nec: 2000, rent: 2000, checked_on: '2026-10-06' }, OLD = { nec: 600, rent: 600, checked_on: '2026-10-06' };
const P = (o) => ({ name: 'A', tax_status: 'us_person', box: 'nec', form_on_file: true, last4: '6789', paid: 0, by_card: 0, counts: 0, ...o });
expect(payeeStanding(P({ counts: 1999.99 }), F).word === 'Under the line' && payeeStanding(P({ counts: 2000 }), F).word === 'File a 1099' && payeeStanding(P({ counts: 700 }), OLD).word === 'File a 1099' && payeeStanding(P({ counts: 700 }), F).word === 'Under the line',
  'who must be filed for does not follow the year\'s own IRS line');
expect(/W-9 missing/.test(payeeStanding(P({ counts: 5000, form_on_file: false }), F).word) && /W-9 missing/.test(payeeStanding(P({ counts: 5000, last4: null }), F).word) && payeeStanding(P({ counts: 5000, form_on_file: false }), F).tone === 'bad', 'someone over the line with no W-9 is not flagged');
expect(payeeStanding(P({ counts: 90000, tax_status: 'foreign' }), F).word === 'No 1099' && /W-8BEN/.test(payeeStanding(P({ tax_status: 'foreign' }), F).why) && payeeStanding(P({ counts: 90000, tax_status: 'corporation' }), F).word === 'No 1099', 'a foreign payee or a corporation is told to file');
expect(payeeStanding(P({ counts: 90000 }), null).word === 'IRS line not known' && /not in PrismOS yet/.test(figuresLine(2031, null)) && /\$2,000\.00/.test(figuresLine(2026, F)), 'a year with no IRS figure is given one anyway');
expect(payeeStanding(P({ counts: 2000, box: 'rent' }), { nec: 9999, rent: 2000 }).word === 'File a 1099', 'rent is held to the services line');
{ const t = payeesTable({ year: 2026, figures: F, payees: [P({ name: 'J', paid: 2700, by_card: 300, counts: 2400 }), P({ name: 'M', tax_status: 'foreign', paid: 373.99, by_card: 373.99, counts: 0 })] });
  const tot = t.rows.find((r) => r.kind === 'total').cells;
  expect(tot[4] === 3073.99 && tot[5] === 673.99 && tot[6] === 2400 && t.rows[0].cells[3] === '···6789' && !JSON.stringify(t).includes('123456789'), `the 1099 list does not add up or shows more than four digits: ${JSON.stringify(tot)}`);
  const y = yearEndRows({ rows: [{ name: 'J', tin: '123456789', tin_kind: 'ssn', box: 'nec', amount: 2400, form_on_file: true }] });
  expect(y[0][1] === 'Tax ID' && y[1][1] === '123456789' && y[1][5] === 2400 && y[1][4] === '1099-NEC box 1', 'the year-end file lost a column'); }
{ const [t1, t2, t3] = statementTables({ agent: { name: 'Jo' }, closings: [{ date: '2026-03-01', address: '1 A St', gross: 1000, agent: 800, office: 200 }], paid: [{ date: '2026-03-02', amount: 800, what: '1 A St' }], paid_total: 800,
    charges: [{ date: '2026-07-01', kind: 'monthly', label: 'Monthly fee', amount: 99 }, { date: '2026-08-20', kind: 'credit', label: 'Goodwill', amount: -50 }], payments: [{ date: '2026-08-01', amount: 25 }], owed_before: 10, owed: 34 });
  expect(t1.rows.find((r) => r.kind === 'total').cells[2] === 800 && t2.rows.find((r) => r.kind === 'total').cells[1] === 800 && t3.rows[0].cells[1] === 10 && t3.rows.find((r) => r.kind === 'total').cells.join() === 'Owed now,34'
    && t3.rows.filter((r) => r.kind === 'row').slice(1).reduce((s, r) => s + r.cells[1], 10) === 34, 'an agent statement does not add up from what was owed, charged and paid');
  expect(statementTables({ agent: { name: 'Jo' }, owed: -20, owed_before: 0 })[2].rows.pop().cells.join() === 'Paid ahead,20', 'an agent who paid ahead is shown as owing'); }
const sql = code('supabase/sql/2026-10-07c_agents_payees.sql');
for (const m of sql.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/g)) expect(new RegExp(`revoke all on function public\\.${m[1]}\\(`).test(sql), `${m[1]}() in the payees SQL does not say who may run it`);
expect(!/is_brokerage_staff\s*\(|app_role\s*\(/.test(sql) && !/create policy (?![^;]*\bto authenticated\b)[^;]*;/.test(sql), 'the payee rules consult staff status, or a policy does not name its role');
{ const grant = (sql.match(/grant select \(([^)]*)\)\s*on public\.book_payees/) || [])[1] || '';
  expect(grant.includes('tin_last4') && !/\btin_enc\b/.test(grant) && !/grant select on public\.book_payees/.test(sql), 'the encrypted tax ID column can be read by the app');
  const list = sql.slice(sql.indexOf('function public.book_1099(uuid'.replace('(uuid', '(')), sql.indexOf('function public.book_1099_file'));
  expect(!/pgp_sym_decrypt/.test(list) && /pgp_sym_decrypt/.test(sql.slice(sql.indexOf('function public.payee_reveal_tin'))) , 'the 1099 list decrypts tax IDs'); }
expect(/my_books_manageable\(\)[^;]*see a tax ID/.test(sql) && /book_log_add\(y\.book_id, 'tax_id_seen'/.test(sql) && /'tax_file_taken'/.test(sql), 'seeing a whole tax ID is no longer limited to owners and admins, or no longer recorded');
expect(!/\b(600|2000)\b/.test(code('src/payees.js') + code('src/views/Payees1099.jsx')), 'an IRS threshold is written into the code instead of read from the year\'s figures');
expect(/\\d\{7,\}/.test(sql) && /trg_account_name_guard[^;]*money_accounts/.test(sql) && /trg_account_name_guard[^;]*statement_imports/.test(sql), 'an account name can carry a whole account number again');
const ui = code('src/views/Payees1099.jsx') + code('src/views/AgentAccounts.jsx');
expect(!/from\('(book_payees|agent_charges|agent_fee_schedules)'\)/.test(ui), 'a payee or agent screen reads the tables itself instead of asking the database functions');
expect(/payee_reveal_tin/.test(ui) && /can_manage/.test(code('src/views/Payees1099.jsx')), 'the screen no longer keeps the whole tax ID to owners and admins');

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, status: r.status, json: j }; };
  const svc = call(H);
  const person = async (tag) => {
    const email = `smoke_payees_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, rest: call({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }) };
  };
  try {
    const a = await person('a'), b = await person('b'), rest = a.rest;
    await svc('POST', 'accounting_access', { user_id: a.id, note: 'gate' });
    const bookId = (((await rest('POST', 'rpc/my_books', {})).json || {}).books || []).find((x) => x.is_mine)?.id;
    if (!bookId) throw new Error('no personal book');
    const year = new Date().getUTCFullYear();
    const fig = (await rest('GET', `tax_year_figures?tax_year=eq.${year}&select=nec_threshold`)).json?.[0];
    expect(!!fig && Number(fig.nec_threshold) > 0, `there is no IRS figure on file for ${year}: add the row to tax_year_figures after checking irs.gov`);
    const line = Number(fig?.nec_threshold || 2000);
    const cats = (await rest('GET', `tax_categories?book_id=eq.${bookId}&select=id,name,kind&is_archived=eq.false`)).json || [];
    const labor = (cats.find((c) => /contract labor/i.test(c.name)) || cats.find((c) => c.kind === 'expense'))?.id;
    expect(!(await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Visa 4111 1111 1111 1111', p_amount: 0, p_kind: 'card' })).ok, 'an account can be named with a whole card number');
    expect(!(await rest('POST', 'transactions', { book_id: bookId, date: `${year}-02-01`, amount: -5, scope: 'business', account: 'Checking 000123456789', payee: 'x' })).ok, 'an entry can open an account named with a whole account number');
    await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Gate Visa 1111', p_amount: 0, p_kind: 'card' });
    const tx = await rest('POST', 'transactions', [
      { book_id: bookId, date: `${year}-02-01`, amount: -(line - 100), scope: 'business', account: 'Checking', payee: 'Pat Helper', tax_category_id: labor },
      { book_id: bookId, date: `${year}-03-01`, amount: -150, scope: 'business', account: 'Checking', payee: 'pat helper', tax_category_id: labor },
      { book_id: bookId, date: `${year}-03-05`, amount: -400, scope: 'business', account: 'Gate Visa 1111', payee: 'Pat Helper', tax_category_id: labor },
      { book_id: bookId, date: `${year - 1}-12-31`, amount: -9000, scope: 'business', account: 'Checking', payee: 'Pat Helper', tax_category_id: labor }]);
    if (!tx.ok) throw new Error('could not stage entries: ' + JSON.stringify(tx.json).slice(0, 200));
    const before = (await rest('POST', 'rpc/book_1099', { p_book: bookId, p_year: year })).json;
    expect(before?.payees?.length === 0 && before.untracked?.some((u) => /pat helper/i.test(u.label) && Number(u.paid) === line + 50), `someone paid over the line and not on the list is not pointed out: ${JSON.stringify(before?.untracked).slice(0, 200)}`);
    const pid = (await rest('POST', 'rpc/payee_save', { p_book: bookId, p_id: null, p: { name: 'Pat Helper', tax_status: 'us_person' } })).json;
    const d = (await rest('POST', 'rpc/book_1099', { p_book: bookId, p_year: year })).json;
    const p = d?.payees?.[0];
    expect(p && Number(p.paid) === line + 450 && Number(p.by_card) === 400 && Number(p.counts) === line + 50 && p.files === true && d.untracked.length === 0, `the year's total is wrong, or what was paid by card is counted toward the form: ${JSON.stringify(p)}`);
    await rest('POST', 'rpc/payee_save', { p_book: bookId, p_id: pid, p: { tax_status: 'foreign' } });
    expect((await rest('POST', 'rpc/book_1099', { p_book: bookId, p_year: year })).json?.payees?.[0]?.files === false, 'a foreign payee is marked to be filed for');
    await rest('POST', 'rpc/payee_save', { p_book: bookId, p_id: pid, p: { tax_status: 'us_person' } });
    // the tax ID
    expect(!(await rest('POST', 'rpc/payee_set_tin', { p_id: pid, p_tin: '12-345', p_kind: null })).ok, 'a tax ID that is not nine digits is accepted');
    const set = await rest('POST', 'rpc/payee_set_tin', { p_id: pid, p_tin: '987-65-4321', p_kind: 'ssn' });
    const after = (await rest('POST', 'rpc/book_1099', { p_book: bookId, p_year: year })).json;
    expect(set.ok && set.json?.last4 === '4321' && after.payees[0].last4 === '4321' && !JSON.stringify(after).includes('987654321'), 'a tax ID does not come back as its last four digits only');
    expect(!(await rest('GET', `book_payees?id=eq.${pid}&select=tin_enc`)).ok && !(await rest('GET', `book_payees?id=eq.${pid}&select=*`)).ok && (await rest('GET', `book_payees?id=eq.${pid}&select=name,tin_last4`)).json?.[0]?.tin_last4 === '4321', 'the encrypted tax ID can be read from the table');
    expect(!(await rest('PATCH', `book_payees?id=eq.${pid}`, { tin_last4: '0000' })).ok && !(await rest('POST', 'book_payees', { book_id: bookId, name: 'x' })).ok, 'the payee table can be written directly');
    const seen = await rest('POST', 'rpc/payee_reveal_tin', { p_id: pid });
    const log = (await svc('GET', `book_log?book_id=eq.${bookId}&action=like.tax_*&select=action,actor`)).json || [];
    expect(seen.json === '987654321' && log.some((l) => l.action === 'tax_id_seen' && l.actor === a.id) && log.some((l) => l.action === 'tax_id_stored'), `an owner cannot see the tax ID, or seeing it leaves no record: ${JSON.stringify(log)}`);
    const file = await rest('POST', 'rpc/book_1099_file', { p_book: bookId, p_year: year });
    expect(file.ok && file.json.rows.length === 1 && file.json.rows[0].tin === '987654321' && Number(file.json.rows[0].amount) === line + 50, 'the year-end file is wrong');
    expect(!(await rest('POST', 'rpc/book_1099_file', { p_book: bookId, p_year: 2099 })).ok && (await rest('POST', 'rpc/book_1099', { p_book: bookId, p_year: 2099 })).json?.figures === null, 'a year with no IRS figure is worked out anyway');
    // a stranger, and things that belong only to the brokerage
    const s = b.rest;
    expect(!(await s('POST', 'rpc/book_1099', { p_book: bookId, p_year: year })).ok && !(await s('POST', 'rpc/book_1099_file', { p_book: bookId, p_year: year })).ok && !(await s('POST', 'rpc/payee_reveal_tin', { p_id: pid })).ok
      && !(await s('POST', 'rpc/payee_set_tin', { p_id: pid, p_tin: '111111111', p_kind: null })).ok && !(await s('POST', 'rpc/payee_save', { p_book: bookId, p_id: pid, p: { name: 'z' } })).ok
      && ((await s('GET', `book_payees?book_id=eq.${bookId}&select=id`)).json || []).length === 0, 'someone with no seat on the books can see or change its payees');
    expect(!(await rest('POST', 'rpc/book_payee_entries', { p_book: bookId, p_year: year })).ok && !(await rest('POST', 'rpc/agent_statement_data', { p_book: bookId, p_agent: pid, p_from: null, p_to: null })).ok && !(await rest('POST', 'rpc/agent_payments', { p_book: bookId, p_agent: null })).ok, 'an inner function with no access check can be called from the app');
    expect(!(await rest('POST', 'rpc/agent_balances', { p_book: bookId, p_year: null })).ok && !(await rest('POST', 'rpc/agent_charges_run', { p_book: bookId })).ok, 'agent accounts open on books that are not the brokerage\'s');
    const brokerage = (await svc('GET', 'books?kind=eq.brokerage&select=id')).json?.[0]?.id;
    if (brokerage) expect(!(await rest('POST', 'rpc/agent_balances', { p_book: brokerage, p_year: null })).ok && !(await rest('POST', 'rpc/agent_statement', { p_book: brokerage, p_agent: pid })).ok && !(await rest('POST', 'rpc/agent_charge_add', { p_book: brokerage, p_agent: pid, p_date: '2026-01-01', p_kind: 'other', p_label: 'x', p_amount: 1 })).ok
      && ((await rest('GET', 'agent_charges?select=id&limit=1')).json || []).length === 0, 'someone with no seat on the brokerage\'s books can see or change agent accounts');
    expect((await rest('POST', 'rpc/my_agent_statement', { p_from: null, p_to: null })).json === null && (await s('POST', 'rpc/my_agent_statement', { p_from: null, p_to: null })).json === null, 'someone who is not an agent is handed a statement');
    const health = await svc('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run');
    else for (const h of health.json.slice(0, 8)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('payees_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== PAYEES: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== PAYEES: clean — who is filed for follows the year\'s own IRS line; a tax ID is four digits to everyone but an owner; agent accounts add up ====');
