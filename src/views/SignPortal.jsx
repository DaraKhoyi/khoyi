// SignPortal — extracted from App.js (strangle, FileDetailModal child).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { notifyError } from '../notify';

export default function SignPortal({ token }){
  const [state,setState]=useState({loading:true});
  const [consent,setConsent]=useState(false);
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(null); // 'signed' | 'declined' | 'completed'
  const [sigMode,setSigMode]=useState('type');
  const [hasDrawn,setHasDrawn]=useState(false);
  const canvasRef=useRef(null); const drawingRef=useRef(false); const lastRef=useRef(null);
  const cpos=(e)=>{ const c=canvasRef.current,r=c.getBoundingClientRect(); const cx=(e.touches?e.touches[0].clientX:e.clientX)-r.left, cy=(e.touches?e.touches[0].clientY:e.clientY)-r.top; return {x:cx*(c.width/r.width),y:cy*(c.height/r.height)}; };
  const cStart=(e)=>{ e.preventDefault(); drawingRef.current=true; lastRef.current=cpos(e); };
  const cMove=(e)=>{ if(!drawingRef.current) return; e.preventDefault(); const c=canvasRef.current,ctx=c.getContext('2d'),p=cpos(e); ctx.strokeStyle='#111'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(lastRef.current.x,lastRef.current.y); ctx.lineTo(p.x,p.y); ctx.stroke(); lastRef.current=p; if(!hasDrawn) setHasDrawn(true); };
  const cEnd=()=>{ drawingRef.current=false; };
  const cClear=()=>{ const c=canvasRef.current; if(c) c.getContext('2d').clearRect(0,0,c.width,c.height); setHasDrawn(false); };
  const load=async()=>{ try{ const { data, error } = await supabase.functions.invoke('sign-portal',{ body:{ action:'get', token } }); if(error||data?.error){ setState({error:data?.error||error?.message||'Could not load'}); return; } setState({...data,loading:false}); setName(data?.signer?.name||''); }catch(e){ setState({error:String(e)}); } };
  useEffect(()=>{ load(); },[token]);
  const sign=async()=>{
    if(!consent){ notifyError('Please check the consent box.'); return; }
    if(!name.trim()){ notifyError('Type your full legal name.'); return; }
    const body={ action:'sign', token, consent:true, signature_name:name.trim() };
    if(sigMode==='draw'){ if(!hasDrawn){ notifyError('Please draw your signature.'); return; } body.signature_type='drawn'; body.signature_data=canvasRef.current.toDataURL('image/png'); }
    else body.signature_type='typed';
    setBusy(true);
    try{ const { data, error } = await supabase.functions.invoke('sign-portal',{ body }); if(error||data?.error){ notifyError(data?.error||error?.message||'Could not sign'); return; } setDone(data?.completed?'completed':'signed'); }catch(e){ notifyError(String(e)); } finally{ setBusy(false); }
  };
  const decline=async()=>{ const reason=window.prompt('Reason for declining (optional):')||''; setBusy(true); try{ await supabase.functions.invoke('sign-portal',{ body:{ action:'decline', token, decline_reason:reason } }); setDone('declined'); }catch(e){} finally{ setBusy(false); } };

  const Shell=({children})=>(
    <div style={{minHeight:'100vh',background:'var(--bg-base,#0d0f14)',color:'var(--text-1,#e8eaf0)',display:'flex',flexDirection:'column',alignItems:'center',padding:'0 16px 40px'}}>
      <div style={{width:'100%',maxWidth:'620px'}}>
        <div style={{background:'#0e0f13',borderBottom:'3px solid #C5A95E',padding:'18px 4px 14px',marginBottom:'20px'}}>
          <div style={{fontWeight:800,letterSpacing:'.02em'}}>REALTY ONE GROUP ADVANTAGE</div>
          <div style={{fontSize:'11px',color:'#C5A95E'}}>powered by PrismOS · secure e-signature</div>
        </div>
        {children}
      </div>
    </div>
  );
  if(state.loading) return <Shell><div style={{color:'var(--text-2,#9499b0)'}}>Loading document…</div></Shell>;
  if(state.error) return <Shell><div className="panel" style={{background:'#161921',borderRadius:'12px',padding:'20px'}}><h3 style={{marginTop:0}}>Link unavailable</h3><p style={{color:'var(--text-2,#9499b0)'}}>{state.error}. This signing link may have expired or already been completed.</p></div></Shell>;
  if(done==='completed'||done==='signed') return <Shell><div className="panel" style={{background:'#161921',borderRadius:'12px',padding:'24px',textAlign:'center'}}><div style={{fontSize:'40px'}}>✅</div><h3>Thank you, {name}!</h3><p style={{color:'var(--text-2,#9499b0)'}}>Your signature has been recorded{done==='completed'?' and the document is now fully executed':''}. A completed copy with the certificate of completion will be sent to the brokerage.</p></div></Shell>;
  if(done==='declined') return <Shell><div className="panel" style={{background:'#161921',borderRadius:'12px',padding:'24px',textAlign:'center'}}><h3>Declined</h3><p style={{color:'var(--text-2,#9499b0)'}}>You've declined to sign. The brokerage has been notified.</p></div></Shell>;
  const alreadyDone = state.request?.status==='completed' || state.signer?.status==='signed';
  return (
    <Shell>
      <div className="panel" style={{background:'#161921',borderRadius:'12px',padding:'20px',display:'grid',gap:'14px'}}>
        <div>
          <div style={{fontSize:'12px',color:'var(--text-3,#555e7a)',textTransform:'uppercase',letterSpacing:'.05em'}}>Signature requested</div>
          <h2 style={{margin:'4px 0'}}>{state.document?.title||state.request?.title||'Document'}</h2>
          {state.request?.message && <p style={{color:'var(--text-2,#9499b0)',marginTop:'4px'}}>{state.request.message}</p>}
        </div>
        {state.view_url && <a href={state.view_url} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{justifySelf:'start',border:'1px solid #C5A95E',color:'#C5A95E'}}>📄 Review the document</a>}
        {alreadyDone ? <div style={{color:'var(--green,#22c55e)'}}>This document is already completed. Thank you.</div> : <>
          <div style={{background:'#0e0f13',borderRadius:'8px',padding:'12px',fontSize:'12px',color:'var(--text-2,#9499b0)',lineHeight:1.5}}>
            <label style={{display:'flex',gap:'10px',alignItems:'flex-start',cursor:'pointer'}}>
              <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:'2px'}}/>
              <span>{state.consent_text}</span>
            </label>
          </div>
          <div>
            <label className="form-label" style={{fontSize:'12px',color:'var(--text-2,#9499b0)'}}>Your full legal name</label>
            <input className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" style={{background:'#0e0f13'}}/>
            <div style={{display:'flex',gap:'6px',margin:'10px 0 6px'}}>
              <button className="btn btn-sm" onClick={()=>setSigMode('type')} style={{background:sigMode==='type'?'#C5A95E':'transparent',color:sigMode==='type'?'#111':'var(--text-2,#9499b0)',border:'1px solid #C5A95E',fontWeight:600}}>Type</button>
              <button className="btn btn-sm" onClick={()=>setSigMode('draw')} style={{background:sigMode==='draw'?'#C5A95E':'transparent',color:sigMode==='draw'?'#111':'var(--text-2,#9499b0)',border:'1px solid #C5A95E',fontWeight:600}}>Draw</button>
            </div>
            {sigMode==='type'
              ? (name && <div style={{padding:'14px',background:'#fff',borderRadius:'8px',textAlign:'center'}}><span style={{fontFamily:'"Brush Script MT","Segoe Script","Snell Roundhand",cursive',fontSize:'34px',color:'#111'}}>{name}</span></div>)
              : <div>
                  <canvas ref={canvasRef} width={500} height={150} onPointerDown={cStart} onPointerMove={cMove} onPointerUp={cEnd} onPointerLeave={cEnd} style={{background:'#fff',borderRadius:'8px',width:'100%',height:'150px',touchAction:'none',border:'1px solid #C5A95E'}}/>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:'4px'}}><span style={{fontSize:'11px',color:'var(--text-3,#555e7a)'}}>Draw your signature above</span><button className="btn btn-ghost btn-sm" onClick={cClear} style={{color:'var(--text-3,#555e7a)',padding:'2px 8px'}}>Clear</button></div>
                </div>}
          </div>
          <div style={{display:'flex',gap:'10px',justifyContent:'space-between',alignItems:'center'}}>
            <button className="btn btn-ghost btn-sm" onClick={decline} disabled={busy} style={{color:'var(--text-3,#555e7a)'}}>Decline</button>
            <button className="btn btn-primary" onClick={sign} disabled={busy||!consent||!name.trim()||(sigMode==='draw'&&!hasDrawn)} style={{background:'#C5A95E',borderColor:'#C5A95E',color:'#111',fontWeight:700}}>{busy?'Signing…':'Adopt & Sign'}</button>
          </div>
        </>}
      </div>
      <div style={{textAlign:'center',fontSize:'11px',color:'var(--text-3,#555e7a)',marginTop:'16px'}}>Secured by PrismOS e-Sign · ESIGN Act / Florida UETA compliant</div>
    </Shell>
  );
}
