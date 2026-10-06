// ledger_guard.mjs — the double-entry ledger under the checkbook.
//
// Dara, 6 Oct 2026 (build prompt, part 3): "The user sees money in, money out,
// what it was for; the database holds balanced journal entries." Balanced or
// rejected, by any path; whole cents; posted entries never edited or deleted (a
// correction is a reversal plus a new entry, and the history keeps all three);
// transfers are never income or spending; an account that has been used is
// retired, not deleted; and standing checks for every set of books. BLOCKS.
//
// Holds:
//  (static) a transfer shows in both accounts' registers with the right sign
//    and in neither total; the statement of position turns the ledger the right
//    way up and says so when it does not tie out; transfers and draws are left
//    out of income and spending; nobody is granted a way to write the journal.
//  (live, one throwaway person signed in for real, plus the service key)
//    saving an entry posts one balanced journal entry in whole cents; changing
//    it leaves three (entered, taken back, entered again) and one standing;
//    changing only the wording posts nothing; removing it leaves none standing;
//    a transfer moves both balances and appears in no summary; a starting
//    balance is an opening entry, corrected the same way; half a cent is
//    refused; a used category cannot be deleted; the journal cannot be written,
//    changed or deleted by the person OR by the service key, and an entry that
//    does not balance is refused whoever sends it; and ledger_health() finds
//    nothing wrong in ANY set of books in the database.
import { readFileSync } from 'node:fs';
import { amountFor, fillFrom, isTransfer, runningBalances, sortNewest, touches } from '../src/moneyRegister.js';
import { countsInProfit, ledgerLine, position, CATEGORY_KINDS } from '../src/books.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

// ── static: the thinking ───────────────────────────────────────────────────
const T = (id, date, amount, more = {}) => ({ id, date, amount, created_at: `${date}T12:00:0${id}Z`, ...more });
const book = [
  T(1, '2026-10-01', -500, { account: 'Checking', transfer_account: 'Biz Visa' }),
  T(2, '2026-10-02', -40, { account: 'biz visa ', payee: 'Shell' }),
  T(3, '2026-10-03', 900, { account: 'Checking', payee: 'Commission' }),
];
expect(isTransfer(book[0]) && !isTransfer(book[1]), 'a transfer is not being recognised');
expect(touches(book[0], 'checking') && touches(book[0], 'biz visa') && !touches(book[1], 'checking'), 'a transfer must appear in BOTH accounts\' registers');
expect(amountFor(book[0], 'checking') === -500 && amountFor(book[0], 'biz visa') === 500 && amountFor(book[0], '') === -500 && amountFor(book[1], 'biz visa') === -40, 'a transfer has the wrong sign in the account it arrived in');
{ const visa = sortNewest(book.filter((t) => touches(t, 'biz visa'))), bal = runningBalances(visa, 460, (t) => amountFor(t, 'biz visa'));
  expect(bal.get(2) === 460 && bal.get(1) === 500, `the balance after each line is wrong in the account a transfer arrived in: ${JSON.stringify([...bal])}`); }
expect(fillFrom(book[0]).direction === 'transfer' && fillFrom(book[0]).transferAccount === 'Biz Visa' && fillFrom(book[2]).direction === 'in', 'taking a past transfer as a match does not fill it as a transfer');
const kinds = { a: 'expense', b: 'transfer', c: 'equity', d: 'held', e: 'income', f: 'other' }, kindOf = (id) => kinds[id];
expect(countsInProfit({ tax_category_id: 'a' }, kindOf) && countsInProfit({ tax_category_id: 'e' }, kindOf) && countsInProfit({ tax_category_id: null }, kindOf) && countsInProfit({ tax_category_id: 'f' }, kindOf)
  && !countsInProfit({ tax_category_id: 'b' }, kindOf) && !countsInProfit({ tax_category_id: 'c' }, kindOf) && !countsInProfit({ tax_category_id: 'd' }, kindOf) && !countsInProfit({ tax_category_id: 'a', transfer_account: 'Savings' }, kindOf),
  'a transfer, a draw or money held for others is being counted as income or spending (or a real expense is being left out)');
{ const p = position([
    { id: 1, class: 'asset', name: 'Operating', account_kind: 'bank', balance: 15420.5 },
    { id: 2, class: 'asset', name: 'Escrow', account_kind: 'escrow', balance: 48260 },
    { id: 3, class: 'liability', name: 'Team Visa', account_kind: 'card', balance: -212.4 },
    { id: 4, class: 'liability', name: 'Rent Collected for Owners', category_kind: 'held', balance: -260 },
    { id: 5, class: 'equity', name: 'Opening balances', balance: -12500 }, { id: 9, class: 'liability', name: 'Held for others at the start', system_key: 'opening_held', balance: -48000 },
    { id: 6, class: 'income', name: 'Management Fees', balance: -5150 },
    { id: 7, class: 'expense', name: 'Software', balance: 1801.9 },
    { id: 8, class: 'asset', name: 'Transfers & Card Payments', category_kind: 'transfer', balance: 640 }]);
  expect(p.totalHold === 64320.5 && p.totalOwe === 212.4 && p.totalHeld === 48260 && p.left === 15848.1 && p.totalOwners === 15848.1 && p.balanced && p.inTransit === 640,
    `the statement of position does not add up: ${JSON.stringify({ hold: p.totalHold, owe: p.totalOwe, held: p.totalHeld, left: p.left, owners: p.totalOwners, tie: p.balanced })}`);
  expect(!position([{ id: 1, class: 'asset', name: 'Operating', balance: 100 }]).balanced, 'a ledger that does not tie out is being shown as if it did');
  expect(position([]).empty, 'an empty ledger is not recognised as empty'); }
expect(ledgerLine({ what: 'reversed', amount: 42.18, debit: 'Biz Visa', credit: 'Fuel' }, (n) => '$' + n) === 'Taken back: $42.18 to Biz Visa from Fuel', 'an entry\'s ledger history no longer reads in plain words');
expect(['asset', 'liability', 'equity', 'transfer'].every((k) => CATEGORY_KINDS.some(([id]) => id === k)), 'a category can no longer be an asset, a liability, equity or a transfer');

// ── static: where things are ───────────────────────────────────────────────
const sql = code('supabase/sql/2026-10-06d_ledger.sql');
expect(/create constraint trigger trg_gl_entry_balanced after insert on public\.gl_entries\s+deferrable initially deferred/.test(sql) && /create constraint trigger trg_gl_line_balanced after insert on public\.gl_lines\s+deferrable initially deferred/.test(sql), 'the database no longer refuses an entry that does not balance');
expect(/revoke all on public\.ledger_accounts, public\.gl_entries, public\.gl_lines from public, anon, authenticated;\s*grant select on public\.ledger_accounts, public\.gl_entries, public\.gl_lines to authenticated;/.test(sql) && !/grant (insert|update|delete|all)[^;]*journal_/i.test(sql), 'someone is granted a way to write the journal directly');
expect(/debit_cents\s+bigint/.test(sql) && /credit_cents bigint/.test(sql) && /check \(amount = round\(amount, 2\)\)/.test(sql), 'amounts are no longer whole cents');
expect(/before update or delete on public\.gl_entries/.test(sql) && /before update or delete on public\.gl_lines/.test(sql), 'a posted entry can be edited or deleted');
expect(/revoke all on function public\.ledger_health\(\) from public, anon, authenticated/.test(sql), 'the standing checks can be called from a browser');
expect(/revoke insert, update, delete, truncate, references, trigger on public\.ledger_accounts, public\.gl_entries, public\.gl_lines from service_role/.test(sql) && /before truncate on public\.gl_lines/.test(sql), 'the service key can write to or empty the ledger');
const reg = code('src/views/MoneyRegister.jsx');
expect(reg.includes('data-testid="money-transfer"') && /transfer_account: moving \? toAccount\.trim\(\) : null/.test(reg), 'the entry form lost Transfer');
expect(/runningBalances\(rows, account\.balance, \(t\) => amountFor\(t, picked\)\)/.test(reg) && /rows\.filter\(\(t\) => !isTransfer\(t\)\)/.test(reg), 'a transfer is being counted in the register\'s money-in or money-out totals, or with the wrong sign in a balance');
expect(/rpc\('book_position'/.test(code('src/views/BookRoom.jsx')) && /!pos\.balanced/.test(code('src/views/BookRoom.jsx')), 'Reports no longer shows where the books stand, or no longer says when the ledger does not tie out');
expect(/countsInProfit\(t, kindOf\)/.test(code('src/views/AccountingViews.jsx')) && (code('src/views/FinanceReports.jsx').match(/countsInProfit\(t, /g) || []).length === 2, 'a person\'s own income and spending figures count transfers again');
expect(/<EntryTags book=\{book\}/.test(code('src/views/FinanceLedger.jsx')) && /<EntryHistory txId=\{initial\.id\}/.test(code('src/views/FinanceLedger.jsx')), 'the entry dialog lost its tags or its ledger history');

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const svc = async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, json: j }; };
  try {
    const email = `smoke_ledger_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    const as = { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const rest = async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: as, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); return { ok: r.ok, json: j }; };
    const rows = (x) => (Array.isArray(x.json) ? x.json : []);
    const journal = async (tx) => rows(await rest('GET', `gl_entries?transaction_id=eq.${tx}&select=id,entry_date,reverses_id,replaces_id,gl_lines(debit_cents,credit_cents,ledger_accounts(name,class,system_key))&order=seq`));
    const standing = async (tx) => rows(await rest('GET', `gl_live?transaction_id=eq.${tx}&select=id`)).length;
    const balance = async (bookId, name) => Number((rows(await rest('POST', 'rpc/book_account_balances', { p_book: bookId })).find((a) => a.account === name) || {}).balance);

    // 1. an entry posts one balanced journal entry, in whole cents
    const e1 = (await rest('POST', 'transactions', { user_id: id, date: '2026-10-01', amount: -42.18, scope: 'business', payee: 'Shell', account: 'Biz Visa' })).json?.[0];
    if (!e1) throw new Error('the throwaway person could not save an entry');
    const bookId = e1.book_id;
    let j = await journal(e1.id);
    const lines = j[0]?.gl_lines || [];
    expect(j.length === 1 && lines.length === 2 && lines.reduce((s, l) => s + l.debit_cents, 0) === 4218 && lines.reduce((s, l) => s + l.credit_cents, 0) === 4218, `saving an entry did not post one balanced journal entry of 4218 cents: ${JSON.stringify(j).slice(0, 200)}`);
    expect(lines.some((l) => l.credit_cents === 4218 && l.ledger_accounts?.name === 'Biz Visa') && lines.some((l) => l.debit_cents === 4218 && l.ledger_accounts?.system_key === 'uncategorized_expense'), 'money out is not posted as a credit to the account and a debit to spending');

    // 2. a correction: the journal keeps all three, one stands
    const cat = (await rest('POST', 'tax_categories', { user_id: id, name: 'Fuel (ledger test)', schedule_c_line: 'Line 9', kind: 'expense' })).json?.[0];
    expect((await rest('PATCH', `transactions?id=eq.${e1.id}`, { tax_category_id: cat?.id, amount: -45 })).ok, 'an entry cannot be corrected');
    j = await journal(e1.id);
    expect(j.length === 3 && j[1].reverses_id === j[0].id && j[2].replaces_id === j[0].id && j[1].entry_date === j[0].entry_date && (await standing(e1.id)) === 1, `a correction must leave three journal entries (entered, taken back, entered again) and one standing: ${JSON.stringify(j.map((x) => [x.reverses_id, x.replaces_id])).slice(0, 200)}`);
    expect((j[2].gl_lines || []).some((l) => l.debit_cents === 4500 && l.ledger_accounts?.name === 'Fuel (ledger test)'), 'the corrected entry is not posted to its new category and amount');
    const hist = rows(await rest('POST', 'rpc/book_entry_history', { p_tx: e1.id })).map((h) => h.what).join();
    expect(hist === 'entered,reversed,corrected', `the entry's history does not read entered, reversed, corrected: ${hist}`);
    await rest('PATCH', `transactions?id=eq.${e1.id}`, { payee: 'Shell Oil', description: 'fuel' });
    expect((await journal(e1.id)).length === 3, 'changing only the wording of an entry posted to the ledger');

    // 3. a transfer moves both balances and is in no summary
    const tr = (await rest('POST', 'transactions', { user_id: id, date: '2026-10-02', amount: -500, scope: 'business', account: 'Checking', transfer_account: 'Biz Visa' })).json?.[0];
    expect(!!tr && !!tr.tax_category_id, 'a transfer could not be saved, or was not filed under the transfer category');
    expect((await balance(bookId, 'Checking')) === -500 && (await balance(bookId, 'Biz Visa')) === 455, `a transfer did not move both balances: Checking ${await balance(bookId, 'Checking')}, Biz Visa ${await balance(bookId, 'Biz Visa')}`);
    const sum = ((await rest('POST', 'rpc/book_summary', { p_book: bookId })).json?.lines) || [];
    expect(sum.length === 1 && sum[0].name === 'Fuel (ledger test)' && Number(sum[0].money_out) === 45, `a transfer shows up as income or spending: ${JSON.stringify(sum).slice(0, 200)}`);
    expect(!(await rest('POST', 'transactions', { user_id: id, date: '2026-10-02', amount: -5, scope: 'business', account: 'Checking', transfer_account: 'checking ' })).ok, 'a transfer from an account to itself was accepted');

    // a transfer that stops being one leaves the transfer category, so it cannot hide spending
    const tr2 = (await rest('POST', 'transactions', { user_id: id, date: '2026-10-02', amount: -10, scope: 'business', account: 'Checking', transfer_account: 'Biz Visa' })).json?.[0];
    const cleared = (await rest('PATCH', `transactions?id=eq.${tr2?.id}`, { transfer_account: null, tax_category_id: tr2?.tax_category_id })).json?.[0];
    expect(!!cleared && cleared.tax_category_id === null, 'a transfer that was changed into ordinary spending stayed filed as a transfer');
    await rest('PATCH', `transactions?id=eq.${tr2?.id}`, { is_archived: true });

    // 4. a starting balance is an opening entry, and correcting it keeps the history
    expect((await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Checking', p_amount: 1000 })).ok && (await balance(bookId, 'Checking')) === 500, 'a starting balance is not in the account\'s ledger balance');
    await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Checking', p_amount: 1200 });
    const ma = rows(await rest('GET', `money_accounts?book_id=eq.${bookId}&name=eq.Checking&select=id`))[0]?.id;
    expect((await balance(bookId, 'Checking')) === 700 && rows(await rest('GET', `gl_entries?opening_for=eq.${ma}&select=id`)).length === 3, 'correcting a starting balance did not reverse the old opening entry and post a new one');
    // an escrow account's starting balance is held for others, never the owners' own
    await rest('POST', 'rpc/set_book_account', { p_book: bookId, p_account: 'Client Escrow', p_amount: 300, p_kind: 'escrow' });
    const pos = ((await rest('POST', 'rpc/book_position', { p_book: bookId })).json?.lines) || [];
    expect(position(pos).totalHeld === 300 && position(pos).left === 1155, `money in escrow at the start is being counted as the owners' own: held ${position(pos).totalHeld}, left ${position(pos).left}`);
    expect(position(pos).balanced && position(pos).totalHold === 1000 && position(pos).totalOwe === -455, `the statement of position does not tie out: ${JSON.stringify(position(pos)).slice(0, 240)}`);

    // 5. removing an entry leaves nothing standing, and the history stays
    expect((await rest('PATCH', `transactions?id=eq.${e1.id}`, { is_archived: true })).ok && (await standing(e1.id)) === 0 && (await journal(e1.id)).length === 4, 'removing an entry did not take it back in the ledger, or lost its history');
    expect((await balance(bookId, 'Biz Visa')) === 500, 'a removed entry still counts in its account\'s balance');

    // 6. whole cents; used accounts and categories are kept
    const frac = (await rest('POST', 'transactions', { user_id: id, date: '2026-10-03', amount: -1.005, scope: 'business', account: 'Checking' })).json?.[0];
    expect(!frac || Number.isInteger(Math.round(Number(frac.amount) * 1000) / 10), `an amount with a fraction of a cent was stored: ${frac && frac.amount}`);
    if (frac) await rest('PATCH', `transactions?id=eq.${frac.id}`, { is_archived: true });
    await rest('DELETE', `tax_categories?id=eq.${cat?.id}`);
    expect(rows(await rest('GET', `tax_categories?id=eq.${cat?.id}&select=id`)).length === 1, 'a category with entries in the ledger was deleted');
    await rest('DELETE', `money_accounts?id=eq.${ma}`); await rest('PATCH', `money_accounts?id=eq.${ma}`, { name: 'Renamed Checking' });
    expect(rows(await rest('GET', `money_accounts?id=eq.${ma}&name=eq.Checking&select=id`)).length === 1, 'an account with entries in the ledger was deleted or renamed (a rename splits it in two)');

    // 7. nobody writes the journal: not the person, not the service key
    const acct = rows(await rest('GET', `ledger_accounts?book_id=eq.${bookId}&select=id&limit=2`)).map((a) => a.id);
    const anEntry = (await journal(tr.id))[0]?.id;
    expect(!(await rest('POST', 'gl_entries', { book_id: bookId, entry_date: '2026-10-03' })).ok && !(await rest('POST', 'gl_lines', { entry_id: anEntry, book_id: bookId, account_id: acct[0], debit_cents: 100 })).ok, 'a signed-in person can write to the journal directly');
    expect(rows(await rest('PATCH', `gl_lines?entry_id=eq.${anEntry}`, { debit_cents: 1 })).length === 0 && rows(await rest('DELETE', `gl_entries?id=eq.${anEntry}`)).length === 0, 'a signed-in person can change or delete a posted entry');
    const lonely = await svc('POST', 'gl_entries', { book_id: bookId, entry_date: '2026-10-03', memo: 'gate: an entry with no lines' });
    expect(!lonely.ok, `the service key wrote to the journal directly: ${JSON.stringify(lonely.json).slice(0, 160)}`);
    expect(!(await svc('POST', 'rpc/ledger_reverse', { p_entry: anEntry, p_by: null })).ok && !(await svc('POST', 'rpc/ledger_post_tx', { p_tx: tr.id, p_replaces: null })).ok, 'the service key can post or reverse in the ledger without a checkbook entry');
    expect(!(await svc('POST', 'gl_lines', { entry_id: anEntry, book_id: bookId, account_id: acct[0], debit_cents: 100 })).ok, 'the service key added a line to an entry that was already posted');
    expect(!(await svc('PATCH', `gl_lines?entry_id=eq.${anEntry}`, { debit_cents: 1 })).ok && !(await svc('PATCH', `gl_entries?id=eq.${anEntry}`, { memo: 'forged' })).ok && !(await svc('DELETE', `gl_entries?id=eq.${anEntry}`)).ok, 'the service key changed or deleted a posted entry');
    expect((await journal(tr.id)).length === 1 && (await standing(tr.id)) === 1, 'the journal was changed by a refused write');
    expect(!(await rest('POST', 'rpc/ledger_health', {})).ok, 'the standing checks can be run by a signed-in person');

    // 8. the standing checks, for every set of books there is
    const health = await svc('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run: ' + JSON.stringify(health.json).slice(0, 200));
    else for (const h of health.json.slice(0, 12)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('ledger_guard: live check not run (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY)');

if (problems.length) { console.error(`\n==== LEDGER: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== LEDGER: clean — every entry posts balanced, in whole cents; corrections keep their history; nobody writes the journal; every set of books ties out ====');
