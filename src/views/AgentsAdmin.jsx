// Agents / brokerage admin — the roster, the agent editor, pay plans and the
// AI-usage report. Broker-facing administration in one place.
// Extracted from App.js (strangle the monolith, step 26).
import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { modal, money, num } from '../helpers';
import { Icon } from '../icons';
import { confirmDialog, notify } from '../notify';
import { TipFor } from '../tipsUi';
import { ConversionDashboard, LeadsBoard } from './LeadsBoard';

export const AGENT_ROLES = [
  { value:'owner', label:'Owner / Broker' },
  { value:'broker_admin', label:'Broker Admin' },
  { value:'team_leader', label:'Team Leader' },
  { value:'agent', label:'Agent' },
];

export const ROLE_LABEL = Object.fromEntries(AGENT_ROLES.map(r=>[r.value,r.label]));

export const BLANK_PLAN = { name:'Default plan', split_type:'percentage', agent_split_pct:'', cap_amount:'', post_cap_fee:'', transaction_fee:'', buyer_side_fee:'', seller_side_fee:'', royalty_pct:'', royalty_cap:'', tc_fee:'', tc_payee:'', mentor_fee_type:'none', mentor_fee_value:'', profit_share_pct:'', auto_savings_type:'none', auto_savings_value:'', retirement_type:'none', retirement_value:'', retirement_label:'401(k)', custom_fees:[] };

export function PlanField({label,value,onChange,ph}){ return <label className="form-label">{label}<input className="form-input" value={value??''} onChange={onChange} placeholder={ph||''}/></label>; }

export function PlanLabel({children}){ return <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--accent)',marginTop:'4px'}}>{children}</div>; }

export function PayPlanReadOnly({ plan }){
  if(!plan) return <div style={{color:'var(--text-2)',fontSize:'13px'}}>No pay plan on file.</div>;
  const rows=[['Split',plan.split_type==='flat'?'100% / flat':(plan.agent_split_pct!=null?plan.agent_split_pct+'%':'—')],['Annual cap',plan.cap_amount!=null?'$'+Number(plan.cap_amount).toLocaleString():'—'],['Transaction fee',plan.transaction_fee!=null?'$'+plan.transaction_fee:'—'],['Royalty',plan.royalty_pct!=null?plan.royalty_pct+'%':'—']];
  return <div style={{display:'grid',gap:'4px'}}><div style={{fontSize:'13px',fontWeight:700}}>Pay plan</div>{rows.map((r,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:'12px'}}><span style={{color:'var(--text-2)'}}>{r[0]}</span><span>{r[1]}</span></div>)}</div>;
}

export function PayPlanEditor({ agentId, userId, plan, agents, onSaved, onClose }){
  const [p,setP]=useState(plan? { ...BLANK_PLAN, ...plan, custom_fees: plan.custom_fees||[] } : { ...BLANK_PLAN });
  const set=(k,v)=>setP(s=>({...s,[k]:v}));
  const [saving,setSaving]=useState(false);
  const addFee=()=>set('custom_fees',[...(p.custom_fees||[]),{ label:'', type:'flat', basis:'gci', amount:'', side:'agent', disclose:true, payee:'' }]);
  const setFee=(i,k,v)=>set('custom_fees',(p.custom_fees||[]).map((f,idx)=>idx===i?{...f,[k]:v}:f));
  const delFee=(i)=>set('custom_fees',(p.custom_fees||[]).filter((_,idx)=>idx!==i));
  const save=async()=>{
    setSaving(true);
    const row={ user_id:userId, agent_id:agentId, name:p.name||'Default plan', split_type:p.split_type,
      agent_split_pct:num(p.agent_split_pct), cap_amount:num(p.cap_amount), post_cap_fee:num(p.post_cap_fee),
      transaction_fee:num(p.transaction_fee), buyer_side_fee:num(p.buyer_side_fee), seller_side_fee:num(p.seller_side_fee),
      royalty_pct:num(p.royalty_pct), royalty_cap:num(p.royalty_cap),
      tc_fee:num(p.tc_fee), tc_payee:p.tc_payee||null,
      mentor_fee_type:p.mentor_fee_type, mentor_fee_value:num(p.mentor_fee_value),
      profit_share_pct:num(p.profit_share_pct),
      auto_savings_type:p.auto_savings_type, auto_savings_value:num(p.auto_savings_value),
      retirement_type:p.retirement_type, retirement_value:num(p.retirement_value), retirement_label:p.retirement_label||'401(k)',
      custom_fees:(p.custom_fees||[]).map(f=>({...f,amount:num(f.amount)})), active:true, updated_at:new Date().toISOString() };
    let res;
    if(p.id) res=await supabase.from('pay_plans').update(row).eq('id',p.id).select().single();
    else res=await supabase.from('pay_plans').insert(row).select().single();
    setSaving(false);
    if(res.error){ if(window.__notify) window.__notify('Save failed: '+res.error.message,'error'); return; }
    if(onSaved) onSaved(res.data);
    if(window.__notify) window.__notify('Pay plan saved.','success');
    if(onClose) onClose();
  };
  return (
    <div style={{display:'grid',gap:'10px'}}>
      <div style={{fontSize:'13px',fontWeight:700,display:'flex',alignItems:'center',gap:'6px'}}><Icon name="dollar" size={15}/> Pay plan</div>
      <PlanLabel>Split</PlanLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
        <label className="form-label">Split type<select className="form-input" value={p.split_type} onChange={e=>set('split_type',e.target.value)}><option value="percentage">Percentage split</option><option value="cap">Cap (company dollar to a cap)</option><option value="flat">Flat / 100% with fees</option></select></label>
        <PlanField label="Agent split %" value={p.agent_split_pct} onChange={e=>set('agent_split_pct',e.target.value)} ph="e.g. 88"/>
        <PlanField label="Annual cap $" value={p.cap_amount} onChange={e=>set('cap_amount',e.target.value)} ph="e.g. 16000"/>
        <PlanField label="Post-cap txn fee $" value={p.post_cap_fee} onChange={e=>set('post_cap_fee',e.target.value)}/>
      </div>
      <PlanLabel>Transaction fees</PlanLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
        <PlanField label="Per-file fee $" value={p.transaction_fee} onChange={e=>set('transaction_fee',e.target.value)}/>
        <PlanField label="Buyer-side fee $" value={p.buyer_side_fee} onChange={e=>set('buyer_side_fee',e.target.value)}/>
        <PlanField label="Seller-side fee $" value={p.seller_side_fee} onChange={e=>set('seller_side_fee',e.target.value)}/>
      </div>
      <PlanLabel>Franchise / royalty</PlanLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
        <PlanField label="Royalty % of GCI" value={p.royalty_pct} onChange={e=>set('royalty_pct',e.target.value)} ph="e.g. 5"/>
        <PlanField label="Royalty annual cap $" value={p.royalty_cap} onChange={e=>set('royalty_cap',e.target.value)}/>
      </div>
      <PlanLabel>People</PlanLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
        <PlanField label="TC fee $" value={p.tc_fee} onChange={e=>set('tc_fee',e.target.value)}/>
        <PlanField label="TC payee" value={p.tc_payee} onChange={e=>set('tc_payee',e.target.value)}/>
        <label className="form-label">Mentor fee<select className="form-input" value={p.mentor_fee_type} onChange={e=>set('mentor_fee_type',e.target.value)}><option value="none">None</option><option value="pct">% of GCI</option><option value="flat">Flat $</option></select></label>
        <PlanField label="Mentor fee value" value={p.mentor_fee_value} onChange={e=>set('mentor_fee_value',e.target.value)}/>
      </div>
      <PlanLabel>Profit share (not shown on CDA)</PlanLabel>
      <PlanField label="Profit share % of GCI to upline" value={p.profit_share_pct} onChange={e=>set('profit_share_pct',e.target.value)}/>
      <PlanLabel>Contributions / deductions</PlanLabel>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
        <label className="form-label">Auto-savings<select className="form-input" value={p.auto_savings_type} onChange={e=>set('auto_savings_type',e.target.value)}><option value="none">None</option><option value="pct">% of net</option><option value="flat">Flat $</option></select></label>
        <PlanField label="Auto-savings value" value={p.auto_savings_value} onChange={e=>set('auto_savings_value',e.target.value)}/>
        <label className="form-label">Retirement<select className="form-input" value={p.retirement_type} onChange={e=>set('retirement_type',e.target.value)}><option value="none">None</option><option value="pct">% of net</option><option value="flat">Flat $</option></select></label>
        <PlanField label="Retirement value" value={p.retirement_value} onChange={e=>set('retirement_value',e.target.value)}/>
        <PlanField label="Retirement label" value={p.retirement_label} onChange={e=>set('retirement_label',e.target.value)}/>
      </div>
      <PlanLabel>Custom fees / line items</PlanLabel>
      {(p.custom_fees||[]).map((f,i)=>(
        <div key={i} style={{display:'grid',gridTemplateColumns:'1.4fr .8fr .8fr .9fr auto',gap:'6px',alignItems:'center',background:'var(--bg-hover)',padding:'6px',borderRadius:'8px'}}>
          <input className="form-input" placeholder="Label" value={f.label} onChange={e=>setFee(i,'label',e.target.value)} style={{padding:'5px 7px',fontSize:'12px'}}/>
          <select className="form-input" value={f.type} onChange={e=>setFee(i,'type',e.target.value)} style={{padding:'5px',fontSize:'12px'}}><option value="flat">Flat $</option><option value="pct">%</option></select>
          <input className="form-input" placeholder="Amt" value={f.amount} onChange={e=>setFee(i,'amount',e.target.value)} style={{padding:'5px 7px',fontSize:'12px'}}/>
          <select className="form-input" value={f.disclose?'y':'n'} onChange={e=>setFee(i,'disclose',e.target.value==='y')} style={{padding:'5px',fontSize:'12px'}}><option value="y">On CDA</option><option value="n">Hidden</option></select>
          <button className="btn btn-ghost btn-sm" onClick={()=>delFee(i)} style={{color:'var(--text-3)',padding:'4px 6px'}}><Icon name="trash" size={12}/></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={addFee} style={{justifySelf:'start'}}>+ Add custom line item</button>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:'6px'}}><button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save pay plan'}</button></div>
    </div>
  );
}

export function AgentEditor({ agent, agents, userId, isAdmin, canWrite, roleOpts, myTeam, onClose, onSaved, onDeleted }){
  const [a,setA]=useState(agent);
  const [plan,setPlan]=useState(null);
  const [loading,setLoading]=useState(true);
  const others=agents.filter(x=>x.id!==agent.id);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('pay_plans').select('*').eq('agent_id',agent.id).eq('active',true).order('created_at',{ascending:false}).limit(1); setPlan(data&&data[0]?data[0]:null); setLoading(false); })(); },[agent.id]);
  const setAF=(k,v)=>setA(p=>({...p,[k]:v}));
  const saveAgent=async()=>{ const { data } = await supabase.from('agents').update({ name:a.name, email:a.email, phone:a.phone, role:a.role, team:a.team, license_no:a.license_no, upline_id:a.upline_id||null, mentor_id:a.mentor_id||null, active:a.active, notes:a.notes, updated_at:new Date().toISOString() }).eq('id',agent.id).select().single(); if(data){ onSaved(data); if(window.__notify) window.__notify('Agent saved.','success'); } };
  const delAgent=async()=>{ if(!await confirmDialog(`Remove ${agent.name}? Their pay plan will be removed too.`)) return; await supabase.from('agents').delete().eq('id',agent.id); onDeleted(agent.id); };
  const [loginEmail,setLoginEmail]=useState(a.email||'');
  const [loginPw,setLoginPw]=useState('');
  const [loginBusy,setLoginBusy]=useState(false);
  const createLogin=async()=>{
    if(!loginEmail.trim()||loginPw.length<8){ if(window.__notify) window.__notify('Enter an email and a password of 8+ characters.','error'); return; }
    setLoginBusy(true);
    try{ const { data, error } = await supabase.functions.invoke('admin-create-user',{ body:{ action:'create', agent_id:agent.id, email:loginEmail.trim(), password:loginPw, role:a.role } });
      if(error||data?.error){ if(window.__notify) window.__notify('Could not create login: '+(error?.message||data?.error),'error'); return; }
      const u={...a, auth_user_id:data.auth_user_id, email:loginEmail.trim()}; setA(u); onSaved(u); setLoginPw('');
      if(window.__notify) window.__notify('Login created. Share the credentials securely.','success');
    }catch(e){ if(window.__notify) window.__notify('Failed: '+(e.message||e),'error'); } finally{ setLoginBusy(false); }
  };
  const resetLogin=async()=>{
    if(loginPw.length<8){ if(window.__notify) window.__notify('Enter a new password of 8+ characters.','error'); return; }
    setLoginBusy(true);
    try{ const { data, error } = await supabase.functions.invoke('admin-create-user',{ body:{ action:'reset', agent_id:agent.id, password:loginPw } });
      if(error||data?.error){ if(window.__notify) window.__notify('Reset failed: '+(error?.message||data?.error),'error'); return; }
      setLoginPw(''); if(window.__notify) window.__notify('Password reset.','success');
    }catch(e){ if(window.__notify) window.__notify('Failed.','error'); } finally{ setLoginBusy(false); }
  };
  const [linkBusy,setLinkBusy]=useState(false);
  const linkExisting=async()=>{ if(!loginEmail.trim()){ if(window.__notify) window.__notify('Enter the login email first.','error'); return; } setLinkBusy(true); try{ const { data, error } = await supabase.rpc('admin_link_agent_by_email',{ p_agent_id:agent.id, p_email:loginEmail.trim() }); const row=Array.isArray(data)?data[0]:data; if(error||!row||!row.ok){ if(window.__notify) window.__notify((row&&row.msg)||'Could not link.','error'); return; } const u={...a, auth_user_id:row.linked_uid, email:loginEmail.trim()}; setA(u); onSaved(u); if(window.__notify) window.__notify('Linked to existing login.','success'); }catch(e){ if(window.__notify) window.__notify('Link failed.','error'); } finally{ setLinkBusy(false); } };
  const unlinkLogin=async()=>{ if(!await confirmDialog('Unlink this login from '+agent.name+'? Their work will stop attributing to them on leaderboards until re-linked.')) return; setLinkBusy(true); try{ const { data } = await supabase.rpc('admin_unlink_agent',{ p_agent_id:agent.id }); if(data===true){ const u={...a, auth_user_id:null}; setA(u); onSaved(u); if(window.__notify) window.__notify('Login unlinked.','success'); } else if(window.__notify) window.__notify('Could not unlink.','error'); }catch(e){ if(window.__notify) window.__notify('Unlink failed.','error'); } finally{ setLinkBusy(false); } };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'640px',width:'100%',maxHeight:'94vh',overflowY:'auto'}}>
        <div className="modal-header"><h3 style={{margin:0}}>{agent.name}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div style={{display:'grid',gap:'10px'}}>
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--text-3)'}}>Profile</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <label className="form-label">Name<input className="form-input" value={a.name||''} onChange={e=>setAF('name',e.target.value)} disabled={!canWrite}/></label>
            <label className="form-label">Role<select className="form-input" value={a.role} onChange={e=>setAF('role',e.target.value)} disabled={!canWrite}>{(roleOpts||AGENT_ROLES).map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
            <label className="form-label">Email<input className="form-input" value={a.email||''} onChange={e=>setAF('email',e.target.value)} disabled={!canWrite}/></label>
            <label className="form-label">Phone<input className="form-input" value={a.phone||''} onChange={e=>setAF('phone',e.target.value)} disabled={!canWrite}/></label>
            <label className="form-label">Team<input className="form-input" value={a.team||''} onChange={e=>setAF('team',e.target.value)} disabled={!isAdmin}/></label>
            <label className="form-label">License #<input className="form-input" value={a.license_no||''} onChange={e=>setAF('license_no',e.target.value)} disabled={!canWrite}/></label>
            <label className="form-label">Upline (profit share)<select className="form-input" value={a.upline_id||''} onChange={e=>setAF('upline_id',e.target.value)} disabled={!isAdmin}><option value="">— none —</option>{others.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label className="form-label">Mentor<select className="form-input" value={a.mentor_id||''} onChange={e=>setAF('mentor_id',e.target.value)} disabled={!canWrite}><option value="">— none —</option>{others.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          </div>
          {canWrite && <>
            <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',flexDirection:'row'}}><input type="checkbox" checked={a.active!==false} onChange={e=>setAF('active',e.target.checked)}/> Active</label>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              {isAdmin ? <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={delAgent}><Icon name="trash" size={13}/> Remove</button> : <span/>}
              <button className="btn btn-primary btn-sm" onClick={saveAgent}>Save profile</button>
            </div>
          </>}
          {isAdmin && <>
            <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}/>
            <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--accent)'}}>Login & access</div>
            {a.auth_user_id ? (
              <div style={{display:'grid',gap:'8px'}}>
                <div style={{fontSize:'12px',color:'var(--green)'}}>✓ Has a login ({a.email}) · role: {ROLE_LABEL[a.role]}</div>
                <div style={{display:'flex',gap:'8px',alignItems:'flex-end'}}>
                  <label className="form-label" style={{flex:1}}>Reset password<input className="form-input" type="text" value={loginPw} onChange={e=>setLoginPw(e.target.value)} placeholder="New password (8+ chars)"/></label>
                  <button className="btn btn-ghost btn-sm" onClick={resetLogin} disabled={loginBusy}>Reset</button>
                </div>
                <button className="btn btn-ghost btn-sm" style={{color:'var(--red)',justifySelf:'start'}} onClick={unlinkLogin} disabled={linkBusy}>Unlink login</button>
              </div>
            ) : (
              <div style={{display:'grid',gap:'8px'}}>
                <div style={{fontSize:'12px',color:'var(--text-2)'}}>Create an app login for this person. They'll sign in at darasapp.com with {ROLE_LABEL[a.role]} access.</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                  <label className="form-label">Login email<input className="form-input" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}/></label>
                  <label className="form-label">Temp password<input className="form-input" type="text" value={loginPw} onChange={e=>setLoginPw(e.target.value)} placeholder="8+ characters"/></label>
                </div>
                <button className="btn btn-primary btn-sm" onClick={createLogin} disabled={loginBusy} style={{justifySelf:'start'}}>{loginBusy?'Creating…':'Create login'}</button>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Already signed up themselves? Link their existing account instead.</div>
                <button className="btn btn-ghost btn-sm" onClick={linkExisting} disabled={linkBusy} style={{justifySelf:'start'}}>{linkBusy?'Linking...':'Link existing account by email'}</button>
              </div>
            )}
          </>}
          <div style={{borderTop:'1px solid var(--border)',margin:'6px 0'}}/>
          {loading? <div style={{color:'var(--text-2)'}}>Loading pay plan…</div> : (canWrite? <PayPlanEditor agentId={agent.id} userId={userId} plan={plan} agents={others} onSaved={setPlan} onClose={onClose}/> : <PayPlanReadOnly plan={plan}/>)}
        </div>
      </div>
    </div>
  );
}

export function AiUsageReportsPanel(){
  const [rows,setRows]=useState(null);
  const [err,setErr]=useState('');
  const [busyId,setBusyId]=useState(null);
  useEffect(()=>{ (async()=>{
    try {
      const { data, error } = await supabase.rpc('list_usage_reports');
      if(error){ setErr('Could not load reports.'); setRows([]); return; }
      setRows(data||[]);
    } catch(_) { setErr('Could not load reports.'); setRows([]); }
  })(); },[]);
  const download=async(r)=>{
    setBusyId(r.id); setErr('');
    try {
      const { data, error } = await supabase.storage.from('usage-reports').createSignedUrl(r.storage_path, 120);
      if(error||!data?.signedUrl){ setErr('Could not generate a download link — you may not have access.'); setBusyId(null); return; }
      const a=document.createElement('a'); a.href=data.signedUrl; a.download=(r.storage_path.split('/').pop()||'usage-report.xlsx'); a.click();
    } catch(_) { setErr('Download failed. Please try again.'); }
    setBusyId(null);
  };
  return (
    <div style={{marginTop:'12px',display:'grid',gap:'10px'}}>
      <div className="panel" style={{padding:'14px 16px'}}>
        <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.16em',textTransform:'uppercase',color:'var(--accent)'}}>Monthly AI usage &amp; cost</div>
        <div style={{fontSize:'12.5px',color:'var(--text-2)',lineHeight:1.5,marginTop:'4px'}}>A per-agent AI cost report is generated automatically on the 1st of each month for the month just ended, emailed to the brokerage, and saved here. Excel format, brokerage-account cost you could bill back. Visible to brokerage admins only.</div>
      </div>
      {err && <div className="panel" style={{padding:'12px',color:'#e0a97a',fontSize:'12.5px'}}>{err}</div>}
      {rows===null ? <div className="panel" style={{padding:'16px',color:'var(--text-3)',fontSize:'12px'}}>Loading reports…</div>
        : rows.length===0 ? <div className="panel" style={{padding:'24px',textAlign:'center',color:'var(--text-2)',fontSize:'12.5px'}}>No monthly reports yet. The first one arrives on the 1st of next month.</div>
        : (
        <div className="panel" style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
            <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}>
              <th style={{padding:'8px'}}>Month</th>
              <th style={{padding:'8px',textAlign:'right'}}>Brokerage cost</th>
              <th style={{padding:'8px',textAlign:'right'}}>Agents</th>
              <th style={{padding:'8px'}}>Emailed</th>
              <th style={{padding:'8px',textAlign:'right'}}>Report</th>
            </tr></thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'8px',fontWeight:600}}>{r.month_label}</td>
                  <td style={{padding:'8px',textAlign:'right',color:'var(--accent)',fontWeight:700}}>${Number(r.total_cost_usd||0).toFixed(2)}</td>
                  <td style={{padding:'8px',textAlign:'right'}}>{r.agent_count}</td>
                  <td style={{padding:'8px',color:'var(--text-3)'}}>{r.emailed_at ? '✓ sent' : '—'}</td>
                  <td style={{padding:'8px',textAlign:'right'}}>
                    <button className="btn btn-ghost btn-sm" disabled={busyId===r.id} onClick={()=>download(r)}>
                      <Icon name="download" size={13} fb="⬇"/> {busyId===r.id ? "Preparing…" : 'Download .xlsx'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TipFor screen="ai_usage_reports" />
    </div>
  );
}

export function AccountingView({ userId, ownerId, agents, isAdmin }){
  const [sub,setSub]=useState('overview');
  const [entries,setEntries]=useState(null);
  const [payouts,setPayouts]=useState([]);
  const [year,setYear]=useState(new Date().getFullYear());
  const [sel,setSel]=useState({});
  const [payMethod,setPayMethod]=useState('ach');
  const [stmtAgent,setStmtAgent]=useState('');
  const [lf,setLf]=useState({ agent:'', type:'', status:'' });
  const notify=(m,t)=>{ if(window.__notify) window.__notify(m,t||'success'); };
  const agentName=(id)=>{ const a=agents.find(x=>x.id===id); return a?a.name:'Unassigned'; };
  const dl=(fn,csv)=>{ const b=new Blob([csv],{type:'text/csv;charset=utf-8'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=fn; a.click(); URL.revokeObjectURL(u); };
  const csvRow=(arr)=>arr.map(v=>{ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',');

  const load=async()=>{
    const [{ data:e },{ data:p }] = await Promise.all([
      supabase.from('ledger_entries').select('*'),
      supabase.from('payouts').select('*').order('created_at',{ascending:false}),
    ]);
    setEntries(e||[]); setPayouts(p||[]);
  };
  useEffect(()=>{ load(); },[]);

  if(!entries) return <div className="panel" style={{marginTop:'12px',padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Loading accounting…</div>;

  const yr=String(year);
  const inYear=(e)=> (e.period? e.period.startsWith(yr) : new Date(e.created_at).getFullYear()===year);
  const ey=entries.filter(inYear);
  const sumT=(arr,t,st)=>arr.filter(e=>e.entry_type===t && (!st||e.status===st)).reduce((s,e)=>s+(Number(e.amount)||0),0);

  // ---------- OVERVIEW (P&L + AR/AP) ----------
  const revenue=sumT(ey,'company_dollar');
  const ps=sumT(ey,'profit_share_payable');
  const net=revenue-ps;
  const owedAgents=sumT(entries,'agent_payout','pending');
  const paidAgents=sumT(entries,'agent_payout','paid');
  const escrow=sumT(entries,'savings','pending')+sumT(entries,'retirement','pending');
  const psOwed=sumT(entries,'profit_share_payable','pending');
  const months=[...new Set(ey.map(e=>e.period).filter(Boolean))].sort();
  const monthRow=(m)=>{ const r=ey.filter(e=>e.period===m); const cd=r.filter(e=>e.entry_type==='company_dollar').reduce((s,e)=>s+Number(e.amount||0),0); const p=r.filter(e=>e.entry_type==='profit_share_payable').reduce((s,e)=>s+Number(e.amount||0),0); return { m, cd, p, net:cd-p }; };

  // ---------- PAYABLES ----------
  const pendingByAgent={};
  for(const e of entries){ if(e.status!=='pending') continue; const k=e.agent_id||'—'; (pendingByAgent[k]=pendingByAgent[k]||{pay:0,sav:0,ret:0}); if(e.entry_type==='agent_payout') pendingByAgent[k].pay+=Number(e.amount)||0; if(e.entry_type==='savings') pendingByAgent[k].sav+=Number(e.amount)||0; if(e.entry_type==='retirement') pendingByAgent[k].ret+=Number(e.amount)||0; }
  const payKeys=Object.keys(pendingByAgent).filter(k=>pendingByAgent[k].pay>0).sort((a,b)=>pendingByAgent[b].pay-pendingByAgent[a].pay);
  const selKeys=payKeys.filter(k=>sel[k]);
  const selTotal=selKeys.reduce((s,k)=>s+pendingByAgent[k].pay,0);

  const createPayout=async()=>{
    if(selKeys.length===0){ notify('Select at least one agent.','error'); return; }
    const per=new Date().toISOString().slice(0,7);
    for(const k of selKeys){
      const amt=pendingByAgent[k].pay;
      const { data:po } = await supabase.from('payouts').insert({ user_id:ownerId, agent_id:k==='—'?null:k, amount:amt, method:payMethod, period:per, status:'approved', memo:`Commission payout ${per}` }).select().single();
      const ids=entries.filter(e=>e.status==='pending'&&e.entry_type==='agent_payout'&&(e.agent_id||'—')===k).map(e=>e.id);
      if(ids.length) await supabase.from('ledger_entries').update({ status:'paid', paid_at:new Date().toISOString(), payout_id:po?.id||null }).in('id',ids);
    }
    notify(`Created ${selKeys.length} payout(s) totaling ${money(selTotal)}.`); setSel({}); load();
  };
  const exportACH=()=>{ const rows=(selKeys.length?selKeys:payKeys); const h=['Payee','Email','Amount','Method','Memo']; const lines=[csvRow(h),...rows.map(k=>{ const a=agents.find(x=>x.id===k)||{}; return csvRow([agentName(k),a.email||'',pendingByAgent[k].pay.toFixed(2),payMethod,`Commission payout`]); })]; dl(`ROG_payables_${new Date().toISOString().slice(0,10)}.csv`,lines.join('\n')); };
  const setPayoutStatus=async(id,st)=>{ await supabase.from('payouts').update({ status:st, sent_at: st==='sent'?new Date().toISOString():null }).eq('id',id); setPayouts(p=>p.map(x=>x.id===id?{...x,status:st}:x)); };

  // ---------- STATEMENTS ----------
  const stmt=(()=>{ if(!stmtAgent) return null; const es=entries.filter(e=>e.agent_id===stmtAgent); const earned=es.filter(e=>e.entry_type==='agent_payout').reduce((s,e)=>s+Number(e.amount||0),0); const paid=es.filter(e=>e.entry_type==='agent_payout'&&e.status==='paid').reduce((s,e)=>s+Number(e.amount||0),0); const sav=es.filter(e=>e.entry_type==='savings').reduce((s,e)=>s+Number(e.amount||0),0); const ret=es.filter(e=>e.entry_type==='retirement').reduce((s,e)=>s+Number(e.amount||0),0); const psUp=entries.filter(e=>e.counterparty_agent_id===stmtAgent&&e.entry_type==='profit_share_payable').reduce((s,e)=>s+Number(e.amount||0),0); const cd=es.filter(e=>e.entry_type==='company_dollar').reduce((s,e)=>s+Number(e.amount||0),0); return { es, earned, paid, bal:earned-paid, sav, ret, psUp, cd }; })();
  const exportStmt=()=>{ if(!stmt) return; const h=['Date','Type','Direction','Amount','Status','Memo']; const lines=[csvRow(h),...stmt.es.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(e=>csvRow([(e.period||e.created_at?.slice(0,10)||''),e.entry_type,e.direction,Number(e.amount||0).toFixed(2),e.status,e.memo||'']))]; dl(`statement_${agentName(stmtAgent).replace(/\s+/g,'_')}.csv`,lines.join('\n')); };

  // ---------- LEDGER ----------
  const led=entries.filter(e=>(!lf.agent||e.agent_id===lf.agent)&&(!lf.type||e.entry_type===lf.type)&&(!lf.status||e.status===lf.status)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const ledTotal=led.reduce((s,e)=>s+(e.direction==='credit'?1:-1)*(Number(e.amount)||0),0);

  const TYPE_LABEL={ company_dollar:'Company $', agent_payout:'Agent payout', profit_share_payable:'Profit share', savings:'Savings', retirement:'Retirement' };
  const card=(label,val,sub2)=> <div className="panel" style={{padding:'12px'}}><div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div><div style={{fontSize:'18px',fontWeight:800,marginTop:'2px'}}>{val}</div>{sub2&&<div style={{fontSize:'10px',color:'var(--text-3)'}}>{sub2}</div>}</div>;
  const inp={ padding:'6px 9px', fontSize:'13px', width:'auto' };

  return (
    <div style={{marginTop:'12px',display:'grid',gap:'12px'}}>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
        {[['overview','Overview'],['payables','Payables'],['statements','Statements'],['ledger','Ledger']].map(t=>(
          <button key={t[0]} className="btn btn-sm" onClick={()=>setSub(t[0])} style={{background:sub===t[0]?'var(--accent)':'transparent',color:sub===t[0]?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>{t[1]}</button>
        ))}
        {sub==='overview' && <select className="form-input" value={year} onChange={e=>setYear(Number(e.target.value))} style={{...inp,marginLeft:'auto'}}>{[0,1,2,3].map(d=>{ const y=new Date().getFullYear()-d; return <option key={y} value={y}>{y}</option>; })}</select>}
      </div>

      {sub==='overview' && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
          {card('Revenue (company $)',money(revenue),`${year}`)}
          {card('Profit share',money(ps))}
          {card('Net to brokerage',money(net))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
          {card('Owed to agents',money(owedAgents),'pending payout')}
          {card('Profit share owed',money(psOwed),'pending')}
          {card('Escrow held',money(escrow),'savings + retirement')}
        </div>
        <div className="panel" style={{overflowX:'auto',padding:0}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
            <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'8px 10px'}}>Month</th><th style={{padding:'8px 6px',textAlign:'right'}}>Company $</th><th style={{padding:'8px 6px',textAlign:'right'}}>Profit share</th><th style={{padding:'8px 6px',textAlign:'right'}}>Net</th></tr></thead>
            <tbody>
              {months.length===0? <tr><td colSpan={4} style={{padding:'22px',textAlign:'center',color:'var(--text-2)'}}>No posted CDAs for {year}. Generate a CDA on a file and the ledger posts automatically.</td></tr> :
                months.map(m=>{ const r=monthRow(m); return <tr key={m} style={{borderBottom:'1px solid var(--border)'}}><td style={{padding:'7px 10px'}}>{m}</td><td style={{padding:'7px 6px',textAlign:'right'}}>{money(r.cd)}</td><td style={{padding:'7px 6px',textAlign:'right'}}>{money(r.p)}</td><td style={{padding:'7px 6px',textAlign:'right',fontWeight:700}}>{money(r.net)}</td></tr>; })}
            </tbody>
          </table>
        </div>
      </>}

      {sub==='payables' && <>
        <div className="panel" style={{padding:'12px',display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
          <div><div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase'}}>Selected</div><div style={{fontSize:'18px',fontWeight:800}}>{money(selTotal)}</div></div>
          <select className="form-input" value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={inp}><option value="ach">ACH</option><option value="check">Check</option><option value="wire">Wire</option></select>
          {isAdmin && <button className="btn btn-primary btn-sm" disabled={selKeys.length===0} onClick={createPayout}>Create payout ({selKeys.length})</button>}
          <button className="btn btn-ghost btn-sm" onClick={exportACH}><Icon name="dollar" size={13} fb="$"/> Export CSV</button>
        </div>
        <div className="panel" style={{overflowX:'auto',padding:0}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
            <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'8px 10px'}}><input type="checkbox" checked={selKeys.length===payKeys.length&&payKeys.length>0} onChange={e=>{ const ns={}; if(e.target.checked) payKeys.forEach(k=>ns[k]=true); setSel(ns); }}/></th><th style={{padding:'8px 6px'}}>Agent</th><th style={{padding:'8px 6px',textAlign:'right'}}>Owed</th><th style={{padding:'8px 6px',textAlign:'right'}}>Savings held</th><th style={{padding:'8px 6px',textAlign:'right'}}>Retirement</th></tr></thead>
            <tbody>
              {payKeys.length===0? <tr><td colSpan={5} style={{padding:'22px',textAlign:'center',color:'var(--text-2)'}}>Nothing owed. Payables post here when CDAs close.</td></tr> :
                payKeys.map(k=>(<tr key={k} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'7px 10px'}}><input type="checkbox" checked={!!sel[k]} onChange={e=>setSel(s=>({...s,[k]:e.target.checked}))}/></td>
                  <td style={{padding:'7px 6px',fontWeight:600}}>{agentName(k)}</td>
                  <td style={{padding:'7px 6px',textAlign:'right',fontWeight:700}}>{money(pendingByAgent[k].pay)}</td>
                  <td style={{padding:'7px 6px',textAlign:'right',color:'var(--text-2)'}}>{money(pendingByAgent[k].sav)}</td>
                  <td style={{padding:'7px 6px',textAlign:'right',color:'var(--text-2)'}}>{money(pendingByAgent[k].ret)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
        {payouts.length>0 && <div className="panel" style={{padding:'12px'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:'8px'}}>Recent payouts</div>
          <div style={{display:'grid',gap:'6px'}}>
            {payouts.slice(0,12).map(p=>(<div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12.5px',borderBottom:'1px solid var(--border)',paddingBottom:'5px'}}>
              <span>{agentName(p.agent_id)} · <b>{money(p.amount)}</b> · {p.method?.toUpperCase()} · {p.period}</span>
              {isAdmin? <select className="form-input" value={p.status} onChange={e=>setPayoutStatus(p.id,e.target.value)} style={{padding:'3px 6px',fontSize:'11px',width:'auto'}}>{['draft','approved','sent','cleared'].map(s=><option key={s} value={s}>{s}</option>)}</select> : <span>{p.status}</span>}
            </div>))}
          </div>
        </div>}
      </>}

      {sub==='statements' && <>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <select className="form-input" value={stmtAgent} onChange={e=>setStmtAgent(e.target.value)} style={inp}><option value="">Select agent…</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
          {stmt && <button className="btn btn-ghost btn-sm" onClick={exportStmt}>Export CSV</button>}
        </div>
        {!stmt? <div className="panel" style={{padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Pick an agent to view their statement.</div> : <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
            {card('Earned',money(stmt.earned))}{card('Paid',money(stmt.paid))}{card('Balance owed',money(stmt.bal))}{card('Company $ produced',money(stmt.cd))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
            {card('Savings held',money(stmt.sav))}{card('Retirement held',money(stmt.ret))}{card('Profit share (as upline)',money(stmt.psUp))}
          </div>
          <div className="panel" style={{overflowX:'auto',padding:0}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
              <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'7px 10px'}}>Period</th><th style={{padding:'7px 6px'}}>Type</th><th style={{padding:'7px 6px',textAlign:'right'}}>Amount</th><th style={{padding:'7px 6px'}}>Status</th></tr></thead>
              <tbody>{stmt.es.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(e=>(<tr key={e.id} style={{borderBottom:'1px solid var(--border)'}}><td style={{padding:'6px 10px'}}>{e.period||e.created_at?.slice(0,10)}</td><td style={{padding:'6px 6px'}}>{TYPE_LABEL[e.entry_type]||e.entry_type}</td><td style={{padding:'6px 6px',textAlign:'right'}}>{money(e.amount)}</td><td style={{padding:'6px 6px'}}><span style={{fontSize:'10px',padding:'1px 7px',borderRadius:'10px',background:e.status==='paid'?'var(--green)':e.status==='cleared'?'var(--accent)':'var(--bg-hover)',color:e.status==='pending'?'var(--text-2)':'#0a0b0d',fontWeight:700}}>{e.status}</span></td></tr>))}</tbody>
            </table>
          </div>
        </>}
      </>}

      {sub==='ledger' && <>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
          <select className="form-input" value={lf.agent} onChange={e=>setLf({...lf,agent:e.target.value})} style={inp}><option value="">All agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="form-input" value={lf.type} onChange={e=>setLf({...lf,type:e.target.value})} style={inp}><option value="">All types</option>{Object.keys(TYPE_LABEL).map(t=><option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
          <select className="form-input" value={lf.status} onChange={e=>setLf({...lf,status:e.target.value})} style={inp}><option value="">Any status</option>{['pending','cleared','paid','void'].map(s=><option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div className="panel" style={{overflowX:'auto',padding:0}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
            <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'7px 10px'}}>Period</th><th style={{padding:'7px 6px'}}>Agent</th><th style={{padding:'7px 6px'}}>Type</th><th style={{padding:'7px 6px'}}>Dir</th><th style={{padding:'7px 6px',textAlign:'right'}}>Amount</th><th style={{padding:'7px 6px'}}>Status</th></tr></thead>
            <tbody>
              {led.length===0? <tr><td colSpan={6} style={{padding:'22px',textAlign:'center',color:'var(--text-2)'}}>No ledger entries match.</td></tr> :
                led.slice(0,300).map(e=>(<tr key={e.id} style={{borderBottom:'1px solid var(--border)'}}><td style={{padding:'6px 10px'}}>{e.period||e.created_at?.slice(0,10)}</td><td style={{padding:'6px 6px'}}>{agentName(e.agent_id)}</td><td style={{padding:'6px 6px'}}>{TYPE_LABEL[e.entry_type]||e.entry_type}</td><td style={{padding:'6px 6px',color:e.direction==='credit'?'var(--green)':'var(--text-2)'}}>{e.direction==='credit'?'+':'−'}</td><td style={{padding:'6px 6px',textAlign:'right',fontWeight:600}}>{money(e.amount)}</td><td style={{padding:'6px 6px'}}>{e.status}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:'12px',color:'var(--text-2)',textAlign:'right'}}>Net (credits − debits): <b style={{color:'var(--text-1)'}}>{money(ledTotal)}</b> · {led.length} entries</div>
      </>}
    </div>
  );
}
// =================== END ACCOUNTING ===================

export function AgentsView({ userId, user, appCtx, isAdmin }){
  const role = appCtx?.role; const myTeam = appCtx?.team||''; const ownerId = appCtx?.owner_id || userId; const canWrite = isAdmin || !!appCtx?.is_team_leader;
  const roleOpts = isAdmin ? AGENT_ROLES : AGENT_ROLES.filter(r=>['agent','team_leader'].includes(r.value));
  const [agents,setAgents]=useState([]);
  const [loading,setLoading]=useState(true);
  const [openId,setOpenId]=useState(null);
  const [showNew,setShowNew]=useState(false);
  const [nv,setNv]=useState({ name:'', email:'', phone:'', role:'agent', team:'', license_no:'' });
  const [mode,setMode]=useState('roster');
  const [ledger,setLedger]=useState(null);
  const [year,setYear]=useState(new Date().getFullYear());
  const dl=(fn,csv)=>{ const b=new Blob([csv],{type:'text/csv;charset=utf-8'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=fn; a.click(); URL.revokeObjectURL(u); };
  const csvRow=(arr)=>arr.map(v=>{ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',');
  const load=async()=>{ const { data } = await supabase.from('agents').select('*').order('name',{ascending:true}); setAgents(data||[]); setLoading(false); };
  const loadLedger=async()=>{ if(ledger) return; const { data } = await supabase.from('cda_ledger').select('*'); setLedger(data||[]); };
  useEffect(()=>{ load(); },[]);
  useEffect(()=>{ if(mode==='earnings'||mode==='profitshare') loadLedger(); },[mode]);
  const addAgent=async()=>{
    if(!nv.name.trim()){ if(window.__notify) window.__notify('Agent name required.','error'); return; }
    const eff={ role: (!isAdmin && !['agent','team_leader'].includes(nv.role))?'agent':nv.role, team: isAdmin? (nv.team.trim()||null) : (myTeam||null) };
    const { data, error } = await supabase.from('agents').insert({ user_id:ownerId, name:nv.name.trim(), email:nv.email.trim()||null, phone:nv.phone.trim()||null, role:eff.role, team:eff.team, license_no:nv.license_no.trim()||null }).select().single();
    if(error){ if(window.__notify) window.__notify('Could not add: '+error.message,'error'); return; }
    setAgents(p=>[...p,data].sort((a,b)=>(a.name||'').localeCompare(b.name||''))); setShowNew(false); setNv({ name:'', email:'', phone:'', role:'agent', team:'', license_no:'' }); setOpenId(data.id);
  };
  const open = agents.find(a=>a.id===openId)||null;
  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'8px'}}><Icon name="users" size={20}/> Brokerage</h2>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>Agents, roles & pay plans</div>
        </div>
        {canWrite && mode==='roster' && <button className="btn btn-primary" onClick={()=>setShowNew(true)}>+ Add agent</button>}
      </div>
      <div className="brokerage-subnav">
        <button className="btn btn-sm" onClick={()=>setMode('roster')} style={{background:mode==='roster'?'var(--accent)':'transparent',color:mode==='roster'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Roster</button>
        <button className="btn btn-sm" onClick={()=>setMode('earnings')} style={{background:mode==='earnings'?'var(--accent)':'transparent',color:mode==='earnings'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Earnings</button>
        {isAdmin && <button className="btn btn-sm" onClick={()=>setMode('profitshare')} style={{background:mode==='profitshare'?'var(--accent)':'transparent',color:mode==='profitshare'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Profit share</button>}
        <button className="btn btn-sm" onClick={()=>setMode('leads')} style={{background:mode==='leads'?'var(--accent)':'transparent',color:mode==='leads'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Leads</button>
        <button className="btn btn-sm" onClick={()=>setMode('conversion')} style={{background:mode==='conversion'?'var(--accent)':'transparent',color:mode==='conversion'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Conversion</button>
        {isAdmin && <button className="btn btn-sm" onClick={()=>setMode('accounting')} style={{background:mode==='accounting'?'var(--accent)':'transparent',color:mode==='accounting'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>Accounting</button>}
        {isAdmin && <button className="btn btn-sm" onClick={()=>setMode('aireports')} style={{background:mode==='aireports'?'var(--accent)':'transparent',color:mode==='aireports'?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:600}}>AI Reports</button>}
        {(mode==='earnings'||mode==='profitshare') && <select className="form-input" value={year} onChange={e=>setYear(Number(e.target.value))} style={{width:'auto',marginLeft:'auto',padding:'4px 8px'}}>{[0,1,2,3].map(d=>{ const y=new Date().getFullYear()-d; return <option key={y} value={y}>{y}</option>; })}</select>}
      </div>
      {mode==='leads' && <LeadsBoard userId={userId} ownerId={ownerId} agents={agents} canWrite={canWrite} isAdmin={isAdmin} myTeam={myTeam}/>}
      {mode==='conversion' && <ConversionDashboard userId={userId} agents={agents}/>}
      {mode==='accounting' && <AccountingView userId={userId} ownerId={ownerId} agents={agents} isAdmin={isAdmin}/>}
      {mode==='aireports' && isAdmin && <AiUsageReportsPanel />}
      {mode==='earnings' && (()=>{
        if(!ledger) return <div className="panel" style={{marginTop:'12px',color:'var(--text-2)'}}>Loading earnings…</div>;
        const rows=ledger.filter(r=>new Date(r.closed_on||r.created_at).getFullYear()===year);
        const byA={}; for(const r of rows){ const k=r.agent_id||'—'; (byA[k]=byA[k]||{deals:0,gci:0,gross:0,net:0,co:0,ps:0,sav:0,ret:0}); byA[k].deals++; byA[k].gci+=Number(r.our_gci)||0; byA[k].gross+=Number(r.agent_gross)||0; byA[k].net+=Number(r.agent_cash)||0; byA[k].co+=Number(r.company_dollar)||0; byA[k].ps+=Number(r.profit_share)||0; byA[k].sav+=Number(r.savings)||0; byA[k].ret+=Number(r.retirement)||0; }
        const agOf=(id)=>agents.find(x=>x.id===id)||{}; const nameOf=(id)=>agOf(id).name||'Unassigned';
        const tot=Object.values(byA).reduce((s,v)=>({deals:s.deals+v.deals,gci:s.gci+v.gci,net:s.net+v.net,co:s.co+v.co,ps:s.ps+v.ps}),{deals:0,gci:0,net:0,co:0,ps:0});
        const keys=Object.keys(byA).sort((a,b)=>byA[b].gci-byA[a].gci);
        const export1099=()=>{ const h=['Agent','Email','License','Files','GCI','Agent gross','Net cash paid','Company dollar','Savings','Retirement','Profit share']; const lines=[csvRow(h),...keys.map(k=>{ const v=byA[k],a=agOf(k); return csvRow([nameOf(k),a.email||'',a.license_no||'',v.deals,v.gci.toFixed(2),v.gross.toFixed(2),v.net.toFixed(2),v.co.toFixed(2),v.sav.toFixed(2),v.ret.toFixed(2),v.ps.toFixed(2)]); })]; dl(`ROG_1099_summary_${year}.csv`,lines.join('\n')); };
        const exportACH=()=>{ const h=['Payee','Email','Amount','Memo']; const lines=[csvRow(h),...keys.filter(k=>byA[k].net>0).map(k=>{ const v=byA[k],a=agOf(k); return csvRow([nameOf(k),a.email||'',v.net.toFixed(2),`Commission ${year} (${v.deals} deals)`]); })]; dl(`ROG_payments_${year}.csv`,lines.join('\n')); };
        return (
          <div style={{marginTop:'12px',display:'grid',gap:'10px'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
              {[['Files',tot.deals],['GCI to ROG',money(tot.gci)],['Company dollar',money(tot.co)],['Profit share owed',money(tot.ps)]].map((c,i)=>(
                <div key={i} className="panel" style={{padding:'12px'}}><div style={{fontSize:'11px',color:'var(--text-3)'}}>{c[0]}</div><div style={{fontSize:'17px',fontWeight:800}}>{c[1]}</div></div>
              ))}
            </div>
            {keys.length===0 ? <div className="panel" style={{textAlign:'center',color:'var(--text-2)',padding:'24px'}}>No closed CDAs recorded for {year}. Generate a CDA on a file and it'll show here.</div> : <>
            {isAdmin && <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}><button className="btn btn-ghost btn-sm" onClick={export1099}><Icon name="dollar" size={13}/> Export 1099 summary (CSV)</button><button className="btn btn-ghost btn-sm" onClick={exportACH}>Export payments / ACH (CSV)</button></div>}
            <div className="panel" style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'6px'}}>Agent</th><th style={{padding:'6px'}}>Files</th><th style={{padding:'6px',textAlign:'right'}}>GCI</th><th style={{padding:'6px',textAlign:'right'}}>Net cash</th><th style={{padding:'6px',textAlign:'right'}}>Company $</th><th style={{padding:'6px',textAlign:'right'}}>Savings/Ret</th><th style={{padding:'6px',textAlign:'right'}}>Profit share</th></tr></thead>
                <tbody>
                  {keys.map(k=>{ const v=byA[k]; return <tr key={k} style={{borderBottom:'1px solid var(--border)'}}><td style={{padding:'6px',fontWeight:600}}>{nameOf(k)}</td><td style={{padding:'6px'}}>{v.deals}</td><td style={{padding:'6px',textAlign:'right'}}>{money(v.gci)}</td><td style={{padding:'6px',textAlign:'right'}}>{money(v.net)}</td><td style={{padding:'6px',textAlign:'right'}}>{money(v.co)}</td><td style={{padding:'6px',textAlign:'right',color:'var(--text-3)'}}>{money(v.sav+v.ret)}</td><td style={{padding:'6px',textAlign:'right'}}>{money(v.ps)}</td></tr>; })}
                </tbody>
              </table>
            </div>
            {isAdmin && <div style={{fontSize:'11px',color:'var(--text-3)'}}>1099 reporting basis (gross vs. net) should be confirmed with your CPA before filing.</div>}
            </>}
          </div>
        );
      })()}
      {mode==='profitshare' && isAdmin && (()=>{
        if(!ledger) return <div className="panel" style={{marginTop:'12px',color:'var(--text-2)'}}>Loading…</div>;
        const rows=ledger.filter(r=>new Date(r.closed_on||r.created_at).getFullYear()===year && (Number(r.profit_share)||0)>0);
        const byU={}; for(const r of rows){ const ag=agents.find(x=>x.id===r.agent_id); const up=ag?.upline_id; if(!up) continue; (byU[up]=byU[up]||{owed:0,deals:0,from:new Set()}); byU[up].owed+=Number(r.profit_share)||0; byU[up].deals++; byU[up].from.add(ag?.name||''); }
        const nameOf=(id)=>agents.find(x=>x.id===id)?.name||'—';
        const keys=Object.keys(byU).sort((a,b)=>byU[b].owed-byU[a].owed);
        const totalOwed=keys.reduce((s,k)=>s+byU[k].owed,0);
        const unassigned=rows.filter(r=>{ const ag=agents.find(x=>x.id===r.agent_id); return !ag?.upline_id; }).reduce((s,r)=>s+(Number(r.profit_share)||0),0);
        const exportPS=()=>{ const h=['Upline','Email','Contributing files','Profit share owed']; const lines=[csvRow(h),...keys.map(k=>{ const a=agents.find(x=>x.id===k)||{}; return csvRow([nameOf(k),a.email||'',byU[k].deals,byU[k].owed.toFixed(2)]); })]; dl(`ROG_profit_share_${year}.csv`,lines.join('\n')); };
        return (
          <div style={{marginTop:'12px',display:'grid',gap:'10px'}}>
            <div className="panel" style={{padding:'12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:'11px',color:'var(--text-3)'}}>Total profit share owed to uplines · {year}</div><div style={{fontSize:'20px',fontWeight:800}}>{money(totalOwed)}</div></div>
              {keys.length>0 && <button className="btn btn-ghost btn-sm" onClick={exportPS}>Export (CSV)</button>}
            </div>
            {keys.length===0 ? <div className="panel" style={{textAlign:'center',color:'var(--text-2)',padding:'24px'}}>No profit share recorded for {year}. Set an agent's upline and a profit-share % in their pay plan.</div> :
            <div className="panel" style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                <thead><tr style={{textAlign:'left',color:'var(--text-3)',borderBottom:'1px solid var(--border)'}}><th style={{padding:'6px'}}>Upline (paid to)</th><th style={{padding:'6px'}}>Files</th><th style={{padding:'6px'}}>From</th><th style={{padding:'6px',textAlign:'right'}}>Owed</th></tr></thead>
                <tbody>
                  {keys.map(k=><tr key={k} style={{borderBottom:'1px solid var(--border)'}}><td style={{padding:'6px',fontWeight:600}}>{nameOf(k)}</td><td style={{padding:'6px'}}>{byU[k].deals}</td><td style={{padding:'6px',color:'var(--text-2)'}}>{[...byU[k].from].filter(Boolean).join(', ')}</td><td style={{padding:'6px',textAlign:'right',fontWeight:700}}>{money(byU[k].owed)}</td></tr>)}
                </tbody>
              </table>
            </div>}
            {unassigned>0 && <div style={{fontSize:'11px',color:'var(--yellow)'}}>{money(unassigned)} in profit share was computed on deals whose agent has no upline set — assign uplines to route it.</div>}
            <div style={{fontSize:'11px',color:'var(--text-3)'}}>Internal only — profit share is never shown on the CDA.</div>
          </div>
        );
      })()}
      {mode==='roster' && <>
      {showNew && (
        <div className="panel" style={{display:'grid',gap:'8px',marginTop:'12px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <label className="form-label">Name<input className="form-input" value={nv.name} onChange={e=>setNv({...nv,name:e.target.value})}/></label>
            <label className="form-label">Role<select className="form-input" value={nv.role} onChange={e=>setNv({...nv,role:e.target.value})}>{roleOpts.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
            <label className="form-label">Email<input className="form-input" value={nv.email} onChange={e=>setNv({...nv,email:e.target.value})}/></label>
            <label className="form-label">Phone<input className="form-input" value={nv.phone} onChange={e=>setNv({...nv,phone:e.target.value})}/></label>
            <label className="form-label">Team<input className="form-input" value={isAdmin? nv.team : myTeam} onChange={e=>setNv({...nv,team:e.target.value})} disabled={!isAdmin}/></label>
            <label className="form-label">License #<input className="form-input" value={nv.license_no} onChange={e=>setNv({...nv,license_no:e.target.value})}/></label>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:'8px'}}><button className="btn btn-ghost btn-sm" onClick={()=>setShowNew(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={addAgent}>Add</button></div>
        </div>
      )}
      {loading? <div className="panel" style={{marginTop:'12px',color:'var(--text-2)'}}>Loading…</div> :
        agents.length===0 ? <div className="panel" style={{marginTop:'12px',textAlign:'center',color:'var(--text-2)',padding:'24px'}}>No agents yet. Add your first agent to build their pay plan.</div> :
        <div style={{display:'grid',gap:'8px',marginTop:'12px'}}>
          {agents.map(a=>(
            <div key={a.id} className="panel" onClick={()=>setOpenId(a.id)} style={{cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontWeight:700}}>{a.name}{!a.active&&<span style={{fontSize:'10px',color:'var(--text-3)'}}> · inactive</span>}</div><div style={{fontSize:'12px',color:'var(--text-2)'}}>{ROLE_LABEL[a.role]}{a.team?` · ${a.team}`:''}{a.email?` · ${a.email}`:''}</div></div>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
                {a.auth_user_id ? <span style={{fontSize:'10px',fontWeight:700,color:'var(--green)'}}>● linked</span> : <span style={{fontSize:'10px',fontWeight:700,color:'var(--text-3)'}}>○ no login</span>}
                <Icon name="chevron-right" size={16} fb="›"/>
              </div>
            </div>
          ))}
        </div>}
      </>}
      {open && <AgentEditor agent={open} agents={agents} userId={userId} isAdmin={isAdmin} canWrite={canWrite} roleOpts={roleOpts} myTeam={myTeam} onClose={()=>setOpenId(null)} onSaved={(u)=>setAgents(p=>p.map(x=>x.id===u.id?u:x))} onDeleted={(id)=>{ setAgents(p=>p.filter(x=>x.id!==id)); setOpenId(null); }}/>}
    </div>
  );
}
