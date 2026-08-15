// FinanceTiles — the small stat tiles shared across the finance screens.
// They live here so the tax reports do not have to import AccountingViews to get
// them, which would drag the whole accounting bundle back into the tax chunk and
// undo the split. A lazy import is only lazy if nothing else statically reaches
// the module.
import React from 'react';

export function KpiTile({ label, value, sub }) {
  return (
    <div className="panel" style={{padding:'12px'}}>
      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:'4px'}}>{label}</div>
      <div style={{fontSize:'18px',fontWeight:700,color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{value}</div>
      <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>
    </div>
  );
}

export function KpiBox({ label, value, sub, color }) {
  return (
    <div style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>{label}</div>
      <div style={{fontSize:'17px',fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:'4px',color: color || 'var(--text-1)'}}>{value}</div>
      {sub && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>}
    </div>
  );
}

// Section in the "show working" math walkthrough
