import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { calm } from '../calm';

// WHAT PRISMOS DID FOR YOU (1 Oct 2026).
//
// Josh: "It should have something like 'Hey, the AI handled 17 things for you
// today. Please go look at them before I approve it, or you approve it.'" The
// difference between an assistant and an inbox with AI sprinkled on it is that
// the assistant reports what it did and asks only about what needs a yes.
//
// done_for_you() (supabase/sql/2026-10-01d_calm_today.sql) returns two kinds:
//   • handled — informational: mail picked out or kept out of the way, messages
//     checked and set aside, old suggestions tidied. "Looks right" resets them.
//   • waiting for your OK — drafts, plans, follow-ups, people found. Nothing in
//     this group happens until the person says so.

export function useDoneForYou(hours = 24) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('done_for_you', { p_hours: hours });
    if (error) { setD({ handled: 0, waiting: 0, items: [] }); return; }
    setD(data || { handled: 0, waiting: 0, items: [] });
  }, [hours]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load();
    window.addEventListener('prism:tasks-changed', again);
    return () => window.removeEventListener('prism:tasks-changed', again);
  }, [load]);
  return [d, load];
}

const goTo = (setView, view, sub) => {
  if (!view) return;
  if (sub && window.__deepLink) window.__deepLink({ view, sub, n: Date.now() });
  if (view === 'contacts' && sub === 'found') { try { window.__openLinkReview = true; } catch (_) {} }
  if (view === 'inbox' && sub) { try { window.__inboxTab = sub; } catch (_) {} }
  setView && setView(view);
};

// One line on Today. Says what was done, and what waits — nothing else.
export function HandledLine({ setView }) {
  const [d] = useDoneForYou(24);
  if (!d || (!d.handled && !d.waiting)) return null;
  const parts = [];
  if (d.handled) parts.push(`PrismOS handled ${d.handled} ${d.handled === 1 ? 'thing' : 'things'} for you since yesterday.`);
  if (d.waiting) parts.push(`${d.waiting === 1 ? 'One is' : d.waiting + ' are'} waiting for your OK.`);
  return (
    <div data-testid="handled-line" style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 14.5, color: 'var(--text-2)', lineHeight: 1.5, flex: '1 1 220px' }}>{parts.join(' ')}</span>
      <button type="button" onClick={() => setView && setView('chief')} style={calm.link}>See what I did ›</button>
    </div>
  );
}

// The page.
export function DoneForYouList({ setView }) {
  const [d, reload] = useDoneForYou(24);
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const waiting = d.items.filter(i => i.needs_ok);
  const handled = d.items.filter(i => !i.needs_ok);
  const looksRight = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('done_for_you_ack', { p_kinds: handled.map(i => i.kind) });
    setBusy(false);
    if (error) { if (window.__notify) window.__notify('Could not save that: ' + (error.message || error), 'error'); return; }
    reload();
  };
  return (
    <div data-testid="done-for-you">
      <div style={calm.section}>Waiting for your OK</div>
      {waiting.length === 0
        ? <div style={calm.empty}>Nothing is waiting on you. Everything PrismOS prepared has been decided.</div>
        : waiting.map((it, i) => (
          <div key={it.kind} style={i ? calm.rowRule : calm.row}>
            <div style={calm.rowTitle}>{it.label} <span style={{ color: '#C5A95E', fontWeight: 700 }}>· {it.n}</span></div>
            <div style={calm.rowWhy}>{it.detail}</div>
            <div style={calm.actions}>
              <button type="button" style={calm.btnPrimary} onClick={() => goTo(setView, it.go, it.go_sub)}>Review</button>
            </div>
          </div>
        ))}

      <div style={calm.section}>Done for you since yesterday</div>
      {handled.length === 0
        ? <div style={calm.empty}>Nothing new since you last looked.</div>
        : <>
          {handled.map((it, i) => (
            <div key={it.kind} style={i ? calm.rowRule : calm.row}>
              <div style={calm.rowTitle}>{it.label} <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>· {it.n}</span></div>
              <div style={calm.rowWhy}>{it.detail}</div>
              {it.go && <div style={calm.actions}><button type="button" style={calm.btnQuiet} onClick={() => goTo(setView, it.go, it.go_sub)}>Look</button></div>}
            </div>
          ))}
          <div style={{ ...calm.actions, marginTop: 4 }}>
            <button type="button" disabled={busy} style={calm.btnPrimary} onClick={looksRight}>Looks right</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Clears this list until there is something new.</span>
          </div>
        </>}
    </div>
  );
}

export default DoneForYouList;
