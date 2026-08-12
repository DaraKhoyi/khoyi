// ForkTuningOverlay — the branded 'Ari is tuning' overlay shown while a rewrite runs.
// Extracted from App.js (strangle). Self-contained; only needs createPortal.
import React from 'react';
import { createPortal } from 'react-dom';

export default function ForkTuningOverlay({ contactName, discLabel }) {
  const name = (contactName && contactName !== 'the recipient') ? contactName : null;
  const d = (discLabel || '').trim();
  return createPortal(
    <div className="fork-ov" role="status" aria-live="polite">
      <div className="fork-ov-inner">
        <div className="fork-stage">
          <span className="fork-glow" />
          <span className="fork-ring fr1" />
          <span className="fork-ring fr2" />
          <span className="fork-ring fr3" />
          <svg className="fork-ico" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <g stroke="#EBCB82" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.55"><path d="M30 11 Q34 17 30 23"/><path d="M10 11 Q6 17 10 23"/></g>
            <g stroke="#CBA35C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M15 6 V21"/><path d="M25 6 V21"/><path d="M15 21 C15 26 17 28 20 28 C23 28 25 26 25 21"/><path d="M20 28 V36"/></g>
            <circle cx="20" cy="37.4" r="2" fill="#EBCB82"/>
          </svg>
        </div>
        <div className="fork-eyebrow">✦ Ari is tuning</div>
        <div className="fork-title">{name ? `Tuning to ${name}` : 'Tuning your message'}</div>
        <div className="fork-sub">{d ? `Matching your voice to their ${d} style` : `Matching your voice to how ${name || 'they'} read best`}</div>
      </div>
    </div>,
    document.body
  );
}
