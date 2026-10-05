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

// ── THE RECORD (4 Oct 2026) ────────────────────────────────────────────────────
// Dara: "not having things disappear without our knowledge… I would like to know
// about things that might have been done to help me, but resulted in important
// things being missed." Ray: "I've probably missed things and I have no idea" —
// and, the same week, "don't hand me a list of people I let down."
//
// Both are answered by one thing: every automatic action as its OWN LINE — what,
// when, why, and a way to undo it — a few at a time, with no total anywhere.
// the_record() (supabase/sql/2026-10-04b_the_record.sql). Lines are kept for a
// year, then removed, and the removal is itself a line (Dara, 5 Oct; this
// replaces "no time limit"). The person can remove one sooner.
const when = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric' });
const KIND = { commitment: 'A follow-up from a call, set aside', dropped: 'Heard on a call, and left out', lead: null };

function RecordLine({ it, first, second, onDone }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const call = async (fn, args, msg) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error || data === false || (data && data.ok === false)) { if (window.__notify) window.__notify('Could not do that: ' + (error?.message || data?.error || 'try again'), 'error'); return; }
    setSaid(typeof msg === 'function' ? msg(data) : msg);
    setTimeout(() => onDone && onDone(), 1400);
  };
  const undo = () => call('the_record_undo', { p_src: it.src, p_id: it.id },
    it.src === 'lead' ? (d) => `Noted. Messages from ${d?.sender || 'this sender'} will be treated as leads from now on. This one is in your Inbox.`
                      : 'Back on your list, under Review.');
  const mark = (m) => call('the_record_mark', { p_src: it.src, p_id: it.id, p_mark: m }, m === 'right' ? 'Thank you. Noted.' : 'Removed from the record.');
  if (said) return <div data-testid="record-said" style={{ ...(first ? calm.row : calm.rowRule), color: 'var(--text-2)', fontSize: 14 }}>{said}</div>;
  const undoLabel = it.undo === 'real_lead' ? 'That was a real lead' : it.undo === 'pick_up' ? (second ? 'No, bring it back' : 'Pick up') : null;
  return (
    <div data-testid={second ? 'second-look-line' : 'record-line'} style={first ? calm.row : calm.rowRule}>
      {KIND[it.src] && <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>{KIND[it.src]}</div>}
      <div style={calm.rowTitle}>{it.what}</div>
      <div style={calm.rowWhy}>{when(it.at)}{it.who ? ' · ' + it.who : ''}</div>
      <div style={calm.rowWhy}>{it.why}</div>
      {it.quote && <div style={{ ...calm.rowWhy, fontStyle: 'italic', color: 'var(--text-3)' }}>“{String(it.quote).slice(0, 220)}”</div>}
      {second && it.flag && <div style={{ ...calm.rowWhy, color: '#C5A95E' }}>{it.flag}</div>}
      <div style={calm.actions}>
        {second && <button type="button" disabled={busy} style={calm.btnPrimary} onClick={() => mark('right')}>Yes, that was right</button>}
        {undoLabel && <button type="button" disabled={busy} style={second ? calm.btnQuiet : calm.btnPrimary} onClick={undo}>{undoLabel}</button>}
        {!second && it.src !== 'tidy' && <button type="button" disabled={busy} style={calm.btnQuiet} onClick={() => mark('removed')}>Remove</button>}
      </div>
    </div>
  );
}

export function TheRecord() {
  const [rec, setRec] = useState(null);
  const [older, setOlder] = useState([]);       // pages below the first, appended
  const [more, setMore] = useState(false);
  const [secondN, setSecondN] = useState(3);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (n = secondN) => {
    const { data, error } = await supabase.rpc('the_record', { p_limit: 8, p_before: null, p_second: n });
    if (error || !data) { setRec({ second_look: [], items: [], failed: true }); return; }
    setRec(data); setOlder([]); setMore(!!data.more);
  }, [secondN]);
  useEffect(() => { load(); }, [load]);
  const showMore = async () => {
    const all = [...(rec?.items || []), ...older];
    const last = all[all.length - 1]; if (!last) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('the_record', { p_limit: 8, p_before: last.at, p_second: 1 });
    setBusy(false);
    if (error || !data) { if (window.__notify) window.__notify('Could not load more: ' + (error?.message || ''), 'error'); return; }
    setOlder(o => [...o, ...(data.items || [])]); setMore(!!data.more);
  };
  if (!rec) return null;
  const items = [...(rec.items || []), ...older];
  return (
    <div data-testid="the-record">
      {rec.second_look.length > 0 && (
        <div data-testid="second-look">
          <div style={calm.section}>Worth a second look</div>
          <div style={calm.sectionNote}>I set these aside. Did I get it right? A few at a time.</div>
          {rec.second_look.map((it, i) => <RecordLine key={it.src + it.id} it={it} first={i === 0} second onDone={() => load()} />)}
          {rec.second_more && <div style={calm.actions}><button type="button" style={calm.btnQuiet} onClick={() => { const n = secondN + 3; setSecondN(n); load(n); }}>Show a few more</button></div>}
        </div>
      )}
      <div style={calm.section}>What I did on my own</div>
      <div style={calm.sectionNote}>Each thing PrismOS set aside or left out, with why. Kept for a year, then removed. You can remove anything sooner.</div>
      {rec.failed ? <div style={calm.empty}>The record could not be loaded just now. Nothing has been lost.</div>
        : items.length === 0 ? <div style={calm.empty}>Nothing has been set aside or left out.</div>
        : items.map((it, i) => <RecordLine key={it.src + it.id} it={it} first={i === 0} onDone={() => load()} />)}
      {more && <div style={calm.actions}><button type="button" disabled={busy} style={calm.btnQuiet} onClick={showMore}>Show earlier</button></div>}
    </div>
  );
}

// The page.
export function DoneForYouList({ setView }) {
  const [d, reload] = useDoneForYou(24);
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const waiting = d.items.filter(i => i.needs_ok);
  // Mail is far too much to list line by line; it keeps its two summary rows.
  // Everything else PrismOS does on its own is itemised in the record below.
  const handled = d.items.filter(i => !i.needs_ok && (i.kind === 'mail_worth' || i.kind === 'mail_quiet'));
  const looksRight = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('done_for_you_ack', { p_kinds: d.items.filter(i => !i.needs_ok).map(i => i.kind) });
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

      <TheRecord />

      {handled.length > 0 && <>
        <div style={calm.section}>Your email since yesterday</div>
        {handled.map((it, i) => (
          <div key={it.kind} style={i ? calm.rowRule : calm.row}>
            <div style={calm.rowTitle}>{it.label} <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>· {it.n}</span></div>
            <div style={calm.rowWhy}>{it.detail}</div>
            {it.go && <div style={calm.actions}><button type="button" style={calm.btnQuiet} onClick={() => goTo(setView, it.go, it.go_sub)}>Look</button></div>}
          </div>
        ))}
        <div style={{ ...calm.actions, marginTop: 4 }}>
          <button type="button" disabled={busy} style={calm.btnPrimary} onClick={looksRight}>Looks right</button>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Clears this until there is something new.</span>
        </div>
      </>}
    </div>
  );
}

export default DoneForYouList;
