// PrismThinking — the animated 'Ari is thinking' tuning-fork spinner (shared).
// Extracted from App.js (strangle).
import React from 'react';

export default function PrismThinking({ label = 'Thinking' }) {
  return (
    <span className="prism-think-wrap">
      <svg className="prism-think" width="36" height="26" viewBox="0 0 46 30" fill="none" aria-hidden="true">
        <path className="pt-beam" d="M2 15 H17" stroke="#F6F1E7" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M18 6 L28 24 L18 24 Z" stroke="#CBA35C" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(203,163,92,0.05)"/>
        <g strokeWidth="1.5" strokeLinecap="round">
          <path className="pt-ray pr1" d="M27 14 L44 8" stroke="#EBCB82"/>
          <path className="pt-ray pr2" d="M27.5 16 L44 14" stroke="#e0b48f"/>
          <path className="pt-ray pr3" d="M27.5 18 L44 20" stroke="#c9a6bf"/>
          <path className="pt-ray pr4" d="M27 20 L44 26" stroke="#a6bfc9"/>
        </g>
      </svg>
      {label ? <span className="prism-think-label">{label}<span className="pt-dots"><i>.</i><i>.</i><i>.</i></span></span> : null}
    </span>
  );
}
