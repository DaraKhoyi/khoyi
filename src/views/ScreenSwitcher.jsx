// ── ScreenSwitcher ───────────────────────────────────────────────────────────
// ALT-TAB for PrismOS. Long-press the tuning fork to open it; double-tap flips
// straight to the previous screen without opening anything.
//
// THE DESIGN POINT, and the reason this is worth building at all: a list reading
// "Inbox · Contacts · Prospecting · Finance" is nearly useless, because you
// already know what you opened. What you do NOT know is what you are in the
// middle of. So each row shows the WORK IN PROGRESS —
//
//     Inbox         draft to Marcus, unsent
//     Prospecting   6 of 12 calls done
//     Finance       expense half-entered
//
// which turns a tab bar into a work-in-progress board and answers the real
// question: what am I in the middle of? Rows with unsaved work are marked and
// are never evicted by the registry.
//
// Lives in its own file: App.js gets a one-line import.
import React, { useEffect } from 'react';
import { openScreens, closeScreen, OPEN_SCREEN_CAP } from '../openScreens';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';

export default function ScreenSwitcher({ userId, currentView, currentSub, onPick, onClose }) {
  const rows = openScreens(userId, currentView, currentSub);

  // Android back should dismiss the switcher, not navigate away underneath it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(8,6,4,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)', maxHeight: '62vh', overflowY: 'auto',
          background: '#1B1610', border: '1px solid rgba(203,169,94,0.28)',
          borderRadius: 18, padding: '16px 16px 12px',
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase',
          letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD, marginBottom: 2 }}>
          Open
        </div>
        <div style={{ fontFamily: "'Fraunces',Georgia,serif", fontWeight: 300, fontSize: 22,
          color: '#F6F1E7', marginBottom: 12 }}>
          What you&rsquo;re in the middle of.
        </div>

        {rows.length === 0 ? (
          <div style={{ fontSize: 13.5, color: '#8C8475', lineHeight: 1.6, padding: '6px 0 14px' }}>
            Nothing else is open yet. As you move between screens they collect here —
            up to {OPEN_SCREEN_CAP} at a time, and anything with unsaved work stays
            until you deal with it.
          </div>
        ) : rows.map((s) => (
          <div
            key={s.key}
            onClick={() => onPick(s)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              padding: '11px 12px', marginBottom: 8, borderRadius: 12,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid ' + (s.dirty ? 'rgba(203,169,94,0.5)' : 'rgba(255,255,255,0.07)'),
            }}
          >
            <span style={{ flex: '1 1 0', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: '#F6F1E7',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.label || s.view}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, marginTop: 2,
                color: s.dirty ? CHAMP : '#8C8475' }}>
                {s.note || 'where you left it'}
              </span>
            </span>
            {s.dirty && (
              <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em',
                color: CHAMP, border: '1px solid rgba(203,169,94,0.5)', borderRadius: 20,
                padding: '2px 8px', textTransform: 'uppercase' }}>
                unsaved
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); closeScreen(userId, s.view, s.sub); onPick(null); }}
              aria-label={'Close ' + (s.label || s.view)}
              style={{ flex: 'none', background: 'transparent', border: 'none', color: '#8C8475',
                fontSize: 20, lineHeight: 1, padding: '2px 6px', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>
        ))}

        <div style={{ fontSize: 11.5, color: '#8C8475', lineHeight: 1.55, marginTop: 6 }}>
          Double-tap the tuning fork to flip straight back to the last screen.
        </div>
      </div>
    </div>
  );
}
