import React, { useRef, useEffect } from 'react';
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
  library: <><path d="M4 5h4v14H4zM10 5h4v14h-4z"/><path d="M16 5l3.5 1-3 13L16 18z"/></>,
  search: <><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></>,
  upload: <><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 19h14"/></>,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>,
};

// One room, one colour.
//
// The Rooms menu earns its coherence by giving each room a single accent and
// using it three ways — the tinted chip behind the glyph, the hairline, the
// badge. The bar did none of that: six flat grey glyphs and gold-when-active,
// which is a different product one tap inside the room.
//
// Every glyph here now wears the ROOM's accent, not six colours of its own.
// Six bright tabs would be louder than the tiles and would break the rule that
// makes them work — a colour has to mean one thing. Inside the Nerve Center,
// sage means Nerve Center, and the whole bar says so at a glance. Intensity,
// not hue, carries which section you are on.
const Icon = ({ name, active, accent }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke={active ? accent : accent + 'A6'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {glyphs[name] || glyphs.star}
  </svg>
);

// The chip from the Rooms drawer, sized for a bar. 40px there, 32 here — six of
// them have to sit on a phone beside their labels.
const Chip = ({ children, active, accent }) => (
  <span className={active ? 'mb-chip mb-chip-lit' : 'mb-chip'}
    style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
      background: active ? accent + '24' : 'transparent',
      border: '1px solid ' + (active ? accent + '59' : 'transparent'),
      // The glow. A tinted square says "selected"; a square that throws light
      // says "you are here" from across the room, which is what a bar you use
      // one-handed at a glance actually needs.
      boxShadow: active ? '0 0 0 3px ' + accent + '14, 0 4px 18px -4px ' + accent + '80' : 'none',
      transition: 'background .18s, border-color .18s, box-shadow .18s' }}>
    {children}
  </span>
);

export default function ModeBar({ modeId, currentView, currentSub, onNavigate, onHome, badges = {} }) {
  const barRef = useRef(null);
  // Publish the bar's true rendered height (padding + icon + label + safe-area)
  // as --modebar-h so screens can reserve exactly the right space instead of a
  // hardcoded guess that drifts on notched phones.
  useEffect(() => {
    const set = () => {
      const h = barRef.current ? barRef.current.offsetHeight : 0;
      document.documentElement.style.setProperty('--modebar-h', h + 'px');
    };
    set();
    window.addEventListener('resize', set);
    return () => { window.removeEventListener('resize', set); document.documentElement.style.setProperty('--modebar-h', '0px'); };
  });

  // The room's colour, published to CSS so the six pages inside the room can
  // wear it too. Without this the bar was the only thing that knew which room
  // you were in, and every page header stayed gold — the seam the whole
  // exercise is meant to remove.
  useEffect(() => {
    const m = modeById(modeId);
    const root = document.documentElement;
    if (m && m.accent) {
      root.style.setProperty('--room-accent', m.accent);
      root.style.setProperty('--room-accent-16', m.accent + '29');
      root.style.setProperty('--room-accent-30', m.accent + '4D');
      // Two more steps the page needs. 70% is the floor at which an 11px label
      // in a mid-tone accent stays readable on near-black in daylight; 22% is
      // enough for a border to register as the room's without becoming a box.
      root.style.setProperty('--room-accent-70', m.accent + 'B3');
      root.style.setProperty('--room-accent-22', m.accent + '38');
    }
    return () => {
      root.style.removeProperty('--room-accent');
      root.style.removeProperty('--room-accent-16');
      root.style.removeProperty('--room-accent-30');
      root.style.removeProperty('--room-accent-70');
      root.style.removeProperty('--room-accent-22');
    };
  }, [modeId]);

  const mode = modeById(modeId);
  if (!mode) return null;
  const accent = mode.accent || GOLD;

  return (
    <div ref={barRef} style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: 'rgba(16,13,9,0.94)', backdropFilter: 'blur(12px)',
      borderTop: '1px solid ' + accent + '3D', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* The same 2px gradient hairline the room tiles wear, fading at both
          ends. It is the thread that ties the bar to the tile you tapped. */}
      <div className="room-hairline" style={{ height: 2,
        background: 'linear-gradient(90deg, transparent, ' + accent + '00 12%, ' + accent + 'CC 50%, ' + accent + '00 88%, transparent)',
        backgroundSize: '220% 100%' }} />
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'stretch' }}>
        {/* Home removed from the bar (Dara): the sections ARE the bar. The escape
            back to the hub/rooms still lives in the top nav (logo → menu, and the
            Rooms button), so no one is stranded. */}

        {/* the mode's own sections — bar, not menu. A bar item is either a plain
            view id (string) or an object {view, sub, label, glyph} that deep-links
            into a screen's sub-tab (e.g. Prospect > Systems -> the lead-gen library). */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
          {mode.bar.map((item) => {
            const v = typeof item === 'string' ? item : item.view;
            const sub = typeof item === 'string' ? null : (item.sub || null);
            const meta = VIEW_META[v] || { label: v, glyph: 'star' };
            const label = (typeof item === 'object' && item.label) || meta.label;
            const glyph = (typeof item === 'object' && item.glyph) || meta.glyph;
            const key = sub ? `${v}:${sub}` : v;
            // active when we're on this view AND (no sub required, or the sub matches)
            const active = v === currentView && (!sub || sub === currentSub);
            // A badge is either a number, or { n, urgent } when the caller means
            // "this one actually needs you". Plain numbers stay quiet.
            const raw = badges[v];
            const n = typeof raw === 'object' && raw ? (raw.n || 0) : (raw || 0);
            const urgent = typeof raw === 'object' && raw ? !!raw.urgent : false;
            return (
              <button key={key} onClick={() => onNavigate(v, sub)}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 4, padding: '13px 6px 9px', flex: 1, minWidth: 0,
                  background: 'none', border: 'none', cursor: 'pointer' }}>
                <Chip active={active} accent={accent}>
                  <Icon name={glyph} active={active} accent={accent} />
                </Chip>
                <span style={{ fontSize: 10, fontWeight: active ? 800 : 600,
                  color: active ? accent : 'rgba(246,241,231,0.55)', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                {n > 0 && (
                  // EMBER IS NOT AN INVENTORY COLOUR. Three permanent red pills
                  // reading 39 / 99+ / 99+ spent the one colour that means "this
                  // needs you now" on counts that are simply how much mail exists.
                  // By the time something is genuinely urgent, red says nothing.
                  // Counts wear the room's accent; ember is kept for urgent.
                  // Clear of the chip. At -20 the pill sat ON the active chip's
                  // corner and the two borders muddled into each other.
                  <span style={{ position: 'absolute', top: 3, right: '50%', marginRight: -25,
                    background: urgent ? 'rgba(201,86,63,0.18)' : accent + '26',
                    border: '1px solid ' + (urgent ? 'rgba(201,86,63,0.55)' : accent + '4D'),
                    color: urgent ? '#E99678' : accent,
                    fontSize: 9, fontWeight: 800, borderRadius: 100, padding: '0 5px',
                    minWidth: 15, textAlign: 'center', lineHeight: '15px' }}>
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
