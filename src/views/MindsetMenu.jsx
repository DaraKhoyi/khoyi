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
};

const G = { gold: '#CBA35C', champ: '#EBCB82', cream: '#F6F1E7', ember: '#C9563F' };

function Row({ glyph, accent, label, tag, badge, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
        padding: '14px 16px', border: 'none', cursor: 'pointer', borderRadius: 14,
        background: active ? 'rgba(203,163,92,0.12)' : 'transparent',
        transition: 'background .15s' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(203,163,92,0.06)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center',
        background: 'rgba(203,163,92,0.10)', border: '1px solid rgba(203,163,92,0.22)' }}>
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
  const rooms = MODES.filter(m => !m.adminOnly || isAdmin);
  return (
    <>
      {/* backdrop */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(3px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .22s ease' }} />
      {/* panel */}
      <nav aria-label="Menu"
        style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(86vw, 340px)', zIndex: 9001,
          background: 'radial-gradient(90% 40% at 20% 0%, rgba(203,163,92,0.08), transparent 60%), #100D09',
          borderRight: '1px solid rgba(203,163,92,0.22)', boxShadow: '18px 0 50px rgba(0,0,0,0.5)',
          transform: open ? 'translateX(0)' : 'translateX(-102%)', transition: 'transform .26s cubic-bezier(.4,0,.2,1)',
          display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* header — vibrating tuning fork on the left, everything else
            right-justified: "Where to," (small) then the name (larger, gold
            sweep). Wraps to two lines when the name is too long to fit. */}
        <style>{`
          @keyframes mm-fork-shake { 0%,100%{ transform:rotate(0); } 25%{ transform:rotate(-2.2deg); } 75%{ transform:rotate(2.2deg); } }
          @keyframes mm-fork-wave  { 0%,100%{ opacity:.25; } 50%{ opacity:1; } }
          @keyframes mm-sweep      { to { background-position:200% center; } }
          .mm-fork      { animation: mm-fork-shake 0.28s ease-in-out infinite; transform-origin:50% 20%; }
          .mm-fork .w2  { animation: mm-fork-wave 0.9s ease-in-out infinite; }
          .mm-fork .w1  { animation: mm-fork-wave 0.9s ease-in-out infinite .15s; }
          .mm-name-sweep{ background:linear-gradient(90deg,#7A5020,#CBA35C,#F5E8B0,#CBA35C,#7A5020);
            background-size:200% auto; -webkit-background-clip:text; background-clip:text;
            -webkit-text-fill-color:transparent; animation: mm-sweep 6s linear infinite; }
        `}</style>
        <div style={{ padding: '20px 18px 15px', borderBottom: '1px solid rgba(203,163,92,0.14)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* vibrating tuning fork */}
          <svg className="mm-fork" width="30" height="34" viewBox="0 0 40 40" fill="none" style={{ flex: 'none' }} aria-hidden="true">
            <g className="w2" stroke="#EBCB82" strokeWidth="1.2" strokeLinecap="round"><path d="M31 8 Q37 17 31 26"/><path d="M9 8 Q3 17 9 26"/></g>
            <g className="w1" stroke="#EBCB82" strokeWidth="1.3" strokeLinecap="round"><path d="M28 11 Q32 17 28 23"/><path d="M12 11 Q8 17 12 23"/></g>
            <g stroke="#CBA35C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6 V21"/><path d="M25 6 V21"/><path d="M15 21 C15 26 17 28 20 28 C23 28 25 26 25 21"/><path d="M20 28 V36"/></g>
            <circle cx="20" cy="37.4" r="1.9" fill="#CBA35C"/>
          </svg>
          {/* right-justified greeting; wraps to two lines if the name is long */}
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right', lineHeight: 1.12 }}>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase',
              letterSpacing: '.16em', fontSize: 11, fontWeight: 600, color: G.gold }}>Where to,</span>
            {' '}
            <span className="mm-name-sweep" style={{ fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 23, fontWeight: 400, letterSpacing: '-.01em' }}>{userName || 'there'}</span>
          </div>
        </div>
        <div style={{ padding: '10px 10px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Row glyph="home" accent={G.champ} label="Dashboard" tag="Your briefing"
            active={currentView === 'dashboard'} onClick={() => { onHome(); onClose(); }} />
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
