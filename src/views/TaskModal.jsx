// TaskModal — create/edit a task (priority, due date, auto-schedule, Ari rewrite).
// Extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { QUADRANTS, todayISO } from '../helpers';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import AriRewriteButton from './AriRewriteButton';
import AutoScheduleFields from './AutoScheduleFields';
import DatePickerModal from './DatePickerModal';

export default function TaskModal({ onClose, onSave, onDelete, initial, defaultSystem, brain, contacts = [], properties = [], events = [], userId }) {

  useBackClose(onClose);
  const initialSystem = initial?.priority_system || defaultSystem || 'eisenhower';
  const [title, setTitle] = useState(initial?.title || '');
  const [system, setSystem] = useState(initialSystem);
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [quadrant, setQuadrant] = useState(initial?.eisenhower_quadrant || 'A');
  const [rank, setRank] = useState(initial?.eisenhower_rank ?? 1);
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [completed, setCompleted] = useState(!!initial?.completed);
  const [brainEntryId, setBrainEntryId] = useState(initial?.brain_entry_id || '');
  const [propertyId, setPropertyId] = useState(initial?.property_id || '');
  const [recurring, setRecurring] = useState(
    initial?.recurring_config?.interval || 'none'
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  // Linked contacts (many-to-many via task_contacts)
  const [contactIds, setContactIds] = useState(initial?._contact_ids || []);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  // Email assignment (works for any task)
  const [emailMode, setEmailMode] = useState(initial?.assignment_method === 'email');
  const [emailTo, setEmailTo] = useState(initial?.assignee_email || '');
  const [emailMsg, setEmailMsg] = useState('');
  const emailAlreadySent = !!(initial && initial.email_thread_id);

  // Auto-scheduling — handled by the shared <AutoScheduleFields> component below.
  const [schedFields, setSchedFields] = useState({});

  // Load existing contact links when editing
  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('task_contacts')
        .select('contact_id').eq('task_id', initial.id);
      if (!cancelled && data) setContactIds(data.map(r => r.contact_id));
    })();
    return () => { cancelled = true; };
  }, [initial?.id]);

  const linkedContacts = contactIds.map(id => contacts.find(c => c.id === id)).filter(Boolean);
  const filteredContactOptions = (() => {
    const q = contactQuery.trim().toLowerCase();
    const base = contacts.filter(c => !contactIds.includes(c.id));
    if (!q) return base.slice(0, 20);
    return base.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    ).slice(0, 20);
  })();

  // AI quadrant suggestion
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  async function suggestQuadrant() {
    if (!title.trim()) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke('task-quadrant-suggest', {
        body: { title: title.trim(), notes: notes.trim() || null, due_date: due_date || null }
      });
      if (error || data?.error) {
        setSuggestion({ error: error?.message || data?.error });
      } else {
        setSuggestion(data);
        if (system === 'eisenhower' && data.quadrant) {
          setQuadrant(data.quadrant);
        } else {
          // Translate quadrant to simple priority
          const map = { A: 'high', B: 'medium', C: 'medium', D: 'low' };
          if (data.quadrant) setPriority(map[data.quadrant]);
        }
      }
    } catch (e) {
      setSuggestion({ error: e.message });
    } finally {
      setSuggesting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const recurring_config = recurring === 'none' ? null : { interval: recurring };
    const base = {
      title: title.trim(),
      due_date: due_date || null,
      notes: notes.trim(),
      completed,
      completed_at: completed ? (initial?.completed_at || new Date().toISOString()) : null,
      priority_system: system,
      brain_entry_id: brainEntryId || null,
      property_id: propertyId || null,
      recurring_config,
      recurring: recurring === 'none' ? null : recurring,  // legacy text column
      assignee_email: emailMode ? (emailTo.trim() || null) : null,
      assignment_method: emailMode ? 'email' : (initial?.assignment_method || 'self'),
      // Auto-scheduling (from shared component)
      ...schedFields,
      _email: (emailMode && emailTo.trim() && !emailAlreadySent) ? { to: emailTo.trim(), subject: title.trim(), body: emailMsg } : null,
    };
    if (system === 'eisenhower') {
      const r = Math.max(1, parseInt(rank, 10) || 1);
      onSave({ ...base, priority: 'medium', eisenhower_quadrant: quadrant, eisenhower_rank: r, _contact_ids: contactIds });
    } else {
      onSave({ ...base, priority, eisenhower_quadrant: null, eisenhower_rank: null, _contact_ids: contactIds });
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'640px',width:'min(640px,100%)',padding:0,maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* HEADER — title row and ACTION row are separate on purpose. Cramming
            the title, two labelled pills and a close button into one flex row
            collapsed at Dara's large system font: "Edit Task" wrapped to two
            lines and ran underneath the pills. Same class of bug as the
            hamburger (v1.03.13) and the Inbox pills (v1.03.28). A row that
            holds only at default font scale is broken, not tight. */}
        <div style={{padding:'14px 16px 0',borderBottom:'1px solid var(--border)',background:'linear-gradient(180deg, rgba(197,169,94,0.10), transparent)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:'11px',minWidth:0}}>
            <span style={{width:'34px',height:'34px',borderRadius:'10px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(197,169,94,0.14)',border:'1px solid var(--accent)',color:'var(--accent)'}}><Icon name="tasks" size={17} /></span>
            <div style={{minWidth:0,flex:1}}>
              <h3 style={{margin:0,fontSize:'17px',fontWeight:800,color:'var(--text-1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{initial ? 'Edit Task' : 'New Task'}</h3>
              {completed && <div style={{fontSize:'11px',color:'var(--green)',fontWeight:700}}>✓ Completed</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'24px',lineHeight:1,cursor:'pointer',padding:'0 2px',flexShrink:0}}>×</button>
          </div>

          {initial && initial.id && (
            <div style={{display:'flex',gap:'7px',padding:'12px 0 13px'}}>
              {/* Three verbs, equal weight, each its own colour so the
                  destructive one can never be mistaken for the routine one. */}
              {[
                { key:'someday', label:'Someday', tone:'var(--accent)', tint:'rgba(197,169,94,0.13)',
                  active:false, title:'Keep it, but off the active list',
                  icon:(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.5 6.5 0 0 0 11 11z"/></svg>),
                  onClick: async()=>{ try{ const { data } = await supabase.rpc('tasks_park_someday',{ p_task_ids:[initial.id], p_note:null }); if(data?.ok){ if(window.__notify) window.__notify('Moved to Someday / Maybe.','success'); onClose && onClose(true); } }catch(e){ if(window.__notify) window.__notify('Could not move: '+(e.message||e),'error'); } } },
                { key:'complete', label: completed?'Completed':'Complete', tone:'var(--green)', tint:'rgba(34,197,94,0.15)',
                  active: completed, title: completed?'Mark as not complete':'Mark complete',
                  icon:(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/>{completed && <polyline points="8 12 11 15 16 9" />}</svg>),
                  onClick: ()=>setCompleted(c=>!c) },
                { key:'delete', label:'Delete', tone:'var(--red)', tint:'rgba(239,68,68,0.13)',
                  active:false, title:'Delete permanently — use this for duplicates, not \u201Ccomplete\u201D',
                  icon:(<Icon name="trash" size={15} />),
                  onClick: ()=>{ if (onDelete) return onDelete(initial); if (window.__notify) window.__notify('Delete is not available from this screen yet.','error'); } },
              ].map(b => (
                <button key={b.key} type="button" onClick={b.onClick} title={b.title} aria-label={b.label}
                  aria-pressed={b.key==='complete' ? completed : undefined}
                  style={{flex:'1 1 0',minWidth:0,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'6px',
                    padding:'9px 6px',minHeight:'42px',borderRadius:'11px',cursor:'pointer',
                    fontSize:'12px',fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',
                    border:'1px solid '+(b.active ? b.tone : 'var(--border-strong)'),
                    background: b.active ? b.tint : 'transparent',
                    color: b.active ? b.tone : 'var(--text-2)'}}
                  onMouseEnter={e=>{ e.currentTarget.style.color=b.tone; e.currentTarget.style.borderColor=b.tone; e.currentTarget.style.background=b.tint; }}
                  onMouseLeave={e=>{ if(!b.active){ e.currentTarget.style.color='var(--text-2)'; e.currentTarget.style.borderColor='var(--border-strong)'; e.currentTarget.style.background='transparent'; } }}>
                  <span style={{flexShrink:0,display:'inline-flex'}}>{b.icon}</span>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{b.label}</span>
                </button>
              ))}
            </div>
          )}
          {!(initial && initial.id) && <div style={{height:'14px'}} />}
        </div>
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',minHeight:0,flex:1,overflow:'hidden'}}>
          <div style={{overflowY:'auto',padding:'18px 20px',flex:1}}>
          <div className="form-group"><label className="form-label">Task</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to get done?" autoFocus required /></div>
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--text-3)',margin:'4px 0 12px',paddingTop:'16px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'7px'}}><Icon name="target" size={12} style={{color:'var(--accent)'}} />Priority &amp; focus</div>
          <div className="form-group">
            <label className="form-label">Priority System</label>
            <div style={{display:'flex',gap:'6px'}}>
              <button type="button" className={`btn btn-sm ${system==='eisenhower'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('eisenhower')}>Eisenhower (A1, B2…)</button>
              <button type="button" className={`btn btn-sm ${system==='simple'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('simple')}>Simple (High/Med/Low)</button>
            </div>
          </div>
          {system === 'eisenhower' ? (
            <div className="form-row">
              <div className="form-group" style={{flex:2}}>
                <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                  <span>Quadrant</span>
                  <button
                    type="button"
                    onClick={suggestQuadrant}
                    disabled={!title.trim() || suggesting}
                    className="btn btn-sm btn-ghost"
                    style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}
                    title="Ask Claude to suggest the right quadrant"
                  >
                    {suggesting ? '…thinking' : <><Icon name="sparkles" size={11} /> Suggest</>}
                  </button>
                </label>
                <select className="form-select" value={quadrant} onChange={e=>setQuadrant(e.target.value)}>
                  {QUADRANTS.map(q => <option key={q.letter} value={q.letter}>{q.label} · {q.short}</option>)}
                </select>
              </div>
              <div className="form-group" style={{flex:1}}>
                <label className="form-label">Rank</label>
                <input className="form-input" type="number" min="1" value={rank} onChange={e=>setRank(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                <span>Priority</span>
                <button
                  type="button"
                  onClick={suggestQuadrant}
                  disabled={!title.trim() || suggesting}
                  className="btn btn-sm btn-ghost"
                  style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}
                  title="Ask Claude to suggest"
                >
                  {suggesting ? '…thinking' : <><Icon name="sparkles" size={11} /> Suggest</>}
                </button>
              </label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          )}
          {suggestion && !suggestion.error && (
            <div style={{padding:'8px 12px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'6px',marginBottom:'10px',fontSize:'12px'}}>
              <div style={{color:'var(--accent)',fontWeight:600,marginBottom:'2px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="sparkles" size={12} /> Claude suggests <strong>{suggestion.quadrant}</strong> · confidence {Math.round((suggestion.confidence||0)*100)}%</div>
              <div style={{color:'var(--text-2)',lineHeight:1.4}}>{suggestion.reasoning}</div>
            </div>
          )}
          {suggestion?.error && (
            <div style={{padding:'8px 12px',background:'rgba(239,68,68,0.1)',border:'1px solid #ef4444',borderRadius:'6px',marginBottom:'10px',fontSize:'12px',color:'#ef4444'}}>
              Suggest failed: {suggestion.error}
            </div>
          )}
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--text-3)',margin:'4px 0 12px',paddingTop:'16px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'7px'}}><Icon name="calendar" size={12} style={{color:'var(--accent)'}} />Schedule</div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}>
              <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Due Date {!due_date && <span style={{color:'var(--text-3)',fontSize:'10px',fontWeight:400}}>· Someday/Maybe (no date)</span>}</span>
                {due_date && (
                  <button type="button" onClick={() => setDueDate('')}
                    style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'10px',cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.03em',padding:0}}>
                    × Clear
                  </button>
                )}
              </label>
              <button type="button" className="form-input" onClick={() => setShowDatePicker(true)}
                style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',cursor:'pointer',textAlign:'left',width:'100%'}}>
                <span style={{color: due_date ? 'var(--text-1)' : 'var(--text-3)'}}>
                  {due_date ? new Date(due_date + 'T00:00:00').toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'}) : 'Select a date…'}
                </span>
                <Icon name="calendar" size={14} style={{color:'var(--text-3)'}} />
              </button>
              {showDatePicker && (
                <DatePickerModal
                  initial={due_date || todayISO()}
                  onPick={(iso) => { setDueDate(iso); setShowDatePicker(false); }}
                  onCancel={() => setShowDatePicker(false)}
                />
              )}
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Recurring</label>
              <select className="form-select" value={recurring} onChange={e=>setRecurring(e.target.value)}>
                <option value="none">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          {brain && brain.length > 0 && (
            <div className="form-group">
              <label className="form-label">Brain context <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(link this task to a Brain entry — playbook, decision, memory)</span></label>
              <select className="form-select" value={brainEntryId} onChange={e=>setBrainEntryId(e.target.value)}>
                <option value="">— None —</option>
                {['playbook','decision','memory','soul','lesson','north-star'].map(type => {
                  const entries = brain.filter(b => b.type === type);
                  if (entries.length === 0) return null;
                  return (
                    <optgroup key={type} label={type.toUpperCase()}>
                      {entries.map(b => <option key={b.id} value={b.id}>{b.title.slice(0,70)}</option>)}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          )}
          {properties && properties.length > 0 && (
            <div className="form-group">
              <label className="form-label">Property <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(if this task is about a specific property)</span></label>
              <select className="form-select" value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {['listing','investment','personal','rental'].map(cat => {
                  const items = properties.filter(p => p.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <optgroup key={cat} label={cat.toUpperCase()}>
                      {items.map(p => <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>)}
                    </optgroup>
                  );
                })}
                {(() => {
                  const known = new Set(['listing','investment','personal','rental']);
                  const other = properties.filter(p => !known.has(p.category));
                  if (other.length === 0) return null;
                  return (
                    <optgroup label="OTHER">
                      {other.map(p => <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>)}
                    </optgroup>
                  );
                })()}
              </select>
            </div>
          )}
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--text-3)',margin:'4px 0 12px',paddingTop:'16px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'7px'}}><Icon name="notes" size={12} style={{color:'var(--accent)'}} />Notes &amp; context</div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional details…" /></div>

          {/* ── Auto-schedule (shared component) ── */}
          <AutoScheduleFields initial={initial} dueDate={due_date} onChange={setSchedFields} />

          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--text-3)',margin:'4px 0 12px',paddingTop:'16px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'7px'}}><Icon name="mail" size={12} style={{color:'var(--accent)'}} />Delegate</div>
          <div className="form-group" style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 12px',background:'var(--bg-base)'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px'}}>
              <input type="checkbox" checked={emailMode} disabled={emailAlreadySent} onChange={e=>{
                const on=e.target.checked; setEmailMode(on);
                if(on && !emailMsg){
                  const lc = contactIds.map(id=>contacts.find(c=>c.id===id)).filter(Boolean);
                  if(!emailTo && lc[0] && lc[0].email) setEmailTo(lc[0].email);
                  setEmailMsg(`Hi,\n\nI'd like your help with this task:\n\n• ${title||'(task)'}\n${due_date?`• Due: ${due_date}\n`:''}${(notes||'').trim()?`\nDetails:\n${notes.trim()}\n`:''}\nJust reply to this email with an update, or let me know when it's done or if you can't take it on. Thanks!`);
                }
              }}/>
              <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="mail" size={12} /> Assign by email — no app account needed</span>
            </label>
            {emailAlreadySent && <div style={{fontSize:'11px',color:'var(--green)',marginTop:'6px'}}>✓ Sent to {initial.assignee_email}. Replies are tracked automatically.</div>}
            {emailMode && !emailAlreadySent && (
              <div style={{marginTop:'10px'}}>
                <input className="form-input" type="email" placeholder="their@email.com" value={emailTo} onChange={e=>setEmailTo(e.target.value)} style={{marginBottom:'8px'}}/>
                <AriRewriteButton text={emailMsg} onRewrite={setEmailMsg} contactName={(contacts.find(c=>c.id===contactIds[0])?.name)||emailTo} contactId={contactIds[0]} />
                <textarea className="form-textarea" rows={6} value={emailMsg} onChange={e=>setEmailMsg(e.target.value)} placeholder="Message to the assignee (their details / instructions)…"/>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Your notes above are included. They just reply; Claude reads the reply and flags this task for your review.</div>
              </div>
            )}
          </div>

          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'var(--text-3)',margin:'4px 0 12px',paddingTop:'16px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'7px'}}><Icon name="contacts" size={12} style={{color:'var(--accent)'}} />Connections</div>
          <div className="form-group">
            <label className="form-label">Linked contacts {linkedContacts.length > 0 && <span style={{color:'var(--text-3)',fontWeight:400}}>({linkedContacts.length})</span>}</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'6px',minHeight:'4px'}}>
              {linkedContacts.map(c => (
                <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',borderRadius:'12px',fontSize:'12px',color:'var(--text-1)'}}>
                  {c.name}
                  <button type="button" onClick={() => setContactIds(prev => prev.filter(id => id !== c.id))}
                    style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',padding:'0 0 0 4px',fontSize:'14px',lineHeight:1}}>×</button>
                </span>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContactPickerOpen(o => !o)} style={{fontSize:'11px',padding:'4px 10px'}}>
                {contactPickerOpen ? '× Close' : '+ Add contact'}
              </button>
            </div>
            {contactPickerOpen && (
              <div style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'8px',background:'var(--bg-base)',maxHeight:'240px',display:'flex',flexDirection:'column'}}>
                <input className="form-input" autoFocus value={contactQuery} onChange={e=>setContactQuery(e.target.value)}
                  placeholder="Search by name, email, or company…" style={{margin:0,marginBottom:'6px',fontSize:'12px'}} />
                <div style={{overflowY:'auto',flex:1}}>
                  {filteredContactOptions.length === 0 && (
                    <div style={{padding:'12px',textAlign:'center',color:'var(--text-3)',fontSize:'11px'}}>
                      {contactQuery ? 'No matches.' : 'No contacts to add.'}
                    </div>
                  )}
                  {filteredContactOptions.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => { setContactIds(prev => prev.includes(c.id) ? prev : [...prev, c.id]); setContactQuery(''); setContactPickerOpen(false); }}
                      style={{display:'block',width:'100%',textAlign:'left',padding:'6px 8px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',fontSize:'12px',color:'var(--text-1)'}}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <div style={{fontWeight:600}}>{c.name}</div>
                      {(c.email || c.company) && (
                        <div style={{fontSize:'10px',color:'var(--text-3)'}}>
                          {c.email}{c.email && c.company ? ' · ' : ''}{c.company}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Pass 4 Finding #5: events linked to this task (read-only reverse view) */}
          {initial?.id && (() => {
            const linked = events.filter(e => e.task_id === initial.id);
            if (linked.length === 0) return null;
            return (
              <div className="form-group" style={{padding:'10px',background:'var(--bg-base)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text-2)',marginBottom:'6px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="calendar" size={12} /> Linked events ({linked.length})</div>
                {linked.slice(0, 5).map(ev => (
                  <div key={ev.id} style={{padding:'4px 8px',fontSize:'11px',color:'var(--text-2)',display:'flex',justifyContent:'space-between',gap:'8px'}}>
                    <span>{ev.title}</span>
                    {ev.start_at && <span style={{color:'var(--text-3)',whiteSpace:'nowrap'}}>{new Date(ev.start_at).toLocaleDateString()}</span>}
                  </div>
                ))}
                {linked.length > 5 && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>+ {linked.length - 5} more</div>}
              </div>
            );
          })()}
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',padding:'14px 20px',borderTop:'1px solid var(--border)',background:'var(--bg-base)',flexShrink:0}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{padding:'10px 24px',fontWeight:800}}>Save Task</button>
          </div>
        </form>
      </div>
    </div>
  );
}
