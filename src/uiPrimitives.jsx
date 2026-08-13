// uiPrimitives — tiny shared UI atoms used across several feature screens.
// They lived in App.js, which forced extracted views to import from the monolith
// (a view -> App.js circular edge). One small shared module removes that edge.
import React, { useState, useEffect, useRef } from 'react';

export const TEMP_META = { hot:{label:'Hot',color:'#ef4444',icon:'flame'}, warm:{label:'Warm',color:'#f59e0b',icon:'signal'}, cold:{label:'Cold',color:'#3b82f6',icon:'clock'} };

export function whenLabel(d){ if(!d) return ''; const dt=new Date(d); const now=new Date(); const days=Math.floor((dt - new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000); if(days<0) return 'Overdue'; if(days===0) return 'Today'; if(days===1) return 'Tomorrow'; if(days<7) return days+'d'; return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

export function TempDot({ t }){ const m=TEMP_META[t]||TEMP_META.warm; return <span title={m.label} style={{display:'inline-flex',alignItems:'center',gap:'4px',color:m.color,fontSize:'11px',fontWeight:700}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:m.color,display:'inline-block'}}/>{m.label}</span>; }

export const ovl={ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:2000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 12px', overflowY:'auto' };

export function CountUp({ value, duration = 750, style }) {
  const target = Number(value) || 0;
  const [n, setN] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef();
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setN(Math.round(from + (target - from) * e));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return <span style={style}>{n}</span>;
}

// Tiny 7-day "tasks completed" sparkline (gold bars, today highlighted).
