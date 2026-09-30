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

export default function TransactLine({ t: given, contactId, compact = false }) {
  const [t, setT] = useState(given || null);
  useEffect(() => { if (given) setT(given); }, [given]);
  useEffect(() => {
    if (given || !contactId) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-transact', { body: { contact_id: contactId } });
        if (alive && data && data.line) setT({ line: data.line, ask: data.ask, known: !!(data.facts && Object.keys(data.facts).length) });
      } catch (_) { /* the rest of the screen stands without it */ }
    })();
    return () => { alive = false; };
  }, [contactId, given]);
  if (!t || !t.line) return null;
  const known = t.known !== false && !/^Nothing said yet/.test(t.line);
  return (
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
  );
}
