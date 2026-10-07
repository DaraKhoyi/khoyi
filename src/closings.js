// closings — the words and the shaping for closings that post themselves.
// Pure (no React, no network) so a guard can import it under plain node.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "A flawed sheet row is held for
// a person, not guessed." This file is where a flaw becomes a sentence.
const usd = (n) => (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function closingDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

export const PART_TEXT = {
  received: 'Commission received', agent: 'Paid to the agent', referral: 'Referral paid', tc: 'TC paid', payout: 'Payment to the agent', other: 'Money in from the agent',
};

// What does not add up, in dollars, from the sheet's own figures.
export function sheetGap(sheet) {
  if (!sheet) return 0;
  const n = (v) => Number(v) || 0;
  return cents(n(sheet.gross) - n(sheet.agent) - n(sheet.office) - n(sheet.referral) - n(sheet.tc));
}

export function reasonText(code, row) {
  const s = (row && row.sheet) || {};
  switch (code) {
    case 'does_not_add_up': {
      const gap = sheetGap(s);
      return `The sheet does not add up. It shows ${usd(s.gross)} received, and the agent, office fee, referral and TC come to ${usd(cents((Number(s.gross) || 0) - gap))}: ${usd(Math.abs(gap))} ${gap > 0 ? 'is not accounted for' : 'more than was received'}.`;
    }
    case 'no_agent': return 'The sheet names an agent PrismOS does not have.';
    case 'no_trans_id': return 'The sheet row has no Trans ID, so it cannot be followed from one day to the next.';
    case 'no_gross': return 'The sheet shows money paid out but no commission received.';
    case 'negative': return 'A figure on the sheet is below zero.';
    case 'paid_before_received': return `The sheet says the agent was paid (${closingDay(s.paid)}) before the commission came in (${closingDay(s.received)}).`;
    case 'no_date': return 'The sheet has no date for when this money moved.';
    case 'odd_date': return 'The date on the sheet does not look right.';
    case 'who_was_paid': return 'The sheet does not say who was paid.';
    case 'what_for': return 'The sheet does not say what this was for.';
    case 'maybe_in_books': return 'The same amount is already in the books within a week of this.';
    case 'no_account': return 'No bank account is chosen for closings yet.';
    case 'could_not_post': return `It could not be put in the books${row && row.note ? ': ' + row.note : '.'}`;
    default: return code;
  }
}

export const NOTE_TEXT = {
  removed_by_hand: 'Someone took this entry out of the books by hand.', set_aside_by_hand: 'Left out by a person.', left_the_sheet: 'No longer on the Gold Report.',
};

// What a person must supply before a held part can post.
export function partNeeds(row) {
  const r = row.reasons || [];
  return { date: !row.date || r.includes('no_date') || r.includes('odd_date'), payee: r.includes('who_was_paid'), category: !row.category_id || r.includes('what_for'), twin: r.includes('maybe_in_books') };
}
export const postsAsWritten = (row) => { const n = partNeeds(row); return !n.date && !n.payee && !n.category && !n.twin; };

// Held parts, one group per closing, in the order the server sent them.
export function groupClosings(rows) {
  const out = [], at = new Map();
  for (const r of rows || []) {
    let g = at.get(r.key);
    if (!g) {
      g = { key: r.key, address: r.address || '', agent: r.agent || '', trans_id: r.trans_id, year: r.year, kind: r.kind, sheet: r.sheet || null, sheet_note: r.sheet_note || '', parts: [], reasons: [] };
      at.set(r.key, g); out.push(g);
    }
    g.parts.push(r);
    for (const c of r.reasons || []) if (!g.reasons.includes(c)) g.reasons.push(c);
  }
  const order = ['received', 'agent', 'payout', 'other', 'referral', 'tc'];
  for (const g of out) g.parts.sort((a, b) => order.indexOf(a.part) - order.indexOf(b.part));
  return out;
}
// Reasons that are about the whole row are said once, above its parts.
export const ROW_REASONS = ['does_not_add_up', 'no_agent', 'no_trans_id', 'no_gross', 'negative', 'paid_before_received'];

export function sheetLine(sheet) {
  if (!sheet) return 'This closing is no longer on the Gold Report.';
  const bit = (label, v, d) => (Number(v) ? `${label} ${usd(v)}${d ? ' on ' + closingDay(d) : ''}` : '');
  return [bit('received', sheet.gross, sheet.received), bit('agent', sheet.agent, sheet.paid), bit('office fee', sheet.office), bit('referral', sheet.referral), bit('TC', sheet.tc),
    Number(sheet.franchise) ? `franchise cost ${usd(sheet.franchise)} (inside the office fee)` : ''].filter(Boolean).join(' · ') || 'The sheet shows no figures.';
}

export function changeText(row) {
  const c = row.changed || {};
  if (c.gone) return 'This is no longer on the Gold Report.';
  const bits = [];
  if (Number(c.amount) !== Number(row.amount)) bits.push(`${usd(Math.abs(c.amount))} (the books have ${usd(Math.abs(row.amount))})`);
  if ((c.date || null) !== (row.date || null)) bits.push(c.date ? `${closingDay(c.date)} (the books have ${closingDay(row.date)})` : 'no date');
  if (c.payee && c.payee !== row.payee && (row.part === 'agent' || row.part === 'payout')) bits.push(`${c.payee} (the books have ${row.payee})`);
  return bits.length ? 'The sheet now says ' + bits.join(', ') + '.' : 'The sheet row changed.';
}

export const CLOSING_BREAKDOWNS = [['agent', 'By agent'], ['month', 'By month'], ['closing', 'Each closing']];

// The closings report in the common table shape (see bookReports.js).
export function closingsTable(d, { subtitle = '' } = {}) {
  const lines = (d && d.lines) || [];
  const by = (d && d.by) || 'agent';
  const cols = ['gross', 'agent', 'referral', 'tc', 'office', 'franchise', 'kept'];
  const total = { n: 0 }; for (const c of cols) total[c] = 0;
  const rows = lines.map((l) => { total.n += Number(l.n) || 0; for (const c of cols) total[c] = cents(total[c] + (Number(l[c]) || 0)); return { kind: 'row', cells: [l.label, Number(l.n) || 0, ...cols.map((c) => Number(l[c]) || 0)] }; });
  rows.push({ kind: 'total', cells: ['Total', total.n, ...cols.map((c) => total[c])] });
  rows.push({ kind: 'note', cells: ['From the Gold Report as written, counted on the day the commission was received. The franchise cost is inside the office fee; "Kept" is the office fee less the franchise cost.'] });
  return { title: 'Closings', subtitle, plain: [1], wide: true, empty: !lines.length,
    columns: [by === 'month' ? 'Month' : by === 'closing' ? 'Closing' : 'Agent', 'Closings', 'Commission received', 'Paid to agents', 'Referrals', 'TC', 'Office fee', 'Franchise cost', 'Kept'], rows };
}
