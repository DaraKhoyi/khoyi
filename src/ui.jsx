// ── Prism UI kit ─────────────────────────────────────────────────────────────
// Report finding #3 (styling copy-pasted) + #1 (everything hand-rolled inline).
// A small set of shared primitives so screens stop re-declaring the same button,
// card, chip, and stat by hand. New views use these; old ones migrate over. Built
// on the theme tokens so a brand change flows through automatically.

import React from 'react';
import { COLORS, FONTS, PRISM_VARS, money as _money } from './theme';

export const money = _money;

// Wraps a screen in the Prism dark palette + font. Replaces the hand-copied
// `.ww-prism` <style> block repeated across newer views.
export function Prism({ children, style }) {
  return (
    <div className="ww-prism" style={{ ...PRISM_VARS, fontFamily: FONTS.body,
      background: 'radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), ' + COLORS.ink,
      minHeight: '100%', ...style }}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, style }) {
  return <div style={{ fontFamily: FONTS.eyebrow, textTransform: 'uppercase', letterSpacing: '.2em',
    fontSize: 11, fontWeight: 700, color: COLORS.gold, ...style }}>{children}</div>;
}

export function Title({ children, style }) {
  return <h2 style={{ fontFamily: FONTS.serif, fontWeight: 300, fontSize: 30, margin: '2px 0 4px',
    color: COLORS.text1, ...style }}>{children}</h2>;
}

export function Card({ children, style, onClick, glow }) {
  return <div onClick={onClick} style={{ background: COLORS.card,
    border: '1px solid ' + (glow ? 'rgba(203,163,92,.5)' : 'rgba(203,163,92,.20)'),
    borderRadius: 14, padding: '13px 15px', ...(onClick ? { cursor: 'pointer' } : {}), ...style }}>{children}</div>;
}

export function Button({ children, onClick, disabled, variant = 'primary', style }) {
  const base = { border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 800, fontSize: 14,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, touchAction: 'manipulation' };
  const styles = {
    primary: { background: COLORS.champ, color: COLORS.ink },
    ghost: { background: 'transparent', color: COLORS.champ, border: '1px solid ' + COLORS.gold, fontWeight: 700 },
    subtle: { background: 'transparent', color: COLORS.text3, border: '1px solid rgba(203,163,92,.20)', fontWeight: 500 },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...(styles[variant] || styles.primary), ...style }}>{children}</button>;
}

export function Chip({ on, label, onClick, style }) {
  return <button type="button" onClick={onClick} style={{
    border: '1px solid ' + (on ? COLORS.gold : 'rgba(203,163,92,.20)'),
    background: on ? 'rgba(203,163,92,.16)' : 'transparent', color: on ? COLORS.champ : COLORS.text2,
    borderRadius: 20, padding: '6px 12px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
    margin: '0 6px 6px 0', touchAction: 'manipulation', ...style }}>{label}</button>;
}

export function Stat({ value, label, sub, accent, style }) {
  return <div style={{ flex: 1, minWidth: 0, background: COLORS.card, border: '1px solid rgba(203,163,92,.20)',
    borderRadius: 12, padding: '12px 13px', ...style }}>
    <div style={{ fontFamily: FONTS.serif, fontSize: 24, color: accent || COLORS.text1, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 10.5, color: COLORS.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 3 }}>{label}</div>
    {sub ? <div style={{ fontSize: 10.5, color: COLORS.text3, marginTop: 1 }}>{sub}</div> : null}
  </div>;
}

export default { Prism, Eyebrow, Title, Card, Button, Chip, Stat, money };
