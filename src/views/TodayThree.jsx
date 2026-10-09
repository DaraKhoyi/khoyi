import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { calm } from '../calm';

// ── TODAY: THREE THINGS, ONE TAP EACH (9 Oct 2026) ──────────────────────────
//
// Dara approved the compressed CRM plan at 9:24 AM ET. The audit behind it:
// 143 promises expired and 0 of them were ever warned; 5 of 17 people opened
// the app last week. The first move is one front door a new agent understands
// in five minutes: three cards, each with one obvious tap.
//
//   1. A promise you made that is due within 48 hours (late ones first).
//   2. A Company Lead assigned to you that has not been answered.
//   3. Someone who called you and has not been called or texted back.
//   Empty slots are filled from the others, in that order.
//
// Everything comes from public.today_three() (supabase/sql/2026-10-09a_today_three.sql),
// which reads only the signed-in person's own rows. IN-APP ONLY: nothing on
// this card texts or emails anyone. "Call" opens the phone's own dialer; the
// person places the call. "Done" and "Not today" only change the agent's own
// list, and "Done" can be undone.
//
// If the function is not there yet (before the SQL is applied) or fails, the
// cards hide themselves and Today looks exactly as it did before.

const tell = (m, k) => { if (window.__notify) window.__notify(m, k); };
const TZ = 'America/New_York';
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: TZ }); };
const dayLabel = (iso) => {
  const t = todayNY();
  if (iso === t) return 'today';
  if (iso === plusDays(1)) return 'tomorrow';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const when = (ts) => {
  const d = new Date(ts);
  const sameDay = d.toLocaleDateString('en-CA', { timeZone: TZ }) === todayNY();
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + time;
};
const firstName = (s) => (s || '').trim().split(/\s+/)[0] || '';
const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const isPhoneLike = (s) => /^[\d\s()+.-]{7,}$/.test(String(s || ''));

export function cardCopy(c) {
  if (c.kind === 'promise') {
    const who = c.who && !isPhoneLike(c.who) ? c.who : null;
    return {
      label: c.late ? 'A promise is late' : 'A promise is due',
      title: c.title || 'Something you said you would do',
      why: (c.late ? 'Was due ' : 'Due ') + dayLabel(c.due_date) + (who ? ' · to ' + who : '') + (c.stakes === 'high' ? ' · money or a deadline is involved' : ''),
    };
  }
  if (c.kind === 'company_lead') {
    return {
      label: 'Company lead waiting',
      title: c.who || 'New lead',
      why: 'Assigned to you ' + when(c.assigned_at) + (c.source ? ' · from ' + c.source : '') + (c.property ? ' · ' + c.property : '') + ' · not answered yet',
    };
  }
  return {
    label: 'Missed call',
    title: c.who || 'Someone called',
    why: (c.times > 1 ? 'Called ' + c.times + ' times, last ' : 'Called ') + when(c.last_at) + ' · not called back yet',
  };
}

export function TodayThreeCards({ cards, busy, undo, onDone, onUndo, onSnooze, onOpen }) {
  return (
    <div data-testid="today-three">
      <div style={calm.section}>Your three for today</div>
      <div style={calm.sectionNote}>Do these and the day is handled.</div>
      {cards.map((c, i) => {
        const k = cardCopy(c);
        const done = undo && undo.ref === c.ref;
        return (
          <div key={c.ref} data-testid={'today-three-' + c.kind} style={{ display: 'flex', gap: 14, ...(i ? calm.rowRule : calm.row), opacity: done ? 0.55 : 1 }}>
            <div aria-hidden style={{ fontFamily: calm.SERIF, fontWeight: 300, fontSize: 26, lineHeight: '30px', color: '#C5A95E', minWidth: 18 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: c.kind === 'company_lead' || c.late ? '#C5A95E' : 'var(--text-3)', letterSpacing: '0.01em' }}>{k.label}</div>
              <div style={{ ...calm.rowTitle, marginTop: 2 }}>{k.title}</div>
              <div style={calm.rowWhy}>{k.why}</div>
              <div style={calm.actions}>
                {done ? (
                  <>
                    <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Marked done.</span>
                    <button type="button" style={{ ...calm.link, minHeight: 44, padding: '0 8px' }} disabled={busy} onClick={() => onUndo(c)}>Undo</button>
                  </>
                ) : (
                  <>
                    {c.kind === 'promise' && <button type="button" data-testid="today-three-done" style={{ ...calm.btnPrimary, minHeight: 44 }} disabled={busy} onClick={() => onDone(c)}>Done</button>}
                    {c.kind !== 'promise' && (c.phone
                      ? <a href={telHref(c.phone)} data-testid="today-three-call" style={{ ...calm.btnPrimary, minHeight: 44, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{c.kind === 'missed_call' ? 'Call back' : 'Call ' + (firstName(c.who) && !isPhoneLike(c.who) ? firstName(c.who) : 'now')}</a>
                      : <button type="button" style={{ ...calm.btnPrimary, minHeight: 44 }} onClick={() => onOpen(c)}>Open</button>)}
                    {c.kind === 'promise' && c.phone && <a href={telHref(c.phone)} style={{ ...calm.btnQuiet, minHeight: 44, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#C5A95E' }}>Call {firstName(c.who) || ''}</a>}
                    <button type="button" style={{ ...calm.btnQuiet, minHeight: 44 }} disabled={busy} onClick={() => onSnooze(c)}>Not today</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TodayThree({ userId, setView, onState }) {
  const [cards, setCards] = useState(null);   // null = loading or unavailable (render nothing)
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);     // { ref, id, prev } after "Done"

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('today_three');
      if (error || !data || data.ok !== true || !Array.isArray(data.cards)) throw error || new Error('unavailable');
      setCards(data.cards);
      onState && onState(data.cards.length ? 'cards' : 'clear');
    } catch (_) { setCards(null); onState && onState('off'); }
  }, [onState]);
  useEffect(() => { if (userId) load(); }, [userId, load]);
  useEffect(() => {
    const again = () => load();
    window.addEventListener('prism:tasks-changed', again);
    return () => window.removeEventListener('prism:tasks-changed', again);
  }, [load]);

  async function onDone(c) {
    setBusy(true);
    const prev = c.status === 'proposed' ? 'proposed' : 'accepted';
    const { error } = await supabase.from('commitments').update({ status: 'done', decided_at: new Date().toISOString() }).eq('id', c.id).eq('user_id', userId);
    setBusy(false);
    if (error) { tell('Could not mark that done: ' + (error.message || error), 'error'); return; }
    setUndo({ ref: c.ref, id: c.id, prev });
  }
  async function onUndo(c) {
    if (!undo) return;
    setBusy(true);
    const { error } = await supabase.from('commitments').update({ status: undo.prev, decided_at: null }).eq('id', undo.id).eq('user_id', userId);
    setBusy(false);
    if (error) { tell('Could not undo: ' + (error.message || error), 'error'); return; }
    setUndo(null);
  }
  async function onSnooze(c) {
    setBusy(true);
    const { error } = await supabase.from('chief_snoozes').upsert({ user_id: userId, source_ref: c.ref, until: plusDays(1) }, { onConflict: 'user_id,source_ref' });
    setBusy(false);
    if (error) { tell('Could not set that aside: ' + (error.message || error), 'error'); return; }
    setUndo(null);
    load();
  }
  const onOpen = () => { setView && setView('pipeline'); };

  if (cards === null) return null;
  if (!cards.length) {
    return (
      <div data-testid="today-three-clear">
        <div style={calm.section}>Your three for today</div>
        <div style={calm.empty}>Nothing is due, late or waiting on a call back. You are clear.</div>
      </div>
    );
  }
  return <TodayThreeCards cards={cards} busy={busy} undo={undo} onDone={onDone} onUndo={onUndo} onSnooze={onSnooze} onOpen={onOpen} />;
}
