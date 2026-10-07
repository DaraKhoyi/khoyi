// BookReports — the reports a set of books is kept for, read from the ledger,
// for any period, with CSV, Excel and print (PDF).
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Reports: profit and loss,
// balance sheet, cash flow, general ledger, trial balance; profit by agent, by
// team, by month; this year against last. Export to PDF, CSV and Excel. The
// reason to keep books at all."
//
// One component for every kind of book. What a person may see is decided by
// the database (each report function runs as the caller); this screen only
// lays the answer out. The shaping lives in src/bookReports.js so the screen,
// the file and the printed page cannot disagree.
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { PERIODS, bookTitle, periodRange, position } from '../books';
import { BREAKDOWNS, cashFlowTable, generalLedgerTable, heldTable, pnlTable, rangeText, standingTable, trialBalanceTable, yearBefore } from '../bookReports';
import { downloadCsv, downloadXlsx, printTables } from '../exportFile';

const Reconcile = React.lazy(() => import('./Reconcile'));

// One report, as rows. Wide ones scroll sideways with the names held in place.
export function ReportTable({ table }) {
  if (!table) return <div className="mr-empty">Adding it up.</div>;
  if (table.empty) return <div className="mr-empty">Nothing was entered for this period.</div>;
  const n = table.columns.length;
  // A column is figures when any row holds a number in it; words stay left.
  const fig = table.columns.map((_, k) => k > 0 && table.rows.some((r) => typeof r.cells[k] === 'number'));
  return (
    <div className={'rp-wrap' + (table.wide || n > 3 ? ' wide' : '')} data-testid="report-table">
      <table className="rp">
        <thead><tr>{table.columns.map((c, i) => <th key={i} className={fig[i] ? 'n' : ''}>{c}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (r.kind === 'head' ? <tr key={i} className="h"><td colSpan={n}>{r.cells[0]}</td></tr>
            : r.kind === 'note' ? <tr key={i} className="note"><td colSpan={n}>{r.cells[0]}</td></tr>
              : <tr key={i} className={r.kind}>{r.cells.map((c, k) => <td key={k} className={fig[k] ? 'n' : ''}>{typeof c === 'number' ? fmtUSDCents(c) : c}</td>)}</tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportBar({ name, heading, tables }) {
  const list = (Array.isArray(tables) ? tables : [tables]).filter((t) => t && !t.empty);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  const excel = async () => { setBusy(true); try { await downloadXlsx(name, list); } catch (e) { notifyError('The Excel file could not be made: ' + String((e && e.message) || e)); } setBusy(false); };
  return (
    <div className="mr-ways" role="group" aria-label="Take this report with you" data-testid="report-export">
      <button type="button" onClick={() => printTables(heading, list)}>Print or save as PDF</button>
      <button type="button" disabled={busy} onClick={excel}>{busy ? 'Making it' : 'Excel'}</button>
      <button type="button" onClick={() => downloadCsv(name, list)}>CSV</button>
    </div>
  );
}

const KINDS = [['pnl', 'Profit and loss'], ['standing', 'Where things stand'], ['cash', 'Cash flow'], ['held', 'Held for others'], ['trial', 'Trial balance'], ['gl', 'General ledger'], ['reconcile', 'Reconcile']];

export default function BookReports({ book, userId, summary = null }) {
  const [kind, setKind] = useState(summary ? 'summary' : 'pnl');
  const [period, setPeriod] = useState('year');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [by, setBy] = useState('');
  const [compare, setCompare] = useState(false);
  const [table, setTable] = useState(null);
  const today = todayNY();
  const range = useMemo(() => (period === 'custom' ? { from: custom.from || null, to: custom.to || null } : periodRange(period, today)), [period, custom, today]);
  const sub = `${bookTitle(book)} · ${rangeText(range.from, range.to)} · cash basis`;
  const asOf = range.to && range.to < today ? range.to : null;
  const kinds = summary ? [['summary', 'Summary'], ...KINDS] : KINDS;

  useEffect(() => {
    if (kind === 'summary' || kind === 'reconcile') return undefined;
    let live = true;
    setTable(null);
    (async () => {
      const args = { p_book: book.id, p_from: range.from, p_to: range.to };
      let t = null, err = null;
      if (kind === 'pnl') {
        const now = await supabase.rpc('book_pnl', { ...args, p_by: by || null });
        err = now.error;
        let before = null;
        if (!err && compare && !by && range.from && range.to) {
          const b = await supabase.rpc('book_pnl', { p_book: book.id, p_from: yearBefore(range.from), p_to: yearBefore(range.to), p_by: null });
          err = b.error; before = (b.data && b.data.lines) || [];
        }
        if (!err) t = pnlTable((now.data && now.data.lines) || [], { by, before, subtitle: sub });
      } else if (kind === 'standing') {
        const r = await supabase.rpc('book_position', { p_book: book.id, p_as_of: asOf });
        err = r.error; if (!err) t = standingTable(position((r.data && r.data.lines) || []), { subtitle: `${bookTitle(book)} · ${asOf ? 'on ' + rangeText(null, asOf).replace('Through ', '') : 'today'}` });
      } else if (kind === 'cash') {
        const r = await supabase.rpc('book_cash_flow', args);
        err = r.error; if (!err) t = cashFlowTable(r.data, { subtitle: sub });
      } else if (kind === 'trial') {
        const r = await supabase.rpc('book_trial_balance', { p_book: book.id, p_as_of: asOf });
        err = r.error; if (!err) t = trialBalanceTable(r.data, { subtitle: `${bookTitle(book)} · ${asOf ? rangeText(null, asOf) : 'through today'}` });
      } else if (kind === 'gl') {
        const r = await supabase.rpc('book_general_ledger', { ...args, p_limit: 2000, p_offset: 0 });
        err = r.error; if (!err) t = generalLedgerTable(r.data, { subtitle: sub });
      } else if (kind === 'held') {
        const r = await supabase.rpc('book_held_by_person', { p_book: book.id, p_as_of: asOf });
        err = r.error; if (!err) t = heldTable(r.data, { subtitle: `${bookTitle(book)} · ${asOf ? rangeText(null, asOf) : 'through today'}` });
      }
      if (!live) return;
      if (err) { notifyError('The report did not load: ' + err.message); setTable({ empty: true, columns: [], rows: [] }); return; }
      setTable(t);
    })();
    return () => { live = false; };
  }, [kind, book.id, range.from, range.to, asOf, by, compare, sub]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dated = kind !== 'summary' && kind !== 'reconcile';
  return (
    <div className="mr" data-testid="book-reports">
      <div className="mr-chips" role="tablist" aria-label="Report">
        {kinds.map(([id, label]) => <button type="button" key={id} className={kind === id ? 'on' : ''} aria-selected={kind === id} onClick={() => setKind(id)} data-testid={'report-' + id}>{label}</button>)}
      </div>
      {kind === 'summary' && summary}
      {kind === 'reconcile' && <React.Suspense fallback={<div className="mr-empty">Opening.</div>}><Reconcile book={book} userId={userId} /></React.Suspense>}
      {dated && (<>
        <div className="mr-chips" role="group" aria-label="Period">
          {PERIODS.map(([id, label]) => <button type="button" key={id} className={period === id ? 'on' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}
          <button type="button" className={period === 'custom' ? 'on' : ''} aria-pressed={period === 'custom'} onClick={() => setPeriod('custom')}>Other dates</button>
        </div>
        {period === 'custom' && (
          <div className="mr-two">
            <label className="mr-f">From<input type="date" value={custom.from} max={custom.to || today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="mr-f">To<input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        {kind === 'pnl' && (
          <div className="mr-two">
            <label className="mr-f">Break it down
              <select value={by} onChange={(e) => setBy(e.target.value)} data-testid="report-by">{BREAKDOWNS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </label>
            {!by && range.from && range.to && <label className="st-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /><span>Beside the same days a year before</span></label>}
          </div>
        )}
        <p className="bk-help">{table && table.subtitle ? table.subtitle : sub}{kind === 'standing' || kind === 'trial' || kind === 'held' ? '. This report is as of the last day of the period.' : '.'}</p>
        <ReportTable table={table} />
        <ExportBar name={`${bookTitle(book)} ${table ? table.title : ''} ${range.to || today}`} heading={`${bookTitle(book)} · printed ${rangeText(null, today).replace('Through ', '')}`} tables={table} />
      </>)}
    </div>
  );
}
