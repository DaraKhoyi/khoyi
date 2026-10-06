// BookRoom — Money for a set of books that is not the person's own: the
// brokerage's, a team's, or someone else's that they have been put on.
//
// It is the SAME check register and the SAME table of entries as a person's
// own Money room (FinanceLedger, MoneyRegister) — one ledger, not a second
// copy — with the parts that only make sense for one's own business left out:
// the Blueprint, lead-generation systems, Schedule C, quarterly tax.
//
//   Add      the register: enter, import a statement, sort uncategorized.
//   Reports  where the money came from and went, by category, for any period;
//            money held for others is kept apart so it never reads as income.
//   Setup    the categories, the accounts (bank, card, escrow) and closing.
//
// What a person may do here comes from their seat on the book (../books.js
// can()); the database enforces the same thing on every request.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { Icon } from '../icons';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { FinanceLedger } from './FinanceLedger';
import { ACCOUNT_KINDS, CATEGORY_KINDS, PERIODS, bookTitle, can, isDenied, longDay, periodRange, position, stamp, summarize } from '../books';


// ── Reports ────────────────────────────────────────────────────────────────
function SummaryRows({ title, rows, total, totalLabel, note }) {
  if (!rows.length) return null;
  return (
    <div className="bk-sum">
      <div className="bk-sum-h"><span>{title}</span></div>
      {note && <p className="bk-help">{note}</p>}
      {rows.map((r) => (
        <div className="bk-sum-row" key={r.id || r.name}>
          <span className="n">{r.name}{r.entries != null && <i>{r.entries} {r.entries === 1 ? 'entry' : 'entries'}</i>}</span>
          <span className="a">{fmtUSDCents(r.amount)}</span>
        </div>
      ))}
      {totalLabel && <div className="bk-sum-row total"><span className="n">{totalLabel}</span><span className="a">{fmtUSDCents(total)}</span></div>}
    </div>
  );
}

// Where the books stand on the last day of the period: read from the ledger.
function Standing({ pos, asOf }) {
  if (!pos || pos.empty) return null;
  const rows = (list) => list.map((r) => ({ ...r, entries: null }));
  return (
    <div data-testid="book-position" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="mr-head"><h3>Where things stand</h3><span>{asOf ? 'On ' + longDay(asOf) : 'Today'}</span></div>
      <SummaryRows title="What these books hold" rows={rows(pos.hold)} total={pos.totalHold} totalLabel="Total held" />
      <SummaryRows title="What is owed" rows={rows(pos.owe)} total={pos.totalOwe} totalLabel="Total owed" />
      <SummaryRows title="Held for others" note="Other people’s money these books are holding. It is owed back to them." rows={rows(pos.held)} total={pos.totalHeld} totalLabel="Total held for others" />
      <SummaryRows title="What is left for the owners" note="What the books hold, less what is owed and what is held for others." rows={rows(pos.owners)} total={pos.left} totalLabel="Left for the owners" />
      {pos.inTransit !== 0 && <p className="mr-note stuck"><span>{fmtUSDCents(Math.abs(pos.inTransit))} is sitting in a transfer category. One side of a transfer may not be entered yet.</span></p>}
      {!pos.balanced && <p className="mr-note stuck"><span>These figures do not tie out. Tell Dara: the ledger needs a look before this report is relied on.</span></p>}
    </div>
  );
}

function BookSummary({ book }) {
  const [period, setPeriod] = useState('year');
  const [sum, setSum] = useState(null);
  const [pos, setPos] = useState(null);
  const range = useMemo(() => periodRange(period, todayNY()), [period]);
  const asOf = range.to && range.to < todayNY() ? range.to : null;
  useEffect(() => {
    let live = true;
    supabase.rpc('book_position', { p_book: book.id, p_as_of: asOf }).then(({ data, error }) => { if (live) setPos(error ? null : position((data && data.lines) || [])); });
    return () => { live = false; };
  }, [book.id, asOf]);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('book_summary', { p_book: book.id, p_from: range.from, p_to: range.to });
      if (!live) return;
      if (error) { notifyError('The report did not load: ' + error.message); setSum(summarize([])); return; }
      setSum(summarize((data && data.lines) || []));
    })();
    return () => { live = false; };
  }, [book.id, range.from, range.to]);

  const u = sum ? sum.uncategorized : null;
  return (
    <div className="mr" data-testid="book-summary">
      <div className="mr-chips" role="group" aria-label="Period">
        {PERIODS.map(([id, label]) => <button type="button" key={id} className={period === id ? 'on' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}
      </div>
      <p className="bk-help">{range.from ? `${longDay(range.from)} to ${longDay(range.to)}` : 'Everything in these books'} · cash basis: money counts on the day it moved.</p>
      {!sum ? <div className="mr-empty">Adding it up.</div> : sum.empty ? <div className="mr-empty">Nothing was entered for this period.</div> : (
        <>
          <div className="bk-net">
            <div><span>Came in</span><b>{fmtUSDCents(sum.totalIncome + u.money_in)}</b></div>
            <div><span>Went out</span><b>{fmtUSDCents(sum.totalExpense + u.money_out)}</b></div>
            <div className="net"><span>Left over</span><b>{fmtUSDCents(sum.net)}</b></div>
          </div>
          {u.entries > 0 && (
            <p className="mr-note stuck"><span>{u.entries} {u.entries === 1 ? 'entry has' : 'entries have'} no category yet ({fmtUSDCents(u.money_in)} in, {fmtUSDCents(u.money_out)} out). They are counted above; sort them on the Add tab so the lists below are complete.</span></p>
          )}
          <SummaryRows title="Money in" rows={sum.income} total={sum.totalIncome} totalLabel="Total in, by category" />
          <SummaryRows title="Money out" rows={sum.expense} total={sum.totalExpense} totalLabel="Total out, by category" />
          <SummaryRows title="Held for others" note="Not income and not spending. This is other people’s money passing through."
            rows={sum.held.map((r) => ({ ...r, amount: r.money_in - r.money_out }))} total={sum.heldNow} totalLabel="Still held from this period" />
          <SummaryRows title="Neither in nor out" note="Transfers between accounts, draws and tax payments. Left out of the totals above."
            rows={sum.other.map((r) => ({ ...r, amount: r.money_in - r.money_out }))} />
        </>
      )}
      <Standing pos={pos} asOf={asOf} />
    </div>
  );
}

// ── Setup ──────────────────────────────────────────────────────────────────
function CategoryRow({ cat, canWrite, onSave, onRemove }) {
  const [edit, setEdit] = useState(null);       // { name, kind } while open
  if (!edit) {
    return (
      <div className="bk-row">
        <span className="n">{cat.name}{cat.description ? <i>{cat.description}</i> : null}</span>
        {canWrite && <button type="button" className="bk-link" onClick={() => setEdit({ name: cat.name, kind: cat.kind })}>Change</button>}
      </div>
    );
  }
  return (
    <form className="mr-card" onSubmit={async (e) => { e.preventDefault(); if (await onSave(cat, edit)) setEdit(null); }}>
      <label className="mr-f">Name<input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      <label className="mr-f">Kind of money
        <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{CATEGORY_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </label>
      <div className="mr-go">
        <button type="submit" className="save">Save</button>
        <button type="button" className="clear" onClick={() => setEdit(null)}>Cancel</button>
        <button type="button" className="clear" onClick={() => onRemove(cat)}>Stop using</button>
      </div>
    </form>
  );
}

function AccountRow({ acct, canAccounts, onSave, onRetire }) {
  const [edit, setEdit] = useState(null);       // { kind, start } while open
  const kindWord = (ACCOUNT_KINDS.find(([id]) => id === acct.kind) || [])[1] || acct.kind;
  if (!edit) {
    return (
      <div className="bk-row">
        <span className="n">{acct.account}<i>{kindWord} · {fmtUSDCents(acct.balance)} now · started at {fmtUSDCents(acct.starting_balance)}</i></span>
        {canAccounts && <button type="button" className="bk-link" onClick={() => setEdit({ kind: acct.kind, start: Number(acct.starting_balance).toFixed(2) })}>Change</button>}
      </div>
    );
  }
  return (
    <form className="mr-card" onSubmit={async (e) => { e.preventDefault(); if (await onSave(acct.account, edit)) setEdit(null); }}>
      <div className="bk-eye">{acct.account}</div>
      <label className="mr-f">Kind of account
        <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{ACCOUNT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </label>
      <label className="mr-f">{edit.kind === 'card' ? 'What was owed on it before its first entry here, as a minus (for example -350.00)' : 'What it held before its first entry here'}
        <input type="text" inputMode="decimal" autoComplete="off" className="amt" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} />
      </label>
      <div className="mr-go"><button type="submit" className="save">Save</button><button type="button" className="clear" onClick={() => setEdit(null)}>Cancel</button>
        <button type="button" className="clear" onClick={() => onRetire(acct)}>Stop using</button></div>
    </form>
  );
}

function BookSetup({ book, userId, taxCategories, setTaxCategories, onBookChanged }) {
  const canWrite = can(book, 'write'), canAccounts = can(book, 'accounts'), canClose = can(book, 'close');
  const [accounts, setAccounts] = useState([]);
  const [newCat, setNewCat] = useState({ name: '', kind: 'expense' });
  const [newAcct, setNewAcct] = useState({ name: '', kind: 'bank', start: '' });
  const [closeDate, setCloseDate] = useState(book.closed_through || '');

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase.rpc('book_account_balances', { p_book: book.id });
    if (error) { notifyError('The accounts did not load: ' + error.message); return; }
    setAccounts(data || []);
  }, [book.id]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  async function addCategory(e) {
    e.preventDefault();
    const name = newCat.name.trim();
    if (!name) { notifyError('Give the category a name'); return; }
    if (taxCategories.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) { notifyError('These books already have a category with that name'); return; }
    const sort = taxCategories.reduce((m, c) => Math.max(m, c.kind === newCat.kind ? Number(c.sort_order) || 0 : 0), 0) + 1;
    const { data, error } = await supabase.from('tax_categories').insert({ ...stamp(book, userId), name, kind: newCat.kind, schedule_c_line: '—', sort_order: sort }).select().single();
    if (error) { notifyError('That did not save: ' + error.message); return; }
    setTaxCategories((prev) => [...prev, data].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)));
    setNewCat({ name: '', kind: newCat.kind }); notify(`Added: ${data.name}`, 'success');
  }
  async function saveCategory(cat, edit) {
    const name = edit.name.trim();
    if (!name) { notifyError('Give the category a name'); return false; }
    const { data, error } = await supabase.from('tax_categories').update({ name, kind: edit.kind }).eq('id', cat.id).select().single();
    if (error) { notifyError('That did not save: ' + error.message); return false; }
    setTaxCategories((prev) => prev.map((c) => (c.id === cat.id ? data : c)));
    return true;
  }
  async function removeCategory(cat) {
    if (!await confirmDialog(`Stop using "${cat.name}"? Entries already filed under it keep it; it just stops being offered.`, { confirmLabel: 'Stop using' })) return;
    const { error } = await supabase.from('tax_categories').update({ is_archived: true }).eq('id', cat.id);
    if (error) { notifyError('That did not save: ' + error.message); return; }
    setTaxCategories((prev) => prev.filter((c) => c.id !== cat.id));
  }
  async function saveAccount(name, edit) {
    const text = String(edit.start || '0').replace(/[$,\s]/g, '');
    if (!/^-?\d+(\.\d{0,2})?$/.test(text)) { notifyError('Enter the starting balance as a number, for example 2500.00'); return false; }
    const { error } = await supabase.rpc('set_book_account', { p_book: book.id, p_account: name, p_amount: Number(text), p_kind: edit.kind });
    if (error) { notifyError('That did not save: ' + error.message); return false; }
    await loadAccounts(); return true;
  }
  // An account with entries is never deleted. Retired, it drops off the list once it holds nothing.
  async function retireAccount(acct) {
    if (!await confirmDialog(`Stop using "${acct.account}"? Its entries and history stay. ${Number(acct.balance) !== 0 ? 'It still holds ' + fmtUSDCents(acct.balance) + ', so it stays on the list until that is moved out with a transfer.' : 'It comes back if an entry names it again.'}`, { confirmLabel: 'Stop using' })) return;
    const { error } = await supabase.rpc('retire_book_account', { p_book: book.id, p_account: acct.account, p_retire: true });
    if (error) { notifyError(error.message); return; }
    await loadAccounts();
  }
  async function addAccount(e) {
    e.preventDefault();
    if (!newAcct.name.trim()) { notifyError('Give the account a name, for example Operating Checking'); return; }
    if (await saveAccount(newAcct.name.trim(), newAcct)) { setNewAcct({ name: '', kind: 'bank', start: '' }); notify('Account saved', 'success'); }
  }
  async function setClosed(date) {
    if (date && !await confirmDialog(`Close these books through ${longDay(date)}? Entries dated on or before that day can no longer be added or changed until an owner or admin reopens them.`, { confirmLabel: 'Close the books' })) return;
    const { error } = await supabase.rpc('book_set_closed_through', { p_book: book.id, p_date: date || null });
    if (error) { notifyError(error.message); return; }
    notify(date ? `Closed through ${longDay(date)}.` : 'The books are open again.', 'success');
    if (onBookChanged) onBookChanged();
  }

  return (
    <div className="mr" data-testid="book-setup">
      <div className="mr-head"><h3>Categories</h3><span>{taxCategories.length} in use</span></div>
      <div className="bk-list">
        {CATEGORY_KINDS.map(([kind, label]) => {
          const rows = taxCategories.filter((c) => c.kind === kind);
          if (!rows.length) return null;
          return (
            <React.Fragment key={kind}>
              <div className="bk-list-h">{label}</div>
              {rows.map((c) => <CategoryRow key={c.id} cat={c} canWrite={canWrite} onSave={saveCategory} onRemove={removeCategory} />)}
            </React.Fragment>
          );
        })}
      </div>
      {canWrite && (
        <form className="mr-card" onSubmit={addCategory}>
          <div className="bk-eye">Add a category</div>
          <label className="mr-f">Name<input type="text" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Pest control" /></label>
          <label className="mr-f">Kind of money
            <select value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value })}>{CATEGORY_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          </label>
          <div className="mr-go"><button type="submit" className="save">Add category</button></div>
        </form>
      )}

      <div className="mr-head"><h3>Accounts</h3><span>{accounts.length || 'None yet'}</span></div>
      {accounts.length === 0 && <p className="bk-help">An account opens the first time an entry names it. Name one now to give it a starting balance.</p>}
      <div className="bk-list">
        {accounts.map((a) => <AccountRow key={a.account} acct={a} canAccounts={canAccounts} onSave={saveAccount} onRetire={retireAccount} />)}
      </div>
      {canAccounts ? (
        <form className="mr-card" onSubmit={addAccount}>
          <div className="bk-eye">Add an account</div>
          <label className="mr-f">Name<input type="text" value={newAcct.name} onChange={(e) => setNewAcct({ ...newAcct, name: e.target.value })} placeholder="Operating Checking" /></label>
          <div className="mr-two">
            <label className="mr-f">Kind
              <select value={newAcct.kind} onChange={(e) => setNewAcct({ ...newAcct, kind: e.target.value })}>{ACCOUNT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </label>
            <label className="mr-f">Starting balance
              <input type="text" inputMode="decimal" autoComplete="off" className="amt" value={newAcct.start} onChange={(e) => setNewAcct({ ...newAcct, start: e.target.value })} placeholder="0.00" />
            </label>
          </div>
          <div className="mr-go"><button type="submit" className="save">Save account</button></div>
        </form>
      ) : <p className="bk-help">Only an owner or admin can change account settings.</p>}

      <div className="mr-head"><h3>Closing</h3><span>{book.closed_through ? 'Closed through ' + longDay(book.closed_through) : 'Open'}</span></div>
      <p className="bk-help">Closing protects a finished month: entries dated on or before the closing day cannot be added or changed until the books are reopened. {book.starts_on ? `These books begin ${longDay(book.starts_on)}.` : ''}</p>
      {canClose ? (
        <form className="mr-card" onSubmit={(e) => { e.preventDefault(); if (!closeDate) { notifyError('Choose the last day to close'); return; } setClosed(closeDate); }}>
          <label className="mr-f">Close through
            <input type="date" value={closeDate} max={todayNY()} onChange={(e) => setCloseDate(e.target.value)} />
          </label>
          <div className="mr-go">
            <button type="submit" className="save">Close the books</button>
            {book.closed_through && <button type="button" className="clear" onClick={() => setClosed(null)}>Reopen everything</button>}
          </div>
        </form>
      ) : <p className="bk-help">Only an owner or admin can close or reopen the books.</p>}
    </div>
  );
}

// ── The room ───────────────────────────────────────────────────────────────
const noop = () => {};

export default function BookRoom({ userId, book, onReload }) {
  const [tab, setTab] = useState('ledger');
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [taxCategories, setTaxCategories] = useState([]);
  const [personalBudget, setPersonalBudget] = useState([]);
  const [names, setNames] = useState({});
  const personal = book.kind === 'personal';
  const bookId = book.id, ownerId = book.owner_user_id || null, title0 = bookTitle(book);

  // Switched off since the list was read: say so plainly and step back to their own books.
  const denied = useCallback(() => { notifyError(`You no longer have access to ${title0}.`); if (onReload) onReload(); }, [title0, onReload]);

  const load = useCallback(async () => {
    setLoading(true);
    const [tx, tc, pb, nm] = await Promise.all([
      supabase.from('transactions').select('*').eq('book_id', bookId).eq('is_archived', false).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      supabase.from('tax_categories').select('*').eq('book_id', bookId).eq('is_archived', false).order('sort_order'),
      personal && ownerId ? supabase.from('personal_budget_lines').select('*').eq('user_id', ownerId).eq('is_archived', false).order('sort_order') : Promise.resolve({ data: [] }),
      supabase.rpc('book_names', { p_book: bookId }),
    ]);
    if (isDenied(nm.error) || isDenied(tx.error)) { denied(); return; }
    if (tx.error) notifyError('These books did not load: ' + tx.error.message);
    setTransactions(tx.data || []);
    setTaxCategories(tc.data || []);
    setPersonalBudget(pb.data || []);
    setNames(nm.data || {});
    setLoading(false);
  }, [bookId, ownerId, personal, denied]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  const readOnly = !can(book, 'write');
  const tabs = [['ledger', readOnly ? 'Register' : 'Add'], ['reports', 'Reports'], ['setup', 'Setup']];
  const title = tab === 'ledger' ? 'Transactions' : tab === 'reports' ? 'Reports' : 'Setup';

  return (
    <>
      <div className="view-header" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '14px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
          <Icon name="finance" size={22} style={{ color: 'var(--accent)' }} /> {title}
        </h2>
        <div className="seg-track" role="tablist" aria-label="Section of these books">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`seg-btn${tab === id ? ' active' : ''}`} aria-selected={tab === id}><span>{label}</span></button>
          ))}
        </div>
      </div>
      {readOnly && <p className="mr-note stuck"><span>You can look and export here. Your seat on these books is read-only.</span></p>}
      {tab === 'ledger' && (
        <FinanceLedger
          userId={userId} book={book} own={false} names={names} onDenied={denied}
          transactions={transactions} setTransactions={setTransactions}
          taxCategories={taxCategories} systems={[]} personalBudget={personalBudget}
          recurringTemplates={[]} setRecurringTemplates={noop}
          trackPersonal={personal && !!book.track_personal} readOnly={readOnly}
        />
      )}
      {tab === 'reports' && <BookSummary book={book} />}
      {tab === 'setup' && <BookSetup book={book} userId={userId} taxCategories={taxCategories} setTaxCategories={setTaxCategories} onBookChanged={onReload} />}
    </>
  );
}
