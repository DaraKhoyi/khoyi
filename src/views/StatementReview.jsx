// StatementReview — one upload, line by line, built for a phone.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "One list per upload ... Each
// line shows date, payee, amount and the proposed category. The user can change
// category, payee, memo and tags, split a line across categories, mark it as a
// transfer, mark it personal-not-business, and attach a receipt. One tap
// approves a line. One tap approves all lines that need no attention ...
// correcting teaches, dismissing does not judge."
//
// Nothing on this screen decides what may post: every button calls a database
// function that checks the statement adds up, that a possible duplicate has
// been answered, and that a line the reader was unsure of has been looked at.
// This screen says what the database said, in plain words.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { EntryTags } from './EntryTags';
import { SplitEditor, partsFrom, splitReady, startRows } from './EntrySplit';
import { NEED_TEXT, SOURCE_TEXT, canApprove, categoryGroups, filedAs, followUp, isReady, needsOf, openOriginal, periodText, settleAll, shortDay, tieSentence, unsureText } from '../statements';

const plain = (error) => String((error && error.message) || error || 'Something went wrong');
const HOW = { manual: 'typed in by hand', csv: 'from a bank file', ofx: 'from a bank file', scan: 'from a scanned statement', photo: 'from a receipt', recurring: 'a repeating entry', ari: 'added by voice', deal_close: 'from a closing' };
const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

// ── A possible duplicate, side by side ─────────────────────────────────────
function TwinSide({ title, date, payee, amount, note }) {
  return <div><span className="bk-eye">{title}</span><b>{shortDay(date, true)} · {fmtUSDCents(Number(amount))}</b><i>{payee || 'No payee'}</i>{note && <i>{note}</i>}</div>;
}
function Twin({ line, twin }) {
  if (!twin) return <p className="st-flag">It matched something that has since left your books. Tap either answer to clear it.</p>;
  const other = twin.where === 'books'
    ? { title: 'Already in your books', date: twin.date, payee: twin.payee, amount: twin.amount, note: [twin.account || 'no account', twin.other_account ? `transfer with ${twin.other_account}` : '', twin.file ? `from ${twin.file}` : HOW[twin.how] || '', twin.parts > 1 ? `split in ${twin.parts}` : ''].filter(Boolean).join(' · ') }
    : { title: 'Waiting in another upload', date: twin.date, payee: twin.payee, amount: twin.amount, note: [twin.account, twin.file, twin.now === 'posted' ? 'now approved' : 'not yet approved'].filter(Boolean).join(' · ') };
  return (
    <div className="st-twin" data-testid="statement-twin">
      <TwinSide title="On this statement" date={line.line_date} payee={line.raw_text || line.payee} amount={line.amount} />
      <TwinSide {...other} />
    </div>
  );
}

// ── Changing one line ──────────────────────────────────────────────────────
function LineEditor({ book, line, imp, categories, accounts, onSave, onDrop, onCancel, busy }) {
  const own = book.kind === 'personal';
  const scan = imp.via === 'scan';
  const [payee, setPayee] = useState(line.payee || '');
  const [memo, setMemo] = useState(line.memo || '');
  const [kind, setKind] = useState(line.transfer_account ? 'transfer' : line.parts ? 'split' : line.is_personal ? 'personal' : 'category');
  const [category, setCategory] = useState(line.tax_category_id || '');
  const [rows, setRows] = useState(() => startRows(line.parts, line.amount));
  const [transfer, setTransfer] = useState(line.transfer_account || '');
  const [remember, setRemember] = useState(line.remember || '');
  const [tags, setTags] = useState({ contact_id: line.contact_id || null, agent_id: line.agent_id || null, closing_id: line.closing_id || null });
  const [date, setDate] = useState(line.line_date || '');
  const [out, setOut] = useState(Number(line.amount) <= 0);
  const [amount, setAmount] = useState(Number(line.amount) ? Math.abs(Number(line.amount)).toFixed(2) : '');
  const [receipt, setReceipt] = useState(line.receipt_path || null);
  const [uploading, setUploading] = useState(false);
  const others = accounts.filter((a) => a.account.trim().toLowerCase() !== String(imp.account || '').trim().toLowerCase());
  const signed = scan ? (out ? -1 : 1) * Math.abs(toNum(amount) || 0) : Number(line.amount);
  const groups = categoryGroups(categories.filter((c) => (c.kind || 'expense') !== 'transfer'));

  const attach = async (file) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { notifyError('That file is over 12 MB. A photo of the receipt is plenty.'); return; }
    setUploading(true);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${book.id}/receipts/${line.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('statements').upload(path, file, { contentType: file.type || undefined, upsert: false });
    setUploading(false);
    if (error) { notifyError('The receipt did not upload: ' + plain(error)); return; }
    setReceipt(path);
  };

  const build = () => {
    if (scan && (!date || !(Math.abs(toNum(amount)) > 0))) { notifyError('This line needs its date and its amount from the statement.'); return null; }
    if (!scan && !line.line_date && !date) { notifyError('This line needs a date.'); return null; }
    const patch = { payee: payee.trim(), memo: memo.trim(), remember: remember || null, receipt_path: receipt || null, mine: true,
      contact_id: tags.contact_id || null, agent_id: tags.agent_id || null, closing_id: tags.closing_id || null };
    if (scan) { if (date !== line.line_date) patch.date = date; if (signed !== Number(line.amount)) patch.amount = signed; }
    else if (!line.line_date && date) patch.date = date;
    if (kind === 'category') Object.assign(patch, { category: category || null, personal: false, transfer_account: null, parts: null });
    else if (kind === 'personal') Object.assign(patch, { personal: true, transfer_account: null, parts: null });
    else if (kind === 'transfer') {
      if (!transfer.trim()) { notifyError('Choose the other account this money moved to or from.'); return null; }
      Object.assign(patch, { transfer_account: transfer.trim(), personal: false, parts: null });
    } else {
      if (!splitReady(rows, signed)) { notifyError('The parts of the split must each have a category and add up to the whole amount.'); return null; }
      Object.assign(patch, { parts: partsFrom(rows, signed), personal: false, transfer_account: null });
    }
    return patch;
  };

  return (
    <div className="mr-card st-edit" data-testid="statement-line-editor">
      {line.raw_text && <p className="bk-help">The bank wrote: <b>{line.raw_text}</b></p>}
      {(line.needs || []).includes('check') && <p className="st-flag">{unsureText(line)}</p>}
      {(scan || !line.line_date) && (
        <div className="mr-two">
          <label className="mr-f">Date on the statement<input type="date" value={date} max={todayNY()} onChange={(e) => setDate(e.target.value)} /></label>
          {scan && <label className="mr-f">Amount<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        </div>
      )}
      {scan && <div className="mr-dir" role="group" aria-label="Direction"><button type="button" className={out ? 'on' : ''} onClick={() => setOut(true)}>Money out</button><button type="button" className={!out ? 'on' : ''} onClick={() => setOut(false)}>Money in</button></div>}
      <label className="mr-f">Payee<input type="text" autoComplete="off" value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
      <div className={'mr-dir' + (own ? ' four' : ' three')} role="group" aria-label="What this line is">
        <button type="button" className={kind === 'category' ? 'on' : ''} onClick={() => setKind('category')}>Category</button>
        <button type="button" className={kind === 'split' ? 'on' : ''} onClick={() => setKind('split')}>Split</button>
        <button type="button" className={kind === 'transfer' ? 'on' : ''} onClick={() => setKind('transfer')}>Transfer</button>
        {own && <button type="button" className={kind === 'personal' ? 'on' : ''} onClick={() => setKind('personal')}>Personal</button>}
      </div>
      {kind === 'category' && (
        <label className="mr-f">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="statement-line-category">
            <option value="">No category yet</option>
            {groups.map((g) => <optgroup key={g.kind} label={g.label}>{g.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
        </label>
      )}
      {kind === 'category' && !own && <p className="bk-help">Not business? These books hold business money only. File it under one of the owners&rsquo; categories.</p>}
      {kind === 'split' && <SplitEditor total={signed} categories={categories} rows={rows} onChange={setRows} />}
      {kind === 'transfer' && (
        <label className="mr-f">{signed > 0 ? 'Moved in from' : 'Moved out to'} (another account in these books)
          <input type="text" list="st-accounts" autoComplete="off" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="Company Visa" />
          <datalist id="st-accounts">{others.map((a) => <option key={a.account} value={a.account} />)}</datalist>
        </label>
      )}
      {kind === 'personal' && <p className="bk-help">Kept out of your business numbers.</p>}
      <label className="mr-f">Memo<input type="text" autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" /></label>
      <EntryTags book={book} value={tags} onChange={(v) => setTags({ contact_id: v.contact_id || null, agent_id: v.agent_id || null, closing_id: v.closing_id || null })} payee={payee} noTransfer />
      <label className="mr-f">Next time {payee.trim() || 'this payee'} appears
        <select value={remember} onChange={(e) => setRemember(e.target.value)} data-testid="statement-line-remember">
          <option value="">File it the same way, without asking</option>
          <option value="amount">The same way only when it is this amount</option>
          <option value="account">The same way only from this account</option>
          <option value="ask">Always ask me</option>
        </select>
      </label>
      <div className="st-receipt">
        {receipt ? (<><span>Receipt attached</span><button type="button" className="bk-link" onClick={() => openOriginal(receipt)}>View</button><button type="button" className="bk-link" onClick={() => setReceipt(null)}>Remove</button></>)
          : (<label className="bk-link">{uploading ? 'Uploading' : 'Attach a receipt'}<input type="file" accept="image/*,application/pdf" hidden disabled={uploading} onChange={(e) => { attach(e.target.files && e.target.files[0]); e.target.value = ''; }} /></label>)}
      </div>
      <div className="mr-go">
        <button type="button" className="save" disabled={busy} onClick={() => { const p = build(); if (p) onSave(p, true); }} data-testid="statement-line-save-approve">Save and approve</button>
        <button type="button" className="clear" disabled={busy} onClick={() => { const p = build(); if (p) onSave(p, false); }}>Save</button>
        <button type="button" className="clear" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {scan && <button type="button" className="bk-link" disabled={busy} onClick={onDrop}>This line is not on the statement. Remove it</button>}
    </div>
  );
}

// ── One line ───────────────────────────────────────────────────────────────
function Line({ line, categories, canWrite, busy, onApprove, onChange, onSkip, onUndo, onTwin, onChecked }) {
  const needs = needsOf(line);
  const what = filedAs(line, categories, { amount: line.amount });
  const waiting = !line.result;
  const name = line.payee || line.raw_text || 'No description';
  return (
    <div className={'st-line' + (waiting && needs.length ? ' needs' : '')} data-testid="statement-line">
      <div className="st-line-top">
        <span className="d">{shortDay(line.line_date) || 'No date'}</span>
        <span className="p"><b>{name}</b>{line.raw_text && line.raw_text !== name && <i>{line.raw_text}</i>}</span>
        <span className={'a' + (Number(line.amount) > 0 ? ' in' : '')}><b>{fmtUSDCents(Number(line.amount))}</b></span>
      </div>
      <div className="st-what">{what ? <b>{what}</b> : <b className="none">No category yet</b>}{what && line.proposed_by && <i> · {SOURCE_TEXT[line.proposed_by]}</i>}{line.memo ? <i> · {line.memo}</i> : null}</div>
      {waiting && needs.filter((n) => n !== 'twin' && !(n === 'new' && !what)).map((n) => <p className="st-flag" key={n}>{n === 'check' ? unsureText(line) : n === 'new' ? 'A suggestion. Approve it if it is right, or change it.' : n === 'direction' ? (Number(line.amount) > 0 ? 'Money in this time. It was money out before. A refund?' : 'Money out this time. It was money in before.') : NEED_TEXT[n]}</p>)}
      {waiting && needs.includes('twin') && (<><p className="st-flag">{NEED_TEXT.twin}. Is it the same payment?</p><Twin line={line} twin={line.twin} /></>)}
      {line.result === 'duplicate' && <p className="st-flag quiet">Set aside as the same payment as one already in your books.</p>}
      {line.result === 'skipped' && <p className="st-flag quiet">Left out of the books.</p>}
      {line.result === 'dropped' && <p className="st-flag quiet">Removed: not on the statement.</p>}
      {canWrite && (
        <div className="st-go">
          {waiting && needs.includes('twin') ? (<>
            <button type="button" className="main" disabled={busy} onClick={() => onTwin(line, true)} data-testid="statement-twin-same">Same one. Do not add it</button>
            <button type="button" disabled={busy} onClick={() => onTwin(line, false)}>Different. Keep it</button>
          </>) : waiting ? (<>
            {needs.includes('check') ? <button type="button" className="main" disabled={busy} onClick={() => onChecked(line)}>It is right</button>
              : what && canApprove(line) && <button type="button" className="main" disabled={busy} onClick={() => onApprove(line)} data-testid="statement-line-approve">Approve</button>}
            <button type="button" className={what || needs.includes('check') ? '' : 'main'} disabled={busy} onClick={() => onChange(line)} data-testid="statement-line-change">{what ? 'Change' : 'Say what it is'}</button>
            <button type="button" disabled={busy} onClick={() => onSkip(line)}>Leave out</button>
          </>) : line.result === 'posted' ? (<>
            <button type="button" disabled={busy} onClick={() => onUndo(line, false)} data-testid="statement-line-undo">Undo</button>
            <button type="button" disabled={busy} onClick={() => onUndo(line, true)}>Change</button>
          </>) : <button type="button" disabled={busy} onClick={() => onUndo(line, false)}>Bring it back</button>}
        </div>
      )}
    </div>
  );
}

// ── The upload ─────────────────────────────────────────────────────────────
export default function StatementReview({ book, importId, userId, categories, onBack, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [tab, setTab] = useState('review');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState(null);          // { opening, closing } being typed
  const [adding, setAdding] = useState(null);    // { date, amount, out, text } being typed
  const asked = useRef(false), settled = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('statement_detail', { p_import: importId });
    if (error) { notifyError('That upload did not open: ' + plain(error)); onBack(); return null; }
    setDetail(data);
    return data;
  }, [importId, onBack]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.rpc('book_account_balances', { p_book: book.id }).then(({ data }) => setAccounts(data || [])); }, [book.id]);

  const imp = detail && detail.import, tie = detail && detail.tie, lines = (detail && detail.lines) || [];
  const reading = !!imp && !imp.read_at && !imp.read_error;
  const stale = reading && imp.read_started_at && Date.now() - new Date(imp.read_started_at).getTime() > 5 * 60 * 1000;
  const canWrite = !!detail && detail.can_write, canManage = !!detail && detail.can_manage;
  const blocked = !!tie && tie.blocked;

  // While the reader is at work, look again every few seconds.
  useEffect(() => {
    if (!reading || stale) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [reading, stale, load]);

  // Rules a person has confirmed do their work as soon as the upload is opened.
  const settle = useCallback(async () => {
    const { total, error } = await settleAll(importId);
    if (error) notifyError('Some lines could not be filed for you: ' + plain(error));
    if (total > 0) { notify(`${total} ${total === 1 ? 'line was' : 'lines were'} filed for you, the way you filed ${total === 1 ? 'it' : 'them'} before`, 'success'); onChanged(); }
    return total;
  }, [importId, onChanged]);
  useEffect(() => {
    if (!imp || !imp.read_at || !canWrite || blocked || settled.current) return;
    settled.current = true;
    settle().then((n) => { if (n) load(); });
  }, [imp, canWrite, blocked, settle, load]);

  // New payees get a suggestion from the model. Asked once per upload; it only ever proposes.
  useEffect(() => {
    if (!imp || !imp.read_at || imp.suggested_at || !canWrite || asked.current) return undefined;
    if (!lines.some((l) => !l.result && !l.proposed_by)) return undefined;
    asked.current = true;
    supabase.functions.invoke('suggest-categories', { body: { import_id: importId } }).catch(() => {});
    const timers = [7000, 14000, 25000, 45000, 75000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
  }, [imp, lines, canWrite, importId, load]);

  const run = async (fn, { thenSettle = false } = {}) => {
    setBusy(true);
    try {
      const { data, error } = await fn();
      if (error) { notifyError(plain(error)); return undefined; }
      if (thenSettle) await settle();
      return data === null || data === undefined ? true : data;
    } finally { await load(); onChanged(); setBusy(false); }
  };

  const approve = async (line) => {
    const data = await run(() => supabase.rpc('statement_line_approve', { p_line: line.id }));
    if (!data) return;
    if (data.ok === false && data.twin) { notify('Something like this reached your books since the statement was read. Have a look before it goes in twice.', 'info'); return; }
    setEditing(null);
    if (await followUp(data.rule)) onChanged();
    await load();
  };
  const approveAll = async () => {
    setBusy(true);
    let posted = 0, bad = 0, twins = 0;
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.rpc('statement_approve_ready', { p_import: importId });
      if (error) { notifyError(plain(error)); break; }
      posted += data.posted || 0; bad += data.could_not || 0; twins += data.possible_duplicates || 0;
      if (!data.more) break;
    }
    await load(); onChanged(); setBusy(false);
    if (posted) notify(`${posted} ${posted === 1 ? 'line' : 'lines'} approved`, 'success');
    if (twins) notify(`${twins} ${twins === 1 ? 'line' : 'lines'} may already be in your books and ${twins === 1 ? 'is' : 'are'} waiting for your answer`, 'info');
    if (bad) notifyError(`${bad} ${bad === 1 ? 'line' : 'lines'} could not be approved. Open ${bad === 1 ? 'it' : 'each'} to see why.`);
  };
  const save = async (line, patch, thenApprove) => {
    const ok = await run(() => supabase.rpc('statement_line_set', { p_line: line.id, p_patch: patch }), { thenSettle: 'date' in patch || 'amount' in patch });
    if (!ok) return;
    if (thenApprove) await approve(line); else setEditing(null);
  };
  const skip = (line) => run(() => supabase.rpc('statement_line_skip', { p_line: line.id }));
  const undo = async (line, thenEdit) => { const ok = await run(() => supabase.rpc('statement_line_undo', { p_line: line.id })); if (ok && thenEdit) { setTab('review'); setEditing(line.id); } };
  const twin = (line, same) => run(() => supabase.rpc('statement_resolve_twin', { p_line: line.id, p_same: same }), { thenSettle: !same });
  const allTwinsSame = async () => {
    if (!await confirmDialog('Set every possible duplicate in this upload aside as already in your books? None of them will be added again.', { confirmLabel: 'They are all the same', danger: false })) return;
    const n = await run(() => supabase.rpc('statement_resolve_twin', { p_line: null, p_same: true, p_import: importId }));
    if (typeof n === 'number') notify(`${n} set aside`, 'success');
  };
  const checked = (line) => run(() => supabase.rpc('statement_line_set', { p_line: line.id, p_patch: { checked: true } }), { thenSettle: true });
  const drop = (line) => run(() => supabase.rpc('statement_line_drop', { p_line: line.id }), { thenSettle: true }).then((ok) => { if (ok) setEditing(null); });
  const accept = async () => {
    if (!await confirmDialog('Let this statement through even though it does not add up? Your name and how far off it is go into the record.', { confirmLabel: 'Let it through', cancelLabel: 'Not yet' })) return;
    await run(() => supabase.rpc('statement_accept_unproven', { p_import: importId }), { thenSettle: true });
  };
  const isCard = (accounts.find((a) => a.account.trim().toLowerCase() === String((imp && imp.account) || '').trim().toLowerCase()) || {}).kind === 'card';
  // A card's balance is typed as what was owed; the books count that as negative.
  const shown = (v) => (isCard ? -Number(v) : Number(v)).toFixed(2);
  const saveBalances = async (e) => {
    e.preventDefault();
    const o = bal.opening === '' ? null : toNum(bal.opening), c = bal.closing === '' ? null : toNum(bal.closing);
    if (Number.isNaN(o) || Number.isNaN(c)) { notifyError('Enter each balance as a number, for example 2500.00'); return; }
    const flip = (v) => (v == null ? null : isCard ? -v : v);
    const ok = await run(() => supabase.rpc('statement_set_balances', { p_import: importId, p_opening: flip(o), p_closing: flip(c) }), { thenSettle: true });
    if (ok) setBal(null);
  };
  const addLine = async (e) => {
    e.preventDefault();
    const n = Math.abs(toNum(adding.amount));
    if (!adding.date || !(n > 0)) { notifyError('The line needs its date and amount from the statement.'); return; }
    const ok = await run(() => supabase.rpc('statement_line_add', { p_import: importId, p_date: adding.date, p_amount: adding.out ? -n : n, p_text: adding.text }));
    if (ok) setAdding(null);
  };
  const readAgain = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('read-statement', { body: { import_id: importId } });
    setBusy(false);
    if (error || (data && data.error)) notifyError((data && data.error) || 'The reader could not be started. Try again in a minute.');
    await load();
  };
  const takeBack = async () => {
    const posted = lines.filter((l) => l.result === 'posted').length;
    if (!await confirmDialog(posted ? `Take back this whole upload? The ${posted} ${posted === 1 ? 'entry' : 'entries'} it put in your books will be removed. Rules you taught stay.` : 'Remove this upload? Nothing from it is in your books.', { confirmLabel: 'Take it back' })) return;
    setBusy(true);
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.rpc('statement_take_back', { p_import: importId });
      if (error) { notifyError(plain(error)); setBusy(false); await load(); onChanged(); return; }
      if (!data.more) break;
    }
    setBusy(false); onChanged(); notify('Upload taken back', 'success'); onBack();
  };

  if (!detail) return <div className="loading-screen" style={{ height: '40vh' }}><div className="spinner" /></div>;

  const waiting = lines.filter((l) => !l.result);
  const twins = waiting.filter((l) => (l.needs || []).includes('twin'));
  const look = waiting.filter((l) => !isReady(l) && !(l.needs || []).includes('twin'));
  const ready = waiting.filter(isReady);
  const auto = lines.filter((l) => l.result === 'posted' && l.auto_posted);
  const posted = lines.filter((l) => l.result === 'posted' && !l.auto_posted);
  const out = lines.filter((l) => l.result && l.result !== 'posted');
  const proof = tieSentence(tie, imp.via);
  const anyPosted = auto.length + posted.length > 0;
  const tabs = [['review', 'To review', waiting.length], ['auto', 'Done for you', auto.length], ['posted', 'Approved', posted.length], ['out', 'Left out', out.length]];
  const lineProps = { categories, canWrite, busy, onApprove: approve, onChange: (l) => setEditing(l.id), onSkip: skip, onUndo: undo, onTwin: twin, onChecked: checked };
  const draw = (l) => (editing === l.id && !l.result
    ? <LineEditor key={l.id} book={book} line={l} imp={imp} categories={categories} accounts={accounts} busy={busy}
        onSave={(patch, thenApprove) => save(l, patch, thenApprove)} onDrop={() => drop(l)} onCancel={() => setEditing(null)} />
    : <Line key={l.id} line={l} {...lineProps} />);

  return (
    <div className="st-review" data-testid="statement-review">
      <button type="button" className="bk-link" onClick={onBack}>Back to all statements</button>
      <div className="mr-head"><h3>{imp.account}</h3><span>{[imp.file_name, periodText(imp.period_from, imp.period_to)].filter(Boolean).join(' · ')}</span></div>
      <p className="bk-help">Uploaded by {imp.by} on {shortDay(String(imp.created_at).slice(0, 10), true)}.{' '}
        {(imp.file_paths || []).map((p, i) => <button type="button" className="bk-link" key={p} onClick={() => openOriginal(p)}>{(imp.file_paths || []).length > 1 ? `See page ${i + 1}` : 'See the original'}</button>)}</p>

      {reading && !stale && <div className="st-proof plain"><div className="spinner" /><span>Reading your statement. This takes a minute or two. You can leave this screen; it will be here when you come back.</span></div>}
      {(imp.read_error || stale) && (
        <div className="st-proof bad" data-testid="statement-read-error"><span>{imp.read_error || 'The reader did not finish.'}</span>
          {canWrite && <div className="st-go"><button type="button" className="main" disabled={busy} onClick={readAgain}>Read it again</button><button type="button" disabled={busy} onClick={takeBack}>Remove this upload</button></div>}</div>
      )}

      {imp.read_at && (<>
        <div className={'st-proof ' + proof.tone} data-testid="statement-proof">
          <span>{blocked && anyPosted ? proof.text.replace('Nothing from this statement is in the books yet.', 'Nothing more from it can go in until this is settled.') : proof.text}</span>
          {tie.added_waiting > 0 && <span>A line was added by hand. Approve that line first; then the rest can go in.</span>}
          {canWrite && bal === null && (!tie.proven || blocked) && (
            <div className="st-go">
              <button type="button" className={blocked ? 'main' : ''} onClick={() => setBal({ opening: tie.opening == null ? '' : shown(tie.opening), closing: tie.closing == null ? '' : shown(tie.closing) })}>{tie.has_balances ? 'Fix the balances' : 'Add the balances'}</button>
              {blocked && canManage && <button type="button" onClick={accept} disabled={busy}>Let it through as it is</button>}
            </div>
          )}
          {blocked && imp.via === 'scan' && <span>If a line was misread, tap Change on it and correct it from the page. If a line is missing, add it below.</span>}
          {blocked && !canManage && <span>An owner or admin of these books can let it through as it is.</span>}
        </div>
        {bal !== null && (
          <form className="mr-card" onSubmit={saveBalances} data-testid="statement-balances">
            <div className="mr-two">
              <label className="mr-f">{isCard ? 'Owed at the start' : 'Balance at the start'}<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={bal.opening} onChange={(e) => setBal({ ...bal, opening: e.target.value })} placeholder="0.00" /></label>
              <label className="mr-f">{isCard ? 'Owed at the end' : 'Balance at the end'}<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={bal.closing} onChange={(e) => setBal({ ...bal, closing: e.target.value })} placeholder="0.00" /></label>
            </div>
            <p className="bk-help">Copy both from the statement itself.{isCard ? ' For a card, type what was owed.' : ''}</p>
            <div className="mr-go"><button type="submit" className="save" disabled={busy}>Save</button><button type="button" className="clear" onClick={() => setBal(null)}>Cancel</button></div>
          </form>
        )}

        <div className="mr-chips" role="tablist" aria-label="Lines">
          {tabs.map(([id, label, n]) => <button type="button" key={id} className={tab === id ? 'on' : ''} aria-selected={tab === id} onClick={() => { setTab(id); setEditing(null); }} data-testid={'statement-tab-' + id}>{label} {n}</button>)}
        </div>

        {tab === 'review' && (<>
          {waiting.length === 0 && <div className="mr-empty">Nothing left to review in this upload.</div>}
          {canWrite && ready.length > 0 && !blocked && <div className="mr-go"><button type="button" className="save" disabled={busy} onClick={approveAll} data-testid="statement-approve-all">Approve the {ready.length} that need{ready.length === 1 ? 's' : ''} nothing</button></div>}
          {twins.length > 0 && (<>
            <div className="st-sec"><span>May already be in your books · {twins.length}</span>{canWrite && twins.length > 1 && <button type="button" className="bk-link" disabled={busy} onClick={allTwinsSame}>They are all the same</button>}</div>
            {twins.map(draw)}
          </>)}
          {look.length > 0 && (<><div className="st-sec"><span>Need you · {look.length}</span></div>{look.map(draw)}</>)}
          {ready.length > 0 && (<><div className="st-sec"><span>Need nothing · {ready.length}</span></div>{ready.map(draw)}</>)}
        </>)}
        {tab === 'auto' && (auto.length === 0 ? <div className="mr-empty">Nothing was filed for you from this upload. Once you approve a payee, the next statement files it without asking and it shows here.</div>
          : (<><p className="bk-help">Filed the way you filed them before. Undo puts a line back in To review and takes it out of your books.</p>{auto.map(draw)}</>))}
        {tab === 'posted' && (posted.length === 0 ? <div className="mr-empty">Nothing approved yet.</div> : posted.map(draw))}
        {tab === 'out' && (out.length === 0 ? <div className="mr-empty">Nothing was left out.</div> : out.map(draw))}

        {canWrite && imp.via === 'scan' && tab === 'review' && (adding === null
          ? <button type="button" className="bk-link" onClick={() => setAdding({ date: imp.period_to || '', amount: '', out: true, text: '' })}>Add a line the reader missed</button>
          : (
            <form className="mr-card" onSubmit={addLine} data-testid="statement-add-line">
              <div className="bk-eye">A line from the statement the reader missed</div>
              <div className="mr-two">
                <label className="mr-f">Date<input type="date" value={adding.date} max={todayNY()} onChange={(e) => setAdding({ ...adding, date: e.target.value })} /></label>
                <label className="mr-f">Amount<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} placeholder="0.00" /></label>
              </div>
              <div className="mr-dir" role="group" aria-label="Direction"><button type="button" className={adding.out ? 'on' : ''} onClick={() => setAdding({ ...adding, out: true })}>Money out</button><button type="button" className={!adding.out ? 'on' : ''} onClick={() => setAdding({ ...adding, out: false })}>Money in</button></div>
              <label className="mr-f">Description, as printed<input type="text" autoComplete="off" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} /></label>
              <div className="mr-go"><button type="submit" className="save" disabled={busy}>Add the line</button><button type="button" className="clear" onClick={() => setAdding(null)}>Cancel</button></div>
            </form>
          ))}
      </>)}

      {canWrite && imp.read_at && (imp.uploaded_by === userId || canManage) && <button type="button" className="bk-quiet danger" disabled={busy} onClick={takeBack} data-testid="statement-take-back">Take back this whole upload</button>}
    </div>
  );
}
