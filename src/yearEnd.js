// yearEnd — everything a CPA needs for a year, or everything in the books, as
// one zip a person can hand over or keep.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Year-end package. One button:
// reports, 1099 list, Schedule C mapping and all receipts, as a bundle for the
// CPA." and "Records retention ... Full export at any time. Your data stays
// yours and leaves in standard formats."
//
// Every figure comes from the same database functions the Reports screen
// uses, shaped by the same table builders, so the bundle cannot say something
// the screen does not. Whatever could not be fetched is LISTED in the bundle's
// READ ME; nothing is left out silently.
import { supabase } from './dataService';
import { bookTitle, position } from './books';
import { cashFlowTable, dayText, generalLedgerTable, heldTable, mileageTable, pnlTable, standingTable, tableRows, trialBalanceTable } from './bookReports.js';
import { payeesTable } from './payees.js';
import { fileName, toCsv, workbookBytes } from './exportFile.js';
import { receiptBucket } from './receipts';
import { entriesRows, readMe, scheduleCTable } from './yearEndTables.js';

const pathName = (s) => fileName(String(s || '').replace(/[\/\\]+/g, ' ')) || 'file';
async function all(build, size = 1000, cap = 200000) {
  const out = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

// year: a number for the year-end package, or null for everything in the books.
// onStep(text) is told what is happening; the result is { blob, name, counts, missing }.
export async function buildBundle({ book, year = null, categories = [], userId = null, withFiles = true, onStep = () => {} }) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const title = bookTitle(book), from = year ? `${year}-01-01` : null, to = year ? `${year}-12-31` : null;
  const sub = `${title} · ${year ? 'calendar year ' + year : 'everything in the books'} · cash basis`;
  const missing = [], tables = [];
  const rpc = async (what, fn, args) => { const r = await supabase.rpc(fn, args); if (r.error) { missing.push(`${what}: ${r.error.message}`); return null; } return r.data; };

  onStep('Adding up the reports');
  const pnl = await rpc('Profit and loss', 'book_pnl', { p_book: book.id, p_from: from, p_to: to, p_by: null });
  if (pnl) { tables.push(pnlTable(pnl.lines || [], { subtitle: sub })); tables.push(pnlTable((await rpc('Profit and loss by month', 'book_pnl', { p_book: book.id, p_from: from, p_to: to, p_by: 'month' }) || { lines: [] }).lines, { by: 'month', subtitle: sub })); tables[tables.length - 1].title = 'Profit and loss by month'; }
  const pos = await rpc('Where things stand', 'book_position', { p_book: book.id, p_as_of: to });
  if (pos) tables.push(standingTable(position(pos.lines || []), { subtitle: `${title} · ${to ? 'on ' + dayText(to) : 'today'}` }));
  const cash = await rpc('Cash flow', 'book_cash_flow', { p_book: book.id, p_from: from, p_to: to }); if (cash) tables.push(cashFlowTable(cash, { subtitle: sub }));
  const held = await rpc('Held for others', 'book_held_by_person', { p_book: book.id, p_as_of: to }); if (held && ((held.lines || []).length || Number(held.escrow))) tables.push(heldTable(held, { subtitle: sub }));
  const trial = await rpc('Trial balance', 'book_trial_balance', { p_book: book.id, p_as_of: to }); if (trial) tables.push(trialBalanceTable(trial, { subtitle: sub }));
  if (pnl) tables.push(scheduleCTable(pnl.lines || [], categories, { subtitle: sub }));
  let payees = null;
  if (year) { payees = await rpc('1099 list', 'book_1099', { p_book: book.id, p_year: year }); if (payees) tables.push(payeesTable(payees, { subtitle: sub })); }

  onStep('Writing out the general ledger');
  const gl = { lines: [], total: 0 };
  for (let off = 0; off < 200000; off += 2000) {
    const page = await rpc('General ledger', 'book_general_ledger', { p_book: book.id, p_from: from, p_to: to, p_limit: 2000, p_offset: off });
    if (!page) break;
    gl.lines.push(...(page.lines || [])); gl.total = gl.lines.length;
    if ((page.lines || []).length < 2000) break;
  }
  const glTable = generalLedgerTable(gl, { subtitle: sub });

  onStep('Listing every entry');
  let entries = [];
  try {
    entries = await all(() => { let q = supabase.from('transactions').select('*').eq('book_id', book.id).eq('is_archived', false).order('date').order('id'); if (from) q = q.gte('date', from).lte('date', to); return q; });
  } catch (e) { missing.push('The list of entries: ' + e.message); }

  let drives = 0;
  if (book.is_mine && userId) {
    let q = supabase.from('mileage_entries').select('*').eq('user_id', userId); if (from) q = q.gte('date', from).lte('date', to);
    const [m, r] = await Promise.all([q, supabase.from('mileage_rates').select('*')]);
    if (m.error) missing.push('The mileage log: ' + m.error.message);
    else if ((m.data || []).length) { drives = m.data.length; for (const y of [...new Set(m.data.map((e) => String(e.date).slice(0, 4)))].sort()) tables.push(mileageTable(m.data, y, r.data || [])); }
  }
  const recs = await rpc('Reconciliations', 'recon_list', { p_book: book.id });
  const recHist = ((recs && recs.history) || []).filter((h) => !year || String(h.statement_date).startsWith(String(year)));
  if (recHist.length) tables.push({ title: 'Reconciliations finished', subtitle: sub, columns: ['Account', 'Statement date', 'Statement balance', 'Finished by'], rows: recHist.map((h) => ({ kind: 'row', cells: [h.account, dayText(h.statement_date), Number(h.statement_balance), h.by || ''] })) });

  const shown = tables.filter((t) => t && !t.empty);
  zip.file('Reports.xlsx', await workbookBytes([...shown, ...(glTable.empty ? [] : [glTable])]));
  for (const t of shown) zip.file(`reports/${pathName(t.title)}.csv`, '﻿' + toCsv(tableRows(t)));
  if (!glTable.empty) zip.file(`reports/${pathName('General ledger')}.csv`, '﻿' + toCsv(tableRows(glTable)));
  zip.file('Entries.csv', '﻿' + toCsv(entriesRows(entries, categories)));

  // The files themselves: receipts, and the statements as the bank sent them.
  let receipts = 0, statements = 0;
  if (withFiles) {
    const want = entries.filter((t) => t.receipt_url);
    const used = new Set();
    const put = async (folder, base, bucket, path) => {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) { missing.push(`${folder}: ${base} could not be fetched`); return false; }
      const ext = (String(path).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      let name = `${folder}/${pathName(base)}.${ext}`; for (let n = 2; used.has(name); n++) name = `${folder}/${pathName(base)} (${n}).${ext}`;
      used.add(name); zip.file(name, data); return true;
    };
    for (let i = 0; i < want.length; i++) {
      if (i % 5 === 0) onStep(`Collecting receipts: ${i} of ${want.length}`);
      const t = want[i];
      if (await put('receipts', `${t.date} ${t.payee || 'receipt'} ${Math.abs(Number(t.amount)).toFixed(2)}`, receiptBucket(t.receipt_url), t.receipt_url)) receipts++;
    }
    let q = supabase.from('statement_imports').select('account, period_from, period_to, file_name, file_paths, created_at').eq('book_id', book.id).is('taken_back_at', null);
    const st = await q;
    if (st.error) missing.push('The uploaded statements: ' + st.error.message);
    const mine = (st.data || []).filter((s) => !year || [s.period_from, s.period_to, s.created_at].some((d) => String(d || '').startsWith(String(year))));
    for (let i = 0; i < mine.length; i++) {
      onStep(`Collecting statements: ${i} of ${mine.length}`);
      for (const p of mine[i].file_paths || []) if (await put(`statements/${pathName(mine[i].account)}`, `${mine[i].period_to || String(mine[i].created_at).slice(0, 10)} ${mine[i].file_name || 'statement'}`.replace(/\.[a-z0-9]{2,5}$/i, ''), 'statements', p)) statements++;
    }
  }

  const counts = { reports: shown.length + (glTable.empty ? 0 : 1), entries: entries.length, receipts, statements, drives, payees: payees ? (payees.payees || []).length : 0 };
  zip.file('READ ME.txt', readMe({ title, year, counts, missing, withFiles }));
  onStep('Packing it up');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, name: `${fileName(title)} ${year ? 'year-end ' + year : 'everything'}.zip`, counts, missing };
}
