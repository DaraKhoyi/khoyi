// GestureHint — tells you the flip gesture exists, once, at the right moment.
//
// FINDING #26. Double-tap the fork to flip back, two-finger tap anywhere to do
// the same, long-press for the switcher. None of it is discoverable: gestures
// have no affordance by definition, so the feature built to fix the worst
// navigation complaint goes unused.
//
// TIMING IS THE WHOLE DESIGN. It appears after the agent has visited three
// distinct screens in one session — the moment flipping back would actually have
// saved them something. Shown before that it is noise; shown never it is a
// feature nobody has.
//
// Once. Ever. Dismisses itself after eight seconds if ignored.
import React, { useState, useEffect } from 'react';

const KEY = 'prism.gestureHint.shown';

export default function GestureHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch (_) { return; }
    let seen = new Set();
    const check = () => {
      seen.add(window.location.hash + '|' + document.title);
      if (seen.size >= 3) {
        try { localStorage.setItem(KEY, '1'); } catch (_) {}
        setShow(true);
        window.removeEventListener('prism:view', check);
      }
    };
    window.addEventListener('prism:view', check);
    const t = setInterval(check, 4000);
    return () => { window.removeEventListener('prism:view', check); clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 8000);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  return (
    <div onClick={() => setShow(false)} style={{
      position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)',
      zIndex: 9200, background: '#1B1610', border: '1px solid rgba(203,163,92,.45)',
      borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
      boxShadow: '0 10px 30px rgba(0,0,0,.5)', maxWidth: 460, margin: '0 auto',
    }}>
      <div style={{ fontSize: 13.5, color: '#F6F1E7', lineHeight: 1.55 }}>
        <strong style={{ color: '#EBCB82' }}>Tip —</strong> double-tap the tuning fork to flip
        straight back to the screen you were just on. Hold it to see everything you have open.
      </div>
    </div>
  );
}
