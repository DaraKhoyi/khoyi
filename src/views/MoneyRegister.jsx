// MoneyRegister — what Money opens on: a check register.
//
// Dara, 5 Oct 2026: "My goal is to make this screen welcoming, instead of
// cluttered so agents will want to come and enter their expenses and income."
// Top: one calm entry form. Below: the journal, newest first, ruled like a
// paper register, with a search and a balance for each account.
// The thinking (matching, search, balances, the sticky date) is in
// ../moneyRegister.js; this file only draws it.
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { bookTitle, can, duplicateSentence, inBook, isDenied, stamp } from '../books';
import { accountKey, amountFor, fillFrom, groupByMonth, isTransfer, longDate, matchesSearch, parseAmount, payeeMatches, readStickyDate, runningBalances, shortDate, sortNewest, touches, writeStickyDate } from '../moneyRegister';
import { findContactId } from './EntryTags';

const PAGE = 500;      // how many entries the database hands over at a time
const SHOW = 60;       // how many the register draws before "Show older entries"
const BLANK = { amount: '', payee: '', taxCategoryId: '', personalBudgetLineId: '', description: '', systemId: '' };

function EntryCard({ userId, book, onDenied, transactions, taxCategories, systems, personalBudget, trackPersonal, accounts, onSaved }) {
  const today = todayNY();
  const overhead = systems.find((s) => s.is_overhead);
  const [date, setDate] = useState(() => readStickyDate(today));
  const [direction, setDirection] = useState('out');
  const [scope, setScope] = useState('business');
  const [account, setAccount] = useState('');
  const [toAccount, setToAccount] = useState('');   // a transfer's other account
  const [f, setF] = useState(BLANK);
  const [filled, setFilled] = useState(null);       // { from: past entry, before: the form as it was }
  const [offer, setOffer] = useState(false);        // is the list of past payees open
  const [saving, setSaving] = useState(false);
  const payeeRef = useRef(null);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const changeDate = (d) => { if (!d) return; setDate(d); writeStickyDate(today, d); };
  const matches = useMemo(() => (offer ? payeeMatches(transactions, f.payee) : []), [offer, transactions, f.payee]);
  const takeMatch = (m) => {
    const v = fillFrom(m.last);
    setFilled({ from: m.last, before: { f, direction, scope, account, toAccount } });
    setDirection(v.direction); setScope(trackPersonal ? v.scope : 'business'); setAccount(v.account); setToAccount(v.transferAccount);
    setF({ amount: v.amount, payee: v.payee, taxCategoryId: v.taxCategoryId, personalBudgetLineId: v.personalBudgetLineId, description: v.description, systemId: v.systemId });
    setOffer(false);
  };
  const undoFill = () => { const b = filled.before; setF(b.f); setDirection(b.direction); setScope(b.scope); setAccount(b.account); setToAccount(b.toAccount); setFilled(null); };
  const clear = () => { setF(BLANK); setFilled(null); setOffer(false); };

  async function save(e) {
    e.preventDefault();
    const amt = parseAmount(f.amount);
    if (amt == null) { notifyError('Enter the amount, for example 89.00'); return; }
    const moving = direction === 'transfer';
    if (moving && (!account.trim() || !toAccount.trim())) { notifyError('A transfer needs both accounts: where the money left, and where it went'); return; }
    if (moving && accountKey(account) === accountKey(toAccount)) { notifyError('A transfer needs two different accounts'); return; }
    setSaving(true);
    const business = scope === 'business' || moving;
    const row = {
      ...stamp(book, userId), date, amount: direction === 'in' ? amt : -amt, scope: moving ? 'business' : scope,
      tax_category_id: business && !moving ? (f.taxCategoryId || null) : null,
      lead_gen_system_id: business && !moving ? (f.systemId || overhead?.id || null) : null,
      personal_budget_line_id: business ? null : (f.personalBudgetLineId || null),
      payee: f.payee.trim() || null, description: f.description.trim() || null, account: account.trim() || null,
      transfer_account: moving ? toAccount.trim() : null,
      contact_id: moving ? null : await findContactId(f.payee),      // the payee is a contact already: link it, no second address book
      entered_via: 'manual',
    };
    // "Did I already enter this?" Asked of the whole book, not just the entries on
    // this phone: the same amount within three days, the same payee or none.
    // If the question itself fails, the entry is still saved: never block the work.
    if (book) {
      const dup = await supabase.rpc('book_possible_duplicates', { p_book: book.id, p_date: date, p_amount: row.amount, p_payee: row.payee });
      if (!dup.error && (dup.data || []).length) {
        const ok = await confirmDialog(`This looks like an entry already in these books: ${duplicateSentence(dup.data[0], fmtUSDCents)}. Save it again?`, { confirmLabel: 'Save it again', cancelLabel: 'Do not save' });
        if (!ok) { setSaving(false); return; }
      }
    }
    const { data, error } = await supabase.from('transactions').insert(row).select().single();
    setSaving(false);
    if (error) {
      if (isDenied(error) && onDenied) { onDenied(); return; }      // switched off since this screen opened
      notifyError('That did not save: ' + error.message); return;
    }
    onSaved(data);
    notify(`Saved${book && !book.is_mine ? ' to ' + bookTitle(book) : ''}: ${data.payee || 'entry'}, ${fmtUSDCents(Math.abs(Number(data.amount)))}`, 'success');
    clear();                                    // the date, the account and money in/out stay for the next one
    if (payeeRef.current) payeeRef.current.focus();
  }

  const cats = scope === 'business' ? taxCategories : (personalBudget || []);
  const catValue = scope === 'business' ? f.taxCategoryId : f.personalBudgetLineId;
  const setCat = (v) => set(scope === 'business' ? { taxCategoryId: v } : { personalBudgetLineId: v });
  const leadSources = systems.filter((s) => !s.is_overhead);
  const proposed = filled && f.amount === fillFrom(filled.from).amount;

  return (
    <form className="mr-card" onSubmit={save} data-testid="money-entry">
      <div className="mr-dir three" role="group" aria-label="Money out, money in, or a transfer between accounts">
        <button type="button" className={direction === 'out' ? 'on' : ''} aria-pressed={direction === 'out'} onClick={() => setDirection('out')}>Money out</button>
        <button type="button" className={direction === 'in' ? 'on' : ''} aria-pressed={direction === 'in'} onClick={() => setDirection('in')}>Money in</button>
        <button type="button" className={direction === 'transfer' ? 'on' : ''} aria-pressed={direction === 'transfer'} onClick={() => setDirection('transfer')} data-testid="money-transfer">Transfer</button>
      </div>
      {filled && (
        <div className="mr-filled">
          <span>Filled from your {shortDate(filled.from.date)} entry. Check the amount.</span>
          <button type="button" onClick={undoFill}>Undo</button>
        </div>
      )}
      <div className="mr-two">
        <label className="mr-f">Date
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} required data-testid="money-date" />
        </label>
        <label className={'mr-f' + (proposed ? ' gold' : '')}>{proposed ? 'Amount: same as last time?' : 'Amount'}
          <input type="text" inputMode="decimal" autoComplete="off" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" className={'amt' + (proposed ? ' gold' : '')} data-testid="money-amount" />
        </label>
      </div>
      {date === today
        ? <div className="mr-note">Today. Change the date and it stays there until you change it back.</div>
        : <div className="mr-note stuck"><span>Entering for {longDate(date)}.</span><button type="button" onClick={() => changeDate(today)}>Back to today</button></div>}
      {direction === 'transfer' ? (<>
        <div className="mr-note">Money moved between two of these books' own accounts, or a card payment. It is never counted as income or spending.</div>
        <div className="mr-two">
          <label className="mr-f">From account
            <input type="text" list="mr-accounts" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Checking" data-testid="money-account" />
          </label>
          <label className="mr-f">To account
            <input type="text" list="mr-accounts" autoComplete="off" value={toAccount} onChange={(e) => setToAccount(e.target.value)} placeholder="Biz Visa" data-testid="money-to-account" />
          </label>
        </div>
        <datalist id="mr-accounts">{accounts.map((a) => <option key={a.account} value={a.account} />)}</datalist>
        <label className="mr-f">Description
          <input type="text" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What it was for" />
        </label>
      </>) : (<>
      <label className="mr-f">{direction === 'in' ? 'Received from' : 'Payee'}
        <input ref={payeeRef} type="text" autoComplete="off" value={f.payee} data-testid="money-payee"
          onChange={(e) => { set({ payee: e.target.value }); setOffer(true); }} placeholder={direction === 'in' ? 'Who paid you' : 'Who you paid'} />
      </label>
      {matches.length > 0 && (
        <div className="mr-offer" data-testid="money-matches">
          <div className="mr-offer-h">From your past entries</div>
          {matches.map((m) => {
            const c = m.last.scope === 'personal' ? (personalBudget || []).find((p) => p.id === m.last.personal_budget_line_id)?.category : taxCategories.find((x) => x.id === m.last.tax_category_id)?.name;
            return (
              <button type="button" key={m.payee} onClick={() => takeMatch(m)}>
                <span className="who"><b>{m.payee}</b><i>{c ? c + ' · ' : ''}last on {shortDate(m.last.date)}</i></span>
                <span className="use">Use</span>
              </button>
            );
          })}
          <button type="button" className="plain" onClick={() => setOffer(false)}>Keep typing a new payee</button>
        </div>
      )}
      <label className="mr-f">Category
        <select value={catValue} onChange={(e) => setCat(e.target.value)} data-testid="money-category">
          <option value="">Choose a category</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name || c.category}</option>)}
        </select>
      </label>
      <label className="mr-f">Description
        <input type="text" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What it was for" />
      </label>
      <div className="mr-two">
        <label className="mr-f">Account
          <input type="text" list="mr-accounts" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Biz Visa" data-testid="money-account" />
          <datalist id="mr-accounts">{accounts.map((a) => <option key={a.account} value={a.account} />)}</datalist>
        </label>
        {trackPersonal ? (
          <label className="mr-f">Business or personal
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
            </select>
          </label>
        ) : leadSources.length > 0 && (
          <label className="mr-f">Lead source (optional)
            <select value={f.systemId && f.systemId !== overhead?.id ? f.systemId : ''} onChange={(e) => set({ systemId: e.target.value })} data-testid="money-lead">
              <option value="">None</option>
              {leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {trackPersonal && scope === 'business' && leadSources.length > 0 && (
        <label className="mr-f">Lead source (optional)
          <select value={f.systemId && f.systemId !== overhead?.id ? f.systemId : ''} onChange={(e) => set({ systemId: e.target.value })} data-testid="money-lead">
            <option value="">None</option>
            {leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      </>)}
      <div className="mr-go">
        <button type="submit" className="save" disabled={saving} data-testid="money-save">{saving ? 'Saving…' : 'Save and add another'}</button>
        <button type="button" className="clear" onClick={clear}>Clear</button>
      </div>
    </form>
  );
}

export function MoneyRegister({ userId, book = null, own = true, names: who = null, onDenied = null, transactions, setTransactions, taxCategories, systems, personalBudget, trackPersonal, readOnly, recurringCount = 0, uncategorizedCount = 0, onEdit, onSnap, onImport, onRecurring, onCategorize }) {
  const [accounts, setAccounts] = useState([]);
  const [picked, setPicked] = useState('');          // the account whose register is open, by key
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('all');
  const [shown, setShown] = useState(SHOW);
  const [more, setMore] = useState(transactions.length >= PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [startText, setStartText] = useState(null);  // the starting balance being typed, or null when closed

  // One book's balances. Without a book list (an older database), the person's own.
  const bookId = book ? book.id : null;
  const loadBalances = useCallback(async () => {
    const { data, error } = bookId ? await supabase.rpc('book_account_balances', { p_book: bookId }) : await supabase.rpc('my_account_balances');
    if (error) { if (!isDenied(error)) notifyError('Account balances did not load: ' + error.message); return; }
    setAccounts(data || []);
  }, [bookId]);
  // Re-add whenever the book changes: a new, edited, imported or removed entry.
  const bookMark = useMemo(() => transactions.map((t) => `${t.id}|${t.amount}|${t.account || ''}|${t.is_archived ? 1 : 0}`).join(','), [transactions]);
  useEffect(() => { loadBalances(); }, [loadBalances, bookMark]);

  const names = useCallback((t) => ({
    category: taxCategories.find((c) => c.id === t.tax_category_id)?.name,
    system: (() => { const s = systems.find((x) => x.id === t.lead_gen_system_id); return s && !s.is_overhead ? s.name : ''; })(),
    personal: (personalBudget || []).find((p) => p.id === t.personal_budget_line_id)?.category,
  }), [taxCategories, systems, personalBudget]);

  const year = todayNY().slice(0, 4);
  const account = accounts.find((a) => accountKey(a.account) === picked) || null;
  const rows = useMemo(() => {
    let r = sortNewest(transactions.filter((t) => !t.is_archived));
    if (account) r = r.filter((t) => touches(t, picked));
    else if (!trackPersonal) r = r.filter((t) => t.scope === 'business');
    if (chip === 'out') r = r.filter((t) => amountFor(t, picked) < 0 && (account || !isTransfer(t)));
    else if (chip === 'in') r = r.filter((t) => amountFor(t, picked) > 0 && (account || !isTransfer(t)));
    else if (chip === 'year') r = r.filter((t) => String(t.date || '').startsWith(year));
    else if (chip === 'business' || chip === 'personal') r = r.filter((t) => t.scope === chip);
    if (search.trim()) r = r.filter((t) => matchesSearch(t, search, names(t)));
    return r;
  }, [transactions, account, picked, trackPersonal, chip, search, names, year]);
  // A balance after each line only makes sense on one account's whole register.
  const balances = useMemo(() => (account && chip === 'all' && !search.trim() ? runningBalances(rows, account.balance, (t) => amountFor(t, picked)) : null), [account, chip, search, rows, picked]);
  // With every account on screen a transfer is neither in nor out; in one account's register it is.
  const counted = account ? rows : rows.filter((t) => !isTransfer(t));
  const totalIn = counted.reduce((s, t) => s + Math.max(amountFor(t, picked), 0), 0);
  const totalOut = counted.reduce((s, t) => s + Math.max(-amountFor(t, picked), 0), 0);
  const groups = groupByMonth(rows.slice(0, shown));

  async function loadOlder(all) {
    setLoadingOlder(true);
    let have = transactions, got = 0, again = true;
    for (let i = 0; again && i < (all ? 20 : 1); i++) {
      const oldest = have.reduce((m, t) => (t.date && (!m || t.date < m) ? t.date : m), '');
      const { data, error } = await inBook(supabase.from('transactions').select('*'), book, userId).eq('is_archived', false)
        .lte('date', oldest || todayNY()).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(PAGE);
      if (error) { notifyError('Older entries did not load: ' + error.message); again = false; break; }
      const ids = new Set(have.map((t) => t.id)), fresh = (data || []).filter((t) => !ids.has(t.id));
      have = [...have, ...fresh]; got += fresh.length;
      again = (data || []).length === PAGE && fresh.length > 0;
    }
    if (got) setTransactions(have);
    setMore(again); setLoadingOlder(false);
    return got;
  }
  const showOlder = async () => { if (shown < rows.length) { setShown((n) => n + SHOW); return; } if (more) { await loadOlder(false); setShown((n) => n + SHOW); } };

  async function saveStart(e) {
    e.preventDefault();
    const text = String(startText).replace(/[$,\s]/g, '');
    if (!/^-?\d+(\.\d{0,2})?$/.test(text)) { notifyError('Enter the starting balance as a number, for example 2500.00'); return; }
    const { error } = book ? await supabase.rpc('set_book_account', { p_book: book.id, p_account: account.account, p_amount: Number(text) })
      : await supabase.rpc('set_account_starting_balance', { p_account: account.account, p_amount: Number(text) });
    if (error) { notifyError('That did not save: ' + error.message); return; }
    setStartText(null); loadBalances();
  }

  const chips = [['all', 'All'], ['out', 'Money out'], ['in', 'Money in'], ['year', 'This year']].concat(trackPersonal && !account ? [['business', 'Business'], ['personal', 'Personal']] : []);
  const filtering = chip !== 'all' || !!search.trim();

  return (
    <div className="mr" data-testid="money-register">
      {!readOnly && (<>
        <p className="mr-lead">Enter it once, here. It takes a few seconds.</p>
        <EntryCard userId={userId} book={book} onDenied={onDenied} transactions={transactions} taxCategories={taxCategories} systems={systems} personalBudget={personalBudget}
          trackPersonal={trackPersonal} accounts={accounts} onSaved={(row) => setTransactions((prev) => [row, ...prev])} />
        <div className="mr-ways">
          {own && <button type="button" onClick={onSnap}>Snap a receipt</button>}
          <button type="button" onClick={onImport}>Import a statement</button>
          {own && <button type="button" onClick={onRecurring}>Repeating entries{recurringCount ? ` (${recurringCount})` : ''}</button>}
        </div>
      </>)}

      <div className="mr-head"><h3>Register</h3><span>Newest first</span></div>

      {accounts.length > 0 && (
        <div className="mr-accts" role="group" aria-label="Account balances" data-testid="money-accounts">
          <button type="button" className={!account ? 'on' : ''} aria-pressed={!account} onClick={() => { setPicked(''); setStartText(null); setShown(SHOW); }}><b>All accounts</b></button>
          {accounts.map((a) => (
            <button type="button" key={a.account} className={accountKey(a.account) === picked ? 'on' : ''} aria-pressed={accountKey(a.account) === picked}
              onClick={() => { setPicked(accountKey(a.account)); setStartText(null); setShown(SHOW); if (chip === 'business' || chip === 'personal') setChip('all'); }}>
              <b>{a.account}</b><span>{fmtUSDCents(a.balance)}</span>
            </button>
          ))}
        </div>
      )}
      {account && (startText == null ? (
        <div className="mr-note stuck">
          <span>{account.account} holds {fmtUSDCents(account.balance)}: a starting balance of {fmtUSDCents(account.starting_balance)} plus {account.entries} {account.entries === 1 ? 'entry' : 'entries'}.</span>
          {!readOnly && can(book, 'accounts') && <button type="button" onClick={() => setStartText(Number(account.starting_balance).toFixed(2))}>Set starting balance</button>}
        </div>
      ) : (
        <form className="mr-start" onSubmit={saveStart}>
          <label className="mr-f">What {account.account} held before its first entry here
            <input type="text" inputMode="decimal" autoComplete="off" value={startText} onChange={(e) => setStartText(e.target.value)} className="amt" />
          </label>
          <div className="mr-go"><button type="submit" className="save">Save</button><button type="button" className="clear" onClick={() => setStartText(null)}>Cancel</button></div>
        </form>
      ))}

      <input type="search" className="mr-search" value={search} onChange={(e) => { setSearch(e.target.value); setShown(SHOW); }}
        placeholder="Search payee, category, amount, month" aria-label="Search the register" data-testid="money-search" />
      <div className="mr-chips" role="group" aria-label="Show">
        {chips.map(([id, label]) => <button type="button" key={id} className={chip === id ? 'on' : ''} aria-pressed={chip === id} onClick={() => { setChip(id); setShown(SHOW); }}>{label}</button>)}
      </div>
      <div className="mr-sum">
        <span>{rows.length} {rows.length === 1 ? 'entry' : 'entries'} · {fmtUSDCents(totalIn)} in · {fmtUSDCents(totalOut)} out</span>
        {!readOnly && uncategorizedCount > 0 && <button type="button" onClick={onCategorize}>{uncategorizedCount} without a category: sort them</button>}
      </div>
      {filtering && more && (
        <div className="mr-note stuck"><span>Looking through your newest {transactions.length} entries.</span><button type="button" disabled={loadingOlder} onClick={() => loadOlder(true)}>{loadingOlder ? 'Loading…' : 'Search everything'}</button></div>
      )}

      {rows.length === 0 ? (
        <div className="mr-empty">{filtering || account ? 'Nothing in the register matches that.' : readOnly ? 'This register is empty.' : 'Your register is empty. The first entry you save above appears here.'}</div>
      ) : (
        <div className="mr-book">
          <div className="mr-cols"><span>Date</span><span>Payee and category</span><span>{balances ? 'Amount and balance' : 'Amount'}</span></div>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              <div className="mr-month">{g.label}</div>
              {g.rows.map((t) => {
                const n = names(t), moved = isTransfer(t), amt = amountFor(t, picked), income = amt > 0 && (!moved || !!account);
                const way = !moved ? '' : !account ? `${t.account} to ${t.transfer_account}` : accountKey(t.account) === picked ? `to ${t.transfer_account}` : `from ${t.account}`;
                const by = who && t.entered_by && who[t.entered_by] ? 'by ' + who[t.entered_by] : '';
                const sub = [moved ? way : t.scope === 'personal' ? (n.personal || 'Personal') : n.category, t.payee && t.description ? t.description : '', !account && !moved ? t.account : '', n.system, by].filter(Boolean).join(' · ');
                return (
                  <button type="button" key={t.id} className="mr-row" disabled={readOnly} onClick={() => onEdit(t)} data-testid="money-row">
                    <span className="d">{shortDate(t.date)}</span>
                    <span className="p"><b>{t.payee || t.description || (moved ? 'Transfer' : 'No payee')}</b><i>{sub || 'No category yet'}</i></span>
                    <span className={'a' + (income ? ' in' : '')}><b>{income ? '+' : ''}{fmtUSDCents(Math.abs(amt))}</b>{balances && <i>{fmtUSDCents(balances.get(t.id))}</i>}</span>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          {(shown < rows.length || more) && <button type="button" className="mr-older" disabled={loadingOlder} onClick={showOlder}>{loadingOlder ? 'Loading…' : 'Show older entries'}</button>}
        </div>
      )}
    </div>
  );
}
