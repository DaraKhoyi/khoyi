// standin_brokerage.mjs — a STAND-IN brokerage book for looking at and
// measuring the screens that belong to the one real brokerage book (Closings,
// Agents, the closings report) without ever touching it. Every request that
// names the stand-in is answered here from canned data shaped like the real
// thing; everything else goes to the real server untouched.
// Used by look_closings.mjs (screenshots) and accounting_screens.mjs (the gate).
export const FAKE = '11111111-2222-4333-8444-555555555555';
export const sheet = (o) => ({ gross: null, agent: null, office: null, referral: null, tc: null, franchise: null, received: null, paid: null, ...o });
export const S1 = sheet({ gross: 7950, agent: 6415, office: 1335, tc: 150, franchise: 275, received: '2026-01-06', paid: '2026-01-07' });
export const S2 = sheet({ gross: 6570, agent: 4137.5, office: 790, referral: 1642.5, franchise: 175, received: '2026-04-15', paid: '2026-04-28' });
export const S3 = sheet({ gross: 7120, agent: 6457.5, office: 662.5, franchise: 175, received: '2026-04-24', paid: '2026-04-28' });
export const base = { state: 'held', note: null, account: 'Operating Checking 4411', adopted: false, changed: null, transaction_id: null, twins: [], kind: 'sale', year: 2026 };
export const HELD = [
  { ...base, id: 'h1', key: '2026-7', part: 'received', reasons: ['does_not_add_up'], date: '2026-01-06', amount: 7950, payee: 'Sunbelt Title', category_id: 'c1', category: 'Commission Income', agent: 'Jordan Avery', address: '1418 Oak Vine Dr', trans_id: 7, sheet_note: '150 to josh', sheet: S1 },
  { ...base, id: 'h2', key: '2026-7', part: 'agent', reasons: ['does_not_add_up'], date: '2026-01-07', amount: -6415, payee: 'Jordan Avery', category_id: 'c2', category: 'Agent Commissions Paid', agent: 'Jordan Avery', address: '1418 Oak Vine Dr', trans_id: 7, sheet_note: '150 to josh', sheet: S1 },
  { ...base, id: 'h3', key: '2026-7', part: 'tc', reasons: ['does_not_add_up', 'who_was_paid'], date: '2026-01-07', amount: -150, payee: 'Transaction coordinator', category_id: 'c3', category: 'Contract Labor', agent: 'Jordan Avery', address: '1418 Oak Vine Dr', trans_id: 7, sheet_note: '150 to josh', sheet: S1 },
  { ...base, id: 'h4', key: '2026-104', part: 'referral', reasons: ['who_was_paid', 'no_date'], date: null, amount: -1642.5, payee: 'Referral', category_id: 'c4', category: 'Referral Fees Paid', agent: 'Priya Raman', address: '22 Palm Ct', trans_id: 104, sheet_note: 'paid by wire 6/8', sheet: S2 },
  { ...base, id: 'h5', key: '2026-105', part: 'received', reasons: ['maybe_in_books'], date: '2026-04-24', amount: 7120, payee: 'Capital Title', category_id: 'c1', category: 'Commission Income', agent: 'Sam Okafor', address: '903 Harbor Ln', trans_id: 105, sheet_note: '', sheet: S3, twins: [{ id: 't1', date: '2026-04-25', payee: 'DEPOSIT', bank: false }] },
  { ...base, id: 'h6', key: '2026-118', kind: 'fee', part: 'payout', reasons: ['what_for'], date: '2026-05-06', amount: -800, payee: 'Sam Okafor', category_id: null, category: null, agent: 'Sam Okafor', address: null, trans_id: 118, sheet_note: 'his rentals', sheet: sheet({ agent: 800, paid: '2026-05-06', franchise: 0 }) },
];
export const POSTED = [
  { ...base, state: 'posted', id: 'p1', key: '2026-106', part: 'agent', reasons: [], date: '2026-04-28', amount: -5650, payee: 'Eddy Park', agent: 'Eddy Park', address: '77 Bay Shore Blvd', trans_id: 106, changed: { date: '2026-04-28', amount: -5550, payee: 'Eddy Park' }, sheet: S3 },
  { ...base, state: 'posted', id: 'p2', key: '2026-109', part: 'received', reasons: [], date: '2026-04-29', amount: 8999.7, payee: 'Sunbelt Title', agent: 'Lee Tran', address: '5 Heron Way', trans_id: 109, adopted: true, sheet: S3 },
  { ...base, state: 'posted', id: 'p3', key: '2026-109', part: 'agent', reasons: [], date: '2026-04-30', amount: -8349.7, payee: 'Lee Tran', agent: 'Lee Tran', address: '5 Heron Way', trans_id: 109, sheet: S3 },
];
export const SET = { is_on: true, deposit_account: 'Operating Checking 4411', pay_account: null, start_on: '2026-01-01' };
let on = false;
export const standInOn = (v) => { on = v; };
export const list = (view) => ({ settings: on ? SET : null, counts: on ? { held: HELD.length, changed: 1, posted: 428, set_aside: 0 } : { held: 0, changed: 0, posted: 0, set_aside: 0 }, unread: 0, problems: [], can_write: true, can_manage: true,
  rows: !on ? [] : view === 'held' ? HELD : view === 'changed' ? POSTED.slice(0, 1) : view === 'posted' ? POSTED : [] });
export const REPORT = { by: 'agent', lines: [{ label: 'Jordan Avery', n: 14, gross: 176551.67, agent: 158186.69, referral: 3075, tc: 150, office: 15140, franchise: 3500, kept: 11640 }, { label: 'Priya Raman', n: 9, gross: 98210, agent: 88410.5, referral: 1642.5, tc: 0, office: 8157, franchise: 1975, kept: 6182 }, { label: 'Sam Okafor', n: 6, gross: 51377.5, agent: 46227.5, referral: 0, tc: 0, office: 5150, franchise: 1200, kept: 3950 }] };


export async function routeStandIn(page) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), url = req.url(), body = req.postData() || '';
    if (/rpc\/my_books/.test(url)) {
      const r = await route.fetch(); const j = await r.json();
      j.books = [...(j.books || []), { id: FAKE, kind: 'brokerage', template: 'brokerage', label: 'Stand-in Brokerage', role: 'owner', is_mine: false, owner_user_id: null, track_personal: false, starts_on: '2026-01-01', closed_through: null }];
      return json(route, j);
    }
    if (!url.includes(FAKE) && !body.includes(FAKE)) return route.continue();
    if (/rpc\/closings_list/.test(url)) return json(route, list(JSON.parse(body).p_view));
    if (/rpc\/closings_sync/.test(url)) return json(route, { on, done: 0, left: 0 });
    if (/rpc\/closing_settings_save/.test(url)) { on = true; return json(route, SET); }
    if (/rpc\/closings_report/.test(url)) return json(route, REPORT);
    if (/rpc\/agent_balances/.test(url)) return json(route, { year: 2026, can_write: true, roster: [{ id: 'a1', name: 'Jordan Avery' }, { id: 'a2', name: 'Priya Raman' }],
      agents: [{ agent_id: 'a1', name: 'Jordan Avery', active: true, charged: 646, paid: 250, owed: 396, paid_out: 158186.69 }, { agent_id: 'a2', name: 'Priya Raman', active: true, charged: 396, paid: 396, owed: 0, paid_out: 88410.5 }],
      schedules: [{ id: 's1', agent_id: null, agent: null, kind: 'monthly', label: 'Monthly desk fee', amount: 99, every: 'month', starts_on: '2026-07-01', ends_on: null }] });
    if (/rpc\/agent_charges_run/.test(url)) return json(route, 0);
    if (/rpc\/agent_statement/.test(url)) return json(route, { agent: { id: 'a1', name: 'Jordan Avery' }, paid_total: 14772.5, owed_before: 0, owed: 396,
      closings: [{ date: '2026-01-07', address: '1418 Oak Vine Dr', gross: 7950, agent: 6415, office: 1335, referral: null, tc: 150 }, { date: '2026-04-28', address: '22 Palm Ct', gross: 9147.5, agent: 8357.5, office: 790, referral: null, tc: null }],
      paid: [{ date: '2026-01-07', amount: 6415, what: '1418 Oak Vine Dr · Jordan Avery · Gold Report 2026 #7', category: 'Agent Commissions Paid' }, { date: '2026-04-28', amount: 8357.5, what: '22 Palm Ct · Jordan Avery · Gold Report 2026 #131', category: 'Agent Commissions Paid' }],
      charges: [{ id: 'c1', date: '2026-07-01', kind: 'monthly', label: 'Monthly desk fee', amount: 99 }, { id: 'c2', date: '2026-08-01', kind: 'monthly', label: 'Monthly desk fee', amount: 99 }, { id: 'c3', date: '2026-08-15', kind: 'eo', label: 'E&O 2026', amount: 300 }, { id: 'c4', date: '2026-09-01', kind: 'monthly', label: 'Monthly desk fee', amount: 99 }, { id: 'c5', date: '2026-10-01', kind: 'monthly', label: 'Monthly desk fee', amount: 99 }, { id: 'c6', date: '2026-08-20', kind: 'credit', label: 'Goodwill', amount: -50 }],
      payments: [{ date: '2026-09-05', amount: 250, payee: 'Jordan Avery' }] });
    if (/rpc\/book_1099/.test(url)) return json(route, { year: 2026, can_write: true, can_manage: true, figures: { nec: 2000, rent: 2000, source: 'IRS', checked_on: '2026-10-06' },
      payees: [{ id: 'y1', name: 'Jordan Avery', tax_status: 'us_person', form_on_file: true, form_date: '2026-01-04', box: 'nec', last4: '6789', tin_kind: 'ssn', entries: 14, paid: 158186.69, by_card: 0, counts: 158186.69, files: true },
        { id: 'y2', name: 'Priya Raman', tax_status: 'unknown', form_on_file: false, box: 'nec', last4: null, entries: 9, paid: 88410.5, by_card: 0, counts: 88410.5, files: true },
        { id: 'y3', name: 'Marge Aloyn', tax_status: 'foreign', form_on_file: false, box: 'nec', last4: null, entries: 1, paid: 373.99, by_card: 373.99, counts: 0, files: false },
        { id: 'y4', name: 'Bay Lawn Care', tax_status: 'us_person', form_on_file: true, box: 'nec', last4: '0042', tin_kind: 'ein', entries: 3, paid: 900, by_card: 0, counts: 900, files: false }],
      untracked: [{ label: 'Sam Okafor', agent_id: 'a3', contact_id: null, paid: 46227.5, entries: 6 }] });
    if (/rpc\/book_account_balances/.test(url)) return json(route, [{ account: 'Operating Checking 4411', entries: 0, starting_balance: 0, balance: 0, kind: 'bank' }, { account: 'X9577', entries: 1, starting_balance: 0, balance: -373.99, kind: 'card' }]);
    if (/tax_categories/.test(url)) return json(route, [{ id: 'c1', name: 'Commission Income', kind: 'income' }, { id: 'c2', name: 'Agent Commissions Paid', kind: 'expense' }, { id: 'c3', name: 'Contract Labor', kind: 'expense' }, { id: 'c4', name: 'Referral Fees Paid', kind: 'expense' }, { id: 'c5', name: 'Payroll & Staff', kind: 'expense' }]);
    if (/rpc\/book_recurring_watch/.test(url)) return json(route, [{ key: 'bay office park', payee: 'Bay Office Park', kind: 'missing', usual: 4200, now: 0, by_day: 3, month: '2026-10-01' }, { key: 'buildium', payee: 'Buildium', kind: 'changed', usual: 389.5, now: 429.5, by_day: 10, month: '2026-10-01' }]);
    if (/rpc\/statement_overview/.test(url)) return json(route, { waiting: 0, imports: [] });
    if (/rpc\//.test(url)) return json(route, {});
    return json(route, []);
  });
}
