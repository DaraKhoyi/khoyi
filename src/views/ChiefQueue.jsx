import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import CommitmentReview from './CommitmentReview';

// YOUR CHIEF OF STAFF — one thing at a time (29 Sep 2026).
//
// Dara: "Do we need two systems?" Then: "Make the chief of staff capable of
// doing all that would be missed by eliminating the other system, and let's do
// the right thing for the app." So there is ONE: the queue in chief_queue()
// (supabase/sql/2026-09-29_chief_queue.sql), computed live from the facts —
// promises heard on calls, late promises owed to you, deadlines from your
// documents, replies you owe, plans to approve, stuck deals, review asks,
// quiet recruits, and one nudge when A tasks slip. It replaced both the
// separate Chief of Staff screen (an AI list rebuilt every morning and never
// acted on) and the stand-alone "Heard on your calls" pile.
//
// The panel's rule (Marguerite, Ray): a pile reads as a score of how far
// behind you are. So: the single most important thing, decided here, then the
// next. The whole list is one tap away and never the first thing you see.

const KIND = {
  promise: 'From your calls', chase: 'Someone owes you', deadline: 'Deadline', tasks: 'Your task list', reply: 'Waiting on you',
  plan: 'Plan to approve', deal: 'Deal', review: 'Grow', recruit: 'Recruiting',
};
const GOLD = '#C5A95E';
const eyebrow = { fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD };
const btn = (primary) => ({ minHeight: 44, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--bg-base)' : 'var(--text-2)' });

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); };

export default function ChiefQueue({ userId, setView, onChanged, startOpen = false }) {
  const [items, setItems] = useState(null);
  const [current, setCurrent] = useState(null);     // ref chosen from the list; null = the top one
  const [showAll, setShowAll] = useState(startOpen);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('chief_queue', { p_limit: 60 });
      if (error) throw error;
      setItems(Array.isArray(data) ? data : []);
    } catch (_) { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load();
    window.addEventListener('prism:tasks-changed', again);
    return () => window.removeEventListener('prism:tasks-changed', again);
  }, [load]);

  const advance = useCallback(async () => { setCurrent(null); await load(); onChanged && onChanged(); }, [load, onChanged]);

  async function snooze(item, days) {
    setBusy(true);
    try { await supabase.from('chief_snoozes').upsert({ user_id: userId, source_ref: item.ref, until: plusDays(days) }, { onConflict: 'user_id,source_ref' }); } catch (_) {}
    setBusy(false); advance();
  }
  async function addTask(item, title, due) {
    setBusy(true);
    const { error } = await supabase.from('tasks').insert({ user_id: userId, title, due_date: due || plusDays(0), priority: 'high', completed: false, list: 'inbox', notes: 'From your Chief of Staff' });
    setBusy(false);
    if (error) { if (window.__notify) window.__notify('Could not add the task: ' + (error.message || error), 'error'); return; }
    if (window.__notify) window.__notify('Added to your tasks.', 'success');
    try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
    snooze(item, 36500);
  }
  const go = (view) => setView && setView(view);

  if (items === null) return null;
  if (!items.length) {
    // Caught up. The one thing left to offer is the suggestions PrismOS set aside.
    return <CommitmentReview userId={userId} compact recoveryOnly onChanged={advance} />;
  }
  const item = (current && items.find((i) => i.ref === current)) || items[0];
  const p = item.payload || {};

  let body;
  if (item.kind === 'promise') {
    body = <CommitmentReview key={item.ref} userId={userId} compact focusCallId={p.call_id || null} onEmpty={advance} onNotToday={() => snooze(item, 1)} onChanged={() => { onChanged && onChanged(); }} />;
  } else if (item.kind === 'chase') {
    body = <CommitmentReview key={item.ref} userId={userId} compact focusId={p.commitment_id} onEmpty={advance} onNotToday={() => snooze(item, 1)} onChanged={() => { onChanged && onChanged(); }} />;
  } else {
    const actions = {
      deadline: [['Add as a task', () => addTask(item, p.title || item.title, p.due_date), true]],
      tasks: [['Open my tasks', () => go('tasks'), true]],
      reply: [['Reply', () => { if (p.email) { try { window.__inboxOpenEmail = p.email; } catch (_) {} go('inbox'); } else go('contacts'); }, true], ['Done', () => snooze(item, 30)]],
      plan: [['Review the plan', () => go('agentruns'), true]],
      deal: [['Open the deal', () => go('pipeline'), true], ['It is fine', () => snooze(item, 14)]],
      review: [['Add as a task', () => addTask(item, p.title || item.title), true], ['Done', () => snooze(item, 36500)]],
      recruit: [['Open recruiting', () => go('recruiting'), true]],
    }[item.kind] || [];
    body = (
      <div style={{ border: '1px solid rgba(197,169,94,.5)', borderRadius: 16, padding: '14px 15px',
        background: 'linear-gradient(150deg,rgba(197,169,94,.16),rgba(197,169,94,.04))', boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
        <div style={{ ...eyebrow, color: item.priority === 1 ? '#E4674F' : 'var(--text-3)', marginBottom: 6 }}>{KIND[item.kind] || item.kind}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.4 }}>{item.title}</div>
        {item.why && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.5 }}>{item.why}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {actions.map(([label, fn, primary]) => <button key={label} type="button" disabled={busy} onClick={fn} style={btn(!!primary)}>{label}</button>)}
          <button type="button" disabled={busy} onClick={() => snooze(item, 1)} style={btn(false)}>Not today</button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chief-queue" style={{ marginBottom: 18 }}>
      <div style={{ ...eyebrow, marginBottom: 2 }}>Your chief of staff</div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 400, color: 'var(--text-1)', marginBottom: 10 }}>Your one thing now</div>
      {body}
      {items.length > 1 && (
        <button type="button" onClick={() => setShowAll((v) => !v)}
          style={{ marginTop: 6, minHeight: 44, background: 'none', border: 'none', padding: '0 2px', color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
          {showAll ? 'Hide the list' : 'Finish this and the next one appears · see the whole list'}
        </button>
      )}
      {showAll && items.map((i) => (
        <button key={i.ref} type="button" onClick={() => { setCurrent(i.ref); setShowAll(false); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {} }}
          style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 44, padding: '8px 4px', background: 'none', border: 'none',
            borderTop: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-1)' }}>
          <span style={{ ...eyebrow, fontSize: 10, color: i.ref === item.ref ? GOLD : 'var(--text-3)', marginRight: 8 }}>{KIND[i.kind] || i.kind}</span>
          <span style={{ fontSize: 13 }}>{i.title}</span>
        </button>
      ))}
    </div>
  );
}
