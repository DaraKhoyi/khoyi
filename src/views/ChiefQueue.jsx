import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../dataService';
import CommitmentReview from './CommitmentReview';
import { calm } from '../calm';

// THE ONE QUEUE — what needs you, decided for you.
//
// One system (29 Sep): chief_queue() (supabase/sql/2026-10-01d_calm_today.sql)
// is computed live from the facts — promises heard on calls, late promises owed
// to you, emails that did not arrive, deadlines and documents that ask for
// something, replies you owe, plans to approve, stuck deals, review asks.
//
// Calm (1 Oct, Josh + Dara + Ray): Today shows the THREE that matter, as quiet
// rows — not one card with "1 of 84" on it, and never a pile. Every row says who
// and why in plain words, and every row has a way to say "nothing needed".
// The Chief of Staff screen shows the same rows, all of them.

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); };
const tell = (m, k) => { if (window.__notify) window.__notify(m, k); };

export default function ChiefQueue({ userId, setView, onChanged, limit = 3, all = false, onCount }) {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);      // ref of a promise/chase row opened in place
  const [busy, setBusy] = useState(false);
  const countRef = useRef(onCount); countRef.current = onCount;   // a new function each render must not reload

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('chief_queue', { p_limit: 60 });
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      countRef.current && countRef.current(list.length);
    } catch (_) { setItems([]); countRef.current && countRef.current(0); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load();
    window.addEventListener('prism:tasks-changed', again);
    return () => window.removeEventListener('prism:tasks-changed', again);
  }, [load]);

  const advance = useCallback(async () => { setOpen(null); await load(); onChanged && onChanged(); }, [load, onChanged]);

  async function snooze(item, days) {
    setBusy(true);
    const { error } = await supabase.from('chief_snoozes').upsert({ user_id: userId, source_ref: item.ref, until: plusDays(days) }, { onConflict: 'user_id,source_ref' });
    setBusy(false);
    if (error) { tell('Could not set that aside: ' + (error.message || error), 'error'); return; }
    advance();
  }
  async function addTask(item, title, due) {
    setBusy(true);
    const { error } = await supabase.from('tasks').insert({ user_id: userId, title, due_date: due || plusDays(0), priority: 'high', completed: false, list: 'inbox', notes: 'From Today' });
    setBusy(false);
    if (error) { tell('Could not add the task: ' + (error.message || error), 'error'); return; }
    tell('Added to your tasks.', 'success');
    try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
    snooze(item, 36500);
  }
  // "No reply needed" — you decided; it should stop asking. Same stamp the
  // contact screen uses, so the person also leaves "replies you owe" everywhere.
  async function noReplyNeeded(item) {
    const id = item.payload && item.payload.contact_id;
    if (!id) return snooze(item, 36500);
    setBusy(true);
    const { error } = await supabase.from('contacts').update({ no_reply_needed_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (error) { tell('Could not clear it: ' + (error.message || error), 'error'); return; }
    tell('Done — nothing needed.', 'success');
    advance();
  }
  async function bounceHandled(item) {
    const id = item.payload && item.payload.bounce_id;
    setBusy(true);
    const { error } = await supabase.from('email_bounces').update({ handled: true, handled_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (error) { tell('Could not mark it handled: ' + (error.message || error), 'error'); return; }
    advance();
  }
  const go = (view, sub) => { if (sub && window.__deepLink) window.__deepLink({ view, sub, n: Date.now() }); setView && setView(view); };

  if (items === null) return null;
  if (!items.length) {
    // Caught up. The one thing left to offer is the suggestions PrismOS set aside.
    return all ? <div style={calm.empty}>Nothing needs you right now.</div>
      : <CommitmentReview userId={userId} compact recoveryOnly onChanged={advance} />;
  }

  const actionsFor = (item) => {
    const p = item.payload || {};
    return ({
      promise: [['Review', () => setOpen(open === item.ref ? null : item.ref), true]],
      chase: [['Review', () => setOpen(open === item.ref ? null : item.ref), true]],
      bounce: [['Resend', () => { if (window.__composeEmail) window.__composeEmail(p.to || '', p.subject ? 'Re: ' + p.subject : ''); }, true], ['Handled', () => bounceHandled(item)]],
      deadline: [['Add as a task', () => addTask(item, p.title || item.title, p.due_date), true]],
      doc: [['Open', () => go('documents'), true], ['Done', () => snooze(item, 36500)]],
      tasks: [['Open my tasks', () => go('tasks'), true]],
      reply: [['Reply', () => { if (p.email) { try { window.__inboxOpenEmail = p.email; } catch (_) {} go('inbox'); } else go('contacts'); }, true], ['No reply needed', () => noReplyNeeded(item)]],
      plan: [['Review the plan', () => go('agentruns'), true]],
      deal: [['Open the deal', () => go('pipeline'), true], ['It is fine', () => snooze(item, 14)]],
      review: [['Add as a task', () => addTask(item, p.title || item.title), true], ['Done', () => snooze(item, 36500)]],
      recruit: [['Open recruiting', () => go('recruiting'), true]],
    })[item.kind] || [];
  };

  const shown = all ? items : items.slice(0, limit);
  return (
    <div data-testid="chief-queue">
      {shown.map((item, i) => {
        const p = item.payload || {};
        return (
          <div key={item.ref} style={i ? calm.rowRule : calm.row}>
            <div style={calm.rowTitle}>{item.title}</div>
            {item.why && <div style={calm.rowWhy}>{item.why}</div>}
            <div style={calm.actions}>
              {actionsFor(item).map(([label, fn, primary]) => (
                <button key={label} type="button" disabled={busy} onClick={fn} style={primary ? calm.btnPrimary : calm.btnQuiet}>{label}</button>
              ))}
              <button type="button" disabled={busy} onClick={() => snooze(item, 1)} style={calm.btnQuiet}>Not today</button>
            </div>
            {open === item.ref && (
              <div style={{ marginTop: 10 }}>
                {item.kind === 'promise'
                  ? <CommitmentReview userId={userId} compact focusCallId={p.call_id || null} onEmpty={advance} onNotToday={() => snooze(item, 1)} onChanged={() => { onChanged && onChanged(); }} />
                  : <CommitmentReview userId={userId} compact focusId={p.commitment_id} onEmpty={advance} onNotToday={() => snooze(item, 1)} onChanged={() => { onChanged && onChanged(); }} />}
              </div>
            )}
          </div>
        );
      })}
      {!all && items.length > limit && (
        <button type="button" onClick={() => go('chief')} style={{ ...calm.link, marginTop: 6 }}>
          The rest can wait — see them when you like
        </button>
      )}
    </div>
  );
}
