// money_register_guard.mjs — Money opens on a check register, and the register
// behaves the way Dara asked for it (5 Oct 2026).
//
//   • Tapping Money lands on My Transactions, not the dashboard.
//   • The Agent / Partner / Coach switch is a setting, not three buttons on top
//     of the money screens.
//   • Typing a payee offers the match from past entries; taking it fills the
//     rest but never moves the date.
//   • The date stays where it was put, for that day only.
//   • The journal is newest first, the search finds an entry by any mix of
//     payee, category, account, amount and month, and an account's balance
//     after each line adds up.
// Static, no credentials. BLOCKS.
import fs from 'node:fs';
import { fillFrom, groupByMonth, matchesSearch, parseAmount, payeeMatches, readStickyDate, runningBalances, sortNewest, writeStickyDate, longDate, shortDate } from '../src/moneyRegister.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => fs.readFileSync(p, 'utf8');

// ── where things are
const menu = read('src/menuConfig.js');
expect(/label: 'Money', view: 'finance', sub: 'ledger'/.test(menu), 'tapping Money no longer opens My Transactions (the register)');
expect(/label: 'Finance Dashboard', view: 'finance', sub: 'dashboard'/.test(menu), 'the Finance Dashboard menu entry no longer asks for the dashboard, so it would land on the register');
const shell = read('src/views/AccountingViews.jsx');
expect(/useState\(initialSub \|\| 'ledger'\)/.test(shell), 'the Money room no longer opens on the register by default');
expect(!/aria-label="Finance mode"/.test(shell) && !/changeUserMode/.test(shell), 'the Agent / Partner / Coach switch is back on top of the money screens — it belongs in Settings');
expect(/<MoneyModeSetting userId=\{userId\} \/>/.test(read('src/views/SettingsView.jsx')), 'Settings no longer offers the Agent / Partner / Coach choice — nothing else can change it');
const mode = read('src/views/MoneyModeSetting.jsx');
for (const m of ['agent', 'partner', 'coach']) expect(mode.includes(`['${m}',`), `the Money view setting lost the ${m} choice`);
const ledger = read('src/views/FinanceLedger.jsx');
expect(/<MoneyRegister\b/.test(ledger), 'My Transactions no longer draws the register');
for (const keep of ['TransactionModal', 'CsvImportModal', 'RecurringList', 'BulkCategorizeModal']) expect(new RegExp(`<${keep}\\b`).test(ledger), `${keep} is no longer reachable from My Transactions — nothing disappears`);
const reg = read('src/views/MoneyRegister.jsx');
expect(/readStickyDate\(today\)/.test(reg) && /writeStickyDate\(today, d\)/.test(reg), 'the entry date is no longer remembered between entries');
expect(/rpc\('my_account_balances'\)/.test(reg), 'account balances are no longer added up in the database (the phone only holds the newest entries)');
expect(!/new Date\(t\.date\)|new Date\(date\)/.test(reg + read('src/moneyRegister.js')), 'a date is being read with new Date(text) — that shows the day before in Tampa');
const sql = read('supabase/sql/2026-10-05_money_accounts.sql');
expect(/revoke all on function public\.my_account_balances\(\) from public, anon/.test(sql) && /revoke all on function public\.set_account_starting_balance\(text, numeric\) from public, anon/.test(sql), 'the account balance functions can be called without signing in');

// ── how it thinks
const T = (id, date, amount, payee, more = {}) => ({ id, date, amount, payee, scope: 'business', created_at: `${date}T12:00:0${id}Z`, ...more });
const book = [
  T(1, '2026-07-01', -389, 'Stellar MLS', { tax_category_id: 'dues', description: 'Quarterly MLS fee', account: 'Biz Visa', lead_gen_system_id: 'oh' }),
  T(2, '2026-10-01', -395, 'Stellar MLS', { tax_category_id: 'dues', description: 'Quarterly MLS fee', account: 'Biz Visa', lead_gen_system_id: 'oh' }),
  T(3, '2026-03-14', -180, 'Stewart’s Signs', { tax_category_id: 'mkt', account: 'Biz Visa' }),
  T(4, '2026-09-03', 6120, 'Realty ONE Group Advantage', { account: 'Biz Checking' }),
  T(5, '2026-10-01', -12.5, 'Shell', { account: 'biz visa ' }),
  T(6, '2026-01-05', -40, 'Old Steakhouse', { is_archived: true }),
];
const m = payeeMatches(book, 'Ste');
expect(m.length === 2 && m[0].payee === 'Stellar MLS' && m[1].payee === 'Stewart’s Signs', `typing "Ste" should offer Stellar MLS then Stewart’s Signs, once each, and no removed entries — got ${JSON.stringify(m.map((x) => x.payee))}`);
expect(m[0].last.id === 2, 'a payee match must carry that payee’s MOST RECENT entry');
expect(payeeMatches(book, 'S').length === 0, 'one letter is too little to offer a match on');
expect(payeeMatches(book, 'group')[0]?.payee === 'Realty ONE Group Advantage', 'a match should be found on any word of the payee, not only the first');
const f = fillFrom(book[1]);
expect(f.amount === '395.00' && f.direction === 'out' && f.taxCategoryId === 'dues' && f.description === 'Quarterly MLS fee' && f.account === 'Biz Visa' && f.systemId === 'oh', 'taking a match must fill amount, category, description, account and lead source from that entry');
expect(!('date' in f), 'taking a match must NOT move the date: the date box is the person’s own');
expect(fillFrom(book[3]).direction === 'in', 'money that came in must fill as money in');

const sorted = sortNewest(book);
expect(sorted[0].id === 5 && sorted[1].id === 2 && sorted[sorted.length - 1].id === 6, 'the register is no longer newest first (same day: latest written first)');
expect(groupByMonth(sorted.filter((t) => !t.is_archived)).map((g) => g.label).join('|') === 'October 2026|September 2026|July 2026|March 2026', 'the register no longer groups by month, newest month first');
expect(shortDate('2026-10-01') === 'Oct 1' && longDate('2026-10-05') === 'Mon, Oct 5, 2026', 'a date is shown a day off or in the wrong form');

const names = { category: 'Dues and subscriptions', system: '' };
const hit = (q, t = book[0], n = names) => matchesSearch(t, q, n);
expect(hit('stellar') && hit('STELLAR july') && hit('dues') && hit('visa 389') && hit('$389.00') && hit('2026 quarterly') && hit('7/1'), 'the search should find an entry by payee, month, category, account, amount, year or description, in any mix');
expect(!hit('stellar august') && !hit('38') && !hit('390'), 'the search matched an entry it should not have (every word must be found; an amount must be the amount)');
expect(matchesSearch(book[3], 'income', {}) && !matchesSearch(book[0], 'income', names), 'searching "income" should find money in and only money in');

const visa = sortNewest(book.filter((t) => !t.is_archived && String(t.account || '').trim().toLowerCase() === 'biz visa'));
const bal = runningBalances(visa, -976.5);
expect(visa.length === 4 && bal.get(5) === -976.5 && bal.get(2) === -964 && bal.get(1) === -569 && bal.get(3) === -180, `an account’s balance after each line does not add up: ${JSON.stringify([...bal])}`);

expect(parseAmount('1,250.50') === 1250.5 && parseAmount('$89') === 89 && parseAmount('abc') === null && parseAmount('') === null && parseAmount('0') === null && parseAmount('-5') === null, 'the amount box accepts something that is not an amount, or refuses one that is');

const mem = new Map(); const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
expect(readStickyDate('2026-10-05', store) === '2026-10-05', 'the date must start on today');
writeStickyDate('2026-10-05', '2026-08-15', store);
expect(readStickyDate('2026-10-05', store) === '2026-08-15', 'a changed date must stay for the next entry');
expect(readStickyDate('2026-10-06', store) === '2026-10-06', 'yesterday’s catch-up date must not carry into a new day');
writeStickyDate('2026-10-05', '2026-10-05', store);
expect(readStickyDate('2026-10-05', store) === '2026-10-05' && mem.size === 0, 'changing the date back to today must clear the remembered date');

if (problems.length) { console.error(`\n==== MONEY REGISTER: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== MONEY REGISTER: clean — Money opens on the register; payee match, sticky date, search and balances behave ====');
