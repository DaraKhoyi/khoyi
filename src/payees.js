// payees — the words and the shaping for 1099 tracking and agent accounts.
// Pure (no React, no network) so a guard can import it under plain node.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "1099 tracking. W-9 on file per
// agent and contractor, totals for the year, flags who crosses the IRS
// threshold, exports the year-end file." and "Agent statements. What the
// brokerage paid them and what they owe."
const usd = (n) => (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => Number(v) || 0;
const cents = (n) => Math.round(num(n) * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ''; };

export const TAX_STATUS = [['unknown', 'Not known yet'], ['us_person', 'U.S. person or LLC (W-9)'], ['corporation', 'Corporation'], ['foreign', 'Outside the U.S. (W-8BEN)']];
export const BOXES = [['nec', 'Services (1099-NEC)'], ['rent', 'Rent (1099-MISC)']];

// One payee's standing for the year, in a word and a sentence.
export function payeeStanding(p, figures) {
  const line = figures ? num(p.box === 'rent' ? figures.rent : figures.nec) : null;
  if (p.tax_status === 'foreign') return { tone: 'plain', word: 'No 1099', why: `Outside the U.S., so no 1099 is filed. Keep a W-8BEN on file${p.form_on_file ? '' : ': none is recorded yet'}.` };
  if (p.tax_status === 'corporation') return { tone: 'plain', word: 'No 1099', why: 'A corporation is not sent a 1099 (attorneys are the exception: ask your CPA).' };
  if (line == null) return { tone: 'warn', word: 'IRS line not known', why: 'The IRS figure for this year is not in PrismOS yet, so nothing is assumed.' };
  const over = num(p.counts) >= line;
  if (!over) return { tone: 'good', word: 'Under the line', why: `${usd(p.counts)} counts toward the form; the line is ${usd(line)}.${p.form_on_file ? '' : ' No W-9 on file yet.'}` };
  if (!p.form_on_file || !p.last4) return { tone: 'bad', word: 'File: W-9 missing', why: `${usd(p.counts)} is over the ${usd(line)} line, so a 1099 is due, and ${!p.form_on_file ? 'no W-9 is on file' : 'no tax ID is recorded'}. Ask for the W-9 now.` };
  return { tone: 'warn', word: 'File a 1099', why: `${usd(p.counts)} is over the ${usd(line)} line. The W-9 is on file.` };
}
export const cardNote = (p) => (num(p.by_card) > 0 ? `${usd(p.by_card)} more was paid by credit card. The card company reports that, so it is left off the form.` : '');

export function figuresLine(year, figures) {
  if (!figures) return `The IRS reporting line for ${year} is not in PrismOS yet. Totals are shown; who must be filed for is not worked out.`;
  return `For ${year} the IRS line is ${usd(figures.nec)} for services and ${usd(figures.rent)} for rent (checked ${day(figures.checked_on)}).`;
}

// The list as a table (no tax IDs), in the common report shape.
export function payeesTable(d, { subtitle = '' } = {}) {
  const rows = ((d && d.payees) || []).map((p) => ({ kind: 'row', cells: [p.name, payeeStanding(p, d.figures).word, p.form_on_file ? 'Yes' : 'No', p.last4 ? '···' + p.last4 : '', num(p.paid), num(p.by_card), num(p.counts)] }));
  const sum = (k) => cents(((d && d.payees) || []).reduce((s, p) => s + num(p[k]), 0));
  rows.push({ kind: 'total', cells: ['Total', '', '', '', sum('paid'), sum('by_card'), sum('counts')] });
  return { title: `1099 list ${d ? d.year : ''}`, subtitle, wide: true, empty: !((d && d.payees) || []).length, columns: ['Payee', 'Standing', 'Form on file', 'Tax ID', 'Paid', 'Of that, by card', 'Counts toward the form'], rows };
}
// The year-end file, with whole tax IDs: plain rows for a CSV the CPA's software reads.
export function yearEndRows(file) {
  return [['Payee', 'Tax ID', 'Tax ID kind', 'Address', 'Form', 'Amount', 'W-9 on file'],
    ...((file && file.rows) || []).map((r) => [r.name, r.tin || '', (r.tin_kind || '').toUpperCase(), r.address || '', r.box === 'rent' ? '1099-MISC box 1' : '1099-NEC box 1', num(r.amount), r.form_on_file ? 'Yes' : 'No'])];
}

// ── Agent accounts ─────────────────────────────────────────────────────────
export const CHARGE_KINDS = [['monthly', 'Monthly fee'], ['transaction', 'Transaction fee'], ['eo', 'E&O insurance'], ['other', 'Other charge'], ['credit', 'Credit (takes off what is owed)']];
export const EVERY = [['month', 'Every month'], ['quarter', 'Every three months'], ['year', 'Every year']];
export const kindWord = (k) => (CHARGE_KINDS.find(([id]) => id === k) || [null, k])[1];

// One agent's statement as tables: what they were paid, and what they owe.
export function statementTables(d, { subtitle = '' } = {}) {
  if (!d) return [];
  const name = (d.agent && d.agent.name) || 'Agent';
  const cl = d.closings || [], paid = d.paid || [];
  const t1 = { title: `${name}: closings`, subtitle, wide: true, empty: !cl.length, columns: ['Closing', 'Commission', 'Your share', 'Office fee', 'Referral', 'TC'],
    rows: [...cl.map((c) => ({ kind: 'row', cells: [[day(c.date), c.address].filter(Boolean).join(' · '), num(c.gross), num(c.agent), num(c.office), num(c.referral), num(c.tc)] })),
      { kind: 'total', cells: ['Total', ...['gross', 'agent', 'office', 'referral', 'tc'].map((k) => cents(cl.reduce((s, c) => s + num(c[k]), 0)))] },
      { kind: 'note', cells: ['From the Gold Report as written.'] }] };
  const t2 = { title: `${name}: paid by the brokerage`, subtitle, empty: !paid.length, columns: ['Paid', 'Amount'],
    rows: [...paid.map((p) => ({ kind: 'row', cells: [[day(p.date), p.what].filter(Boolean).join(' · '), num(p.amount)] })), { kind: 'total', cells: ['Total paid, from the books', cents(d.paid_total)] }] };
  const lines = [...(d.charges || []).map((c) => ({ date: c.date, label: `${kindWord(c.kind)}: ${c.label}`, amount: num(c.amount) })),
    ...(d.payments || []).map((p) => ({ date: p.date, label: 'Payment received', amount: -num(p.amount) }))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const t3 = { title: `${name}: owed to the brokerage`, subtitle, empty: false, columns: ['', 'Amount'],
    rows: [{ kind: 'row', cells: ['Owed at the start', cents(d.owed_before)] }, ...lines.map((l) => ({ kind: 'row', cells: [[day(l.date), l.label].filter(Boolean).join(' · '), l.amount] })),
      { kind: 'total', cells: [num(d.owed) < 0 ? 'Paid ahead' : 'Owed now', Math.abs(cents(d.owed))] }] };
  return [t1, t2, t3];
}
