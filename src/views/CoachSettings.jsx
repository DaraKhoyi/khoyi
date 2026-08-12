// CoachSettings — settings panel extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

export default function CoachSettings({ userId }){
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  React.useEffect(() => { (async () => { try { const { data } = await supabase.from('coach_settings').select('*').eq('user_id', userId).maybeSingle(); setS(data || { coach_name:'John', intensity:'balanced', style:'supportive', rhythm:'weekly' }); } catch(_){ setS({ coach_name:'John', intensity:'balanced', style:'supportive', rhythm:'weekly' }); } })(); }, [userId]);
  const save = async (patch) => { const next = { ...s, ...patch }; setS(next); try { await supabase.from('coach_settings').upsert({ user_id: userId, coach_name: (next.coach_name || 'John').trim() || 'John', intensity: next.intensity, style: next.style, rhythm: next.rhythm, updated_at: new Date().toISOString() }, { onConflict:'user_id' }); setSaved(true); setTimeout(() => setSaved(false), 1500); } catch(_){} };
  if (!s) return null;
  const sel = (val, opts, key) => <select className="form-input" value={val} onChange={e=>save({ [key]: e.target.value })} style={{ marginTop:4 }}>{opts.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>;
  return (
    <div className="panel" style={{ marginBottom:'18px' }}>
      <div className="panel-header"><h3>Your Coach</h3></div>
      <div className="panel-body">
        <div style={{ fontSize:'12px', color:'var(--text-3)', marginBottom:'10px' }}>Your accountability coach lives in the Coach tab, built around your Blueprint. Make him yours.</div>
        <label className="form-label">Coach name</label>
        <input className="form-input" value={s.coach_name || ''} onChange={e=>setS({ ...s, coach_name:e.target.value })} onBlur={e=>save({ coach_name:e.target.value })} placeholder="John" maxLength={40} />
        <label className="form-label" style={{ marginTop:'12px' }}>Intensity</label>
        {sel(s.intensity, [['light','Light — a gentle nudge'],['balanced','Balanced'],['intense','Intense — push me']], 'intensity')}
        <label className="form-label" style={{ marginTop:'12px' }}>Style</label>
        {sel(s.style, [['supportive','Supportive'],['balanced','Balanced'],['tough_love','Tough love']], 'style')}
        <label className="form-label" style={{ marginTop:'12px' }}>Rhythm</label>
        {sel(s.rhythm, [['daily','Daily check-ins'],['weekly','Weekly review'],['light','Light — when I ask']], 'rhythm')}
        {saved && <div style={{ fontSize:'12px', color:'var(--accent-2)', marginTop:'10px' }}>Saved.</div>}
      </div>
    </div>
  );
}
