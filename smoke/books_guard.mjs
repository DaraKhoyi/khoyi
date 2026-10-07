// books_guard.mjs — the privacy wall around every set of books.
//
// Dara, 6 Oct 2026: "An agent's own books belong to the agent ... The brokerage
// sees only the brokerage book." Being Broker or Broker Admin grants NOTHING on
// anyone else's books; only a name on that book's access list does. A team
// leader can switch an assistant off and it takes effect on the assistant's
// next tap. Cross-agent leaks have happened in PrismOS before: this BLOCKS.
//
// Holds:
//  (static) the thinking in src/books.js against known answers; the open book's
//    name is on screen the whole time; every Money screen that reads or writes
//    entries goes through inBook()/stamp(), never a bare user_id filter; the
//    database file gates nothing on being brokerage staff.
//  (live, three throwaway people signed in for real: an owner, a helper, and an
//    outsider who IS a Broker Admin) for EVERY accounting table: the outsider
//    and the helper-before-being-added read zero rows; nobody without a seat
//    can add, change or plant a row, whatever user_id or book_id they send; an
//    assistant can enter but cannot touch account settings, the access list or
//    closing; switching the assistant off stops reads and writes at once on the
//    SAME sign-in and keeps their work with their name on it; switching on gives
//    the same role back; read-only reads and changes nothing; the record of
//    changes cannot be edited by anyone, the database's own key included; a
//    signed-out caller gets nothing; and (with a management token) every table
//    that carries a book_id is one this guard knows and has row-level security.
import { readFileSync, readdirSync } from 'node:fs';
import { ROLES, can, canChangeSeat, chooseBook, historyLine, inBook, isDenied, isOwnBook, periodRange, rolesICanGive, seatStatus, showBookBar, stamp, summarize, bookTitle } from '../src/books.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Every table that holds accounting data. A new one MUST be added here (the
// live half fails on a book_id table it has not been told about).
const TABLES = ['books', 'book_access', 'book_log', 'transactions', 'tax_categories', 'money_accounts', 'recurring_transactions', 'accounting_access', 'book_category_templates', 'ledger_accounts', 'gl_entries', 'gl_lines', 'gl_live',
  'statement_imports', 'statement_lines', 'payee_rules', 'statement_layouts', 'book_reconciliations', 'recon_marks'];

// ── static: the thinking ───────────────────────────────────────────────────
const own = { id: 'p', kind: 'personal', is_mine: true, role: 'owner', label: 'Avery' };
const brok = { id: 'b', kind: 'brokerage', is_mine: false, role: 'admin', label: 'Realty ONE Group Advantage' };
const team = { id: 't', kind: 'team', is_mine: false, role: 'assistant', label: 'Team Blue Koala' };
const theirs = { id: 'o', kind: 'personal', is_mine: false, role: 'read_only', label: 'Jordan Lee' };
expect(ROLES.join() === 'owner,admin,assistant,read_only', 'the four roles changed');
expect(can(own, 'write') && can(own, 'people') && can(own, 'accounts') && can(own, 'close'), 'an owner lost something an owner may do');
expect(can(brok, 'people') && can(brok, 'accounts') && can(brok, 'close'), 'an admin lost something an admin may do');
expect(can(team, 'write') && !can(team, 'people') && !can(team, 'accounts') && !can(team, 'close'), 'an assistant may enter, and may NOT change account settings, the access list or closing');
expect(can(theirs, 'read') && !can(theirs, 'write') && !can(theirs, 'people'), 'a read-only seat is being offered something that changes the books');
expect(can(null, 'write') && !can(null, 'people'), 'without a book list Money must still work on the person\'s own rows, and offer no access list');
expect(isOwnBook(null) && isOwnBook(own) && !isOwnBook(brok) && !isOwnBook(theirs), 'whose books are "mine" is being decided wrongly');
expect(bookTitle(own) === 'My books' && bookTitle(brok) === 'Realty ONE Group Advantage' && bookTitle(theirs) === 'Jordan Lee’s books', 'a book is being named wrongly on the bar');
expect(JSON.stringify(stamp(brok, 'u1')) === '{"book_id":"b"}' && JSON.stringify(stamp(null, 'u1')) === '{"user_id":"u1"}', 'a new entry is not being filed in the open book');
{ const seen = []; const q = { eq: (k, v) => { seen.push(k + '=' + v); return q; } }; inBook(q, team, 'u1'); inBook(q, null, 'u1');
  expect(seen.join() === 'book_id=t,user_id=u1', 'a screen is not asking for the open book\'s rows'); }
expect(chooseBook([own, brok, team], {}).id === 'p', 'Money must open on the person\'s own books by default');
expect(chooseBook([own, brok, team], { remembered: 't' }).id === 't', 'the book this person was last in is not remembered');
expect(chooseBook([own, brok, team], { remembered: 't', want: 'brokerage' }).id === 'b', '"Brokerage Financials" does not open the brokerage\'s books');
expect(chooseBook([own, team], { remembered: 'gone', want: 'brokerage' }).id === 'p', 'a book that is no longer on the list (switched off) must fall back to the person\'s own');
expect(chooseBook([], {}) === null, 'no books must mean no book, so Money falls back to the person\'s own rows');
expect(!showBookBar({ enabled: false, books: [own] }) && showBookBar({ enabled: true, books: [own] }) && showBookBar({ enabled: false, books: [own, team] }), 'the book bar is shown to people it is not switched on for, or hidden from someone who is on a second set of books');
expect(rolesICanGive('owner').length === 4 && rolesICanGive('admin').join() === 'admin,assistant,read_only' && rolesICanGive('assistant').length === 0, 'someone is offered a role they may not hand out');
expect(canChangeSeat('owner', { role: 'owner' }) && !canChangeSeat('admin', { role: 'owner' }) && canChangeSeat('admin', { role: 'assistant' }) && !canChangeSeat('owner', { role: 'owner', is_book_owner: true }) && !canChangeSeat('assistant', { role: 'read_only' }), 'the access list offers a change the database will refuse, or hides one it allows');
expect(seatStatus({ is_active: true }) === 'On' && seatStatus({ is_active: false }) === 'Switched off' && /email/i.test(seatStatus({ waiting_for: 'email' })) && /sign-in/i.test(seatStatus({ waiting_for: 'sign_in' })) && /Switch on/.test(seatStatus({ is_active: false, awaiting_ok: true })), 'a seat\'s state is described wrongly');
expect(historyLine({ action: 'access_off', who: 'Myra Torres', by: 'Tina Danielson' }) === 'Tina Danielson switched Myra Torres off' && historyLine({ action: 'access_granted', who: 'Myra Torres', by: 'Dara Khoyi', detail: { role: 'assistant' } }) === 'Dara Khoyi added Myra Torres as Assistant', 'the record of changes no longer reads as plain sentences');
expect(isDenied({ code: '42501' }) && isDenied({ message: 'new row violates row-level security policy for table "transactions"' }) && !isDenied({ code: '23505', message: 'duplicate key' }) && !isDenied(null), 'a refusal for lack of access is not told apart from other errors');
{ const r = periodRange('month', '2026-02-10'), l = periodRange('last', '2026-01-15'), y = periodRange('year', '2026-10-06');
  expect(r.from === '2026-02-01' && r.to === '2026-02-28' && l.from === '2025-12-01' && l.to === '2025-12-31' && y.from === '2026-01-01' && y.to === '2026-12-31' && periodRange('all', '2026-10-06').from === null, 'a report period starts or ends on the wrong day'); }
{ const s = summarize([
    { category_id: 1, name: 'Management Fees', kind: 'income', entries: 2, money_in: 5150, money_out: 0 },
    { category_id: 2, name: 'Software', kind: 'expense', entries: 2, money_in: 10, money_out: 399.5 },
    { category_id: 3, name: 'Rent Collected for Owners', kind: 'held', entries: 1, money_in: 2150, money_out: 0 },
    { category_id: 4, name: 'Owner Payouts', kind: 'held', entries: 1, money_in: 0, money_out: 1890 },
    { category_id: 5, name: 'Transfers', kind: 'other', entries: 1, money_in: 0, money_out: 640 },
    { category_id: null, name: '', kind: 'none', entries: 1, money_in: 0, money_out: 212.4 }]);
  expect(s.totalIncome === 5150 && s.totalExpense === 389.5 && s.net === 4548.1 && s.heldNow === 260 && s.uncategorized.entries === 1 && s.other.length === 1,
    `the summary does not add up, or counts money held for others (or a transfer) as income or spending: ${JSON.stringify({ in: s.totalIncome, out: s.totalExpense, net: s.net, held: s.heldNow })}`); }

// ── static: where things are ───────────────────────────────────────────────
const shell = code('src/views/AccountingViews.jsx');
expect(/showBookBar\(bk\) && <BookBar /.test(shell) && /isOwnBook\(bk\.book\)/.test(shell) && /<BookRoom key=\{bk\.book\.id\}/.test(shell), 'the Money room no longer shows whose books are open, or no longer opens a shared book in its own room');
const bar = code('src/views/BookBar.jsx');
expect(bar.includes('data-testid="book-name"') && bar.includes('data-testid="book-switch"') && /can\(book, 'people'\)/.test(bar), 'the bar lost the book\'s name, the switcher, or shows People to someone who may not manage access');
expect(/\.bk-bar \{[^}]*position: sticky/.test(read('src/index.css')), 'the book\'s name no longer stays on screen while Money scrolls');
for (const f of ['MoneyRegister', 'CsvImportModal', 'FinanceLedger', 'BookRoom']) {
  const src = code(`src/views/${f}.jsx`);
  expect(!/from\('transactions'\)[^;\n]*\.eq\('user_id'/.test(src), `${f} reads entries by user_id on its own — in someone else's books that shows the person their OWN entries under the wrong name. Use inBook().`);
  if (f !== 'BookRoom') expect(/stamp\(book, userId\)/.test(src), `${f} no longer files a new entry in the open book (stamp)`);
}
expect(!/user_id: userId, date/.test(code('src/views/MoneyRegister.jsx') + code('src/views/CsvImportModal.jsx')), 'an entry form is filing rows as the signed-in person instead of in the open book');
expect(/rpc\('book_possible_duplicates'/.test(code('src/views/MoneyRegister.jsx')), 'typing in an entry no longer asks "did I already enter this?"');
expect(/rpc\('book_account_balances', \{ p_book: bookId \}\)/.test(code('src/views/MoneyRegister.jsx')), 'account balances are no longer the open book\'s');
expect(/inBook\(supabase\.from\('transactions'\)\.select\('id, date, amount, payee, external_id'\), book, userId\)/.test(code('src/views/CsvImportModal.jsx')), 'an imported statement is no longer checked against everything already in the books');
const sqlFiles = readdirSync('supabase/sql').filter((f) => /books/.test(f)).sort();
const sql = sqlFiles.map((f) => read('supabase/sql/' + f)).join('\n');
const sqlCode = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
expect(!/is_brokerage_staff\s*\(|app_role\s*\(/.test(sqlCode), 'the books rules consult brokerage staff status — being Broker or Broker Admin must grant nothing on a book');
expect(!/create policy (?![^;]*\bto authenticated\b)[^;]*;/.test(sqlCode), 'a books policy does not name its role (to authenticated)');
expect(!/using \(true\)/.test(sqlCode), 'a books rule lets everyone read');
for (const fn of ['my_books()', 'book_people(uuid)', 'book_grant(uuid, text, text, text)', 'book_set_active(uuid, boolean)', 'book_set_role(uuid, text)', 'book_remove(uuid)', 'book_history(uuid, integer)', 'book_summary(uuid, date, date)', 'book_account_balances(uuid)', 'set_book_account(uuid, text, numeric, text)', 'book_names(uuid)', 'book_set_closed_through(uuid, date)'])
  expect(sqlCode.includes(`revoke all on function public.${fn} from public, anon`), `${fn} can be called without signing in`);
for (const fn of ['ensure_personal_book(uuid)', 'book_seed_categories(uuid)', 'book_claim_seats(uuid)', 'book_seat_check(uuid, text, boolean)', 'book_log_add(uuid, text, uuid, text, uuid, jsonb)', 'book_person_label(uuid)'])
  expect(sqlCode.includes(`revoke all on function public.${fn} from public, anon, authenticated`), `${fn} is an inside helper that a signed-in person can call directly`);

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY, PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = []; let teamBook = null; const stamp0 = Date.now();
  const svc = async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; };
  const person = async (tag) => {
    const email = `smoke_books_${tag}_${stamp0}@example.com`, password = 'Smoke!' + stamp0;
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, tok, email };
  };
  const as = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
  const rest = async (tok, method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: as(tok), body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); return { ok: r.ok, status: r.status, json: j }; };
  const rows = (x) => (Array.isArray(x.json) ? x.json : []);
  const rpc = (tok, fn, args) => rest(tok, 'POST', `rpc/${fn}`, args || {});
  try {
    const A = await person('owner'), B = await person('helper'), C = await person('staff');
    // C is a Broker Admin. That must open nobody's books.
    await svc('POST', 'agents', { user_id: C.id, auth_user_id: C.id, name: 'Smoke Books Staff', role: 'broker_admin' });
    expect((await rpc(C.tok, 'is_brokerage_staff')).json === true, 'the outsider in this test is not actually brokerage staff — the staff check below would prove nothing');
    await svc('POST', 'accounting_access', { user_id: A.id, note: 'books_guard' });

    // A's own books, the way a phone on the previous version writes: user_id only.
    const mine = await rpc(A.tok, 'my_books');
    const ownBook = (mine.json?.books || []).find((b) => b.is_mine);
    expect(mine.ok && mine.json?.enabled === true && !!ownBook && ownBook.role === 'owner', 'a person does not get their own books, as owner, the first time they open Money');
    const legacy = await rest(A.tok, 'POST', 'transactions', { user_id: A.id, date: '2026-10-01', amount: -42.18, scope: 'business', payee: 'Shell', account: 'Biz Visa' });
    expect(legacy.ok && legacy.json?.[0]?.book_id === ownBook?.id && legacy.json?.[0]?.user_id === A.id, 'an entry saved the old way (user_id only) is not filed in the person\'s own books');
    expect((rows(await rpc(A.tok, 'my_account_balances'))[0] || {}).account === 'Biz Visa', 'the previous version\'s account balances stopped working');
    expect(rows(await rest(A.tok, 'GET', `tax_categories?book_id=eq.${ownBook?.id}&select=id`)).length >= 15, 'a person this is switched on for did not get the starter categories');

    // A shared book A owns.
    teamBook = (await svc('POST', 'books', { kind: 'team', template: 'team', name: `Smoke Books Team ${stamp0}`, principal_user_id: A.id }))[0].id;
    await svc('POST', 'rpc/book_seed_categories', { p_book: teamBook });
    await svc('POST', 'book_access', { book_id: teamBook, user_id: A.id, role: 'owner' });
    const cat = rows(await rest(A.tok, 'GET', `tax_categories?book_id=eq.${teamBook}&select=id&limit=1`))[0]?.id;
    const shared = await rest(A.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-02', amount: 4200, scope: 'personal', payee: 'Sunrise Villas', account: 'Operating', tax_category_id: cat });
    const row = shared.json?.[0];
    expect(shared.ok && row?.user_id === null && row?.entered_by === A.id && row?.scope === 'business', 'an entry in shared books is not held by the BOOK (user_id empty), signed by who entered it, as business money');
    await rpc(A.tok, 'set_book_account', { p_book: teamBook, p_account: 'Operating', p_amount: 1000, p_kind: 'bank' });
    const knownRows = async (tok, t) => rows(await rest(tok, 'GET', `${t}?select=*&limit=50`));
    expect((await knownRows(A.tok, 'transactions')).length === 2 && (await knownRows(A.tok, 'books')).length === 2 && (await knownRows(A.tok, 'book_log')).length > 0 && (await knownRows(A.tok, 'money_accounts')).length >= 2 && (await knownRows(A.tok, 'gl_lines')).length >= 4 && (await knownRows(A.tok, 'gl_live')).length >= 2,
      'the owner cannot see their own books — the checks below would pass on an empty table and prove nothing');

    // THE WALL. Neither a Broker Admin with no seat, nor another agent, reads one row of any accounting table.
    for (const [who, P] of [['a Broker Admin with no seat', C], ['another agent', B]]) {
      for (const t of TABLES) {
        const got = await rest(P.tok, 'GET', `${t}?select=*&limit=50`);
        expect(rows(got).length === 0, `${who} can read ${rows(got).length} row(s) of ${t}`);
      }
      expect(!(await rest(P.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-03', amount: -1, scope: 'business' })).ok, `${who} can add an entry to a book they are not on`);
      expect(!(await rest(P.tok, 'POST', 'transactions', { user_id: A.id, date: '2026-10-03', amount: -1, scope: 'business' })).ok, `${who} can add an entry to someone's own books by sending that person's user_id`);
      expect(!(await rest(P.tok, 'POST', 'transactions', { user_id: P.id, book_id: ownBook.id, date: '2026-10-03', amount: -1, scope: 'business' })).ok, `${who} can plant an entry in someone's books by sending their own user_id with the other book`);
      expect(rows(await rest(P.tok, 'PATCH', `transactions?id=eq.${row.id}`, { payee: 'changed by an outsider' })).length === 0, `${who} can change an entry in a book they are not on`);
      expect(!(await rest(P.tok, 'POST', 'book_access', { book_id: teamBook, user_id: P.id, role: 'owner' })).ok, `${who} can put themselves on a book's access list`);
      for (const fn of ['book_people', 'book_history', 'book_names']) expect(!(await rpc(P.tok, fn, { p_book: teamBook })).ok, `${who} can call ${fn} on a book they are not on`);
      expect(rows(await rpc(P.tok, 'book_entry_history', { p_tx: row.id })).length === 0 && (((await rpc(P.tok, 'book_position', { p_book: teamBook })).json?.lines) || []).length === 0, `${who} can read a book's ledger history or where it stands`);
      expect(!(await rpc(P.tok, 'book_grant', { p_book: teamBook, p_email: P.email, p_name: 'Me', p_role: 'owner' })).ok, `${who} can grant themselves access`);
      expect(((await rpc(P.tok, 'book_summary', { p_book: teamBook })).json?.lines || []).length === 0 && rows(await rpc(P.tok, 'book_account_balances', { p_book: teamBook })).length === 0, `${who} can read a book's totals or balances`);
      expect(!(await rpc(P.tok, 'set_book_account', { p_book: teamBook, p_account: 'Operating', p_amount: 5 })).ok && !(await rpc(P.tok, 'book_set_closed_through', { p_book: teamBook, p_date: '2026-09-30' })).ok, `${who} can change a book's account settings or close it`);
    }
    expect(rows(await rest(A.tok, 'GET', `transactions?id=eq.${row.id}&select=payee`))[0]?.payee === 'Sunrise Villas', 'an outsider changed an entry');

    // The assistant: on, working, off at once, on again, read-only.
    const g = await rpc(A.tok, 'book_grant', { p_book: teamBook, p_email: B.email, p_name: 'Smoke Helper', p_role: 'assistant' });
    expect(g.ok && g.json?.status === 'active', 'the owner cannot add an assistant who already has a sign-in');
    const seat = g.json?.id;
    const bEntry = await rest(B.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-04', amount: -55, scope: 'business', payee: 'Entered by the helper' });
    expect(bEntry.ok && bEntry.json?.[0]?.entered_by === B.id && bEntry.json?.[0]?.user_id === null, 'an assistant cannot enter, or the entry is not signed with the assistant\'s name');
    expect(rows(await rest(B.tok, 'GET', `transactions?book_id=eq.${teamBook}&select=id`)).length === 2, 'an assistant cannot read the book they were added to');
    expect(rows(await rest(B.tok, 'GET', `transactions?book_id=eq.${ownBook.id}&select=id`)).length === 0, 'an assistant on the TEAM book can read the owner\'s OWN books');
    expect(!(await rpc(B.tok, 'set_book_account', { p_book: teamBook, p_account: 'Operating', p_amount: 9 })).ok && !(await rest(B.tok, 'POST', 'money_accounts', { book_id: teamBook, name: 'Sneaky', starting_balance: 1 })).ok, 'an assistant can change bank account settings');
    expect(!(await rpc(B.tok, 'book_grant', { p_book: teamBook, p_email: C.email, p_name: 'x', p_role: 'read_only' })).ok && !(await rpc(B.tok, 'book_people', { p_book: teamBook })).ok, 'an assistant can see or change who has access');
    expect(!(await rpc(B.tok, 'book_set_closed_through', { p_book: teamBook, p_date: '2026-09-30' })).ok, 'an assistant can close or reopen the books');
    expect(!(await rpc(B.tok, 'book_set_active', { p_access: seat, p_on: true })).ok, 'an assistant can work the switch');

    expect((await rpc(A.tok, 'book_set_active', { p_access: seat, p_on: false })).ok, 'the owner cannot switch the assistant off');
    expect(rows(await rest(B.tok, 'GET', `transactions?book_id=eq.${teamBook}&select=id`)).length === 0, 'a switched-off assistant can still read, on the same sign-in');
    expect(!(await rest(B.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-05', amount: -1, scope: 'business' })).ok, 'a switched-off assistant can still enter, on the same sign-in');
    expect(!((await rpc(B.tok, 'my_books')).json?.books || []).some((b) => b.id === teamBook), 'a switched-off assistant still has the book in their switcher');
    expect(rows(await rest(A.tok, 'GET', `transactions?book_id=eq.${teamBook}&entered_by=eq.${B.id}&select=id`)).length === 1, 'switching the assistant off lost their work, or it is no longer attributed to them');
    expect((await rpc(A.tok, 'book_set_active', { p_access: seat, p_on: true })).ok && ((await rpc(B.tok, 'my_books')).json?.books || []).find((b) => b.id === teamBook)?.role === 'assistant', 'switching the assistant back on does not restore the same role');

    expect((await rpc(A.tok, 'book_set_role', { p_access: seat, p_role: 'read_only' })).ok, 'the owner cannot make a seat read-only');
    expect(rows(await rest(B.tok, 'GET', `transactions?book_id=eq.${teamBook}&select=id`)).length === 2, 'a read-only seat cannot read');
    expect(!(await rest(B.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-05', amount: -1, scope: 'business' })).ok && rows(await rest(B.tok, 'PATCH', `transactions?id=eq.${row.id}`, { payee: 'x' })).length === 0, 'a read-only seat can add or change an entry');

    // The owner's own protections, and the record.
    const mySeat = (rows(await rpc(A.tok, 'book_people', { p_book: teamBook })).find((p) => p.is_you) || {}).id;
    expect(!(await rpc(A.tok, 'book_set_active', { p_access: mySeat, p_on: false })).ok && !(await rpc(A.tok, 'book_remove', { p_access: mySeat })).ok, 'a book can be left with no owner');
    expect(!(await rest(A.tok, 'PATCH', `transactions?id=eq.${row.id}`, { book_id: ownBook.id })).ok, 'an entry can be moved from one set of books to another');
    expect((await rpc(A.tok, 'book_set_closed_through', { p_book: teamBook, p_date: '2026-10-02' })).ok && !(await rest(A.tok, 'PATCH', `transactions?id=eq.${row.id}`, { amount: 1 })).ok && !(await rest(A.tok, 'POST', 'transactions', { book_id: teamBook, date: '2026-10-01', amount: -1, scope: 'business' })).ok,
      'a closed period can still be changed');
    expect((await rpc(A.tok, 'book_set_closed_through', { p_book: teamBook, p_date: null })).ok, 'the owner cannot reopen the books');
    const hist = rows(await rpc(A.tok, 'book_history', { p_book: teamBook })).map((h) => h.action);
    for (const a of ['access_granted', 'access_off', 'access_on', 'access_role', 'closed', 'reopened']) expect(hist.includes(a), `the record of changes is missing "${a}"`);
    const logBefore = (await svc('GET', `book_log?book_id=eq.${teamBook}&select=id`)).length;
    await rest(A.tok, 'PATCH', `book_log?book_id=eq.${teamBook}`, { action: 'forged' }); await rest(A.tok, 'DELETE', `book_log?book_id=eq.${teamBook}`);
    const forged = await fetch(`${URL_}/rest/v1/book_log?book_id=eq.${teamBook}`, { method: 'PATCH', headers: H, body: JSON.stringify({ action: 'forged' }) });
    const after = await svc('GET', `book_log?book_id=eq.${teamBook}&select=id,action`);
    expect(!forged.ok && after.length >= logBefore && !after.some((l) => l.action === 'forged'), 'the record of changes can be edited or deleted');
    expect(after.some((l) => l.action === 'entry_added') && after.some((l) => l.action === 'account_added'), 'entries or account settings are no longer written to the record');

    // Signed out.
    for (const t of TABLES) { const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }); const j = await r.json().catch(() => null); expect(!Array.isArray(j) || j.length === 0, `a signed-out caller can read ${t}`); }
    expect(!(await fetch(`${URL_}/rest/v1/rpc/my_books`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}' })).ok, 'a signed-out caller can ask for a list of books');

    // Structure: no accounting table this guard has not been told about, and each one locked.
    if (PAT) {
      const q = await fetch(`https://api.supabase.com/v1/projects/${new URL(URL_).hostname.split('.')[0]}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
        body: JSON.stringify({ query: "select c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (c.relname = any (array['books','book_access','book_log','accounting_access','book_category_templates','ledger_accounts','gl_entries','gl_lines']) or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'book_id' and not a.attisdropped))" }) });
      const tabs = await q.json();
      if (!Array.isArray(tabs)) problems.push('could not read the table list: ' + JSON.stringify(tabs).slice(0, 160));
      else for (const t of tabs) { expect(TABLES.includes(t.t), `table ${t.t} carries a book_id but this guard does not test it — add it to TABLES`); expect(t.rls === true, `table ${t.t} has row-level security switched off`); }
    } else console.log('books_guard: table structure not checked (needs SUPABASE_PAT or SUPABASE_ACCESS_TOKEN)');
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally {
    const quiet = async (f) => { try { await f(); } catch (e) { problems.push('cleanup failed: ' + String(e).slice(0, 160)); } };
    if (teamBook) { await quiet(() => svc('DELETE', `transactions?book_id=eq.${teamBook}`)); await quiet(() => svc('DELETE', `books?id=eq.${teamBook}`)); }
    for (const id of made) { await quiet(() => svc('DELETE', `agents?auth_user_id=eq.${id}`)); await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
  }
} else console.log('books_guard: live check not run (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY)');

if (problems.length) { console.error(`\n==== BOOKS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== BOOKS: clean — only the people on a book\'s list can read or change it; staff status opens nothing; off means off at once ====');
