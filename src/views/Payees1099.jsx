// Payees1099 — who these books paid, whether a 1099 is due, and the W-9.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "1099 tracking. W-9 on file per
// agent and contractor, totals for the year, flags who crosses the IRS
// threshold, exports the year-end file." "W-9 tax IDs are encrypted and shown
// to owners and admins only."
//
// Totals come from the entries in the books, on the day the money moved. The
// IRS line comes from a table kept per tax year; a year with no figure is said
// to be unknown. A tax ID typed here is stored encrypted and never comes back
// in a list: only its last four digits do.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { bookTitle } from '../books';
import { BOXES, TAX_STATUS, cardNote, figuresLine, payeeStanding, payeesTable, yearEndRows } from '../payees';
import { downloadCsv } from '../exportFile';
import { ExportBar } from './BookReports';

function PayeeCard({ p, d, busy, save, setTin, reveal }) {
  const [open, setOpen] = useState(false);
  const [tin, setTinText] = useState('');
  const [seen, setSeen] = useState(null);
  const st = payeeStanding(p, d.figures);
  const foreign = p.tax_status === 'foreign';
  return (
    <div className="mr-card cl-card" data-testid="payee">
      <button type="button" className="py-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="who"><b>{p.name}</b><i>{fmtUSDCents(p.counts)} counts toward the form · {p.entries} {p.entries === 1 ? 'entry' : 'entries'}</i></span>
        <span className={'st-chip ' + st.tone}>{st.word}</span>
      </button>
      <p className="bk-help">{st.why} {cardNote(p)}</p>
      {open && d.can_write && (<>
        <label className="mr-f">Who they are for taxes
          <select value={p.tax_status} disabled={busy} onChange={(e) => save(p.id, { tax_status: e.target.value })}>{TAX_STATUS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {!foreign && <label className="mr-f">What they are paid for
          <select value={p.box} disabled={busy} onChange={(e) => save(p.id, { box: e.target.value })}>{BOXES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        <label className="st-check"><input type="checkbox" checked={!!p.form_on_file} disabled={busy} onChange={(e) => save(p.id, { form_on_file: e.target.checked, form_date: e.target.checked ? todayNY() : '' })} /><span>{foreign ? 'W-8BEN' : 'W-9'} on file{p.form_date ? ` since ${p.form_date}` : ''}</span></label>
        {!foreign && (<>
          <label className="mr-f">Mailing address<input type="text" defaultValue={p.address || ''} onBlur={(e) => { if (e.target.value !== (p.address || '')) save(p.id, { address: e.target.value }); }} autoComplete="off" /></label>
          <label className="mr-f">Tax ID {p.last4 ? `(on file, ends ${p.last4})` : '(none yet)'}<input type="text" inputMode="numeric" autoComplete="off" value={tin} onChange={(e) => setTinText(e.target.value)} placeholder="9 digits" data-testid="payee-tin" /></label>
          {tin && <div className="mr-go"><button type="button" className="save" disabled={busy || tin.replace(/\D/g, '').length !== 9} onClick={async () => { if (await setTin(p.id, tin)) { setTinText(''); setSeen(null); } }}>Save the tax ID</button></div>}
          <p className="bk-help">It is stored encrypted. After you save it, only the last four digits are shown here; an owner or admin can see all of it, and that is recorded with their name.</p>
          {d.can_manage && p.last4 && (seen ? <p className="st-proof plain" data-testid="payee-tin-seen"><span>{seen}</span><button type="button" className="bk-link" onClick={() => setSeen(null)}>Hide</button></p>
            : <button type="button" className="bk-link" disabled={busy} onClick={async () => setSeen(await reveal(p.id))}>Show the whole tax ID</button>)}
        </>)}
        <button type="button" className="bk-quiet danger" disabled={busy} onClick={() => save(p.id, { archived: true })}>Stop tracking {p.name}</button>
      </>)}
    </div>
  );
}

export default function Payees1099({ book }) {
  const thisYear = Number(todayNY().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const bookId = book.id;
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('book_1099', { p_book: bookId, p_year: year });
    if (error) { notifyError('The 1099 list did not load: ' + error.message); setD({ payees: [], untracked: [], year }); return; }
    setD(data);
  }, [bookId, year]);
  useEffect(() => { setD(null); load(); }, [load]);

  const save = async (id, p) => {
    setBusy(true);
    const { error } = await supabase.rpc('payee_save', { p_book: bookId, p_id: id, p });
    setBusy(false);
    if (error) { notifyError(error.message); return false; }
    await load(); return true;
  };
  const setTin = async (id, tin) => {
    setBusy(true);
    const { error } = await supabase.rpc('payee_set_tin', { p_id: id, p_tin: tin, p_kind: null });
    setBusy(false);
    if (error) { notifyError(error.message); return false; }
    notify('Tax ID saved', 'success'); await load(); return true;
  };
  const reveal = async (id) => {
    const { data, error } = await supabase.rpc('payee_reveal_tin', { p_id: id });
    if (error) { notifyError(error.message); return null; }
    return data ? String(data).replace(/^(\d{3})(\d{2})(\d{4})$/, '$1-$2-$3') : null;
  };
  const yearEnd = async () => {
    if (!await confirmDialog(`Take the ${year} year-end file? It holds whole tax IDs for everyone a 1099 is due to. It is recorded that you took it. Send it only to your CPA.`, { confirmLabel: 'Take the file' })) return;
    const { data, error } = await supabase.rpc('book_1099_file', { p_book: bookId, p_year: year });
    if (error) { notifyError(error.message); return; }
    if (!data.rows.length) { notify(`Nobody is over the line for ${year}, so the file would be empty`, 'info'); return; }
    downloadCsv(`${bookTitle(book)} 1099 year-end ${year}`, { title: `${bookTitle(book)} · 1099 year-end file · ${year}`, columns: yearEndRows(data)[0], rows: yearEndRows(data).slice(1).map((cells) => ({ kind: 'row', cells })) });
  };

  if (!d) return <div className="mr-empty">Adding it up.</div>;
  const table = payeesTable(d, { subtitle: `${bookTitle(book)} · payments made in ${year} · cash basis` });
  return (
    <div className="mr" data-testid="payees-1099">
      <div className="mr-chips" role="group" aria-label="Tax year">
        {[thisYear, thisYear - 1].map((y) => <button type="button" key={y} className={year === y ? 'on' : ''} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}
      </div>
      <p className="bk-help" data-testid="payees-figures">{figuresLine(year, d.figures)} Money paid by credit card is left off the form.</p>
      {d.payees.length === 0 && <div className="mr-empty">Nobody is being tracked for a 1099 yet.</div>}
      {d.payees.map((p) => <PayeeCard key={p.id} p={p} d={d} busy={busy} save={save} setTin={setTin} reveal={reveal} />)}
      {d.can_write && (d.untracked || []).length > 0 && (
        <div className="mr-card" data-testid="payees-untracked">
          <div className="bk-eye">Paid over the line and not on the list</div>
          {(d.untracked || []).map((u) => (
            <div className="cl-twin" key={(u.agent_id || u.contact_id || '') + u.label}><span>{u.label} · {fmtUSDCents(u.paid)}</span>
              <button type="button" className="bk-link" disabled={busy} onClick={() => save(null, { name: u.label, agent_id: u.agent_id || '', contact_id: u.contact_id || '' })}>Track</button></div>
          ))}
        </div>
      )}
      {d.can_write && (
        <form className="mr-card" onSubmit={async (e) => { e.preventDefault(); if (await save(null, { name })) setName(''); }}>
          <label className="mr-f">Track someone else<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="The payee, spelled as on your entries" autoComplete="off" data-testid="payee-new" /></label>
          <div className="mr-go"><button type="submit" className="save" disabled={busy || !name.trim()}>Add to the list</button></div>
        </form>
      )}
      <ExportBar name={`${bookTitle(book)} 1099 list ${year}`} heading={bookTitle(book)} tables={table} />
      {d.can_manage && <button type="button" className="bk-link" onClick={yearEnd} data-testid="payees-year-end">Year-end file for the CPA (with tax IDs)</button>}
    </div>
  );
}
