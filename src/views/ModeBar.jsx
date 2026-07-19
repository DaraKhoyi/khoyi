import React from 'react';
import { modeById, VIEW_META } from '../modes';

// ── ModeBar ──────────────────────────────────────────────────────────────────
// The scoped bottom navigation. When you're in a room, this shows ONLY that
// room's 3–5 sections — never the whole 40-item stack. It's a bar, not a menu:
// thumb-reachable, one tap to move within the mindset you're already in. The
// mode's own name sits on the left as the "you are here" label; the current
// section is highlighted.

const GOLD = '#CBA35C', CREAM = '#F6F1E7';

const glyphs = {
  sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1 1M17 17l1 1M18 6l-1 1M7 17l-1 1"/></>,
  check: <path d="M4 12l5 5L20 6"/>,
  inbox: <><path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13V5h16v8"/></>,
  cal: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M9 3v4M15 3v4"/></>,
  star: <path d="M12 3l2.6 5.6L20 9.5l-4 4 1 6-5-3-5 3 1-6-4-4 5.4-.9z"/>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  phone: <path d="M5 4h4l2 5-3 2a12 12 0 006 6l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z"/>,
  book: <><path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M9 4v14"/></>,
  doc: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
  up: <path d="M4 18l6-6 4 3 6-8"/>,
  flow: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><path d="M7 6h10M7 18h10M17 12H8"/></>,
  coin: <><ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/></>,
  car: <><path d="M4 12l2-5h12l2 5"/><path d="M3 12h18v5H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/></>,
  building: <><rect x="6" y="3" width="12" height="18"/><path d="M10 7h1M13 7h1M10 11h1M13 11h1"/></>,
};

const Icon = ({ name, active }) => (
  <svg viewBox="0 0 24 24" width="21" height="21" fill="none"
    stroke={active ? GOLD : 'rgba(246,241,231,0.55)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {glyphs[name] || glyphs.star}
  </svg>
);

export default function ModeBar({ modeId, currentView, onNavigate, onHome, badges = {} }) {
  const mode = modeById(modeId);
  if (!mode) return null;

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: 'rgba(16,13,9,0.94)', backdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(203,163,92,0.28)', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'stretch' }}>
        {/* home / back-to-hub — the always-present escape */}
        <button onClick={onHome} aria-label="Dashboard"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, padding: '9px 4px 8px', minWidth: 52, background: 'none', border: 'none', cursor: 'pointer',
            borderRight: '1px solid rgba(203,163,92,0.18)' }}>
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round">
            <path d="M4 11l8-7 8 7M6 9v10h12V9"/>
          </svg>
          <span style={{ fontSize: 9.5, color: GOLD, fontWeight: 700 }}>Home</span>
        </button>

        {/* the mode's own sections — bar, not menu */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
          {mode.bar.map((v) => {
            const meta = VIEW_META[v] || { label: v, glyph: 'star' };
            const active = v === currentView;
            const badge = badges[v];
            return (
              <button key={v} onClick={() => onNavigate(v)}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 3, padding: '9px 6px 8px', flex: 1, minWidth: 0,
                  background: 'none', border: 'none', cursor: 'pointer' }}>
                <Icon name={meta.glyph} active={active} />
                <span style={{ fontSize: 10, fontWeight: active ? 800 : 600,
                  color: active ? GOLD : 'rgba(246,241,231,0.6)', whiteSpace: 'nowrap' }}>
                  {meta.label}
                </span>
                {badge > 0 && (
                  <span style={{ position: 'absolute', top: 4, right: '50%', marginRight: -18,
                    background: '#C9563F', color: '#fff', fontSize: 9, fontWeight: 800,
                    borderRadius: 100, padding: '1px 5px', minWidth: 15, textAlign: 'center' }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
                {active && <span style={{ position: 'absolute', bottom: 0, width: 22, height: 2.5, background: GOLD, borderRadius: 2 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
