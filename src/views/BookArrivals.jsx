// BookArrivals — a commission the brokerage paid, waiting to be added to the
// agent's own books.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "The agent's side arrives too.
// The same closing appears as commission income in the agent's own book,
// awaiting their approval. Only this one line crosses."
//
// Only the amount, the day and the address cross, into a list that only this
// set of books can read. Nothing goes in the books until the person says so,
// and the brokerage is never told what they answered.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { closingDay } from '../closings';
import { todayNY } from '../clock';
import { setAsideSentence } from '../taxSetAside';

function Arrivals({ book, onAdded }) {
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tax, setTax] = useState(null);       // { profit, settings } for the hold-back estimate
  const bookId = book.id;
  // The year's profit so far and how they file: what the hold-back estimate rests on.
  useEffect(() => {
    if (!open || tax) return;
    const today = todayNY();
    Promise.all([supabase.rpc('book_pnl', { p_book: bookId, p_from: today.slice(0, 4) + '-01-01', p_to: today, p_by: null }),
      supabase.from('user_tax_settings').select('filing_status, estimated_other_income').maybeSingle()]).then(([pnl, st]) => {
      const lines = (pnl.data && pnl.data.lines) || [];
      const profit = lines.reduce((s, l) => s + (l.class === 'income' ? Number(l.amount) : l.class === 'expense' ? -Number(l.amount) : 0), 0);
      setTax({ profit, settings: { filingStatus: (st.data && st.data.filing_status) || 'single', otherIncome: Number(st.data && st.data.estimated_other_income) || 0 } });
    });
  }, [open, tax, bookId]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('arrivals_waiting', { p_book: bookId });
    if (!error) setRows(Array.isArray(data) ? data : []);
  }, [bookId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    supabase.rpc('book_account_balances', { p_book: bookId }).then(({ data }) => {
      if (!live) return;
      const list = (data || []).filter((a) => a.kind === 'bank' || a.kind === 'cash').map((a) => a.account);
      setAccounts(list); setAccount((cur) => cur || list[0] || '');
    });
    return () => { live = false; };
  }, [open, bookId]);

  const answer = async (row, action, extra = {}) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('arrival_decide', { p_id: row.id, p_action: action, ...extra });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    if (action === 'accept') {
      notify(`${fmtUSDCents(row.amount)} of commission added to your books`, 'success');
      if (data && data.transaction && onAdded) {
        const { data: tx } = await supabase.from('transactions').select('*').eq('id', data.transaction).maybeSingle();
        if (tx) onAdded(tx);
      }
    }
    load();
  };

  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (!open) {
    return (
      <p className="mr-note stuck" data-testid="arrivals-waiting">
        <span>{rows.length === 1 ? 'A commission' : `${rows.length} commissions`} the brokerage paid you ({fmtUSDCents(total)}) {rows.length === 1 ? 'is' : 'are'} waiting to be added to your books.</span>
        <button type="button" onClick={() => setOpen(true)}>Look</button>
      </p>
    );
  }
  return (
    <div className="mr-card" data-testid="arrivals">
      <div className="bk-eye">Paid to you by the brokerage</div>
      <p className="bk-help">Each of these is what the brokerage's books say it paid you. Nothing is in your books until you add it, and the brokerage is not told what you answer here.</p>
      <label className="mr-f">Add them to this account
        <input type="text" list="arrival-accounts" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="The account it was paid into" autoComplete="off" />
        <datalist id="arrival-accounts">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
      </label>
      {rows.map((r) => (
        <div className="cl-part" key={r.id} data-testid="arrival">
          <div className="cl-part-h"><span>{r.memo || 'Commission'}<i> · {closingDay(r.date)}</i></span><b className="in">{fmtUSDCents(r.amount)}</b></div>
          {tax && <p className="bk-help" data-testid="arrival-set-aside">{setAsideSentence(r.amount, tax.profit, tax.settings, todayNY())}</p>}
          {(r.twins || []).map((t) => (
            <div className="cl-twin" key={t.id}><span>Already in your books? {t.payee || 'No payee'} · {closingDay(t.date)}{t.account ? ' · ' + t.account : ''}</span>
              <button type="button" className="bk-link" disabled={busy} onClick={() => answer(r, 'already', { p_transaction: t.id })}>It is this one</button></div>
          ))}
          <div className="mr-go">
            <button type="button" className="save" disabled={busy || !account.trim()} onClick={() => answer(r, 'accept', { p_account: account.trim() })} data-testid="arrival-accept">{(r.twins || []).length ? 'Different money: add it' : 'Add to my books'}</button>
            <button type="button" className="clear" disabled={busy} onClick={() => answer(r, 'decline')}>Not mine</button>
          </div>
        </div>
      ))}
      <button type="button" className="bk-link" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}

// ── Recurring entries, watched ─────────────────────────────────────────────
// Dara, 6 Oct 2026: "Rent, software and franchise fees expected each month;
// PrismOS notices when one is missing or its amount changed." Nothing is set
// up by anyone: "expected" is what the books show in each of the last three
// full months. This only reads; it never adds an entry.
function RecurringWatch({ book, canWrite }) {
  const [rows, setRows] = useState([]);
  const bookId = book.id;
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('book_recurring_watch', { p_book: bookId, p_today: null });
    if (!error) setRows(Array.isArray(data) ? data : []);
  }, [bookId]);
  useEffect(() => { load(); }, [load]);
  const dismiss = async (r) => {
    const { error } = await supabase.rpc('recurring_watch_dismiss', { p_book: bookId, p_key: r.key, p_month: r.month });
    if (error) notifyError(error.message); else setRows((prev) => prev.filter((x) => x.key !== r.key));
  };
  return rows.slice(0, 4).map((r) => (
    <p className="mr-note stuck" key={r.key} data-testid="recurring-notice">
      <span>{r.kind === 'missing'
        ? `${r.payee} is usually paid by the ${ordinal(r.by_day)} (about ${fmtUSDCents(r.usual)}). Nothing to them is in the books this month.`
        : `${r.payee} is usually ${fmtUSDCents(r.usual)} a month. This month it is ${fmtUSDCents(r.now)}.`}</span>
      {canWrite && <button type="button" onClick={() => dismiss(r)}>That is right</button>}
    </p>
  ));
}
const ordinal = (n) => { const d = Number(n) || 1; const s = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th'; return d + s; };

// What the checkbook should mention before anything is typed.
export default function BookNotices({ book, own, readOnly, onAdded }) {
  return (<>
    {own && !readOnly && <Arrivals book={book} onAdded={onAdded} />}
    <RecurringWatch book={book} canWrite={!readOnly} />
  </>);
}
