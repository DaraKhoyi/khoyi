// MissingDocsComposer — extracted from App.js (strangle, FileDetailModal child).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

export default function MissingDocsComposer({ file, ov, missingItems, parties, contacts, userId, onClose, onSent }){
  const [accounts,setAccounts]=useState([]);
  const [fromId,setFromId]=useState('');
  const addr=file.address||'this file';
  const partyEmail = (()=>{ for(const p of (parties||[])){ const c=(contacts||[]).find(x=>x.id===p.contact_id); if(c?.email) return c.email; } return ''; })();
  const [to,setTo]=useState(partyEmail);
  const [subject,setSubject]=useState(`Documents needed — ${addr}`);
  const [body,setBody]=useState(`Hi,\n\nWe’re finalizing the file for ${addr} and still need the following to complete it:\n\n${(missingItems||[]).map(i=>`• ${i.label}`).join('\n')}\n\nPlease send these at your earliest convenience so we can keep the closing on track.\n\nThank you,`);
  const [sending,setSending]=useState(false);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('email_accounts').select('id,email_address,is_active').eq('user_id',userId); const act=(data||[]).filter(a=>a.is_active!==false); setAccounts(act); if(act[0]) setFromId(act[0].id); })(); },[userId]);
  const send=async()=>{
    if(!to.trim()){ if(window.__notify) window.__notify('Add a recipient.','error'); return; }
    if(!fromId){ if(window.__notify) window.__notify('Connect a Gmail account in Settings to send.','error'); return; }
    setSending(true);
    try{
      const { data, error } = await supabase.functions.invoke('gmail-send', { body:{ account_id:fromId, to:to.trim(), subject, body_text:body } });
      if(error||data?.error){ if(window.__notify) window.__notify('Send failed: '+(error?.message||data?.error),'error'); return; }
      if(onSent) onSent();
      if(window.__notify) window.__notify('Request sent.','success');
      onClose();
    }catch(e){ if(window.__notify) window.__notify('Send failed: '+(e.message||e),'error'); }
    finally{ setSending(false); }
  };
  return (
    <div className="modal-overlay" style={{zIndex:2200}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'560px',width:'100%',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header"><h3 style={{margin:0}}>Request missing documents</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div style={{display:'grid',gap:'10px'}}>
          <label className="form-label">From
            <select className="form-input" value={fromId} onChange={e=>setFromId(e.target.value)}>
              {accounts.length===0 && <option value="">No connected account</option>}
              {accounts.map(a=><option key={a.id} value={a.id}>{a.email_address}</option>)}
            </select>
          </label>
          <label className="form-label">To<input className="form-input" value={to} onChange={e=>setTo(e.target.value)} placeholder="agent@example.com"/></label>
          <label className="form-label">Subject<input className="form-input" value={subject} onChange={e=>setSubject(e.target.value)}/></label>
          <label className="form-label">Message<textarea className="form-input" rows={10} value={body} onChange={e=>setBody(e.target.value)}/></label>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={sending}>{sending?'Sending…':'Send request'}</button>
        </div>
      </div>
    </div>
  );
}
