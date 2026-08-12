// ResearchProgress — live progress UI while AI research runs on a contact.
import React, { useState, useEffect, useRef } from 'react';

export default function ResearchProgress({ contactName, phase = 'researching' }) {
  const name = (contactName && contactName !== 'the recipient') ? contactName : 'them';
  const STEPS = phase === 'identifying'
    ? [
        { t: 'Matching your identifiers', s: 'Email, phone, and name against public records' },
        { t: 'Finding candidate profiles', s: 'LinkedIn, firm sites, directories' },
        { t: 'Confirming it’s the right person', s: 'Cross-checking the details line up' },
      ]
    : [
        { t: 'Searching public sources', s: 'LinkedIn, company sites, news, licenses' },
        { t: 'Reading the evidence', s: 'Bio, posts, press, professional history' },
        { t: 'Cross-referencing', s: 'Confirming facts across multiple sources' },
        { t: 'Reading behavioral signals', s: 'How they present, decide, and communicate' },
        { t: 'Building the DISC read', s: 'Turning evidence into a behavioral profile' },
        { t: 'Writing your connection plan', s: 'How to open, what to lean into' },
      ];
  // Advance through steps on a cadence that roughly fills the expected window,
  // holding on the LAST step (so it never looks "done" before the data lands).
  const [i, setI] = useState(0);
  const per = phase === 'identifying' ? 4000 : 12000;
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, STEPS.length - 1)), per);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: '18px 16px 8px', textAlign: 'center' }}>
      <div className="fork-stage" style={{ width: 118, height: 118, marginBottom: 14 }}>
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
      <div className="fork-eyebrow">✦ {phase === 'identifying' ? 'Ari is looking' : 'Ari is researching'}</div>
      <div className="fork-title" style={{ fontSize: 22, marginBottom: 4 }}>{phase === 'identifying' ? `Finding ${name}` : `Reading up on ${name}`}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 16 }}>{phase === 'identifying' ? 'A few seconds…' : 'About a minute — worth the wait.'}</div>

      <div style={{ textAlign: 'left', maxWidth: 320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {STEPS.map((step, idx) => {
          const done = idx < i;
          const active = idx === i;
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, opacity: done || active ? 1 : 0.4, transition: 'opacity .4s' }}>
              <span style={{ flex: 'none', width: 18, height: 18, marginTop: 1, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'var(--accent-2, #EBCB82)' : 'transparent',
                border: done ? 'none' : `1.5px solid ${active ? 'var(--accent-2, #EBCB82)' : 'var(--border)'}`,
                color: '#1a1409', fontSize: 11, fontWeight: 800 }}>
                {done ? '✓' : active ? <span className="rp-pulse-dot" /> : ''}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: active ? 700 : 600, color: active ? 'var(--text-1)' : done ? 'var(--text-2)' : 'var(--text-3)' }}>{step.t}</div>
                {active && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1, lineHeight: 1.4 }}>{step.s}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
