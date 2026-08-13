// Dashboard — the Today screen: the hero next-best-action, announcements, the
// week sparkline and the count-up numbers.
// Extracted from App.js (strangle the monolith, step 28).
import { CountUp } from '../uiPrimitives';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bounceSignals, buildGrowthMoves, buildNextActions, docSignals } from '../../supabase/functions/robot-chat/nba.js';
import { supabase } from '../dataService';
import { isTopPriority, owesReply, priorityClass, priorityLabel, sortTasks, todayISO } from '../helpers';
import { Icon } from '../icons';
import { SnoozeMenu, useNbaSkips } from '../nbaSkips';
import { confirmDialog, notify } from '../notify';
import { Tip } from '../tipsUi';
import BouncesModal from '../views/BouncesModal';
import CoachNudge from '../views/CoachNudge';
import { emailAssignTask } from '../views/SharedUi';
import TaskModal from '../views/TaskModal';

export function WeekSparkline({ days }) {
  const max = Math.max(1, ...days.map(d => d.c));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 30 }}>
      {days.map((d, i) => {
        const isToday = i === days.length - 1;
        const h = Math.max(3, Math.round((d.c / max) * 28));
        return (
          <div key={i} title={`${d.label}: ${d.c} done`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 7, height: h, borderRadius: 3, background: isToday ? 'linear-gradient(180deg,var(--accent-2),var(--accent))' : 'var(--border-strong)', transition: 'height .4s ease' }} />
            <span style={{ fontSize: 8, color: isToday ? 'var(--accent)' : 'var(--text-3)', fontWeight: isToday ? 800 : 600 }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// "Plan my day" — asks Ari to triage the day's due/overdue + top tasks into a
// realistic ordered sequence around the calendar.
// Vertical time-blocked day timeline — fixed events + scheduled plan steps.


// ── Next Best Action engine ─────────────────────────────────────────────────
// MOVED to supabase/functions/_shared/nba.js so the SERVER can run the exact
// same ranking (Ari's next_actions tool). Imported at the top of this file.
// Do not re-inline it here — one engine, two consumers, zero drift.
// Delivery-failure copy. A bounce is the ONLY signal that an email the app already
// told you was "Sent." never actually arrived — so it outranks everything else.
// BOUNCE_SHORT now lives in the shared NBA engine (imported above) — Ari uses it too.

export function DashboardAnnouncements({ userId }) {
  const [items, setItems] = useState([]);
  const [newIds, setNewIds] = useState(() => new Set());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('announcements')
          .select('id,title,body,created_at,team_id')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(8);
        if (alive) setItems(Array.isArray(data) ? data : []);
      } catch (_) { if (alive) setItems([]); }
      try {
        const { data } = await supabase.rpc('my_unacked_announcements');
        if (alive && Array.isArray(data)) setNewIds(new Set(data.map(a => a.id)));
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [userId]);
  if (!items.length) return null;
  const when = (iso) => {
    const d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const days = Math.floor(h / 24); if (days === 1) return 'Yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  };
  const shown = expanded ? items : items.slice(0, 3);
  return (
    <div className="dash-card" style={{ marginBottom: 22 }}>
      <div className="panel-header" style={{ borderRadius: '16px 16px 0 0' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="megaphone" size={15} style={{ color: 'var(--accent)' }} /> Announcements</h3>
        {newIds.size > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>{newIds.size} new</span>}
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {shown.map((a, i) => {
          const isNew = newIds.has(a.id);
          const last = i === shown.length - 1;
          return (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: isNew ? 'var(--accent)' : 'var(--border)' }} title={isNew ? 'New' : 'Seen'} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{a.title || 'Announcement'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>{when(a.created_at)}</div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{a.body}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{a.team_id ? 'Team' : 'Brokerage'}</div>
              </div>
            </div>
          );
        })}
        {items.length > 3 && <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)} style={{ alignSelf: 'flex-start', marginTop: 8 }}>{expanded ? 'Show less' : `Show ${items.length - 3} more`}</button>}
      </div>
    </div>
  );
}

export function NextBestAction({ contacts=[], setContacts, tasks=[], setTasks, events=[], deals=[], gciGoal=0, setView, onOpenPlan, myUserId=null, oweReplyMap={}, setOweReplyMap }){
  const now=Date.now();
  const [openSignals,setOpenSignals]=useState({});
  const [docActions,setDocActions]=useState([]);
  const [bounceActions,setBounceActions]=useState([]);
  const [showBounces,setShowBounces]=useState(false);
  const [bounceNonce,setBounceNonce]=useState(0);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const { data } = await supabase.from('email_bounces')
        .select('id, original_subject, failed_recipients, reason_code, bounced_at')
        .eq('handled',false).order('bounced_at',{ascending:false}).limit(10);
      if(!alive) return;
      setBounceActions(bounceSignals(data||[]));  // shared engine — same copy Ari speaks
    }catch(_){}
  })(); return ()=>{alive=false;}; },[bounceNonce]);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const since=new Date(Date.now()-30*86400000).toISOString();
      const { data } = await supabase.from('email_tracking')
        .select('contact_id,confident_open_at,open_count')
        .not('contact_id','is',null).not('confident_open_at','is',null)
        .gte('confident_open_at',since).order('confident_open_at',{ascending:false}).limit(300);
      if(!alive) return;
      const m={}; for(const r of (data||[])){ if(!m[r.contact_id]) m[r.contact_id]=r; } // newest per contact
      setOpenSignals(m);
    }catch(_){}
  })(); return ()=>{alive=false;}; },[]);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const { data } = await supabase.from('documents').select('id, title, doc_type, summary, action_label, signed_state, document_contacts(contact_id)').eq('action_needed',true).eq('status','ready').order('created_at',{ascending:false}).limit(20);
      if(!alive) return;
      setDocActions(docSignals(data||[], contacts));  // shared engine — same copy Ari speaks
    }catch(_){}
  })(); return ()=>{alive=false;}; },[contacts]);
  const { skipAction, filterSkipped } = useNbaSkips(myUserId);
  const actions=React.useMemo(()=>{ const base=buildNextActions({contacts,tasks,events,deals,now,oweReplyMap,openSignals}); const all=[...base,...docActions,...bounceActions].sort((a,b)=>b.score-a.score); return filterSkipped(all); },[contacts,tasks,events,deals,oweReplyMap,openSignals,docActions,bounceActions,filterSkipped]);
  const growth=React.useMemo(()=>buildGrowthMoves({contacts,deals,gciGoal,now}),[contacts,deals,gciGoal]);
  const [idx,setIdx]=useState(0); const [showAll,setShowAll]=useState(false);
  const [swipeDir,setSwipeDir]=useState(0);
  const nbaGoTo=React.useCallback((delta)=>{ setSwipeDir(delta); setIdx(i=>{ const L=(list||[]).length; if(L<=1) return i; return ((i+delta)%L+L)%L; }); },[list]);
  const nbaTouch=React.useRef({x:0,y:0,active:false});
  const nbaTouchStart=(e)=>{ const t=e.touches[0]; nbaTouch.current={x:t.clientX,y:t.clientY,active:true}; };
  const nbaTouchEnd=(e)=>{ if(!nbaTouch.current.active) return; nbaTouch.current.active=false; const t=e.changedTouches[0]; const dx=t.clientX-nbaTouch.current.x, dy=t.clientY-nbaTouch.current.y; if(Math.abs(dx)>44 && Math.abs(dx)>Math.abs(dy)*1.5) nbaGoTo(dx<0?1:-1); };
  const nbaNavBtn={width:26,height:26,borderRadius:'50%',border:'1px solid rgba(203,163,92,0.4)',background:'rgba(203,163,92,0.08)',color:'#EBCB82',fontSize:17,lineHeight:'22px',cursor:'pointer',padding:0,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0};
  const urgent=actions.length>0; const list=urgent?actions:growth;
  const cur=list[Math.min(idx,list.length-1)]||null;
  const runCta=(cta)=>{ if(!cta) return; if(cta.kind==='task_done'){ const id=cta.payload;
      // Same fire-and-forget as TodayView had — this is the second hero card.
      (async()=>{ const { error } = await supabase.from('tasks').update({completed:true, completed_at:new Date().toISOString()}).eq('id',id);
        if(error){ if(window.__notify) window.__notify('Could not mark done: '+(error.message||error),'error'); return; }
        setTasks&&setTasks(pr=>pr.map(x=>x.id===id?{...x,completed:true}:x));
        if(window.__notify) window.__notify('Done — nice work.','success');
        setIdx(0); })(); } else if(cta.kind==='open_reply'){ const ch=cta.channel||''; const isText=ch.includes('text')||ch.includes('sms'); if((isText||(!ch.includes('email')&&!cta.email)) && cta.phone){ window.__quoTab={ tab:'messages', phone:cta.phone, name:cta.name }; setView&&setView('quo'); } else if(cta.email){ window.__inboxOpenEmail=cta.email; setView&&setView('inbox'); } else if(cta.phone){ window.__quoTab={ tab:'messages', phone:cta.phone, name:cta.name }; setView&&setView('quo'); } else { setView&&setView('inbox'); } } else if(cta.kind==='bounces'){ setShowBounces(true); } else if(cta.kind==='view'){ setView&&setView(cta.payload); } else if(cta.kind==='call'){ window.location.href='tel:'+cta.payload; } };
  // "I already replied" — clears an owe-a-reply instantly by bumping the field the
  // engine reads (last_outbound_at past last_inbound_at), independent of email/text
  // sync timing. Updates local state so the card drops immediately.
  const markReplied=async(contactId)=>{ if(!contactId) return; const nowIso=new Date().toISOString();
    // Second copy of the TodayView handler fixed in v1.04.62.
    const { error } = await supabase.from('contact_interactions').insert({ user_id: myUserId, contact_id: contactId, direction:'outbound', channel:'manual', occurred_at: nowIso, brief:'Marked replied' });
    if(error){ if(window.__notify) window.__notify('Could not mark replied: '+(error.message||error),'error'); return; } setOweReplyMap && setOweReplyMap(m=>{ const n={...m}; delete n[contactId]; return n; }); if(window.__notify) window.__notify('Marked as replied — nice.','success'); setIdx(0); };
  // "No reply needed" — the matter's handled or no longer applies, and you did NOT
  // reply. Stamps no_reply_needed_at at the inbound's time so THIS message clears
  // but a future inbound from them re-arms it. Honest: doesn't fake an outbound.
  const markNoReplyNeeded=(contactId)=>{ if(!contactId) return; const stampIso=(oweReplyMap && oweReplyMap[contactId]) || new Date().toISOString(); try{ supabase.from('contacts').update({ no_reply_needed_at: stampIso }).eq('id', contactId).then(()=>{},()=>{}); }catch(_){} setOweReplyMap && setOweReplyMap(m=>{ const n={...m}; delete n[contactId]; return n; }); setContacts && setContacts(pr=>pr.map(x=>x.id===contactId?{...x, no_reply_needed_at: stampIso}:x)); if(window.__notify) window.__notify('Cleared — no reply needed.','success'); setIdx(0); };
  if(!cur) return null;
  const tagColor=cur.tag==='bounce'?'var(--red)':cur.tag==='overdue'?'var(--red)':cur.tag==='reply'?'var(--yellow)':cur.tag==='appt'?'#06b6d4':cur.tag==='deal'?'#22c55e':'var(--accent)';
  return (
    <div className="nba-card" onTouchStart={nbaTouchStart} onTouchEnd={nbaTouchEnd} style={{position:'relative',borderRadius:20,padding:'20px 18px 16px',marginBottom:22,background:'radial-gradient(90% 130% at 100% 0%, rgba(203,163,92,0.16), transparent 55%), linear-gradient(180deg, #1B1610, #100D09)',border:'1px solid rgba(203,163,92,0.55)',boxShadow:'0 0 40px rgba(203,163,92,0.12)',touchAction:'pan-y',overflow:'hidden'}}>
      <style>{`@keyframes nbaSlideL{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}@keyframes nbaSlideR{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:translateX(0)}}`}</style>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:9}}>
        <span style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#EBCB82'}}>{urgent?'✦ Do this next':'✦ You are caught up — consider this'}</span>
        {list.length>1 ? (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button aria-label="Previous" onClick={()=>nbaGoTo(-1)} style={nbaNavBtn}>‹</button>
            <span style={{fontSize:10.5,color:'var(--text-3)',fontWeight:700,minWidth:34,textAlign:'center'}}>{Math.min(idx+1,list.length)} / {list.length}</span>
            <button aria-label="Next" onClick={()=>nbaGoTo(1)} style={nbaNavBtn}>›</button>
          </div>
        ) : null}
      </div>
      <div key={idx} style={{animation: swipeDir<0?'nbaSlideR 0.22s ease':'nbaSlideL 0.22s ease'}}>
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{width:38,height:38,borderRadius:11,flexShrink:0,background:'var(--bg-base)',border:'1px solid '+tagColor,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><Icon name={cur.icon||'target'} size={18} style={{color:tagColor}}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontFamily:'Fraunces, serif',fontWeight:300,letterSpacing:'-0.01em',color:'#F6F1E7',lineHeight:1.18,overflowWrap:'anywhere',wordBreak:'break-word'}}>{cur.title}</div>
          <div style={{fontSize:12.5,color:'var(--text-2)',marginTop:3,lineHeight:1.4,overflowWrap:'anywhere',wordBreak:'break-word'}}>{cur.why}</div>
          {cur.contactId && <button type="button" onClick={()=>{ window.__pendingOpenContact=cur.contactId; setView&&setView('contacts'); }} style={{marginTop:7,background:'none',border:'none',padding:0,color:'#CBA35C',fontSize:12,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>View contact <span aria-hidden="true">&rarr;</span></button>}
        </div>
      </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:13,flexWrap:'wrap',alignItems:'center'}}>
        {cur.cta && <button className="btn btn-primary btn-sm" onClick={()=>runCta(cur.cta)}>{cur.cta.label}</button>}
        {cur.tag==='reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={()=>markReplied(cur.contactId)} title="I've already replied — clear this">✓ Replied</button>}
        {cur.tag==='reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={()=>markNoReplyNeeded(cur.contactId)} title="No reply is needed — handled elsewhere or no longer applies">No reply needed</button>}
        {list.length>1 && <SnoozeMenu onPick={(when)=>{ skipAction(cur, when); setIdx(0); }} />}
        {urgent && onOpenPlan && <button className="btn btn-ghost btn-sm" onClick={()=>onOpenPlan()}>Plan my day</button>}
        {list.length>1 && <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>setShowAll(s=>!s)}>{showAll?'Hide':'See all ('+list.length+')'}</button>}
      </div>
      {showBounces && <BouncesModal onClose={()=>setShowBounces(false)} onChanged={()=>setBounceNonce(n=>n+1)} />}
      {showAll && <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)',display:'flex',flexDirection:'column',gap:10}}>
        {list.slice(0,8).map((a,i)=>(
          <div key={a.key} onClick={()=>{setIdx(i);setShowAll(false);}} style={{display:'flex',gap:10,alignItems:'center',cursor:'pointer',opacity:i===idx?1:0.8}}>
            <Icon name={a.icon||'target'} size={14} style={{color:'var(--text-3)',flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.title}</div><div style={{fontSize:11,color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.why}</div></div>
          </div>
        ))}
      </div>}
      {!showAll && list.length>1 ? (
        <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:14}}>
          {list.slice(0,8).map((_,i)=>(
            <button key={i} aria-label={'Go to action '+(i+1)} onClick={()=>{setSwipeDir(i>idx?1:-1);setIdx(i);}} style={{width:i===idx?18:6,height:6,borderRadius:3,border:'none',padding:0,cursor:'pointer',transition:'all 0.2s',background:i===idx?'#CBA35C':'rgba(203,163,92,0.3)'}} />
          ))}
        </div>
      ) : null}
    </div>
  );
}



// Morning read — Ari's daily briefing narrative, folded into the Dashboard so
// there's one home. Heavy outreach actions live in the on-demand workspace.

export function DashboardView({ tasks, setTasks, unreadEmailCount = 0, needsReviewCount = 0, reviewCount = 0, user, setView, robots, contacts = [], setContacts, brain, defaultSystem, properties = [], events = [], onOpenPlan, deals = [], oweReplyMap = {}, setOweReplyMap }) {
  const [editTask, setEditTask] = useState(null);
  const [fin, setFin] = useState(null);

  // Save edits to a task triggered from the dashboard. Mirrors the logic in
  // TasksView so behavior (priority system, task_contacts sync) is identical.
  async function handleTaskSave(data) {
    if (!editTask) return;
    const { _contact_ids, _email, ...taskData } = data;
    const { data: updated, error } = await supabase.from('tasks')
      .update(taskData).eq('id', editTask.id).select().single();
    if (error) {
      notify("Couldn't save changes. Try again.", 'error');
      return;
    }
    if (updated) {
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    }
    // Atomic contact-link replacement (Pass 1 Finding #4)
    if (Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_task_contacts', {
        p_task_id: editTask.id,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) {
        notify("Task saved — but contact links didn't update.", 'error');
      }
    }
    if (_email) {
      const { error: emErr } = await emailAssignTask(editTask.id, _email);
      if (emErr) { notify(emErr, 'error'); return; }
      notify('Task emailed to ' + _email.to, 'success');
    }
    setEditTask(null);
  }

  // Toggle complete from the dashboard (checkbox click)
  async function toggleComplete(task, e) {
    e.stopPropagation();  // don't trigger the row's edit-on-click
    const newCompleted = !task.completed;
    const { data: updated, error } = await supabase.from('tasks')
      .update({ completed: newCompleted, updated_at: new Date().toISOString() })
      .eq('id', task.id).select().single();
    if (error) {
      notify("Couldn't update task. Try again.", 'error');
      return;
    }
    if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }
  // Pull streak + GCI goal for the momentum hero (best-effort).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('finance_settings')
          .select('current_prospecting_streak,best_prospecting_streak,annual_gci_goal')
          .eq('user_id', user?.id).maybeSingle();
        if (alive) setFin(data || {});
      } catch (_e) { if (alive) setFin({}); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const pending = tasks.filter(t=>!t.completed);
  const topTasks = sortTasks(pending.filter(isTopPriority));
  const today = new Date();
  const now = Date.now();
  const gr = today.getHours()<12?'Good morning':today.getHours()<17?'Good afternoon':'Good evening';
  const name = user?.user_metadata?.display_name?.trim() || user?.user_metadata?.full_name?.trim()?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'there';
  const todayISO = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const doneToday = tasks.filter(t=>t.completed && t.updated_at && new Date(t.updated_at).toDateString()===today.toDateString()).length;
  const dueToday = pending.filter(t=>t.due_date===todayISO).length;
  const overdue = pending.filter(t=>t.due_date && t.due_date < todayISO);
  const todayTotal = doneToday + dueToday;
  const ringPct = todayTotal>0 ? doneToday/todayTotal : (pending.length===0 ? 1 : 1);
  // "Needs you now" — mirrors the Needs Attention panel's totals. Uses the ONE
  // canonical owesReply() rule (honors settle re-arm on a newer inbound) instead
  // of a hand-rolled copy that treated any settle as permanent (the Scott bug).
  const oweReplyN = contacts.filter(c => {
    if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false;
    return owesReply(c);
  }).length;
  const reachN = contacts.filter(c => { const cad = c.cadence_days; if (!cad) return false; if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false; const a = [c.last_contact_at, c.last_inbound_at, c.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime()); const ts = a.length ? Math.max(...a) : null; const ds = ts === null ? null : Math.floor((now - ts) / 86400000); return ds === null ? true : ds >= cad; }).length;
  const dueOrOverdue = pending.filter(t => t.due_date && t.due_date <= todayISO).length;
  const needsNow = oweReplyN + reachN + dueOrOverdue;
  const upcoming = (events||[]).filter(e=>e.start_at && new Date(e.start_at) >= new Date()).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at)).slice(0,4);
  const apptWeek = (events||[]).filter(e=>e.start_at && new Date(e.start_at).getTime() >= now && (new Date(e.start_at).getTime()-now) <= 7*86400000).length;
  const gciGoal = Number(fin?.annual_gci_goal || 0);
  const _ACTIVE = ['lead','active','under_contract','closing'];
  const _gciOf = (d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const _yrNow = new Date().getFullYear();
  const pipelineGci = (deals||[]).filter(d=>_ACTIVE.includes(d.status)).reduce((a,d)=>a+_gciOf(d),0);
  const gciYtd = (deals||[]).filter(d=>d.status==='closed' && d.close_date && new Date(d.close_date).getFullYear()===_yrNow).reduce((a,d)=>a+_gciOf(d),0);
  const gciPct = gciGoal>0 ? Math.min(100, Math.round(gciYtd/gciGoal*100)) : 0;
  const streak = fin?.current_prospecting_streak || 0;
  const bestStreak = fin?.best_prospecting_streak || 0;
  const money0 = (n) => '$' + Math.round(n).toLocaleString();
  const robot = robots[0];
  // Last 7 days of completed-task counts for the hero sparkline
  const weekDone = (() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const ds = d.toDateString();
      const c = tasks.filter(t => t.completed && (t.completed_at || t.updated_at) && new Date(t.completed_at || t.updated_at).toDateString() === ds).length;
      arr.push({ c, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }) });
    }
    return arr;
  })();
  const weekTotal = weekDone.reduce((a, b) => a + b.c, 0);

  // Radial progress ring (gold gradient)
  const Ring = ({ pct, size=96, stroke=10, children }) => {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, pct)));
    return (
      <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
        <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
          <defs><linearGradient id="dashGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-2)"/><stop offset="1" stopColor="var(--accent)"/></linearGradient></defs>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-base)" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#dashGold)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition:'stroke-dashoffset .7s ease' }} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>{children}</div>
      </div>
    );
  };
  const fmtEvent = (iso) => { const d = new Date(iso); const sameDay = d.toDateString() === today.toDateString(); const tom = new Date(today); tom.setDate(tom.getDate()+1); const isTom = d.toDateString() === tom.toDateString(); const t = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); return sameDay ? `Today · ${t}` : isTom ? `Tomorrow · ${t}` : `${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${t}`; };

  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.10), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .dash-hero{background:linear-gradient(180deg,#1B1610,#100D09);border:1px solid rgba(203,163,92,.22);border-radius:20px;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .quick-chip{border:1px solid rgba(203,163,92,.34);color:#C8BFAE;background:transparent;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <CoachNudge contacts={contacts} tasks={tasks} events={events} deals={deals} reviewCount={reviewCount} oweReplyMap={oweReplyMap} setView={setView} />
      {reviewCount > 0 && (
        <button onClick={()=>setView('review')} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 16px', marginBottom:12, borderRadius:14, cursor:'pointer', textAlign:'left', background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.34)' }}>
          <span style={{ fontSize:18 }}>✦</span>
          <span style={{ flex:1, fontSize:13.5, fontWeight:600, color:'#F6F1E7' }}>{reviewCount} thing{reviewCount>1?'s':''} waiting for you to review</span>
          <span style={{ color:'#CBA35C', fontSize:18 }}>→</span>
        </button>
      )}
      {needsReviewCount > 0 && (
        <button onClick={()=>setView('email_review')} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 15px', marginBottom:12, borderRadius:12, cursor:'pointer', background:'linear-gradient(90deg, rgba(197,169,94,0.16), rgba(197,169,94,0.06))', border:'1px solid rgba(197,169,94,0.45)', color:'var(--text-1)' }}>
          <span style={{ fontSize:13.5, fontWeight:700 }}>📩 <b style={{ color:'var(--accent)' }}>{needsReviewCount}</b> email{needsReviewCount>1?'s':''} flagged for your review</span>
          <span style={{ fontSize:12.5, fontWeight:800, color:'var(--accent)', whiteSpace:'nowrap' }}>Review →</span>
        </button>
      )}
      {/* Hero */}
      <div className="dash-hero">
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <h2 style={{ margin:0, fontFamily:'Fraunces, serif', fontSize:34, fontWeight:300, letterSpacing:'-0.02em', color:'#F6F1E7', lineHeight:1.05 }}>{gr}, {name}.</h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--text-2)', fontWeight:500 }}>{today.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', flex:'1 1 100%', justifyContent:'center' }}>
            <span title={`Best streak: ${bestStreak} days`} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:999, background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.4)', color:'#f5b34a', fontSize:12.5, fontWeight:800 }}>🔥 {streak}-day streak</span>
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:999, background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.35)', color:'#4ade80', fontSize:12.5, fontWeight:800 }}>✓ {doneToday} done today</span>
          </div>
        </div>

        {/* Today focus row: ring + momentum + CTA */}
        <div style={{ display:'flex', alignItems:'center', gap:20, marginTop:18, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16, flex:'1 1 260px', minWidth:240 }}>
            <Ring pct={ringPct}>
              <CountUp value={dueToday} style={{ fontSize:30, fontWeight:300, fontFamily:'Fraunces, serif', color:'#F6F1E7', lineHeight:1 }} />
              <span style={{ fontSize:9.5, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)', marginTop:2 }}>due today</span>
            </Ring>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--text-1)' }}>{dueToday===0 ? 'Today is clear' : `${dueToday} ${dueToday===1?'task':'tasks'} to close out`}</div>
              <div style={{ fontSize:12.5, color:'var(--text-2)', marginTop:3 }}>{doneToday} done · {pending.length} open{overdue.length>0 ? <span style={{ color:'var(--red)', fontWeight:700 }}> · {overdue.length} overdue</span> : null}</div>
              {gciGoal>0 && <div style={{ fontSize:11.5, color:'var(--text-3)', marginTop:5, display:'inline-flex', alignItems:'center', gap:5 }}><Icon name="target" size={12} style={{ color:'var(--accent)' }} /> {money0(gciGoal)} GCI goal</div>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', flex:'1 1 100%', justifyContent:'center' }}>
            <button className="btn btn-primary" onClick={()=>setView('chat')} style={{ borderRadius:11, padding:'11px 18px', fontSize:14, boxShadow:'0 4px 14px rgba(197,169,94,0.35)' }}>✦ Ask {robot?.name||'Ari'}</button>
            <button className="quick-chip" onClick={onOpenPlan} style={{ padding:'11px 16px' }}>✦ Plan my day</button>
          </div>
        </div>

        {/* Weekly momentum sparkline */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:16, paddingTop:14, borderTop:'1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-3)' }}>This week</div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text-1)', marginTop:2 }}><CountUp value={weekTotal} /> tasks completed</div>
          </div>
          <WeekSparkline days={weekDone} />
        </div>
      </div>

      <NextBestAction contacts={contacts} setContacts={setContacts} tasks={tasks} setTasks={setTasks} events={events} deals={deals} gciGoal={gciGoal} setView={setView} onOpenPlan={onOpenPlan} myUserId={user?.id} oweReplyMap={oweReplyMap} setOweReplyMap={setOweReplyMap} />
      <Tip id="nba" label="Why this is first">Top producers don't do <b>more</b> — they do the <b>right thing next</b>. Prism scans every signal — your tasks, who owes you a reply, cadence, appointments, deals — and surfaces the single highest-leverage move, so you never wonder where to start.</Tip>

      {/* At-a-glance pulse — full metrics live in My numbers */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:10.5, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)' }}>At a glance</span>
        <button className="btn btn-ghost btn-sm" onClick={()=>setView('numbers')}>My numbers →</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(78px,1fr))', gap:9, marginBottom:22 }}>
        {[
          { label:'Needs now', val:needsNow, color: needsNow>0?'var(--accent)':'var(--text-1)' },
          { label:'Appts 7d', val:apptWeek, color:'var(--text-1)' },
          { label:'Pipeline', val:money0(pipelineGci), color:'var(--text-1)' },
          { label: gciGoal>0?'GCI pace':'GCI', val: gciGoal>0?(gciPct+'%'):money0(gciYtd), color:'var(--accent)' },
        ].map((s,si)=>(
          <div key={si} onClick={()=>setView('numbers')} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:13, padding:'13px 10px', cursor:'pointer', textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:300, fontFamily:'Fraunces, serif', letterSpacing:'-0.01em', color:s.color, lineHeight:1 }}>{s.val}</div>
            <div style={{ fontSize:9.5, color:'var(--text-3)', marginTop:4, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        {/* Top Priority */}
        <div className="dash-card" style={{ marginBottom:20 }}>
          <div className="panel-header" style={{ borderRadius:'16px 16px 0 0' }}><h3 style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="flame" size={15} style={{ color:'var(--accent)' }} /> Top Priority</h3><button className="btn btn-ghost btn-sm" onClick={()=>setView('tasks')}>All tasks</button></div>
          <div className="panel-body">
            {topTasks.length===0
              ? <div className="empty-state" style={{padding:'20px 0'}}><p>All clear — no top priority tasks.</p></div>
              : <div className="task-list">{topTasks.slice(0,5).map(t=>(
                  <div key={t.id} className="task-item" onClick={() => setEditTask(t)} style={{cursor:'pointer'}}>
                    <input type="checkbox" checked={!!t.completed} onClick={(e) => toggleComplete(t, e)} onChange={() => {}} style={{flexShrink:0,width:'18px',height:'18px',cursor:'pointer',accentColor:'var(--accent)'}} title={t.completed ? 'Mark as not done' : 'Mark as done'} />
                    <span className="task-text" style={{textDecoration: t.completed ? 'line-through' : 'none', color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>{t.title}</span>
                    <div className="task-meta">
                      <span className={`task-priority ${priorityClass(t)}`}>{priorityLabel(t)}</span>
                      {t.due_date && <span className="task-due">{t.due_date}</span>}
                    </div>
                  </div>
                ))}</div>
            }
          </div>
        </div>

        {editTask && (
          <TaskModal onClose={() => setEditTask(null)} onSave={handleTaskSave}
            onDelete={async (t) => {
              if (!await confirmDialog(`Delete "${t.title}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) return;
              const { error } = await supabase.from('tasks').delete().eq('id', t.id);
              if (error) { if (window.__notify) window.__notify('Could not delete: ' + error.message, 'error'); return; }
              setTasks(prev => prev.filter(x => x.id !== t.id));
              setEditTask(null);
              if (window.__notify) window.__notify('Task deleted.', 'success');
              try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
            }}
            initial={editTask} defaultSystem={defaultSystem} brain={brain} contacts={contacts} properties={properties} events={events} userId={user.id} />
        )}
      </div>

      <DashboardAnnouncements userId={user?.id} />

      {/* Lead-Gen ROI */}
    </div>
  );
}

// ─────────────────────────────────────────
// CONTACTS VIEW
// ─────────────────────────────────────────
// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
// Recordings panel inside ContactDetailModal: list, upload, transcribe, view transcript.
// ─── AUDIO TRANSCODING (browser, ffmpeg.wasm) ──────────────────────────
// OpenAI Whisper rejects formats like AMR (what Android call-recorders produce)
// and Storage blocks them too. When an unsupported file is picked we transcode
// it to a small 16 kHz mono MP3 in the browser before upload — accepted by both
// Storage and Whisper. Uses the single-thread ffmpeg.wasm core (no COOP/COEP
// required, so it works on GitHub Pages), lazy-loaded from CDN only on demand.



// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
// ─────────────────────────────────────────────────────────────────────────
// Unified Activity Timeline — phone calls, meetings, texts, emails & notes in
// one chronological stream (the way Attio / Affinity / HubSpot do it). Backed
// by public.contact_interactions (kind/body/occurred_at/direction/duration/
// pinned). Supports back-dating, pin-to-top, inline edit, type filtering, and
// "log + schedule follow-up" which spawns a linked task.
// ─────────────────────────────────────────────────────────────────────────

// Follow-up drafter — reads a timeline entry + contact context, asks Ari to
// draft an email or text in the user's voice, and sends via Gmail (email) or
// hands off to the SMS app (text). Logs the sent follow-up back to the timeline.
// ── Message templates + merge fields ─────────────────────────────────────



// Templates manager — create / edit / delete reusable email & text snippets.


// ─────────────────────────────────────────
// QUO TEXT COMPOSER — send an SMS through the user's Quo (OpenPhone) number
// straight from the app (contact card, contacts list, daily briefing), so no
// copy/paste into a phone's Messages app. Logs the text to the contact timeline.
// ─────────────────────────────────────────










// Downloads a cleaned-up, branded Word (.docx) research report. Two modes:
// "client" (factual dossier to share — no DISC, no coaching) and "agent" (adds
// the DISC behavioral read; still excludes the rapport/things-to-avoid coaching).
// The docx is built server-side (research-report-docx) so it works on every
// device, including iPhone.










// ─── CustomFieldsPanel — Prism CRM custom fields ────────────────────
// Renders all custom_field_definitions for the contact scope, grouped
// by group_name in collapsible sections. Each field gets an appropriate
// editor (text, long_text, number, currency, date, boolean, dropdown,
// contact_ref, lead_gen_system_ref, etc.) and saves on blur / change.
// Agents can add their own custom fields via the "+ Add field" button.
// Cross-indexed refs (contact_ref, lead_gen_system_ref) show a select
// of the relevant records, so a "Lender" field surfaces all of the
// user's contacts that match the optional filter.



// ─── MultiContactPicker ──────────────────────────────────────────────
// Chip-style picker for multi-contact custom fields (children, parents,
// any user-defined contact_ref_multi field). Behavior:
//   - Existing linked contacts render as chips with × to remove
//   - Type to search existing contacts by name; ↑/↓ to navigate, Enter
//     to add, Backspace at empty input removes the last chip
//   - If the typed name doesn't match any existing contact, a
//     "+ Create new contact: 'X'" option appears at the bottom — tap to
//     create a new contact record on the fly and link it in one step
//   - Filters out the current contact (no self-links) and contacts
//     already added


// ─── SingleContactPicker ─────────────────────────────────────────────
// Search-with-autocomplete picker for single-value contact_ref fields
// (Spouse / partner, Lender, Title rep, Referred by, etc.). Mirrors
// the MultiContactPicker UX but holds exactly one selected contact:
//   - When unset: a search input. Type a name to filter; ↑/↓ to move,
//     Enter to pick. Same '+ Create new contact: \"X\"' affordance when
//     no exact match exists.
//   - When set: shows the selected contact as a chip with avatar +
//     name + secondary line. × clears the value and returns to search.
// Respects def.ref_filter so e.g. the 'Lender' field only surfaces
// vendor/partner contacts in the dropdown.


// ── Social links ─────────────────────────────────────────────────────────────
// Stored as contacts.socials jsonb, keyed by platform. Two jobs: give the agent
// one-tap access to a person's profiles, and feed those profiles into web
// research as identity anchors (a LinkedIn URL is the single strongest anchor —
// far better than name+email). Covers every person-type (lead, recruit, agent)
// because they're all contacts rows.

// Turn a handle or partial into a full URL for linking; leave real URLs alone.






// Helper: does this stored value object actually hold a non-empty value
// for its declared field type?


// Single field row — label + appropriate editor


// Read a value row into the editor's local-state shape


// ─── AddCustomFieldModal — user-defined fields ───────────────────────


// ─── MultiValueField ────────────────────────────────────────────────
// Reusable editor for multi-entry contact fields (phones, emails).
// Each entry has a value, a label (Mobile / Work / Home / etc., picked
// from a standard list or custom), and an is_default flag. The default
// entry is the one shown in the contact's compact display and used by
// quick actions like Call / Email. Modeled after iOS Contacts and
// Google Contacts which converged on the same pattern.
