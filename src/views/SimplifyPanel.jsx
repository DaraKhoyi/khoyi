// SimplifyPanel — settings panel extracted from App.js (strangle).
import React from 'react';
import { PAGES, PAGE_GROUPS, roleAllows } from '../pages';
import { Icon } from '../icons';

export default function SimplifyPanel({ mv, role, onToggle }) {
  const groups = {};
  for (const g of PAGE_GROUPS) groups[g] = [];
  for (const [id, p] of Object.entries(PAGES)) {
    if (p.built === false) continue;
    if (!roleAllows(role, p.minRole)) continue;   // don't show pages this user can't access anyway
    (groups[p.group] || (groups[p.group] = [])).push({ id, ...p });
  }
  const Toggle = ({ on, disabled, onChange }) => (
    <label style={{position:'relative',display:'inline-block',width:'46px',height:'24px',cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,flex:'none'}}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e=>!disabled&&onChange(e.target.checked)} style={{opacity:0,width:0,height:0}} />
      <span style={{position:'absolute',top:0,left:0,right:0,bottom:0,background:on?'var(--accent)':'var(--border)',borderRadius:'24px',transition:'background .15s'}} />
      <span style={{position:'absolute',top:'3px',left:on?'24px':'3px',width:'18px',height:'18px',background:'#fff',borderRadius:'50%',transition:'left .15s'}} />
    </label>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px'}}>
      {PAGE_GROUPS.filter(g => groups[g] && groups[g].length).map(g => (
        <div key={g}>
          <div style={{fontSize:'10.5px',fontWeight:800,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--accent)',marginBottom:'8px'}}>{g}</div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {groups[g].map(p => {
              const on = p.core ? true : (mv[p.id] !== false);
              return (
                <div key={p.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',padding:'9px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px',display:'flex',alignItems:'center',gap:'7px'}}>
                      <Icon name={p.icon} size={14} style={{verticalAlign:'-2px',flex:'none'}} />
                      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.label}</span>
                      {p.core && <span style={{fontSize:'9px',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--text-3)',border:'1px solid var(--border)',borderRadius:'5px',padding:'1px 5px'}}>Essential</span>}
                    </div>
                  </div>
                  <Toggle on={on} disabled={!!p.core} onChange={(v)=>onToggle(p.id, v)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
