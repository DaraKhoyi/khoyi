// SignatureManageModal — extracted from App.js (strangle, FileDetailModal child).
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { confirmDialog } from '../notify';
import { useBackClose } from '../backClose';
import { logFileEvent, shortDate } from '../fileDomain';

export default function SignatureManageModal({ request, file, userId, onClose, onChanged }){

  useBackClose(onClose);
  const [signers,setSigners]=useState(request.signers||[]);
  const [busy,setBusy]=useState(false);
  const resend=async(s)=>{
    if(!s.email){ if(window.__notify) window.__notify('No email on file for this signer — use Copy link.','error'); return; }
    setBusy(true);
    try{ const { data:accts } = await supabase.from('email_accounts').select('id,is_active').eq('user_id',userId); const acct=(accts||[]).find(a=>a.is_active!==false); if(!acct){ if(window.__notify) window.__notify('Connect a Gmail account to send.','error'); return; }
      const url=`https://darasapp.com/sign/${s.token}`;
      await supabase.functions.invoke('gmail-send',{ body:{ account_id:acct.id, to:s.email, subject:`Reminder: signature needed — ${request.title||'document'}`, body_text:`A signature is requested.\n\nSign securely here:\n${url}\n\n— Realty ONE Group Advantage` } });
      await supabase.from('signature_signers').update({ last_reminder_at:new Date().toISOString() }).eq('id',s.id);
      if(window.__notify) window.__notify('Reminder sent.','success');
    }catch(e){ if(window.__notify) window.__notify('Send failed.','error'); } finally{ setBusy(false); }
  };
  const voidReq=async()=>{
    if(!await confirmDialog('Void this signature request? The links will stop working and the document can be sent again.')) return;
    setBusy(true);
    try{ await supabase.from('signature_requests').update({ status:'voided', voided_at:new Date().toISOString() }).eq('id',request.id);
      await logFileEvent(file.id, userId, 'esign_voided', `Voided signature request: ${request.title||''}`);
      if(onChanged) onChanged(); onClose();
    }catch(e){ if(window.__notify) window.__notify('Could not void.','error'); } finally{ setBusy(false); }
  };
  return (
    <div className="modal-overlay" style={{zIndex:2300}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'520px',width:'100%',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header"><h3 style={{margin:0}}>Signature request</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div style={{fontSize:'13px',fontWeight:600,marginBottom:'4px'}}>{request.title}</div>
        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'12px'}}>{request.sign_in_order?'Signs in order':'Any order'} · {request.status}</div>
        <div style={{display:'grid',gap:'8px'}}>
          {(signers||[]).map(s=>(
            <div key={s.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px',background:'var(--bg-hover)',borderRadius:'8px'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'13px',fontWeight:600}}>{s.name} {s.role?<span style={{fontSize:'10px',color:'var(--text-3)'}}>· {s.role}</span>:null}</div>
                <div style={{fontSize:'11px',color: s.status==='signed'?'var(--green)':s.status==='declined'?'var(--red)':'var(--text-2)'}}>{s.status}{s.signed_at?` · ${shortDate(s.signed_at.slice(0,10))}`:''}{s.email?` · ${s.email}`:''}</div>
              </div>
              {s.status!=='signed' && <>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>resend(s)} style={{padding:'4px 8px'}}>Resend</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>{ try{ navigator.clipboard.writeText(`https://darasapp.com/sign/${s.token}`); if(window.__notify) window.__notify('Link copied.','success'); }catch(_){}}} style={{padding:'4px 8px',color:'var(--text-3)'}}>Copy</button>
              </>}
            </div>
          ))}
        </div>
        {request.status!=='completed' && <div style={{display:'flex',justifyContent:'flex-end',marginTop:'14px'}}><button className="btn btn-ghost" disabled={busy} onClick={voidReq} style={{color:'var(--red)'}}>Void request</button></div>}
      </div>
    </div>
  );
}
