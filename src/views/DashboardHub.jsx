import React, { useMemo } from 'react';
import { MODES } from '../modes';

// ── DashboardHub ─────────────────────────────────────────────────────────────
// The front door. NOT a launcher — a briefing. It reads the state of the
// business and shows, at a glance: the ONE next best action (the hero), a row of
// vital signs that are either calm or lit, and the mindset rooms — which reorder
// and glow by time of day and what needs attention. The agent shouldn't study
// this screen; they should scan for what's lit and tap it.

const GOLD = '#CBA35C', CREAM = '#F6F1E7', EMBER = '#C9563F', GREEN = '#6FbF8f';
const glyphs = {
  sun:  <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></>,
  people:<><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.5"/><path d="M15 15c3 0 6 1.5 6 5"/></>,
  target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>,
  flow: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><path d="M7 6h6a4 4 0 010 0M7 6h8M7 18h8M17 12H9"/></>,
  coin: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  building:<><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>,
};

const ModeGlyph = ({ name, color }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {glyphs[name] || glyphs.sun}
  </svg>
);

export default function DashboardHub({
  agentName, hour, isAdmin, hero, vitals = [], modeState = {}, onEnterMode, onHero,
}) {
  // ── adaptive ordering: the room that matters right now floats up and glows ──
  const ordered = useMemo(() => {
    const list = MODES.filter((m) => !m.adminOnly || isAdmin);
    const weight = (m) => {
      const st = modeState[m.id] || {};
      if (st.urgent) return 100 + (st.urgentCount || 1);      // a red thing in this room
      // time-of-day nudge: mornings favour Plan, work hours favour Prospect/Deals
      if (m.id === 'plan' && hour < 11) return 60;
      if (m.id === 'prospect' && hour >= 9 && hour < 15) return 40;
      if (m.id === 'deals' && hour >= 10 && hour < 18) return 38;
      if (m.id === 'money' && hour >= 15) return 30;
      return 10;
    };
    return [...list].sort((a, b) => weight(b) - weight(a));
  }, [isAdmin, hour, modeState]);

  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 2px 90px' }}>
      {/* greeting */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>
          {greeting}{agentName ? ',' : ''}
        </div>
        {agentName && (
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, color: CREAM, fontWeight: 300, lineHeight: 1.1 }}>
            {agentName}
          </div>
        )}
      </div>

      {/* THE HERO — the single next best action */}
      {hero && (
        <button onClick={onHero}
          style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 18,
            background: 'linear-gradient(135deg, rgba(203,163,92,0.16), rgba(203,163,92,0.05))',
            border: '1px solid rgba(203,163,92,0.5)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: GOLD, fontWeight: 800, marginBottom: 6 }}>
            Do this next
          </div>
          <div style={{ fontSize: 17, color: CREAM, fontWeight: 600, lineHeight: 1.35 }}>{hero.title}</div>
          {hero.why && <div style={{ fontSize: 12.5, color: 'rgba(246,241,231,0.6)', marginTop: 5 }}>{hero.why}</div>}
          <div style={{ marginTop: 11, display: 'inline-block', background: GOLD, color: '#1a1409',
            borderRadius: 100, padding: '7px 16px', fontSize: 13, fontWeight: 800 }}>
            {hero.cta || 'Go'}
          </div>
        </button>
      )}

      {/* VITAL SIGNS — calm or lit; tapping a lit one goes to the fix */}
      {vitals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9, marginBottom: 20 }}>
          {vitals.map((v) => (
            <button key={v.id} onClick={v.onClick}
              style={{ textAlign: 'left', cursor: v.onClick ? 'pointer' : 'default',
                background: v.lit ? 'rgba(201,86,63,0.10)' : 'var(--bg-card, #1B1610)',
                border: '1px solid ' + (v.lit ? 'rgba(201,86,63,0.5)' : 'var(--border, #2a2118)'),
                borderRadius: 13, padding: '12px 13px' }}>
              <div style={{ fontSize: 22, fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400,
                color: v.lit ? EMBER : (v.good ? GREEN : CREAM), lineHeight: 1 }}>
                {v.value}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(246,241,231,0.55)', marginTop: 4 }}>{v.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* THE ROOMS — mindset modes, adaptive order + glow */}
      <div style={{ fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(246,241,231,0.4)', fontWeight: 700, marginBottom: 10 }}>
        Where are you working?
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 11 }}>
        {ordered.map((m) => {
          const st = modeState[m.id] || {};
          const lit = !!st.urgent;
          return (
            <button key={m.id} onClick={() => onEnterMode(m.id)}
              style={{ textAlign: 'left', cursor: 'pointer', position: 'relative',
                background: lit ? 'rgba(201,86,63,0.08)' : 'var(--bg-card, #1B1610)',
                border: '1px solid ' + (lit ? 'rgba(201,86,63,0.45)' : 'rgba(203,163,92,0.22)'),
                borderRadius: 15, padding: '15px 15px 16px', minHeight: 104,
                boxShadow: lit ? '0 0 0 1px rgba(201,86,63,0.25)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <ModeGlyph name={m.glyph} color={lit ? EMBER : m.accent} />
                {st.badge != null && st.badge > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: lit ? EMBER : m.accent,
                    background: lit ? 'rgba(201,86,63,0.18)' : 'rgba(203,163,92,0.14)',
                    borderRadius: 100, padding: '2px 8px', minWidth: 18, textAlign: 'center' }}>
                    {st.badge}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 19, color: CREAM, marginTop: 12, fontWeight: 400 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(246,241,231,0.5)', marginTop: 2 }}>
                {st.hint || m.tag}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
