// FirstOpen — one sentence saying what a screen produces, the first few times.
//
// FINDING #22. An agent opens the Correspondent, sees a seed field, and has no
// idea what the tool will give them. A feature screen with no output yet looks
// identical to a broken one, and the screens worth explaining are exactly the
// ones that take minutes to produce anything.
//
// THREE RULES, because an explainer that breaks any of them becomes a tour:
//   1. IT SELF-DISMISSES. Shown at most three times per screen, then gone
//      forever. Nobody should have to close the same sentence twice.
//   2. IT SAYS WHAT COMES OUT, not what the screen is called. "Researches a real
//      story and drafts a note to each person" beats "AI-powered newsletter".
//   3. IT NEVER BLOCKS. No overlay, no modal, no dimming — it sits at the top of
//      the screen and the agent can ignore it completely.
//
// Stored per screen in localStorage rather than the database: it is a display
// preference, it does not matter if it resets on a new device, and it must not
// cost a network round-trip on every screen open.
import React, { useState, useEffect } from 'react';

const KEY = 'prism.firstOpen.';
const LIMIT = 3;

export default function FirstOpen({ id, children }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!id) return;
    try {
      const seen = parseInt(localStorage.getItem(KEY + id) || '0', 10);
      if (seen < LIMIT) {
        setShow(true);
        localStorage.setItem(KEY + id, String(seen + 1));
      }
    } catch (_) { /* private browsing — just don't show it */ }
  }, [id]);

  if (!show) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      background: 'rgba(203,163,92,.10)', border: '1px solid rgba(203,163,92,.32)',
      borderRadius: 12, padding: '11px 13px', margin: '0 0 14px',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, flex: 1, minWidth: 0 }}>
        {children}
      </span>
      <button onClick={() => setShow(false)} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 17,
          lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
    </div>
  );
}
