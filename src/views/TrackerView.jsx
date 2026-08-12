import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { priorityClass, priorityLabel, todayISO } from '../helpers';
import { TrackerTaskModal, lbl, sortTasks } from '../App';
import LinkedDocuments from './LinkedDocuments';
import LinkedNotes from './LinkedNotes';

function TrackerView({ userId, defaultSystem, contacts = [] }) {
  const tdb = supabase.schema('tracker');
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskMsgs, setTaskMsgs] = useState([]);
  const [sendingAccount, setSendingAccount] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(null);
  const [newProj, setNewProj] = useState('');
  const [addPid, setAddPid] = useState('');
  const [addRole, setAddRole] = useState('viewer');
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(true);

  const loadCore = async () => {
    setLoading(true); setErr(null);
    try {
      const [pf,pe,pr,mm,acc] = await Promise.all([
        tdb.from('profiles').select('*').eq('id', userId).maybeSingle(),
        tdb.from('profiles').select('id,email,full_name,role').order('full_name'),
        tdb.from('projects').select('*').order('created_at'),
        tdb.from('project_members').select('*'),
        supabase.from('email_accounts').select('id,email_address,purposes,is_default').contains('purposes',['email']).order('is_default',{ascending:false}).order('created_at').limit(1),
      ]);
      if (pr.error) throw pr.error;
      setMe(pf.data); setPeople(pe.data||[]); setProjects(pr.data||[]); setMembers(mm.data||[]);
      setSendingAccount((acc.data&&acc.data[0])||null);
      setSel(s=> s || (pr.data && pr.data[0] ? pr.data[0].id : null));
    } catch(e){ setErr(e.message||String(e)); }
    setLoading(false);
  };
  useEffect(()=>{ loadCore(); }, []);   // eslint-disable-line

  const loadTasks = async (pid) => {
    if(!pid){ setTasks([]); setTaskMsgs([]); return; }
    const { data } = await tdb.from('tasks').select('*').eq('project_id', pid);
    setTasks(data||[]);
    const ids = (data||[]).map(t=>t.id);
    if (ids.length) { const { data:m } = await tdb.from('task_messages').select('*').in('task_id', ids).order('created_at',{ascending:false}); setTaskMsgs(m||[]); }
    else setTaskMsgs([]);
  };
  useEffect(()=>{ loadTasks(sel); }, [sel]);   // eslint-disable-line

  const appRole = (me&&me.role)||'user';
  const isAdmin = appRole==='admin';
  const myRole = (pid)=>{ const m=members.find(x=>x.project_id===pid && x.user_id===userId); return m?m.role:(isAdmin?'manager':null); };
  const canCreateProject = isAdmin || appRole==='manager';
  const canManage = (pid)=> isAdmin || myRole(pid)==='manager';
  const canEdit = (pid)=> isAdmin || ['manager','editor'].includes(myRole(pid));
  const nameOf = (id)=>{ const p=people.find(x=>x.id===id); return p?(p.full_name||p.email):'—'; };

  const projMembers = members.filter(m=>m.project_id===sel);
  const assignable = (()=>{ const ids=new Set(projMembers.map(m=>m.user_id)); const proj=projects.find(p=>p.id===sel); if(proj) ids.add(proj.owner_id); return people.filter(p=>ids.has(p.id)); })();

  const createProject = async ()=>{ const name=newProj.trim(); if(!name) return; const {error}=await tdb.from('projects').insert({name,owner_id:userId,status:'active'}); if(error){setErr(error.message);return;} setNewProj(''); await loadCore(); };

  const saveTask = async (data)=>{
    const email = data._email; delete data._email;
    let taskId = editing && editing.id;
    if (taskId) { const {error}=await tdb.from('tasks').update(data).eq('id',taskId); if(error){setErr(error.message);return;} }
    else { const {data:ins,error}=await tdb.from('tasks').insert({ ...data, project_id:sel, created_by:userId }).select('id').single(); if(error){setErr(error.message);return;} taskId=ins.id; }
    if (email && taskId) {
      if (!sendingAccount) { setErr('No connected email account to send from. Connect Gmail in Settings.'); }
      else {
        const { data:sr, error:se } = await supabase.functions.invoke('gmail-send', { body: { account_id: sendingAccount.id, to: email.to, subject: email.subject, body_text: email.body } });
        if (se || sr?.error) { setErr('Email send failed: '+(se?.message||sr?.error)); }
        else {
          await tdb.from('tasks').update({ assignment_method:'email', assignee_email:email.to, email_thread_id:sr.provider_thread_id, email_message_id:sr.provider_message_id }).eq('id',taskId);
          await tdb.from('task_messages').insert({ task_id:taskId, direction:'out', email_message_id:sr.provider_message_id, thread_id:sr.provider_thread_id, to_address:email.to, subject:email.subject, body_excerpt:(email.body||'').slice(0,600) });
        }
      }
    }
    if (data.auto_schedule) supabase.functions.invoke('task-autoschedule', { body: {} }).catch(()=>{});
    setEditing(null); loadTasks(sel);
  };
  const removeTask = async (t)=>{ await tdb.from('tasks').delete().eq('id',t.id); setEditing(null); loadTasks(sel); };
  const toggleComplete = async (t)=>{ await tdb.from('tasks').update({status: t.status==='done'?'todo':'done'}).eq('id',t.id); loadTasks(sel); };
  const clearReview = async (taskId)=>{ await tdb.from('task_messages').update({needs_review:false}).eq('task_id',taskId).eq('needs_review',true); loadTasks(sel); };
  const applyReview = async (t,status)=>{ await tdb.from('tasks').update({status}).eq('id',t.id); await tdb.from('task_messages').update({needs_review:false,applied:true}).eq('task_id',t.id).eq('needs_review',true); loadTasks(sel); };
  const addMember = async ()=>{ if(!addPid||!sel) return; const {error}=await tdb.from('project_members').insert({project_id:sel,user_id:addPid,role:addRole}); if(error){setErr(error.message);return;} setAddPid('');setAddRole('viewer'); await loadCore(); };
  const setMemberRole = async (uid,role)=>{ await tdb.from('project_members').update({role}).eq('project_id',sel).eq('user_id',uid); await loadCore(); };
  const removeMember = async (uid)=>{ await tdb.from('project_members').delete().eq('project_id',sel).eq('user_id',uid); await loadCore(); };

  const chip=(txt,col)=><span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',color:col,border:`1px solid ${col}`,borderRadius:'5px',padding:'1px 6px'}}>{txt}</span>;
  const inp={background:'var(--bg-base)',color:'var(--text-1)',border:'1px solid var(--border)',borderRadius:'6px',padding:'7px 9px',fontSize:'13px'};
  const INTENT_STATUS={completed:'done',rejected:'rejected',update:'in_progress'};

  if (loading) return <div className="loading-screen" style={{height:'50vh'}}><div className="spinner"/></div>;

  const project = projects.find(p=>p.id===sel);
  const candidates = people.filter(p=>!projMembers.some(m=>m.user_id===p.id));
  const overdue = (t)=> t.due_date && t.status!=='done' && t.status!=='rejected' && t.due_date < todayISO();

  const renderRow = (t)=>{
    const editable = canEdit(sel) || t.assignee_id===userId;
    const reviews = taskMsgs.filter(m=>m.task_id===t.id && m.direction==='in' && m.needs_review);
    const latest = reviews[0];
    return (
      <div key={t.id} style={{borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 0'}}>
          <button title="Complete" disabled={!editable} onClick={()=>toggleComplete(t)} style={{width:'18px',height:'18px',borderRadius:'5px',border:`1px solid ${t.status==='done'?'var(--green)':'var(--text-3)'}`,background:t.status==='done'?'var(--green)':'transparent',cursor:editable?'pointer':'default',flexShrink:0}}/>
          <span className={priorityClass(t)} style={{fontSize:'10px',fontWeight:700,minWidth:'26px',textAlign:'center',padding:'2px 4px',borderRadius:'4px'}}>{priorityLabel(t)}</span>
          <div style={{flex:1,cursor:editable?'pointer':'default'}} onClick={()=>editable&&setEditing(t)}>
            <div style={{fontSize:'13px',textDecoration:t.status==='done'?'line-through':'none',color:t.status==='done'?'var(--text-3)':(t.status==='rejected'?'var(--red)':'var(--text-1)')}}>{t.title}{t.status==='rejected'?' · rejected':''}</div>
            <div style={{display:'flex',gap:'8px',marginTop:'2px',flexWrap:'wrap',fontSize:'11px',color:'var(--text-3)'}}>
              {t.assignee_id ? <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="contacts" size={11} /> {nameOf(t.assignee_id)}</span> : (t.assignee_email ? <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="mail" size={11} /> {t.assignee_email}</span> : null)}
              {t.contact_id && <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="link" size={11} /> {t.contact_name||'contact'}</span>}
              {t.due_date && <span style={{color: overdue(t)?'var(--red)':'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="calendar" size={11} /> {t.due_date}{overdue(t)?' · overdue':''}</span>}
              {!!reviews.length && <span style={{color:'var(--accent)',display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="message" size={11} /> {reviews.length} new repl{reviews.length>1?'ies':'y'}</span>}
            </div>
          </div>
          {canManage(sel) && <button className="btn btn-ghost btn-sm" onClick={()=>removeTask(t)}>✕</button>}
        </div>
        {latest && canEdit(sel) && (
          <div style={{margin:'0 0 10px 28px',padding:'10px 12px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'8px'}}>
            <div style={{fontSize:'11px',color:'var(--accent)',fontWeight:600,marginBottom:'3px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="sparkles" size={11} /> Claude read the reply: <strong>{latest.ai_intent}</strong> · {Math.round((latest.ai_confidence||0)*100)}%</div>
            {latest.ai_note && <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'4px'}}>{latest.ai_note}</div>}
            {latest.body_excerpt && <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic',marginBottom:'8px',whiteSpace:'pre-wrap',maxHeight:'80px',overflowY:'auto'}}>{latest.body_excerpt}</div>}
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              {INTENT_STATUS[latest.ai_intent] && <button className="btn btn-primary btn-sm" onClick={()=>applyReview(t, INTENT_STATUS[latest.ai_intent])}>Confirm → {INTENT_STATUS[latest.ai_intent]==='done'?'Done':INTENT_STATUS[latest.ai_intent]==='rejected'?'Rejected':'In progress'}</button>}
              <button className="btn btn-ghost btn-sm" onClick={()=>applyReview(t,'done')}>Mark done</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>clearReview(t.id)}>Dismiss</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',flexWrap:'wrap',gap:'10px'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'10px'}}><Icon name="tracker" size={26} style={{color:'var(--accent)',flexShrink:0}} />Projects</h2>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>You are {chip(appRole,'var(--accent)')} {project&&myRole(sel)?<>· on this project: {chip(myRole(sel),'var(--accent)')}</>:null}</div>
        </div>
      </div>
      {err && <div style={{padding:'8px 12px',marginBottom:'12px',background:'var(--accent-glow)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'12px'}}>{err}</div>}

      <div style={{display:'flex',gap:'16px',alignItems:'flex-start',flexWrap:'wrap'}}>
        <div className="panel" style={{flex:'0 0 260px',minWidth:'240px'}}>
          <div className="panel-header"><h3>All Projects</h3><span className="nav-badge">{projects.length}</span></div>
          {projects.map(p=>(
            <div key={p.id} onClick={()=>setSel(p.id)} style={{padding:'10px 12px',borderRadius:'8px',cursor:'pointer',marginBottom:'6px',background:p.id===sel?'var(--bg-hover)':'transparent',border:`1px solid ${p.id===sel?'var(--accent-dim)':'transparent'}`}}>
              <div style={{fontWeight:600,fontSize:'14px'}}>{p.name}</div>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>{members.filter(m=>m.project_id===p.id).length} members · {p.status}</div>
            </div>
          ))}
          {!projects.length && <div style={{fontSize:'12px',color:'var(--text-3)',padding:'8px'}}>No projects yet.</div>}
          {canCreateProject && (
            <div style={{display:'flex',gap:'6px',marginTop:'10px'}}>
              <input style={{...inp,flex:1}} placeholder="New project name" value={newProj} onChange={e=>setNewProj(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createProject()}/>
              <button className="btn btn-primary btn-sm" onClick={createProject}>Add</button>
            </div>
          )}
        </div>

        <div style={{flex:1,minWidth:'320px'}}>
          {!project ? <div className="panel"><div style={{color:'var(--text-3)',fontSize:'13px'}}>Select a project.</div></div> : (
          <>
            <div className="panel" style={{marginBottom:'16px'}}>
              <div className="panel-header"><h3>{project.name}</h3>{chip(project.status,'var(--text-2)')}</div>
              {project.description && <p style={{color:'var(--text-2)',fontSize:'13px',margin:'4px 0 0'}}>{project.description}</p>}
              <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px'}}>Owner: {nameOf(project.owner_id)}</div>
            </div>

            {canManage(sel) && (
              <div className="panel" style={{marginBottom:'16px'}}>
                <div className="panel-header"><h3>Members</h3><span className="nav-badge">{projMembers.length}</span></div>
                {projMembers.map(m=>(
                  <div key={m.user_id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                    <div style={{flex:1,fontSize:'13px'}}>{nameOf(m.user_id)}{m.user_id===project.owner_id?' · owner':''}</div>
                    <select value={m.role} onChange={e=>setMemberRole(m.user_id,e.target.value)} style={inp} disabled={m.user_id===project.owner_id}>
                      <option value="manager">manager</option><option value="editor">editor</option><option value="viewer">viewer</option>
                    </select>
                    {m.user_id!==project.owner_id && <button className="btn btn-ghost btn-sm" onClick={()=>removeMember(m.user_id)}>Remove</button>}
                  </div>
                ))}
                {!!candidates.length && (
                  <div style={{display:'flex',gap:'6px',marginTop:'10px',flexWrap:'wrap'}}>
                    <select style={{...inp,flex:1,minWidth:'140px'}} value={addPid} onChange={e=>setAddPid(e.target.value)}>
                      <option value="">Add member…</option>
                      {candidates.map(c=><option key={c.id} value={c.id}>{c.full_name||c.email}</option>)}
                    </select>
                    <select style={inp} value={addRole} onChange={e=>setAddRole(e.target.value)}>
                      <option value="viewer">viewer</option><option value="editor">editor</option><option value="manager">manager</option>
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={addMember}>Add</button>
                  </div>
                )}
              </div>
            )}

            {/* Documents live in the shared library and are LINKED here, not
                stored here — the same lease can hang off this project, the
                property, the tenant contact and the deal without existing four
                times or being invisible from three of them. */}
            <LinkedDocuments userId={userId} targetType="project" targetId={sel.id} />
            <LinkedNotes userId={userId} targetType="project" targetId={sel.id} />

            <div className="panel">
              <div className="panel-header">
                <h3>Tasks</h3>
                <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                  <span className="nav-badge">{tasks.filter(t=>t.status!=='done'&&t.status!=='rejected').length} open</span>
                  {canEdit(sel) && <button className="btn btn-primary btn-sm" onClick={()=>setEditing({})}>+ New Task</button>}
                </div>
              </div>
              {['todo','in_progress','done','rejected'].map(st=>{
                const list = sortTasks(tasks.filter(t=>t.status===st));
                if ((st==='done'||st==='rejected') && !showDone) return (st==='done' && list.length) ? <div key={st} style={{margin:'10px 0'}}><button className="btn btn-ghost btn-sm" onClick={()=>setShowDone(true)}>Show completed / rejected</button></div> : null;
                if (!list.length) return null;
                const col = st==='todo'?'var(--text-2)':st==='in_progress'?'var(--accent)':st==='done'?'var(--green)':'var(--red)';
                const lbl = st==='todo'?'To Do':st==='in_progress'?'In Progress':st==='done'?'Done':'Rejected';
                return (
                  <div key={st} style={{marginBottom:'14px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                      <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:col}}>{lbl} · {list.length}</div>
                      {st==='done' && <button className="btn btn-ghost btn-sm" onClick={()=>setShowDone(false)}>Hide</button>}
                    </div>
                    {list.map(renderRow)}
                  </div>
                );
              })}
              {!tasks.length && <div style={{fontSize:'12px',color:'var(--text-3)'}}>No tasks yet. {canEdit(sel)?'Add the first one.':''}</div>}
            </div>
          </>
          )}
        </div>
      </div>

      {editing && (
        <TrackerTaskModal
          initial={editing.id?editing:null}
          defaultSystem={defaultSystem}
          assignable={assignable}
          contacts={contacts}
          nameOf={nameOf}
          onClose={()=>setEditing(null)}
          onSave={saveTask}
          onDelete={canManage(sel)?removeTask:null}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// PROJECT TASKS in personal Tasks view (assigned to / created by me)
// Surfaces only tasks that are: open AND due today or earlier. Completed
// items live in the Completed Tasks view; tasks without a due date are
// hidden from this surface (they live in the full project tracker).
// ─────────────────────────────────────────

export default TrackerView;
