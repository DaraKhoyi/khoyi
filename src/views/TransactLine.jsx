import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

// CAN THEY TRANSACT? — one line, before every call (30 Sep 2026).
//
// Marguerite (panel): "A sentence that says 'mentioned pre-approval at $400K in
// August email' — I open that before every call. A LinkedIn summary I don't
// need." Read by _shared/transactFacts.ts from what the person WROTE to this
// agent (email and texts, never the web), and every fact carries their exact
// words and the date — a quote that is not in the message is thrown away.
//
// Pass `t` ({ line, ask, known }) when the caller already has it (call prep),
// or `contactId` to fetch it (free when nothing new has arrived).
//
// LAST TIME (30 Sep, Ray on the panel): "I always forget what I said last
// time… if it did that one thing I would not feel stupid." Above the transact
// line: what you last said, what they last said, what the last call was about —
// a calendar date and the substance, nothing else. Deliberately NO "N days
// ago", no gap, no score, no colour that reads as good or bad: Ray closes
// anything that makes him feel behind. (_shared/lastTime.ts.)

function LastTime({ lt, compact }) {
  if (!lt || (!lt.you && !lt.them && !lt.call)) return null;
  const row = (who, on, via, text) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
      <span style={{ flex: '0 0 auto', minWidth: 74, fontSize: 11, color: 'var(--text-3)', paddingTop: 2 }}>{on}{via ? ' · ' + via : ''}</span>
      <span style={{ color: 'var(--text-1)' }}>{text}</span>
    </div>
  );
  return (
    <div data-testid="last-time" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: compact ? '8px 10px' : '10px 12px', margin: '0 0 10px' }}>
      <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-3)', marginBottom: 2 }}>Last time</div>
      {lt.you ? row('you', lt.you.on, lt.you.via, lt.you.said) : null}
      {lt.them ? row('them', lt.them.on, lt.them.via, lt.them.said) : null}
      {lt.call ? row('call', lt.call.on, 'call', lt.call.about) : null}
    </div>
  );
}

export default function TransactLine({ t: given, lastTime: givenLT, contactId, compact = false }) {
  const [t, setT] = useState(given || null);
  const [lt, setLT] = useState(givenLT || null);
  useEffect(() => { if (given) setT(given); }, [given]);
  useEffect(() => { if (givenLT) setLT(givenLT); }, [givenLT]);
  useEffect(() => {
    if (given || !contactId) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-transact', { body: { contact_id: contactId } });
        if (alive && data && data.line) setT({ line: data.line, ask: data.ask, known: !!(data.facts && Object.keys(data.facts).length) });
        if (alive && data && data.last_time) setLT(data.last_time);
      } catch (_) { /* the rest of the screen stands without it */ }
    })();
    return () => { alive = false; };
  }, [contactId, given]);
  if ((!t || !t.line) && !lt) return null;
  if (!t || !t.line) return <LastTime lt={lt} compact={compact} />;
  const known = t.known !== false && !/^Nothing said yet/.test(t.line);
  return (
    <>
    <LastTime lt={lt} compact={compact} />
    <div data-testid="transact-line" style={{ border: '1px solid ' + (known ? 'rgba(123,196,127,.45)' : 'var(--border)'), borderRadius: 10,
      padding: compact ? '8px 10px' : '10px 12px', margin: '0 0 10px', background: known ? 'rgba(123,196,127,.07)' : 'transparent' }}>
      <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 800, color: known ? '#7BC47F' : 'var(--text-3)', marginBottom: 4 }}>
        Can they transact
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: known ? 'var(--text-1)' : 'var(--text-2)' }}>{t.line}</div>
      {t.ask ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>Ask: </span>{t.ask}
        </div>
      ) : null}
    </div>
    </>
  );
}
