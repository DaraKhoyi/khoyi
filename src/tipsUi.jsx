// ── Teachable-moments (Tip / TipFor) + pacing helpers — extracted from App.js ──
// State lives in localStorage (no in-memory registry), so these are self-contained.
// The tip registry stays in ./tips; the settings UI (TipsSetting) stays in App.js
// and imports the pacing helpers from here.
import React, { useState } from 'react';
import { TIPS_BY_SCREEN } from './tips';

const TIPS_UNLOCK_AT = 6;
function tipsSeenList(){ try { return JSON.parse(localStorage.getItem('prism_tips_seen')||'[]'); } catch(_){ return []; } }
function tipsSeenCount(){ return tipsSeenList().length; }
const TIP_PACE_COOLDOWN = { thorough: 30 * 60 * 1000, balanced: 12 * 60 * 60 * 1000, light: 48 * 60 * 60 * 1000, off: Infinity };
function tipsPace(){ try { return localStorage.getItem('prism_tips_pace') || ''; } catch(_){ return ''; } }
function setTipsPace(p){ try { localStorage.setItem('prism_tips_pace', p); } catch(_){} }
function effectivePace(){ const p = tipsPace(); return (p === 'thorough' || p === 'balanced' || p === 'light' || p === 'off') ? p : 'balanced'; }
function tipCooldownMs(){ return TIP_PACE_COOLDOWN[effectivePace()] || TIP_PACE_COOLDOWN.balanced; }
function tipsAreEnabled(){ try { if (localStorage.getItem('prism_tips_enabled') === '0') return false; } catch(_){} return effectivePace() !== 'off'; }
function tipsUnlocked(){ return tipsSeenCount() >= TIPS_UNLOCK_AT; }
function setTipsEnabled(on){ try { localStorage.setItem('prism_tips_enabled', on ? '1' : '0'); } catch(_){} }
function tipsLastShown(){ try { return parseInt(localStorage.getItem('prism_tips_last_shown')||'0', 10) || 0; } catch(_){ return 0; } }
function Tip({ id, label = 'Why this works', children }){
  const [gone, setGone] = useState(() => {
    if (!tipsAreEnabled() || tipsSeenList().includes(id)) return true;
    const last = tipsLastShown();
    if (last && (Date.now() - last) < tipCooldownMs()) return true; // a tip was shown recently — hold the next one
    return false;
  });
  React.useEffect(() => { if (!gone) { try { localStorage.setItem('prism_tips_last_shown', String(Date.now())); } catch(_){} } }, [gone]);
  if (gone) return null;
  const dismiss = () => { try { const s = tipsSeenList(); if (!s.includes(id)) { s.push(id); localStorage.setItem('prism_tips_seen', JSON.stringify(s)); } } catch(_){} setGone(true); };
  return (
    <div className="prism-tip">
      <div className="prism-tip-top"><span className="prism-tip-eye">✦ {label}</span><button className="prism-tip-got" onClick={dismiss}>Got it</button></div>
      <div className="prism-tip-txt">{children}</div>
    </div>
  );
}

// TipFor — surfaces the teaching tips for a screen from the central registry
// (src/tips.js). One line on any screen: <TipFor screen="deals" />.
//
// A feature deserves as many tips as it has distinct lessons — one is never a
// cap. So a screen can register several, and they surface ONE PER VISIT (paced,
// never floods) — but a curious agent can tap "Next tip" to walk the rest of a
// screen's lessons right now instead of waiting for future visits. Each tip is
// still marked seen on dismissal, so nothing repeats once learned.
function TipFor({ screen }) {
  const list = TIPS_BY_SCREEN[screen];
  // Freeze the set of unseen tips for THIS mount, in registry order. Advancing
  // with "Next" walks this list; dismissing marks each seen so it won't return.
  const [queue] = useState(() => {
    if (!tipsAreEnabled()) return [];
    let seen = [];
    try { seen = tipsSeenList(); } catch (_) {}
    return (list || []).filter(t => !seen.includes(t.id));
  });
  const [idx, setIdx] = useState(0);
  const [gone, setGone] = useState(() => {
    // Respect the cooldown for the FIRST tip only — once the agent is actively
    // stepping through with "Next", the cooldown shouldn't block them.
    if (!queue.length) return true;
    const last = tipsLastShown();
    if (last && (Date.now() - last) < tipCooldownMs()) return true;
    return false;
  });
  React.useEffect(() => { if (!gone) { try { localStorage.setItem('prism_tips_last_shown', String(Date.now())); } catch (_) {} } }, [gone]);

  if (gone || idx >= queue.length) return null;
  const cur = queue[idx];
  const markSeen = (id) => { try { const s = tipsSeenList(); if (!s.includes(id)) { s.push(id); localStorage.setItem('prism_tips_seen', JSON.stringify(s)); } } catch (_) {} };
  const hasNext = idx + 1 < queue.length;

  const onGotIt = () => { markSeen(cur.id); setGone(true); };
  const onNext = () => { markSeen(cur.id); setIdx(i => i + 1); };

  return (
    <div className="prism-tip">
      <div className="prism-tip-top">
        <span className="prism-tip-eye">✦ {cur.label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {queue.length > 1 && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '.04em' }}>{idx + 1}/{queue.length}</span>
          )}
          {hasNext
            ? <button className="prism-tip-got" onClick={onNext}>Next tip →</button>
            : <button className="prism-tip-got" onClick={onGotIt}>Got it</button>}
        </span>
      </div>
      <div className="prism-tip-txt"><span dangerouslySetInnerHTML={{ __html: cur.body }} /></div>
    </div>
  );
}

export { TIPS_UNLOCK_AT, tipsSeenList, tipsSeenCount, tipsPace, setTipsPace, effectivePace, tipCooldownMs, tipsAreEnabled, tipsUnlocked, setTipsEnabled, tipsLastShown, Tip, TipFor };
