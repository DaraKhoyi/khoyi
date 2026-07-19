import React, { useMemo } from 'react';
import { MODES } from '../modes';

// ── DashboardHub ─────────────────────────────────────────────────────────────
// The front door, rebuilt in the visual language of "The Edge": a near-black
// canvas lit by radial gold glows, animated gold-gradient headlines, Fraunces
// display serif for drama, Barlow Condensed for structural eyebrows, and warm
// gold shadows. Fills the screen on a laptop and collapses on a phone. Still a
// briefing, not a launcher — but one that now looks like it means business.

const glyphs = {
  sun:  <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></>,
  people:<><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.5"/><path d="M15 15c3 0 6 1.5 6 5"/></>,
  target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>,
  flow: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><path d="M7 6h8M7 18h8M17 12H9"/></>,
  coin: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  building:<><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>,
};
const ModeGlyph = ({ name, color, size = 30 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {glyphs[name] || glyphs.sun}
  </svg>
);

const G = { g1:'#3D2600', g2:'#7A5020', g3:'#C5A95E', g4:'#E2C97E', g5:'#F5E8B0', g6:'#FFF8DC',
  black:'#060608', cream:'#FBF7EF', ember:'#C9563F' };

const CSS = `
@keyframes ph-goldSweep { to { background-position: 200% center; } }
@keyframes ph-fadeUp { from { opacity:0; transform:translateY(14px);} to { opacity:1; transform:none;} }
.ph-goldtext {
  background:linear-gradient(90deg,${G.g2},${G.g3},${G.g5},${G.g3},${G.g2});
  background-size:200% auto; -webkit-background-clip:text; background-clip:text;
  -webkit-text-fill-color:transparent; animation:ph-goldSweep 6s linear infinite;
}
.ph-eyebrow { font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; font-weight:600; }
.ph-display { font-family:'Fraunces',Georgia,serif; }
.ph-rise { animation:ph-fadeUp .5s ease both; }
.ph-hero {
  background:
    radial-gradient(ellipse 60% 90% at 85% 15%, rgba(197,169,94,.14), transparent 70%),
    linear-gradient(135deg, rgba(197,169,94,.13), rgba(197,169,94,.03));
  border:1px solid rgba(197,169,94,.45);
  box-shadow:0 18px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(197,169,94,.08) inset;
}
.ph-hero-cta { box-shadow:0 8px 28px rgba(197,169,94,.35); transition:transform .15s, box-shadow .15s; }
.ph-hero-cta:hover { transform:translateY(-1px); box-shadow:0 12px 34px rgba(197,169,94,.5); }
.ph-tile { transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.ph-tile:hover { transform:translateY(-3px); box-shadow:0 16px 40px rgba(0,0,0,.5), 0 0 0 1px rgba(197,169,94,.35); }
.ph-tile-lit:hover { box-shadow:0 16px 40px rgba(201,86,63,.28), 0 0 0 1px rgba(201,86,63,.5); }
.ph-vital { transition:transform .15s ease; }
.ph-vital:hover { transform:translateY(-2px); }
`;

export default function DashboardHub({
  agentName, hour, isAdmin, hero, vitals = [], modeState = {}, onEnterMode, onHero,
}) {
  const ordered = useMemo(() => {
    const list = MODES.filter((m) => !m.adminOnly || isAdmin);
    const weight = (m) => {
      const st = modeState[m.id] || {};
      if (st.urgent) return 100 + (st.urgentCount || 1);
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
    <div style={{
      minHeight: '100%', margin: '-16px',
      background: `
        radial-gradient(ellipse 70% 50% at 75% 8%, rgba(197,169,94,.08), transparent 65%),
        radial-gradient(ellipse 55% 45% at 12% 88%, rgba(197,169,94,.045), transparent 60%),
        ${G.black}`,
    }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '30px clamp(16px, 4vw, 44px) 100px' }}>

        <div className="ph-rise" style={{ marginBottom: 'clamp(20px, 3vw, 34px)' }}>
          <div className="ph-eyebrow" style={{ fontSize: 'clamp(12px,1.4vw,15px)', letterSpacing: '.28em', color: G.g3 }}>
            {greeting}
          </div>
          {agentName && (
            <div className="ph-display" style={{ fontSize: 'clamp(40px, 6.5vw, 74px)', fontWeight: 400, lineHeight: 1, letterSpacing: '-.01em', marginTop: 2 }}>
              <span className="ph-goldtext">{agentName}</span>
            </div>
          )}
        </div>

        {hero && (
          <button onClick={onHero} className="ph-hero ph-rise"
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block',
              borderRadius: 20, padding: 'clamp(20px,3vw,32px)', marginBottom: 'clamp(18px,2.5vw,28px)', animationDelay: '.05s' }}>
            <div className="ph-eyebrow" style={{ fontSize: 13, letterSpacing: '.26em', color: G.g4, marginBottom: 10 }}>
              Do this next
            </div>
            <div className="ph-display" style={{ fontSize: 'clamp(22px,3.2vw,38px)', color: G.cream, fontWeight: 400, lineHeight: 1.15, letterSpacing: '-.01em' }}>
              {hero.title}
            </div>
            {hero.why && <div style={{ fontSize: 'clamp(13px,1.4vw,16px)', color: 'rgba(251,247,239,0.6)', marginTop: 10, fontFamily: 'Manrope, sans-serif' }}>{hero.why}</div>}
            <div className="ph-hero-cta" style={{ marginTop: 18, display: 'inline-block',
              background: `linear-gradient(135deg,${G.g4},${G.g3})`, color: '#231a08',
              borderRadius: 100, padding: '11px 26px', fontSize: 15, fontWeight: 800,
              fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {hero.cta || 'Go'}
            </div>
          </button>
        )}

        {vitals.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'clamp(9px,1.2vw,14px)', marginBottom: 'clamp(24px,3.5vw,40px)' }}>
            {vitals.map((v, i) => (
              <button key={v.id} onClick={v.onClick} className="ph-vital ph-rise"
                style={{ textAlign: 'left', cursor: v.onClick ? 'pointer' : 'default', animationDelay: `${.08 + i * .04}s`,
                  background: v.lit ? 'rgba(201,86,63,0.09)' : 'rgba(255,255,255,0.025)',
                  border: '1px solid ' + (v.lit ? 'rgba(201,86,63,0.5)' : 'rgba(197,169,94,0.16)'),
                  borderRadius: 16, padding: 'clamp(14px,1.8vw,20px)' }}>
                <div className="ph-display" style={{ fontSize: 'clamp(30px,3.6vw,46px)', fontWeight: 400,
                  color: v.lit ? G.ember : (v.good ? '#7Fb894' : G.cream), lineHeight: .9 }}>
                  {v.value}
                </div>
                <div className="ph-eyebrow" style={{ fontSize: 'clamp(11px,1.1vw,13px)', letterSpacing: '.14em', color: 'rgba(251,247,239,0.5)', marginTop: 8 }}>
                  {v.label}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="ph-eyebrow" style={{ fontSize: 'clamp(12px,1.3vw,14px)', letterSpacing: '.24em', color: 'rgba(251,247,239,0.42)', marginBottom: 14 }}>
          Where are you working
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 'clamp(12px,1.5vw,18px)' }}>
          {ordered.map((m, i) => {
            const st = modeState[m.id] || {};
            const lit = !!st.urgent;
            return (
              <button key={m.id} onClick={() => onEnterMode(m.id)}
                className={`ph-tile ph-rise ${lit ? 'ph-tile-lit' : ''}`}
                style={{ textAlign: 'left', cursor: 'pointer', position: 'relative', overflow: 'hidden', animationDelay: `${.12 + i * .05}s`,
                  background: lit
                    ? 'radial-gradient(ellipse 90% 100% at 90% 0%, rgba(201,86,63,.12), transparent 60%), rgba(20,14,11,0.7)'
                    : 'radial-gradient(ellipse 90% 100% at 90% 0%, rgba(197,169,94,.07), transparent 60%), rgba(255,255,255,0.02)',
                  border: '1px solid ' + (lit ? 'rgba(201,86,63,0.45)' : 'rgba(197,169,94,0.2)'),
                  borderRadius: 18, padding: 'clamp(18px,2vw,24px)', minHeight: 132 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: lit ? `linear-gradient(90deg, transparent, ${G.ember}, transparent)`
                    : `linear-gradient(90deg, transparent, ${m.accent}88, transparent)` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <ModeGlyph name={m.glyph} color={lit ? G.ember : m.accent} />
                  {st.badge != null && st.badge > 0 && (
                    <span className="ph-eyebrow" style={{ fontSize: 13, fontWeight: 700,
                      color: lit ? G.ember : m.accent,
                      background: lit ? 'rgba(201,86,63,0.16)' : 'rgba(197,169,94,0.12)',
                      borderRadius: 100, padding: '3px 11px', minWidth: 20, textAlign: 'center', letterSpacing: '.05em' }}>
                      {st.badge}
                    </span>
                  )}
                </div>
                <div className="ph-display" style={{ fontSize: 'clamp(22px,2.4vw,28px)', color: G.cream, marginTop: 16, fontWeight: 400, letterSpacing: '-.01em' }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 'clamp(12px,1.3vw,14px)', color: lit ? 'rgba(233,150,120,0.85)' : 'rgba(251,247,239,0.5)', marginTop: 3, fontFamily: 'Manrope, sans-serif' }}>
                  {st.hint || m.tag}
                </div>
              </button>
            );
          })}
        </div>

        <div className="ph-eyebrow" style={{ textAlign: 'center', marginTop: 'clamp(30px,4vw,52px)',
          fontSize: 'clamp(11px,1.2vw,13px)', letterSpacing: '.3em', color: 'rgba(197,169,94,0.4)' }}>
          Same market · <span className="ph-goldtext">Smarter agent</span>
        </div>
      </div>
    </div>
  );
}
