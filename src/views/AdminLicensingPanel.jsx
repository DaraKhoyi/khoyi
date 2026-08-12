// AdminLicensingPanel — settings panel extracted from App.js (strangle).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ALL_FEATURES } from '../pages';
import { supabase } from '../dataService';

export default function AdminLicensingPanel({ userId }) {
  const [enforced, setEnforced] = React.useState(null);
  const [codes, setCodes] = React.useState([]);
  const [feats, setFeats] = React.useState([]);
  const [label, setLabel] = React.useState('');
  const [maxR, setMaxR] = React.useState('');
  const [msg, setMsg] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [{ data: cfg }, { data: list }] = await Promise.all([
        supabase.from('app_config').select('value').eq('key','licensing_enforced').maybeSingle(),
        supabase.rpc('admin_list_codes'),
      ]);
      setEnforced(cfg?.value === true);
      setCodes(Array.isArray(list) ? list : []);
    } catch (_) {}
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const allFeatures = React.useMemo(() => ALL_FEATURES, []);
  const toggleFeat = (f) => setFeats(fs => fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]);

  const setEnforcement = async (on) => {
    setBusy(true);
    try {
      await supabase.from('app_config').upsert({ key: 'licensing_enforced', value: on, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      setEnforced(on);
      setMsg({ ok: true, text: on ? 'Enforcement ON — users now see only what they\u2019re licensed for. Reload to apply.' : 'Enforcement OFF — all pages visible.' });
    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    finally { setBusy(false); }
  };

  const createCode = async () => {
    if (!feats.length) { setMsg({ ok: false, text: 'Pick at least one feature.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc('admin_create_code', { p_features: feats, p_label: label.trim() || null, p_max_redemptions: maxR ? parseInt(maxR) : null });
      if (error || !data?.ok) { setMsg({ ok: false, text: (error?.message) || data?.message || 'Could not create code.' }); }
      else { setMsg({ ok: true, text: `Code created: ${data.code}` }); setFeats([]); setLabel(''); setMaxR(''); await load(); }
    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    finally { setBusy(false); }
  };

  const toggleActive = async (code, active) => { await supabase.rpc('admin_set_code_active', { p_code: code, p_active: active }); load(); };

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header"><h3>Licensing (admin)</h3></div>
      <div className="panel-body">
        {msg && <div style={{marginBottom:12,fontSize:13,color:msg.ok?'var(--green,#7fae8f)':'var(--red)'}}>{msg.ok?'✓ ':''}{msg.text}</div>}

        {/* master switch */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:10,marginBottom:18}}>
          <div>
            <div style={{fontWeight:700,color:'var(--text-1)',fontSize:14}}>Enforce licensing</div>
            <div style={{fontSize:11.5,color:'var(--text-3)',marginTop:2,lineHeight:1.5,maxWidth:420}}>
              {enforced ? 'ON — everyone sees only base features plus what they\u2019ve been granted.' : 'OFF — every page is visible to everyone (nothing is locked). Turn on when you\u2019re ready to charge.'}
            </div>
          </div>
          <label style={{position:'relative',display:'inline-block',width:46,height:24,cursor:busy?'wait':'pointer',flex:'none'}}>
            <input type="checkbox" checked={enforced===true} disabled={busy} onChange={e=>setEnforcement(e.target.checked)} style={{opacity:0,width:0,height:0}} />
            <span style={{position:'absolute',inset:0,background:enforced?'var(--accent)':'var(--border)',borderRadius:24,transition:'background .15s'}} />
            <span style={{position:'absolute',top:3,left:enforced?24:3,width:18,height:18,background:'#fff',borderRadius:'50%',transition:'left .15s'}} />
          </label>
        </div>

        {/* code generator */}
        <div style={{fontSize:'10.5px',fontWeight:800,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--accent)',marginBottom:10}}>Create an unlock code</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
          {allFeatures.map(f => (
            <button key={f} type="button" onClick={()=>toggleFeat(f)}
              style={{fontSize:12,padding:'5px 10px',borderRadius:20,cursor:'pointer',border:'1px solid '+(feats.includes(f)?'var(--accent)':'var(--border)'),background:feats.includes(f)?'rgba(203,163,92,0.15)':'transparent',color:feats.includes(f)?'var(--accent)':'var(--text-2)',fontWeight:feats.includes(f)?700:500}}>
              {feats.includes(f)?'✓ ':''}{f}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Label (e.g. Prism Pro)" style={{flex:'1 1 160px',minWidth:0,background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-1)',padding:'8px 11px',fontSize:13}} />
          <input value={maxR} onChange={e=>setMaxR(e.target.value.replace(/\D/g,''))} placeholder="Max uses (blank = ∞)" style={{flex:'0 1 150px',minWidth:0,background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-1)',padding:'8px 11px',fontSize:13}} />
          <button className="btn btn-primary" disabled={busy || !feats.length} onClick={createCode}>Generate</button>
        </div>

        {/* existing codes */}
        {codes.length > 0 && (
          <div style={{marginTop:8}}>
            <div style={{fontSize:'10.5px',fontWeight:800,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--accent)',marginBottom:8}}>Codes</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {codes.map(c => (
                <div key={c.code} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'9px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:8,opacity:c.active?1:0.55}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,color:'var(--text-1)',fontSize:13,letterSpacing:'.04em'}}>{c.code}{c.label?<span style={{fontWeight:500,color:'var(--text-3)',marginLeft:8}}>{c.label}</span>:null}</div>
                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(c.features||[]).join(', ')} · used {c.redemption_count}{c.max_redemptions?('/'+c.max_redemptions):''}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>toggleActive(c.code, !c.active)} style={{flex:'none'}}>{c.active?'Deactivate':'Activate'}</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
