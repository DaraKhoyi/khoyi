// EntrySplit — one payment across several categories.
//
// Dara, 6 Oct 2026 (accounting build, parts 3 and 4): a line can be "split
// across categories" (a Costco run that is part office supplies, part client
// gifts). In the books a split is several entries that share the payment, so
// every report that reads entries by category stays right; on the screen it is
// one payment with parts.
//
// SplitEditor is used while reviewing a statement line; SplitLink puts the
// same editor on an entry already in the checkbook.
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { categoryGroups } from '../statements';

const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const cents = (n) => Math.round(n * 100) / 100;

// The parts as the database wants them: signed like the whole payment.
export function partsFrom(rows, total) {
  const sign = Number(total) < 0 ? -1 : 1;
  return rows.filter((r) => r.category_id && toNum(r.amount)).map((r) => ({ category_id: r.category_id, amount: cents(sign * Math.abs(toNum(r.amount))), memo: (r.memo || '').trim() || null }));
}
export function splitLeft(rows, total) { return cents(Math.abs(Number(total)) - rows.reduce((s, r) => s + Math.abs(toNum(r.amount)), 0)); }
export const splitReady = (rows, total) => partsFrom(rows, total).length >= 2 && partsFrom(rows, total).length === rows.filter((r) => r.category_id || toNum(r.amount)).length && splitLeft(rows, total) === 0;
export const startRows = (parts, total) => (Array.isArray(parts) && parts.length
  ? parts.map((p) => ({ category_id: p.category_id, amount: Math.abs(Number(p.amount)).toFixed(2), memo: p.memo || '' }))
  : [{ category_id: '', amount: '', memo: '' }, { category_id: '', amount: '', memo: '' }]);

export function SplitEditor({ total, categories, rows, onChange }) {
  const groups = categoryGroups(categories.filter((c) => (c.kind || 'expense') !== 'transfer'));
  const left = splitLeft(rows, total);
  const set = (i, patch) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="st-split" data-testid="split-editor">
      {rows.map((r, i) => (
        <div className="st-split-row" key={i}>
          <select aria-label={`Category for part ${i + 1}`} value={r.category_id || ''} onChange={(e) => set(i, { category_id: e.target.value })}>
            <option value="">Choose a category</option>
            {groups.map((g) => <optgroup key={g.kind} label={g.label}>{g.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
          <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Amount for part ${i + 1}`} placeholder="0.00" value={r.amount}
            onChange={(e) => set(i, { amount: e.target.value })} />
          {rows.length > 2 && <button type="button" className="st-x" aria-label={`Remove part ${i + 1}`} onClick={() => onChange(rows.filter((_, n) => n !== i))}>Remove</button>}
        </div>
      ))}
      <div className="st-split-foot">
        <button type="button" className="bk-link" onClick={() => onChange([...rows, { category_id: '', amount: left > 0 ? left.toFixed(2) : '', memo: '' }])}>Add another part</button>
        <span className={left === 0 ? 'ok' : 'off'}>{left === 0 ? `Adds up to ${fmtUSDCents(Math.abs(Number(total)))}` : left > 0 ? `${fmtUSDCents(left)} still to place` : `${fmtUSDCents(-left)} too much`}</span>
      </div>
    </div>
  );
}

// On an entry already in the checkbook: "Split across categories".
// `whole` is the full payment when the entry is already one part of a split.
export function SplitLink({ tx, whole = null, categories, onDone }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const total = whole == null ? tx && tx.amount : whole;
  if (!tx || tx.transfer_account || tx.scope !== 'business') return null;
  if (!rows) {
    return <button type="button" className="bk-link" data-testid="entry-split-open"
      onClick={() => setRows([{ category_id: tx.tax_category_id || '', amount: Math.abs(Number(tx.amount)).toFixed(2), memo: '' }, { category_id: '', amount: '', memo: '' }])}>
      {tx.split_group ? `One part of a ${fmtUSDCents(Math.abs(Number(total)))} payment. Split it a different way` : 'Split across categories'}</button>;
  }
  const save = async () => {
    setBusy(true);
    const { data: group, error } = await supabase.rpc('entry_split', { p_tx: tx.id, p_parts: partsFrom(rows, total) });
    if (error) { notifyError('That did not split: ' + error.message); setBusy(false); return; }
    const { data } = await supabase.from('transactions').select('*').eq('split_group', group).eq('is_archived', false);
    setBusy(false);
    onDone(data || []);
  };
  return (
    <div className="mr-card" data-testid="entry-split">
      <div className="bk-eye">Split {fmtUSDCents(Math.abs(Number(total)))} across categories</div>
      <SplitEditor total={total} categories={categories} rows={rows} onChange={setRows} />
      <div className="mr-go">
        <button type="button" className="save" disabled={busy || !splitReady(rows, total)} onClick={save}>{busy ? 'Saving' : 'Save the split'}</button>
        <button type="button" className="clear" onClick={() => setRows(null)}>Cancel</button>
      </div>
    </div>
  );
}
