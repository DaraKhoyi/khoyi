// Files — the file browser, its detail modal and the intake card.
// Extracted from App.js (strangle the monolith, step 25).
import React, { useEffect, useMemo, useState } from 'react';
import { useBackClose } from '../backClose';
import { supabase } from '../dataService';
import { DOCTYPE_LABEL, DOCTYPE_TO_ITEM, FARBAR_BUYER_CHECKLIST, FILE_DOC_TYPES, FILE_STATUSES, StatusPill, WAIVER_TO_KIND, generateDeadlinesFromTerms, logFileEvent, resolveDeadlineWaiver, shortDate } from '../fileDomain';
import { modal, money } from '../helpers';
import { Icon } from '../icons';
import FileDetailModal from '../views/FileDetailModal';

export function FilesView({ files, setFiles, contacts, setContacts, properties, userId, user, isAdmin:isAdminProp }){
  const [showNew,setShowNew]=useState(false);
  const [openId,setOpenId]=useState(null);
  const [statusFilter,setStatusFilter]=useState('all');
  const [progress,setProgress]=useState({});
  // Role, not identity. The old email fallback made this owner-only regardless of
  // what agents.role said. When the prop is absent, assume not admin.
  const isAdmin = isAdminProp !== undefined ? !!isAdminProp : false;
  const buyerFiles = useMemo(()=> (files||[]).filter(f=>f.side==='buyer'), [files]);
  const idsKey = buyerFiles.map(f=>f.id).join(',');

  useEffect(()=>{ let alive=true; (async()=>{
    const ids = idsKey? idsKey.split(',') : [];
    if(!ids.length){ setProgress({}); return; }
    const { data } = await supabase.from('file_checklist_items').select('file_id,required,status').in('file_id', ids);
    if(!alive) return;
    const map={};
    (data||[]).forEach(it=>{ if(!it.required) return; const m=map[it.file_id]||{done:0,total:0}; m.total++; if(['approved','waived','na'].includes(it.status)) m.done++; map[it.file_id]=m; });
    setProgress(map);
  })(); return ()=>{alive=false;}; },[idsKey]);

  const shown = statusFilter==='all'? buyerFiles : buyerFiles.filter(f=>f.status===statusFilter);

  const [intake,setIntake]=useState([]);
  const [scanning,setScanning]=useState(false);
  const [busyIntake,setBusyIntake]=useState({});

  const loadIntake = async()=>{
    const { data } = await supabase.from('file_intake').select('*').eq('status','pending').order('created_at',{ascending:false});
    setIntake(data||[]);
  };
  useEffect(()=>{ loadIntake(); },[]);

  const scanInbox = async()=>{
    setScanning(true);
    try{
      const { data, error } = await supabase.functions.invoke('files-intake-scan', { body:{ lookback_days:90, limit:8 } });
      if(error || data?.error){ if(window.__notify) window.__notify('Scan failed: '+(error?.message||data?.error),'error'); }
      else { await loadIntake(); if(window.__notify) window.__notify(data?.staged? `${data.staged} document(s) ready to file.` : (data?.message||'Inbox scanned — nothing new.'),'success'); }
    }catch(e){ if(window.__notify) window.__notify('Scan failed: '+(e.message||e),'error'); }
    finally{ setScanning(false); }
  };

  const refreshProgressFor = async(fid)=>{
    const { data } = await supabase.from('file_checklist_items').select('required,status').eq('file_id',fid);
    const m={done:0,total:0}; (data||[]).forEach(it=>{ if(!it.required) return; m.total++; if(['approved','waived','na'].includes(it.status)) m.done++; });
    setProgress(p=>({...p,[fid]:m}));
  };

  const createFileRow = async (vals)=>{
    const ins = { ...vals, user_id:userId, side:'buyer' };
    const { data, error } = await supabase.from('files').insert(ins).select().single();
    if(error){ if(window.__notify) window.__notify('Could not create file: '+error.message,'error'); return null; }
    const items = FARBAR_BUYER_CHECKLIST.map((c,i)=>({ file_id:data.id, user_id:userId, item_key:c.key, label:c.label, category:c.cat, required:c.required, sort:i }));
    await supabase.from('file_checklist_items').insert(items);
    await logFileEvent(data.id, userId, 'file_created', `File created for ${data.address||'(no address)'}`);
    setFiles(prev=>[data, ...prev]);
    setProgress(p=>({ ...p, [data.id]:{ done:0, total: FARBAR_BUYER_CHECKLIST.filter(c=>c.required).length } }));
    return data;
  };
  const createFile = async (vals)=>{ const d=await createFileRow(vals); if(d){ setShowNew(false); setOpenId(d.id); } };

  const createFileFromIntake = async(item)=>{
    const ai=item.ai||{};
    const vals={ address: ai.address || (item.email_subject||'').slice(0,120) || 'New file', state:'FL',
      buyer_name: ai.buyer||null, seller_name: ai.seller||null,
      contract_price: ai.price||null, emd: ai.emd||null,
      effective_date: ai.effective_date||null, closing_date: ai.closing_date||null,
      status: item.suggested_doc_type==='farbar_contract'?'under_contract':'active' };
    const f = await createFileRow(vals);
    if(f) await fileIntakeItem(item, f.id, item.suggested_doc_type||'misc', true);
  };

  const fileIntakeItem = async(item, targetFileId, docType, isNew)=>{
    if(!targetFileId){ if(window.__notify) window.__notify('Pick a file (or create one).','error'); return; }
    setBusyIntake(b=>({...b,[item.id]:true}));
    try{
      const ai=item.ai||{};
      const { data:doc, error } = await supabase.from('file_documents').insert({
        file_id:targetFileId, user_id:userId, doc_type:docType, title:item.filename||DOCTYPE_LABEL[docType],
        storage_path:item.storage_path, file_name:item.filename, mime:item.mime, size_bytes:item.size_bytes,
        source:'email', source_email_id:item.provider_message_id,
        execution_state: ai.is_executed===true?'executed':(ai.is_executed===false?'draft':'unknown'),
        extracted_terms: ai||{},
      }).select().single();
      if(error) throw error;
      // auto-satisfy checklist
      const key=DOCTYPE_TO_ITEM[docType]||docType;
      const { data:items } = await supabase.from('file_checklist_items').select('*').eq('file_id',targetFileId).eq('item_key',key);
      for(const it of (items||[])){ if(it.status==='missing'){ await supabase.from('file_checklist_items').update({status:'received',satisfied_by:doc.id,updated_at:new Date().toISOString()}).eq('id',it.id); } }
      // auto-fill empty file fields from extraction
      if(!isNew){
        const tf=(files||[]).find(x=>x.id===targetFileId);
        if(tf){ const patch={};
          if(!tf.contract_price && ai.price) patch.contract_price=ai.price;
          if(!tf.emd && ai.emd) patch.emd=ai.emd;
          if(!tf.effective_date && ai.effective_date) patch.effective_date=ai.effective_date;
          if(!tf.closing_date && ai.closing_date) patch.closing_date=ai.closing_date;
          if(!tf.buyer_name && ai.buyer) patch.buyer_name=ai.buyer;
          if(!tf.seller_name && ai.seller) patch.seller_name=ai.seller;
          if(Object.keys(patch).length){ patch.updated_at=new Date().toISOString(); const { data:uf } = await supabase.from('files').update(patch).eq('id',targetFileId).select().single(); if(uf) setFiles(prev=>prev.map(x=>x.id===uf.id?uf:x)); }
        }
      }
      // Phase 3: build timeline from a contract's terms; resolve contingencies from waiver docs
      const addr=(files||[]).find(x=>x.id===targetFileId)?.address || ai.address;
      if(['farbar_contract','amendment','counteroffer','addendum'].includes(docType)) await generateDeadlinesFromTerms(targetFileId, userId, ai, addr);
      if(WAIVER_TO_KIND[docType]) await resolveDeadlineWaiver(targetFileId, userId, WAIVER_TO_KIND[docType]);
      if(docType==='closing_disclosure'){
        const cdComm = (ai.commission_to_brokerage!=null? ai.commission_to_brokerage : (ai.commission_total!=null? ai.commission_total : null));
        const patch={ cd_received:true, updated_at:new Date().toISOString() };
        if(cdComm!=null) patch.commission_cd=cdComm;
        const { data:uf } = await supabase.from('files').update(patch).eq('id',targetFileId).select().single();
        if(uf) setFiles(prev=>prev.map(x=>x.id===uf.id?uf:x));
        await logFileEvent(targetFileId, userId, 'cd_received', `Closing Disclosure received${cdComm!=null?` · commission ${money(cdComm)}`:''}`);
      }
      await supabase.from('file_intake').update({ status:'filed', filed_document_id:doc.id, suggested_file_id:targetFileId, updated_at:new Date().toISOString() }).eq('id',item.id);
      await logFileEvent(targetFileId, userId, 'doc_filed_from_email', `${DOCTYPE_LABEL[docType]||docType} filed from email${item.email_from?` (${item.email_from})`:''}`, { doc_id:doc.id });
      setIntake(prev=>prev.filter(x=>x.id!==item.id));
      await refreshProgressFor(targetFileId);
      if(window.__notify) window.__notify('Filed.','success');
    }catch(e){ if(window.__notify) window.__notify('Could not file: '+(e.message||e),'error'); }
    finally{ setBusyIntake(b=>({...b,[item.id]:false})); }
  };

  const dismissIntake = async(item)=>{
    setIntake(prev=>prev.filter(x=>x.id!==item.id));
    await supabase.from('file_intake').update({status:'dismissed',updated_at:new Date().toISOString()}).eq('id',item.id);
  };
  const viewIntake = async(item)=>{ if(!item.storage_path) return; const { data } = await supabase.storage.from('file-docs').createSignedUrl(item.storage_path,3600); if(data?.signedUrl) window.open(data.signedUrl,'_blank'); };

  const patchFile = (updated)=> setFiles(prev=>prev.map(f=>f.id===updated.id?updated:f));
  const removeFile = (id)=> { setFiles(prev=>prev.filter(f=>f.id!==id)); setOpenId(null); };

  const openFile = (files||[]).find(f=>f.id===openId) || null;

  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'8px'}}><Icon name="folder" size={20}/> Files</h2>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>Buyer-side transaction files · FAR/BAR (Florida)</div>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-ghost" onClick={scanInbox} disabled={scanning} title="Pull contract PDFs from your connected inboxes">{scanning?'Scanning…':'Scan inbox'}</button>
          <button className="btn btn-primary" onClick={()=>setShowNew(true)}>+ New File</button>
        </div>
      </div>

      {intake.length>0 && (
        <div className="panel" style={{borderColor:'var(--accent)',background:'linear-gradient(135deg,var(--bg-card),var(--bg-hover))',marginTop:'12px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
            <Icon name="inbox" size={16}/><strong style={{fontSize:'14px'}}>Needs filing</strong>
            <span style={{fontSize:'11px',fontWeight:700,background:'var(--accent)',color:'#fff',padding:'1px 8px',borderRadius:'999px'}}>{intake.length}</span>
            <span style={{fontSize:'12px',color:'var(--text-2)'}}>contract documents pulled from your email</span>
          </div>
          <div style={{display:'grid',gap:'8px'}}>
            {intake.map(item=>(
              <IntakeCard key={item.id} item={item} files={buyerFiles} busy={!!busyIntake[item.id]}
                onView={()=>viewIntake(item)} onDismiss={()=>dismissIntake(item)}
                onFile={(fid,dtype)=>fileIntakeItem(item,fid,dtype,false)}
                onCreateNew={()=>createFileFromIntake(item)} />
            ))}
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',margin:'12px 0'}}>
        {[{value:'all',label:'All'},...FILE_STATUSES].map(s=>(
          <button key={s.value} className={'btn btn-sm '+(statusFilter===s.value?'btn-primary':'btn-ghost')} onClick={()=>setStatusFilter(s.value)} style={{fontSize:'12px'}}>
            {s.label}{s.value!=='all'?` (${buyerFiles.filter(f=>f.status===s.value).length})`:` (${buyerFiles.length})`}
          </button>
        ))}
      </div>

      {shown.length===0 ? (
        <div className="panel" style={{textAlign:'center',color:'var(--text-2)',padding:'32px'}}>
          {buyerFiles.length===0 ? 'No files yet. Create your first buyer file to start tracking the contract documents.' : 'No files in this status.'}
        </div>
      ) : (
        <div style={{display:'grid',gap:'10px'}}>
          {shown.map(f=>{
            const pr = progress[f.id]; const pct = pr&&pr.total? Math.round(100*pr.done/pr.total):0;
            return (
              <div key={f.id} className="panel" onClick={()=>setOpenId(f.id)} style={{cursor:'pointer',display:'flex',flexDirection:'column',gap:'8px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px'}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:'15px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.address||'(no address)'}</div>
                    <div style={{fontSize:'12px',color:'var(--text-2)'}}>{[f.city,f.state,f.zip].filter(Boolean).join(', ')}</div>
                  </div>
                  <StatusPill status={f.status}/>
                </div>
                <div style={{display:'flex',gap:'16px',flexWrap:'wrap',fontSize:'12px',color:'var(--text-2)'}}>
                  {f.buyer_name && <span><Icon name="users" size={12} style={{verticalAlign:'-2px'}}/> {f.buyer_name}</span>}
                  <span><Icon name="dollar" size={12} style={{verticalAlign:'-2px'}}/> {money(f.contract_price)}</span>
                  <span><Icon name="calendar" size={12} style={{verticalAlign:'-2px'}}/> Close {shortDate(f.closing_date)}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <div style={{flex:1,height:'6px',background:'var(--bg-hover)',borderRadius:'999px',overflow:'hidden'}}>
                    <div style={{width:pct+'%',height:'100%',background: pct===100?'var(--green)':'var(--accent)'}}/>
                  </div>
                  <span style={{fontSize:'11px',color:'var(--text-2)',whiteSpace:'nowrap'}}>{pr?`${pr.done}/${pr.total} req`:'—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && <FileModal onClose={()=>setShowNew(false)} onSave={createFile} properties={properties} contacts={contacts}/>}
      {openFile && <FileDetailModal key={openFile.id} file={openFile} onClose={()=>setOpenId(null)} onChange={patchFile} onDelete={removeFile} contacts={contacts} properties={properties} userId={userId} isAdmin={isAdmin} setProgress={setProgress}/>}
    </div>
  );
}

export function FileModal({ onClose, onSave, initial, properties, contacts }){

  useBackClose(onClose);
  const [f,setF]=useState({
    address:initial?.address||'', city:initial?.city||'', state:initial?.state||'FL', zip:initial?.zip||'',
    buyer_name:initial?.buyer_name||'', status:initial?.status||'active',
    contract_price:initial?.contract_price||'', emd:initial?.emd||'',
    effective_date:initial?.effective_date||'', closing_date:initial?.closing_date||'',
    commission_gross:initial?.commission_gross||'', property_id:initial?.property_id||'',
  });
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const [saving,setSaving]=useState(false);
  const submit=async()=>{
    if(!f.address.trim()){ if(window.__notify) window.__notify('Add a property address.','error'); return; }
    setSaving(true);
    const clean={ ...f };
    ['contract_price','emd','commission_gross'].forEach(k=>{ clean[k]= clean[k]===''?null:Number(clean[k]); });
    ['effective_date','closing_date','property_id'].forEach(k=>{ if(clean[k]==='') clean[k]=null; });
    await onSave(clean); setSaving(false);
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'520px',width:'100%',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header"><h3 style={{margin:0}}>New Buyer File</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div style={{display:'grid',gap:'10px'}}>
          <label className="form-label">Property address
            <input className="form-input" value={f.address} onChange={e=>set('address',e.target.value)} placeholder="123 Main St"/>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'8px'}}>
            <label className="form-label">City<input className="form-input" value={f.city} onChange={e=>set('city',e.target.value)}/></label>
            <label className="form-label">State<input className="form-input" value={f.state} onChange={e=>set('state',e.target.value)}/></label>
            <label className="form-label">Zip<input className="form-input" value={f.zip} onChange={e=>set('zip',e.target.value)}/></label>
          </div>
          <label className="form-label">Buyer name<input className="form-input" value={f.buyer_name} onChange={e=>set('buyer_name',e.target.value)} placeholder="Buyer(s)"/></label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <label className="form-label">Status
              <select className="form-input" value={f.status} onChange={e=>set('status',e.target.value)}>
                {FILE_STATUSES.filter(s=>s.value!=='paid'&&s.value!=='cancelled').map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="form-label">Link property
              <select className="form-input" value={f.property_id} onChange={e=>set('property_id',e.target.value)}>
                <option value="">— none —</option>
                {(properties||[]).map(p=><option key={p.id} value={p.id}>{p.nickname||p.address||p.id}</option>)}
              </select>
            </label>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <label className="form-label">Contract price<input className="form-input" type="number" value={f.contract_price} onChange={e=>set('contract_price',e.target.value)}/></label>
            <label className="form-label">EMD<input className="form-input" type="number" value={f.emd} onChange={e=>set('emd',e.target.value)}/></label>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <label className="form-label">Effective date<input className="form-input" type="date" value={f.effective_date} onChange={e=>set('effective_date',e.target.value)}/></label>
            <label className="form-label">Closing date<input className="form-input" type="date" value={f.closing_date} onChange={e=>set('closing_date',e.target.value)}/></label>
          </div>
          <label className="form-label">Commission (gross $)<input className="form-input" type="number" value={f.commission_gross} onChange={e=>set('commission_gross',e.target.value)}/></label>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'16px'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving?'Creating…':'Create File'}</button>
        </div>
      </div>
    </div>
  );
}

export function IntakeCard({ item, files, busy, onView, onDismiss, onFile, onCreateNew }){
  const ai=item.ai||{};
  const [dtype,setDtype]=useState(item.suggested_doc_type||'misc');
  const [target,setTarget]=useState(item.suggested_file_id||'');
  const conf=typeof item.confidence==='number'?Math.round(item.confidence*100):null;
  return (
    <div className="panel" style={{display:'grid',gap:'8px',background:'var(--bg-card)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:'8px',alignItems:'flex-start'}}>
        <div style={{minWidth:0}}>
          <div style={{fontWeight:600,fontSize:'13px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.filename||'document.pdf'}</div>
          <div style={{fontSize:'11px',color:'var(--text-3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.email_subject||'(no subject)'} · {item.email_from||''}</div>
        </div>
        {conf!=null && <span style={{fontSize:'10px',fontWeight:700,color: conf>=70?'var(--green)':conf>=40?'var(--yellow)':'var(--text-3)',whiteSpace:'nowrap'}}>{conf}% sure</span>}
      </div>
      {(ai.summary||ai.address) && <div style={{fontSize:'12px',color:'var(--text-2)'}}>{ai.address?`📍 ${ai.address}`:''}{ai.address&&ai.price?' · ':''}{ai.price?`$${Number(ai.price).toLocaleString()}`:''}{ai.summary?`${(ai.address||ai.price)?' — ':''}${ai.summary}`:''}</div>}
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
        <select className="form-input" value={dtype} onChange={e=>setDtype(e.target.value)} style={{width:'auto',padding:'4px 8px',fontSize:'12px'}}>
          {FILE_DOC_TYPES.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <select className="form-input" value={target} onChange={e=>setTarget(e.target.value)} style={{width:'auto',padding:'4px 8px',fontSize:'12px',maxWidth:'180px'}}>
          <option value="">Choose file…</option>
          {(files||[]).map(f=><option key={f.id} value={f.id}>{f.address||'(no address)'}</option>)}
        </select>
      </div>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
        <button className="btn btn-ghost btn-sm" onClick={onView}><Icon name="eye" size={12}/> View</button>
        <button className="btn btn-primary btn-sm" disabled={busy||!target} onClick={()=>onFile(target,dtype)}>{busy?'Filing…':'File here'}</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCreateNew} style={{color:'var(--accent)'}}>+ New file from this</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onDismiss} style={{color:'var(--text-3)',marginLeft:'auto'}}>Dismiss</button>
      </div>
    </div>
  );
}
