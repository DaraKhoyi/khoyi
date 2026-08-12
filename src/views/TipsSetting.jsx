// TipsSetting — settings panel extracted from App.js (strangle).
import React, { useState } from 'react';
import { TIPS_UNLOCK_AT, effectivePace, setTipsEnabled, setTipsPace, tipsSeenCount, tipsUnlocked } from '../tipsUi';

export default function TipsSetting(){
  const [pace, setPace] = useState(effectivePace());
  const unlocked = tipsUnlocked(); const seen = tipsSeenCount();
  const choose = (p) => { if (p === 'off' && !unlocked) return; setTipsPace(p); setTipsEnabled(p !== 'off'); setPace(p); };
  const opts = [
    { id:'thorough', label:'Thorough', desc:'Teach me everything, often' },
    { id:'balanced', label:'Balanced', desc:'A couple a day' },
    { id:'light', label:'Light', desc:'Just the essentials' },
    { id:'off', label:'Off', desc:'No tips' },
  ];
  return (
    <div className="panel" style={{ marginBottom:'18px' }}>
      <div style={{ fontSize:'13.5px', fontWeight:700, color:'var(--text-1)' }}>Learning pace</div>
      <div style={{ fontSize:'12px', color:'var(--text-3)', margin:'2px 0 12px' }}>How often PrismOS teaches you as you work — set to match your DISC style, change it anytime.</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {opts.map(o => {
          const locked = o.id === 'off' && !unlocked;
          const active = pace === o.id;
          return (
            <button key={o.id} onClick={() => choose(o.id)} disabled={locked} style={{ display:'flex', alignItems:'center', gap:'11px', padding:'11px 14px', borderRadius:'12px', textAlign:'left', width:'100%', cursor: locked?'not-allowed':'pointer', opacity: locked?0.55:1, border:'1px solid '+(active?'#CBA35C':'var(--border)'), background: active?'rgba(203,163,92,.14)':'transparent' }}>
              <span style={{ width:'16px', height:'16px', borderRadius:'50%', flexShrink:0, border:'2px solid '+(active?'#CBA35C':'var(--text-3)'), background: active?'#CBA35C':'transparent' }} />
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ fontSize:'13.5px', fontWeight:700, color: active?'#EBCB82':'var(--text-1)' }}>{o.label}</span>
                <span style={{ fontSize:'11.5px', color:'var(--text-3)', marginLeft:'8px' }}>{o.desc}</span>
              </span>
              {locked && <span style={{ fontSize:'11px', color:'var(--text-3)', flexShrink:0 }}>🔒 {seen}/{TIPS_UNLOCK_AT}</span>}
            </button>
          );
        })}
      </div>
      {!unlocked && <div style={{ fontSize:'11px', color:'var(--text-3)', marginTop:'10px' }}>Turning tips fully off unlocks once you've picked up a few fundamentals ({seen}/{TIPS_UNLOCK_AT}).</div>}
    </div>
  );
}
