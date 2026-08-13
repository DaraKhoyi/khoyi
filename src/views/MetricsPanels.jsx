// Metrics — the numbers surfaces: lead-gen ROI, the KPI tiles, the GCI gauge,
// the sphere donut, the pipeline funnel and the My Numbers screen.
// Charts and tiles only; no data fetching lives here beyond each panel's own.
// Extracted from App.js (strangle the monolith, step 28).
import { CountUp } from '../uiPrimitives';
import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { money, todayISO } from '../helpers';
import { Icon } from '../icons';
import { MyProduction } from '../views/ProductionViews';

export function SphereDonut({ contacts=[], setView }){
  const [anim,setAnim]=useState(false);
  useEffect(()=>{ const tm=setTimeout(()=>setAnim(true),100); return ()=>clearTimeout(tm); },[]);
  const TYPE_META=[['our_agent','Agents','#C5A95E'],['recruit','Recruits','#8b5cf6'],['vendor','Vendors','#3b82f6'],['family','Family','#ec4899'],['lead','Leads','#f59e0b'],['client','Clients','#22c55e'],['partner','Partners','#06b6d4'],['personal','Personal','#94a3b8'],['agent','Agents (other)','#eab308']];
  const counts={}; (contacts||[]).forEach(c=>{ const ty=c.type||'other'; counts[ty]=(counts[ty]||0)+1; });
  let seg=TYPE_META.map(([id,label,color])=>({id,label,color,n:counts[id]||0})).filter(x=>x.n>0);
  const known=new Set(TYPE_META.map(m=>m[0])); let otherN=0; Object.keys(counts).forEach(k=>{ if(!known.has(k)) otherN+=counts[k]; }); if(otherN>0) seg.push({id:'other',label:'Other',color:'#64748b',n:otherN});
  seg.sort((a,b)=>b.n-a.n);
  const tot=seg.reduce((a,s)=>a+s.n,0);
  const R=58, C=2*Math.PI*R; let off=0;
  if(tot===0) return (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}><div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:6}}>Your sphere</div><div style={{fontSize:12,color:'var(--text-3)'}}>No contacts yet.</div></div>);
  return (<div className="dash-panel prism-pop" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="contacts" size={15} style={{color:'var(--accent)'}}/> Your sphere</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('contacts')}>{tot} contacts →</button>
    </div>
    <div style={{display:'flex',gap:18,alignItems:'center',flexWrap:'wrap'}}>
      <svg width="150" height="150" viewBox="0 0 150 150" style={{flexShrink:0,margin:'0 auto'}}>
        {seg.map((s,i)=>{ const len=s.n/tot*C; const el=(<circle key={i} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="20" strokeDasharray={(anim?Math.max(0,len-1.5):0)+' '+C} strokeDashoffset={-off} transform="rotate(-90 75 75)" style={{transition:'stroke-dasharray .9s cubic-bezier(.22,1,.36,1)'}}/>); off+=len; return el; })}
        <text x="75" y="71" textAnchor="middle" fill="var(--text-1)" fontSize="26" fontWeight="800">{tot}</text>
        <text x="75" y="90" textAnchor="middle" fill="var(--text-3)" fontSize="9.5" letterSpacing=".08em">CONTACTS</text>
      </svg>
      <div style={{flex:1,minWidth:150}}>
        {seg.map((s,i)=>(<div key={i} onClick={()=>setView('contacts')} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
          <span style={{width:9,height:9,borderRadius:3,background:s.color,flexShrink:0}}/>
          <span style={{flex:1,fontSize:12,color:'var(--text-2)'}}>{s.label}</span>
          <span style={{fontSize:12,fontWeight:700,color:'var(--text-1)'}}>{s.n}</span>
        </div>))}
      </div>
    </div>
  </div>);
}

export function PipelineFunnel({ deals=[], setView }){
  const STAGES=[['lead','Lead','#f59e0b'],['active','Active','#3b82f6'],['under_contract','Under contract','#8b5cf6'],['closing','Closing','#06b6d4'],['closed','Closed','#22c55e']];
  const gciOf=(d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const yr=new Date().getFullYear();
  const rows=STAGES.map(([id,label,color])=>{ const ds=deals.filter(d=> id==='closed' ? (d.status==='closed'&&d.close_date&&new Date(d.close_date).getFullYear()===yr) : d.status===id ); return {id,label,color,n:ds.length,gci:ds.reduce((a,d)=>a+gciOf(d),0)}; });
  const total=rows.reduce((a,r)=>a+r.n,0);
  const mx=Math.max(1,...rows.map(r=>r.n));
  return (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:total>0?14:6}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="signal" size={15} style={{color:'var(--accent)'}}/> Pipeline funnel</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('deals')}>Deals →</button>
    </div>
    {total===0 ? (
      <div style={{fontSize:12.5,color:'var(--text-3)',lineHeight:1.55}}>Your pipeline is clear. As you add deals they flow through these stages — with live commission value at each step.
        <div style={{display:'flex',gap:6,marginTop:12,flexWrap:'wrap'}}>{STAGES.map(([id,label])=>(<span key={id} style={{fontSize:10.5,fontWeight:600,color:'var(--text-3)',border:'1px dashed var(--border)',borderRadius:999,padding:'4px 10px'}}>{label}</span>))}</div>
      </div>
    ) : (
      <div>{rows.map((r)=>(
        <div key={r.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:9}}>
          <span style={{width:96,fontSize:12,color:'var(--text-2)',flexShrink:0}}>{r.label}</span>
          <div style={{flex:1}}><div style={{width:Math.max(r.n>0?8:0,Math.round(r.n/mx*100))+'%',minWidth:r.n>0?28:0,height:24,borderRadius:7,background:r.color,opacity:0.9,display:'flex',alignItems:'center',justifyContent:'center',transition:'width .7s ease'}}>{r.n>0 && <span style={{fontSize:12,fontWeight:800,color:'#0c0c0f'}}>{r.n}</span>}</div></div>
          <span style={{width:70,textAlign:'right',fontSize:11,color:'var(--text-3)',flexShrink:0}}>{r.gci>0?('$'+Math.round(r.gci).toLocaleString()):'—'}</span>
        </div>))}
      </div>
    )}
  </div>);
}

export function GciGauge({ deals=[], gciGoal=0, setView, userId }){
  const [goalOverride,setGoalOverride]=useState(null);
  const [editGoal,setEditGoal]=useState(false);
  const [goalInput,setGoalInput]=useState('');
  const [savingGoal,setSavingGoal]=useState(false);
  const [anim,setAnim]=useState(false);
  useEffect(()=>{ const tm=setTimeout(()=>setAnim(true),80); return ()=>clearTimeout(tm); },[]);
  const goal = goalOverride!=null ? goalOverride : (Number(gciGoal)||0);
  const saveGoal=async()=>{ const val=Math.round(Number(String(goalInput).replace(/[^0-9.]/g,''))||0); if(!val){ setEditGoal(false); return; } setSavingGoal(true); try{ await supabase.from('finance_settings').upsert({ user_id:userId, annual_gci_goal:val }, { onConflict:'user_id' }); setGoalOverride(val); setEditGoal(false); if(window.__notify) window.__notify('GCI goal set to $'+val.toLocaleString(),'success'); }catch(e){ if(window.__notify) window.__notify('Could not save goal.','error'); } setSavingGoal(false); };
  const ACTIVE=['lead','active','under_contract','closing'];
  const PROB={closing:0.90,under_contract:0.75,active:0.35,lead:0.15};
  const m0=(n)=>'$'+Math.round(n||0).toLocaleString();
  const gciOf=(d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const yr=new Date().getFullYear();
  const active=deals.filter(d=>ACTIVE.includes(d.status));
  const pipelineGci=active.reduce((a,d)=>a+gciOf(d),0);
  const weighted=active.reduce((a,d)=>a+gciOf(d)*(PROB[d.status]??0.3),0);
  const closed=deals.filter(d=>d.status==='closed' && d.close_date && new Date(d.close_date).getFullYear()===yr);
  const gciYtd=closed.reduce((a,d)=>a+gciOf(d),0);
  const dayOfYear=Math.max(1,Math.floor((Date.now()-new Date(yr,0,0))/86400000));
  const expectedPct=Math.min(1,dayOfYear/365);
  const expected=goal>0?goal*expectedPct:0;
  const pctG=goal>0?Math.min(1,gciYtd/goal):0;
  const onTrack=goal>0 && gciYtd>=expected;
  const R=92, SW=14, C=2*Math.PI*R;
  const off=anim?C*(1-pctG):C;
  const paceRad=(135+expectedPct*270)*Math.PI/180;
  const paceX=110+90*Math.cos(paceRad), paceY=110+90*Math.sin(paceRad);
  const goalLbl=goal>=1000?('$'+Math.round(goal/1000)+'k'):('$'+Math.round(goal));
  return (<div className="dash-panel prism-pop" style={{background:'linear-gradient(150deg, rgba(197,169,94,0.10), rgba(197,169,94,0.02))',border:'1px solid var(--accent)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="dollar" size={15} style={{color:'var(--accent)'}}/> GCI to goal</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('deals')}>Deals →</button>
    </div>
    <div style={{display:'flex',justifyContent:'center',margin:'2px 0'}}>
      <svg width="230" height="200" viewBox="0 0 220 196">
        <defs>
          <linearGradient id="gciG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-2)"/><stop offset="1" stopColor="#9A8038"/></linearGradient>
          <filter id="gciGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path d="M 46.36 173.64 A 90 90 0 1 1 173.64 173.64" fill="none" stroke="var(--border)" strokeWidth="14" strokeLinecap="round"/>
        {pctG>0 && <path d="M 46.36 173.64 A 90 90 0 1 1 173.64 173.64" fill="none" stroke="url(#gciG)" strokeWidth="14" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={anim?(100-pctG*100):100} filter="url(#gciGlow)" style={{transition:'stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)'}}/>}
        {goal>0 && <circle cx={paceX} cy={paceY} r="4.5" fill="var(--text-1)" stroke="var(--bg-card)" strokeWidth="2"/>}
        <text x="110" y="104" textAnchor="middle" fill="var(--text-1)" fontSize="30" fontWeight="800">{m0(gciYtd)}</text>
        <text x="110" y="126" textAnchor="middle" fill="var(--text-3)" fontSize="12">{goal>0?('of '+m0(goal)):'no goal set'}</text>
        {goal>0 && <text x="110" y="146" textAnchor="middle" fill="var(--accent)" fontSize="12" fontWeight="700">{Math.round(pctG*100)}% to goal</text>}
        {goal>0 && <text x="42" y="192" textAnchor="middle" fill="var(--text-3)" fontSize="10">$0</text>}
        {goal>0 && <text x="178" y="192" textAnchor="middle" fill="var(--text-3)" fontSize="10">{goalLbl}</text>}
      </svg>
    </div>
    {goal>0 ? (
      <div style={{textAlign:'center',marginBottom:14}}><span style={{fontSize:11.5,fontWeight:700,color:onTrack?'var(--green)':'#f5b34a',background:onTrack?'rgba(34,197,94,0.12)':'rgba(245,179,74,0.12)',border:'1px solid '+(onTrack?'rgba(34,197,94,0.35)':'rgba(245,179,74,0.35)'),borderRadius:999,padding:'4px 12px'}}>{onTrack?('On pace ✓ · '+m0(gciYtd-expected)+' ahead'):('Behind pace by '+m0(expected-gciYtd))}</span></div>
    ) : (
      <div style={{marginBottom:14}}>{editGoal ? (
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',justifyContent:'center'}}>
          <input type="number" inputMode="numeric" value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="e.g. 150000" style={{flex:'1 1 140px',minWidth:120,background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-1)',padding:'8px 10px',fontSize:13}}/>
          <button className="btn btn-primary btn-sm" disabled={savingGoal} onClick={saveGoal}>{savingGoal?'Saving…':'Save goal'}</button>
        </div>
      ) : (
        <div style={{textAlign:'center'}}><button className="btn btn-primary btn-sm" onClick={()=>{setGoalInput('');setEditGoal(true);}}>Set your annual GCI goal</button></div>
      )}</div>
    )}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,paddingTop:14,borderTop:'1px solid var(--border)'}}>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{m0(pipelineGci)}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Pipeline</div>{weighted>0 && <div style={{fontSize:9.5,color:'var(--text-3)',marginTop:1}}>~{m0(weighted)} wtd</div>}</div>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{active.length}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Active</div></div>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{closed.length}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Closed {yr}</div></div>
    </div>
  </div>);
}

export function MetricTiles({ needsNow, oweReplyN, reachN, pending=[], overdue=[], unreadEmailCount=0, apptWeek, contacts=[], weekTotal, topTasks=[], setView }){
  return (
      <div className="cards-row">
        <div className="dash-tile" onClick={()=>{ setView(needsNow>0?'contacts':'tasks'); }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Needs you now</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--accent-glow)', border:'1px solid var(--accent)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="target" size={15} style={{ color:'var(--accent)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: needsNow>0?'var(--accent)':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={needsNow} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{oweReplyN} replies · {reachN} reach-outs</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Open tasks</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="flame" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={pending.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{topTasks.length} top priority</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('inbox')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Unread email</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="inbox" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={unreadEmailCount} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>in your inbox</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Overdue</span>
            <span style={{ width:30, height:30, borderRadius:9, background: overdue.length>0?'rgba(239,68,68,0.12)':'var(--bg-base)', border:`1px solid ${overdue.length>0?'rgba(239,68,68,0.4)':'var(--border)'}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="clock" size={15} style={{ color: overdue.length>0?'#f06b6b':'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: overdue.length>0?'#f06b6b':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={overdue.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{overdue.length>0?'needs rescue':'all caught up'}</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('contacts')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Reach-outs due</span>
            <span style={{ width:30, height:30, borderRadius:9, background: reachN>0?'var(--accent-glow)':'var(--bg-base)', border:`1px solid ${reachN>0?'var(--accent)':'var(--border)'}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="contacts" size={15} style={{ color: reachN>0?'var(--accent)':'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: reachN>0?'var(--accent)':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={reachN} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>sphere touches</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('calendar')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Appointments</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="calendar" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={apptWeek} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>next 7 days</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('contacts')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Contacts</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="contacts" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={contacts.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>in your sphere</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Done this week</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.35)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="flame" size={15} style={{ color:'#4ade80' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={weekTotal} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>tasks completed</div>
        </div>
      </div>
  );
}

export function DashboardPipelinePanel({ contacts = [], setView, showSphere = true }){
  const [systems,setSystems]=useState(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('lead_gen_systems').select('id,name,color,monthly_budget,is_archived,is_overhead'); setSystems((data||[]).filter(s=>!s.is_archived)); })(); },[]);
  const TYPE_META = [['our_agent','Agents','var(--accent)'],['recruit','Recruits','#8b5cf6'],['lead','Leads','#f59e0b'],['client','Clients','#22c55e'],['vendor','Vendors','#3b82f6'],['partner','Partners','#06b6d4'],['family','Family','#ec4899'],['personal','Personal','#94a3b8'],['agent','Agents (other)','#eab308']];
  const all = contacts||[];
  const _byId={}; all.forEach(c=>{ if(!c.lead_gen_system_id) return; const k=c.lead_gen_system_id; _byId[k]=_byId[k]||{leads:0,closed:0}; _byId[k].leads++; if(c.pipeline_stage==='closed') _byId[k].closed++; });
  const srcKpi = (systems||[]).filter(s=>!s.is_overhead).map(s=>{ const d=_byId[s.id]||{leads:0,closed:0}; const conv=d.leads?Math.round(d.closed/d.leads*100):0; const budget=Number(s.monthly_budget)||0; const cpl=d.leads?budget/d.leads:null; return {id:s.id,name:s.name,color:s.color,leads:d.leads,closed:d.closed,conv,budget,cpl}; }).filter(x=>x.leads>0||x.budget>0).sort((a,b)=>(b.leads-a.leads)||(b.budget-a.budget));
  const anyLeads = srcKpi.some(x=>x.leads>0);
  const srcMax = Math.max(1, ...srcKpi.map(x=>x.leads));
  const counts={}; all.forEach(c=>{ const ty=c.type||'other'; counts[ty]=(counts[ty]||0)+1; });
  const sphere = TYPE_META.map(([id,label,color])=>({id,label,color,n:counts[id]||0})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  const sphereMax = Math.max(1, ...sphere.map(x=>x.n));
  if(systems===null) return null;
  return (<>
    <div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:16,padding:18,marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4,gap:8}}>
        <div style={{fontSize:14,fontWeight:700,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:8}}><Icon name="signal" size={16} style={{color:'var(--accent)'}}/> Lead Source Effectiveness</div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setView('pipeline')}>My pipeline →</button>
      </div>
      <div style={{fontSize:11,color:'var(--text-3)',marginBottom:14}}>{anyLeads?'Leads produced and what closed, by system':'Your active systems and monthly spend — tag contacts with a source to see what converts'}</div>
      {srcKpi.length===0 ? <div style={{fontSize:12,color:'var(--text-3)'}}>No lead-gen systems set up yet.</div> :
        srcKpi.map(k=>(<div key={k.id} style={{marginBottom:13}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5,gap:8}}>
            <span style={{fontSize:13,fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.name}</span>
            <span style={{fontSize:11,color:'var(--text-2)',flexShrink:0}}>{k.leads} lead{k.leads===1?'':'s'} · {k.conv}% closed</span>
          </div>
          <div style={{height:11,borderRadius:6,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(anyLeads?Math.round(k.leads/srcMax*100):100)+'%',background:k.color||'var(--accent)',borderRadius:6,opacity:anyLeads?1:0.3,transition:'width .6s ease'}}/></div>
          <div style={{marginTop:4,fontSize:10.5,color:'var(--text-3)'}}>{k.budget>0?('$'+k.budget.toLocaleString()+'/mo'+(k.cpl!=null?' · $'+Math.round(k.cpl).toLocaleString()+'/lead':'')):'No spend tracked'}{k.closed>0?' · '+k.closed+' closed':''}</div>
        </div>))
      }
    </div>
    {showSphere && (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:16,padding:18,marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:8}}>
        <div style={{fontSize:14,fontWeight:700,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:8}}><Icon name="contacts" size={16} style={{color:'var(--accent)'}}/> Your sphere</div>
        <span style={{fontSize:12,color:'var(--text-2)'}}>{all.length} contacts</span>
      </div>
      {sphere.length===0 ? <div style={{fontSize:12,color:'var(--text-3)'}}>No contacts yet.</div> :
        sphere.map(s=>(<div key={s.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:9}}>
          <span style={{width:96,fontSize:12,color:'var(--text-2)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.label}</span>
          <div style={{flex:1,height:16,borderRadius:5,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:Math.round(s.n/sphereMax*100)+'%',background:s.color,borderRadius:5,minWidth:s.n>0?4:0,transition:'width .6s ease'}}/></div>
          <span style={{width:34,textAlign:'right',fontSize:13,fontWeight:700,color:'var(--text-1)'}}>{s.n}</span>
        </div>))
      }
    </div>)}
  </>);
}

export function DashboardROI({ userId, setView }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
      const [sysR, txR, teR, setR] = await Promise.all([
        supabase.from('lead_gen_systems').select('*').eq('user_id', userId).eq('is_active', true).eq('is_archived', false),
        supabase.from('transactions').select('amount,date,scope,lead_gen_system_id').eq('user_id', userId).eq('is_archived', false).eq('scope', 'business').gte('date', yearStart).not('lead_gen_system_id', 'is', null).limit(2000),
        supabase.from('time_entries').select('minutes,lead_gen_system_id,occurred_at').eq('user_id', userId).not('lead_gen_system_id', 'is', null).limit(5000),
        supabase.from('finance_settings').select('hourly_rate').eq('user_id', userId).maybeSingle(),
      ]);
      if (!alive) return;
      const systems = (sysR.data || []).filter(sy => !sy.is_overhead);
      const txns = txR.data || [];
      const tes = teR.data || [];
      const hourly = Number(setR.data?.hourly_rate || 0);
      const now = new Date();
      const grade = (roi) => {
        if (roi === null) return { g: '—', c: 'var(--text-3)' };
        if (roi >= 5) return { g: 'A+', c: 'var(--green)' };
        if (roi >= 3) return { g: 'A', c: 'var(--green)' };
        if (roi >= 2) return { g: 'B', c: '#84cc16' };
        if (roi >= 1) return { g: 'C', c: 'var(--yellow)' };
        if (roi >= 0.5) return { g: 'D', c: '#f59e0b' };
        return { g: 'F', c: 'var(--red)' };
      };
      const rows = systems.map(sys => {
        const sysTx = txns.filter(t => t.lead_gen_system_id === sys.id);
        const cash = Math.abs(sysTx.filter(t => Number(t.amount) < 0).reduce((a, t) => a + Number(t.amount), 0));
        const income = sysTx.filter(t => Number(t.amount) > 0).reduce((a, t) => a + Number(t.amount), 0);
        const sysTe = tes.filter(te => te.lead_gen_system_id === sys.id);
        const minutes = sysTe.reduce((a, te) => a + Number(te.minutes || 0), 0);
        const invested = cash + (minutes / 60) * hourly;
        const roi = invested > 0 ? income / invested : null;
        const series = [];
        for (let wk = 7; wk >= 0; wk--) {
          const cutoff = new Date(now); cutoff.setDate(now.getDate() - wk * 7); cutoff.setHours(23, 59, 59, 999);
          const c = Math.abs(sysTx.filter(t => Number(t.amount) < 0 && new Date(t.date) <= cutoff).reduce((a, t) => a + Number(t.amount), 0));
          const inc = sysTx.filter(t => Number(t.amount) > 0 && new Date(t.date) <= cutoff).reduce((a, t) => a + Number(t.amount), 0);
          const mins = sysTe.filter(te => te.occurred_at && new Date(te.occurred_at) <= cutoff).reduce((a, te) => a + Number(te.minutes || 0), 0);
          const invv = c + (mins / 60) * hourly;
          series.push(invv > 0 ? inc / invv : 0);
        }
        return { sys, cash, income, minutes, invested, roi, net: income - invested, series };
      }).sort((a, b) => {
        if (a.roi === null && b.roi === null) return b.invested - a.invested;
        if (a.roi === null) return 1; if (b.roi === null) return -1;
        return b.roi - a.roi;
      });
      const totalInvested = rows.reduce((a, r) => a + r.invested, 0);
      const totalIncome = rows.reduce((a, r) => a + r.income, 0);
      const blended = totalInvested > 0 ? totalIncome / totalInvested : null;
      setData({ rows, blended, gr: grade(blended), grade });
    })();
    return () => { alive = false; };
  }, [userId]);

  if (!data || data.rows.length === 0) return null;
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const statusFor = (r) => {
    if (r.invested === 0) return { label: 'No data yet', color: 'var(--text-3)', icon: '•' };
    if (r.roi === null || r.income === 0) return { label: 'Awaiting income', color: 'var(--text-3)', icon: '⏳' };
    if (r.roi >= 3) return { label: 'Strong', color: 'var(--green)', icon: '🔥' };
    if (r.roi >= 1) return { label: 'Profitable', color: 'var(--accent)', icon: '✓' };
    return { label: 'Underwater', color: 'var(--red)', icon: '⚠' };
  };
  const W = 104, H = 32, PAD = 3;
  const sparkPts = (series) => {
    const max = Math.max(...series, 0), n = series.length;
    return series.map((v, idx) => {
      const x = PAD + (n > 1 ? idx * (W - 2 * PAD) / (n - 1) : 0);
      const y = H - PAD - (max > 0 ? (v / max) : 0) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-1)', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          <Icon name="target" size={16} style={{ color: 'var(--accent)' }} /> Lead-Gen ROI
          <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-3)' }}>· this year</span>
        </h3>
        {data.blended !== null && (
          <button onClick={() => setView('prospecting')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: '999px', color: 'var(--accent)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            Blended {data.blended.toFixed(1)}× · {data.gr.g} →
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {data.rows.map((r, idx) => {
          const g = data.grade(r.roi);
          const st = statusFor(r);
          const medal = (r.roi !== null && idx < 3) ? medals[idx] : null;
          const barPct = r.roi === null ? 0 : Math.min(100, (r.roi / 5) * 100);
          const pts = sparkPts(r.series).split(' ');
          const last = pts[pts.length - 1].split(',');
          return (
            <div key={r.sys.id} onClick={() => setView('prospecting')}
              style={{ background: 'linear-gradient(135deg, var(--accent-glow), var(--bg-card) 55%)', border: '1px solid var(--accent)', borderRadius: '14px', padding: '16px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '14px', transition: 'box-shadow .12s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(197,169,94,0.20)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}>
              {/* Header: rank + name (left), grade (right) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                  {medal
                    ? <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0 }}>{medal}</span>
                    : <span style={{ flexShrink: 0, width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '10.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.roi !== null ? `#${idx + 1}` : '—'}</span>}
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: r.sys.color || 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.25 }}>{r.sys.name}</span>
                </div>
                <span style={{ fontSize: '15px', fontWeight: 800, color: g.c, background: 'var(--bg-base)', border: `1px solid ${g.c}`, borderRadius: '8px', padding: '3px 10px', flexShrink: 0 }}>{g.g}</span>
              </div>
              {/* Metrics: ROI + status (left), bar (mid), sparkline (right) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
                <div style={{ flexShrink: 0 }}>
                  <div style={{ fontSize: '34px', fontWeight: 800, lineHeight: 1, color: r.roi === null ? 'var(--text-3)' : 'var(--accent)' }}>{r.roi === null ? '—' : r.roi.toFixed(1) + '×'}</div>
                  <div style={{ marginTop: '5px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: st.color }}>{st.icon} {st.label}</div>
                </div>
                <div style={{ flex: '1 1 150px', minWidth: '140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '5px' }}><span>Return on investment</span><span>elite · 5×</span></div>
                  <div style={{ height: '9px', borderRadius: '999px', background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${barPct}%`, height: '100%', background: g.c, borderRadius: '999px', transition: 'width .3s' }} />
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'center' }}>
                  <svg width={W} height={H} style={{ display: 'block' }}>
                    <polyline points={sparkPts(r.series)} fill="none" stroke={g.c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={Number(last[0])} cy={Number(last[1])} r="2.6" fill={g.c} />
                  </svg>
                  <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>8-wk trend</div>
                </div>
              </div>
              {/* Stat strip */}
              <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '11px' }}>
                {[
                  { l: 'Net', v: `${r.net >= 0 ? '+' : ''}${money(r.net)}`, c: r.roi === null ? 'var(--text-3)' : (r.net >= 0 ? 'var(--green)' : 'var(--red)') },
                  { l: 'Income', v: money(r.income), c: 'var(--text-1)' },
                  { l: 'Invested', v: money(r.invested), c: 'var(--text-1)' },
                  { l: 'Time logged', v: fmtH(r.minutes), c: 'var(--text-1)' },
                ].map(stat => (
                  <div key={stat.l}>
                    <div style={{ fontSize: '9px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{stat.l}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: stat.c, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{stat.v}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Animated count-up for the dashboard's big numbers (eases from the last value
// to the new one, so first paint counts up from 0).

export function MyNumbersView({ tasks=[], contacts=[], events=[], deals=[], unreadEmailCount=0, setView, userId, oweReplyMap={} }){
  const [gciGoal,setGciGoal]=useState(0);
  useEffect(()=>{ (async()=>{ try{ const { data } = await supabase.from('finance_settings').select('annual_gci_goal').eq('user_id',userId).maybeSingle(); setGciGoal(Number(data?.annual_gci_goal)||0); }catch(_e){} })(); },[userId]);
  const now=Date.now(); const todayISO=new Date(now).toISOString().slice(0,10);
  const pending=tasks.filter(t=>!t.completed);
  const overdue=pending.filter(t=>t.due_date && t.due_date<todayISO);
  const topTasks=pending.filter(t=>t.priority==='high');
  const lastTouch=(c)=>{ const a=[c.last_contact_at,c.last_inbound_at,c.last_outbound_at].filter(Boolean).map(x=>new Date(x).getTime()); return a.length?Math.max(...a):null; };
  const oweReplyN=contacts.filter(c=>{ if(c.reachout_snooze_until&&new Date(c.reachout_snooze_until)>new Date(now))return false; const owedAt=oweReplyMap && oweReplyMap[c.id]; if(!owedAt) return false; if(c.comms_settled_at && new Date(c.comms_settled_at)>=new Date(owedAt)) return false; return true; }).length;
  const reachN=contacts.filter(c=>{ const cad=c.cadence_days; if(!cad)return false; if(c.reachout_snooze_until&&new Date(c.reachout_snooze_until)>new Date(now))return false; const ts=lastTouch(c); const ds=ts===null?null:Math.floor((now-ts)/86400000); return ds===null?true:ds>=cad; }).length;
  const dueOrOverdue=pending.filter(t=>t.due_date&&t.due_date<=todayISO).length;
  const needsNow=oweReplyN+reachN+dueOrOverdue;
  const apptWeek=(events||[]).filter(e=>e.start_at&&new Date(e.start_at).getTime()>=now&&(new Date(e.start_at).getTime()-now)<=7*86400000).length;
  const weekTotal=tasks.filter(t=>t.completed&&t.completed_at&&(now-new Date(t.completed_at).getTime())<=7*86400000).length;
  return (<div className="view ww-prism">
    <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .form-input,.ww-prism .form-select{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
    <MyProduction year={2026} />
    <div style={{ marginBottom:14 }}>
      <h2 style={{ margin:0, fontFamily:'Fraunces, serif', fontSize:34, fontWeight:300, letterSpacing:'-0.02em', color:'#F6F1E7', lineHeight:1.05 }}>My numbers.</h2>
      <div style={{ fontSize:13, color:'#C8BFAE', marginTop:4 }}>Your production, pipeline, and activity</div>
    </div>
    <div style={{ marginTop:14 }}>
      <GciGauge deals={deals} gciGoal={gciGoal} setView={setView} userId={userId} />
      <SphereDonut contacts={contacts} setView={setView} />
      <PipelineFunnel deals={deals} setView={setView} />
      <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)', margin:'2px 2px 10px' }}>Activity</div>
      <MetricTiles needsNow={needsNow} oweReplyN={oweReplyN} reachN={reachN} pending={pending} overdue={overdue} unreadEmailCount={unreadEmailCount} apptWeek={apptWeek} contacts={contacts} weekTotal={weekTotal} topTasks={topTasks} setView={setView} />
      <DashboardPipelinePanel contacts={contacts} setView={setView} showSphere={false} />
      {userId && <DashboardROI userId={userId} setView={setView} />}
    </div>
  </div>);
}

// Read-only announcements history for the Dashboard — lets anyone revisit past
// announcements (not just see them once at acknowledgement). RLS scopes rows to
// brokerage-wide + the viewer's own team; unacked ones are badged "new".
