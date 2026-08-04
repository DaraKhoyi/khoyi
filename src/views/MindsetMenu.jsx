import React from 'react';
import { MODES } from '../modes';

// ── MindsetMenu ──────────────────────────────────────────────────────────────
// The menu that opens from the tuning fork. Not the old 40-item stack — a clean
// mindset list: Dashboard first, then the five rooms (Plan, Relationships,
// Prospect, Deals, Money), plus Brokerage for admins/team leaders. Tapping a
// room enters it; tapping Dashboard goes home.

const glyphs = {
  home: <path d="M4 11l8-7 8 7M6 9v11h12V9" />,
  sun:  <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/></>,
  people:<><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.5"/><path d="M15 15c3 0 6 1.5 6 5"/></>,
  target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>,
  flow: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><path d="M7 6h8M7 18h8M17 12H9"/></>,
  coin: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  building:<><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>,
  // Without this the Library room fell through to the default and wore a sun.
  library: <><path d="M4 5h4v14H4zM10 5h4v14h-4z"/><path d="M16 5l3.5 1-3 13L16 18z"/></>,
};

const PINNED = ['relationships', 'prospect'];

const G = { gold: '#CBA35C', champ: '#EBCB82', cream: '#F6F1E7', ember: '#C9563F' };

function Row({ glyph, accent, label, tag, badge, active, onClick }) {
  return (
    <button onClick={onClick} className="mm-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
        padding: '14px 16px', border: 'none', cursor: 'pointer', borderRadius: 14,
        background: active ? 'rgba(203,163,92,0.12)' : 'transparent',
        transition: 'background .15s' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(203,163,92,0.06)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span className="mm-glyph" style={{ flex: 'none', width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center',
        background: 'rgba(203,163,92,0.10)', border: '1px solid rgba(203,163,92,0.22)', color: accent || G.gold }}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke={accent || G.gold}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{glyphs[glyph] || glyphs.sun}</svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'Fraunces, Georgia, serif', fontSize: 19, color: G.cream, fontWeight: 400, lineHeight: 1.1 }}>
          {label}
        </span>
        {tag && <span style={{ display: 'block', fontSize: 12, color: 'rgba(246,241,231,0.5)', marginTop: 2 }}>{tag}</span>}
      </span>
      {badge > 0 && (
        <span style={{ flex: 'none', fontSize: 12, fontWeight: 800, color: G.ember,
          background: 'rgba(201,86,63,0.16)', borderRadius: 100, padding: '2px 9px', minWidth: 22, textAlign: 'center' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export default function MindsetMenu({ open, onClose, currentView, activeMode, isAdmin, onHome, onEnterMode, modeBadges = {}, userName, userEmail, onSignOut }) {
  // A fixed spine, then the clock. Today sits above; Relationships and Prospect
  // are pinned directly under it, in that order, because they are the two rooms
  // an agent lives in every single day — a menu whose top entries move with the
  // hour is a menu you have to read instead of aim at. Everything below them
  // still floats: anything urgent first, then the room that suits the hour.
  const rooms = React.useMemo(() => {
    const hour = new Date().getHours();
    const list = MODES.filter(m => !m.adminOnly || isAdmin);
    const pinned = PINNED.map(id => list.find(m => m.id === id)).filter(Boolean);
    const rest = list.filter(m => !PINNED.includes(m.id));
    const weight = (m) => {
      const b = modeBadges[m.id] || 0;
      if (b > 0) return 100 + Math.min(b, 99);
      if (m.id === 'plan' && hour < 11) return 60;
      if (m.id === 'deals' && hour >= 10 && hour < 18) return 38;
      if (m.id === 'money' && hour >= 15) return 30;
      return 10;
    };
    return [...pinned, ...rest.sort((a, b) => weight(b) - weight(a))];
  }, [isAdmin, modeBadges]);
  return (
    <>
      {/* backdrop */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(3px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .22s ease' }} />
      {/* panel */}
      <nav aria-label="Menu" className="mm-panel"
        style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(86vw, 340px)', zIndex: 9001,
          background: `
            radial-gradient(ellipse 70% 34% at 78% 6%, rgba(203,163,92,0.13), transparent 62%),
            radial-gradient(ellipse 60% 40% at 15% 92%, rgba(203,163,92,0.07), transparent 60%),
            radial-gradient(90% 40% at 20% 0%, rgba(203,163,92,0.05), transparent 60%),
            #100D09`,
          borderRight: '1px solid rgba(203,163,92,0.22)', boxShadow: '18px 0 50px rgba(0,0,0,0.5)',
          transform: open ? 'translateX(0)' : 'translateX(-102%)', transition: 'transform .26s cubic-bezier(.4,0,.2,1)',
          display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
        {/* a soft breathing gold glow overlay — the "lit from within" feel the
            dashboard has, gently pulsing so the menu feels alive when it opens */}
        <style>{`
          /* ── Today hero: shimmer sweep + pulsing star ───────────────────── */
          .mm-today { transition: transform .18s ease, box-shadow .25s ease, border-color .25s ease; }
          .mm-today:hover, .mm-today:focus-visible { transform: translateY(-2px);
            box-shadow: 0 10px 34px rgba(203,163,92,.28), 0 0 0 1px rgba(235,203,130,.5) inset;
            border-color: rgba(235,203,130,.9); }
          .mm-today:active { transform: translateY(0) scale(.99); }
          .mm-shimmer { position:absolute; top:0; bottom:0; left:-60%; width:45%;
            background: linear-gradient(105deg, transparent, rgba(255,240,200,.16), transparent);
            transform: skewX(-18deg); animation: mm-sweep 4.2s ease-in-out infinite; pointer-events:none; }
          @keyframes mm-sweep { 0% { left:-60%; } 55% { left:120%; } 100% { left:120%; } }
          .mm-star { animation: mm-twinkle 2.6s ease-in-out infinite; display:inline-block; }
          @keyframes mm-twinkle {
            0%,100% { opacity:.85; transform: scale(1) rotate(0deg); }
            50%     { opacity:1;   transform: scale(1.18) rotate(12deg); }
          }
          /* ── Room rows: lift + gold edge on touch ─────────────────────────── */
          .mm-row { transition: transform .16s ease, background .2s ease, box-shadow .2s ease; }
          .mm-row:hover { transform: translateX(3px); background: rgba(203,163,92,.07);
            box-shadow: inset 2px 0 0 rgba(235,203,130,.75); }
          .mm-row:active { transform: translateX(1px) scale(.995); }
          .mm-row:hover .mm-glyph { filter: drop-shadow(0 0 7px currentColor); transform: scale(1.08); }
          .mm-glyph { transition: transform .18s ease, filter .18s ease; }
          @media (prefers-reduced-motion: reduce) {
            .mm-shimmer, .mm-star { animation: none; }
            .mm-today:hover, .mm-row:hover { transform: none; }
          }
          @keyframes mm-breathe { 0%,100%{ opacity:.5; transform:translate(0,0) scale(1); } 50%{ opacity:.9; transform:translate(6px,-4px) scale(1.06); } }
        `}</style>
        <div aria-hidden="true" style={{ position: 'absolute', top: -60, right: -40, width: 240, height: 240,
          borderRadius: '50%', pointerEvents: 'none', filter: 'blur(8px)',
          background: 'radial-gradient(circle, rgba(235,203,130,0.16), transparent 68%)',
          animation: 'mm-breathe 7s ease-in-out infinite' }} />
        {/* header — tuning fork vibrating from its stationary bottom tip, and a
            right-justified greeting: "Where to," (off-white) then the name
            (gold sweep), then the tagline. Wraps to two lines for long names. */}
        <style>{`
          @keyframes mm-fork-swing { 0%,100%{ transform:rotate(-2.4deg); } 50%{ transform:rotate(2.4deg); } }
          @keyframes mm-fork-wave  { 0%,100%{ opacity:.25; } 50%{ opacity:1; } }
          @keyframes mm-sweep      { to { background-position:200% center; } }
          .mm-swing     { animation: mm-fork-swing 1.0s ease-in-out infinite; transform-origin:20px 39px; transform-box:fill-box; }
          .mm-fork .w2  { animation: mm-fork-wave 0.9s ease-in-out infinite; }
          .mm-fork .w1  { animation: mm-fork-wave 0.9s ease-in-out infinite .15s; }
          .mm-name-sweep{ background:linear-gradient(90deg,#7A5020,#CBA35C,#F5E8B0,#CBA35C,#7A5020);
            background-size:200% auto; -webkit-background-clip:text; background-clip:text;
            -webkit-text-fill-color:transparent; animation: mm-sweep 6s linear infinite; }
        `}</style>
        <div style={{ padding: '20px 18px 15px', borderBottom: '1px solid rgba(203,163,92,0.14)',
          display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          {/* tuning fork — the bottom tip stays locked; the top swings */}
          <svg className="mm-fork" width="39" height="44" viewBox="0 0 40 40" fill="none" style={{ flex: 'none', marginTop: -6 }} aria-hidden="true">
            <g className="mm-swing">
              <g className="w2" stroke="#EBCB82" strokeWidth="1.2" strokeLinecap="round"><path d="M31 8 Q37 17 31 26"/><path d="M9 8 Q3 17 9 26"/></g>
              <g className="w1" stroke="#EBCB82" strokeWidth="1.3" strokeLinecap="round"><path d="M28 11 Q32 17 28 23"/><path d="M12 11 Q8 17 12 23"/></g>
              <g stroke="#CBA35C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6 V21"/><path d="M25 6 V21"/><path d="M15 21 C15 26 17 28 20 28 C23 28 25 26 25 21"/><path d="M20 28 V36"/></g>
              <circle cx="20" cy="37.4" r="1.9" fill="#CBA35C"/>
            </g>
          </svg>
          {/* right-justified greeting; wraps to two lines if the name is long */}
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right', lineHeight: 1.14 }}>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase',
              letterSpacing: '.16em', fontSize: 11, fontWeight: 600, color: '#F3EEE4' }}>Where to,</span>
            {' '}
            <span className="mm-name-sweep" style={{ fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 23, fontWeight: 400, letterSpacing: '-.01em' }}>{userName || 'there'}</span>
            <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#F3EEE4', opacity: 0.72 }}>
              Pick the headspace you're in.
            </span>
          </div>
        </div>
        <div style={{ padding: '10px 10px 20px', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1 }}>
          {/* TODAY — the daily driver, given a signature glowing treatment */}
          <button onClick={() => { onEnterMode && onEnterMode('__today__'); onClose(); }}
            className="mm-today"
            style={{ position: 'relative', width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
              padding: '13px 14px', marginBottom: 8, borderRadius: 16, cursor: 'pointer', overflow: 'hidden',
              border: '1px solid rgba(203,163,92,0.55)',
              background: 'radial-gradient(120% 160% at 100% 0%, rgba(235,203,130,0.18), transparent 60%), linear-gradient(180deg,#241C12,#150F0A)' }}>
            <span aria-hidden="true" className="mm-shimmer" />
            <span className="mm-star" style={{ fontSize: 17, color: '#EBCB82', flexShrink: 0, filter: 'drop-shadow(0 0 6px rgba(235,203,130,.55))' }}>✦</span>
            <span style={{ minWidth: 0, flex: 1, position: 'relative' }}>
              <span style={{ display: 'block', fontFamily: 'Fraunces, serif', fontSize: 17, color: '#F6F1E7', letterSpacing: '-0.01em' }}>Today</span>
              <span style={{ display: 'block', fontSize: 11.5, color: '#C8BFAE' }}>What to do next</span>
            </span>
          </button>

          <div style={{ height: 1, background: 'rgba(203,163,92,0.12)', margin: '6px 12px' }} />
          {rooms.map(m => (
            <Row key={m.id} glyph={m.glyph} accent={m.accent} label={m.label} tag={m.tag}
              badge={modeBadges[m.id]} active={activeMode === m.id}
              onClick={() => { onEnterMode(m.id); onClose(); }} />
          ))}
        </div>

        {/* user + sign out, pinned to the bottom */}
        <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid rgba(203,163,92,0.14)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 100, display: 'grid', placeItems: 'center',
            background: 'rgba(203,163,92,0.14)', color: G.gold, fontWeight: 800, fontSize: 14 }}>
            {(userName || userEmail || '').slice(0, 2).toUpperCase()}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, color: G.cream, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(246,241,231,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userEmail}</span>
          </span>
          <button onClick={onSignOut} title="Sign out" aria-label="Sign out"
            style={{ flex: 'none', background: 'none', border: '1px solid rgba(203,163,92,0.3)', borderRadius: 10,
              width: 34, height: 34, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={G.gold} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
          </button>
        </div>
      </nav>
    </>
  );
}
