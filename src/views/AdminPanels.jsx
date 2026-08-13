// Admin panels — teams, contact types, and the team roster view.
// Extracted from App.js (strangle the monolith, step 25).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { lbl } from '../helpers';
import { Icon } from '../icons';
import { notify } from '../notify';

export function TeamsAdmin({ userId }) {
  const [teams, setTeams] = React.useState([]);
  const [candidates, setCandidates] = React.useState([]);
  const [newName, setNewName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [addSel, setAddSel] = React.useState({});

  const load = React.useCallback(async () => {
    try {
      const [{ data: rows }, { data: cands }] = await Promise.all([
        supabase.rpc('admin_teams'),
        supabase.rpc('admin_agent_candidates'),
      ]);
      const byTeam = {};
      (rows || []).forEach(r => {
        if (!byTeam[r.team_id]) byTeam[r.team_id] = { id: r.team_id, name: r.team_name, members: [] };
        if (r.member_user_id) byTeam[r.team_id].members.push({ user_id: r.member_user_id, name: r.member_name, email: r.member_email, role: r.member_role });
      });
      setTeams(Object.values(byTeam));
      setCandidates(Array.isArray(cands) ? cands : []);
    } catch (_) { setTeams([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function createTeam() {
    if (!newName.trim()) { setMsg('Enter a team name.'); return; }
    setBusy(true); setMsg('');
    const { error } = await supabase.rpc('admin_create_team', { p_name: newName.trim() });
    if (error) { setMsg('Error: ' + error.message); setBusy(false); return; }
    setNewName(''); setBusy(false); load();
  }
  async function renameTeam(t) { const name = window.prompt('Rename team', t.name); if (name == null) return; { const { error } = await supabase.rpc('admin_rename_team', { p_team: t.id, p_name: name }); if (error) { if (window.__notify) window.__notify('Could not rename team: ' + (error.message || error), 'error'); return; } } load(); }
  async function deleteTeam(t) { if (!window.confirm('Delete "' + t.name + '"? Members are removed and any announcements sent only to this team are deleted.')) return; { const { error } = await supabase.rpc('admin_delete_team', { p_team: t.id }); if (error) { if (window.__notify) window.__notify('Could not delete team: ' + (error.message || error), 'error'); return; } } load(); }
  async function addMember(t) { const sel = addSel[t.id] || {}; if (!sel.user) { setMsg('Pick someone to add.'); return; } try { await supabase.rpc('admin_add_member', { p_team: t.id, p_user: sel.user, p_role: sel.role || 'member' }); } catch (_) {} setAddSel(s => ({ ...s, [t.id]: { user: '', role: 'member' } })); load(); }
  async function setRole(t, m, role) { try { await supabase.rpc('admin_set_member_role', { p_team: t.id, p_user: m.user_id, p_role: role }); } catch (_) {} load(); }
  async function removeMember(t, m) { try { await supabase.rpc('admin_remove_member', { p_team: t.id, p_user: m.user_id }); } catch (_) {} load(); }

  const sbtn = { fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' };

  return (
    <div>
      <div className="page-header"><h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span>👥</span>Teams</h2><p>Create teams, name a leader, and add members. Team leaders can post announcements to their team; owners/admins can target any team.</p></div>
      <div style={{ maxWidth: '680px' }}>
        <div className="panel" style={{ marginBottom: '18px' }}>
          <div className="panel-header"><h3>New team</h3></div>
          <div className="panel-body">
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Team name (e.g., Downtown Team)" style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={busy} onClick={createTeam}>{busy ? '…' : 'Create'}</button>
            </div>
            {msg && <div style={{ fontSize: '12.5px', marginTop: '8px', color: msg.startsWith('Error') ? 'var(--red)' : 'var(--text-2)' }}>{msg}</div>}
          </div>
        </div>
        {teams.length === 0 && <div className="panel"><div className="panel-body"><div style={{ fontSize: '13px', color: 'var(--text-3)' }}>No teams yet. Create one above.</div></div></div>}
        {teams.map(t => {
          const memberIds = new Set(t.members.map(m => m.user_id));
          const avail = candidates.filter(c => !memberIds.has(c.user_id));
          const sel = addSel[t.id] || { user: '', role: 'member' };
          return (
            <div key={t.id} className="panel" style={{ marginBottom: '14px' }}>
              <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0 }}>{t.name}</h3>
                <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{t.members.length} member{t.members.length === 1 ? '' : 's'}</span>
                <button onClick={() => renameTeam(t)} style={{ ...sbtn, marginLeft: 'auto' }}>Rename</button>
                <button onClick={() => deleteTeam(t)} style={{ ...sbtn, color: 'var(--red)' }}>Delete</button>
              </div>
              <div className="panel-body">
                {t.members.length === 0 && <div style={{ fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px' }}>No members yet.</div>}
                {t.members.map(m => (
                  <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13.5px', color: 'var(--text-1)', fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-3)' }}>{m.email}</div>
                    </div>
                    <select className="form-input" value={m.role} onChange={e => setRole(t, m, e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}>
                      <option value="leader">Leader</option>
                      <option value="member">Member</option>
                      {m.role === 'admin' && <option value="admin">Admin</option>}
                      {m.role === 'owner' && <option value="owner">Owner</option>}
                    </select>
                    <button onClick={() => removeMember(t, m)} style={{ ...sbtn, color: 'var(--red)' }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="form-input" value={sel.user} onChange={e => setAddSel(s => ({ ...s, [t.id]: { ...sel, user: e.target.value } }))} style={{ flex: '1 1 180px', padding: '6px 8px', fontSize: '13px' }}>
                    <option value="">Add a person…</option>
                    {avail.map(c => <option key={c.user_id} value={c.user_id}>{c.name}{c.email ? ' (' + c.email + ')' : ''}</option>)}
                  </select>
                  <select className="form-input" value={sel.role || 'member'} onChange={e => setAddSel(s => ({ ...s, [t.id]: { ...sel, role: e.target.value } }))} style={{ width: 'auto', padding: '6px 8px', fontSize: '13px' }}>
                    <option value="member">Member</option>
                    <option value="leader">Leader</option>
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={() => addMember(t)} disabled={!sel.user}>Add</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── "Act as user" (impersonation) ────────────────────────────
// A calm connection-health banner. When the backend is unreachable it shows a
// quiet "reconnecting" strip instead of letting raw errors surface, and it
// clears itself the moment the connection returns — so an outage feels like a
// brief pause, not a crash. Deliberately understated: no red, no alarm.

export function ContactTypesAdmin({ isPrivileged }){
  const [rows,setRows]=useState(null);
  const [busy,setBusy]=useState(false);
  const [editId,setEditId]=useState(null);
  const [draft,setDraft]=useState({});
  const [delId,setDelId]=useState(null);
  const [adding,setAdding]=useState(false);
  const [pstats,setPstats]=useState(null);
  const [nl,setNl]=useState(''); const [ni,setNi]=useState('🏷️'); const [nc,setNc]=useState('Clients & Leads'); const [nr,setNr]=useState(false);
  const EMOJI=['🏷️','🏠','🏬','🔑','🌱','⭐','📈','🌟','🧑‍💻','🎯','🏦','⚖️','🛠️','🩺','👨‍👩‍👧','💛','🔧','💎','🔥','📌','🏆','🌐'];
  const lb={background:'none',border:'none',color:'var(--text-2)',fontSize:11.5,fontWeight:600,cursor:'pointer',padding:0};
  const load=async()=>{ try{ const { data } = await supabase.from('contact_types').select('*').is('owner_user_id', null).order('sort_order'); setRows(data||[]); }catch(e){ setRows([]); } try{ const { data:ps } = await supabase.rpc('personal_contact_type_stats'); setPstats(Array.isArray(ps)?ps[0]:ps); }catch(_e){} };
  useEffect(()=>{ load(); },[]);
  if(!isPrivileged) return (<div className="view"><div className="panel" style={{padding:20,color:'var(--text-2)',fontSize:13}}>Only owners, broker admins, and team leaders can manage contact types.</div></div>);
  if(rows===null) return (<div className="view"><div className="panel" style={{padding:24,textAlign:'center',color:'var(--text-2)'}}>Loading types…</div></div>);
  const cats=[]; const seen={}; rows.forEach(r=>{ if(!seen[r.category]){seen[r.category]={cat:r.category,items:[]};cats.push(seen[r.category]);} seen[r.category].items.push(r); });
  const catNames=[...new Set(rows.map(r=>r.category))];
  const addType=async()=>{ const lbl=nl.trim(); if(!lbl) return; setBusy(true); try{ const maxo=Math.max(0,...rows.map(r=>r.sort_order||0)); const id='gt_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); const { error }=await supabase.from('contact_types').insert({ id, label:lbl, icon:ni||'🏷️', category:(nc||'Other').trim(), sort_order:maxo+10, visibility_class:nr?'restricted':'standard', owner_user_id:null, is_active:true }); if(error) throw error; setNl(''); setNi('🏷️'); setNr(false); setAdding(false); await load(); notify('Type added','success'); }catch(e){ notify('Could not add type','error'); } setBusy(false); };
  const startEdit=(r)=>{ setEditId(r.id); setDelId(null); setDraft({ label:r.label, icon:r.icon||'🏷️', category:r.category, restricted:r.visibility_class==='restricted' }); };
  const saveEdit=async(r)=>{ const lbl=(draft.label||'').trim(); if(!lbl) return; setBusy(true); try{ const { error }=await supabase.from('contact_types').update({ label:lbl, icon:draft.icon||'🏷️', category:(draft.category||'Other').trim(), visibility_class:draft.restricted?'restricted':'standard' }).eq('id', r.id); if(error) throw error; setEditId(null); await load(); notify('Saved','success'); }catch(e){ notify('Could not save','error'); } setBusy(false); };
  const toggleRestricted=async(r)=>{ setBusy(true); try{ await supabase.from('contact_types').update({ visibility_class: r.visibility_class==='restricted'?'standard':'restricted' }).eq('id', r.id); await load(); }catch(e){ notify('Could not update','error'); } setBusy(false); };
  const toggleActive=async(r)=>{ setBusy(true); try{ await supabase.from('contact_types').update({ is_active:!r.is_active }).eq('id', r.id); await load(); }catch(e){ notify('Could not update','error'); } setBusy(false); };
  const move=async(items,idx,dir)=>{ const a=items[idx], b=items[idx+dir]; if(!a||!b) return; setBusy(true); try{ await supabase.from('contact_types').update({ sort_order:b.sort_order }).eq('id',a.id); await supabase.from('contact_types').update({ sort_order:a.sort_order }).eq('id',b.id); await load(); }catch(e){} setBusy(false); };
  const del=async(r)=>{ setBusy(true); try{ const { error }=await supabase.from('contact_types').delete().eq('id', r.id); if(error) throw error; setDelId(null); await load(); notify('Deleted','success'); }catch(e){ notify('Could not delete — it may be in use','error'); } setBusy(false); };
  return (<div className="view">
    <div className="panel" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:42,height:42,borderRadius:12,background:'var(--accent-glow)',border:'1px solid var(--accent)',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="clipboard" size={20} style={{color:'var(--accent)'}}/></div>
        <div><h2 style={{margin:0}}>Contact types</h2><div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>Add, rename, reorder, and set the class of brokerage-wide types</div></div>
      </div>
      {!adding && <button className="btn btn-primary btn-sm" onClick={()=>setAdding(true)}>+ Add</button>}
    </div>
    <div className="panel" style={{marginTop:12,padding:16}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:11}}>Type classes</div>
      <div style={{display:'flex',flexDirection:'column',gap:11}}>
        <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{flexShrink:0,fontSize:10.5,fontWeight:700,borderRadius:999,padding:'3px 9px',whiteSpace:'nowrap',background:'var(--bg-base)',border:'1px solid var(--border)',color:'var(--text-2)'}}>🏢 Brokerage-wide</span>
          <span style={{fontSize:12,color:'var(--text-2)',flex:1,lineHeight:1.45}}>The brokerage standard. Available to <strong>everyone</strong> in the company.</span>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{flexShrink:0,fontSize:10.5,fontWeight:700,borderRadius:999,padding:'3px 9px',whiteSpace:'nowrap',background:'rgba(178,58,58,0.12)',border:'1px solid #B23A3A',color:'#d77'}}>🔒 Leadership-only</span>
          <span style={{fontSize:12,color:'var(--text-2)',flex:1,lineHeight:1.45}}>Restricted. Only <strong>owners, broker admins &amp; team leaders</strong> can see, choose, or open contacts of this type.</span>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{flexShrink:0,fontSize:10.5,fontWeight:700,borderRadius:999,padding:'3px 9px',whiteSpace:'nowrap',background:'rgba(74,111,176,0.12)',border:'1px solid #4a6fb0',color:'#9bb8e6'}}>👤 Personal</span>
          <span style={{fontSize:12,color:'var(--text-2)',flex:1,lineHeight:1.45}}>Made by an <strong>individual agent</strong> for their own use — private to them and not listed here.{pstats && pstats.total>0 ? (' Agents have created '+pstats.total+' personal type'+(pstats.total===1?'':'s')+' so far.') : ''}</span>
        </div>
      </div>
    </div>
    {adding && <div className="panel" style={{marginTop:12,padding:16}}>
      <div style={{fontSize:12,fontWeight:700,color:'var(--text-1)',marginBottom:10}}>New type</div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:9}}>{EMOJI.map(e=>(<button key={e} type="button" onClick={()=>setNi(e)} style={{fontSize:16,padding:'4px 7px',borderRadius:8,cursor:'pointer',background:ni===e?'var(--accent-glow)':'transparent',border:'1px solid '+(ni===e?'var(--accent)':'var(--border)')}}>{e}</button>))}</div>
      <input className="form-input" value={nl} onChange={e=>setNl(e.target.value)} placeholder="Type name (e.g. Relocation Buyer)" style={{margin:'0 0 8px'}}/>
      <input className="form-input" list="ctcats" value={nc} onChange={e=>setNc(e.target.value)} placeholder="Category" style={{margin:'0 0 8px'}}/>
      <datalist id="ctcats">{catNames.map(c=><option key={c} value={c}/>)}</datalist>
      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12.5,color:'var(--text-2)',marginBottom:12,cursor:'pointer'}}><input type="checkbox" checked={nr} onChange={e=>setNr(e.target.checked)} style={{accentColor:'var(--accent)'}}/> 🔒 Restricted — owners, broker admins &amp; team leaders only</label>
      <div style={{display:'flex',gap:8}}><button className="btn btn-primary btn-sm" disabled={busy||!nl.trim()} onClick={addType}>Add type</button><button className="btn btn-ghost btn-sm" onClick={()=>{setAdding(false);setNl('');}}>Cancel</button></div>
    </div>}
    {cats.map(g=>(<div key={g.cat} className="panel" style={{marginTop:12,padding:16}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:8}}>{g.cat}</div>
      {g.items.map((r,idx)=>{ const isEd=editId===r.id; const restricted=r.visibility_class==='restricted'; return (
        <div key={r.id} style={{borderBottom:'1px solid var(--border)',padding:'10px 0'}}>
          {isEd ? (<div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>{EMOJI.map(e=>(<button key={e} type="button" onClick={()=>setDraft(d=>({...d,icon:e}))} style={{fontSize:15,padding:'3px 6px',borderRadius:7,cursor:'pointer',background:draft.icon===e?'var(--accent-glow)':'transparent',border:'1px solid '+(draft.icon===e?'var(--accent)':'var(--border)')}}>{e}</button>))}</div>
            <input className="form-input" value={draft.label} onChange={e=>setDraft(d=>({...d,label:e.target.value}))} style={{margin:'0 0 8px'}}/>
            <input className="form-input" list="ctcats" value={draft.category} onChange={e=>setDraft(d=>({...d,category:e.target.value}))} style={{margin:'0 0 8px'}}/>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12.5,color:'var(--text-2)',marginBottom:10,cursor:'pointer'}}><input type="checkbox" checked={!!draft.restricted} onChange={e=>setDraft(d=>({...d,restricted:e.target.checked}))} style={{accentColor:'var(--accent)'}}/> 🔒 Restricted</label>
            <div style={{display:'flex',gap:8}}><button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>saveEdit(r)}>Save</button><button className="btn btn-ghost btn-sm" onClick={()=>setEditId(null)}>Cancel</button></div>
          </div>) : (<div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                <button type="button" onClick={()=>move(g.items,idx,-1)} disabled={idx===0||busy} style={{...lb,color:idx===0?'var(--text-3)':'var(--text-2)',fontSize:10}}>▲</button>
                <button type="button" onClick={()=>move(g.items,idx,1)} disabled={idx===g.items.length-1||busy} style={{...lb,color:idx===g.items.length-1?'var(--text-3)':'var(--text-2)',fontSize:10}}>▼</button>
              </div>
              <span style={{fontSize:18}}>{r.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:600,color:r.is_active?'var(--text-1)':'var(--text-3)'}}>{r.label}{!r.is_active && <span style={{fontSize:10,color:'var(--text-3)',fontWeight:500}}> · hidden</span>}</div>
                <div style={{fontSize:10,color:'var(--text-3)',marginTop:1,fontFamily:'monospace'}}>{r.id}</div>
              </div>
              <button type="button" onClick={()=>toggleRestricted(r)} title="Tap to change class" style={{flexShrink:0,fontSize:10.5,fontWeight:700,borderRadius:999,padding:'3px 9px',cursor:'pointer',background:restricted?'rgba(178,58,58,0.12)':'var(--bg-base)',border:'1px solid '+(restricted?'#B23A3A':'var(--border)'),color:restricted?'#d77':'var(--text-2)'}}>{restricted?'🔒 Leadership-only':'🏢 Brokerage-wide'}</button>
            </div>
            <div style={{display:'flex',gap:16,marginTop:7,marginLeft:26}}>
              <button type="button" style={lb} onClick={()=>startEdit(r)}>Edit</button>
              <button type="button" style={lb} onClick={()=>toggleActive(r)}>{r.is_active?'Hide':'Show'}</button>
              {delId===r.id
                ? <span style={{fontSize:11.5,color:'var(--text-2)'}}>Delete? <button type="button" style={{...lb,color:'#f06b6b'}} onClick={()=>del(r)}>Yes</button> · <button type="button" style={lb} onClick={()=>setDelId(null)}>No</button></span>
                : <button type="button" style={{...lb,color:'#d77'}} onClick={()=>setDelId(r.id)}>Delete</button>}
            </div>
          </div>)}
        </div>); })}
    </div>))}
    <div style={{fontSize:11,color:'var(--text-3)',margin:'14px 4px 0',lineHeight:1.5}}>Changes are brokerage-wide and take effect immediately. Toggling 🔒 Restricted updates visibility for existing contacts of that type. Agents&apos; own private types are managed by each agent and aren&apos;t shown here.</div>
  </div>);
}

export function TeamView(){
  const [team,setTeam]=useState(undefined);
  useEffect(()=>{ (async()=>{ try{ const { data } = await supabase.rpc('get_my_team'); setTeam(data||null); }catch(e){ setTeam(null); } })(); },[]);
  const TYPE_LABELS={our_agent:'Our agents',recruit:'Recruits',vendor:'Vendors',lead:'Leads',client:'Clients',partner:'Partners',family:'Family',personal:'Personal'};
  if(team===undefined) return (<div className="view"><div className="panel" style={{padding:24,textAlign:'center',color:'var(--text-2)'}}>Loading team…</div></div>);
  if(!team) return (<div className="view"><div className="panel" style={{padding:20,color:'var(--text-2)',fontSize:13}}>You are not on a team yet.</div></div>);
  const roleMeta=(r)=> r==='owner'?{t:'Owner',c:'var(--accent)'}:r==='admin'?{t:'Admin',c:'#8b5cf6'}:{t:'Member',c:'var(--text-3)'};
  const ruleText=(r)=>{ if(r.resource_type==='contacts'){ const ty=r.match&&r.match.type; return ty?('Contacts tagged “'+(TYPE_LABELS[ty]||ty)+'”'):'All contacts'; } return r.resource_type; };
  return (<div className="view">
    <div className="panel" style={{display:'flex',alignItems:'center',gap:12}}>
      <div style={{width:42,height:42,borderRadius:12,background:'var(--accent-glow)',border:'1px solid var(--accent)',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name="users" size={20} style={{color:'var(--accent)'}}/></div>
      <div><h2 style={{margin:0}}>{team.name}</h2><div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>Shared workspace for your brokerage team</div></div>
    </div>
    <div className="panel" style={{marginTop:12,padding:16}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:8,display:'inline-flex',alignItems:'center',gap:8}}><Icon name="users" size={15} style={{color:'var(--accent)'}}/> Members ({team.members.length})</div>
      {team.members.map(m=>{ const rm=roleMeta(m.role); return (
        <div key={m.auth_user_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
          <span style={{fontSize:13.5,fontWeight:600,color:'var(--text-1)'}}>{m.name}</span>
          <span style={{fontSize:10.5,fontWeight:700,color:rm.c,border:'1px solid '+rm.c,borderRadius:999,padding:'2px 9px'}}>{rm.t}</span>
        </div>); })}
    </div>
    <div className="panel" style={{marginTop:12,padding:16}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:8,display:'inline-flex',alignItems:'center',gap:8}}><Icon name="signal" size={15} style={{color:'var(--accent)'}}/> What's shared with the team</div>
      {(team.rules||[]).length===0 ? <div style={{fontSize:12.5,color:'var(--text-3)'}}>Nothing shared yet.</div> :
        team.rules.map((r,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
            <div><div style={{fontSize:13,fontWeight:600,color:'var(--text-1)'}}>{ruleText(r)}</div><div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>Visible to all {team.members.length} members, on every device</div></div>
            <span style={{fontSize:15,fontWeight:800,color:'var(--accent)'}}>{(team.shared_counts&&team.shared_counts[r.resource_type])||0}</span>
          </div>))
      }
      <div style={{fontSize:11,color:'var(--text-3)',marginTop:12,lineHeight:1.5}}>More shared resources (vendors, listings, company leads, documents, templates) can be added to this team as we build them.</div>
    </div>
  </div>);
}
