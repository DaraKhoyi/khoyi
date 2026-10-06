// statements_guard.mjs — statements in: the holding area, the proof, the
// duplicates, and rules that stick.
//
// Dara, 6 Oct 2026 (build prompt, part 4): "Nothing imported touches the ledger
// directly. Every line lands in a holding area first." A statement that does
// not add up posts nothing. A possible duplicate is shown, never dropped and
// never doubled. Only a rule a person confirmed posts on its own; "an AI
// suggestion is never posted on its own." "Correcting teaches, dismissing does
// not judge." BLOCKS.
//
// Holds:
//  (static) a bank's CSV, with or without junk above the header, and an OFX
//    file both come out as the same plain lines; dates are never guessed; a
//    running-balance column proves a file either way round; the screens write
//    no entry themselves and only call the database's functions; the two
//    model functions are guarded, logged and cannot post.
//  (live, two throwaway people signed in for real, plus the service key)
//    lines brought in are NOT in the books; a statement that is off posts
//    nothing, by tap or by rule; approving posts one balanced entry and makes
//    a rule; the next statement files that payee by itself, and only that; an
//    overlapping line is flagged and cannot be approved until answered; a line
//    typed by hand in between is caught at the moment of posting; a model's
//    suggestion never posts by itself or in "approve all"; a split posts as
//    parts that add up; undo takes the entry back out; a stranger reads and
//    changes nothing; nobody writes the holding area or a rule directly; and
//    the ledger's standing checks stay clean.
import { readFileSync } from 'node:fs';
import { autoMap, balancesFromColumn, fileKind, headerSignature, looksFlipped, mapIsComplete, mapLines, parseAmount, parseCSV, parseFlexibleDate, parseOFX, tieOf } from '../src/statementParse.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

// ── static: reading a bank's file ──────────────────────────────────────────
{ const csv = 'Description,,Summary Amt.\nBeginning balance as of 09/01/2026,,"1,000.00"\n\nDate,Description,Amount,Running Bal.\n09/02/2026,"SQ *HOME DEPOT #6341, TAMPA FL","-50.25","949.75"\n09/05/2026,DEPOSIT,"2,000.00","2,949.75"\n';
  const p = parseCSV(csv), map = autoMap(p.headers), got = mapLines(p.rows, map);
  expect(p.headers.join('|') === 'Date|Description|Amount|Running Bal.' && p.rows.length === 2, `summary rows above the header were taken for the header: ${p.headers.join('|')}`);
  expect(mapIsComplete(map) && map.balance === 'Running Bal.' && map.mode === 'single', `the columns were not guessed: ${JSON.stringify(map)}`);
  expect(got.lines.length === 2 && got.lines[0].date === '2026-09-02' && got.lines[0].amount === -50.25 && got.lines[0].text === 'SQ *HOME DEPOT #6341, TAMPA FL' && got.lines[1].amount === 2000, `the lines came out wrong: ${JSON.stringify(got.lines)}`);
  const b = balancesFromColumn(got.lines), back = balancesFromColumn([...got.lines].reverse());
  expect(b && b.opening === 1000 && b.closing === 2949.75 && back && back.opening === 1000 && back.closing === 2949.75, `the running balance did not give the start and end (either file order): ${JSON.stringify([b, back])}`);
  expect(balancesFromColumn([{ amount: -5, balance: 95 }, { amount: -5, balance: 80 }]) === null, 'a running balance that does not follow the amounts was accepted as proof');
  expect(tieOf(got.lines, 1000, 2949.75).proven && tieOf(got.lines, 1000, 2900).offBy === 49.75 && tieOf(got.lines, null, 5).proven === false, 'opening + lines = closing is worked out wrong');
  expect(headerSignature([' Date ', 'DESCRIPTION']) === 'date|description', 'a file layout is not recognised by its header row'); }
{ const split = mapLines([{ D: '9/3/26', P: 'RENT', Out: '', In: '1,500.00' }, { D: '9/4/26', P: 'FEE', Out: '12.00', In: '' }, { D: '', P: 'Total', Out: '', In: '' }], { date: 'D', payee: 'P', mode: 'split', debit: 'Out', credit: 'In' });
  expect(split.lines.length === 2 && split.lines[0].amount === 1500 && split.lines[1].amount === -12 && split.left === 1, `separate money-out and money-in columns read wrong: ${JSON.stringify(split)}`); }
expect(parseAmount('(1,234.50)') === -1234.5 && parseAmount('45.00-') === -45 && parseAmount('$12') === 12 && parseAmount('n/a') === 0 && parseAmount('12.5 CR') === 12.5, 'a bank\'s way of writing an amount is misread');
expect(parseFlexibleDate('09/14/2026') === '2026-09-14' && parseFlexibleDate('14/09/2026', 'dmy') === '2026-09-14' && parseFlexibleDate('20260914120000[-5:EST]') === '2026-09-14' && parseFlexibleDate('Sep 14, 2026') === '2026-09-14', 'a bank date is misread');
expect(parseFlexibleDate('02/30/2026') === null && parseFlexibleDate('pending') === null && parseFlexibleDate('13/45/2026') === null, 'a date that is not a date was guessed at (it must come out empty so the line is flagged for a person)');
expect(looksFlipped([{ amount: 5 }, { amount: 9 }, { amount: 12 }, { amount: -100 }]) && !looksFlipped([{ amount: -5 }, { amount: -9 }, { amount: 12 }, { amount: -100 }]), 'a card file that shows charges as positive is not noticed');
{ const o = parseOFX('OFXHEADER:100\n<OFX><CREDITCARDMSGSRSV1><CCSTMTRS><BANKTRANLIST><DTSTART>20260901<DTEND>20260930\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000<TRNAMT>-50.25<FITID>F1<NAME>HOME DEPOT &amp; CO<MEMO>TAMPA</STMTTRN>\n<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20260905<TRNAMT>-200.00<FITID>F2<CHECKNUM>1042</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-250.25<DTASOF>20260930</LEDGERBAL></CCSTMTRS></OFX>');
  expect(o.lines.length === 2 && o.lines[0].amount === -50.25 && o.lines[0].text === 'HOME DEPOT & CO' && o.lines[0].external_id === 'F1' && o.lines[0].date === '2026-09-02' && o.lines[1].text === 'CHECK 1042', `an OFX file is read wrong: ${JSON.stringify(o.lines)}`);
  expect(o.closing === -250.25 && o.isCard && o.from === '2026-09-01' && o.to === '2026-09-30', `an OFX file's balance, dates or kind is read wrong: ${JSON.stringify({ c: o.closing, card: o.isCard, f: o.from, t: o.to })}`); }
expect(fileKind('x.QFX') === 'ofx' && fileKind('stmt.csv') === 'csv' && fileKind('scan.pdf') === 'scan' && fileKind('IMG_1.HEIC') === 'scan' && fileKind('notes.docx') === null, 'a file\'s kind is told wrong from its name');

// ── static: where things are ───────────────────────────────────────────────
const screens = ['StatementsDoor', 'StatementImport', 'StatementReview', 'PayeeRules', 'EntrySplit'].map((f) => code(`src/views/${f}.jsx`)).join('\n') + code('src/statements.js');
expect(!/from\('transactions'\)\s*\.\s*(insert|upsert|update|delete)/.test(screens), 'a statement screen writes an entry itself — every line must go through the database\'s posting function');
expect(!/from\('(statement_lines|statement_imports|payee_rules)'\)\s*\.\s*(insert|upsert|update|delete)/.test(screens), 'a statement screen writes the holding area or a rule directly');
for (const fn of ['statement_begin', 'statement_add_lines', 'statement_line_approve', 'statement_approve_ready', 'statement_line_skip', 'statement_line_undo', 'statement_resolve_twin', 'statement_set_balances', 'statement_take_back', 'rule_save', 'rule_delete', 'rule_fix_past'])
  expect(screens.includes(`rpc('${fn}'`), `the screens no longer call ${fn}`);
const ledger = code('src/views/FinanceLedger.jsx');
expect(/<StatementsDoor\b/.test(ledger) && /askAboutRule\(saved\.id\)/.test(ledger) && /<SplitLink\b/.test(ledger), 'the register lost its way into statements, the "fix the earlier ones too?" question, or the split');
expect(/statements: !b\.is_mine \|\| !!data\.enabled/.test(code('src/views/BookBar.jsx')), 'who gets statements changed: shared books always, a person\'s own only once accounting is switched on for them');
const sql = read('supabase/sql/2026-10-06f_statements.sql'), sqlCode = code('supabase/sql/2026-10-06f_statements.sql');
expect(!/is_brokerage_staff\s*\(|app_role\s*\(/.test(sqlCode), 'the statement rules consult brokerage staff status — being Broker or Broker Admin must grant nothing on a book');
expect(!/create policy (?![^;]*\bto authenticated\b)[^;]*;/.test(sqlCode) && !/using \(true\)/.test(sqlCode), 'a statements policy does not name its role, or lets everyone read');
expect(/grant select on public\.statement_imports, public\.statement_lines, public\.payee_rules to authenticated/.test(sql) && !/grant (insert|update|delete|all)[^;]*on public\.(statement_|payee_rules)/.test(sqlCode), 'the holding area or the rules can be written directly');
for (const f of ['read-statement', 'suggest-categories']) {
  const src = read(`supabase/functions/${f}/index.ts`);
  expect(/^import "\.\.\/_shared\/aiGuard\.ts";/m.test(src) && /import \{ logAiUsage \} from "\.\.\/_shared\/aiUsage\.ts";/.test(src) && /auth\.getUser\(\)/.test(src), `${f} is missing the AI guard, the cost log, or the sign-in check`);
  expect(!/from\(["']transactions["']\)/.test(src) && !/statement_post_line|statement_line_approve|statement_approve_ready|statement_settle/.test(src), `${f} can put something in the books — the model only ever reads and proposes`);
  expect(new RegExp(`\\[functions\\.${f}\\]`).test(read('supabase/config.toml')), `${f} is not registered in supabase/config.toml`);
}

// ── live ───────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (process.argv[2] !== 'static' && URL_ && SVC && ANON) {
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const made = [];
  const call = (headers) => async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; } return { ok: r.ok, json: j }; };
  const svc = call(H);
  const person = async (tag) => {
    const email = `smoke_statements_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
    const id = (await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;
    if (!id) throw new Error('no throwaway user');
    made.push(id);
    const tok = (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
    if (!tok) throw new Error('could not sign in');
    return { id, rest: call({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }) };
  };
  const rows = (x) => (Array.isArray(x.json) ? x.json : []);
  try {
    const a = await person('a'), b = await person('b');
    const rest = a.rest;
    const gated = await rest('POST', 'rpc/my_books', {});
    const bookId = ((gated.json && gated.json.books) || []).find((x) => x.is_mine)?.id;
    if (!bookId) throw new Error('no personal book');
    expect(!(await rest('POST', 'rpc/statement_begin', { p_book: bookId, p_account: 'Checking', p_via: 'csv' })).ok, 'statements can be brought into a person\'s own books before accounting is switched on for them');
    await svc('POST', 'accounting_access', { user_id: a.id, note: 'gate' });
    await rest('POST', 'rpc/my_books', {});      // seeds the categories now that it is switched on
    const cats = rows(await rest('GET', `tax_categories?book_id=eq.${bookId}&select=id,name,kind&is_archived=eq.false`));
    const office = cats.find((c) => c.name === 'Office Expense')?.id, meals = cats.find((c) => c.name === 'Business Meals')?.id;
    if (!office || !meals) throw new Error('the starter categories are missing');
    const entries = async () => rows(await rest('GET', `transactions?book_id=eq.${bookId}&is_archived=eq.false&select=id,amount,payee,tax_category_id,split_group,statement_line_id,rule_id,entered_via&order=created_at`));
    const begin = async (name, sha, via = 'csv') => (await rest('POST', 'rpc/statement_begin', { p_book: bookId, p_account: 'Checking', p_via: via, p_file_name: name, p_sha: sha })).json;
    const detail = async (id) => (await rest('POST', 'rpc/statement_detail', { p_import: id })).json;
    const line = async (id, no) => ((await detail(id)).lines || []).find((l) => l.line_no === no);

    // 1. lines brought in are not in the books
    const u1 = await begin('one.csv', 'gate-1-' + Date.now());
    const staged = await rest('POST', 'rpc/statement_add_lines', { p_import: u1.id, p_opening: 1000, p_closing: 687.35,
      p_lines: [{ date: '2026-09-02', amount: -50.25, text: 'SQ *HOME DEPOT #6341 TAMPA FL' }, { date: '2026-09-11', amount: -212.4, text: 'COSTCO WHSE #0333' }, { date: '2026-09-12', amount: -50, text: 'NEW VENDOR 12' }] });
    expect(staged.ok && staged.json.lines === 3 && staged.json.tie.blocked === false && staged.json.tie.proven === true, `a statement that adds up was not staged as proven: ${JSON.stringify(staged.json).slice(0, 200)}`);
    expect((await entries()).length === 0, 'bringing a statement in put entries in the books before anyone approved them');
    const l1 = await line(u1.id, 1);
    expect(l1 && l1.payee === 'Home Depot' && l1.needs.includes('new'), `the bank's text was not cleaned to a payee, or a brand-new payee was treated as decided: ${JSON.stringify(l1 && [l1.payee, l1.needs])}`);
    expect(!(await rest('POST', 'statement_lines', { import_id: u1.id, book_id: bookId, line_no: 99 })).ok && rows(await rest('PATCH', `statement_lines?id=eq.${l1.id}`, { result: 'posted' })).length === 0, 'a signed-in person can write the holding area directly');
    expect(!(await rest('POST', 'rpc/statement_post_line', { p_line: l1.id, p_by: a.id, p_auto: true })).ok && !(await rest('POST', 'rpc/statement_stage_scan', { p_import: u1.id, p_payload: {}, p_user: a.id })).ok && !(await rest('POST', 'rpc/statement_ai_propose', { p_import: u1.id, p_items: [] })).ok, 'a signed-in person can call the posting function, or one meant for the reader only');

    // 2. approving posts, and teaches
    await rest('POST', 'rpc/statement_line_set', { p_line: l1.id, p_patch: { category: office } });
    const ap = await rest('POST', 'rpc/statement_line_approve', { p_line: l1.id });
    expect(ap.ok && ap.json.ok === true && ap.json.rule && ap.json.rule.is_new === true, `approving a line did not post it and make a rule: ${JSON.stringify(ap.json).slice(0, 200)}`);
    let e = await entries();
    expect(e.length === 1 && Number(e[0].amount) === -50.25 && e[0].tax_category_id === office && e[0].payee === 'Home Depot' && e[0].entered_via === 'csv', `the approved line is not in the books as approved: ${JSON.stringify(e).slice(0, 200)}`);
    expect(rows(await rest('GET', `gl_live?transaction_id=eq.${e[0].id}&select=id`)).length === 1, 'an approved line was not posted to the ledger');
    // a split
    const l2 = await line(u1.id, 2);
    expect(!(await rest('POST', 'rpc/statement_line_set', { p_line: l2.id, p_patch: { parts: [{ category_id: office, amount: -200 }, { category_id: meals, amount: -10 }] } })).ok, 'a split that does not add up to the line was accepted');
    await rest('POST', 'rpc/statement_line_set', { p_line: l2.id, p_patch: { parts: [{ category_id: office, amount: -150 }, { category_id: meals, amount: -62.4 }] } });
    await rest('POST', 'rpc/statement_line_approve', { p_line: l2.id });
    const parts = (await entries()).filter((x) => x.statement_line_id === l2.id);
    expect(parts.length === 2 && parts[0].split_group && parts[0].split_group === parts[1].split_group && Math.round(parts.reduce((s, x) => s + Number(x.amount), 0) * 100) === -21240, `a split did not post as parts of one payment that add up: ${JSON.stringify(parts).slice(0, 200)}`);
    // a model's suggestion never posts in "approve all"
    await svc('POST', 'rpc/statement_ai_propose', { p_import: u1.id, p_items: [{ key: 'new vendor 12', category_id: meals, confidence: 0.99 }] });
    const l3 = await line(u1.id, 3);
    expect(l3.proposed_by === 'ai' && l3.tax_category_id === meals && l3.needs.includes('new'), `a model's suggestion is not kept as a suggestion: ${JSON.stringify([l3.proposed_by, l3.needs])}`);
    await rest('POST', 'rpc/statement_line_set', { p_line: l3.id, p_patch: { payee: 'New Vendor' } });
    const all = await rest('POST', 'rpc/statement_approve_ready', { p_import: u1.id });
    expect(all.ok && all.json.posted === 0 && (await entries()).length === 3, `"approve all" posted a line nobody had decided (a model's suggestion, even after its payee was renamed): ${JSON.stringify(all.json)}`);
    expect((await rest('POST', 'rpc/statement_settle_next', { p_import: u1.id })).json.posted === 0, 'a model\'s suggestion was filed as if a person had confirmed it');

    // 3. the next statement: the confirmed payee files itself, the overlap is flagged, the statement that is off posts nothing
    const again = await begin('one.csv', u1 && (await detail(u1.id)).import.file_sha256);
    expect(again && again.already === u1.id, 'the same file uploaded twice was read twice');
    const u2 = await begin('two.csv', 'gate-2-' + Date.now());
    const st2 = await rest('POST', 'rpc/statement_add_lines', { p_import: u2.id, p_opening: 500, p_closing: 100,
      p_lines: [{ date: '2026-10-02', amount: -75, text: 'THE HOME DEPOT 6341' }, { date: '2026-09-11', amount: -212.4, text: 'COSTCO WHSE #0333' }, { date: '2026-10-04', amount: 20, text: 'SQ *HOME DEPOT #6341 REFUND' }] });
    expect(st2.ok && st2.json.tie.blocked === true && st2.json.possible_duplicates === 1, `a statement that is off was not held, or an overlapping line was not noticed: ${JSON.stringify(st2.json).slice(0, 220)}`);
    expect((await rest('POST', 'rpc/statement_settle_next', { p_import: u2.id })).json.posted === 0 && !(await rest('POST', 'rpc/statement_approve_ready', { p_import: u2.id })).ok
      && !(await rest('POST', 'rpc/statement_line_approve', { p_line: (await line(u2.id, 1)).id })).ok && (await entries()).length === 3, 'a statement that does not add up put something in the books');
    expect((await rest('POST', 'rpc/statement_set_balances', { p_import: u2.id, p_opening: 500, p_closing: 232.6 })).json.tie.proven === true, 'correcting the balances did not prove the statement');
    const filed = await rest('POST', 'rpc/statement_settle_next', { p_import: u2.id });
    const d2 = await detail(u2.id);
    expect(filed.json.posted === 1 && d2.lines[0].result === 'posted' && d2.lines[0].auto_posted === true, `a payee a person confirmed was not filed by itself the next time: ${JSON.stringify(filed.json)}`);
    expect(!d2.lines[1].result && d2.lines[1].needs.includes('twin') && d2.lines[1].twin && d2.lines[1].twin.where === 'books', `a line already in the books from an earlier upload was not shown as a possible duplicate: ${JSON.stringify(d2.lines[1].needs)}`);
    expect(!d2.lines[2].result && d2.lines[2].needs.includes('direction'), 'a refund (money the other way from what the rule learned) was filed without a look');
    const tw = await rest('POST', 'rpc/statement_line_approve', { p_line: d2.lines[1].id });
    expect(tw.ok && tw.json.ok === false && (await entries()).length === 4, 'a possible duplicate was posted before anyone said whether it is the same payment');
    await rest('POST', 'rpc/statement_resolve_twin', { p_line: d2.lines[1].id, p_same: true });
    expect((await line(u2.id, 2)).result === 'duplicate' && (await entries()).length === 4, 'a duplicate that was set aside is in the books twice, or was not set aside');

    // 4. something typed by hand in between is caught at the moment of posting
    const u3 = await begin('three.csv', 'gate-3-' + Date.now());
    await rest('POST', 'rpc/statement_add_lines', { p_import: u3.id, p_lines: [{ date: '2026-10-09', amount: -31, text: 'HOME DEPOT #6341' }] });
    await rest('POST', 'transactions', { book_id: bookId, date: '2026-10-09', amount: -31, scope: 'business', payee: 'Home Depot', account: 'Checking', tax_category_id: office });
    expect((await rest('POST', 'rpc/statement_settle_next', { p_import: u3.id })).json.posted === 0 && (await line(u3.id, 1)).needs.includes('twin'), 'a payment typed by hand after the statement was read was posted a second time by a rule');

    // 5. undo takes it back out; correcting from the checkbook un-confirms the rule
    await rest('POST', 'rpc/statement_line_undo', { p_line: d2.lines[0].id });
    const un = await line(u2.id, 1);
    expect(!un.result && un.needs.includes('held') && !(await entries()).some((x) => x.statement_line_id === un.id), 'undo did not take the entry back out of the books, or left the line free to post itself again');
    expect((await rest('POST', 'rpc/statement_settle_next', { p_import: u2.id })).json.posted === 0, 'a line a person undid was filed again by itself');
    const first = (await entries()).find((x) => x.statement_line_id === l1.id);
    await rest('PATCH', `transactions?id=eq.${first.id}`, { tax_category_id: meals });
    const rule = rows(await rest('GET', `payee_rules?book_id=eq.${bookId}&payee_key=eq.home%20depot&select=id,trusted,tax_category_id`))[0];
    expect(rule && rule.tax_category_id === meals && rule.trusted === false, `correcting an entry a rule filed did not update the rule, or left it free to file by itself without being confirmed in review: ${JSON.stringify(rule)}`);
    expect(rows(await rest('PATCH', `payee_rules?id=eq.${rule.id}`, { trusted: true })).length === 0 && !(await svc('POST', 'rpc/rule_learn', {})).ok, 'a rule can be written directly');

    // 6. a stranger reads and changes nothing
    expect(rows(await b.rest('GET', `statement_lines?book_id=eq.${bookId}&select=id`)).length === 0 && rows(await b.rest('GET', `statement_imports?book_id=eq.${bookId}&select=id`)).length === 0 && rows(await b.rest('GET', `payee_rules?book_id=eq.${bookId}&select=id`)).length === 0, 'someone with no seat on the books can read their statements or rules');
    expect(!(await b.rest('POST', 'rpc/statement_detail', { p_import: u2.id })).ok && !(await b.rest('POST', 'rpc/statement_line_approve', { p_line: un.id })).ok && !(await b.rest('POST', 'rpc/statement_overview', { p_book: bookId })).ok
      && !(await b.rest('POST', 'rpc/rule_save', { p_rule: rule.id, p_patch: { always_ask: true } })).ok && !(await b.rest('POST', 'rpc/statement_take_back', { p_import: u2.id })).ok, 'someone with no seat on the books can open or change their statements or rules');

    // 7. payees are cleaned the same way every time
    const clean = async (t) => (await rest('POST', 'rpc/clean_payee', { p_raw: t })).json;
    expect(await clean('SQ *HOME DEPOT #6341 TAMPA FL') === 'Home Depot' && await clean('THE HOME DEPOT 6341') === 'Home Depot' && await clean('AMAZON.COM*MK1AB2 AMZN.COM/BILL WA') === 'Amazon' && await clean('CANVAS COFFEE 0012345') === 'Canvas Coffee' && await clean('CHECK 1042') === 'Check 1042', 'the same merchant no longer cleans to the same payee');

    // 8. the ledger's standing checks, for every set of books there is
    const health = await svc('POST', 'rpc/ledger_health', {});
    if (!health.ok || !Array.isArray(health.json)) problems.push('the standing checks could not run: ' + JSON.stringify(health.json).slice(0, 200));
    else for (const h of health.json.slice(0, 12)) problems.push(`ledger fault in book ${h.book_id}: ${h.problem}`);
  } catch (e) { problems.push('live check could not run: ' + String(e && e.stack || e).slice(0, 300)); }
  finally { for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {}); }
} else console.log('statements_guard: live check not run (static only, or SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing)');

if (problems.length) { console.error(`\n==== STATEMENTS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== STATEMENTS: clean — nothing reaches the books unapproved; a statement that is off posts nothing; duplicates are shown; only a confirmed rule files by itself ====');
