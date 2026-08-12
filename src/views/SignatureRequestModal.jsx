// SignatureRequestModal — extracted from App.js (strangle, FileDetailModal child).
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import { logFileEvent, sigToken } from '../fileDomain';

export default function SignatureRequestModal({ file, doc, parties, contacts, userId, onClose, onCreated }){

  useBackClose(onClose);
  const seedSigners=()=>{ const out=[]; for(const p of (parties||[])){ const c=(contacts||[]).find(x=>x.id===p.contact_id); if(c?.email) out.push({ name:p.name||c.name||'', email:c.email, role:p.role||'' }); } if(file.buyer_name && !out.some(s=>s.role==='buyer')) out.unshift({ name:file.buyer_name, email:'', role:'buyer' }); return out.length?out:[{name:'',email:'',role:''}]; };
  const [signers,setSigners]=useState(seedSigners());
  const [title,setTitle]=useState(doc.title||'Document');
  const [message,setMessage]=useState(`Please review and sign: ${doc.title||'document'} for ${file.address||'our transaction'}.`);
  const [inOrder,setInOrder]=useState(false);
  const [sending,setSending]=useState(false);
  const [result,setResult]=useState(null); // {links:[{name,url}]}
  const setS=(i,k,v)=>setSigners(prev=>prev.map((s,idx)=>idx===i?{...s,[k]:v}:s));
  const addRow=()=>setSigners(prev=>[...prev,{name:'',email:'',role:''}]);
  const delRow=(i)=>setSigners(prev=>prev.filter((_,idx)=>idx!==i));
  const send=async()=>{
    const valid=signers.filter(s=>s.name.trim());
    if(!valid.length){ if(window.__notify) window.__notify('Add at least one signer name.','error'); return; }
    setSending(true);
    try{
      const { data:req, error } = await supabase.from('signature_requests').insert({ user_id:userId, file_id:file.id, document_id:doc.id, title, message, status:'sent', sign_in_order:inOrder }).select().single();
      if(error) throw error;
      const rows=valid.map((s,i)=>({ request_id:req.id, user_id:userId, file_id:file.id, name:s.name.trim(), email:s.email.trim()||null, role:s.role||null, sign_order:i+1, token:sigToken() }));
      const { data:created, error:e2 } = await supabase.from('signature_signers').insert(rows).select();
      if(e2) throw e2;
      // try to email links
      let acct=null; try{ const { data:accts } = await supabase.from('email_accounts').select('id,is_active').eq('user_id',userId); acct=(accts||[]).find(a=>a.is_active!==false)||null; }catch(_){}
      const links=[];
      for(const s of (created||[])){
        const url=`https://darasapp.com/sign/${s.token}`;
        links.push({ name:s.name, email:s.email, url });
        if(acct && s.email){ try{ await supabase.functions.invoke('gmail-send',{ body:{ account_id:acct.id, to:s.email, subject:`Signature requested: ${title}`, body_text:`${message}\n\nSign securely here:\n${url}\n\n— Realty ONE Group Advantage` } }); }catch(_){} }
      }
      await logFileEvent(file.id, userId, 'esign_sent', `Sent ${title} for signature to ${valid.map(s=>s.name).join(', ')}`, { request_id:req.id });
      if(onCreated) onCreated(req, created||[]);
      setResult({ links, emailed: !!acct });
    }catch(e){ if(window.__notify) window.__notify('Could not send: '+(e.message||e),'error'); }
    finally{ setSending(false); }
  };
  return (
    <div className="modal-overlay" style={{zIndex:2300}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'560px',width:'100%',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header"><h3 style={{margin:0}}>Send for signature</h3><button className="modal-close" onClick={onClose}>×</button></div>
        {result ? (
          <div style={{display:'grid',gap:'10px'}}>
            <div style={{color:'var(--green)',fontWeight:600}}>✓ Request sent{result.emailed?' — signing links emailed':''}.</div>
            <div style={{fontSize:'12px',color:'var(--text-2)'}}>Signing links{result.emailed?' (also emailed)':''} — tap to copy:</div>
            {result.links.map((l,i)=>(
              <button key={i} className="btn btn-ghost btn-sm" style={{justifyContent:'flex-start',textAlign:'left'}} onClick={()=>{ try{ navigator.clipboard.writeText(l.url); if(window.__notify) window.__notify('Link copied.','success'); }catch(_){}}}>
                <span style={{fontWeight:600}}>{l.name}</span>&nbsp;<span style={{color:'var(--text-3)',fontSize:'11px',wordBreak:'break-all'}}>{l.url}</span>
              </button>
            ))}
            <div style={{display:'flex',justifyContent:'flex-end'}}><button className="btn btn-primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div style={{display:'grid',gap:'10px'}}>
            <label className="form-label">Title<input className="form-input" value={title} onChange={e=>setTitle(e.target.value)}/></label>
            <label className="form-label">Message<textarea className="form-input" rows={2} value={message} onChange={e=>setMessage(e.target.value)}/></label>
            <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px',color:'var(--text-2)',cursor:'pointer'}}><input type="checkbox" checked={inOrder} onChange={e=>setInOrder(e.target.checked)}/> Require signing in order (each signer unlocks the next)</label>
            <div style={{fontSize:'12px',fontWeight:700,color:'var(--text-2)'}}>Signers{inOrder?' (in order)':''}</div>
            {signers.map((s,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:'6px',alignItems:'center'}}>
                <input className="form-input" placeholder="Name" value={s.name} onChange={e=>setS(i,'name',e.target.value)} style={{padding:'6px 8px',fontSize:'13px'}}/>
                <input className="form-input" placeholder="Email (to send link)" value={s.email} onChange={e=>setS(i,'email',e.target.value)} style={{padding:'6px 8px',fontSize:'13px'}}/>
                <button className="btn btn-ghost btn-sm" onClick={()=>delRow(i)} style={{color:'var(--text-3)',padding:'4px 7px'}}><Icon name="trash" size={12}/></button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addRow} style={{justifySelf:'start'}}>+ Add signer</button>
            <div style={{fontSize:'11px',color:'var(--text-3)'}}>Signers with an email get a secure link automatically; others you can copy and share. No login required for them.</div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'6px'}}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={send} disabled={sending}>{sending?'Sending…':'Send for signature'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
