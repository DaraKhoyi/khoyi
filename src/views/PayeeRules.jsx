// PayeeRules — every rule in a set of books, in plain words.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "A Rules screen lists every rule
// in plain words. Each one is editable and deletable." And: "The user can mark
// a payee 'always ask' ... PrismOS proposes this itself after two conflicting
// corrections." "A rule can be narrowed by amount or by account."
//
// A rule is what a person decided for a payee: PrismOS never makes one from
// its own guess. Deleting a rule removes nothing from the books; the payee is
// simply asked about again next time.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { confirmDialog, notify, notifyError } from '../notify';
import { categoryGroups, followUp, ruleSentence, shortDay } from '../statements';

const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

function RuleEditor({ book, rule, categories, busy, onSave, onDelete, onCancel }) {
  const own = book.kind === 'personal';
  const [payee, setPayee] = useState(rule.payee || '');
  const [kind, setKind] = useState(rule.transfer_account ? 'transfer' : rule.is_personal ? 'personal' : 'category');
  const [category, setCategory] = useState(rule.tax_category_id || '');
  const [transfer, setTransfer] = useState(rule.transfer_account || '');
  const [ask, setAsk] = useState(!!rule.always_ask);
  const [amount, setAmount] = useState(rule.amount == null ? '' : Math.abs(Number(rule.amount)).toFixed(2));
  const [account, setAccount] = useState(rule.account_key || '');
  const [memo, setMemo] = useState(rule.memo || '');
  const split = Array.isArray(rule.parts) && rule.parts.length > 0;
  const groups = categoryGroups(categories.filter((c) => (c.kind || 'expense') !== 'transfer'));

  const save = () => {
    const patch = {};
    if (payee.trim() && payee.trim() !== rule.payee) patch.payee = payee.trim();
    if (memo.trim() !== (rule.memo || '')) patch.memo = memo.trim();
    if (ask !== !!rule.always_ask) patch.always_ask = ask;
    if (kind === 'category' && (category || '') !== (rule.tax_category_id || '') && (category || !split)) patch.category = category || null;
    if (kind === 'category' && (rule.is_personal || rule.transfer_account) && !('category' in patch)) patch.category = category || null;
    if (kind === 'personal' && !rule.is_personal) patch.personal = true;
    if (kind === 'transfer') {
      if (!transfer.trim()) { notifyError('Name the other account.'); return; }
      if (transfer.trim() !== (rule.transfer_account || '')) patch.transfer_account = transfer.trim();
    }
    const amt = amount === '' ? null : toNum(amount);
    if (Number.isNaN(amt)) { notifyError('Enter the amount as a number, or leave it empty for any amount.'); return; }
    // The rule's amount keeps the direction it was learned in (money out is negative).
    const signed = amt == null ? null : (rule.amount != null ? Math.sign(Number(rule.amount)) || -1 : rule.money_in ? 1 : -1) * Math.abs(amt);
    if ((signed == null ? null : signed) !== (rule.amount == null ? null : Number(rule.amount))) patch.amount = signed;
    if (account.trim().toLowerCase() !== (rule.account_key || '')) patch.account = account.trim() || null;
    if (!Object.keys(patch).length) { onCancel(); return; }
    onSave(patch);
  };

  return (
    <div className="mr-card st-edit" data-testid="rule-editor">
      <label className="mr-f">Payee, as you want it written<input type="text" autoComplete="off" value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
      <div className={'mr-dir' + (own ? ' three' : '')} role="group" aria-label="How it is filed">
        <button type="button" className={kind === 'category' ? 'on' : ''} onClick={() => setKind('category')}>Category</button>
        <button type="button" className={kind === 'transfer' ? 'on' : ''} onClick={() => setKind('transfer')}>Transfer</button>
        {own && <button type="button" className={kind === 'personal' ? 'on' : ''} onClick={() => setKind('personal')}>Personal</button>}
      </div>
      {kind === 'category' && (
        <label className="mr-f">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{split ? 'Keep the split' : 'Nothing remembered'}</option>
            {groups.map((g) => <optgroup key={g.kind} label={g.label}>{g.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
        </label>
      )}
      {kind === 'category' && split && <p className="bk-help">This rule splits the payment across categories. Choosing one category here replaces the split. To change the shares, correct a line in review and the rule follows.</p>}
      {kind === 'transfer' && <label className="mr-f">The other account<input type="text" autoComplete="off" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="Company Visa" /></label>}
      <label className="st-check"><input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} /><span>Always ask me about this payee. Never file it on its own.</span></label>
      <div className="mr-two">
        <label className="mr-f">Only when the amount is<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Any amount" /></label>
        <label className="mr-f">Only from this account<input type="text" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Any account" /></label>
      </div>
      <label className="mr-f">Memo to put on each entry<input type="text" autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" /></label>
      <div className="mr-go">
        <button type="button" className="save" disabled={busy} onClick={save}>Save the rule</button>
        <button type="button" className="clear" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <button type="button" className="bk-quiet danger" disabled={busy} onClick={onDelete}>Delete this rule</button>
    </div>
  );
}

export default function PayeeRules({ book, categories, canWrite, onBack, onChanged }) {
  const [rules, setRules] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('rule_list', { p_book: book.id });
    if (error) { notifyError('The rules did not load: ' + error.message); setRules([]); return; }
    setRules(data || []);
  }, [book.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (rule, patch) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('rule_save', { p_rule: rule.id, p_patch: patch });
    setBusy(false);
    if (error) { notifyError('That did not save: ' + error.message); return; }
    setEditing(null);
    if (data && data.past > 0 && await followUp({ rule_id: data.rule_id, payee: data.payee, past: data.past })) onChanged();
    await load(); onChanged();
  };
  const remove = async (rule) => {
    if (!await confirmDialog(`Delete the rule for ${rule.payee}? Nothing already in your books changes. Next time, PrismOS will ask you about ${rule.payee} again.`, { confirmLabel: 'Delete the rule' })) return;
    setBusy(true);
    const { error } = await supabase.rpc('rule_delete', { p_rule: rule.id });
    setBusy(false);
    if (error) { notifyError('That did not delete: ' + error.message); return; }
    setEditing(null); notify('Rule deleted', 'success'); await load(); onChanged();
  };
  const answer = (rule, yes) => save(rule, yes ? { always_ask: true } : { dismiss_suggestion: true });

  const q = search.trim().toLowerCase();
  const shown = (rules || []).filter((r) => !q || r.payee.toLowerCase().includes(q) || (ruleSentence(r, categories).what || '').toLowerCase().includes(q));

  return (
    <div className="st-rules" data-testid="payee-rules">
      <button type="button" className="bk-link" onClick={onBack}>Back to all statements</button>
      <div className="mr-head"><h3>Rules</h3><span>{rules ? `${rules.length} ${rules.length === 1 ? 'payee' : 'payees'}` : ''}</span></div>
      <p className="bk-help">What you decided for each payee. A rule you confirmed while reviewing a statement files that payee without asking the next time. PrismOS never makes a rule from its own guess.</p>
      {rules && rules.length > 6 && <input type="search" className="mr-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payee or category" aria-label="Search the rules" />}
      {rules === null ? <div className="loading-screen" style={{ height: '30vh' }}><div className="spinner" /></div>
        : rules.length === 0 ? <div className="mr-empty">No rules yet. The first time you say what a payee is while reviewing a statement, it appears here.</div>
          : shown.length === 0 ? <div className="mr-empty">No rule matches that.</div>
            : shown.map((r) => {
              if (editing === r.id) return <RuleEditor key={r.id} book={book} rule={r} categories={categories} busy={busy} onSave={(p) => save(r, p)} onDelete={() => remove(r)} onCancel={() => setEditing(null)} />;
              const s = ruleSentence(r, categories);
              return (
                <div className="st-line" key={r.id} data-testid="payee-rule">
                  <div className="st-line-top"><span className="p"><b>{r.payee}</b><i>{s.what}</i></span></div>
                  <div className="st-what"><b>{s.how}</b><i> · {r.used ? `filed ${r.used} ${r.used === 1 ? 'entry' : 'entries'}${r.last_used ? ', last ' + shortDay(r.last_used, true) : ''}` : 'not used yet'}</i>{r.memo ? <i> · memo: {r.memo}</i> : null}</div>
                  {r.suggest_always_ask && !r.always_ask && (
                    <><p className="st-flag">You have filed {r.payee} more than one way. Should PrismOS always ask you about it?</p>
                      {canWrite && <div className="st-go"><button type="button" className="main" disabled={busy} onClick={() => answer(r, true)}>Always ask me</button><button type="button" disabled={busy} onClick={() => answer(r, false)}>No, keep filing it</button></div>}</>
                  )}
                  {canWrite && <div className="st-go"><button type="button" disabled={busy} onClick={() => setEditing(r.id)} data-testid="payee-rule-change">Change</button><button type="button" disabled={busy} onClick={() => remove(r)}>Delete</button></div>}
                </div>
              );
            })}
    </div>
  );
}
