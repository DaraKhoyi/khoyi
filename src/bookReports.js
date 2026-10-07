// bookReports — turning what the ledger hands back into a table a person reads.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Reports: profit and loss,
// balance sheet, cash flow, general ledger, trial balance; profit by agent, by
// team, by month; this year against last. Export to PDF, CSV and Excel. The
// reason to keep books at all."
//
// Every report becomes ONE shape, so the screen, the CSV, the Excel file and
// the printed page are the same numbers in the same order:
//   { title, subtitle, columns: [text], rows: [{ kind, cells }] }
// kind is 'head' (a section name), 'row', 'total' or 'note'. A cell is text or
// a number; numbers are dollars and are formatted only where they are shown.
// Nothing here reads the database or the clock.

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (iso) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
export const dayText = (iso) => { const m = ymd(iso); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ''; };
export const rangeText = (from, to) => (from && to ? `${dayText(from)} to ${dayText(to)}` : to ? `Through ${dayText(to)}` : 'Everything in these books');
export const monthText = (bucket) => { const m = /^(\d{4})-(\d{2})$/.exec(String(bucket || '')); return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(bucket || ''); };

// The same days one year earlier (29 Feb becomes 28 Feb).
export function yearBefore(iso) {
  const m = ymd(iso); if (!m) return null;
  const y = +m[1] - 1, mo = +m[2];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${m[2]}-${String(Math.min(+m[3], last)).padStart(2, '0')}`;
}

export const BREAKDOWNS = [['', 'No breakdown'], ['month', 'By month'], ['agent', 'By agent'], ['team', 'By team'], ['closing', 'By closing'], ['contact', 'By contact'], ['property', 'By property']];
const UNTAGGED = { agent: 'No agent tagged', team: 'No team tagged', closing: 'No closing tagged', contact: 'No contact tagged', property: 'No property tagged' };
const HIDDEN = { agent: 'An agent you cannot open', team: 'A team you cannot open', closing: 'A closing you cannot open', contact: 'A contact you cannot open', property: 'A property you cannot open' };

// ── Profit and loss ────────────────────────────────────────────────────────
// lines: book_pnl().lines. before: the same for the year before, or null.
export function pnlTable(lines, { by = '', before = null, subtitle = '' } = {}) {
  const inc = (lines || []).filter((l) => l.class === 'income'), exp = (lines || []).filter((l) => l.class === 'expense');
  const title = 'Profit and loss';
  if (!by) {
    const prior = (l) => (before || []).find((b) => b.class === l.class && (b.category_id || b.name) === (l.category_id || l.name));
    const extra = (before || []).filter((b) => !(lines || []).some((l) => l.class === b.class && (l.category_id || l.name) === (b.category_id || b.name)));
    const section = (rows, more, head, totalLabel) => {
      const out = [{ kind: 'head', cells: [head] }];
      let t = 0, tb = 0;
      for (const l of rows) { const p = prior(l); const b = p ? cents(p.amount) : 0; t = cents(t + l.amount); tb = cents(tb + b); out.push({ kind: 'row', cells: before ? [l.name, cents(l.amount), b, cents(l.amount - b)] : [l.name, cents(l.amount)] }); }
      for (const b of more) { tb = cents(tb + b.amount); out.push({ kind: 'row', cells: [b.name, 0, cents(b.amount), cents(-b.amount)] }); }
      out.push({ kind: 'total', cells: before ? [totalLabel, t, tb, cents(t - tb)] : [totalLabel, t] });
      return { out, t, tb };
    };
    const a = section(inc, extra.filter((b) => b.class === 'income'), 'Money in', 'Total money in');
    const b = section(exp, extra.filter((x) => x.class === 'expense'), 'Money out', 'Total money out');
    const net = cents(a.t - b.t), netB = cents(a.tb - b.tb);
    return { title, subtitle, columns: before ? ['', 'This period', 'Year before', 'Change'] : ['', 'Amount'],
      rows: [...a.out, ...b.out, { kind: 'total', cells: before ? ['Left over (profit)', net, netB, cents(net - netB)] : ['Left over (profit)', net] }],
      net, totalIn: a.t, totalOut: b.t, empty: !(lines || []).length && !(before || []).length };
  }
  // Broken down: one column per month or tag, then a total.
  const key = (l) => (l.bucket == null ? '' : String(l.bucket));
  const buckets = [...new Set((lines || []).map(key))].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : by === 'month' ? x.localeCompare(y) : 0));
  const label = (k) => { if (k === '') return UNTAGGED[by] || 'Not tagged'; if (by === 'month') return monthText(k); const l = (lines || []).find((x) => key(x) === k); return (l && l.label) || HIDDEN[by] || 'Not shown'; };
  if (by !== 'month') buckets.sort((x, y) => (x === '' ? 1 : y === '' ? -1 : label(x).localeCompare(label(y))));
  const names = (rows) => { const seen = []; for (const l of rows) if (!seen.some((s) => (s.category_id || s.name) === (l.category_id || l.name))) seen.push(l); return seen; };
  const section = (rows, head, totalLabel) => {
    const out = [{ kind: 'head', cells: [head] }];
    const totals = buckets.map(() => 0);
    for (const n of names(rows)) {
      const vals = buckets.map((k) => cents(rows.filter((l) => (l.category_id || l.name) === (n.category_id || n.name) && key(l) === k).reduce((s, l) => s + Number(l.amount), 0)));
      vals.forEach((v, i) => { totals[i] = cents(totals[i] + v); });
      out.push({ kind: 'row', cells: [n.name, ...vals, cents(vals.reduce((s, v) => s + v, 0))] });
    }
    out.push({ kind: 'total', cells: [totalLabel, ...totals, cents(totals.reduce((s, v) => s + v, 0))] });
    return { out, totals };
  };
  const a = section(inc, 'Money in', 'Total money in'), b = section(exp, 'Money out', 'Total money out');
  const nets = buckets.map((_, i) => cents(a.totals[i] - b.totals[i]));
  return { title: `${title}, ${(BREAKDOWNS.find((x) => x[0] === by) || ['', ''])[1].toLowerCase()}`, subtitle, columns: ['', ...buckets.map(label), 'Total'],
    rows: [...a.out, ...b.out, { kind: 'total', cells: ['Left over (profit)', ...nets, cents(nets.reduce((s, v) => s + v, 0))] }],
    net: cents(nets.reduce((s, v) => s + v, 0)), empty: !(lines || []).length, wide: true };
}

// ── Where things stand (the balance sheet), from position() in books.js ─────
export function standingTable(pos, { subtitle = '' } = {}) {
  const rows = [];
  const section = (head, list, totalLabel, total) => { if (!list.length) return; rows.push({ kind: 'head', cells: [head] }); for (const r of list) rows.push({ kind: 'row', cells: [r.name, cents(r.amount)] }); rows.push({ kind: 'total', cells: [totalLabel, cents(total)] }); };
  section('What these books hold', pos.hold, 'Total held', pos.totalHold);
  section('What is owed', pos.owe, 'Total owed', pos.totalOwe);
  section('Held for others', pos.held, 'Total held for others', pos.totalHeld);
  section('What is left for the owners', pos.owners, 'Left for the owners', pos.left);
  if (!pos.balanced) rows.push({ kind: 'note', cells: ['These figures do not tie out. The ledger needs a look before this report is relied on.'] });
  return { title: 'Where things stand (balance sheet)', subtitle, columns: ['', 'Amount'], rows, empty: !!pos.empty };
}

// ── Cash flow ──────────────────────────────────────────────────────────────
const CF_SECTIONS = [['operating', 'From running the business'], ['held', 'Held for others'], ['cards', 'Card payments and transfers'], ['owners', 'Owners: put in and taken out'], ['other', 'Loans and other'], ['start', 'Starting balances entered']];
export function cashFlowTable(data, { subtitle = '' } = {}) {
  const d = data || { begin: 0, lines: [], change: 0 };
  const rows = [{ kind: 'total', cells: ['In the bank at the start', cents(d.begin)] }];
  for (const [id, head] of CF_SECTIONS) {
    const list = (d.lines || []).filter((l) => l.section === id);
    if (!list.length) continue;
    rows.push({ kind: 'head', cells: [head] });
    for (const l of list) rows.push({ kind: 'row', cells: [l.name, cents(l.amount)] });
    rows.push({ kind: 'total', cells: ['Net', cents(list.reduce((s, l) => s + Number(l.amount), 0))] });
  }
  rows.push({ kind: 'total', cells: ['Change in the bank', cents(d.change)] });
  rows.push({ kind: 'total', cells: ['In the bank at the end', cents(Number(d.begin) + Number(d.change))] });
  return { title: 'Cash flow', subtitle: subtitle + (subtitle ? ' · ' : '') + 'bank, escrow and cash accounts; cards are not cash', columns: ['', 'Amount'], rows, empty: !(d.lines || []).length };
}

// ── Trial balance ──────────────────────────────────────────────────────────
const CLASS_HEAD = { asset: 'Held', liability: 'Owed', equity: 'Owners', income: 'Money in', expense: 'Money out' };
export function trialBalanceTable(data, { subtitle = '' } = {}) {
  const d = data || { lines: [], total_debit: 0, total_credit: 0 };
  const rows = [];
  let last = null;
  for (const l of d.lines || []) {
    if (l.class !== last) { rows.push({ kind: 'head', cells: [CLASS_HEAD[l.class] || l.class] }); last = l.class; }
    rows.push({ kind: 'row', cells: [l.name, Number(l.debit) ? cents(l.debit) : '', Number(l.credit) ? cents(l.credit) : ''] });
  }
  rows.push({ kind: 'total', cells: ['Total', cents(d.total_debit), cents(d.total_credit)] });
  if (cents(d.total_debit) !== cents(d.total_credit)) rows.push({ kind: 'note', cells: ['The two sides do not agree. The ledger needs a look before this is relied on.'] });
  return { title: 'Trial balance', subtitle, columns: ['Account', 'Debit', 'Credit'], rows, empty: !(d.lines || []).length, balanced: cents(d.total_debit) === cents(d.total_credit) };
}

// ── General ledger ─────────────────────────────────────────────────────────
export function generalLedgerTable(data, { subtitle = '' } = {}) {
  const d = data || { lines: [], total: 0 };
  const rows = (d.lines || []).map((l) => ({ kind: 'row', cells: [dayText(l.date), l.account, l.memo ? `${l.memo}${l.what !== 'entered' ? ` (${l.what})` : ''}` : l.what, Number(l.debit) ? cents(l.debit) : '', Number(l.credit) ? cents(l.credit) : ''] }));
  if ((d.lines || []).length < Number(d.total)) rows.push({ kind: 'note', cells: [`Showing the first ${(d.lines || []).length} of ${d.total} postings. Choose a shorter period to see the rest.`] });
  return { title: 'General ledger', subtitle, columns: ['Date', 'Account', 'What', 'Debit', 'Credit'], rows, empty: !(d.lines || []).length, wide: true };
}

// ── Held for others, by person ─────────────────────────────────────────────
export function heldTable(data, { subtitle = '' } = {}) {
  const d = data || { lines: [], held: 0, escrow: 0 };
  const rows = [{ kind: 'head', cells: ['Whose money it is'] }];
  for (const l of d.lines || []) rows.push({ kind: 'row', cells: [l.contact_id ? (l.name || 'A contact you cannot open') : 'No person tagged on the entry', cents(l.amount)] });
  rows.push({ kind: 'total', cells: ['Total held for others', cents(d.held)] });
  rows.push({ kind: 'total', cells: ['In the escrow accounts', cents(d.escrow)] });
  const gap = cents(Number(d.escrow) - Number(d.held));
  rows.push({ kind: gap === 0 ? 'total' : 'note', cells: gap === 0 ? ['Difference', 0] : [`The escrow accounts hold ${gap > 0 ? 'more' : 'less'} than is owed to others, by ${Math.abs(gap).toFixed(2)}. Every dollar in escrow should belong to someone named here.`] });
  return { title: 'Held for others', subtitle, columns: ['', 'Amount'], rows, empty: !(d.lines || []).length && !Number(d.escrow), tied: gap === 0 };
}

// ── A finished (or in-progress) reconciliation, as a report ────────────────
export function reconciliationTable(rec, numbers, items) {
  const n = numbers || {};
  const open = (items || []).filter((i) => !i.cleared);
  const rows = [
    { kind: 'row', cells: ['Balance at the start', cents(n.begin)] },
    { kind: 'row', cells: [`Money in, on the statement (${(items || []).filter((i) => i.cleared && i.amount > 0).length})`, cents(n.cleared_in)] },
    { kind: 'row', cells: [`Money out, on the statement (${(items || []).filter((i) => i.cleared && i.amount < 0).length})`, cents(-n.cleared_out)] },
    { kind: 'total', cells: ['Balance by the books, statement items only', cents(n.cleared_balance)] },
    { kind: 'total', cells: ['Balance on the statement', cents(n.statement)] },
    { kind: 'total', cells: ['Difference', cents(n.difference)] },
  ];
  if (open.length) {
    rows.push({ kind: 'head', cells: ['In the books but not yet on a statement'] });
    for (const i of open) rows.push({ kind: 'row', cells: [`${dayText(i.entry_date)} · ${i.payee || i.other_account || 'No payee'}`, cents(i.amount)] });
    rows.push({ kind: 'total', cells: ['Balance in the books on that day', cents(n.book_balance)] });
  }
  return { title: `Reconciliation: ${rec.account}`, subtitle: `Statement of ${dayText(rec.statement_date)}`, columns: ['', 'Amount'], rows };
}

// A table as plain rows of cells (for CSV and Excel): title lines, header, body.
export function tableRows(t) {
  const out = [[t.title], ...(t.subtitle ? [[t.subtitle]] : []), [], t.columns.map((c) => c || '')];
  for (const r of t.rows) out.push(r.kind === 'head' ? [String(r.cells[0]).toUpperCase()] : r.cells);
  return out;
}
