import React, { useState } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { SYSTEMS } from '../systemHealth';
import { modal } from '../helpers';

function PlaybooksView({ brain, playbookSteps, setPlaybookSteps, playbookRuns, setPlaybookRuns, tasks, setTasks, userId, setView, setTaskFilter, events = [] }) {
  const playbooks = brain.filter(b => b.type === 'playbook');
  const [parsingId, setParsingId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedRunId, setExpandedRunId] = useState(null);  // Pass 4 #7
  const [showRunModal, setShowRunModal] = useState(null); // playbook obj
  const [runNote, setRunNote] = useState('');
  const [flash, setFlash] = useState(null);

  function stepsFor(pbId) {
    return playbookSteps.filter(s => s.brain_entry_id === pbId).sort((a,b) => a.step_order - b.step_order);
  }
  function runsFor(pbId) {
    return playbookRuns.filter(r => r.brain_entry_id === pbId);
  }
  const totalRuns = playbookRuns.length;
  const last7dRuns = playbookRuns.filter(r => (new Date(r.created_at) > new Date(Date.now() - 7*864e5))).length;

  async function reparse(playbook) {
    setParsingId(playbook.id);
    try {
      const { data, error } = await supabase.functions.invoke('playbook-parse', {
        body: { brain_entry_id: playbook.id, user_id: userId }
      });
      if (error || data?.error) {
        setFlash({ type: 'error', text: `Parse failed: ${error?.message || data?.error}` });
      } else {
        // Refresh steps from DB
        const { data: refreshed } = await supabase.from('playbook_steps').select('*').order('step_order', { ascending: true });
        if (refreshed) setPlaybookSteps(refreshed);
        setFlash({ type: 'ok', text: `Re-parsed ${data.parsed} steps for ${playbook.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')}` });
      }
    } catch (e) {
      setFlash({ type: 'error', text: e.message });
    } finally {
      setParsingId(null);
      setTimeout(() => setFlash(null), 4000);
    }
  }

  async function runPlaybook(playbook, note) {
    setRunningId(playbook.id);
    try {
      const { data, error } = await supabase.rpc('run_playbook', {
        p_brain_entry_id: playbook.id,
        p_user_id: userId,
        p_trigger_note: note || null,
        p_context: {}
      });
      if (error) throw error;
      const tasksCreated = data?.tasks_created || 0;
      // Reload tasks and runs from DB to get fresh data with the new rows
      const [tRes, rRes] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('playbook_runs').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (tRes.data) setTasks(tRes.data);
      if (rRes.data) setPlaybookRuns(rRes.data);
      setShowRunModal(null);
      setRunNote('');
      setFlash({ type: 'ok', text: `▶ ${playbook.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')} launched — ${tasksCreated} tasks created` });
    } catch (e) {
      setFlash({ type: 'error', text: `Run failed: ${e.message}` });
    } finally {
      setRunningId(null);
      setTimeout(() => setFlash(null), 5000);
    }
  }

  function quadColor(q) {
    return { A: '#ef4444', B: 'var(--accent)', C: '#f59e0b', D: '#6b7280' }[q] || 'var(--text-3)';
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="playbooks" size={26} style={{color:'var(--accent)',flexShrink:0}} />Playbooks</h2><p>Your repeatable plays · {playbooks.length} playbooks · {totalRuns} total runs · {last7dRuns} this week</p></div>
      </div>

      {flash && (
        <div style={{
          padding:'10px 14px',
          marginBottom:'14px',
          borderRadius:'8px',
          background: flash.type === 'ok' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${flash.type === 'ok' ? '#22c55e' : '#ef4444'}`,
          color: flash.type === 'ok' ? '#22c55e' : '#ef4444',
          fontSize: '13px'
        }}>{flash.text}</div>
      )}

      {playbooks.length === 0 ? (
        <div className="panel"><div className="panel-body"><div className="empty-state" style={{padding:'40px 20px',textAlign:'center',maxWidth:'520px',margin:'0 auto'}}>
          <div className="empty-icon"><Icon name="library" size={28} /></div>
          <p style={{fontSize:'15px',color:'var(--text-1)',marginBottom:'8px'}}>No playbooks yet.</p>
          <p style={{fontSize:'13px',color:'var(--text-2)',marginBottom:'16px',lineHeight:1.5}}>
            Playbooks are step-by-step procedures you can trigger to spawn a batch
            of tasks &amp; events at once — useful for any recurring workflow
            (new listing, new client, weekly review, project kickoff…).
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setView('brain')}>
            → Create one in Brain
          </button>
          <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'12px'}}>
            In Brain, switch to the <strong>Playbooks</strong> tab and add a new entry.
            Claude auto-parses it into steps; the button to run it appears here.
          </p>
        </div></div></div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(420px, 1fr))', gap:'14px'}}>
          {playbooks.map(pb => {
            const steps = stepsFor(pb.id);
            const runs = runsFor(pb.id);
            const cleanTitle = pb.title.replace(/^PLAYBOOK\s*[—-]\s*/i, '');
            const isExpanded = expandedId === pb.id;
            return (
              <div key={pb.id} className="panel" style={{display:'flex',flexDirection:'column'}}>
                <div className="panel-body" style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                  <div>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'8px',justifyContent:'space-between'}}>
                      <h3 style={{margin:0, color:'var(--text-1)', fontSize:'16px', fontWeight:700, lineHeight:1.3}}>{cleanTitle}</h3>
                      {pb.pinned && <span title="Pinned" style={{color:'var(--accent)',fontSize:'12px'}}><Icon name="pin" size={12} /></span>}
                    </div>
                    <div style={{display:'flex',gap:'10px',marginTop:'6px',fontSize:'11px',color:'var(--text-3)'}}>
                      <span>{steps.length} {steps.length===1?'step':'steps'}</span>
                      <span>·</span>
                      <span>{runs.length} run{runs.length===1?'':'s'}</span>
                      {runs[0] && <><span>·</span><span>last: {new Date(runs[0].created_at).toLocaleDateString()}</span></>}
                    </div>
                  </div>

                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowRunModal(pb)}
                      disabled={steps.length === 0 || runningId === pb.id}
                      style={{flex:1, minWidth:'120px'}}
                    >
                      {runningId === pb.id ? 'Launching…' : '▶ Run Playbook'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpandedId(isExpanded ? null : pb.id)}
                    >
                      {isExpanded ? 'Hide steps' : 'View steps'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => reparse(pb)}
                      disabled={parsingId === pb.id}
                      title="Re-parse with Claude — use if you've edited the playbook content in Brain"
                    >
                      {parsingId === pb.id ? 'Parsing…' : '↻ Re-parse'}
                    </button>
                  </div>

                  {steps.length === 0 && (
                    <div style={{fontSize:'12px',color:'var(--text-3)',padding:'10px',background:'var(--bg-base)',borderRadius:'6px',border:'1px dashed var(--border)'}}>
                      No structured steps yet. Click <strong>↻ Re-parse</strong> to extract steps from the playbook prose.
                    </div>
                  )}

                  {isExpanded && steps.length > 0 && (
                    <div style={{display:'flex',flexDirection:'column',gap:'8px',marginTop:'2px'}}>
                      {steps.map(s => (
                        <div key={s.id} style={{padding:'10px 12px',background:'var(--bg-base)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <span title={`Quadrant ${s.default_quadrant}`} style={{
                              fontSize:'10px',fontWeight:700,
                              color: quadColor(s.default_quadrant),
                              border:`1px solid ${quadColor(s.default_quadrant)}`,
                              borderRadius:'4px',padding:'1px 5px',
                              minWidth:'18px',textAlign:'center'
                            }}>{s.default_quadrant}</span>
                            <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'13px',flex:1}}>{s.step_order}. {s.title}</span>
                            {s.due_offset_days !== null && s.due_offset_days !== undefined && (
                              <span style={{fontSize:'10px',color:'var(--text-3)',fontFamily:'monospace'}}>+{s.due_offset_days}d</span>
                            )}
                          </div>
                          {s.detail && <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px',paddingLeft:'30px',lineHeight:1.4}}>{s.detail}</div>}
                          {(s.owner || s.timing) && (
                            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',paddingLeft:'30px',display:'flex',gap:'12px'}}>
                              {s.owner && <span><span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="contacts" size={11} /> {s.owner}</span></span>}
                              {s.timing && <span><span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="clock" size={11} /> {s.timing}</span></span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {runs.length > 0 && (
                    <div style={{borderTop:'1px solid var(--border)',paddingTop:'10px',marginTop:'2px'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px'}}>Recent runs</div>
                      {runs.slice(0, 3).map(r => {
                        const isOpen = expandedRunId === r.id;
                        // Pass 4 #7: spawned tasks + events for this run
                        const spawnedTasks = tasks.filter(t => t.playbook_run_id === r.id);
                        const spawnedEvents = events.filter(e => e.playbook_run_id === r.id);
                        const totalSpawned = spawnedTasks.length + spawnedEvents.length;
                        return (
                          <div key={r.id} style={{padding:'2px 0'}}>
                            <div
                              onClick={() => setExpandedRunId(isOpen ? null : r.id)}
                              style={{display:'flex',gap:'8px',fontSize:'11px',color:'var(--text-2)',cursor: totalSpawned > 0 ? 'pointer' : 'default',alignItems:'center'}}>
                              <span style={{color:'var(--text-3)'}}>{new Date(r.created_at).toLocaleDateString()}</span>
                              <span>{r.tasks_created} tasks</span>
                              {r.trigger_note && <span style={{color:'var(--text-3)',fontStyle:'italic'}}>· {r.trigger_note.slice(0,40)}{r.trigger_note.length>40?'…':''}</span>}
                              {totalSpawned > 0 && (
                                <span style={{color:'var(--accent)',fontSize:'10px',marginLeft:'auto'}}>{isOpen ? '▾' : '▸'}</span>
                              )}
                            </div>
                            {isOpen && totalSpawned > 0 && (
                              <div style={{padding:'6px 10px 6px 16px',background:'var(--bg-base)',borderRadius:'4px',marginTop:'4px',border:'1px solid var(--border)'}}>
                                {spawnedTasks.length > 0 && (
                                  <>
                                    <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'3px'}}>Tasks ({spawnedTasks.length})</div>
                                    {spawnedTasks.map(t => (
                                      <div key={t.id} style={{fontSize:'11px',color: t.completed ? 'var(--text-3)' : 'var(--text-1)',textDecoration: t.completed ? 'line-through' : 'none',padding:'2px 0'}}>
                                        {t.completed ? '✓' : '○'} {t.title}
                                      </div>
                                    ))}
                                  </>
                                )}
                                {spawnedEvents.length > 0 && (
                                  <>
                                    <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',marginTop: spawnedTasks.length > 0 ? '6px' : '0',marginBottom:'3px'}}>Events ({spawnedEvents.length})</div>
                                    {spawnedEvents.map(ev => (
                                      <div key={ev.id} style={{fontSize:'11px',color:'var(--text-1)',padding:'2px 0'}}>
                                        <Icon name="calendar" size={11} /> {ev.title} {ev.start_at && <span style={{color:'var(--text-3)',fontSize:'10px'}}>· {new Date(ev.start_at).toLocaleDateString()}</span>}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Run Playbook modal */}
      {showRunModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowRunModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <h3>▶ Run Playbook</h3>
              <button className="modal-close" onClick={() => setShowRunModal(null)}>×</button>
            </div>
            <div style={{padding:'0 0 14px'}}>
              <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--accent-dim)',borderRadius:'8px',marginBottom:'14px'}}>
                <div style={{fontSize:'10px',color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:700}}>Playbook</div>
                <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:600}}>{showRunModal.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')}</div>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'6px'}}>
                  Will create {stepsFor(showRunModal.id).length} tasks scheduled across the next {Math.max(0, ...stepsFor(showRunModal.id).map(s=>s.due_offset_days||0))} days.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Context note <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(who/what this run is for — optional)</span></label>
                <input className="form-input" value={runNote} onChange={e=>setRunNote(e.target.value)} placeholder='e.g. "123 Oak St listing", "Buyer: Smith", "Recruit: Anvar"' autoFocus />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowRunModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => runPlaybook(showRunModal, runNote)} disabled={runningId !== null}>
                {runningId ? 'Launching…' : '▶ Launch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
/* ─────────────────────────────────────────────────────────────
   SYSTEMS — infrastructure health dashboard.
   Each system has an async check() returning:
     { status: 'healthy' | 'degraded' | 'down' | 'unconfigured' | 'unknown',
       detail: string, meta?: object }
   TO HOOK UP A NEW SYSTEM: add an entry to SYSTEMS with a check() fn.
   A null check renders as "Not wired" so it stays a visible TODO.
   ───────────────────────────────────────────────────────────── */

export default PlaybooksView;
