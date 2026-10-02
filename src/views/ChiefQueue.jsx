import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../dataService';
import CommitmentReview from './CommitmentReview';
import RecentWith from './RecentWith';
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
  const [heard, setHeard] = useState(null);    // ref of a row whose person's recent messages are open (Dara, 1 Oct)
  const [removing, setRemoving] = useState(null);   // ref of a row whose Delete / Not a thing choice is open
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
  // SOMEONE ELSE'S LATE PROMISE, closed from Today without opening it (Dara, 2 Oct).
  //   done    — it happened.
  //   delete  — off my list, no judgement.
  //   teach   — "Not a thing": PrismOS should not have raised it. The stamp is the
  //             lesson the call reader is given (supabase/functions/_shared/lessons.ts).
  // Every one of them can be undone from the toast.
  async function closePromise(item, how) {
    const id = item.payload && item.payload.commitment_id;
    if (!id) return;
    setBusy(true);
    const now = new Date().toISOString();
    const patch = how === 'done' ? { status: 'done', decided_at: now }
      : { status: 'dismissed', decided_at: now, not_a_thing_at: how === 'teach' ? now : null };
    const { error } = await supabase.from('commitments').update(patch).eq('id', id);
    setBusy(false); setRemoving(null);
    if (error) { tell('Could not save that: ' + (error.message || error), 'error'); return; }
    const undo = async () => {
      const { error: e2 } = await supabase.from('commitments').update({ status: 'accepted', decided_at: null, not_a_thing_at: null }).eq('id', id);
      if (e2) { tell('Could not undo: ' + (e2.message || e2), 'error'); return; }
      load(); onChanged && onChanged();
    };
    const msg = how === 'done' ? 'Done.' : how === 'teach' ? 'Not a thing \u2014 PrismOS will learn from this.' : 'Deleted.';
    if (window.__notify) window.__notify(msg, 'success', { label: 'Undo', onClick: undo });
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
      chase: [['Review', () => setOpen(open === item.ref ? null : item.ref), true], ['Done', () => closePromise(item, 'done')], ['Remove', () => setRemoving(removing === item.ref ? null : item.ref)]],
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
            {p.contact_id ? (
              // Tap the person to see what they actually said — decide without leaving Today.
              <button type="button" aria-expanded={heard === item.ref} onClick={() => setHeard(heard === item.ref ? null : item.ref)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={calm.rowTitle}>{item.title}</div>
                {item.why && <div style={calm.rowWhy}>{item.why}</div>}
                <div style={{ fontSize: 13, color: '#C5A95E', fontWeight: 600, marginTop: 5 }}>
                  {heard === item.ref ? 'Hide what ' + (p.name || 'they').split(' ')[0] + ' said ▴' : 'What ' + (p.name || 'they').split(' ')[0] + ' said ▾'}
                </div>
              </button>
            ) : <>
              <div style={calm.rowTitle}>{item.title}</div>
              {item.why && <div style={calm.rowWhy}>{item.why}</div>}
            </>}
            {heard === item.ref && p.contact_id && <RecentWith contactId={p.contact_id} name={p.name} setView={setView} />}
            <div style={calm.actions}>
              {actionsFor(item).map(([label, fn, primary]) => (
                <button key={label} type="button" disabled={busy} onClick={fn} style={primary ? calm.btnPrimary : calm.btnQuiet}>{label}</button>
              ))}
              <button type="button" disabled={busy} onClick={() => snooze(item, 1)} style={calm.btnQuiet}>Not today</button>
            </div>
            {removing === item.ref && (
              // Two ways off the list, said plainly where the choice is made.
              <div data-testid="remove-choice" style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid rgba(197,169,94,0.35)' }}>
                <button type="button" disabled={busy} onClick={() => closePromise(item, 'delete')} style={{ ...calm.link, display: 'block', minHeight: 44 }}>
                  Delete <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>— just take it off my list</span>
                </button>
                <button type="button" disabled={busy} onClick={() => closePromise(item, 'teach')} style={{ ...calm.link, display: 'block', minHeight: 44 }}>
                  Not a thing <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>— PrismOS should not have raised this, and will learn from it</span>
                </button>
              </div>
            )}
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
