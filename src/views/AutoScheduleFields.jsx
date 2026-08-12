// AutoScheduleFields — auto-schedule fields (recurrence/window) for a task.
// Extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

export default function AutoScheduleFields({ initial, dueDate, onChange }) {
  const [autoSchedule, setAutoSchedule] = useState(!!initial?.auto_schedule);
  const [durationMin, setDurationMin] = useState(initial?.duration_minutes || 30);
  const [schedPriority, setSchedPriority] = useState(initial?.schedule_priority || 'normal'); // normal|asap
  const [hardDeadline, setHardDeadline] = useState(!!initial?.is_hard_deadline);
  const [minChunk, setMinChunk] = useState(initial?.min_chunk_minutes || 0);
  const [schedStartDate, setSchedStartDate] = useState(initial?.schedule_start_date || '');
  const [schedId, setSchedId] = useState(initial?.schedule_id || '');
  const [schedules, setSchedules] = useState([]);
  const isPinned = !!initial?.pin_at;
  const [unpinned, setUnpinned] = useState(false);

  // A pin fixes the block in place and overrides scheduling changes. If the user
  // moves "start on or after" past the pinned time, or asks for ASAP, the pin now
  // contradicts their intent — release it automatically so the change takes effect.
  useEffect(() => {
    if (!isPinned || unpinned) return;
    const pinMs = initial?.pin_at ? new Date(initial.pin_at).getTime() : null;
    const startMs = schedStartDate ? new Date(schedStartDate + 'T00:00:00').getTime() : null;
    const startConflicts = pinMs != null && startMs != null && pinMs < startMs;
    if (startConflicts || schedPriority === 'asap') setUnpinned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedStartDate, schedPriority]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('schedules').select('id,name,is_default').order('is_default', { ascending: false });
      if (!cancelled && data) setSchedules(data);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    onChange?.({
      auto_schedule: autoSchedule,
      duration_minutes: autoSchedule ? Math.max(5, parseInt(durationMin, 10) || 30) : (initial?.duration_minutes ?? null),
      schedule_priority: autoSchedule && schedPriority === 'asap' ? 'asap' : null,
      is_hard_deadline: autoSchedule ? hardDeadline : false,
      min_chunk_minutes: autoSchedule && parseInt(minChunk, 10) > 0 ? parseInt(minChunk, 10) : null,
      schedule_start_date: autoSchedule && schedStartDate ? schedStartDate : null,
      schedule_id: autoSchedule && schedId ? schedId : null,
      ...(isPinned && unpinned ? { pin_at: null } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSchedule, durationMin, schedPriority, hardDeadline, minChunk, schedStartDate, schedId, unpinned]);

  return (
    <div className="form-group" style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 12px',background:'var(--bg-base)'}}>
      <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px'}}>
        <input type="checkbox" checked={autoSchedule} onChange={e=>setAutoSchedule(e.target.checked)}/>
        <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="calendar" size={13} /> Auto-schedule onto my calendar</span>
      </label>
      <div style={{marginTop:'10px',display:'flex',flexDirection:'column',gap:'10px',opacity:autoSchedule?1:0.94}}>
        {!autoSchedule && <div style={{fontSize:'11px',color:'var(--text-3)',lineHeight:1.4,fontStyle:'italic'}}>Set the details below, then check the box above to place this on your calendar.</div>}
          <div className="form-row">
            <div className="form-group" style={{flex:1,marginBottom:0}}>
              <label className="form-label">Estimated time</label>
              <select className="form-select" value={durationMin} onChange={e=>setDurationMin(e.target.value)}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
                <option value={240}>4 hours</option>
                <option value={480}>Full day (8h)</option>
              </select>
            </div>
            <div className="form-group" style={{flex:1,marginBottom:0}}>
              <label className="form-label">Split into chunks of</label>
              <select className="form-select" value={minChunk} onChange={e=>setMinChunk(e.target.value)}>
                <option value={0}>Don't split</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1,marginBottom:0}}>
              <label className="form-label">Start on or after</label>
              <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                <input type="date" className="form-input" value={schedStartDate} onChange={e=>setSchedStartDate(e.target.value)} style={{flex:1}}/>
                {schedStartDate && <button type="button" onClick={()=>setSchedStartDate('')} style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'16px'}}>×</button>}
              </div>
              <span style={{fontSize:'10px',color:'var(--text-3)'}}>Won't be scheduled before this date.</span>
            </div>
            {schedules.length > 1 && (
              <div className="form-group" style={{flex:1,marginBottom:0}}>
                <label className="form-label">Working hours</label>
                <select className="form-select" value={schedId} onChange={e=>setSchedId(e.target.value)}>
                  <option value="">Default</option>
                  {schedules.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_default?' (default)':''}</option>)}
                </select>
              </div>
            )}
          </div>
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'12px',color:'var(--text-2)'}}>
            <input type="checkbox" checked={schedPriority==='asap'} onChange={e=>setSchedPriority(e.target.checked?'asap':'normal')}/>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="zap" size={13} /> ASAP — schedule before everything else</span>
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'12px',color:'var(--text-2)'}}>
            <input type="checkbox" checked={hardDeadline} onChange={e=>setHardDeadline(e.target.checked)} disabled={!dueDate}/>
            <span><span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="lock" size={12} /> Hard deadline</span> — work past hours if needed to hit the due date{!dueDate && <em style={{color:'var(--text-3)'}}> (set a due date first)</em>}</span>
          </label>
          {initial?.schedule_state && initial.schedule_state !== 'unscheduled' && (
            <div style={{fontSize:'11.5px',padding:'8px 10px',borderRadius:'6px',background:'var(--bg-card)',border:'1px solid var(--border)',lineHeight:1.5}}>
              {isPinned && !unpinned && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',flexWrap:'wrap'}}>
                  <div style={{color:'var(--accent)'}}><Icon name="pin" size={12} /> Pinned{initial.pin_at?` · ${new Date(initial.pin_at).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}`:''} — held here; scheduling changes won't move it.</div>
                  <button type="button" onClick={()=>setUnpinned(true)} style={{background:'var(--bg-base)',border:'1px solid var(--accent-dim)',color:'var(--accent)',borderRadius:'6px',padding:'3px 10px',fontSize:'11px',cursor:'pointer',whiteSpace:'nowrap'}}>Unpin</button>
                </div>
              )}
              {isPinned && unpinned && (
                <div style={{color:'var(--green)'}}>✓ Will reschedule automatically when you save.</div>
              )}
              {initial.schedule_state === 'scheduled' && initial.eta && !isPinned && (
                <div style={{color:'var(--green)'}}>✓ Scheduled · ends {new Date(initial.eta).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>
              )}
              {initial.schedule_state === 'could_not_fit' && (
                <div style={{color:'var(--yellow)'}}>⚠ Couldn't fit{initial.could_not_fit_reason?` — ${initial.could_not_fit_reason}`:''}</div>
              )}
            </div>
          )}
          <div style={{fontSize:'11px',color:'var(--text-3)',lineHeight:1.4}}>
            PrismOS finds open time in your working hours, places this task around your meetings, and reshuffles it automatically if you miss it. Manage working hours in Settings.
          </div>
        </div>
    </div>
  );
}
