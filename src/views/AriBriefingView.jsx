import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon, TaskModal, money } from '../App';

function ActionHubModal({ contactId, userId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(()=>{ (async()=>{
    try { const { data, error } = await supabase.functions.invoke('ari-call-prep', { body:{ contact_id:contactId } });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      setD(data);
    } catch(e){ setErr(e.message || String(e)); }
    setLoading(false);
  })(); }, [contactId]); // eslint-disable-line
  const c = d?.contact || {}; const prep = d?.prep || null;
  const telN = String(c.phone||'').replace(/[^0-9+]/g,'');
  const discColor=(x)=> x==='D'?'#ef4444':x==='I'?'var(--accent)':x==='S'?'var(--green)':x==='C'?'#3b82f6':'var(--text-3)';
  const copy=async(t,k)=>{ try{ await navigator.clipboard.writeText(t); setCopied(k); setTimeout(()=>setCopied(''),1200);}catch(e){} };
  const sectTitle={fontSize:'10px',letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',fontWeight:700,marginBottom:'3px'};
  const Section=({title,bodyTxt})=> bodyTxt? <div><div style={sectTitle}>{title}</div><div style={{fontSize:'13px',lineHeight:1.5,color:'var(--text-1)'}}>{bodyTxt}</div></div> : null;
  const Act=({href,disabled,icon,label})=> <a href={disabled?undefined:href} onClick={e=>{ if(disabled){e.preventDefault();} }} style={{flex:1,textAlign:'center',padding:'10px 6px',borderRadius:'10px',border:'1px solid var(--border)',background:disabled?'var(--bg-base)':'var(--bg-hover)',color:disabled?'var(--text-3)':'var(--text-1)',textDecoration:'none',fontSize:'12px',fontWeight:600,opacity:disabled?.5:1}}><div style={{fontSize:'18px',marginBottom:'2px'}}>{icon}</div>{label}</a>;
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:1000,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'16px 16px 0 0',width:'100%',maxWidth:'560px',maxHeight:'90vh',overflowY:'auto',padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',marginBottom:'10px'}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:800,fontSize:'17px'}}>{c.name||'Contact'}</div>
            <div style={{fontSize:'12px',color:'var(--text-3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[c.company,c.email].filter(Boolean).join(' · ')||c.phone||''}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{display:'flex',gap:'6px',marginBottom:'12px',flexWrap:'wrap'}}>
          {d?.disc && <span style={{fontSize:'10px',fontWeight:700,color:discColor(d.disc.letter),border:'1px solid '+discColor(d.disc.letter),borderRadius:'5px',padding:'2px 6px'}}>{d.disc.letter} · {String(d.disc.label).split('—')[0].trim()}</span>}
          {d?.score && <span style={{fontSize:'10px',fontWeight:700,color:'var(--accent)',border:'1px solid var(--accent-dim)',borderRadius:'5px',padding:'2px 6px'}}>Propensity {d.score.score} · {d.score.tier}</span>}
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'14px'}}>
          <Act href={'tel:'+telN} disabled={!telN} icon={<Icon name="quo" size={18} />} label="Call"/>
          <Act href={'sms:'+telN} disabled={!telN} icon={<Icon name="message" size={18} />} label="Text"/>
          <Act href={c.email?('mailto:'+c.email):'#'} disabled={!c.email} icon={<Icon name="mail" size={18} />} label="Email"/>
          <button onClick={()=>copy(c.phone||'','ph')} disabled={!c.phone} style={{flex:1,textAlign:'center',padding:'10px 6px',borderRadius:'10px',border:'1px solid var(--border)',background:c.phone?'var(--bg-hover)':'var(--bg-base)',color:c.phone?'var(--text-1)':'var(--text-3)',fontSize:'12px',fontWeight:600,cursor:c.phone?'pointer':'default',opacity:c.phone?1:.5}}><div style={{fontSize:'18px',marginBottom:'2px'}}>⧉</div>{copied==='ph'?'Copied':'Copy #'}</button>
        </div>
        {loading ? <div style={{textAlign:'center',padding:'24px 0',color:'var(--text-2)',fontSize:'13px'}}><div className="spinner" style={{margin:'0 auto 10px'}}/>Ari is prepping you…</div>
         : err ? <div style={{color:'var(--red)',fontSize:'12px'}}>{err}</div>
         : prep ? (
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            <Section title="Who" bodyTxt={prep.who}/>
            <Section title="How to approach" bodyTxt={prep.communicate}/>
            {prep.opener && <div style={{background:'var(--bg-hover)',border:'1px solid var(--accent-dim)',borderRadius:'10px',padding:'10px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}><span style={{fontSize:'10px',letterSpacing:'.06em',textTransform:'uppercase',color:'var(--accent)',fontWeight:700}}>Opener</span><button onClick={()=>copy(prep.opener,'op')} style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'10px',cursor:'pointer',textTransform:'uppercase'}}>{copied==='op'?'copied':'copy'}</button></div>
              <div style={{fontSize:'14px',lineHeight:1.5}}>{prep.opener}</div>
            </div>}
            {(prep.talking_points||[]).length>0 && <div><div style={sectTitle}>Talking points</div><ul style={{margin:'4px 0 0',paddingLeft:'18px'}}>{prep.talking_points.map((p,i)=><li key={i} style={{fontSize:'13px',lineHeight:1.5,marginBottom:'4px'}}>{p}</li>)}</ul></div>}
            <Section title="Aim for" bodyTxt={prep.next_step}/>
            {d?.deal && d.deal!=='No active deal on file.' && <Section title="Live file" bodyTxt={d.deal}/>}
          </div>
        ) : <div style={{fontSize:'12px',color:'var(--text-3)'}}>No prep available for this contact.</div>}
      </div>
    </div>
  );
}

function OutreachReport({ userId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [leads, setLeads] = useState([]);
  const [hubId, setHubId] = useState(null);
  useEffect(()=>{ (async()=>{
    try { await supabase.rpc('ari_attribute_outcomes',{ p_user:userId }); } catch(e){}
    try { await supabase.rpc('ari_score_propensity',{ p_user:userId }); } catch(e){}
    try {
      const since = new Date(Date.now()-90*864e5).toISOString();
      const { data } = await supabase.from('ari_outreach').select('contact_id,contact_name,disc,word_count,has_question,send_hour,replied,meeting_booked,deal_moved,sent_at').eq('user_id',userId).eq('status','sent').gte('sent_at',since).order('sent_at',{ascending:false});
      setRows(data||[]);
      const { data: ld } = await supabase.from('contact_scores').select('contact_id,score,tier,factors,contacts(name,company)').eq('user_id',userId).gte('score',25).order('score',{ascending:false}).limit(25);
      setLeads(ld||[]);
    } catch(e){}
    setLoading(false);
  })(); },[]); // eslint-disable-line

  const pct=(r,s)=> s?Math.round(r/s*100):0;
  const tot = { sent:rows.length, replied:rows.filter(r=>r.replied).length, meetings:rows.filter(r=>r.meeting_booked).length, deals:rows.filter(r=>r.deal_moved).length };
  const monday=(d)=>{ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; };
  const weeks=[]; const now=new Date();
  for(let i=7;i>=0;i--){ const ws=monday(new Date(now.getTime()-i*7*864e5)); weeks.push({ t:ws.getTime(), label:ws.toLocaleDateString(undefined,{month:'numeric',day:'numeric'}), sent:0, replied:0 }); }
  rows.forEach(r=>{ const t=monday(new Date(r.sent_at)).getTime(); const w=weeks.find(x=>x.t===t); if(w){ w.sent++; if(r.replied) w.replied++; } });
  const maxSent = Math.max(1,...weeks.map(w=>w.sent));
  const grp=(keyFn)=>{ const m={}; rows.forEach(r=>{ const k=keyFn(r); if(k==null) return; const o=m[k]||(m[k]={s:0,r:0}); o.s++; if(r.replied)o.r++; }); return m; };
  const DISC_LABEL={D:'Driver (D)',I:'Influencer (I)',S:'Steady (S)',C:'Conscientious (C)'};
  const discM=grp(r=>r.disc||null), lenM=grp(r=>(r.word_count||0)<60?'Short (under 60 words)':'Longer'), qM=grp(r=>r.has_question?'Asks a question':'Statement only'), hourM=grp(r=>(r.send_hour==null)?null:(r.send_hour<12?'Morning':r.send_hour<17?'Midday':'Evening'));
  const cm={}; rows.forEach(r=>{ const o=cm[r.contact_id]||(cm[r.contact_id]={name:r.contact_name,s:0,r:0,m:0,d:0}); o.s++; if(r.replied)o.r++; if(r.meeting_booked)o.m++; if(r.deal_moved)o.d++; });
  const perContact=Object.values(cm).sort((a,b)=> b.d-a.d || b.r-a.r || b.s-a.s).slice(0,20);
  const tierColor=(t)=> t==='hot'?'#ef4444':t==='warm'?'#f59e0b':t==='cool'?'#3b82f6':'var(--text-3)';
  const Bar=({label,r,s})=>(<div style={{marginBottom:'8px'}}><div style={{display:'flex',justifyContent:'space-between',fontSize:'12px',marginBottom:'3px'}}><span>{label}</span><span style={{color:'var(--text-3)'}}>{pct(r,s)}% · {s} sent</span></div><div style={{height:'8px',background:'var(--bg-hover)',borderRadius:'4px',overflow:'hidden'}}><div style={{height:'100%',width:pct(r,s)+'%',background:'var(--accent)'}}/></div></div>);
  const section=(title,m,minS)=>{ const ent=Object.entries(m).filter(([,v])=>v.s>=(minS||1)).sort((a,b)=>(b[1].r/b[1].s)-(a[1].r/a[1].s)); if(!ent.length) return null; return (<div style={{marginBottom:'14px'}}><div style={{fontSize:'12px',fontWeight:700,color:'var(--text-2)',marginBottom:'8px'}}>{title}</div>{ent.map(([k,v])=><Bar key={k} label={DISC_LABEL[k]||k} r={v.r} s={v.s}/>)}</div>); };

  if (loading) return <div className="view"><div className="loading-screen" style={{height:'40vh'}}><div className="spinner"/><div style={{marginTop:'12px',color:'var(--text-2)',fontSize:'13px'}}>Crunching your outreach results…</div></div></div>;

  return (
    <div className="view">
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <h2 style={{margin:0}}>Outreach → Results</h2>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>Last 90 days</h3></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
          {[['Sent',tot.sent],['Reply rate',pct(tot.replied,tot.sent)+'%'],['Meetings',tot.meetings],['Files moved',tot.deals]].map(([k,v])=>(
            <div key={k} style={{background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px',textAlign:'center'}}>
              <div style={{fontSize:'20px',fontWeight:800,color:'var(--accent)'}}>{v}</div>
              <div style={{fontSize:'10px',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--text-3)',marginTop:'2px'}}>{k}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>Trend · 8 weeks</h3></div>
        {tot.sent ? (
        <div style={{display:'flex',alignItems:'flex-end',gap:'6px',height:'120px',paddingTop:'8px'}}>
          {weeks.map((w,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'4px'}}>
              <div style={{flex:1,display:'flex',alignItems:'flex-end',width:'100%'}}>
                <div title={w.sent+' sent · '+pct(w.replied,w.sent)+'% reply'} style={{width:'100%',height:Math.round(w.sent/maxSent*100)+'%',minHeight:w.sent?'4px':'0',background:'var(--accent)',borderRadius:'4px 4px 0 0',position:'relative'}}>
                  <div style={{position:'absolute',bottom:0,left:0,right:0,height:pct(w.replied,w.sent)+'%',background:'var(--green)',borderRadius:'0 0 4px 4px',opacity:.85}}/>
                </div>
              </div>
              <div style={{fontSize:'9px',color:'var(--text-3)'}}>{w.label}</div>
            </div>
          ))}
        </div>) : <div style={{fontSize:'12px',color:'var(--text-3)'}}>No sends yet — send from your briefing and this fills in.</div>}
        <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px'}}>Bar = messages sent · green = share that earned a reply.</div>
      </div>
      {tot.sent>=4 && <div className="panel">
        <div className="panel-header"><h3>What's converting</h3></div>
        {section('By behavioral style', discM, 2)}
        {section('By message length', lenM)}
        {section('Question vs. statement', qM)}
        {section('By time of day', hourM, 2)}
        <div style={{fontSize:'10px',color:'var(--text-3)'}}>Ari uses these patterns as silent guidance when drafting tomorrow's messages.</div>
      </div>}
      <div className="panel">
        <div className="panel-header"><h3><span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="flame" size={16} /> Most likely to transact</span></h3><span className="nav-badge">{leads.length}</span></div>
        {leads.length ? leads.map(l=>(
          <div key={l.contact_id} onClick={()=>setHubId(l.contact_id)} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}>
            <div style={{width:'38px',height:'38px',borderRadius:'9px',background:'var(--bg-hover)',border:'1px solid '+tierColor(l.tier),display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><span style={{fontWeight:800,fontSize:'14px',color:tierColor(l.tier)}}>{l.score}</span></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:'13px'}}>{(l.contacts&&l.contacts.name)||'—'} <span style={{fontSize:'10px',textTransform:'uppercase',color:tierColor(l.tier),marginLeft:'4px'}}>{l.tier}</span></div>
              <div style={{fontSize:'11px',color:'var(--text-3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{Object.keys(l.factors||{}).join(' · ')||'—'}</div>
            </div>
          </div>
        )) : <div style={{fontSize:'12px',color:'var(--text-3)'}}>Scores build as contacts engage and files link up. Higher = more likely to transact soon.</div>}
        <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',lineHeight:1.5}}>Blends recent engagement, replies, file links, priority, ownership tenure, and activity. Refreshed nightly; also boosts who Ari surfaces in your briefing.</div>
      </div>
      {hubId && <ActionHubModal contactId={hubId} userId={userId} onClose={()=>setHubId(null)} />}
      {perContact.length>0 && <div className="panel">
        <div className="panel-header"><h3>By contact</h3></div>
        {perContact.map((c,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',gap:'10px',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:'12px'}}>
            <span style={{flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</span>
            <span style={{color:'var(--text-3)'}}>{c.s} sent</span><span style={{color:'var(--green)'}}>{c.r} rep</span><span style={{color:'var(--accent)'}}>{c.d} deal</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

function NorthStarStrip({ userId, onOpen }) {
  const [closed,setClosed]=useState(0); const [target,setTarget]=useState(0); const [pace,setPace]=useState(0); const [loaded,setLoaded]=useState(false);
  useEffect(()=>{ (async()=>{ try {
    const year=new Date().getFullYear();
    const { data:gg }=await supabase.from('ari_goals').select('gci_target').eq('user_id',userId).eq('year',year).maybeSingle();
    const t=gg?Number(gg.gci_target)||0:0; setTarget(t);
    const { data:dl }=await supabase.from('deals').select('gross_commission,sale_price,commission_pct,close_date').eq('user_id',userId);
    const ystart=new Date(year,0,1), now=new Date(), yend=new Date(year,11,31,23,59,59);
    const commOf=(d)=>Number(d.gross_commission)||(d.sale_price&&d.commission_pct?d.sale_price*d.commission_pct/100:0);
    const c=(dl||[]).filter(d=>d.close_date&&new Date(d.close_date)>=ystart&&new Date(d.close_date)<=now).reduce((sm,d)=>sm+commOf(d),0);
    setClosed(c); setPace(c-(t*((now-ystart)/(yend-ystart))));
  } catch(e){} setLoaded(true); })(); },[]); // eslint-disable-line
  if (!loaded) return null;
  const money=(n)=>'$'+Math.round(n).toLocaleString();
  const pct= target? Math.min(100,Math.round(closed/target*100)) : 0;
  return (
    <div className="panel" style={{cursor:'pointer'}} onClick={onOpen}>
      {target>0 ? (<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
          <span style={{fontSize:'11px',letterSpacing:'.14em',textTransform:'uppercase',color:'var(--accent)',fontWeight:700}}><Icon name="target" size={11} style={{verticalAlign:'-2px'}} /> North Star · {new Date().getFullYear()} GCI</span>
          <span style={{fontSize:'12px',color:'var(--text-3)'}}>Goal →</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
          <span style={{fontSize:'18px',fontWeight:800}}>{money(closed)}<span style={{fontSize:'12px',color:'var(--text-3)',fontWeight:400}}> / {money(target)}</span></span>
          <span style={{fontSize:'12px',fontWeight:700,color: pace>=0?'var(--green)':'var(--yellow)'}}>{pace>=0?'+':''}{money(pace)} vs pace</span>
        </div>
        <div style={{height:'8px',background:'var(--bg-hover)',borderRadius:'4px',overflow:'hidden'}}><div style={{height:'100%',width:pct+'%',background:'var(--accent)'}}/></div>
      </>) : (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:'13px',fontWeight:600}}><Icon name="target" size={13} style={{verticalAlign:'-2px'}} /> Set your income goal</span><span style={{fontSize:'12px',color:'var(--accent)'}}>Set up →</span></div>
      )}
    </div>
  );
}

function GoalEngine({ userId, onBack }) {
  const [loading,setLoading]=useState(true);
  const [goal,setGoal]=useState({ gci_target:0, avg_commission:null, close_rate:0.4 });
  const [deals,setDeals]=useState([]);
  const [act,setAct]=useState({sent:0,replied:0,meetings:0,weekSent:0});
  const [editing,setEditing]=useState(false);
  const [form,setForm]=useState({ gci_target:'', avg_commission:'', close_rate:'' });
  const [saving,setSaving]=useState(false);
  const year=new Date().getFullYear();
  useEffect(()=>{ (async()=>{ try {
    const { data:g } = await supabase.from('ari_goals').select('*').eq('user_id',userId).eq('year',year).maybeSingle();
    if (g){ setGoal({ gci_target:Number(g.gci_target)||0, avg_commission:g.avg_commission!=null?Number(g.avg_commission):null, close_rate:Number(g.close_rate)||0.4 });
      setForm({ gci_target:g.gci_target||'', avg_commission:g.avg_commission??'', close_rate:g.close_rate!=null?Math.round(Number(g.close_rate)*100):'' }); }
    const { data:dl } = await supabase.from('deals').select('gross_commission,sale_price,list_price,target_price,commission_pct,status,close_date,contract_date').eq('user_id',userId);
    setDeals(dl||[]);
    const since90=new Date(Date.now()-90*864e5).toISOString();
    const { data:ro } = await supabase.from('ari_outreach').select('replied,meeting_booked,sent_at').eq('user_id',userId).eq('status','sent').gte('sent_at',since90);
    const rows=ro||[]; const weekAgo=Date.now()-7*864e5;
    setAct({ sent:rows.length, replied:rows.filter(r=>r.replied).length, meetings:rows.filter(r=>r.meeting_booked).length, weekSent:rows.filter(r=>new Date(r.sent_at).getTime()>=weekAgo).length });
  } catch(e){} setLoading(false); })(); },[]); // eslint-disable-line
  const money=(n)=>'$'+Math.round(n||0).toLocaleString();
  const ystart=new Date(year,0,1), now=new Date(), yend=new Date(year,11,31,23,59,59);
  const commOf=(d)=> Number(d.gross_commission)|| (d.sale_price&&d.commission_pct? d.sale_price*d.commission_pct/100 : (d.list_price&&d.commission_pct? d.list_price*d.commission_pct/100 : (d.target_price&&d.commission_pct? d.target_price*d.commission_pct/100 : 0)));
  const closedThis = deals.filter(d=>d.close_date && new Date(d.close_date)>=ystart && new Date(d.close_date)<=now);
  const gciClosed = closedThis.reduce((sm,d)=>sm+commOf(d),0);
  const isActive=(d)=> !d.close_date && !['lost','dead','cancelled','archived','closed'].includes(String(d.status||'').toLowerCase());
  const pipeline = deals.filter(isActive);
  const gciPipeline = pipeline.reduce((sm,d)=>sm+commOf(d),0);
  const closedAll = deals.filter(d=>d.close_date);
  const computedAvg = closedAll.length? closedAll.reduce((sm,d)=>sm+commOf(d),0)/closedAll.length : 0;
  const avgComm = (goal.avg_commission && goal.avg_commission>0)? goal.avg_commission : (computedAvg||9000);
  const replyRate = act.sent>=20 ? Math.max(0.05, act.replied/act.sent) : 0.2;
  const meetingRate = act.replied>=10 ? Math.max(0.1, act.meetings/act.replied) : 0.3;
  const closeRate = Math.max(0.1, goal.close_rate||0.4);
  const target = goal.gci_target||0;
  const remainingGci = Math.max(0, target - gciClosed - gciPipeline*0.5);
  const dealsNeeded = avgComm? Math.ceil(remainingGci/avgComm) : 0;
  const apptsNeeded = Math.ceil(dealsNeeded/closeRate);
  const convosNeeded = Math.ceil(apptsNeeded/meetingRate);
  const reachNeeded = Math.ceil(convosNeeded/replyRate);
  const weeksLeft = Math.max(1, Math.ceil((yend-now)/(7*864e5)));
  const perWeek=(n)=>Math.ceil(n/weeksLeft);
  const yearFrac = (now-ystart)/(yend-ystart);
  const paceDelta = gciClosed - target*yearFrac;
  const pctToGoal = target? Math.min(100, Math.round(gciClosed/target*100)) : 0;
  const saveGoal=async()=>{ setSaving(true);
    const payload={ user_id:userId, year, gci_target:Number(form.gci_target)||0, avg_commission: form.avg_commission!==''?Number(form.avg_commission):null, close_rate: form.close_rate!==''?(Number(form.close_rate)/100):0.4, updated_at:new Date().toISOString() };
    try { await supabase.from('ari_goals').upsert(payload,{ onConflict:'user_id,year' }); setGoal({ gci_target:payload.gci_target, avg_commission:payload.avg_commission, close_rate:payload.close_rate }); } catch(e){}
    setSaving(false); setEditing(false);
  };
  const Tile=({label,val,sub,col})=> <div style={{background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px',textAlign:'center'}}><div style={{fontSize:'16px',fontWeight:800,color:col||'var(--accent)'}}>{val}</div><div style={{fontSize:'10px',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--text-3)',marginTop:'2px'}}>{label}</div>{sub&&<div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>}</div>;
  const Funnel=({label,total,per,icon})=> <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom:'1px solid var(--border)'}}><span style={{fontSize:'18px'}}>{icon}</span><div style={{flex:1}}><div style={{fontWeight:700,fontSize:'14px'}}>{total}</div><div style={{fontSize:'11px',color:'var(--text-3)'}}>{label}</div></div><div style={{textAlign:'right'}}><div style={{fontWeight:700,fontSize:'13px',color:'var(--accent)'}}>{per}/wk</div><div style={{fontSize:'10px',color:'var(--text-3)'}}>to stay on pace</div></div></div>;
  if (loading) return <div className="view"><div className="loading-screen" style={{height:'40vh'}}><div className="spinner"/><div style={{marginTop:'12px',color:'var(--text-2)',fontSize:'13px'}}>Building your wealth engine…</div></div></div>;
  return (
    <div className="view">
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <h2 style={{margin:0}}>Goal · Wealth Engine</h2>
        <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>setEditing(e=>!e)}>{editing?'Close':'Edit'}</button>
      </div>
      {editing && <div className="panel">
        <div className="panel-header"><h3>Your goal &amp; assumptions</h3></div>
        <div className="form-group"><label className="form-label">{year} GCI goal ($)</label><input className="form-input" type="number" value={form.gci_target} onChange={e=>setForm(f=>({...f,gci_target:e.target.value}))} placeholder="e.g. 500000"/></div>
        <div className="form-group"><label className="form-label">Avg. commission per file ($)</label><input className="form-input" type="number" value={form.avg_commission} onChange={e=>setForm(f=>({...f,avg_commission:e.target.value}))} placeholder={computedAvg?('blank = auto '+money(computedAvg)):'blank = auto · e.g. 9000'}/></div>
        <div className="form-group"><label className="form-label">Appointment → close rate (%)</label><input className="form-input" type="number" value={form.close_rate} onChange={e=>setForm(f=>({...f,close_rate:e.target.value}))} placeholder="e.g. 40"/></div>
        <button className="btn btn-primary" disabled={saving} onClick={saveGoal}>{saving?'Saving…':'Save goal'}</button>
      </div>}
      {target<=0 && !editing && <div className="panel"><div style={{textAlign:'center',padding:'12px'}}><div style={{fontSize:'15px',fontWeight:700,marginBottom:'6px'}}>Set your income goal</div><div style={{fontSize:'13px',color:'var(--text-2)',marginBottom:'12px'}}>Tell Ari your GCI target and it works backward to the daily activity that gets you there.</div><button className="btn btn-primary" onClick={()=>setEditing(true)}>Set your goal</button></div></div>}
      {target>0 && <>
      <div className="panel">
        <div className="panel-header"><h3>{year} progress</h3></div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px'}}>
          <span style={{fontSize:'24px',fontWeight:800}}>{money(gciClosed)}</span>
          <span style={{fontSize:'13px',color:'var(--text-3)'}}>of {money(target)} · {pctToGoal}%</span>
        </div>
        <div style={{height:'10px',background:'var(--bg-hover)',borderRadius:'5px',overflow:'hidden',marginBottom:'10px'}}><div style={{height:'100%',width:pctToGoal+'%',background:'var(--accent)'}}/></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
          <Tile label="Closed" val={money(gciClosed)} sub={closedThis.length+' deals'}/>
          <Tile label="Pipeline" val={money(gciPipeline)} sub={pipeline.length+' active'}/>
          <Tile label="vs pace" val={(paceDelta>=0?'+':'')+money(paceDelta)} col={paceDelta>=0?'var(--green)':'var(--yellow)'} sub={paceDelta>=0?'ahead':'behind'}/>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>What it takes</h3><span style={{fontSize:'12px',color:'var(--text-3)'}}>{weeksLeft} weeks left</span></div>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'8px'}}>To reach {money(target)} (counting closed + half your pipeline), working backward:</div>
        <Funnel icon={<Icon name="deals" size={18} />} label={'files to close · '+money(avgComm)+' avg'} total={dealsNeeded} per={perWeek(dealsNeeded)}/>
        <Funnel icon={<Icon name="users" size={18} />} label={'appointments · '+Math.round(closeRate*100)+'% close'} total={apptsNeeded} per={perWeek(apptsNeeded)}/>
        <Funnel icon={<Icon name="message" size={18} />} label={'conversations · '+Math.round(meetingRate*100)+'% to appt'} total={convosNeeded} per={perWeek(convosNeeded)}/>
        <Funnel icon={<Icon name="megaphone" size={18} />} label={'reach-outs · '+Math.round(replyRate*100)+'% reply'} total={reachNeeded} per={perWeek(reachNeeded)}/>
        <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',lineHeight:1.5}}>Reply &amp; appointment rates are learned from your outreach where you have enough data, otherwise sensible defaults. Edit assumptions up top.</div>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>This week</h3></div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
          <span style={{fontSize:'13px'}}>Reach-outs sent</span>
          <span style={{fontSize:'14px',fontWeight:700}}>{act.weekSent} <span style={{color:'var(--text-3)',fontWeight:400}}>/ {perWeek(reachNeeded)} target</span></span>
        </div>
        <div style={{height:'8px',background:'var(--bg-hover)',borderRadius:'4px',overflow:'hidden'}}><div style={{height:'100%',width:Math.min(100, perWeek(reachNeeded)? Math.round(act.weekSent/perWeek(reachNeeded)*100):0)+'%',background: act.weekSent>=perWeek(reachNeeded)?'var(--green)':'var(--accent)'}}/></div>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'10px',lineHeight:1.5}}>{act.weekSent>=perWeek(reachNeeded)? 'On pace this week — keep it up.' : 'Send '+Math.max(0,perWeek(reachNeeded)-act.weekSent)+' more this week to stay on track. Ari surfaces your highest-propensity contacts first.'}</div>
      </div>
      </>}
    </div>
  );
}
// ─────────────────────────────────────────
// Call follow-ups — review commitments Ari pulled from recorded Quo calls,
// then create the tasks (linked to the contact). Renders nothing when empty.
// ─────────────────────────────────────────

function CallFollowupsPanel({ userId, contacts = [], setTasks, defaultSystem = 'eisenhower' }) {
  const [calls, setCalls] = useState(null);
  const [edits, setEdits] = useState({});       // `${callId}:${idx}` -> {title,due_date,priority,owner}
  const [checked, setChecked] = useState({});   // `${callId}:${idx}` -> bool
  const [busy, setBusy] = useState({});
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    const { data } = await supabase.from('quo_calls')
      .select('id,contact_id,proposed_tasks,summary,direction,participant,from_number,to_number,completed_at,op_created_at,recording_url')
      .eq('review_status', 'pending').order('op_created_at', { ascending: false }).limit(50);
    const rows = (data || []).filter(c => Array.isArray(c.proposed_tasks) && c.proposed_tasks.length);
    setCalls(rows);
    const ck = {};
    rows.forEach(c => (c.proposed_tasks || []).forEach((t, i) => { ck[`${c.id}:${i}`] = true; }));
    setChecked(ck);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const checkNow = async () => {
    setChecking(true); setErr(null);
    try { await supabase.functions.invoke('quo-call-process', { body: {} }); await load(); }
    catch (e) { setErr('Could not check calls.'); }
    setChecking(false);
  };

  const tv = (id, i, key, fb) => { const e = edits[`${id}:${i}`] || {}; return e[key] !== undefined ? e[key] : fb; };
  const setTv = (id, i, key, val) => setEdits(s => ({ ...s, [`${id}:${i}`]: { ...(s[`${id}:${i}`] || {}), [key]: val } }));
  const nameOf = (cid) => { const c = contacts.find(x => x.id === cid); return c ? c.name : null; };
  const phoneOf = (c) => c.participant || c.to_number || c.from_number || '';
  const quad = (p) => p === 'high' ? 'A' : p === 'low' ? 'C' : 'B';
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const summaryText = (s) => { if (!s) return ''; if (typeof s === 'string') return s; if (Array.isArray(s)) return s.join(' '); if (typeof s === 'object') return s.summary || ''; return String(s); };

  const approve = async (call) => {
    setBusy(b => ({ ...b, [call.id]: true })); setErr(null);
    const items = call.proposed_tasks || [];
    let created = 0;
    for (let i = 0; i < items.length; i++) {
      if (!checked[`${call.id}:${i}`]) continue;
      const owner = tv(call.id, i, 'owner', items[i].owner);
      const t0 = tv(call.id, i, 'title', items[i].title);
      const title = owner === 'them' ? `Follow up: ${t0}` : t0;
      const due = tv(call.id, i, 'due_date', items[i].due_date) || null;
      const priority = tv(call.id, i, 'priority', items[i].priority) || 'medium';
      try {
        const { data: t, error } = await supabase.from('tasks').insert({
          user_id: userId, title, due_date: due, priority,
          priority_system: defaultSystem || 'eisenhower', eisenhower_quadrant: quad(priority), completed: false,
        }).select().single();
        if (!error && t) {
          created++;
          if (setTasks) setTasks(prev => [t, ...prev]);
          if (call.contact_id) { try { await supabase.rpc('set_task_contacts', { p_task_id: t.id, p_contact_ids: [call.contact_id] }); } catch (_) {} }
        }
      } catch (_) {}
    }
    await supabase.from('quo_calls').update({ review_status: 'done' }).eq('id', call.id);
    setBusy(b => ({ ...b, [call.id]: false }));
    setCalls(cs => cs.filter(c => c.id !== call.id));
    if (window.__notify) window.__notify(`Created ${created} task${created === 1 ? '' : 's'} from the call.`, 'success');
  };
  const dismiss = async (call) => {
    await supabase.from('quo_calls').update({ review_status: 'dismissed' }).eq('id', call.id);
    setCalls(cs => cs.filter(c => c.id !== call.id));
  };

  if (calls === null || !calls.length) return null; // quiet until there's something to review

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="quo" size={15} /> Call follow-ups</h3>
        <span className="nav-badge">{calls.length}</span>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px' }}>Commitments Ari pulled from your recorded calls. The call is already on the contact&rsquo;s timeline — review and create the tasks.</div>
      {err && <div style={{ padding: '8px 12px', marginBottom: '10px', background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: '8px', color: 'var(--red)', fontSize: '12px' }}>{err}</div>}
      {calls.map(call => {
        const nm = nameOf(call.contact_id);
        const items = call.proposed_tasks || [];
        return (
          <div key={call.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>{nm || phoneOf(call) || 'Unknown caller'}</span>
              {!nm && <span style={{ fontSize: '10px', color: 'var(--yellow)' }}>unmatched — no contact link</span>}
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-3)' }}>{fmt(call.completed_at || call.op_created_at)} · on timeline ✓</span>
            </div>
            {summaryText(call.summary) && <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '10px', lineHeight: 1.5 }}>{summaryText(call.summary)}</div>}
            {items.map((it, i) => {
              const k = `${call.id}:${i}`;
              const owner = tv(call.id, i, 'owner', it.owner);
              return (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px', borderRadius: '8px', background: 'var(--bg-hover)', marginBottom: '6px' }}>
                  <input type="checkbox" checked={!!checked[k]} onChange={e => setChecked(s => ({ ...s, [k]: e.target.checked }))} style={{ marginTop: '6px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: '5px', color: owner === 'them' ? '#f59e0b' : 'var(--accent)', border: `1px solid ${owner === 'them' ? '#f59e0b' : 'var(--accent-dim)'}` }}>{owner === 'them' ? 'Track (them)' : 'You'}</span>
                      {it.note && <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>{it.note}</span>}
                    </div>
                    <input className="form-input" style={{ margin: '0 0 6px', fontSize: '13px', padding: '6px 8px' }} value={tv(call.id, i, 'title', it.title)} onChange={e => setTv(call.id, i, 'title', e.target.value)} />
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <input type="date" className="form-input" style={{ margin: 0, fontSize: '12px', padding: '5px 8px', flex: '1 1 130px' }} value={tv(call.id, i, 'due_date', it.due_date) || ''} onChange={e => setTv(call.id, i, 'due_date', e.target.value)} />
                      <select className="form-select" style={{ margin: 0, fontSize: '12px', padding: '5px 8px', flex: '0 0 105px' }} value={tv(call.id, i, 'priority', it.priority)} onChange={e => setTv(call.id, i, 'priority', e.target.value)}>
                        <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button className="btn btn-primary btn-sm" disabled={busy[call.id]} onClick={() => approve(call)}>{busy[call.id] ? 'Creating…' : 'Create selected tasks'}</button>
              <button className="btn btn-ghost btn-sm" disabled={busy[call.id]} onClick={() => dismiss(call)}>Dismiss</button>
            </div>
          </div>
        );
      })}
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <button className="btn btn-ghost btn-sm" disabled={checking} onClick={checkNow}>{checking ? 'Checking…' : '↻ Check for new calls'}</button>
      </div>
    </div>
  );
}


function AriBriefingView({ userId, user, setView, setFocusTaskId, setFocusEventId, profiles = [], contacts = [], properties = [], events = [], brain = [], defaultSystem = 'eisenhower', tasks = [], setTasks }) {
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState(null);
  const [err, setErr] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [acct, setAcct] = useState(null);
  const [edits, setEdits] = useState({});
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState({});
  const [openSrc, setOpenSrc] = useState({});
  const [replyAll, setReplyAll] = useState({});
  const [rwBusy, setRwBusy] = useState({});
  const [prevMsg, setPrevMsg] = useState({});
  const [speaking, setSpeaking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [approved, setApproved] = useState({});
  const [skipDecided, setSkipDecided] = useState({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');
  const [score, setScore] = useState(null);
  const [showScore, setShowScore] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [hubId, setHubId] = useState(null);
  const [showGoal, setShowGoal] = useState(false);
  const [followUpFor, setFollowUpFor] = useState(null); // reach-out we're creating a follow-up task for
  const [snoozeFor, setSnoozeFor] = useState(null);      // contact_id whose snooze picker is open
  const [expandMsg, setExpandMsg] = useState({});        // per-contact "show full message" toggle
  const SNOOZE_OPTS = [
    { label: '1 day', days: 1 }, { label: '2 days', days: 2 }, { label: '3 days', days: 3 },
    { label: '1 week', days: 7 }, { label: '2 weeks', days: 14 }, { label: '1 month', days: 30 },
  ];

  const today = new Date().toLocaleDateString('en-CA');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });

  const load = async (regenerate=false) => {
    if (regenerate) setRegenerating(true); else setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('ari-briefing', { body: { today, regenerate } });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      setBriefing(data.briefing);
      const seed = {};
      (data.briefing?.payload?.reachouts || []).forEach(r => { seed[r.contact_id] = { subject: r.subject, message: r.message }; });
      setEdits(seed);
    } catch(e){ setErr(e.message || String(e)); }
    setLoading(false); setRegenerating(false);
  };
  useEffect(()=>{ load(false); }, []);   // eslint-disable-line
  useEffect(()=>{ loadScore(); }, []);   // eslint-disable-line
  useEffect(()=>{ (async ()=>{
    const { data:a } = await supabase.from('email_accounts').select('id,email_address').contains('purposes',['email']).order('created_at').limit(1);
    setAcct((a&&a[0])||null);
    const nm = user?.user_metadata?.display_name?.trim() || user?.user_metadata?.full_name?.trim()?.split(/\s+/)[0] || (user?.email||'').split('@')[0] || 'there';
    setFirstName(nm);
  })(); }, []);   // eslint-disable-line

  const payload = briefing?.payload || {};
  const reachouts = payload.reachouts || [];

  const persist = async (newReachouts) => {
    const np = { ...payload, reachouts: newReachouts };
    setBriefing(b => ({ ...b, payload: np }));
    await supabase.from('ari_briefings').update({ payload: np, updated_at: new Date().toISOString() }).eq('id', briefing.id);
  };
  const setStatus = async (cid, status) => {
    const np = reachouts.map(r => r.contact_id===cid ? { ...r, ...(edits[cid]||{}), status } : r);
    await persist(np);
  };
  const logTouch = async (cid, channel) => {
    try {
      await supabase.from('contact_interactions').insert({ user_id:userId, contact_id:cid, channel, direction:'outbound', kind:'touch', occurred_at:new Date().toISOString(), brief:'Ari Daily Briefing outreach' });
      await supabase.from('contacts').update({ last_contact_at:new Date().toISOString() }).eq('id', cid);
    } catch(e){}
  };
  const logOutreach = async (r, sr, statusVal='sent') => {
    try {
      const e = edits[r.contact_id]||{};
      const msg = statusVal==='skipped' ? '' : ((e.message ?? r.message) || '');
      const subj = statusVal==='skipped' ? (r.subject||'') : ((e.subject ?? r.subject) || '');
      const now = new Date();
      const wc = msg.trim() ? msg.trim().split(/\s+/).length : 0;
      await supabase.from('ari_outreach').insert({ user_id:userId, contact_id:r.contact_id, contact_name:r.name, contact_email:r.email||null, channel:'email', subject:subj, body:msg, reason:r.reason||null, disc:r.disc||null, disc_label:r.disc_label||null, word_count:wc, has_question:/\?/.test(msg), send_hour:now.getHours(), send_dow:now.getDay(), briefing_date:today, provider_thread_id:(sr&&sr.provider_thread_id)||null, status:statusVal, sent_at:now.toISOString() });
    } catch(e){}
  };
  const loadScore = async () => {
    try {
      await supabase.rpc('ari_attribute_outcomes', { p_user: userId });
      const since = new Date(Date.now()-7*864e5).toISOString();
      const { data } = await supabase.from('ari_outreach').select('replied,meeting_booked,deal_moved,status,sent_at').eq('user_id',userId).eq('status','sent').gte('sent_at',since);
      const rows = data||[]; const sent=rows.length, replied=rows.filter(x=>x.replied).length, meetings=rows.filter(x=>x.meeting_booked).length, deals=rows.filter(x=>x.deal_moved).length;
      setScore({ sent, replied, meetings, deals, replyRate: sent?Math.round(replied/sent*100):0 });
    } catch(e){}
  };
  const emailOf = (x)=>{ const m=String(x||'').match(/<([^>]+)>/); return (m?m[1]:String(x||'')).trim().toLowerCase(); };
  const selfEmails = [acct?.email_address, user?.email, 'dara@brokerdara.com', 'khoyi1234@gmail.com'].filter(Boolean).map(x=>String(x).toLowerCase());
  const otherRecips = (r)=>{
    const all = [ ...((r.source&&r.source.to)||[]), ...((r.source&&r.source.cc)||[]) ];
    const seen=new Set(); const out=[];
    for (const a of all){ const e=emailOf(a); if(!e||e===String(r.email||'').toLowerCase()||selfEmails.includes(e)||seen.has(e)) continue; seen.add(e); out.push(a); }
    return out;
  };
  const doSend = async (r) => {
    if (!r.email) { setErr('No email on file for '+r.name); return false; }
    if (!acct) { setErr('Connect a Gmail account in Settings to send.'); return false; }
    setBusy(b=>({ ...b,[r.contact_id]:true }));
    const e = edits[r.contact_id]||{};
    const cc = replyAll[r.contact_id] ? otherRecips(r) : [];
    const { data:sr, error:se } = await supabase.functions.invoke('gmail-send', { body:{ account_id:acct.id, to:r.email, cc: cc.length?cc:undefined, subject:e.subject||r.subject, body_text:e.message||r.message } });
    setBusy(b=>({ ...b,[r.contact_id]:false }));
    if (se || sr?.error) { setErr('Send failed: '+(se?.message||sr?.error)); return false; }
    await logTouch(r.contact_id,'email');
    await logOutreach(r, sr, 'sent');
    await setStatus(r.contact_id,'sent');
    loadScore();
    return true;
  };
  const doCopy = async (r) => { try{ await navigator.clipboard.writeText((edits[r.contact_id]?.message)||r.message); }catch(e){} };
  const doDone = async (r) => { await logTouch(r.contact_id,'manual'); await setStatus(r.contact_id,'done'); };
  // Snooze with a real duration: hide this person from reach-outs until the chosen date.
  const applySnooze = async (r, until) => {
    setSnoozeFor(null);
    try { await supabase.from('contacts').update({ reachout_snooze_until: until.toISOString() }).eq('id', r.contact_id); } catch(e){}
    const np = reachouts.map(x => x.contact_id===r.contact_id ? { ...x, ...(edits[r.contact_id]||{}), status:'snoozed', snooze_until: until.toISOString() } : x);
    await persist(np);
    if (window.__notify) window.__notify(`Snoozed ${r.name} until ${until.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`, 'success');
  };
  const doSnooze = async (r, days=3) => { const until=new Date(); until.setHours(9,0,0,0); until.setDate(until.getDate()+days); await applySnooze(r, until); };
  const doSnoozeUntil = async (r, dateStr) => { if(!dateStr) return; await applySnooze(r, new Date(dateStr+'T09:00:00')); };
  // Send the email, then open a pre-filled, fully editable follow-up task.
  const openFollowUpTask = (r) => {
    const due = new Date(); due.setDate(due.getDate()+3);
    const dueStr = due.toLocaleDateString('en-CA');
    setFollowUpFor({
      contact_id: r.contact_id,
      initial: {
        title: `Follow up: ${r.name}`,
        due_date: dueStr,
        notes: `Follow-up on outreach to ${r.name}${r.reason?` \u2014 ${r.reason}`:''}.`,
        priority_system: defaultSystem,
        _contact_ids: [r.contact_id],
      },
    });
  };
  const doSendAndFollowUp = async (r) => {
    const ok = await doSend(r);
    if (!ok) return;
    openFollowUpTask(r);
  };
  const doTaskOnly = (r) => openFollowUpTask(r); // same pre-fill, no email sent
  const saveFollowUp = async (data) => {
    const { _contact_ids, _email, ...taskData } = data;
    try {
      const insert = { ...taskData, user_id: userId, completed: false };
      const { data: created, error } = await supabase.from('tasks').insert(insert).select().single();
      if (error) { setErr("Couldn\u2019t create follow-up task. Try again."); return; }
      if (created) {
        if (setTasks) setTasks(prev => [created, ...prev]);
        if (Array.isArray(_contact_ids) && _contact_ids.length) {
          try { await supabase.rpc('set_task_contacts', { p_task_id: created.id, p_contact_ids: _contact_ids }); } catch(e){}
        }
      }
      setFollowUpFor(null);
      if (window.__notify) window.__notify('Follow-up task created.', 'success');
    } catch(e){ setErr('Could not save follow-up task.'); }
  };
  const doRewrite = async (r) => {
    const cur = (edits[r.contact_id]?.message) ?? r.message;
    if (!cur || !cur.trim()) { setErr('Write a draft first, then let Ari refine it.'); return; }
    setRwBusy(b=>({ ...b,[r.contact_id]:true }));
    const grp = !!replyAll[r.contact_id];
    const others = grp ? otherRecips(r) : [];
    const { data, error } = await supabase.functions.invoke('ari-rewrite', { body:{ draft:cur, contact_name:r.name, contact_id:r.contact_id, disc_label:r.disc_label||'', source_text:(r.source&&r.source.text)||'', audience: grp?'group':'individual', recipients: others } });
    setRwBusy(b=>({ ...b,[r.contact_id]:false }));
    if (error || data?.error || !data?.message) { setErr('Ari rewrite failed: '+(error?.message||data?.error||'no output')); return; }
    setPrevMsg(p=>({ ...p,[r.contact_id]:cur }));
    setEdit(r.contact_id,'message',data.message,r);
  };
  const undoRewrite = (r) => {
    const prev = prevMsg[r.contact_id];
    if (prev==null) return;
    setEdit(r.contact_id,'message',prev,r);
    setPrevMsg(p=>{ const n={...p}; delete n[r.contact_id]; return n; });
  };

  const startReview = () => { setReviewIdx(0); setApproved({}); setSkipDecided({}); setBatchMsg(''); setReviewing(true); };
  const decide = (r, kind) => { setSkipDecided(x=>({ ...x,[r.contact_id]:kind })); if (kind==='approve') setApproved(a=>({ ...a,[r.contact_id]:true })); setReviewIdx(i=>i+1); };
  const batchSend = async () => {
    setBatchBusy(true); setBatchMsg('');
    const pend = reachouts.filter(r=>r.status==='pending');
    let sent=0, skipped=0, failed=0; let np=[...reachouts];
    for (const r of pend) {
      const decision = skipDecided[r.contact_id];
      if (decision==='approve') {
        if (!r.email || !acct) { failed++; continue; }
        const e = edits[r.contact_id]||{}; const cc = replyAll[r.contact_id] ? otherRecips(r) : [];
        const { data:sr, error:se } = await supabase.functions.invoke('gmail-send', { body:{ account_id:acct.id, to:r.email, cc: cc.length?cc:undefined, subject:e.subject||r.subject, body_text:e.message||r.message } });
        if (se || sr?.error) { failed++; continue; }
        await logTouch(r.contact_id,'email'); await logOutreach(r, sr, 'sent');
        np = np.map(x=>x.contact_id===r.contact_id ? { ...x, ...(edits[r.contact_id]||{}), status:'sent' } : x); sent++;
      } else if (decision==='skip') {
        await logOutreach(r, null, 'skipped');
        np = np.map(x=>x.contact_id===r.contact_id ? { ...x, status:'snoozed' } : x); skipped++;
      }
    }
    await persist(np); setBatchBusy(false); setReviewing(false);
    setBatchMsg(`Sent ${sent}${failed?`, ${failed} failed`:``}${skipped?`, ${skipped} skipped`:``}.`); loadScore();
  };
  const discColor = (d)=> d==='D'?'#ef4444':d==='I'?'var(--accent)':d==='S'?'var(--green)':d==='C'?'#3b82f6':'var(--text-3)';
  const chip = (txt,col)=><span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.03em',color:col,border:`1px solid ${col}`,borderRadius:'5px',padding:'1px 6px'}}>{txt}</span>;
  const prChip = (t) => {
    const q = (t.quadrant||'').toString().toUpperCase();
    let label, col, bg;
    const RED='#ef4444', AMB='#f59e0b', BLU='#3b82f6';
    const tint = (c)=> c===RED?'rgba(239,68,68,.14)':c===AMB?'rgba(245,158,11,.14)':c===BLU?'rgba(59,130,246,.14)':'var(--bg-hover)';
    if (['A','B','C','D'].includes(q)) {
      label = q; col = q==='A'?RED:q==='B'?AMB:q==='C'?BLU:'var(--text-3)';
    } else {
      const p = (t.priority||'').toString().toLowerCase();
      label = p==='high'?'HIGH':p==='low'?'LOW':p==='medium'?'MED':'—';
      col = p==='high'?RED:p==='medium'?AMB:p==='low'?BLU:'var(--text-3)';
    }
    bg = tint(col);
    return <span className="brief-pchip" style={{color:col, background:bg}}>{label}</span>;
  };
  const fmtDate = (d) => { if(!d) return ''; const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
  const dueView = (d) => { if(!d) return {label:'',color:undefined}; if(d<today) return {label:'Overdue',color:'#ef4444'}; if(d===today) return {label:'Today',color:'var(--accent)'}; return {label:fmtDate(d),color:undefined}; };
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  const speakBriefing = () => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) { setErr('Voice playback isn\u2019t supported in this browser.'); return; }
      if (speaking) { synth.cancel(); setSpeaking(false); return; }
      const ro = (payload.reachouts||[]).filter(r=>r.status==='pending');
      const parts = [`${greeting}${firstName?', '+firstName:''}.`];
      if (briefing?.summary) parts.push(briefing.summary);
      if (ro.length){ parts.push(`You have ${ro.length} ${ro.length===1?'person':'people'} to reach out to today.`); ro.slice(0,5).forEach((r,i)=>parts.push(`${i+1}. ${r.name}. ${r.reason}.`)); }
      const nt=(payload.tasks||[]).length, ne=(payload.events||[]).length;
      parts.push(`You have ${nt} task${nt===1?'':'s'} due and ${ne} event${ne===1?'':'s'} on your calendar.`);
      parts.push('Let\u2019s make it count.');
      const u = new SpeechSynthesisUtterance(parts.join(' '));
      u.rate=1.0; u.pitch=1.0; u.lang='en-US';
      const vs = synth.getVoices()||[];
      const v = vs.find(x=>/en[-_]US/i.test(x.lang) && /samantha|female|google us/i.test(x.name)) || vs.find(x=>/^en/i.test(x.lang));
      if (v) u.voice=v;
      u.onend=()=>setSpeaking(false); u.onerror=()=>setSpeaking(false);
      synth.cancel(); setSpeaking(true); synth.speak(u);
    } catch(e){ setSpeaking(false); }
  };
  useEffect(()=>()=>{ try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){} }, []); // stop voice on unmount
  const setEdit = (cid,key,val,r)=> setEdits(s=>({ ...s,[cid]:{ subject:r.subject, message:r.message, ...(s[cid]||{}), [key]:val }}));

  if (loading) return <div className="loading-screen" style={{height:'50vh'}}><div className="spinner"/><div style={{marginTop:'12px',color:'var(--text-2)',fontSize:'13px'}}>Ari is preparing your briefing…</div></div>;

  if (showReport) return <OutreachReport userId={userId} onBack={()=>setShowReport(false)} />;
  if (showGoal) return <GoalEngine userId={userId} onBack={()=>setShowGoal(false)} />;
  const snoozedIds = new Set((contacts||[]).filter(c=>c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()).map(c=>c.id));
  const pending = reachouts.filter(r=>r.status==='pending' && !snoozedIds.has(r.contact_id));
  const handled = reachouts.filter(r=>r.status!=='pending');

  return (
    <div className="view">
      {hubId && <ActionHubModal contactId={hubId} userId={userId} onClose={()=>setHubId(null)} />}
      {followUpFor && <TaskModal
        onClose={()=>setFollowUpFor(null)}
        onSave={saveFollowUp}
        initial={followUpFor.initial}
        defaultSystem={defaultSystem}
        brain={brain}
        contacts={contacts}
        properties={properties}
        events={events}
        userId={userId}
      />}
      <div className="panel" style={{background:'linear-gradient(135deg,var(--bg-card),var(--bg-hover))',borderColor:'var(--accent-dim)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:'220px'}}>
            <div style={{fontSize:'11px',letterSpacing:'.18em',textTransform:'uppercase',color:'var(--accent)',fontWeight:700,display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="sparkles" size={12} /> Ari Daily Briefing</div>
            <h2 style={{margin:'4px 0 2px'}}>{greeting}{firstName?`, ${firstName}`:''}.</h2>
            <div style={{fontSize:'12px',color:'var(--text-3)'}}>{dateStr}</div>
          </div>
          <div style={{display:'flex',gap:'6px',flexShrink:0,flexWrap:'wrap'}}><button className="btn btn-primary btn-sm" disabled={!pending.length} onClick={startReview}><Icon name="zap" size={13} /> Review{pending.length?` ${pending.length}`:''}</button><button className="btn btn-ghost btn-sm" onClick={speakBriefing} title="Listen to your briefing">{speaking?<>■ Stop</>:<><Icon name="volume" size={13} /> Listen</>}</button><button className="btn btn-ghost btn-sm" disabled={regenerating} onClick={()=>load(true)}>{regenerating?'…regenerating':'↻ Regenerate'}</button></div>
        </div>
        {briefing?.summary && <p style={{marginTop:'10px',fontSize:'14px',lineHeight:1.5,color:'var(--text-1)'}}>{briefing.summary}</p>}
      </div>

      <NorthStarStrip userId={userId} onOpen={()=>setShowGoal(true)} />
      {err && <div style={{padding:'8px 12px',margin:'12px 0',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'12px'}}>{err}</div>}

      <div className="panel">
        <div className="panel-header"><h3 onClick={()=>setShowScore(v=>!v)} style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="chart" size={15} /> This week</h3><button className="btn btn-ghost btn-sm" onClick={()=>setShowReport(true)}>Full report →</button></div>
        {showScore && (score && score.sent ? (
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
            {[['Sent',score.sent],['Replies',`${score.replied} (${score.replyRate}%)`],['Meetings',score.meetings],['Files moved',score.deals]].map(([k,v])=>(
              <div key={k} style={{background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px',textAlign:'center'}}>
                <div style={{fontSize:'18px',fontWeight:800,color:'var(--accent)'}}>{v}</div>
                <div style={{fontSize:'10px',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--text-3)',marginTop:'2px'}}>{k}</div>
              </div>
            ))}
          </div>
        ) : <div style={{fontSize:'12px',color:'var(--text-3)'}}>No sends yet this week. As you send from Ari, your reply, meeting, and file outcomes show up here.</div>)}
        {showScore && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px',lineHeight:1.5}}>Ari learns from these outcomes \u2014 who replies, and which phrasing and timing convert \u2014 and uses it to rank and draft tomorrow\u2019s briefing.</div>}
      </div>

      {reviewing && (()=>{ const pend = reachouts.filter(r=>r.status==='pending' && !snoozedIds.has(r.contact_id)); const cur = pend[reviewIdx]; const appdN = Object.values(approved).filter(Boolean).length;
        return (
        <div className="panel" style={{borderColor:'var(--accent-dim)'}}>
          <div className="panel-header"><h3 style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="zap" size={15} /> Rapid review</h3><span style={{fontSize:'12px',color:'var(--text-3)'}}>{Math.min(reviewIdx+1,pend.length)} of {pend.length}</span></div>
          {cur ? (
            <div>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
                <span style={{fontWeight:700,fontSize:'15px'}}>{cur.name}</span>
                {cur.disc && chip(cur.disc, discColor(cur.disc))}
              </div>
              <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'8px'}}>{cur.reason}</div>
              <textarea className="form-input" style={{width:'100%',minHeight:'120px',fontSize:'14px',lineHeight:1.5,resize:'vertical'}} value={(edits[cur.contact_id]?.message) ?? cur.message ?? ''} onChange={e=>setEdit(cur.contact_id,'message',e.target.value,cur)} />
              <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
                <button className="btn btn-ghost" style={{flex:1}} onClick={()=>decide(cur,'skip')}>\u23ed Skip</button>
                <button className="btn btn-primary" style={{flex:2}} onClick={()=>decide(cur,'approve')}>\u2713 Approve to send</button>
              </div>
              <div style={{textAlign:'center',marginTop:'8px'}}><button className="btn btn-ghost btn-sm" onClick={()=>setReviewing(false)}>Exit review</button></div>
            </div>
          ) : (
            <div style={{textAlign:'center',padding:'8px 0'}}>
              <div style={{fontSize:'15px',fontWeight:700,marginBottom:'4px'}}>Ready to send</div>
              <div style={{fontSize:'13px',color:'var(--text-2)',marginBottom:'14px'}}>{appdN} approved{(pend.length-appdN)>0?` \u00b7 ${pend.length-appdN} skipped`:''}</div>
              <div style={{display:'flex',gap:'8px'}}>
                <button className="btn btn-ghost" style={{flex:1}} disabled={batchBusy} onClick={()=>setReviewing(false)}>Back</button>
                <button className="btn btn-primary" style={{flex:2}} disabled={batchBusy||!appdN} onClick={batchSend}>{batchBusy?'Sending\u2026':`Send ${appdN} message${appdN===1?'':'s'}`}</button>
              </div>
            </div>
          )}
        </div>);
      })()}
      {batchMsg && <div style={{padding:'8px 12px',margin:'0 0 12px',background:'rgba(34,197,94,.1)',border:'1px solid var(--green)',borderRadius:'8px',color:'var(--green)',fontSize:'12px'}}>{batchMsg}</div>}

      <CallFollowupsPanel userId={userId} contacts={contacts} setTasks={setTasks} defaultSystem={defaultSystem} />

      <div className="panel" style={{display:reviewing?'none':undefined}}>
        <div className="panel-header"><h3>Reach out today</h3><span className="nav-badge">{pending.length}</span></div>
        {!reachouts.length && <div style={{fontSize:'13px',color:'var(--text-3)'}}>No outreach flagged today — your relationships are current. Nice.</div>}
        {pending.map(r=>(
          <div key={r.contact_id} style={{border:'1px solid var(--border)',borderRadius:'10px',padding:'12px',marginBottom:'10px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'6px'}}>
              <span style={{fontWeight:700,fontSize:'14px'}}>{r.name}</span>
              {r.disc && chip(r.disc+' · '+(r.disc_label||'').split('—')[0].trim(), discColor(r.disc))}
              <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>setHubId(r.contact_id)}><Icon name="quo" size={13} /> Prep &amp; act</button>
            </div>
            <div style={{fontSize:'11px',color:'var(--accent)',marginBottom:'8px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="sparkles" size={11} /> {r.reason} · last touch {r.last_touch}</div>
            {(() => {
              const pr = profiles.find(p => p.contact_id === r.contact_id);
              const starter = pr && pr.research_connection_plan && pr.research_connection_plan.conversation_starters && pr.research_connection_plan.conversation_starters[0];
              const headline = pr && pr.research_headline;
              if (!starter && !headline) return null;
              return (
                <div style={{marginBottom:'8px',padding:'8px 10px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'8px'}}>
                  <div style={{fontSize:'10px',fontWeight:700,letterSpacing:'.1em',textTransform:'uppercase',color:'var(--accent)',marginBottom:'3px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="brain" size={11} /> Connection cue</div>
                  {starter ? <div style={{fontSize:'12px',color:'var(--text-1)',lineHeight:1.4,display:'flex',alignItems:'flex-start',gap:'5px'}}><Icon name="message" size={13} style={{flexShrink:0,marginTop:'1px'}} /> <span>{starter}</span></div> : <div style={{fontSize:'12px',color:'var(--text-1)',lineHeight:1.4}}>{headline}</div>}
                </div>
              );
            })()}

            {r.source && r.source.text && (
              <div style={{marginBottom:'8px',border:'1px solid var(--border)',borderRadius:'8px',background:'var(--bg-base)'}}>
                <div onClick={()=>setOpenSrc(o=>({...o,[r.contact_id]:!o[r.contact_id]}))} style={{cursor:'pointer',padding:'7px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'11px',fontWeight:600,color:'var(--text-2)',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="reply" size={12} /> {r.source.label}{r.source.subject?`: ${r.source.subject}`:''}</span>
                  <span style={{fontSize:'11px',color:'var(--accent)'}}>{openSrc[r.contact_id]?'Hide':'Show'}</span>
                </div>
                {openSrc[r.contact_id]
                  ? <div style={{padding:'2px 10px 10px'}}>
                      {(r.source.from || (r.source.to&&r.source.to.length) || (r.source.cc&&r.source.cc.length)) ? (
                        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'6px',paddingBottom:'6px',borderBottom:'1px solid var(--border)',lineHeight:1.5,wordBreak:'break-word'}}>
                          {r.source.from && <div><span style={{color:'var(--text-2)',fontWeight:600}}>From: </span>{r.source.from}</div>}
                          {r.source.to&&r.source.to.length>0 && <div><span style={{color:'var(--text-2)',fontWeight:600}}>To: </span>{r.source.to.join(', ')}</div>}
                          {r.source.cc&&r.source.cc.length>0 && <div><span style={{color:'var(--text-2)',fontWeight:600}}>Cc: </span>{r.source.cc.join(', ')}</div>}
                        </div>
                      ) : null}
                      <div style={{fontSize:'12px',color:'var(--text-2)',whiteSpace:'pre-wrap',maxHeight:'200px',overflowY:'auto',lineHeight:1.5}}>{r.source.text}</div>
                    </div>
                  : <div style={{padding:'0 10px 8px',fontSize:'11px',color:'var(--text-3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.source.text.slice(0,100)}{r.source.text.length>100?'…':''}</div>}
              </div>
            )}
            {r.email && <input className="form-input" style={{marginBottom:'6px',fontSize:'12px'}} value={(edits[r.contact_id]?.subject)??r.subject} onChange={e=>setEdit(r.contact_id,'subject',e.target.value,r)}/>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
              <span style={{fontSize:'11px',fontWeight:600,color:'var(--text-2)'}}>Your message</span>
              <div style={{display:'flex',gap:'6px'}}>
                <button className="btn btn-ghost btn-sm" style={{padding:'2px 9px',fontSize:'11px'}} onClick={()=>setExpandMsg(m=>({...m,[r.contact_id]:!m[r.contact_id]}))}>{expandMsg[r.contact_id]?'Collapse':'Show full'}</button>
                {prevMsg[r.contact_id]!=null && <button className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'11px'}} onClick={()=>undoRewrite(r)}>Undo</button>}
                <button className="btn btn-ghost btn-sm" disabled={rwBusy[r.contact_id]} onClick={()=>doRewrite(r)} title="Rewrite in your voice, adapted to their style" style={{padding:'2px 9px',fontSize:'11px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>{rwBusy[r.contact_id]?<><Icon name="sparkles" size={12} /> Ari is writing…</>:<><Icon name="sparkles" size={12} /> Ari rewrite</>}</button>
              </div>
            </div>
            <textarea className="form-input" rows={expandMsg[r.contact_id]?18:4} style={{fontSize:'13px',lineHeight:1.5,...(expandMsg[r.contact_id]?{minHeight:'340px',resize:'vertical'}:{})}} value={(edits[r.contact_id]?.message)??r.message} onChange={e=>setEdit(r.contact_id,'message',e.target.value,r)}/>
            <div style={{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap',alignItems:'center'}}>
              {r.email && otherRecips(r).length>0 && (
                <label style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text-2)',cursor:'pointer'}} title={otherRecips(r).join(', ')}>
                  <input type="checkbox" checked={!!replyAll[r.contact_id]} onChange={ev=>setReplyAll(st=>({ ...st,[r.contact_id]:ev.target.checked }))}/>
                  Reply all (+{otherRecips(r).length})
                </label>
              )}
              {r.email && <button className="btn btn-primary btn-sm" disabled={busy[r.contact_id]} onClick={()=>doSend(r)}>{busy[r.contact_id]?'…sending':(replyAll[r.contact_id]?'Send to all':'Send email')}</button>}
              {r.email && <button className="btn btn-ghost btn-sm" disabled={busy[r.contact_id]} onClick={()=>doSendAndFollowUp(r)} title="Send this email, then create a follow-up task you can edit" style={{color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>Send &amp; follow up</button>}
              <button className="btn btn-ghost btn-sm" onClick={()=>doCopy(r)}>Copy</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>doDone(r)}>Mark contacted</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>doTaskOnly(r)} title="Create a follow-up task (pre-filled) without sending the email">Task</button>
              <div style={{position:'relative',display:'inline-block'}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setSnoozeFor(s=>s===r.contact_id?null:r.contact_id)}>Snooze <span style={{color:'var(--text-3)'}}>{snoozeFor===r.contact_id?'\u25be':'\u25b8'}</span></button>
                {snoozeFor===r.contact_id && (<>
                  <div onClick={()=>setSnoozeFor(null)} style={{position:'fixed',inset:0,zIndex:40}}/>
                  <div style={{position:'absolute',bottom:'calc(100% + 6px)',left:0,zIndex:41,background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'6px',minWidth:'170px',boxShadow:'0 10px 30px rgba(0,0,0,.45)'}}>
                    <div style={{fontSize:'10px',fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-3)',padding:'4px 8px 6px'}}>Snooze reach-out for</div>
                    {SNOOZE_OPTS.map(o=>(
                      <button key={o.label} className="btn btn-ghost btn-sm" style={{display:'block',width:'100%',textAlign:'left',padding:'7px 8px',fontSize:'12px'}} onClick={()=>doSnooze(r,o.days)}>{o.label}</button>
                    ))}
                    <div style={{borderTop:'1px solid var(--border)',marginTop:'4px',paddingTop:'7px',padding:'7px 8px 2px'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px'}}>Or pick a date</div>
                      <input type="date" className="form-input" style={{margin:0,fontSize:'12px',padding:'5px 8px',width:'100%'}} min={new Date(Date.now()+864e5).toLocaleDateString('en-CA')} onChange={e=>doSnoozeUntil(r, e.target.value)} />
                    </div>
                  </div>
                </>)}
              </div>
            </div>
          </div>
        ))}
        {!!handled.length && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'6px'}}>{handled.length} handled today ✓</div>}
      </div>

      <div className="panel">
        <div className="panel-header"><h3>Today</h3></div>

        <div className="brief-sec">
          <div className="brief-sec-head">
            <span className="brief-sec-title">Tasks due <span className="brief-pill">{(payload.tasks||[]).length}</span></span>
            <button className="brief-jump" onClick={()=>setView('tasks')}><Icon name="tasks" size={13} /> Open Tasks <span className="arr">→</span></button>
          </div>
          {(payload.tasks||[]).length ? (payload.tasks||[]).map(t=>{ const dv=dueView(t.due_date); return (
            <div key={t.id} className="brief-row" style={{cursor:'pointer'}} onClick={()=>{ setFocusTaskId && setFocusTaskId(t.id); setView('tasks'); }}>
              <span className="brief-pcell">{prChip(t)}</span>
              <span className="brief-title">{t.title}</span>
              <span className="brief-when" style={dv.color?{color:dv.color,fontWeight:600}:undefined}>{dv.label}</span>
            </div>
          );}) : <div className="brief-empty">Nothing due — you\u2019re clear.</div>}
        </div>

        <div className="brief-sec">
          <div className="brief-sec-head">
            <span className="brief-sec-title">On the calendar <span className="brief-pill">{(payload.events||[]).length}</span></span>
            <button className="brief-jump" onClick={()=>setView('calendar')}><Icon name="calendar" size={13} /> Open Calendar <span className="arr">→</span></button>
          </div>
          {(payload.events||[]).length ? (payload.events||[]).map(e=>(
            <div key={e.id} className="brief-row" style={{cursor:'pointer'}} onClick={()=>{ setFocusEventId && setFocusEventId(e.id); setView('calendar'); }}>
              <span className="brief-title">{e.title}{e.location?<span style={{color:'var(--text-3)',fontWeight:400}}> · {e.location}</span>:null}</span>
              <span className="brief-when">{e.all_day?'All day':fmtTime(e.start_at)}</span>
            </div>
          )) : <div className="brief-empty">No events today.</div>}
        </div>
      </div>

      {!!(payload.deals||[]).length && (
        <div className="panel">
          <div className="panel-header"><h3>Files in motion</h3><span className="nav-badge">{payload.deals.length}</span></div>
          {payload.deals.map(d=>(
            <div key={d.id} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:'13px'}}>
              <span>{d.client_name||d.address||'File'}</span><span style={{color:'var(--text-3)',fontSize:'11px'}}>{d.status}{d.close_date?` · ${d.close_date}`:''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// REUSABLE: ✨ Ari rewrite (your draft → your voice, adapted to recipient)
// ─────────────────────────────────────────

export default AriBriefingView;
