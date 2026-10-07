// receipts_guard.mjs — a receipt finds its entry; recurring entries are
// watched; the tax hold-back is the same arithmetic as the quarterly report;
// the mileage log is priced at the year's IRS rate.
//
// Dara, 6 Oct 2026 (build prompt, part 5): "Photograph a receipt; PrismOS
// reads it and attaches it to the matching bank line automatically."
// "PrismOS notices when one is missing or its amount changed." "Tax set-aside
// ... Labeled an estimate, not advice." "Mileage log ... priced at that year's
// IRS rate." BLOCKS.
//
// Holds:
//  (static) the hold-back is the extra tax one commission adds and always
//    says it is an estimate; a receipt's file goes under its books; the reader
//    asks the database who keeps a book before it reads a shared receipt.
//  (live, two throwaway people) a receipt attaches only when exactly one entry
//    fits, never onto one that has a receipt, never from another book's
//    folder; two candidates are offered, not chosen; a monthly payment that is
//    missing or changed is noticed, a dismissed notice stays dismissed, and a
//    stranger learns nothing; the current year's mileage rate is on file.
import { readFileSync } from 'node:fs';
import { nextEstimatedDue, setAside, setAsideSentence } from '../src/taxSetAside.js';
import { computeSETax } from '../src/taxMath.js';
import { mileageTable } from '../src/bookReports.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

// ── static ─────────────────────────────────────────────────────────────────
{ const first = setAside(10000, 0), se = Math.round(computeSETax(10000).total);
  expect(first.amount === se && first.pct === Math.round(se / 100), `the first dollars of profit should owe self-employment tax and nothing else: ${JSON.stringify(first)} vs ${se}`);
  const high = setAside(10000, 90000), mfj = setAside(10000, 90000, { filingStatus: 'mfj' });
  expect(high.amount > first.amount && mfj.amount < high.amount && high.pct >= 30 && high.pct <= 40, `the hold-back does not rise with the bracket the money lands in: ${JSON.stringify([first, high, mfj])}`);
  expect(setAside(0, 5000).amount === 0 && setAside(-50, 5000).amount === 0 && setAsideSentence(0, 0, {}, '2026-10-06') === '', 'a hold-back is suggested on no income');
  expect(/estimate, not tax advice/.test(setAsideSentence(6150, 80000, {}, '2026-10-06')) && /January 15/.test(setAsideSentence(6150, 80000, {}, '2026-10-06')), 'the hold-back no longer says it is an estimate, or names the wrong due date');
  expect(nextEstimatedDue('2026-04-15') === 'April 15' && nextEstimatedDue('2026-04-16') === 'June 15' && nextEstimatedDue('2026-09-16') === 'January 15' && nextEstimatedDue('2026-01-02') === 'April 15', 'the next estimated-tax date is wrong'); }
{ const t = mileageTable([{ date: '2026-03-02', miles: 10, is_round_trip: true, purpose: 'Showing', computed_deduction: 14.5, category: 'business' }, { date: '2025-12-30', miles: 99, computed_deduction: 69.3 }, { date: '2026-01-05', miles: 7.5, purpose: 'Listing', computed_deduction: 5.44 }],
    2026, [{ year: 2026, business_rate: 0.725, medical_rate: 0.205, charity_rate: 0.14 }]);
  const tot = t.rows.find((r) => r.kind === 'total').cells;
  expect(t.rows[0].cells[1] === 'Listing' && tot[4] === 27.5 && tot[5] === 19.94 && t.plain.includes(4) && t.rows.some((r) => r.kind === 'note' && /72\.5 cents/.test(r.cells[0])), `the mileage log is wrong: ${JSON.stringify(tot)}`); }
const rc = code('src/receipts.js');
expect(/`\$\{book\.id\}\/receipts\/\$\{name\}`/.test(rc) && /rpc\('receipt_attach'/.test(rc) && /book_id: book\.id/.test(rc), 'a receipt in shared books is no longer stored under the book and matched to its entry');
expect(/snapReceipt\(/.test(code('src/views/FinanceLedger.jsx')) && !/storage\.from\('receipts'\)\.upload/.test(code('src/views/FinanceLedger.jsx')), 'the entry form uploads receipts itself again instead of through src/receipts.js');
const fn = read('supabase/functions/parse-receipt/index.ts');
expect(/^import "\.\.\/_shared\/aiGuard\.ts";/m.test(fn) && /userClient\.rpc\('my_books_writable'\)/.test(fn) && /startsWith\(`\$\{bookId\}\/receipts\/`\)/.test(fn) && /startsWith\(`\$\{user\.id\}\/`\)/.test(fn), 'the receipt reader no longer checks whose receipt it is being asked to read');
const sql = code('supabase/sql/2026-10-07d_receipts_recurring.sql');
for (const m of sql.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/g)) expect(new RegExp(`revoke all on function public\\.${m[1]}\\(`).test(sql), `${m[1]}() in the receipts SQL does not say who may run it`);
expect(!/insert into public\.transactions/.test(sql.slice(sql.indexOf('recurring_watch'))), 'the recurring watch adds entries; it must only read');

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, status: r.status, json: j }; };
  const svc = call(H);
  const person = async (tag) => {
    const email = `smoke_receipts_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
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
    const otherBook = (((await b.rest('POST', 'rpc/my_books', {})).json || {}).books || []).find((x) => x.is_mine)?.id;
    if (!bookId || !otherBook) throw new Error('no personal book');
    const year = new Date().getUTCFullYear();
    const rate = (await rest('GET', `mileage_rates?year=eq.${year}&select=business_rate,notes`)).json?.[0];
    expect(!!rate && Number(rate.business_rate) > 0 && !/placeholder/i.test(rate.notes || ''), `the IRS mileage rate for ${year} is missing or still a placeholder: check irs.gov and set it`);
    // receipts
    const tx = (await rest('POST', 'transactions', [{ book_id: bookId, date: '2026-09-27', amount: -212.4, scope: 'business', account: 'Visa', payee: 'Home Depot' },
      { book_id: bookId, date: '2026-09-20', amount: -45, scope: 'business', account: 'Visa', payee: 'Shell' }, { book_id: bookId, date: '2026-09-21', amount: -45, scope: 'business', account: 'Visa', payee: 'Shell' }])).json;
    const hd = tx.find((t) => t.payee === 'Home Depot').id, P = (n) => `${bookId}/receipts/${n}.jpg`;
    const att = (path, amount, date, id = null, who = rest) => who('POST', 'rpc/receipt_attach', { p_book: bookId, p_path: path, p_amount: amount, p_date: date, p_transaction: id });
    const one = await att(P('a'), 212.4, '2026-09-26');
    expect(one.json?.attached === 'entry' && one.json.id === hd && (await rest('GET', `transactions?id=eq.${hd}&select=receipt_url,amount,date`)).json?.[0]?.receipt_url === P('a'), `a receipt did not attach to the one entry it fits: ${JSON.stringify(one.json)}`);
    expect((await att(P('b'), 212.4, '2026-09-26')).json?.attached === null && !(await att(P('b'), null, null, hd)).ok, 'a second receipt replaces the first');
    const two = await att(P('c'), 45, '2026-09-20');
    expect(two.json?.attached === null && two.json.choices.length === 2 && ((await rest('GET', `transactions?book_id=eq.${bookId}&payee=eq.Shell&receipt_url=not.is.null&select=id`)).json || []).length === 0, 'with two entries that fit, one was chosen for the person');
    expect((await att(P('c'), null, null, two.json.choices[1].id)).json?.attached === 'entry', 'the person cannot say which entry a receipt belongs to');
    expect((await att(P('d'), 9999.99, '2026-09-20')).json?.attached === null, 'a receipt that fits nothing was attached');
    expect(!(await att(`${otherBook}/receipts/x.jpg`, 45, '2026-09-20')).ok && !(await att(`${b.id}/x.jpg`, 45, '2026-09-20')).ok && !(await att(P('../../x'), 45, '2026-09-20')).ok, 'a file from someone else\'s folder can be attached as a receipt');
    expect(!(await att(P('z'), 45, '2026-09-20', null, b.rest)).ok && !(await rest('POST', 'rpc/receipt_candidates', { p_book: bookId, p_amount: 45, p_date: '2026-09-20' })).ok, 'someone with no seat on the books can attach or look for receipts');
    // recurring: paid on the 2nd in each of the last three full months; a second payee whose amount moved this month
    const now = new Date(), ym = (back) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)); return d.toISOString().slice(0, 8); };
    await rest('POST', 'transactions', [3, 2, 1].flatMap((k) => [{ book_id: bookId, date: ym(k) + '02', amount: -1800, scope: 'business', account: 'Checking', payee: k === 1 ? 'gate landlord' : 'Gate Landlord' },
      { book_id: bookId, date: ym(k) + '03', amount: -389.5, scope: 'business', account: 'Checking', payee: 'Gate Software' }]).concat([{ book_id: bookId, date: ym(0) + '01', amount: -429.5, scope: 'business', account: 'Checking', payee: 'Gate Software' },
      { book_id: bookId, date: ym(1) + '05', amount: -20, scope: 'business', account: 'Checking', payee: 'Gate Once' }]));
    const early = (await rest('POST', 'rpc/book_recurring_watch', { p_book: bookId, p_today: ym(0) + '04' })).json || [];
    const late = (await rest('POST', 'rpc/book_recurring_watch', { p_book: bookId, p_today: ym(0) + '20' })).json || [];
    const L = late.find((r) => r.key === 'gate landlord'), S = late.find((r) => r.key === 'gate software');
    expect(!early.some((r) => r.kind === 'missing') && L?.kind === 'missing' && Number(L.usual) === 1800 && S?.kind === 'changed' && Number(S.now) === 429.5 && !late.some((r) => r.key === 'gate once'), `a monthly payment that is missing or changed is not noticed, or one is cried too early: ${JSON.stringify({ early, late })}`);
    const count = ((await rest('GET', `transactions?book_id=eq.${bookId}&select=id`)).json || []).length;
    await rest('POST', 'rpc/recurring_watch_dismiss', { p_book: bookId, p_key: 'Gate Landlord', p_month: ym(0) + '20' });
    const after = (await rest('POST', 'rpc/book_recurring_watch', { p_book: bookId, p_today: ym(0) + '20' })).json || [];
    expect(!after.some((r) => r.key === 'gate landlord') && after.some((r) => r.key === 'gate software') && ((await rest('GET', `transactions?book_id=eq.${bookId}&select=id`)).json || []).length === count, 'a dismissed notice comes back, or the watch added an entry');
    expect(((await b.rest('POST', 'rpc/book_recurring_watch', { p_book: bookId, p_today: ym(0) + '20' })).json || []).length === 0 && !(await b.rest('POST', 'rpc/recurring_watch_dismiss', { p_book: bookId, p_key: 'gate software', p_month: ym(0) + '01' })).ok
      && !(await rest('POST', 'recurring_watch_seen', { book_id: bookId, payee_key: 'x', month: ym(0) + '01' })).ok, 'a stranger learns what these books pay each month, or the dismissals can be written directly');
    const health = await svc('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run');
    else for (const h of health.json.slice(0, 8)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('receipts_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== RECEIPTS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== RECEIPTS: clean — a receipt attaches only where exactly one entry fits; a missing or changed monthly payment is noticed; the hold-back is an estimate and says so ====');
