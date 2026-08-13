// FinanceSystems — lead-gen "systems" (adopt, template library, time entry, ROI bar).
// Extracted from AccountingViews.jsx. Shared by the Finance screen AND the
// Prospecting screen, which is why it is its own module rather than living in
// either one — Prospecting used to import the entire accounting bundle to get it.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { Tip } from '../tipsUi';
import { confirmDialog } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours } from '../financeUtils';

export function FinanceSystems({ userId, systems, archivedSystems = [], reload, transactions, completions, timeEntries, templates, settings, readOnly, isCoach, maxSystems }) {
  const [showModal, setShowModal] = useState(false);
  const [editSystem, setEditSystem] = useState(null);
  const [showTimeModal, setShowTimeModal] = useState(null);  // system object or null
  const [showLibrary, setShowLibrary] = useState(false);
  const [activatingTemplate, setActivatingTemplate] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const activeNonOverhead = systems.filter(s => !s.is_overhead && s.is_active);
  const atCap = activeNonOverhead.length >= maxSystems && !isCoach;

  // Names of currently-active systems so we can mark templates already activated
  const activeNames = new Set(activeNonOverhead.map(s => s.name.toLowerCase()));

  // Pause / resume — reversible, keeps everything attributed. A paused system
  // stays in this list (greyed) but its tasks drop off the Today board.
  async function toggleActive(sys) {
    if (sys.is_overhead) return;
    const next = !sys.is_active;
    await supabase.from('lead_gen_systems')
      .update({ is_active: next, deactivated_at: next ? null : new Date().toISOString() })
      .eq('id', sys.id);
    if (window.__notify) window.__notify(next ? `Resumed "${sys.name}"` : `Paused "${sys.name}" — its tasks won't show on Today`, 'success');
    reload();
  }

  // Archive — soft remove. Moves the system to the Archived section and off
  // Today, but every logged time entry, expense, and income record stays saved
  // and keeps counting in the books. Fully restorable. Never a hard delete.
  async function archiveSystem(sys) {
    if (sys.is_overhead) return;
    if (!await confirmDialog(`Archive "${sys.name}"?\n\nIt moves to the Archived section and stops showing on Today. All logged time, expenses, and income stay saved and keep counting in your books — nothing is deleted. You can restore it anytime.`)) return;
    await supabase.from('lead_gen_systems')
      .update({ is_archived: true, is_active: false, archived_at: new Date().toISOString() })
      .eq('id', sys.id);
    if (window.__notify) window.__notify(`Archived "${sys.name}" — data retained`, 'success');
    setOpenMenuId(null);
    reload();
  }

  async function restoreSystem(sys) {
    await supabase.from('lead_gen_systems')
      .update({ is_archived: false, is_active: true, archived_at: null })
      .eq('id', sys.id);
    if (window.__notify) window.__notify(`Restored "${sys.name}"`, 'success');
    reload();
  }

  function statsForSystem(sys) {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const sysTx = transactions.filter(t => t.lead_gen_system_id === sys.id && t.scope === 'business' && new Date(t.date) >= yearStart);
    const cashSpent = Math.abs(sysTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0));
    const incomeAttributed = sysTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const sysTime = timeEntries.filter(te => te.lead_gen_system_id === sys.id);
    const minutes = sysTime.reduce((s, te) => s + Number(te.minutes), 0);
    const timeCost = (minutes / 60) * Number(settings?.hourly_rate || 0);
    const totalInvested = cashSpent + timeCost;
    const cashROI = cashSpent > 0 ? incomeAttributed / cashSpent : null;
    const trueROI  = totalInvested > 0 ? incomeAttributed / totalInvested : null;
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const sysComps = completions.filter(c => c.system_id === sys.id && new Date(c.date) >= last30);
    const totalDone = sysComps.reduce((s, c) => s + (c.count_done || 0), 0);
    const totalTarget = sysComps.reduce((s, c) => s + (c.target || 0), 0);
    const completionRate = totalTarget > 0 ? totalDone / totalTarget : null;
    return { cashSpent, incomeAttributed, minutes, timeCost, totalInvested, cashROI, trueROI, completionRate };
  }

  function statusFor(stats, sys) {
    if (sys.is_overhead) return null;
    if (stats.totalInvested === 0) return { label: '❓ No data', color: 'var(--text-3)' };
    if (stats.trueROI === null || stats.incomeAttributed === 0) return { label: '⏳ Awaiting files', color: 'var(--text-3)' };
    if (stats.trueROI >= 3) return { label: '🔥 Strong', color: 'var(--green)' };
    if (stats.trueROI >= 1) return { label: '✓ Profitable', color: 'var(--text-1)' };
    return { label: '⚠ Underwater', color: 'var(--red)' };
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      {openMenuId && <div onClick={() => setOpenMenuId(null)} style={{position:'fixed',inset:0,zIndex:15}} />}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <p style={{fontSize:'12px',color:'var(--text-2)',margin:0,lineHeight:1.5}}>
            Manage your lead-generation systems · {activeNonOverhead.length} / {maxSystems} active{isCoach && ' (coach: unlimited)'}
          </p>
        </div>
        {!readOnly && (
          <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
            <button onClick={() => setShowLibrary(true)}
              style={{padding:'7px 12px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--text-1)',cursor:'pointer',fontSize:'12px',fontWeight:700,whiteSpace:'nowrap'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="library" size={14} /> Browse 85 systems</span>
            </button>
            <button className="btn-add-circle" disabled={atCap}
              onClick={() => { if (atCap) { if (window.__notify) window.__notify(`Max ${maxSystems} systems — ask coach to raise`, 'error'); return; } setEditSystem(null); setShowModal(true); }}
              title={atCap ? `At cap of ${maxSystems}` : "Custom system"} aria-label="Custom system"
              style={{opacity:atCap?0.5:1}}>+</button>
          </div>
        )}
      </div>

      {/* Empty state when 0 active non-overhead systems */}
      {activeNonOverhead.length === 0 && !readOnly && (
        <div className="panel" style={{padding:'18px',background:'linear-gradient(135deg, rgba(197,169,94,0.08) 0%, rgba(197,169,94,0.02) 100%)',border:'1px solid var(--accent)',textAlign:'center'}}>
          <div style={{marginBottom:'8px'}}><Icon name="target" size={30} style={{color:'var(--text-3)'}} /></div>
          <h3 style={{margin:'0 0 6px',fontSize:'14px',color:'var(--text-1)'}}>Pick your lead-gen systems</h3>
          <p style={{fontSize:'12px',color:'var(--text-3)',margin:'0 0 14px',lineHeight:1.5}}>
            Browse 85 proven systems from Buffini, Tom Ferry, Mike Ferry, Krista Mashore, Ricky Carruth, Gary Keller, Jeff Glover, Chris Voss, and more — organized by Digital / Traditional / Niche with DISC fit scores.
          </p>
          <button onClick={() => setShowLibrary(true)}
            style={{padding:'10px 18px',background:'var(--accent)',color:'var(--bg-base)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:700}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="library" size={14} /> Open the System Library</span> →
          </button>
        </div>
      )}

      {systems.map(sys => {
        const stats = statsForSystem(sys);
        const status = statusFor(stats, sys);
        const dailyTasks = Array.isArray(sys.daily_tasks) ? sys.daily_tasks : [];
        const paused = !sys.is_overhead && !sys.is_active;
        return (
          <div key={sys.id} className="panel" style={{padding:'14px', opacity: paused ? 0.62 : 1, transition:'opacity 0.2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px',flexWrap:'wrap'}}>
              <span style={{display:'inline-block',width:'12px',height:'12px',borderRadius:'3px',background:sys.color,flexShrink:0}}/>
              <strong style={{color:'var(--text-1)',fontSize:'14px',flex:1,minWidth:0}}>{sys.name}</strong>
              {sys.is_overhead && <span style={{fontSize:'9px',color:'var(--text-3)',padding:'2px 6px',background:'var(--bg-hover)',borderRadius:'3px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>Default</span>}
              {paused && <span style={{fontSize:'9px',color:'#f59e0b',padding:'2px 6px',background:'rgba(245,158,11,0.12)',borderRadius:'3px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>Paused</span>}
              {status && !paused && <span style={{fontSize:'11px',color:status.color,fontWeight:700}}>{status.label}</span>}
              {!sys.is_overhead && !readOnly && (
                <>
                  <button onClick={() => toggleActive(sys)} role="switch" aria-checked={sys.is_active}
                    title={sys.is_active ? 'Active — tap to pause' : 'Paused — tap to resume'}
                    style={{width:'40px',height:'22px',borderRadius:'999px',border:'none',padding:0,position:'relative',flexShrink:0,cursor:'pointer',background: sys.is_active ? 'var(--green)' : 'var(--bg-hover)',transition:'background 0.2s'}}>
                    <span style={{position:'absolute',top:'2px',left: sys.is_active ? '20px' : '2px',width:'18px',height:'18px',borderRadius:'50%',background:'#fff',transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.3)'}}/>
                  </button>
                  <button onClick={() => { setEditSystem(sys); setShowModal(true); }}
                    style={{background:'transparent',border:'1px solid var(--border)',padding:'4px 10px',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>Edit</button>
                  <div style={{position:'relative'}}>
                    <button onClick={() => setOpenMenuId(openMenuId === sys.id ? null : sys.id)}
                      aria-label={`More actions for ${sys.name}`}
                      style={{background:'transparent',border:'1px solid var(--border)',padding:'4px 9px',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'15px',lineHeight:1,fontWeight:700}}>⋯</button>
                    {openMenuId === sys.id && (
                      <div style={{position:'absolute',right:0,top:'calc(100% + 4px)',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',boxShadow:'0 6px 24px rgba(0,0,0,0.5)',zIndex:20,minWidth:'170px',overflow:'hidden'}}>
                        <button onClick={() => { setOpenMenuId(null); setShowTimeModal(sys); }}
                          style={{width:'100%',textAlign:'left',background:'transparent',border:'none',padding:'11px 13px',color:'var(--text-1)',cursor:'pointer',fontSize:'12px',fontWeight:600,display:'flex',alignItems:'center',gap:'7px'}}><Icon name="clock" size={13} /> Log time manually</button>
                        <button onClick={() => archiveSystem(sys)}
                          style={{width:'100%',textAlign:'left',background:'transparent',border:'none',borderTop:'1px solid var(--border)',padding:'11px 13px',color:'var(--text-2)',cursor:'pointer',fontSize:'12px',fontWeight:600,display:'flex',alignItems:'center',gap:'7px'}}><Icon name="archive" size={13} /> Archive system</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {sys.description && <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 10px',lineHeight:1.4}}>{sys.description}</p>}

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'8px',marginTop:'8px'}}>
              <SysStat label="Budget/mo" value={fmtUSD(Number(sys.monthly_budget))} />
              <SysStat label="Cash spent YTD" value={fmtUSD(stats.cashSpent)} tone={stats.cashSpent > Number(sys.monthly_budget)*12 ? 'red' : 'normal'} />
              {!sys.is_overhead && (
                <>
                  <SysStat label="Time invested" value={`${fmtHours(stats.minutes)} h`} sub={fmtUSD(stats.timeCost)} />
                  <SysStat label="Income attributed" value={fmtUSD(stats.incomeAttributed)} tone="green" />
                </>
              )}
            </div>

            {!sys.is_overhead && (stats.totalInvested > 0 || stats.incomeAttributed > 0) && (
              <ROIBar stats={stats} />
            )}

            {!sys.is_overhead && dailyTasks.length > 0 && (
              <div style={{marginTop:'10px',padding:'8px 10px',background:'var(--bg-base)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'4px'}}>
                  Daily prospecting · {stats.completionRate !== null ? `${Math.round(stats.completionRate*100)}% last 30d` : 'no completions yet'}
                </div>
                {stats.completionRate !== null && (
                  <div style={{position:'relative',height:'6px',background:'var(--bg-hover)',borderRadius:'3px',overflow:'hidden',marginBottom:'6px'}}>
                    <div style={{width:`${Math.min(100,stats.completionRate*100)}%`,height:'100%',background:stats.completionRate>=0.8?'var(--green)':stats.completionRate>=0.5?'#f59e0b':'var(--red)',transition:'width 0.4s'}}/>
                  </div>
                )}
                {dailyTasks.map(t => (
                  <div key={t.id} style={{fontSize:'11px',color:'var(--text-2)',padding:'2px 0'}}>
                    • {t.desc} {t.daily_target > 1 && <span style={{color:'var(--text-3)'}}>× {t.daily_target}/day</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {archivedSystems.length > 0 && (
        <div style={{marginTop:'4px'}}>
          <button onClick={() => setShowArchived(v => !v)}
            style={{display:'flex',alignItems:'center',gap:'8px',width:'100%',background:'transparent',border:'none',padding:'8px 2px',color:'var(--text-3)',cursor:'pointer',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>
            <span style={{transform: showArchived ? 'rotate(90deg)' : 'none', transition:'transform 0.15s'}}>▸</span>
            <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="archive" size={13} /> Archived ({archivedSystems.length})</span>
          </button>
          {showArchived && archivedSystems.map(sys => (
            <div key={sys.id} className="panel" style={{padding:'12px',marginTop:'8px',opacity:0.78}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                <span style={{display:'inline-block',width:'12px',height:'12px',borderRadius:'3px',background:sys.color,flexShrink:0}}/>
                <strong style={{color:'var(--text-1)',fontSize:'13px',flex:1,minWidth:0}}>{sys.name}</strong>
                {!readOnly && (
                  <button onClick={() => restoreSystem(sys)}
                    style={{background:'transparent',border:'1px solid var(--accent)',padding:'4px 12px',borderRadius:'6px',color:'var(--accent)',cursor:'pointer',fontSize:'11px',fontWeight:700}}>↩ Restore</button>
                )}
              </div>
              <p style={{fontSize:'10px',color:'var(--text-3)',margin:'7px 0 0',lineHeight:1.45}}>
                Logged time, expenses, and income are retained and still counted in your books. Restore anytime to resume its tasks.
              </p>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <SystemModal
          userId={userId} initial={editSystem}
          onClose={() => { setShowModal(false); setEditSystem(null); }}
          onSaved={() => { setShowModal(false); setEditSystem(null); reload(); }}
        />
      )}
      {showTimeModal && (
        <TimeEntryModal
          userId={userId} system={showTimeModal}
          onClose={() => setShowTimeModal(null)}
          onSaved={() => { setShowTimeModal(null); reload(); }}
        />
      )}
      {showLibrary && (
        <TemplateLibraryModal
          templates={templates || []} activeNames={activeNames}
          atCap={atCap} maxSystems={maxSystems} isCoach={isCoach}
          onClose={() => setShowLibrary(false)}
          onPick={(t) => { setShowLibrary(false); setActivatingTemplate(t); }}
        />
      )}
      {activatingTemplate && (
        <TemplateActivateModal
          userId={userId} template={activatingTemplate}
          onClose={() => setActivatingTemplate(null)}
          onActivated={() => { setActivatingTemplate(null); reload(); }}
        />
      )}
    </div>
  );
}


export function SysStat({ label, value, sub, tone = 'normal' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'red' ? 'var(--red)' : tone === 'muted' ? 'var(--text-3)' : 'var(--text-1)';
  return (
    <div style={{padding:'6px 8px',background:'var(--bg-base)',borderRadius:'6px'}}>
      <div style={{fontSize:'9px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>{label}</div>
      <div style={{fontSize:'14px',fontWeight:700,color,fontVariantNumeric:'tabular-nums',marginTop:'2px'}}>{value}</div>
      {sub && <div style={{fontSize:'9px',color:'var(--text-3)',marginTop:'1px'}}>{sub}</div>}
    </div>
  );
}

// ROI progress bar — the gamification element.
// Bar fills proportional to (income / totalInvested) capped at 3x.
// Color: red <1x, amber 1-3x, green ≥3x. Markers at 1x and 3x.

export function ROIBar({ stats }) {
  const { trueROI, cashROI, incomeAttributed, totalInvested, cashSpent, timeCost } = stats;
  const roi = trueROI || 0;
  const fillPct = Math.min(100, (roi / 3) * 100);
  const color = roi >= 3 ? 'var(--green)' : roi >= 1 ? '#f59e0b' : 'var(--red)';
  const subLabel = roi >= 3 ? '🔥 3x+ ROI — keep feeding this system'
    : roi >= 1 ? '✓ Profitable — room to grow'
    : roi > 0 ? '⚠ Underwater — diagnose or cut'
    : '📊 Awaiting income attribution';
  return (
    <div style={{marginTop:'10px',padding:'10px',background:'var(--bg-base)',borderRadius:'8px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
        <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Operations ROI (cash + time)</span>
        <span style={{fontSize:'16px',fontWeight:800,color,fontVariantNumeric:'tabular-nums'}}>{roi > 0 ? `${roi.toFixed(2)}x` : '—'}</span>
      </div>
      <div style={{position:'relative',height:'10px',background:'var(--bg-hover)',borderRadius:'5px',overflow:'hidden',border:'1px solid var(--border)'}}>
        <div style={{width:`${fillPct}%`,height:'100%',background:`linear-gradient(90deg, ${color} 0%, ${color} 100%)`,transition:'width 0.5s'}}/>
        {/* Threshold markers */}
        <div style={{position:'absolute',top:'-2px',bottom:'-2px',left:'33.33%',width:'2px',background:'var(--text-3)',opacity:0.6}} title="1.0x break-even"/>
        <div style={{position:'absolute',top:'-2px',bottom:'-2px',left:'100%',marginLeft:'-2px',width:'2px',background:'var(--accent)'}} title="3.0x target"/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:'9px',color:'var(--text-3)',marginTop:'3px'}}>
        <span>0x</span>
        <span style={{textAlign:'center',flex:1}}>1x break-even</span>
        <span style={{color:'var(--accent)',fontWeight:700}}>3x target</span>
      </div>
      <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.4}}>
        <strong style={{color}}>{subLabel}</strong>
      </div>
      <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px',display:'flex',gap:'14px',flexWrap:'wrap',fontVariantNumeric:'tabular-nums'}}>
        <span>Income: <strong style={{color:'var(--text-2)'}}>{fmtUSD(incomeAttributed)}</strong></span>
        <span>÷ (Cash <strong style={{color:'var(--text-2)'}}>{fmtUSD(cashSpent)}</strong> + Time <strong style={{color:'var(--text-2)'}}>{fmtUSD(timeCost)}</strong>)</span>
        <span>= <strong style={{color:'var(--text-2)'}}>{fmtUSD(totalInvested)}</strong></span>
        {cashROI !== null && cashROI !== trueROI && (
          <span style={{fontStyle:'italic'}}>Cash-only ROI: {cashROI.toFixed(2)}x</span>
        )}
      </div>
    </div>
  );
}


export function TimeEntryModal({ userId, system, onClose, onSaved }) {


  useBackClose(onClose);
  const [date, setDate] = useState(today_ymd());
  const [minutes, setMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const m = Number(minutes);
    if (!m || m <= 0) {
      if (window.__notify) window.__notify('Enter minutes', 'error'); return;
    }
    setSaving(true);
    const { error } = await supabase.from('time_entries').insert({
      user_id: userId, lead_gen_system_id: system.id,
      occurred_at: new Date(date + 'T12:00:00').toISOString(),
      minutes: m, description: description.trim() || null,
    });
    setSaving(false);
    if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); return; }
    onSaved();
  }

  const quickTimes = [15, 30, 60, 90, 120];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'420px'}}>
        <h3 style={{margin:'0 0 6px'}}>Log time</h3>
        <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 14px'}}>
          Logging time for <strong style={{color:'var(--text-2)'}}>{system.name}</strong>. Used for Time-ROI calculations, never appears on tax reports.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{flex:2}}>
              <label className="form-label">Minutes</label>
              <input className="form-input" type="number" min="1" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="e.g. 45" autoFocus required />
              <div style={{display:'flex',gap:'4px',marginTop:'6px',flexWrap:'wrap'}}>
                {quickTimes.map(m => (
                  <button key={m} type="button" onClick={() => setMinutes(String(m))}
                    style={{padding:'3px 8px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',fontSize:'11px',cursor:'pointer'}}>
                    {m}m
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">What did you work on? (optional)</label>
            <input className="form-input" type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Called SOI list, drafted social posts" />
          </div>
          <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : <><Icon name="clock" size={13} /> Log time</>}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


export function SystemModal({ userId, initial, onClose, onSaved }) {


  useBackClose(onClose);
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState(initial?.category || 'digital');
  const [description, setDescription] = useState(initial?.description || '');
  const [monthlyBudget, setMonthlyBudget] = useState(initial?.monthly_budget || 0);
  const [color, setColor] = useState(initial?.color || '#6c63ff');
  const [tasks, setTasks] = useState(() => {
    const t = Array.isArray(initial?.daily_tasks) ? initial.daily_tasks : [];
    return t.length > 0 ? t : [{ id: crypto.randomUUID(), desc: '', daily_target: 1 }];
  });
  const [saving, setSaving] = useState(false);

  function addTask() { setTasks(prev => [...prev, { id: crypto.randomUUID(), desc: '', daily_target: 1 }]); }
  function removeTask(id) { setTasks(prev => prev.filter(t => t.id !== id)); }
  function updateTask(id, patch) { setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { if (window.__notify) window.__notify('Name is required', 'error'); return; }
    setSaving(true);
    const cleanTasks = tasks.filter(t => t.desc.trim()).map(t => ({
      id: t.id, desc: t.desc.trim(), daily_target: Math.max(1, Number(t.daily_target) || 1),
    }));
    const payload = {
      user_id: userId, name: name.trim(), category, description: description.trim() || null,
      monthly_budget: Number(monthlyBudget) || 0, color, daily_tasks: cleanTasks,
    };
    if (initial) {
      const { error } = await supabase.from('lead_gen_systems').update(payload).eq('id', initial.id);
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('lead_gen_systems').insert(payload);
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  }

  async function handleDelete() {
    if (!initial || initial.is_overhead) return;
    if (!await confirmDialog(`Archive "${initial.name}"?\n\nIt moves to the Archived section and stops showing on Today. All logged time, expenses, and income stay saved and keep counting — nothing is deleted. You can restore it anytime.`)) return;
    await supabase.from('lead_gen_systems').update({ is_archived: true, is_active: false, archived_at: new Date().toISOString() }).eq('id', initial.id);
    onSaved();
  }

  const colorOptions = ['#6c63ff','#ef4444','#f59e0b','#22c55e','#3b82f6','#ec4899','#06b6d4','#c5a95e','#8b5cf6','#10b981'];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'560px',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
          <h3 style={{margin:0}}>{initial ? 'Edit system' : 'Activate new system'}</h3>
          {initial && !initial.is_overhead && (
            <button onClick={handleDelete} title="Archive system (keeps all data)" style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'18px',padding:'4px 8px'}}><Icon name="archive" size={16} /></button>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Facebook Ads, Geographic Farm, Sphere of Influence" autoFocus required />
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Category</label>
              <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="digital">Digital</option>
                <option value="traditional">Traditional</option>
                <option value="niche">Niche</option>
              </select>
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Monthly budget</label>
              <input className="form-input" type="number" step="1" value={monthlyBudget} onChange={e => setMonthlyBudget(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this system, who does it target, what's the play?" rows={2} />
          </div>
          <div className="form-group">
            <label className="form-label">Color</label>
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              {colorOptions.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  style={{width:'28px',height:'28px',borderRadius:'6px',background:c,border:color===c?'3px solid var(--text-1)':'2px solid var(--border)',cursor:'pointer'}}/>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Daily prospecting tasks</label>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',fontStyle:'italic'}}>
              Concrete things you'll do daily for this system. Show on Dashboard for one-tap check-off.
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
              {tasks.map(t => (
                <div key={t.id} style={{display:'flex',gap:'6px',alignItems:'center'}}>
                  <input type="text" value={t.desc} onChange={e => updateTask(t.id, { desc: e.target.value })}
                    placeholder="e.g. Make 10 calls to SOI"
                    style={{flex:1,padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px'}}/>
                  <input type="number" min="1" step="1" value={t.daily_target}
                    onChange={e => updateTask(t.id, { daily_target: Math.max(1, Number(e.target.value) || 1) })}
                    style={{width:'70px',padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',textAlign:'center',fontVariantNumeric:'tabular-nums'}}
                    title="Daily target"/>
                  <button type="button" onClick={() => removeTask(t.id)}
                    style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'16px',padding:'4px 8px'}}>×</button>
                </div>
              ))}
              <button type="button" onClick={addTask}
                style={{padding:'6px 10px',background:'var(--bg-hover)',border:'1px dashed var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'12px',fontWeight:600}}>+ Add task</button>
            </div>
          </div>
          <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Activate system'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── TemplateLibraryModal — browse the 85 lead-gen systems ──────────

export function TemplateLibraryModal({ templates, activeNames, atCap, maxSystems, isCoach, onClose, onPick, asPage = false }) {
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [discFilter, setDiscFilter] = useState('all');  // 'all' | 'D' | 'I' | 'S' | 'C'
  const [discSecondary, setDiscSecondary] = useState('none');  // optional blend: 'none' | 'D' | 'I' | 'S' | 'C'

  const SECTION_COLORS = {
    digital: '#3b82f6',
    traditional: '#22c55e',
    niche: '#c5a95e',
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(t => {
      if (sectionFilter !== 'all' && t.section !== sectionFilter) return false;
      if (discFilter !== 'all') {
        const fit = t[`disc_${discFilter.toLowerCase()}`];
        if (fit !== 'best') return false;
      }
      if (q) {
        const hay = `${t.name} ${t.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, search, sectionFilter, discFilter]);

  // Group by section for nice display; when a blend letter is chosen, float
  // its best-fit systems to the top of each group (refine, don't exclude).
  const grouped = useMemo(() => {
    const g = { digital: [], traditional: [], niche: [] };
    filtered.forEach(t => { if (g[t.section]) g[t.section].push(t); });
    if (discSecondary !== 'none') {
      const rank = { best: 0, ok: 1, hard: 2 };
      const key = `disc_${discSecondary.toLowerCase()}`;
      Object.keys(g).forEach(sec => {
        g[sec].sort((a, b) => {
          const ra = rank[a[key]] ?? 3, rb = rank[b[key]] ?? 3;
          if (ra !== rb) return ra - rb;
          return (a.system_number || 0) - (b.system_number || 0);
        });
      });
    }
    return g;
  }, [filtered, discSecondary]);

  return (
    <div className={asPage ? '' : 'modal-backdrop'} onClick={asPage ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={asPage ? 'panel' : 'modal'} style={asPage ? { maxWidth: '100%', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' } : { maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
        {/* Header (sticky) */}
        <div style={{padding:'16px 16px 12px',borderBottom:'1px solid var(--border)',background:'var(--bg-card)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <h3 style={{margin:0,fontSize:'15px',display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="library" size={15} /> Lead-Gen System Library</h3>
            {asPage
              ? <button onClick={onClose} style={{background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',fontWeight:700,color:'var(--text-2)',cursor:'pointer',padding:'5px 10px'}}>← Manage</button>
              : <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>}
          </div>
          <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'10px'}}>
            {filtered.length} of {templates.length} systems · {atCap ? `at cap (${maxSystems}) — coach can raise` : isCoach ? 'coach mode: unlimited' : `slots open`}
          </div>
          <input
            type="text" placeholder="🔍 Search by name or description…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{width:'100%',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--text-1)',fontSize:'13px',marginBottom:'8px'}}
          />
          <div style={{display:'flex',gap:'4px',flexWrap:'wrap',marginBottom:'6px'}}>
            {[['all','All'],['digital','Digital'],['traditional','Traditional'],['niche','Niche']].map(([id, label]) => (
              <button key={id} onClick={() => setSectionFilter(id)}
                style={{padding:'4px 10px',border:'none',borderRadius:'999px',fontSize:'11px',fontWeight:600,cursor:'pointer',
                  background: sectionFilter === id ? 'var(--accent)' : 'var(--bg-hover)',
                  color: sectionFilter === id ? 'var(--bg-base)' : 'var(--text-2)'}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center',marginBottom:'4px'}}>
            <span style={{color:'var(--text-3)',fontSize:'11px',marginRight:'2px'}}>Best fit for:</span>
            {['all','D','I','S','C'].map(d => (
              <button key={d} onClick={() => { setDiscFilter(d); setDiscSecondary('none'); }}
                style={{padding:'4px 10px',border:'1px solid var(--border)',borderRadius:'999px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                  background: discFilter === d ? 'var(--text-1)' : 'transparent',
                  color: discFilter === d ? 'var(--bg-base)' : 'var(--text-3)'}}>
                {d === 'all' ? 'Any' : d}
              </button>
            ))}
          </div>
          {discFilter !== 'all' && (
            <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center',marginBottom:'4px'}}>
              <span style={{color:'var(--text-3)',fontSize:'11px',marginRight:'2px'}}>+ blend:</span>
              {['none','D','I','S','C'].filter(d => d === 'none' || d !== discFilter).map(d => (
                <button key={d} onClick={() => setDiscSecondary(d)}
                  style={{padding:'4px 10px',border:'1px solid var(--border)',borderRadius:'999px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                    background: discSecondary === d ? 'var(--accent)' : 'transparent',
                    color: discSecondary === d ? 'var(--bg-base)' : 'var(--text-3)'}}>
                  {d === 'none' ? 'None' : d}
                </button>
              ))}
            </div>
          )}
          {discFilter !== 'all' && discSecondary !== 'none' && (
            <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginBottom:'4px'}}>
              Best-fit {discFilter} systems, with {discSecondary}-friendly ones first.
            </div>
          )}
        </div>

        {/* Scrolling list */}
        <div style={{padding:'12px 16px',overflowY:'auto',flex:1}}>
          {filtered.length === 0 ? (
            <p style={{textAlign:'center',color:'var(--text-3)',padding:'40px 20px',fontStyle:'italic'}}>No systems match these filters.</p>
          ) : (
            ['digital','traditional','niche'].map(sec => {
              const items = grouped[sec];
              if (!items || items.length === 0) return null;
              const secLabel = sec.charAt(0).toUpperCase() + sec.slice(1);
              return (
                <div key={sec} style={{marginBottom:'14px'}}>
                  <div style={{fontSize:'10px',color:SECTION_COLORS[sec],textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:800,marginBottom:'6px'}}>
                    {secLabel} · {items.length}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                    {items.map(t => {
                      const alreadyActive = activeNames.has(t.name.toLowerCase());
                      return (
                        <button key={t.id} onClick={() => onPick(t)}
                          style={{textAlign:'left',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',cursor:'pointer',color:'var(--text-1)',width:'100%'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',flexWrap:'wrap'}}>
                            <span style={{fontSize:'10px',color:'var(--text-3)',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>#{t.system_number}</span>
                            <strong style={{fontSize:'13px',flex:1,minWidth:0}}>{t.name}</strong>
                            {alreadyActive && <span style={{fontSize:'9px',color:'var(--green)',padding:'1px 6px',background:'rgba(34,197,94,0.15)',borderRadius:'3px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>✓ Active</span>}
                          </div>
                          <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 6px',lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{t.description}</p>
                          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',fontSize:'10px',color:'var(--text-3)'}}>
                            {['D','I','S','C'].map(letter => {
                              const fit = t[`disc_${letter.toLowerCase()}`];
                              const fitColor = fit === 'best' ? 'var(--green)' : fit === 'ok' ? '#f59e0b' : fit === 'hard' ? 'var(--red)' : 'var(--text-3)';
                              return (
                                <span key={letter} style={{padding:'1px 5px',borderRadius:'3px',background:`${fitColor}1a`,color:fitColor,fontSize:'9px',fontWeight:700}}>
                                  {letter}:{fit ? fit[0].toUpperCase() : '—'}
                                </span>
                              );
                            })}
                            <span style={{color:'var(--text-3)'}}>·</span>
                            <span>{t.total_weekly_actions}/wk</span>
                            {t.suggested_monthly_budget && <span>· ${t.suggested_monthly_budget}/mo</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TemplateActivateModal — preview + activate a template ──────────

export function TemplateActivateModal({ userId, template, onClose, onActivated }) {

  useBackClose(onClose);
  const [monthlyBudget, setMonthlyBudget] = useState(Number(template.suggested_monthly_budget) || 0);
  const [color, setColor] = useState(
    template.section === 'digital' ? '#3b82f6'
    : template.section === 'traditional' ? '#22c55e'
    : '#c5a95e'
  );
  const [saving, setSaving] = useState(false);

  // Convert each weekly task to a daily task (spread across 5 working days,
  // rounded up, minimum 1). Description gets a "(N×/wk)" suffix so the
  // weekly cadence stays visible to the agent.
  const weeklyTasks = Array.isArray(template.weekly_tasks) ? template.weekly_tasks : [];
  const dailyTasks = weeklyTasks.map(t => ({
    id: t.id || crypto.randomUUID(),
    desc: t.desc + (t.weekly_target ? ` (${t.weekly_target}×/wk)` : ''),
    daily_target: Math.max(1, Math.round(Number(t.weekly_target || 1) / 5)),
  }));

  async function handleActivate() {
    setSaving(true);
    const { error } = await supabase.from('lead_gen_systems').insert({
      user_id: userId,
      name: template.name,
      category: template.section,
      description: template.description,
      monthly_budget: Number(monthlyBudget) || 0,
      color,
      daily_tasks: dailyTasks,
      target_leads_per_month: 0,
    });
    setSaving(false);
    if (error) { if (window.__notify) window.__notify('Activation failed: ' + error.message, 'error'); return; }
    if (window.__notify) window.__notify(`Activated "${template.name}"`, 'success');
    onActivated();
  }

  const colorOptions = ['#6c63ff','#ef4444','#f59e0b','#22c55e','#3b82f6','#ec4899','#06b6d4','#c5a95e','#8b5cf6','#10b981'];
  const sectionLabel = template.section.charAt(0).toUpperCase() + template.section.slice(1);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'560px',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
          <div>
            <div style={{fontSize:'10px',color:'var(--text-3)',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>
              #{template.system_number} · {sectionLabel} · {template.total_weekly_actions} actions/wk
            </div>
            <h3 style={{margin:'2px 0 0',fontSize:'16px'}}>{template.name}</h3>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer'}}>×</button>
        </div>

        <p style={{fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,marginBottom:'12px'}}>{template.description}</p>

        {template.coach_read && (
          <div style={{padding:'10px',background:'rgba(197,169,94,0.08)',borderLeft:'3px solid var(--accent)',borderRadius:'4px',marginBottom:'12px'}}>
            <div style={{fontSize:'10px',color:'var(--accent)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'3px'}}>Coach's read</div>
            <p style={{fontSize:'12px',color:'var(--text-1)',fontStyle:'italic',margin:0,lineHeight:1.4}}>{template.coach_read}</p>
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px',marginBottom:'12px'}}>
          {['D','I','S','C'].map(letter => {
            const fit = template[`disc_${letter.toLowerCase()}`];
            const fitColor = fit === 'best' ? 'var(--green)' : fit === 'ok' ? '#f59e0b' : fit === 'hard' ? 'var(--red)' : 'var(--text-3)';
            const fitLabel = fit === 'best' ? 'BEST FIT' : fit === 'ok' ? 'OK FIT' : fit === 'hard' ? 'HARD' : '—';
            return (
              <div key={letter} style={{padding:'8px 4px',background:`${fitColor}14`,border:`1px solid ${fitColor}55`,borderRadius:'6px',textAlign:'center'}}>
                <div style={{fontSize:'14px',fontWeight:800,color:fitColor}}>{letter}</div>
                <div style={{fontSize:'9px',color:fitColor,fontWeight:700,letterSpacing:'0.04em'}}>{fitLabel}</div>
              </div>
            );
          })}
        </div>

        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Monthly budget</label>
            <input className="form-input" type="number" step="10" value={monthlyBudget} onChange={e => setMonthlyBudget(Number(e.target.value) || 0)} />
            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>Suggested: ${template.suggested_monthly_budget}</div>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Color</label>
            <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
              {colorOptions.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  style={{width:'22px',height:'22px',borderRadius:'5px',background:c,border:color===c?'3px solid var(--text-1)':'2px solid var(--border)',cursor:'pointer'}}/>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Weekly execution ({weeklyTasks.length} tasks)</label>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'6px',fontStyle:'italic'}}>
            Daily targets calculated from weekly cadence (÷5 working days, rounded up). Adjust after activation in the system's edit modal.
          </div>
          <div style={{background:'var(--bg-base)',borderRadius:'6px',padding:'8px',maxHeight:'200px',overflowY:'auto'}}>
            {weeklyTasks.map((t, i) => (
              <div key={i} style={{padding:'4px 0',fontSize:'11px',color:'var(--text-2)',borderBottom:i<weeklyTasks.length-1?'1px solid var(--border)':'none',display:'flex',justifyContent:'space-between',gap:'8px'}}>
                <span style={{flex:1,minWidth:0}}>• {t.desc}</span>
                <span style={{color:'var(--text-3)',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{t.weekly_target}×/wk</span>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleActivate} disabled={saving} style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {saving ? 'Activating…' : '✓ Activate System'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FinanceReports ──────────────────────────────────────────────────
// Two reports: Business/Tax (CPA handoff) and Personal (if tracking is on).
// PLUS the Operations ROI report — time-cost included, gamified.

