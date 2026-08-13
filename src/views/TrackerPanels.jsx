// Tracker / projects — the project task panel and its task modal.
// Extracted from App.js (strangle the monolith, step 26).
import React, { useEffect, useState } from 'react';
import { useBackClose } from '../backClose';
import { supabase } from '../dataService';
import { QUADRANTS, modal, priorityClass, priorityLabel, sortTasks, todayISO } from '../helpers';
import { Icon } from '../icons';
import AriRewriteButton from '../views/AriRewriteButton';
import AutoScheduleFields from '../views/AutoScheduleFields';

export const QUAD_TO_PRIO = { A: 'high', B: 'medium', C: 'low' };

// ── HTML entity decoding ─────────────────────────────────────────────────────
// Email bodies arrive HTML-escaped. When we strip tags to make a plain-text
// preview we were decoding exactly two entities by hand (&nbsp; and &amp;) and
// nothing else, so every apostrophe in an email came out as a literal "&#39;"
// on the contact timeline. React escapes text by default, so there is nothing
// downstream to rescue it.
//
// Numeric references (&#39; &#x27;) are the common case in real mail — a
// hand-picked list of named entities will always miss them. Regex rather than
// the innerHTML trick so this is safe anywhere and never touches the DOM.
//
// &amp; is decoded LAST, deliberately: "&amp;#39;" must end up as the literal
// text "&#39;", not as an apostrophe. Decoding it first would double-decode.


// ── owesReply: ONE definition ────────────────────────────────────────────────
// This rule existed in four places — the my_owe_reply RPC, robot-chat's
// hand-written copy, ContactsView's oweReplyFn, and an inline calculation on the
// contact detail panel — and they disagreed. Marking a contact Settled silenced
// Do-This-Next while the contact's own screen kept insisting "you may owe a
// reply", directly under a pill that said Settled. Two dismissals also existed
// (no_reply_needed_at, comms_settled_at) and not every copy honoured both.
//
// Any new surface that wants to ask "do I owe this person a reply?" must call
// this, not re-derive it. The server keeps its own copy in SQL because RLS runs
// there; that copy is kept identical on purpose.
//
// Both dismissals are timestamp-compared, never truthiness: they clear what is
// on the table now, and a genuinely NEWER inbound re-opens the question.

export const PRIO_TO_QUAD = { high: 'A', medium: 'B', low: 'C' };

export function PriorityField({ system, priority, onChange, style, className = 'form-select', disabled }) {
  const eis = (system || 'eisenhower') === 'eisenhower';
  const val = eis ? (PRIO_TO_QUAD[priority] || 'B') : (priority || 'medium');
  const opts = eis
    ? [['A', 'A'], ['B', 'B'], ['C', 'C']]
    : [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
  return (
    <select className={className} style={style} disabled={disabled} value={val}
      onChange={e => onChange(eis ? (QUAD_TO_PRIO[e.target.value] || 'medium') : e.target.value)}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}




// "Top priority" = anything in quadrant A OR simple-system high

// Date helpers (local-time YYYY-MM-DD comparison)
// Guards date <input> values: a missing or implausible date (year < 2015 or
// > 2100, usually a mis-scrolled year wheel) renders as empty so the native
// picker opens on the current month instead of getting "stuck" in the past.

export function TrackerTaskModal({ onClose, onSave, onDelete, initial, defaultSystem, assignable, contacts, nameOf }) {
  useBackClose(onClose);
  const [title, setTitle] = useState(initial?.title || '');
  const [system, setSystem] = useState(initial?.priority_system || defaultSystem || 'eisenhower');
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [quadrant, setQuadrant] = useState(initial?.eisenhower_quadrant || 'A');
  const [rank, setRank] = useState(initial?.eisenhower_rank ?? 1);
  const [dueDate, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [status, setStatus] = useState(initial?.status || 'todo');
  const [assignee, setAssignee] = useState(initial?.assignee_id || '');
  const [contactId, setContactId] = useState(initial?.contact_id || '');
  const [contactName, setContactName] = useState(initial?.contact_name || '');
  const [cq, setCq] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  // Email assignment
  const [emailMode, setEmailMode] = useState(initial?.assignment_method === 'email');
  const [emailTo, setEmailTo] = useState(initial?.assignee_email || '');
  const [emailMsg, setEmailMsg] = useState('');
  const alreadySent = !!(initial && initial.email_thread_id);
  // Auto-scheduling (shared component)
  const [schedFields, setSchedFields] = useState({});

  const contactOpts = (() => {
    const q = cq.trim().toLowerCase();
    if (!q) return [];
    return (contacts || []).filter(c =>
      (c.name||'').toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q) || (c.company||'').toLowerCase().includes(q)
    ).slice(0, 8);
  })();

  function enableEmail(on) {
    setEmailMode(on);
    if (on) {
      const c = contacts.find(x=>x.id===contactId);
      if (c && c.email && !emailTo) setEmailTo(c.email);
      if (!emailMsg) setEmailMsg(`Hi,\n\nI'd like your help with this task:\n\n• ${title || '(task)'}\n${dueDate?`• Due: ${dueDate}\n`:''}${(notes||'').trim()?`\nDetails:\n${notes.trim()}\n`:''}\nJust reply to this email with an update, or let me know when it's done or if you can't take it on. Thanks!`);
    }
  }

  async function suggestQuadrant() {
    if (!title.trim()) return;
    setSuggesting(true); setSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke('task-quadrant-suggest', { body: { title: title.trim(), notes: notes.trim()||null, due_date: dueDate||null } });
      if (error || data?.error) setSuggestion({ error: error?.message || data?.error });
      else { setSuggestion(data);
        if (system==='eisenhower' && data.quadrant) setQuadrant(data.quadrant);
        else { const map={A:'high',B:'medium',C:'medium',D:'low'}; if (data.quadrant) setPriority(map[data.quadrant]); } }
    } catch(e){ setSuggestion({ error: e.message }); } finally { setSuggesting(false); }
  }

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const wantEmail = emailMode && emailTo.trim() && !alreadySent;
    const base = { title:title.trim(), notes:notes.trim()||null, due_date:dueDate||null, status,
      assignee_id: emailMode ? null : (assignee||null),
      assignee_email: emailMode ? emailTo.trim() : null,
      contact_id: contactId||null, contact_name: contactName||null, priority_system: system,
      ...schedFields,
      _email: wantEmail ? { to: emailTo.trim(), subject: title.trim(), body: emailMsg } : null };
    if (system==='eisenhower') onSave({ ...base, priority:'medium', eisenhower_quadrant:quadrant, eisenhower_rank:Math.max(1,parseInt(rank,10)||1) });
    else onSave({ ...base, priority, eisenhower_quadrant:null, eisenhower_rank:null });
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Task' : 'New Task'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-group"><label className="form-label">Task</label>
            <input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to get done?" autoFocus required/></div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}><label className="form-label">Assign to {emailMode && <span style={{color:'var(--text-3)',fontSize:'10px'}}>· via email</span>}</label>
              <select className="form-select" value={assignee} onChange={e=>setAssignee(e.target.value)} disabled={emailMode}>
                <option value="">{emailMode?'— (email assignment)':'Unassigned'}</option>
                {assignable.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}
              </select></div>
            <div className="form-group" style={{flex:1}}><label className="form-label">Status</label>
              <select className="form-select" value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option><option value="rejected">Rejected</option>
              </select></div>
          </div>

          <div className="form-group" style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 12px',background:'var(--bg-base)'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px'}}>
              <input type="checkbox" checked={emailMode} onChange={e=>enableEmail(e.target.checked)} disabled={alreadySent}/>
              <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="mail" size={12} /> Assign by email — no app account needed</span>
            </label>
            {alreadySent && <div style={{fontSize:'11px',color:'var(--green)',marginTop:'6px'}}>✓ Sent to {initial.assignee_email}. Their replies are tracked automatically.</div>}
            {emailMode && !alreadySent && (
              <div style={{marginTop:'10px'}}>
                <input className="form-input" type="email" placeholder="their@email.com" value={emailTo} onChange={e=>setEmailTo(e.target.value)} style={{marginBottom:'8px'}}/>
                <AriRewriteButton text={emailMsg} onRewrite={setEmailMsg} contactName={contactName||emailTo} />
                <textarea className="form-input" rows={5} value={emailMsg} onChange={e=>setEmailMsg(e.target.value)} placeholder="Message…"/>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>They just reply to the email; Claude reads the reply and updates this task (you confirm anything that changes status).</div>
              </div>
            )}
          </div>

          <div className="form-group"><label className="form-label">Priority System</label>
            <div style={{display:'flex',gap:'6px'}}>
              <button type="button" className={`btn btn-sm ${system==='eisenhower'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('eisenhower')}>Eisenhower (A1, B2…)</button>
              <button type="button" className={`btn btn-sm ${system==='simple'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('simple')}>Simple (High/Med/Low)</button>
            </div></div>
          {system==='eisenhower' ? (
            <div className="form-row">
              <div className="form-group" style={{flex:2}}>
                <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                  <span>Quadrant</span>
                  <button type="button" onClick={suggestQuadrant} disabled={!title.trim()||suggesting} className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>{suggesting?'…thinking':<><Icon name="sparkles" size={11} /> Suggest</>}</button>
                </label>
                <select className="form-select" value={quadrant} onChange={e=>setQuadrant(e.target.value)}>
                  {QUADRANTS.map(q=><option key={q.letter} value={q.letter}>{q.label} · {q.short}</option>)}
                </select>
              </div>
              <div className="form-group" style={{flex:1}}><label className="form-label">Rank</label>
                <input className="form-input" type="number" min="1" value={rank} onChange={e=>setRank(e.target.value)}/></div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                <span>Priority</span>
                <button type="button" onClick={suggestQuadrant} disabled={!title.trim()||suggesting} className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>{suggesting?'…thinking':<><Icon name="sparkles" size={11} /> Suggest</>}</button>
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
          {suggestion?.error && <div style={{padding:'8px 12px',background:'rgba(239,68,68,0.1)',border:'1px solid #ef4444',borderRadius:'6px',marginBottom:'10px',fontSize:'12px',color:'#ef4444'}}>Suggest failed: {suggestion.error}</div>}
          <div className="form-row">
            <div className="form-group" style={{flex:1}}>
              <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Due Date</span>
                {dueDate && <button type="button" onClick={()=>setDueDate('')} style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'10px',cursor:'pointer'}}>× Clear</button>}
              </label>
              <input className="form-input" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Linked contact</label>
            {contactId ? (
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{flex:1,fontSize:'13px',padding:'7px 9px',background:'var(--bg-hover)',borderRadius:'6px',display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="link" size={11} /> {contactName||nameOf(contactId)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setContactId('');setContactName('');}}>Clear</button>
              </div>
            ) : (
              <>
                <input className="form-input" placeholder="Search contacts…" value={cq} onChange={e=>setCq(e.target.value)}/>
                {!!contactOpts.length && (
                  <div style={{border:'1px solid var(--border)',borderRadius:'6px',marginTop:'4px',maxHeight:'160px',overflowY:'auto'}}>
                    {contactOpts.map(c=>(
                      <div key={c.id} onClick={()=>{setContactId(c.id);setContactName(c.name||'');setCq(''); if(emailMode && c.email && !emailTo) setEmailTo(c.email);}} style={{padding:'7px 10px',cursor:'pointer',fontSize:'13px',borderBottom:'1px solid var(--border)'}}>
                        {c.name}{c.company?<span style={{color:'var(--text-3)'}}> · {c.company}</span>:null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="form-group"><label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Details, links, context…"/></div>
          <AutoScheduleFields initial={initial} dueDate={dueDate} onChange={setSchedFields} />
          <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'8px'}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{!initial && emailMode && emailTo.trim() ? 'Add & Email' : (initial?'Save':'Add Task')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProjectTasksPanel({ userId }) {
  const tdb = supabase.schema('tracker');
  const [rows, setRows] = useState([]);
  const [projNames, setProjNames] = useState({});
  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [members, setMembers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [sendingAccount, setSendingAccount] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null);   // the row being edited via tap

  const load = async () => {
    try {
      const [tk, pr, pe, mm, ct, acc] = await Promise.all([
        tdb.from('tasks').select('*').or(`assignee_id.eq.${userId},created_by.eq.${userId}`),
        tdb.from('projects').select('id,name,owner_id'),
        tdb.from('profiles').select('id,email,full_name,role').order('full_name'),
        tdb.from('project_members').select('*'),
        supabase.from('contacts').select('id,name,email,company').eq('user_id', userId).order('name'),
        supabase.from('email_accounts').select('id,email_address,purposes,is_default').contains('purposes',['email']).order('is_default',{ascending:false}).order('created_at').limit(1),
      ]);
      const names = {}; (pr.data||[]).forEach(p=>names[p.id]=p.name);
      setProjNames(names);
      setProjects(pr.data||[]);
      setPeople(pe.data||[]);
      setMembers(mm.data||[]);
      setContacts(ct.data||[]);
      setSendingAccount((acc.data && acc.data[0])||null);
      setRows(tk.data||[]);
    } catch (e) { /* tracker may be empty */ }
    setLoaded(true);
  };
  useEffect(()=>{ load(); }, []);   // eslint-disable-line

  // Save handler for the modal — mirrors the Project Tracker page logic but
  // scoped to whatever task is currently being edited from this panel.
  const saveTask = async (data) => {
    if (!editing || !editing.id) { setEditing(null); return; }
    const email = data._email; delete data._email;
    const { error } = await tdb.from('tasks').update(data).eq('id', editing.id);
    if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); return; }
    // If an outbound email assignment was attached, send it
    if (email) {
      if (!sendingAccount) {
        if (window.__notify) window.__notify('No email account connected — task saved but not emailed', 'warn');
      } else {
        const { data: sr, error: se } = await supabase.functions.invoke('gmail-send', {
          body: { account_id: sendingAccount.id, to: email.to, subject: email.subject, body_text: email.body },
        });
        if (!se && !sr?.error) {
          await tdb.from('tasks').update({
            assignment_method:'email', assignee_email: email.to,
            email_thread_id: sr.provider_thread_id, email_message_id: sr.provider_message_id,
          }).eq('id', editing.id);
          await tdb.from('task_messages').insert({
            task_id: editing.id, direction:'out',
            email_message_id: sr.provider_message_id, thread_id: sr.provider_thread_id,
            to_address: email.to, subject: email.subject,
            body_excerpt: (email.body||'').slice(0,600),
          });
        }
      }
    }
    if (data.auto_schedule) supabase.functions.invoke('task-autoschedule', { body: {} }).catch(()=>{});
    setEditing(null);
    load();
  };
  const removeTask = async (t) => {
    await tdb.from('tasks').delete().eq('id', t.id);
    setEditing(null);
    load();
  };

  const toggle = async (t) => {
    await tdb.from('tasks').update({ status: t.status==='done'?'todo':'done' }).eq('id', t.id);
    load();
  };

  // Build the filtered list: open + has due date + due today or earlier
  const today = todayISO();
  const visible = rows.filter(t =>
    t.status !== 'done' &&        // hide completed (they live in Completed view)
    !!t.due_date &&               // hide tasks without a due date
    t.due_date <= today           // only due today or earlier
  );

  // Empty after filtering = panel collapses. Don't render the empty shell.
  if (loaded && visible.length === 0) return null;

  // Build the assignable list for whichever task is being edited (project members
  // of that task's project, plus the project owner).
  const assignableFor = (task) => {
    if (!task || !task.project_id) return people;
    const proj = projects.find(p => p.id === task.project_id);
    const ids = new Set(members.filter(m => m.project_id === task.project_id).map(m => m.user_id));
    if (proj) ids.add(proj.owner_id);
    return people.filter(p => ids.has(p.id));
  };
  const nameOf = (id) => { const p = people.find(x=>x.id===id); return p ? (p.full_name || p.email) : '—'; };

  return (
    <div className="panel" style={{marginBottom:'16px'}}>
      <div className="panel-header">
        <h3 style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="folder" size={15} /> From your projects</h3>
        <span className="nav-badge">{visible.length} due</span>
      </div>
      {!loaded ? <div style={{fontSize:'12px',color:'var(--text-3)'}}>Loading…</div> :
        sortTasks(visible).map(t=>{
          const overdue = t.due_date && t.due_date < today;
          return (
            <div
              key={t.id}
              onClick={()=>setEditing(t)}
              style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}
            >
              <button
                title="Complete"
                onClick={(e)=>{ e.stopPropagation(); toggle(t); }}
                style={{width:'20px',height:'20px',borderRadius:'5px',border:'1px solid var(--text-3)',background:'transparent',cursor:'pointer',flexShrink:0}}
              />
              <span className={priorityClass(t)} style={{fontSize:'10px',fontWeight:700,minWidth:'26px',textAlign:'center',padding:'2px 4px',borderRadius:'4px'}}>{priorityLabel(t)}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'13px',color:'var(--text-1)'}}>{t.title}</div>
                <div style={{display:'flex',gap:'8px',marginTop:'2px',flexWrap:'wrap',fontSize:'11px',color:'var(--text-3)'}}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="folder" size={11} /> {projNames[t.project_id]||'Project'}</span>
                  {t.contact_id && <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="link" size={11} /> {t.contact_name||'contact'}</span>}
                  <span style={{color:overdue?'var(--red)':'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="calendar" size={11} /> {t.due_date}{overdue?' · overdue':''}</span>
                </div>
              </div>
            </div>
          );
        })}

      {editing && (
        <TrackerTaskModal
          initial={editing}
          defaultSystem={editing.priority_system || 'eisenhower'}
          assignable={assignableFor(editing)}
          contacts={contacts}
          nameOf={nameOf}
          onClose={()=>setEditing(null)}
          onSave={saveTask}
          onDelete={removeTask}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────
// EMAIL REPLIES review (personal email-assigned tasks)
// ─────────────────────────────────────────
