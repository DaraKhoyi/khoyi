// WorkingHoursSection — settings panel extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

export default function WorkingHoursSection({ userId }) {
  const DAYS = [['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
  const [sched, setSched] = useState(null);
  const [days, setDays] = useState({});
  const [mirror, setMirror] = useState(false);
  const [buffer, setBuffer] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let { data } = await supabase.from('schedules').select('*').eq('user_id', userId).eq('is_default', true).limit(1);
      let s = data && data[0];
      if (!s) {
        const { data: created } = await supabase.from('schedules').insert({
          user_id: userId, name: 'Work hours', is_default: true,
          hours: { mon:[[9,17]], tue:[[9,17]], wed:[[9,17]], thu:[[9,17]], fri:[[9,17]] },
          timezone: 'America/New_York',
        }).select().single();
        s = created;
      }
      if (cancelled || !s) return;
      const h = s.hours || {};
      const next = {};
      for (const [k] of DAYS) {
        const w = h[k] && h[k][0];
        next[k] = w ? { enabled: true, start: w[0], end: w[1] } : { enabled: false, start: 9, end: 17 };
      }
      setSched(s); setDays(next); setMirror(!!s.mirror_to_google); setBuffer(s.buffer_minutes ?? 30); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  function setDay(k, patch) { setDays(prev => ({ ...prev, [k]: { ...prev[k], ...patch } })); }

  async function save() {
    setSaving(true); setMsg('');
    const hours = {};
    for (const [k] of DAYS) if (days[k]?.enabled) hours[k] = [[Number(days[k].start), Number(days[k].end)]];
    const { error } = await supabase.from('schedules')
      .update({ hours, mirror_to_google: mirror, buffer_minutes: Number(buffer), updated_at: new Date().toISOString() })
      .eq('id', sched.id);
    if (error) setMsg('Error: ' + error.message);
    else {
      setMsg('Working hours saved. Re-scheduling…');
      supabase.functions.invoke('task-autoschedule', { body: {} }).catch(() => {});
    }
    setSaving(false);
  }

  const HOPTS = []; for (let h = 0; h <= 24; h += 0.5) HOPTS.push(h);
  const hlabel = (h) => { const hh = Math.floor(h), mm = (h - hh) * 60; const ap = hh < 12 || hh === 24 ? 'AM' : 'PM'; let d = hh % 12; if (d === 0) d = 12; return `${d}:${mm===0?'00':'30'} ${hh===24?'AM':ap}`; };

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header"><h3><span style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="calendar" size={15} /> Working Hours</span></h3></div>
      <div className="panel-body">
        {loading ? <p style={{color:'var(--text-3)'}}>Loading…</p> : (
          <>
            <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
              Auto-scheduled tasks are placed only inside these hours, around your meetings. Times are in your local timezone.
            </p>
            {msg && <div className={msg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{msg}</div>}
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {DAYS.map(([k,label]) => (
                <div key={k} style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                  <label style={{display:'flex',alignItems:'center',gap:'7px',width:'120px',cursor:'pointer',fontSize:'13px'}}>
                    <input type="checkbox" checked={!!days[k]?.enabled} onChange={e=>setDay(k,{enabled:e.target.checked})}/>
                    <span style={{color:days[k]?.enabled?'var(--text-1)':'var(--text-3)'}}>{label}</span>
                  </label>
                  {days[k]?.enabled ? (
                    <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                      <select className="form-select" style={{width:'auto',padding:'4px 8px'}} value={days[k].start} onChange={e=>setDay(k,{start:Number(e.target.value)})}>
                        {HOPTS.filter(h=>h<24).map(h=><option key={h} value={h}>{hlabel(h)}</option>)}
                      </select>
                      <span style={{color:'var(--text-3)'}}>to</span>
                      <select className="form-select" style={{width:'auto',padding:'4px 8px'}} value={days[k].end} onChange={e=>setDay(k,{end:Number(e.target.value)})}>
                        {HOPTS.filter(h=>h>days[k].start).map(h=><option key={h} value={h}>{hlabel(h)}</option>)}
                      </select>
                    </div>
                  ) : <span style={{fontSize:'12px',color:'var(--text-3)'}}>Off</span>}
                </div>
              ))}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap',marginTop:'14px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
              <div style={{flex:'1 1 220px',minWidth:'200px'}}>
                <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:600}}>Buffer around appointments</div>
                <div style={{fontSize:'12px',color:'var(--text-3)',lineHeight:1.4}}>Free time kept before & after each meeting so tasks aren't booked flush against it.</div>
              </div>
              <select className="form-select" style={{width:'auto',padding:'6px 10px'}} value={buffer} onChange={e=>setBuffer(Number(e.target.value))}>
                <option value={0}>No buffer</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'12px',color:'var(--text-2)',marginTop:'14px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
              <input type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)}/>
              <span>Also push task blocks to my real Google Calendar <em style={{color:'var(--text-3)'}}>(off by default — blocks update often)</em></span>
            </label>
            <button className="btn btn-primary" style={{marginTop:'14px'}} onClick={save} disabled={saving}>{saving?'Saving…':'Save working hours'}</button>
          </>
        )}
      </div>
    </div>
  );
}
