// Reconcile — ticking the books against the bank's statement, one account at
// a time, until they agree to the cent.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Bank reconciliation: each
// month, per account, ticks the ledger against the statement and shows what is
// unmatched. Without it nobody knows the books are right. It is the one
// control a CPA checks first."
//
// What came in on an uploaded statement for the account is ticked already
// (the bank itself said it happened); a person ticks the rest. It can be
// finished only at a difference of zero, and once finished those entries keep
// their amount, date and account until an owner or admin reopens it. The
// database enforces all of that; this screen shows it.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { bookTitle, can } from '../books';
import { dayText, reconciliationTable } from '../bookReports';
import { ExportBar, ReportTable } from './BookReports';

const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const key = (i) => i.transaction_id + ':' + i.side;

// ── One reconciliation ─────────────────────────────────────────────────────
function Working({ book, id, onBack }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState('open');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('recon_detail', { p_id: id });
    if (error) { notifyError('That reconciliation did not open: ' + error.message); onBack(); return; }
    setD(data);
  }, [id, onBack]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="mr-empty">Opening.</div>;

  const rec = d.rec, n = d.numbers || {}, items = d.items || [];
  const card = d.kind === 'card';
  const shown = (v) => fmtUSDCents(card ? -Number(v) : Number(v));
  const diff = Number(n.difference) || 0;
  const mark = async (list, on) => {
    if (!list.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('recon_mark', { p_id: id, p_items: list.map((i) => ({ id: i.transaction_id, side: i.side })), p_on: on });
    if (error) notifyError(error.message);
    await load(); setBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('recon_finish', { p_id: id });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    notify(`${rec.account} is reconciled through ${dayText(rec.statement_date)}`, 'success');
    await load();
  };
  const reopen = async () => {
    const msg = d.finished ? `Reopen the ${dayText(rec.statement_date)} reconciliation of ${rec.account}? Its entries can be changed again until it is finished again. Your name goes into the record.`
      : `Put this reconciliation away without finishing? The ticks you made are discarded.`;
    if (!await confirmDialog(msg, { confirmLabel: d.finished ? 'Reopen it' : 'Discard it' })) return;
    setBusy(true);
    const { error } = await supabase.rpc('recon_reopen', { p_id: id });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    if (d.finished) load(); else onBack();
  };

  const table = reconciliationTable(rec, n, items);
  const held = d.held;
  const heldGap = held ? Math.round((Number(held.escrow) - Number(held.held)) * 100) / 100 : 0;
  const open = items.filter((i) => !i.cleared), ticked = items.filter((i) => i.cleared);
  const list = show === 'open' ? open : ticked;

  return (
    <div className="mr" data-testid="reconcile-working">
      <button type="button" className="bk-link" onClick={onBack}>Back to all accounts</button>
      <div className="mr-head"><h3>{rec.account}</h3><span>Statement of {dayText(rec.statement_date)}</span></div>
      <div className="bk-net" data-testid="reconcile-numbers">
        <div><span>{card ? 'Statement says is owed' : 'Statement says'}</span><b>{shown(n.statement)}</b></div>
        <div><span>Ticked so far</span><b>{shown(n.cleared_balance)}</b></div>
        <div className="net"><span>Difference</span><b>{fmtUSDCents(Math.abs(diff))}</b></div>
      </div>
      {d.finished ? (
        <p className="st-proof good"><span>Reconciled by {rec.by} on {dayText(new Date(rec.finished_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))}. These entries keep their amount, date and account unless this is reopened.</span></p>
      ) : diff === 0 ? (
        <p className="st-proof good"><span>The books agree with the statement to the cent.</span></p>
      ) : (
        <p className="st-proof warn"><span>{diff > 0 ? `The statement shows ${fmtUSDCents(Math.abs(diff))} more than what is ticked.` : `What is ticked comes to ${fmtUSDCents(Math.abs(diff))} more than the statement.`} Tick each line that is on the statement. If something on the statement is not in the list, it is missing from the books: add it on the Add tab and come back.</span></p>
      )}
      {held && (heldGap === 0
        ? <p className="st-proof good"><span>Escrow check: the escrow accounts hold {fmtUSDCents(held.escrow)}, and {fmtUSDCents(held.held)} is owed to others. They agree.</span></p>
        : <p className="st-proof bad"><span>Escrow check: the escrow accounts hold {fmtUSDCents(held.escrow)}, but {fmtUSDCents(held.held)} is recorded as owed to others. Every dollar in escrow should belong to someone. See the Held for others report.</span></p>)}

      {d.finished ? (<>
        <ReportTable table={table} />
        <ExportBar name={`${bookTitle(book)} reconciliation ${rec.account} ${rec.statement_date}`} heading={bookTitle(book)} tables={table} />
        {d.can_manage && <button type="button" className="bk-quiet danger" disabled={busy} onClick={reopen}>Reopen this reconciliation</button>}
      </>) : (<>
        <div className="mr-chips" role="tablist" aria-label="Entries">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Not ticked {open.length}</button>
          <button type="button" className={show === 'done' ? 'on' : ''} onClick={() => setShow('done')}>Ticked {ticked.length}</button>
        </div>
        {d.can_write && list.length > 1 && <button type="button" className="bk-link" disabled={busy} onClick={() => mark(list, show === 'open')}>{show === 'open' ? `Tick all ${list.length}` : `Untick all ${list.length}`}</button>}
        {list.length === 0 ? <div className="mr-empty">{show === 'open' ? 'Every entry up to the statement date is ticked.' : 'Nothing is ticked yet.'}</div> : (
          <div className="bk-list">
            {list.map((i) => (
              <label className="rc-row" key={key(i)} data-testid="reconcile-item">
                <input type="checkbox" checked={!!i.cleared} disabled={busy || !d.can_write} onChange={() => mark([i], !i.cleared)} />
                <span className="n">{i.payee || (i.other_account ? `Transfer ${i.amount > 0 ? 'from' : 'to'} ${i.other_account}` : 'No payee')}
                  <i>{[dayText(i.entry_date), i.category, i.from_statement ? 'came in on a statement' : '', i.split_group ? 'part of a split' : ''].filter(Boolean).join(' · ')}</i></span>
                <span className={'a' + (i.amount > 0 ? ' in' : '')}>{fmtUSDCents(Number(i.amount))}</span>
              </label>
            ))}
          </div>
        )}
        {d.can_write && (
          <div className="mr-go">
            <button type="button" className="save" disabled={busy || diff !== 0} onClick={finish} data-testid="reconcile-finish">{diff === 0 ? 'Finish: it agrees' : `Off by ${fmtUSDCents(Math.abs(diff))}`}</button>
            <button type="button" className="clear" disabled={busy} onClick={reopen}>Discard</button>
          </div>
        )}
        <p className="bk-help">Your ticks are saved as you go. You can leave and come back.</p>
      </>)}
    </div>
  );
}

// ── Every account ──────────────────────────────────────────────────────────
export default function Reconcile({ book }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);         // { account, kind, date, balance, hint }
  const [busy, setBusy] = useState(false);
  const canWrite = can(book, 'write');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('recon_list', { p_book: book.id });
    if (error) { notifyError('Reconciliation did not load: ' + error.message); setList({ accounts: [], history: [] }); return; }
    setList(data);
  }, [book.id]);
  useEffect(() => { if (!openId) load(); }, [load, openId]);
  const back = useCallback(() => setOpenId(null), []);

  const begin = async (a) => {
    if (a.open_id) { setOpenId(a.open_id); return; }
    // An uploaded statement for this account with a closing balance is the natural next one.
    let q = supabase.from('statement_imports').select('period_to, closing_balance, file_name').eq('book_id', book.id).ilike('account', a.account).is('taken_back_at', null)
      .not('closing_balance', 'is', null).not('period_to', 'is', null).order('period_to', { ascending: true }).limit(1);
    if (a.last_date) q = q.gt('period_to', a.last_date);
    const { data } = await q;
    const s = (data || [])[0];
    const card = a.kind === 'card';
    setForm({ account: a.account, kind: a.kind, date: s ? s.period_to : '', balance: s ? (card ? -Number(s.closing_balance) : Number(s.closing_balance)).toFixed(2) : '', hint: s ? s.file_name || 'your uploaded statement' : '' });
  };
  const start = async (e) => {
    e.preventDefault();
    const b = toNum(form.balance);
    if (!form.date || Number.isNaN(b) || form.balance === '') { notifyError('Enter the statement\'s closing date and closing balance.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('recon_start', { p_book: book.id, p_account: form.account, p_date: form.date, p_balance: form.kind === 'card' ? -b : b });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    setForm(null); setOpenId(data);
  };

  if (openId) return <Working book={book} id={openId} onBack={back} />;
  if (!list) return <div className="mr-empty">Opening.</div>;
  return (
    <div className="mr" data-testid="reconcile">
      <p className="bk-help">Reconciling proves the books match the bank. Take a statement, tick what is on it, and finish when the difference is zero. Do it for each account, each month.</p>
      {list.accounts.length === 0 && <div className="mr-empty">These books have no accounts yet. An account opens the first time an entry names it.</div>}
      <div className="st-uploads">
        {list.accounts.map((a) => (
          <button type="button" className="st-upload" key={a.account} disabled={!canWrite && !a.open_id} onClick={() => begin(a)} data-testid="reconcile-account">
            <span className="who"><b>{a.account}</b>
              <i>{a.last_date ? `Reconciled through ${dayText(a.last_date)}` : 'Never reconciled'}</i>
              <i>{a.unreconciled ? `${a.unreconciled} ${a.unreconciled === 1 ? 'entry' : 'entries'} not yet on a reconciled statement${a.oldest ? ', the oldest from ' + dayText(a.oldest) : ''}` : 'Nothing waiting'}</i></span>
            <span className={'st-chip ' + (a.open_id ? 'warn' : a.unreconciled ? 'plain' : 'good')}>{a.open_id ? 'In progress' : a.unreconciled ? 'Reconcile' : 'Up to date'}</span>
          </button>
        ))}
      </div>
      {form && (
        <form className="mr-card" onSubmit={start} data-testid="reconcile-start">
          <div className="bk-eye">{form.account}: from the statement</div>
          {form.hint && <p className="bk-help">Filled in from {form.hint}. Check it against the statement.</p>}
          <div className="mr-two">
            <label className="mr-f">Closing date<input type="date" value={form.date} max={todayNY()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="mr-f">{form.kind === 'card' ? 'Balance owed' : 'Closing balance'}<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} placeholder="0.00" /></label>
          </div>
          <div className="mr-go"><button type="submit" className="save" disabled={busy}>Start ticking</button><button type="button" className="clear" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {list.history.length > 0 && (<>
        <div className="mr-head"><h3>Finished</h3><span>{list.history.length}</span></div>
        <div className="bk-list">
          {list.history.map((h) => (
            <button type="button" className="bk-row rc-hist" key={h.id} onClick={() => setOpenId(h.id)}>
              <span className="n">{h.account}<i>Statement of {dayText(h.statement_date)} · by {h.by}</i></span><span className="a">{fmtUSDCents(Number(h.statement_balance))}</span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}
