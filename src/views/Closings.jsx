// Closings — the Gold Report's closings arriving in the brokerage's books.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Closings post themselves. Each
// Gold Report closing creates the brokerage entry ... A flawed sheet row is
// held for a person, not guessed."
//
// A closing whose figures add up goes into the books by itself: the commission
// on the day it was received, the agent's share on the day it was paid. One
// that does not is listed here with the reason, and waits. The database does
// all of it (supabase/sql/2026-10-07b_closings.sql); this screen shows what is
// waiting and takes the person's answer.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { bookTitle } from '../books';
import { NOTE_TEXT, PART_TEXT, ROW_REASONS, changeText, closingDay, groupClosings, partNeeds, postsAsWritten, reasonText, sheetLine } from '../closings';

const money = (n) => fmtUSDCents(Math.abs(Number(n) || 0));

// ── Switching it on, and where the money lands ─────────────────────────────
function Settings({ book, settings, canManage, onSaved }) {
  const [accounts, setAccounts] = useState(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ deposit: (settings && settings.deposit_account) || '', pay: (settings && settings.pay_account) || '', start: (settings && settings.start_on) || book.starts_on || '' });
  const [busy, setBusy] = useState(false);
  const on = !!(settings && settings.is_on);
  useEffect(() => {
    let live = true;
    supabase.rpc('book_account_balances', { p_book: book.id }).then(({ data }) => { if (live) setAccounts((data || []).filter((a) => a.kind === 'bank' || a.kind === 'cash')); });
    return () => { live = false; };
  }, [book.id]);
  const save = async (turnOn) => {
    if (turnOn && !await confirmDialog(`Start putting closings into ${bookTitle(book)}? Every closing on the Gold Report from ${closingDay(f.start)} on whose figures add up will be entered: the commission into ${f.deposit}, and the agent's share out of ${f.pay || f.deposit}. The rest will wait here for a person.`, { confirmLabel: 'Start' })) return;
    setBusy(true);
    const { error } = await supabase.rpc('closing_settings_save', { p_book: book.id, p_on: turnOn, p_deposit: f.deposit || null, p_pay: f.pay || null, p_start: f.start || null });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    setOpen(false); onSaved();
  };
  if (on && !open) {
    return (
      <p className="bk-help" data-testid="closings-on">Closings from {closingDay(settings.start_on)} on are entered here: commissions into <b>{settings.deposit_account}</b>, agents paid from <b>{settings.pay_account || settings.deposit_account}</b>.
        {canManage && <> <button type="button" className="bk-link" onClick={() => setOpen(true)}>Change</button></>}</p>
    );
  }
  if (!canManage) return <p className="mr-note"><span>Closings are not being entered in these books yet. An owner or admin can switch that on.</span></p>;
  return (
    <form className="mr-card" onSubmit={(e) => { e.preventDefault(); save(true); }} data-testid="closings-settings">
      <div className="bk-eye">{on ? 'Where closings are entered' : 'Closings are not being entered yet'}</div>
      {!on && <p className="bk-help">When this is on, each closing on the Gold Report is entered for you: the commission on the day it was received and the agent's share on the day it was paid. A closing whose figures do not add up is never entered by itself. It waits here with the reason.</p>}
      {accounts && accounts.length === 0 ? <p className="mr-note stuck"><span>These books have no bank account yet. Add the brokerage's operating account on the Setup tab, then come back.</span></p> : (<>
        <label className="mr-f">Commissions are deposited into
          <select value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} data-testid="closings-deposit"><option value="">Choose an account</option>{(accounts || []).map((a) => <option key={a.account} value={a.account}>{a.account}</option>)}</select>
        </label>
        <label className="mr-f">Agents are paid from
          <select value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })}><option value="">The same account</option>{(accounts || []).map((a) => <option key={a.account} value={a.account}>{a.account}</option>)}</select>
        </label>
        <label className="mr-f">Start with closings from<input type="date" value={f.start} max={todayNY()} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <p className="bk-help">Money that moved before that day is left alone. If some of these closings are already in the books from a bank statement, they are matched to the bank's line, not entered twice.</p>
        <div className="mr-go">
          <button type="submit" className="save" disabled={busy || !f.deposit || !f.start} data-testid="closings-turn-on">{on ? 'Save' : 'Start entering closings'}</button>
          {open && <button type="button" className="clear" onClick={() => setOpen(false)}>Cancel</button>}
          {on && <button type="button" className="clear" disabled={busy} onClick={() => save(false)}>Stop entering closings</button>}
        </div>
      </>)}
    </form>
  );
}

// ── One held part ──────────────────────────────────────────────────────────
function HeldPart({ row, categories, canWrite, busy, decide }) {
  const need = partNeeds(row);
  const [date, setDate] = useState(row.date || '');
  const [payee, setPayee] = useState(need.payee ? '' : row.payee || '');
  const [cat, setCat] = useState(row.category_id || '');
  const ready = (!need.date || date) && (!need.payee || payee.trim()) && (!need.category || cat);
  const own = (row.reasons || []).filter((c) => !ROW_REASONS.includes(c));
  const args = { p_date: date || null, p_payee: payee.trim() || null, p_category: cat || null };
  return (
    <div className="cl-part" data-testid="closing-part">
      <div className="cl-part-h"><span>{PART_TEXT[row.part] || row.part}{row.date ? <i> · {closingDay(row.date)}</i> : null}</span><b className={row.amount > 0 ? 'in' : ''}>{row.amount > 0 ? '' : '-'}{money(row.amount)}</b></div>
      {own.map((c) => <p className="cl-why" key={c}>{reasonText(c, row)}</p>)}
      {canWrite && (<>
        {(need.date || need.payee || need.category) && (
          <div className="mr-two">
            {need.date && <label className="mr-f">Day the money moved<input type="date" value={date} max={todayNY()} onChange={(e) => setDate(e.target.value)} /></label>}
            {need.payee && <label className="mr-f">Who was paid<input type="text" value={payee} onChange={(e) => setPayee(e.target.value)} autoComplete="off" /></label>}
            {need.category && <label className="mr-f">What it was for
              <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Choose</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          </div>
        )}
        {need.twin && (row.twins || []).map((t) => (
          <div className="cl-twin" key={t.id}><span>{t.payee || 'No payee'} · {closingDay(t.date)}{t.bank ? ' · from a bank statement' : ''}</span>
            <button type="button" className="bk-link" disabled={busy} onClick={() => decide(row.id, 'same', { ...args, p_same_as: t.id })}>It is this one</button></div>
        ))}
        <div className="mr-go">
          <button type="button" className="save" disabled={busy || !ready} onClick={() => decide(row.id, need.twin ? 'post_new' : 'post', args)} data-testid="closing-post">{need.twin ? 'Different money: enter it' : 'Enter it'}</button>
          <button type="button" className="clear" disabled={busy} onClick={() => decide(row.id, 'set_aside', {})}>Leave it out</button>
        </div>
      </>)}
    </div>
  );
}

function HeldClosing({ g, categories, canWrite, busy, decide, decideAll }) {
  const rowWhy = g.reasons.filter((c) => ROW_REASONS.includes(c));
  const allPlain = g.parts.every(postsAsWritten);
  return (
    <div className="mr-card cl-card" data-testid="closing-held">
      <div className="cl-h"><b>{g.address || (g.kind === 'fee' ? 'A payment, no property' : 'No address')}</b><span>{[g.agent, g.trans_id ? `Gold Report ${g.year} #${g.trans_id}` : ''].filter(Boolean).join(' · ')}</span></div>
      <p className="bk-help">Sheet: {sheetLine(g.sheet)}</p>
      {g.sheet_note && <p className="bk-help">Note on the sheet: “{g.sheet_note}”</p>}
      {rowWhy.map((c) => <p className="st-proof warn" key={c}><span>{reasonText(c, g.parts[0])}</span></p>)}
      {g.parts.map((r) => <HeldPart key={r.id + ':' + (r.reasons || []).join()} row={r} categories={categories} canWrite={canWrite} busy={busy} decide={decide} />)}
      {canWrite && allPlain && g.parts.length > 1 && <button type="button" className="bk-link" disabled={busy} onClick={() => decideAll(g.parts)}>I checked it: enter all {g.parts.length} as written</button>}
    </div>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────
const VIEWS = [['held', 'Needs a person'], ['changed', 'Sheet changed'], ['posted', 'Entered'], ['set_aside', 'Left out']];

export default function Closings({ book, taxCategories, onChanged }) {
  const [view, setView] = useState('held');
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(null);     // closings still to read, while catching up
  const [limit, setLimit] = useState(60);
  const synced = useRef(false);
  const bookId = book.id;

  const load = useCallback(async (v, n) => {
    const { data, error } = await supabase.rpc('closings_list', { p_book: bookId, p_view: v, p_limit: n, p_offset: 0 });
    if (error) { notifyError('Closings did not load: ' + error.message); return null; }
    setD(data); return data;
  }, [bookId]);
  useEffect(() => { load(view, limit); }, [load, view, limit]);

  // Catch the books up with the sheet, a bounded batch at a time.
  const catchUp = useCallback(async () => {
    let posted = false;
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.rpc('closings_sync', { p_book: bookId, p_limit: 60 });
      if (error) { notifyError('The Gold Report could not be read into the books: ' + error.message); break; }
      if (!data || !data.on) break;
      if (data.done) posted = true;
      setReading(data.left || 0);
      if (!data.left || !data.done) break;
    }
    setReading(null);
    if (posted && onChanged) onChanged();
    return posted;
  }, [bookId, onChanged]);
  useEffect(() => {
    if (!d || synced.current || !d.can_write || !(d.settings && d.settings.is_on)) return;
    synced.current = true;
    if (d.unread > 0) { setReading(d.unread); catchUp().then(() => load(view, limit)); }
  }, [d, catchUp, load, view, limit]);

  const decide = async (id, action, args) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('closing_decide', { p_id: id, p_action: action, ...args });
    setBusy(false);
    if (error) { notifyError(error.message); return false; }
    if ((action === 'post' || action === 'post_new' || action === 'same') && data && data.state !== 'posted') {
      notify((data.reasons || []).includes('maybe_in_books') ? 'The same amount is already in the books near that day. Say whether it is the same money.' : reasonText('could_not_post', data), 'error');
    }
    if (onChanged) onChanged();
    await load(view, limit);
    return true;
  };
  const decideAll = async (parts) => {
    if (!await confirmDialog(`Enter all ${parts.length} parts of this closing exactly as the sheet has them?`, { confirmLabel: 'Enter them' })) return;
    for (const p of parts) if (!await decide(p.id, 'post', {})) break;
  };

  if (!d) return <div className="mr-empty">Opening.</div>;
  const c = d.counts || {}, on = !!(d.settings && d.settings.is_on);
  const groups = view === 'held' ? groupClosings(d.rows) : [];
  const cats = (taxCategories || []).filter((x) => x.kind !== 'transfer');
  return (
    <div className="mr" data-testid="closings">
      <Settings book={book} settings={d.settings} canManage={d.can_manage} onSaved={async () => { synced.current = false; await load(view, limit); }} />
      {reading != null && <p className="mr-note" data-testid="closings-reading"><span>Reading the Gold Report into the books: {reading} {reading === 1 ? 'closing' : 'closings'} to go.</span></p>}
      {(d.problems || []).length > 0 && <p className="mr-note stuck"><span>{d.problems.length} sheet {d.problems.length === 1 ? 'row' : 'rows'} could not be read at all ({d.problems.map((p) => '#' + String(p.key).split('-').pop()).join(', ')}). Tell Dara.</span></p>}
      {(on || (c.held || 0) + (c.posted || 0) + (c.set_aside || 0) > 0) && (<>
        <div className="mr-chips" role="tablist" aria-label="Closings">
          {VIEWS.map(([id, label]) => <button type="button" key={id} className={view === id ? 'on' : ''} aria-selected={view === id} onClick={() => { setLimit(60); setView(id); }} data-testid={'closings-' + id}>{label} {c[id] || 0}</button>)}
        </div>
        {view === 'held' && (groups.length === 0 ? <div className="mr-empty">Nothing is waiting. Every closing that has been read is in the books or left out.</div>
          : <>{groups.map((g) => <HeldClosing key={g.key} g={g} categories={cats} canWrite={d.can_write} busy={busy} decide={decide} decideAll={decideAll} />)}</>)}
        {view !== 'held' && (d.rows.length === 0 ? <div className="mr-empty">{view === 'changed' ? 'The sheet agrees with the books.' : view === 'posted' ? 'No closing has been entered yet.' : 'Nothing has been left out.'}</div> : (
          <div className="bk-list">
            {d.rows.map((r) => (
              <div className="bk-row cl-row" key={r.id} data-testid="closing-row">
                <span className="n">{r.address || r.payee || 'No address'}
                  <i>{[PART_TEXT[r.part], r.agent, r.date ? closingDay(r.date) : '', r.adopted ? 'matched to a line from the bank' : ''].filter(Boolean).join(' · ')}</i>
                  {view === 'changed' && <i className="cl-warn">{changeText(r)}</i>}
                  {view === 'set_aside' && <i>{NOTE_TEXT[r.note] || ''}</i>}
                  {d.can_write && view === 'changed' && <span className="cl-acts">
                    <button type="button" className="bk-link" disabled={busy} onClick={() => decide(r.id, 'accept_change', {})}>{r.changed && r.changed.gone ? (r.adopted ? 'Untie it from this closing' : 'Take it out of the books') : 'Update the books'}</button>
                    <button type="button" className="bk-link" disabled={busy} onClick={() => decide(r.id, 'keep', {})}>Keep the books as they are</button></span>}
                  {d.can_write && view === 'set_aside' && r.note !== 'left_the_sheet' && <span className="cl-acts"><button type="button" className="bk-link" disabled={busy} onClick={() => decide(r.id, 'bring_back', {})}>Bring it back</button></span>}
                </span>
                <span className="a">{r.amount > 0 ? '' : '-'}{money(r.amount)}</span>
              </div>
            ))}
          </div>
        ))}
        {d.rows.length >= limit && <button type="button" className="bk-link" onClick={() => setLimit(limit + 100)}>Show more</button>}
      </>)}
    </div>
  );
}
