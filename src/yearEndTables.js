// yearEndTables — the parts of the year-end bundle that are pure shaping: the
// Schedule C mapping, the list of entries, and the READ ME. No network, so a
// guard can import them under plain node. src/yearEnd.js does the fetching.
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Profit and loss lines against the Schedule C line each category is mapped to.
export function scheduleCTable(lines, categories, { subtitle = '' } = {}) {
  const lineOf = new Map((categories || []).map((c) => [c.id, String(c.schedule_c_line || '').trim()]));
  const groups = new Map();
  let income = 0, mapped = 0, unmapped = 0;
  for (const l of lines || []) {
    if (l.class === 'income') { income = cents(income + Number(l.amount)); continue; }
    if (l.class !== 'expense') continue;
    const raw = l.category_id ? lineOf.get(l.category_id) || '' : '';
    const key = !raw ? 'No Schedule C line chosen' : /not schedule c/i.test(raw) ? 'Not a Schedule C expense' : /^line/i.test(raw) ? raw : 'Line ' + raw;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
    if (/^Line/.test(key)) mapped = cents(mapped + Number(l.amount)); else unmapped = cents(unmapped + Number(l.amount));
  }
  const num = (k) => { const m = /(\d+)/.exec(k); return m ? Number(m[1]) : 999; };
  const rows = [{ kind: 'row', cells: ['Gross receipts (Schedule C line 1)', '', income] }];
  for (const key of [...groups.keys()].sort((a, b) => num(a) - num(b) || a.localeCompare(b))) {
    rows.push({ kind: 'head', cells: [key] });
    for (const l of groups.get(key)) rows.push({ kind: 'row', cells: [l.name || 'No category', key, cents(l.amount)] });
    rows.push({ kind: 'total', cells: ['Total ' + key, '', cents(groups.get(key).reduce((s, l) => s + Number(l.amount), 0))] });
  }
  rows.push({ kind: 'total', cells: ['Expenses on a Schedule C line', '', mapped] });
  if (unmapped) rows.push({ kind: 'note', cells: [`${unmapped.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of expenses is not on a Schedule C line. Your CPA decides where it belongs.`] });
  return { title: 'Schedule C mapping', subtitle, empty: !(lines || []).length, columns: ['Category', 'Schedule C line', 'Amount'], rows };
}

// Every entry, one row each, with the names a person would recognise.
export function entriesRows(entries, categories) {
  const cat = new Map((categories || []).map((c) => [c.id, c.name]));
  return [['Date', 'Amount', 'Account', 'Transfer to or from', 'Payee', 'Description', 'Category', 'Business or personal', 'How it was entered', 'Receipt', 'Entered at', 'Id'],
    ...entries.map((t) => [t.date, Number(t.amount), t.account || '', t.transfer_account || '', t.payee || '', t.description || '', cat.get(t.tax_category_id) || '', t.scope || '', t.entered_via || '', t.receipt_url ? 'yes' : '', t.created_at || '', t.id])];
}

export function readMe({ title, year, counts, missing, withFiles }) {
  const L = [
    `${title}: ${year ? 'year-end package for ' + year : 'everything in the books'}`,
    'Made by PrismOS. The books are kept on the cash basis: money counts on the day it moved.',
    '',
    'WHAT IS HERE',
    `  Reports.xlsx        ${counts.reports} reports, one per sheet (the same figures as the Reports screen)`,
    '  reports/            the same reports, each as a CSV file',
    `  Entries.csv         every entry${year ? ' dated in ' + year : ''}: ${counts.entries} rows`,
    withFiles ? `  receipts/           ${counts.receipts} receipt files, named by date, payee and amount` : '  (receipt files were left out of this bundle)',
    withFiles ? `  statements/         ${counts.statements} statement files, as they were uploaded, by account` : '  (statement files were left out of this bundle)',
    counts.drives ? `  The mileage log (${counts.drives} drives) is in Reports.xlsx and reports/.` : '',
    year ? `  The 1099 list covers ${counts.payees} tracked payee(s) and shows the last four digits of a tax ID only. The file with whole tax IDs is taken separately, by an owner or admin, from Reports, 1099s.` : '',
    '',
    'WHAT IS NOT HERE',
    ...(missing.length ? missing.map((m) => '  ' + m) : ['  Nothing was left out.']),
    '',
    'Nothing in PrismOS books is thrown away: an entry that is removed stays in the record, and statements and receipts are kept at least seven years.',
  ];
  return L.filter((l) => l !== '').join('\r\n').replace(/\r\nWHAT/g, '\r\n\r\nWHAT').replace(/\r\nNothing in PrismOS/, '\r\n\r\nNothing in PrismOS');
}
