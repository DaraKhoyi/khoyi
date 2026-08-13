// Leads / recruiting — the pipeline board, the lead detail sheet, the conversion
// dashboard and the constants that define the funnel.
// Extracted from App.js (strangle the monolith, step 26).
import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { lbl, modal, money } from '../helpers';
import { Icon } from '../icons';
import { notify } from '../notify';
import { TEMP_META, whenLabel, TempDot, ovl } from '../uiPrimitives';

export const LEAD_STAGES = [
  { id:'new', label:'New', color:'#8b8b8b' },
  { id:'assigned', label:'Assigned', color:'#a0a0a0' },
  { id:'attempting', label:'Attempting', color:'#d8bd78' },
  { id:'contacted', label:'Contacted', color:'#c5a95e' },
  { id:'appointment_set', label:'Appt Set', color:'#3b82f6' },
  { id:'met', label:'Met', color:'#22c55e' },
  { id:'active', label:'Active', color:'#16a34a' },
  { id:'under_contract', label:'Under Contract', color:'#15803d' },
  { id:'closed', label:'Closed', color:'#0a7d33' },
  { id:'nurture', label:'Nurture', color:'#a16207' },
  { id:'lost', label:'Lost', color:'#ef4444' },
];

export const LEAD_TYPES = [['buyer','Buyer'],['seller','Seller'],['renter','Renter'],['investor','Investor']];

export const LEAD_SOURCES = ['Prism AI','Zillow','Realtor.com','Referral','Open house','Sphere','Past client','Sign call','Website','Social','Other'];

export const LEAD_PIPELINE = ['new','assigned','attempting','contacted','appointment_set','met','active','under_contract','closed'];

export const APPT_TYPES = [['buyer_consult','Buyer consult'],['listing_consult','Listing consult'],['showing','Showing'],['call','Phone appt'],['signing','Signing']];

export const ACT_TYPES = [['call','Call'],['text','Text'],['email','Email'],['dm','DM'],['voicemail','Voicemail'],['nurture','Nurture'],['note','Note']];

export const ACT_OUTCOMES = [['connected','Connected'],['no_answer','No answer'],['left_vm','Left voicemail'],['callback','Callback set'],['booked','Booked appt'],['not_interested','Not interested'],['bad_number','Bad number']];

export const CADENCES = {
  speed_to_lead:{ label:'Speed-to-Lead (new)', steps:[
    {w:0,c:'call',t:'Call immediately'},{w:0,c:'text',t:'Text within 5 min'},{w:1,c:'call',t:'Day 1 call'},
    {w:2,c:'call',t:'Day 2 call + VM'},{w:4,c:'email',t:'Day 4 value email'},{w:7,c:'call',t:'Day 7 call'},
    {w:14,c:'text',t:'Day 14 check-in'},{w:30,c:'nurture',t:'Move to long-term nurture'} ]},
  nurture:{ label:'Long-term nurture', steps:[
    {w:30,c:'call',t:'Monthly call'},{w:30,c:'email',t:'Monthly email'},{w:30,c:'call',t:'Monthly call'},{w:60,c:'text',t:'Quarterly check-in'} ]},
  sphere:{ label:'Sphere / past client', steps:[
    {w:7,c:'call',t:'Welcome call'},{w:30,c:'email',t:'Value email'},{w:90,c:'call',t:'Quarterly call'} ]},
};

export const cadenceSteps=(k)=> (CADENCES[k]||{}).steps||[];

export const cadenceDue=(k,step)=>{ const x=cadenceSteps(k)[step]; return x? new Date(Date.now()+x.w*86400000).toISOString() : null; };

export function leadInitials(n){ return (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?'; }

export const stageMeta = (s)=> LEAD_STAGES.find(x=>x.id===s) || LEAD_STAGES[0];

export function StagePill({ stage }){ const m=stageMeta(stage); return <span style={{display:'inline-block',padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:700,color:'#0a0b0d',background:m.color,whiteSpace:'nowrap'}}>{m.label}</span>; }

export function Avatar({ name }){ return <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'24px',height:'24px',borderRadius:'50%',background:'var(--accent-dim)',color:'var(--accent-2)',fontSize:'10px',fontWeight:800,flex:'0 0 auto'}}>{leadInitials(name)}</span>; }

export function LeadDetail({ lead, agents, acts, appts, canWrite, onClose, patch, assignAgent, logActivity, bookAppt }){
  const [tab,setTab]=useState('activity');
  const [na,setNa]=useState({ type:'call', outcome:'connected', duration:'', notes:'' });
  const [ap,setAp]=useState({ agent_id:lead.assigned_agent_id||'', booked_by_id:'', appt_type:'buyer_consult', start_at:'', minutes:'60', location:'', notes:'' });
  const [next,setNext]=useState(lead.next_action_at? lead.next_action_at.slice(0,16):'');
  const agentName=(id)=>{ const a=agents.find(x=>x.id===id); return a?a.name:'—'; };
  const inp={ padding:'7px 9px', fontSize:'13px' };
  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e=>e.stopPropagation()} className="panel" style={{width:'100%',maxWidth:'520px',padding:'18px',maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px'}}>
          <div><div style={{fontSize:'18px',fontWeight:800}}>{lead.name}</div><div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>{lead.source||'—'}{lead.phone?' · '+lead.phone:''}{lead.email?' · '+lead.email:''}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={14} fb="✕"/></button>
        </div>

        {/* quick controls */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'12px'}}>
          <label style={lbl}>Stage<select className="form-input" value={lead.stage} disabled={!canWrite} onChange={e=>patch(lead.id,{stage:e.target.value})} style={inp}>{LEAD_STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label style={lbl}>Temperature<select className="form-input" value={lead.temperature||'warm'} disabled={!canWrite} onChange={e=>patch(lead.id,{temperature:e.target.value})} style={inp}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></label>
          <label style={lbl}>Agent<select className="form-input" value={lead.assigned_agent_id||''} disabled={!canWrite} onChange={e=>assignAgent(lead,e.target.value)} style={inp}><option value="">— Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label style={lbl}>VA<select className="form-input" value={lead.assigned_va_id||''} disabled={!canWrite} onChange={e=>patch(lead.id,{assigned_va_id:e.target.value||null})} style={inp}><option value="">— None</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'flex-end',marginTop:'8px'}}>
          <label style={{...lbl,flex:1}}>Next action<input className="form-input" type="datetime-local" value={next} onChange={e=>setNext(e.target.value)} style={inp}/></label>
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={()=>patch(lead.id,{next_action_at: next? new Date(next).toISOString():null})}>Set</button>}
        </div>
        <div style={{marginTop:'10px',padding:'10px',border:'1px solid var(--border)',borderRadius:'8px',background:'var(--bg-base)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:'8px',flexWrap:'wrap'}}>
            <label style={{...lbl,flex:'1 1 170px'}}>Nurture cadence
              <select className="form-input" value={lead.cadence_key||''} disabled={!canWrite} onChange={e=>patch(lead.id,{ cadence_key:e.target.value||null, cadence_step:0, next_action_at: e.target.value? cadenceDue(e.target.value,0): lead.next_action_at })} style={inp}>
                <option value="">— None</option>{Object.keys(CADENCES).map(k=><option key={k} value={k}>{CADENCES[k].label}</option>)}
              </select>
            </label>
            {lead.cadence_key && canWrite && <button className="btn btn-ghost btn-sm" onClick={()=>{ const ns=(lead.cadence_step||0)+1; patch(lead.id,{cadence_step:ns,next_action_at:cadenceDue(lead.cadence_key,ns)}); }}>Skip step</button>}
          </div>
          {lead.cadence_key && (()=>{ const steps=cadenceSteps(lead.cadence_key); const st=lead.cadence_step||0; const sObj=steps[st]; return (
            <div style={{fontSize:'11.5px',color:'var(--text-2)',marginTop:'6px'}}>{sObj? <>Next: <b style={{color:'var(--accent-2)'}}>{sObj.t}</b> ({sObj.c}) · due {whenLabel(lead.next_action_at)} · step {st+1} of {steps.length}</> : <span style={{color:'var(--green)'}}>Cadence complete ✓</span>}</div>
          ); })()}
        </div>
        <div style={{display:'flex',gap:'10px',marginTop:'10px',fontSize:'11px',color:'var(--text-3)'}}>
          <span><b style={{color:'var(--text-1)'}}>{lead.call_count||0}</b> calls</span>
          <span><b style={{color:'var(--text-1)'}}>{lead.touch_count||0}</b> touches</span>
          {lead.est_value? <span><b style={{color:'var(--text-1)'}}>{money(lead.est_value)}</b> est.</span>:null}
        </div>

        {/* tabs */}
        <div style={{display:'flex',gap:'6px',margin:'14px 0 10px',borderBottom:'1px solid var(--border)'}}>
          {[['activity','Activity'],['log','Log'],['book','Book appt']].map(t=>(
            <button key={t[0]} onClick={()=>setTab(t[0])} className="btn btn-sm" style={{background:'transparent',border:'none',borderBottom:tab===t[0]?'2px solid var(--accent)':'2px solid transparent',color:tab===t[0]?'var(--accent)':'var(--text-2)',borderRadius:0,fontWeight:700,padding:'4px 8px'}}>{t[1]}</button>
          ))}
        </div>

        {tab==='activity' && (
          <div style={{display:'grid',gap:'8px'}}>
            {appts.length>0 && <div style={{display:'grid',gap:'6px'}}>{appts.map(a=>(
              <div key={a.id} className="panel" style={{padding:'8px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',background:'var(--accent-glow)'}}>
                <div><div style={{fontSize:'12px',fontWeight:700,display:'flex',alignItems:'center',gap:'5px'}}><Icon name="calendar" size={12}/> {(APPT_TYPES.find(t=>t[0]===a.appt_type)||['','Appt'])[1]} · {agentName(a.agent_id)}</div><div style={{fontSize:'11px',color:'var(--text-2)'}}>{new Date(a.start_at).toLocaleString()}</div></div>
                {canWrite && <select className="form-input" value={a.status} onChange={async e=>{ await supabase.from('lead_appointments').update({status:e.target.value}).eq('id',a.id); if(e.target.value==='showed'||e.target.value==='converted') patch(lead.id,{stage:'met'}); }} style={{padding:'3px 6px',fontSize:'11px',width:'auto'}}>{['booked','confirmed','showed','no_show','rescheduled','canceled','converted'].map(s=><option key={s} value={s}>{s}</option>)}</select>}
              </div>
            ))}</div>}
            {acts.length===0 ? <div style={{color:'var(--text-3)',fontSize:'12px',padding:'8px 0'}}>No activity yet. Use <b>Log</b> to record a call or touch.</div> :
              acts.map(a=>(
                <div key={a.id} style={{display:'flex',gap:'8px',padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                  <Icon name={a.type==='call'?'quo':a.type==='email'?'mail':a.type==='text'?'message':'notes'} size={14} fb="•" style={{color:'var(--accent)',marginTop:'2px'}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'12px',fontWeight:600}}>{(ACT_TYPES.find(t=>t[0]===a.type)||['','']) [1]}{a.outcome?' — '+(ACT_OUTCOMES.find(o=>o[0]===a.outcome)||['',a.outcome])[1]:''}{a.duration_seconds?' · '+Math.round(a.duration_seconds/60)+'m':''}</div>
                    {a.notes && <div style={{fontSize:'11.5px',color:'var(--text-2)'}}>{a.notes}</div>}
                    <div style={{fontSize:'10px',color:'var(--text-3)'}}>{new Date(a.occurred_at).toLocaleString()}{a.agent_id?' · '+agentName(a.agent_id):''}</div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab==='log' && (
          <div style={{display:'grid',gap:'8px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label style={lbl}>Type<select className="form-input" value={na.type} onChange={e=>setNa({...na,type:e.target.value})} style={inp}>{ACT_TYPES.map(t=><option key={t[0]} value={t[0]}>{t[1]}</option>)}</select></label>
              <label style={lbl}>Outcome<select className="form-input" value={na.outcome} onChange={e=>setNa({...na,outcome:e.target.value})} style={inp}><option value="">—</option>{ACT_OUTCOMES.filter(o=>o[0]!=='booked').map(o=><option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></label>
            </div>
            {na.type==='call' && <label style={lbl}>Duration (min)<input className="form-input" type="number" value={na.duration} onChange={e=>setNa({...na,duration:e.target.value})} style={inp}/></label>}
            <label style={lbl}>Notes<textarea className="form-input" rows={2} value={na.notes} onChange={e=>setNa({...na,notes:e.target.value})} style={{...inp,resize:'vertical'}}/></label>
            <button className="btn btn-primary btn-sm" disabled={!canWrite} onClick={()=>{ logActivity(lead,na); setNa({ type:'call', outcome:'connected', duration:'', notes:'' }); setTab('activity'); }}>Log activity</button>
          </div>
        )}

        {tab==='book' && (
          <div style={{display:'grid',gap:'8px'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)'}}>VAs book onto an agent's calendar — the appointment syncs to Google and lands on the lead's timeline.</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label style={lbl}>Agent's calendar<select className="form-input" value={ap.agent_id} onChange={e=>setAp({...ap,agent_id:e.target.value})} style={inp}><option value="">Choose agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label style={lbl}>Booked by (VA)<select className="form-input" value={ap.booked_by_id} onChange={e=>setAp({...ap,booked_by_id:e.target.value})} style={inp}><option value="">—</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            </div>
            <label style={lbl}>Type<select className="form-input" value={ap.appt_type} onChange={e=>setAp({...ap,appt_type:e.target.value})} style={inp}>{APPT_TYPES.map(t=><option key={t[0]} value={t[0]}>{t[1]}</option>)}</select></label>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'8px'}}>
              <label style={lbl}>When<input className="form-input" type="datetime-local" value={ap.start_at} onChange={e=>setAp({...ap,start_at:e.target.value})} style={inp}/></label>
              <label style={lbl}>Mins<input className="form-input" type="number" value={ap.minutes} onChange={e=>setAp({...ap,minutes:e.target.value})} style={inp}/></label>
            </div>
            <label style={lbl}>Location<input className="form-input" value={ap.location} onChange={e=>setAp({...ap,location:e.target.value})} style={inp}/></label>
            <label style={lbl}>Notes<input className="form-input" value={ap.notes} onChange={e=>setAp({...ap,notes:e.target.value})} style={inp}/></label>
            <button className="btn btn-primary btn-sm" disabled={!canWrite} onClick={()=>bookAppt(lead,ap)}><Icon name="calendar" size={13}/> Book on calendar</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LeadsBoard({ userId, ownerId, agents, canWrite, isAdmin, myTeam }){
  const [leads,setLeads]=useState([]);
  const [loading,setLoading]=useState(true);
  const [openId,setOpenId]=useState(null);
  const [acts,setActs]=useState([]);
  const [appts,setAppts]=useState([]);
  const [f,setF]=useState({ stage:'', agent:'', team:'', temp:'', q:'', due:false });
  const [showNew,setShowNew]=useState(false);
  const [nv,setNv]=useState({ name:'', phone:'', email:'', source:'Prism AI', lead_type:'buyer', temperature:'warm', assigned_agent_id:'', est_value:'' });
  const notify=(m,t)=>{ if(window.__notify) window.__notify(m,t||'success'); };
  const teams=[...new Set(agents.map(a=>a.team).filter(Boolean))];
  const agentName=(id)=>{ const a=agents.find(x=>x.id===id); return a?a.name:''; };

  const load=async()=>{ setLoading(true); const { data } = await supabase.from('leads').select('*').order('created_at',{ascending:false}); setLeads(data||[]); setLoading(false); };
  useEffect(()=>{ load(); },[]);

  const open = leads.find(l=>l.id===openId)||null;
  const loadDetail=async(id)=>{
    const [{ data:a },{ data:p }] = await Promise.all([
      supabase.from('lead_activities').select('*').eq('lead_id',id).order('occurred_at',{ascending:false}),
      supabase.from('lead_appointments').select('*').eq('lead_id',id).order('start_at',{ascending:false}),
    ]);
    setActs(a||[]); setAppts(p||[]);
  };
  useEffect(()=>{ if(openId) loadDetail(openId); },[openId]);

  const patch=async(id,upd)=>{
    setLeads(p=>p.map(l=>l.id===id?{...l,...upd}:l));
    const { error } = await supabase.from('leads').update(upd).eq('id',id);
    if(error) notify('Save failed: '+error.message,'error');
  };
  const assignAgent=(l,agent_id)=>{ const upd={ assigned_agent_id:agent_id||null }; if(agent_id){ upd.assigned_at=new Date().toISOString(); if(l.stage==='new') upd.stage='assigned'; const ag=agents.find(x=>x.id===agent_id); if(ag&&ag.team) upd.team=ag.team; } patch(l.id,upd); };

  const addLead=async()=>{
    if(!nv.name.trim()){ notify('Lead name required.','error'); return; }
    const ag=agents.find(x=>x.id===nv.assigned_agent_id);
    const row={ user_id:ownerId, name:nv.name.trim(), phone:nv.phone.trim()||null, email:nv.email.trim()||null,
      source:nv.source||null, lead_type:nv.lead_type, temperature:nv.temperature,
      assigned_agent_id:nv.assigned_agent_id||null, assigned_at: nv.assigned_agent_id? new Date().toISOString():null,
      team: ag?.team || (myTeam||null), stage: nv.assigned_agent_id?'assigned':'new', est_value: nv.est_value?Number(nv.est_value):null };
    const { data, error } = await supabase.from('leads').insert(row).select().single();
    if(error){ notify('Could not add: '+error.message,'error'); return; }
    setLeads(p=>[data,...p]); setShowNew(false); setNv({ name:'', phone:'', email:'', source:'Prism AI', lead_type:'buyer', temperature:'warm', assigned_agent_id:'', est_value:'' }); setOpenId(data.id);
  };

  const logActivity=async(l,a)=>{
    const row={ user_id:ownerId, lead_id:l.id, agent_id:l.assigned_agent_id||null, actor_role:'agent',
      type:a.type, direction:a.direction||'outbound', outcome:a.outcome||null, duration_seconds:a.duration?Number(a.duration)*60:null, notes:a.notes||null,
      occurred_at:new Date().toISOString() };
    const { data, error } = await supabase.from('lead_activities').insert(row).select().single();
    if(error){ notify('Log failed: '+error.message,'error'); return; }
    const upd={ last_activity_at:new Date().toISOString(), touch_count:(l.touch_count||0)+1 };
    if(a.type==='call') upd.call_count=(l.call_count||0)+1;
    if(!l.first_contact_at && (a.outcome==='connected'||a.type!=='note')) upd.first_contact_at=new Date().toISOString();
    if(a.outcome==='connected' && LEAD_PIPELINE.indexOf(l.stage)<LEAD_PIPELINE.indexOf('contacted')) upd.stage='contacted';
    if(l.cadence_key){ const ns=(l.cadence_step||0)+1; upd.cadence_step=ns; upd.next_action_at=cadenceDue(l.cadence_key,ns); }
    else { const add=l.temperature==='hot'?1:l.temperature==='cold'?7:3; upd.next_action_at=new Date(Date.now()+add*86400000).toISOString(); }
    await patch(l.id,upd);
    setActs(p=>[data,...p]); notify('Activity logged.');
  };

  const bookAppt=async(l,a)=>{
    if(!a.start_at){ notify('Pick a date & time.','error'); return; }
    if(!a.agent_id){ notify('Choose the agent whose calendar to book.','error'); return; }
    const start=new Date(a.start_at); const end=new Date(start.getTime()+(Number(a.minutes||60))*60000);
    const aname=agentName(a.agent_id); const tlabel=(APPT_TYPES.find(t=>t[0]===a.appt_type)||['','Appt'])[1];
    const title=`${aname?aname+' · ':''}${tlabel} — ${l.name}`;
    const { data:ev, error:eerr } = await supabase.from('events').insert({ user_id:ownerId, title, description:`Lead appointment booked via Lead Engine.\nLead: ${l.name}${l.phone?' · '+l.phone:''}${a.notes?'\n'+a.notes:''}`, location:a.location||null, start_at:start.toISOString(), end_at:end.toISOString(), all_day:false, contact_id:l.contact_id||null, category:'appointment', event_kind:'lead_appointment', status:'confirmed', sync_status:'pending_push' }).select().single();
    if(eerr){ notify('Calendar write failed: '+eerr.message,'error'); return; }
    const { data:ap, error:aerr } = await supabase.from('lead_appointments').insert({ user_id:ownerId, lead_id:l.id, agent_id:a.agent_id, booked_by_id:a.booked_by_id||null, title, appt_type:a.appt_type, start_at:start.toISOString(), end_at:end.toISOString(), location:a.location||null, status:'booked', event_id:ev.id }).select().single();
    if(aerr){ notify('Appt save failed: '+aerr.message,'error'); return; }
    await supabase.from('lead_activities').insert({ user_id:ownerId, lead_id:l.id, agent_id:a.agent_id, actor_role:'va', type:'note', outcome:'booked', notes:`Booked ${tlabel} for ${start.toLocaleString()}`, occurred_at:new Date().toISOString() });
    const upd={ stage:'appointment_set', next_action_at:start.toISOString(), last_activity_at:new Date().toISOString(), touch_count:(l.touch_count||0)+1 };
    await patch(l.id,upd);
    setAppts(p=>[ap,...p]); loadDetail(l.id); notify('Appointment booked — pushing to calendar.');
  };

  // KPIs
  const todayStr=new Date().toISOString().slice(0,10);
  const k={ total:leads.length, unassigned:leads.filter(l=>!l.assigned_agent_id&&l.stage!=='closed'&&l.stage!=='lost').length,
    due:leads.filter(l=>l.next_action_at && l.next_action_at.slice(0,10)<=todayStr && !['closed','lost'].includes(l.stage)).length,
    hot:leads.filter(l=>l.temperature==='hot'&&!['closed','lost'].includes(l.stage)).length };
  const contacted=leads.filter(l=>LEAD_PIPELINE.indexOf(l.stage)>=LEAD_PIPELINE.indexOf('contacted')||l.call_count>0).length;
  k.contactRate = k.total? Math.round(contacted/k.total*100):0;

  // filtered
  const fl=leads.filter(l=>{
    if(f.stage && l.stage!==f.stage) return false;
    if(f.agent && l.assigned_agent_id!==f.agent) return false;
    if(f.team && l.team!==f.team) return false;
    if(f.temp && l.temperature!==f.temp) return false;
    if(f.q){ const q=f.q.toLowerCase(); if(!((l.name||'').toLowerCase().includes(q)||(l.phone||'').includes(q)||(l.email||'').toLowerCase().includes(q))) return false; }
    if(f.due){ if(!(l.next_action_at && l.next_action_at.slice(0,10)<=todayStr && !['closed','lost'].includes(l.stage))) return false; }
    return true;
  });
  if(f.due) fl.sort((a,b)=> new Date(a.next_action_at||0) - new Date(b.next_action_at||0));
  const pipeCounts=LEAD_PIPELINE.map(s=>({ s, n:leads.filter(l=>l.stage===s).length }));
  const maxPipe=Math.max(1,...pipeCounts.map(p=>p.n));

  const inp={ padding:'7px 9px', fontSize:'13px' };
  return (
    <div style={{marginTop:'12px',display:'grid',gap:'12px'}}>
      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'8px'}}>
        {[['Leads',k.total,'target'],['Unassigned',k.unassigned,'users'],['Due today',k.due,'clock'],['Hot',k.hot,'flame'],['Contact %',k.contactRate+'%','signal']].map((c,i)=>(
          <div key={i} className="panel" style={{padding:'10px 12px'}}>
            <div style={{fontSize:'10px',color:'var(--text-3)',display:'flex',alignItems:'center',gap:'4px',textTransform:'uppercase',letterSpacing:'.04em'}}><Icon name={c[2]} size={11} fb="•"/> {c[0]}</div>
            <div style={{fontSize:'19px',fontWeight:800,marginTop:'2px'}}>{c[1]}</div>
          </div>
        ))}
      </div>

      {/* pipeline bar */}
      <div className="panel" style={{padding:'12px'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'.04em'}}>Pipeline</div>
        <div style={{display:'flex',gap:'5px',alignItems:'flex-end',overflowX:'auto'}}>
          {pipeCounts.map(({s,n})=>{ const m=stageMeta(s); return (
            <button key={s} onClick={()=>setF(x=>({...x,stage:x.stage===s?'':s}))} title={m.label} style={{flex:'1 1 0',minWidth:'56px',background:'transparent',border:'none',cursor:'pointer',padding:0}}>
              <div style={{height:Math.max(6,n/maxPipe*46)+'px',background:m.color,borderRadius:'4px 4px 0 0',opacity:f.stage&&f.stage!==s?0.35:1}}/>
              <div style={{fontSize:'15px',fontWeight:800,marginTop:'3px'}}>{n}</div>
              <div style={{fontSize:'9px',color:'var(--text-3)',lineHeight:1.1}}>{m.label}</div>
            </button>
          ); })}
        </div>
      </div>

      {/* filters */}
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="form-input" placeholder="Search name, phone, email" value={f.q} onChange={e=>setF(x=>({...x,q:e.target.value}))} style={{...inp,flex:'1 1 160px',minWidth:'140px'}}/>
        <select className="form-input" value={f.stage} onChange={e=>setF(x=>({...x,stage:e.target.value}))} style={{...inp,width:'auto'}}><option value="">All stages</option>{LEAD_STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className="form-input" value={f.agent} onChange={e=>setF(x=>({...x,agent:e.target.value}))} style={{...inp,width:'auto'}}><option value="">All agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {teams.length>0 && <select className="form-input" value={f.team} onChange={e=>setF(x=>({...x,team:e.target.value}))} style={{...inp,width:'auto'}}><option value="">All teams</option>{teams.map(t=><option key={t} value={t}>{t}</option>)}</select>}
        <select className="form-input" value={f.temp} onChange={e=>setF(x=>({...x,temp:e.target.value}))} style={{...inp,width:'auto'}}><option value="">Any temp</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <button className="btn btn-sm" onClick={()=>setF(x=>({...x,due:!x.due}))} style={{marginLeft:'auto',background:f.due?'var(--accent)':'transparent',color:f.due?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Due</button>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={()=>setShowNew(true)}>+ New lead</button>}
      </div>

      {/* table */}
      {loading ? <div className="panel" style={{padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Loading leads…</div> :
       fl.length===0 ? <div className="panel" style={{padding:'28px',textAlign:'center',color:'var(--text-2)'}}>No leads yet. Add one with <b>+ New lead</b> — or wire your Prism AI / portal feeds in Phase 3.</div> : (
        <div className="panel" style={{overflowX:'auto',padding:0}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
            <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}>
              <th style={{padding:'9px 10px'}}>Lead</th><th style={{padding:'9px 6px'}}>Temp</th><th style={{padding:'9px 6px'}}>Stage</th><th style={{padding:'9px 6px'}}>Agent</th><th style={{padding:'9px 6px',textAlign:'center'}}>Calls</th><th style={{padding:'9px 6px'}}>Next</th>
            </tr></thead>
            <tbody>
            {fl.map(l=>(
              <tr key={l.id} style={{borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>setOpenId(l.id)}>
                <td style={{padding:'8px 10px'}}><div style={{fontWeight:700}}>{l.name}</div><div style={{fontSize:'10.5px',color:'var(--text-3)'}}>{l.source||'—'}{l.phone?' · '+l.phone:''}</div></td>
                <td style={{padding:'8px 6px'}}><TempDot t={l.temperature}/></td>
                <td style={{padding:'8px 6px'}} onClick={e=>e.stopPropagation()}>
                  <select className="form-input" value={l.stage} onChange={e=>patch(l.id,{stage:e.target.value})} disabled={!canWrite} style={{padding:'3px 6px',fontSize:'11px',width:'auto'}}>{LEAD_STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
                </td>
                <td style={{padding:'8px 6px'}} onClick={e=>e.stopPropagation()}>
                  <select className="form-input" value={l.assigned_agent_id||''} onChange={e=>assignAgent(l,e.target.value)} disabled={!canWrite} style={{padding:'3px 6px',fontSize:'11px',width:'auto',maxWidth:'120px'}}><option value="">— Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
                </td>
                <td style={{padding:'8px 6px',textAlign:'center',fontWeight:700}}>{l.call_count||0}</td>
                <td style={{padding:'8px 6px'}}>{l.next_action_at? <span style={{color:whenLabel(l.next_action_at)==='Overdue'?'var(--red)':'var(--text-2)',fontWeight:600}}>{whenLabel(l.next_action_at)}</span>:<span style={{color:'var(--text-3)'}}>—</span>}</td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New lead modal */}
      {showNew && (
        <div onClick={()=>setShowNew(false)} style={ovl}>
          <div onClick={e=>e.stopPropagation()} className="panel" style={modal}>
            <h3 style={{margin:'0 0 10px',display:'flex',alignItems:'center',gap:'6px'}}><Icon name="target" size={17}/> New lead</h3>
            <div style={{display:'grid',gap:'8px'}}>
              <input className="form-input" placeholder="Full name *" value={nv.name} onChange={e=>setNv({...nv,name:e.target.value})}/>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <input className="form-input" placeholder="Phone" value={nv.phone} onChange={e=>setNv({...nv,phone:e.target.value})}/>
                <input className="form-input" placeholder="Email" value={nv.email} onChange={e=>setNv({...nv,email:e.target.value})}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <select className="form-input" value={nv.source} onChange={e=>setNv({...nv,source:e.target.value})}>{LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select>
                <select className="form-input" value={nv.lead_type} onChange={e=>setNv({...nv,lead_type:e.target.value})}>{LEAD_TYPES.map(t=><option key={t[0]} value={t[0]}>{t[1]}</option>)}</select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <select className="form-input" value={nv.temperature} onChange={e=>setNv({...nv,temperature:e.target.value})}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
                <input className="form-input" type="number" placeholder="Est. value $" value={nv.est_value} onChange={e=>setNv({...nv,est_value:e.target.value})}/>
              </div>
              <select className="form-input" value={nv.assigned_agent_id} onChange={e=>setNv({...nv,assigned_agent_id:e.target.value})}><option value="">Assign to… (optional)</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'4px'}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowNew(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={addLead}>Add lead</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {open && <LeadDetail lead={open} agents={agents} acts={acts} appts={appts} canWrite={canWrite} onClose={()=>setOpenId(null)} patch={patch} assignAgent={assignAgent} logActivity={logActivity} bookAppt={bookAppt}/>}
    </div>
  );
}

export function ConversionDashboard({ userId, agents }){
  const [data,setData]=useState(null);
  const [range,setRange]=useState('90');
  const [scope,setScope]=useState('all');
  const teams=[...new Set(agents.map(a=>a.team).filter(Boolean))];
  useEffect(()=>{ (async()=>{
    const [{ data:leads },{ data:acts },{ data:appts },{ data:led },{ data:cons },{ data:sys }] = await Promise.all([
      supabase.from('leads').select('*'),
      supabase.from('lead_activities').select('id,lead_id,agent_id,type,occurred_at'),
      supabase.from('lead_appointments').select('id,lead_id,agent_id,status,start_at'),
      supabase.from('cda_ledger').select('id,agent_id,closed_on,created_at'),
      supabase.from('contacts').select('id,type,lead_gen_system_id,pipeline_stage'),
      supabase.from('lead_gen_systems').select('id,name,color,monthly_budget,is_archived'),
    ]);
    setData({ leads:leads||[], acts:acts||[], appts:appts||[], led:led||[], cons:cons||[], sys:(sys||[]).filter(s=>!s.is_archived) });
  })(); },[]);
  if(!data) return <div className="panel" style={{marginTop:'12px',padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Loading conversion…</div>;

  const PSTAGES = [['new','New'],['attempting','Attempting'],['contacted','Contacted'],['appointment_set','Appt'],['nurture','Nurture'],['closed','Closed']];
  const pipeContacts = (data.cons||[]).filter(c=>c.pipeline_stage && c.pipeline_stage!=='lost');
  const cFunnel = PSTAGES.map(([id,label])=>({ id,label, n: pipeContacts.filter(c=>c.pipeline_stage===id).length }));
  const funnelMax = Math.max(1, ...cFunnel.map(f=>f.n));
  const _srcById={}; (data.cons||[]).forEach(c=>{ if(!c.lead_gen_system_id) return; const k=c.lead_gen_system_id; _srcById[k]=_srcById[k]||{leads:0,closed:0}; _srcById[k].leads++; if(c.pipeline_stage==='closed') _srcById[k].closed++; });
  const srcKpi = (data.sys||[]).map(s=>{ const d=_srcById[s.id]||{leads:0,closed:0}; const conv=d.leads?Math.round(d.closed/d.leads*100):0; const budget=Number(s.monthly_budget)||0; const cpl=d.leads?budget/d.leads:null; return {id:s.id,name:s.name,color:s.color,leads:d.leads,closed:d.closed,conv,budget,cpl}; }).filter(x=>x.leads>0||x.budget>0).sort((a,b)=>b.leads-a.leads);
  const srcMax = Math.max(1, ...srcKpi.map(x=>x.leads));
  const totalAttributed = pipeContacts.length;
  const cutoff = range==='all'? 0 : Date.now()-Number(range)*86400000;
  const inRange=(d)=> range==='all' || (d && new Date(d).getTime()>=cutoff);
  const agentIds = scope==='all'? null : scope.startsWith('team:')? new Set(agents.filter(a=>a.team===scope.slice(5)).map(a=>a.id)) : new Set([scope.slice(6)]);
  const scoped=(aid)=> !agentIds || (aid && agentIds.has(aid));

  const leads=data.leads.filter(l=>inRange(l.created_at) && scoped(l.assigned_agent_id));
  const apptByLead=new Set(data.appts.filter(a=>scoped(a.agent_id)).map(a=>a.lead_id));
  const metByLead=new Set(data.appts.filter(a=>['showed','converted'].includes(a.status)).map(a=>a.lead_id));
  const callsBy={}; data.acts.filter(a=>a.type==='call'&&scoped(a.agent_id)&&inRange(a.occurred_at)).forEach(a=>{ callsBy[a.agent_id]=(callsBy[a.agent_id]||0)+1; });
  const idx=(s)=>LEAD_PIPELINE.indexOf(s);

  const reach={ leads:leads.length,
    contacted: leads.filter(l=>idx(l.stage)>=idx('contacted')||l.call_count>0).length,
    appt: leads.filter(l=>idx(l.stage)>=idx('appointment_set')||apptByLead.has(l.id)).length,
    met: leads.filter(l=>idx(l.stage)>=idx('met')||metByLead.has(l.id)).length,
    uc: leads.filter(l=>idx(l.stage)>=idx('under_contract')).length,
    closed: leads.filter(l=>l.stage==='closed').length };
  const totalCalls=Object.values(callsBy).reduce((s,n)=>s+n,0);
  const funnel=[['Leads',reach.leads],['Contacted',reach.contacted],['Appt set',reach.appt],['Met',reach.met],['Under contract',reach.uc],['Closed',reach.closed]];
  const maxF=Math.max(1,reach.leads);
  const pct=(a,b)=> b? Math.round(a/b*100):0;

  // per-agent
  const rows=agents.filter(a=>scoped(a.id)).map(a=>{
    const ls=leads.filter(l=>l.assigned_agent_id===a.id);
    const c=callsBy[a.id]||0;
    const cont=ls.filter(l=>idx(l.stage)>=idx('contacted')||l.call_count>0).length;
    const ap=ls.filter(l=>idx(l.stage)>=idx('appointment_set')||apptByLead.has(l.id)).length;
    const cl=ls.filter(l=>l.stage==='closed').length;
    return { a, n:ls.length, c, cont, ap, cl, conv: pct(cl,ls.length) };
  }).filter(r=>r.n>0||r.c>0).sort((x,y)=>y.cl-x.cl||y.n-x.n);

  return (
    <div style={{marginTop:'12px',display:'grid',gap:'12px'}}>
      <div className="panel" style={{padding:'16px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)',marginBottom:'2px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="signal" size={16}/> Lead Source Effectiveness</div>
        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'14px'}}>Live from your contact pipeline · {totalAttributed} attributed contact{totalAttributed===1?'':'s'}</div>
        {srcKpi.length===0 ? <div style={{fontSize:'12px',color:'var(--text-3)'}}>No lead sources attributed yet. Tag a contact with a Lead Source on its Overview to populate this.</div> :
          srcKpi.map(k=>(<div key={k.id} style={{marginBottom:'12px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'4px',gap:'8px'}}>
              <span style={{fontSize:'12.5px',fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.name}</span>
              <span style={{fontSize:'11px',color:'var(--text-2)',flexShrink:0}}>{k.leads} lead{k.leads===1?'':'s'} · {k.conv}% closed</span>
            </div>
            <div style={{height:'10px',borderRadius:'5px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(k.leads/srcMax*100))+'%',background:k.color||'var(--accent)',borderRadius:'5px'}}/></div>
            <div style={{marginTop:'3px',fontSize:'10.5px',color:'var(--text-3)'}}>{k.budget>0?('$'+k.budget.toLocaleString()+'/mo'+(k.cpl!=null?' · $'+Math.round(k.cpl).toLocaleString()+'/lead':'')):'No spend'}{k.closed>0?' · '+k.closed+' closed':''}</div>
          </div>))
        }
      </div>
      <div className="panel" style={{padding:'16px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)',marginBottom:'14px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="target" size={16}/> Pipeline funnel</div>
        {totalAttributed===0 ? <div style={{fontSize:'12px',color:'var(--text-3)'}}>No contacts in pipeline yet. Set a stage on a contact Overview to start.</div> :
          cFunnel.map(f=>(<div key={f.id} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
            <span style={{width:'80px',fontSize:'11px',color:'var(--text-2)',flexShrink:0}}>{f.label}</span>
            <div style={{flex:1,height:'18px',borderRadius:'5px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(f.n/funnelMax*100))+'%',background:'var(--accent)',borderRadius:'5px',minWidth:f.n>0?'4px':'0'}}/></div>
            <span style={{width:'26px',textAlign:'right',fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>{f.n}</span>
          </div>))
        }
      </div>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
        <select className="form-input" value={scope} onChange={e=>setScope(e.target.value)} style={{padding:'6px 9px',fontSize:'13px',width:'auto'}}>
          <option value="all">Whole brokerage</option>
          {teams.map(t=><option key={t} value={'team:'+t}>Team · {t}</option>)}
          <option disabled>──────────</option>
          {agents.map(a=><option key={a.id} value={'agent:'+a.id}>{a.name}</option>)}
        </select>
        <select className="form-input" value={range} onChange={e=>setRange(e.target.value)} style={{padding:'6px 9px',fontSize:'13px',width:'auto'}}>
          <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 mo</option><option value="all">All time</option>
        </select>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
        {[['Leads',reach.leads],['Calls',totalCalls],['Appointments',reach.appt],['Closed',reach.closed]].map((c,i)=>(
          <div key={i} className="panel" style={{padding:'10px 12px'}}><div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.04em'}}>{c[0]}</div><div style={{fontSize:'19px',fontWeight:800}}>{c[1]}</div></div>
        ))}
      </div>

      {/* funnel */}
      <div className="panel" style={{padding:'14px'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'10px',textTransform:'uppercase',letterSpacing:'.04em'}}>Conversion funnel</div>
        <div style={{display:'grid',gap:'7px'}}>
          {funnel.map(([label,n],i)=>{
            const prev=i>0?funnel[i-1][1]:n; const step=i>0?pct(n,prev):100; const overall=pct(n,reach.leads);
            return (
              <div key={label} style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <div style={{width:'108px',fontSize:'12px',color:'var(--text-2)',textAlign:'right',flex:'0 0 auto'}}>{label}</div>
                <div style={{flex:1,background:'var(--bg-base)',borderRadius:'6px',overflow:'hidden',height:'26px',position:'relative'}}>
                  <div style={{width:Math.max(2,overall)+'%',height:'100%',background:i===funnel.length-1?'var(--green)':'linear-gradient(90deg,var(--accent),var(--accent-2))',transition:'width .3s'}}/>
                  <div style={{position:'absolute',left:'8px',top:0,height:'100%',display:'flex',alignItems:'center',fontSize:'12px',fontWeight:700,color:'#0a0b0d'}}>{n}</div>
                </div>
                <div style={{width:'78px',fontSize:'11px',color:'var(--text-3)',flex:'0 0 auto'}}>{i>0&&<span>{step}% <span style={{color:'var(--text-3)'}}>step</span></span>}</div>
              </div>
            );
          })}
        </div>
        <div style={{marginTop:'10px',fontSize:'11px',color:'var(--text-3)'}}>Lead → Closed: <b style={{color:'var(--accent-2)'}}>{pct(reach.closed,reach.leads)}%</b> · Lead → Appt: <b style={{color:'var(--accent-2)'}}>{pct(reach.appt,reach.leads)}%</b> · Appt → Met: <b style={{color:'var(--accent-2)'}}>{pct(reach.met,reach.appt)}%</b></div>
      </div>

      {/* per agent */}
      <div className="panel" style={{overflowX:'auto',padding:0}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
          <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}>
            <th style={{padding:'9px 10px'}}>Agent</th><th style={{padding:'9px 6px',textAlign:'right'}}>Leads</th><th style={{padding:'9px 6px',textAlign:'right'}}>Calls</th><th style={{padding:'9px 6px',textAlign:'right'}}>Contacted</th><th style={{padding:'9px 6px',textAlign:'right'}}>Appts</th><th style={{padding:'9px 6px',textAlign:'right'}}>Closed</th><th style={{padding:'9px 6px',textAlign:'right'}}>Conv %</th>
          </tr></thead>
          <tbody>
            {rows.length===0? <tr><td colSpan={7} style={{padding:'22px',textAlign:'center',color:'var(--text-2)'}}>No lead activity in range.</td></tr> :
            rows.map(r=>(
              <tr key={r.a.id} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'8px 10px',display:'flex',alignItems:'center',gap:'7px'}}><Avatar name={r.a.name}/> {r.a.name}{r.a.team?<span style={{fontSize:'10px',color:'var(--text-3)'}}> · {r.a.team}</span>:null}</td>
                <td style={{padding:'8px 6px',textAlign:'right'}}>{r.n}</td>
                <td style={{padding:'8px 6px',textAlign:'right'}}>{r.c}</td>
                <td style={{padding:'8px 6px',textAlign:'right'}}>{r.cont}</td>
                <td style={{padding:'8px 6px',textAlign:'right'}}>{r.ap}</td>
                <td style={{padding:'8px 6px',textAlign:'right',fontWeight:700}}>{r.cl}</td>
                <td style={{padding:'8px 6px',textAlign:'right',color:'var(--accent-2)',fontWeight:700}}>{r.conv}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// =================== END LEAD ENGINE ===================


// ===================== ACCOUNTING (Phase 5) =====================
