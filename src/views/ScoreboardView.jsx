// Scoreboard + Pipeline — two small standalone screens.
// Extracted from App.js (strangle the monolith, step 28).
import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

export function ScoreboardView({ userId, appCtx, setView }){
  const ownerId = (appCtx && appCtx.owner_id) || userId;
  const [rows,setRows]=useState(null);
  const [metric,setMetric]=useState('contacts');
  useEffect(()=>{ let alive=true; (async()=>{ try{ const { data } = await supabase.rpc('brokerage_scoreboard',{ p_owner: ownerId }); if(alive) setRows(data||[]); }catch(e){ if(alive) setRows([]); } })(); return ()=>{alive=false;}; },[ownerId]);
  const m0=(v)=>'$'+Math.round(v||0).toLocaleString();
  const METRICS=[
    {id:'contacts',label:'Sphere',get:r=>Number(r.contacts)||0,fmt:v=>String(v),note:'Contacts in your CRM'},
    {id:'activity',label:'Activity',get:r=>Number(r.tasks_done_30d)||0,fmt:v=>String(v),note:'Tasks completed in 30 days'},
    {id:'pipeline',label:'Pipeline',get:r=>Number(r.pipeline_gci)||0,fmt:m0,note:'Commission in active deals'},
    {id:'deals',label:'Closed',get:r=>Number(r.deals_closed)||0,fmt:v=>String(v),note:'Deals closed this year'},
    {id:'gci',label:'GCI',get:r=>Number(r.gci_ytd)||0,fmt:m0,note:'Gross commission, year to date'},
  ];
  if(rows===null) return (<div className="view"><div className="panel" style={{padding:24,textAlign:'center',color:'var(--text-2)'}}>Loading the board…</div></div>);
  const M=METRICS.find(x=>x.id===metric)||METRICS[0];
  const sorted=[...rows].sort((a,b)=>M.get(b)-M.get(a));
  const n=sorted.length;
  const meIdx=sorted.findIndex(r=>r.is_me);
  const me=meIdx>=0?sorted[meIdx]:null;
  const myRank=meIdx>=0?meIdx+1:null;
  const avg=n?sorted.reduce((a,r)=>a+M.get(r),0)/n:0;
  const maxV=Math.max(1,...sorted.map(x=>M.get(x)));
  const anyData=sorted.some(r=>M.get(r)>0);
  const medal=(i)=> i===0?'#FFD24A':i===1?'#C4CBD4':i===2?'#CE8E54':'var(--text-3)';
  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:8}}><Icon name="target" size={20}/> How I'm doing</h2>
          <div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>Where you stand across the brokerage</div>
        </div>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:12}}>
        {METRICS.map(x=>(<button key={x.id} onClick={()=>setMetric(x.id)} style={{background:metric===x.id?'var(--accent)':'transparent',color:metric===x.id?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:700,borderRadius:999,padding:'6px 13px',fontSize:12.5,cursor:'pointer'}}>{x.label}</button>))}
      </div>
      {me ? (
        <div className="dash-panel" style={{marginTop:12,padding:18,background:'linear-gradient(135deg, rgba(197,169,94,0.10), rgba(197,169,94,0.02))',border:'1px solid var(--accent)',borderRadius:16}}>
          <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}>
            <div style={{textAlign:'center',minWidth:84}}>
              <div style={{fontSize:40,fontWeight:800,color:'var(--accent)',lineHeight:1}}>#{myRank}</div>
              <div style={{fontSize:11,color:'var(--text-3)',marginTop:3,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>of {n}</div>
            </div>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:26,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{M.fmt(M.get(me))}</div>
              <div style={{fontSize:12.5,color:'var(--text-2)',marginTop:3}}>{M.label} · {M.note}</div>
              <div style={{fontSize:12,marginTop:8,fontWeight:700,color: M.get(me)>=avg?'var(--green)':'#f5b34a'}}>{M.get(me)>=avg?'Above':'Below'} brokerage average ({M.fmt(avg)})</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel" style={{marginTop:12,padding:16,color:'var(--text-2)',fontSize:13}}>Your agent profile isn't linked to this login yet, so your own row isn't highlighted. An admin can link it under Brokerage → Agent roster.</div>
      )}
      <div className="dash-panel" style={{marginTop:12,padding:16,borderRadius:16,background:'var(--bg-card)',border:'1px solid var(--border)'}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:14,display:'inline-flex',alignItems:'center',gap:8}}><Icon name="chart" size={15} style={{color:'var(--accent)'}}/> Leaderboard · {M.label}</div>
        {!anyData ? <div style={{fontSize:12.5,color:'var(--text-3)'}}>No {M.label.toLowerCase()} logged yet — the board fills in as the brokerage works. Keep going.</div> :
          sorted.map((r,i)=>{ const v=M.get(r); return (
            <div key={r.agent_id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:11,padding:r.is_me?'7px 9px':'0 0',background:r.is_me?'var(--accent-glow)':'transparent',border:r.is_me?'1px solid var(--accent)':'none',borderRadius:10}}>
              <span style={{width:24,textAlign:'center',fontSize:14,fontWeight:800,color:medal(i),flexShrink:0}}>{i+1}</span>
              <span style={{width:104,fontSize:12.5,fontWeight:r.is_me?800:600,color:'var(--text-1)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.is_me?'You':(r.name||'—')}</span>
              <div style={{flex:1,height:14,borderRadius:5,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:Math.round(v/maxV*100)+'%',background:r.is_me?'var(--accent)':'var(--accent-dim)',borderRadius:5,minWidth:v>0?4:0,transition:'width .6s ease'}}/></div>
              <span style={{width:78,textAlign:'right',fontSize:12.5,fontWeight:700,color:'var(--text-1)',flexShrink:0}}>{M.fmt(v)}</span>
            </div>); })
        }
      </div>
    </div>
  );
}

export function PipelineView({ contacts, userId }){
  const [systems,setSystems]=useState(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('lead_gen_systems').select('id,name,color,monthly_budget,is_archived'); setSystems((data||[]).filter(s=>!s.is_archived)); })(); },[]);
  const PSTAGES = [['new','New'],['attempting','Attempting'],['contacted','Contacted'],['appointment_set','Appt set'],['nurture','Nurture'],['closed','Closed']];
  const STAGE_COLORS = { new:'#3b82f6', attempting:'#8b5cf6', contacted:'#f59e0b', appointment_set:'#06b6d4', nurture:'#22c55e', closed:'var(--accent)' };
  const all = contacts||[];
  const pipe = all.filter(c=>c.pipeline_stage && c.pipeline_stage!=='lost');
  const closed = pipe.filter(c=>c.pipeline_stage==='closed');
  const active = pipe.filter(c=>c.pipeline_stage!=='closed');
  const winRate = pipe.length? Math.round(closed.length/pipe.length*100):0;
  const funnel = PSTAGES.map(([id,label])=>({ id,label, n: pipe.filter(c=>c.pipeline_stage===id).length }));
  const funnelMax = Math.max(1, ...funnel.map(f=>f.n));
  const _byId={}; all.forEach(c=>{ if(!c.lead_gen_system_id) return; const k=c.lead_gen_system_id; _byId[k]=_byId[k]||{leads:0,closed:0}; _byId[k].leads++; if(c.pipeline_stage==='closed') _byId[k].closed++; });
  const srcKpi = (systems||[]).map(s=>{ const d=_byId[s.id]||{leads:0,closed:0}; const conv=d.leads?Math.round(d.closed/d.leads*100):0; const budget=Number(s.monthly_budget)||0; const cpl=d.leads?budget/d.leads:null; return {id:s.id,name:s.name,color:s.color,leads:d.leads,closed:d.closed,conv,budget,cpl}; }).filter(x=>x.leads>0).sort((a,b)=>b.leads-a.leads);
  const srcMax = Math.max(1, ...srcKpi.map(x=>x.leads));
  const stat=(label,val,sub)=> (<div className="panel" style={{padding:'14px',flex:1,minWidth:'120px'}}>
      <div style={{fontSize:'24px',fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{val}</div>
      <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px'}}>{label}</div>
      {sub?<div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>:null}
    </div>);
  if(systems===null) return <div className="view"><div className="panel" style={{padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Loading your pipeline…</div></div>;
  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'8px'}}><Icon name="target" size={20}/> My pipeline</h2>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>Your leads by stage and where they came from</div>
        </div>
      </div>
      {pipe.length===0 ? (
        <div className="panel" style={{marginTop:'12px',padding:'28px',textAlign:'center'}}>
          <div style={{fontSize:'15px',fontWeight:700,color:'var(--text-1)',marginBottom:'6px'}}>No leads in your pipeline yet</div>
          <div style={{fontSize:'13px',color:'var(--text-2)',maxWidth:'440px',margin:'0 auto',lineHeight:1.5}}>Open any contact, then on the Overview tab set a <b>pipeline stage</b> and tag a <b>lead source</b>. They will roll up here into your funnel and source ROI.</div>
        </div>
      ) : (<>
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'12px'}}>
          {stat('In pipeline', pipe.length)}
          {stat('Active', active.length, 'not yet closed')}
          {stat('Closed', closed.length)}
          {stat('Win rate', winRate+'%', closed.length+' of '+pipe.length)}
        </div>
        <div className="panel" style={{marginTop:'12px',padding:'18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'var(--text-1)',marginBottom:'16px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="chart" size={16}/> Pipeline funnel</div>
          {funnel.map(f=>(<div key={f.id} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
            <span style={{width:'82px',fontSize:'12px',color:'var(--text-2)',flexShrink:0}}>{f.label}</span>
            <div style={{flex:1,height:'22px',borderRadius:'6px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(f.n/funnelMax*100))+'%',background:STAGE_COLORS[f.id]||'var(--accent)',borderRadius:'6px',minWidth:f.n>0?'4px':'0',transition:'width .5s ease'}}/></div>
            <span style={{width:'30px',textAlign:'right',fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>{f.n}</span>
          </div>))}
        </div>
        <div className="panel" style={{marginTop:'12px',padding:'18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'var(--text-1)',marginBottom:'4px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="signal" size={16}/> Lead Source Effectiveness</div>
          <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'16px'}}>Which systems are actually producing</div>
          {srcKpi.length===0 ? <div style={{fontSize:'12px',color:'var(--text-3)'}}>No lead sources tagged yet. Add a Lead Source on a contact Overview to see ROI here.</div> :
            srcKpi.map(k=>(<div key={k.id} style={{marginBottom:'14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'5px',gap:'8px'}}>
                <span style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.name}</span>
                <span style={{fontSize:'11px',color:'var(--text-2)',flexShrink:0}}>{k.leads} lead{k.leads===1?'':'s'} · {k.conv}% closed</span>
              </div>
              <div style={{height:'12px',borderRadius:'6px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(k.leads/srcMax*100))+'%',background:k.color||'var(--accent)',borderRadius:'6px',transition:'width .5s ease'}}/></div>
              <div style={{marginTop:'4px',fontSize:'10.5px',color:'var(--text-3)'}}>{k.budget>0?('$'+k.budget.toLocaleString()+'/mo'+(k.cpl!=null?' · $'+Math.round(k.cpl).toLocaleString()+'/lead':'')):'No spend tracked'}{k.closed>0?' · '+k.closed+' closed':''}</div>
            </div>))
          }
        </div>
      </>)}
    </div>
  );
}
