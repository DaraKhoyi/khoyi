// FileDetailModal — a transaction file's detail: lifecycle, checklist, docs, signatures.
// Extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { computeCDA } from '../lib/cda';
import { supabase } from '../dataService';
import { money, num } from '../helpers';
import { confirmDialog } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import { CHK_META, CHK_STATUS, DOCTYPE_LABEL, DOCTYPE_TO_ITEM, FILE_DOC_TYPES, FILE_STATUSES, LifecycleChip, OriginChip, STATUS_META, StatusPill, WAIVER_TO_KIND, consistencyFlags, createDeadline, daysUntil, generateDeadlinesFromTerms, itemOrigin, logFileEvent, resolveDeadlineWaiver, shortDate, sigToken } from '../fileDomain';
import MissingDocsComposer from './MissingDocsComposer';
import SignatureRequestModal from './SignatureRequestModal';
import SignatureManageModal from './SignatureManageModal';
import SignPortal from './SignPortal';

export default function FileDetailModal({ file, onClose, onChange, onDelete, contacts, properties, userId, isAdmin, setProgress }){

  useBackClose(onClose);
  const fileId=file.id;
  const [tab,setTab]=useState('overview');
  const [docs,setDocs]=useState([]); const [parties,setParties]=useState([]); const [items,setItems]=useState([]); const [events,setEvents]=useState([]);
  const [deadlines,setDeadlines]=useState([]);
  const [sigReqs,setSigReqs]=useState([]);
  const [signDoc,setSignDoc]=useState(null);
  const [manageReq,setManageReq]=useState(null);
  const [selfSign,setSelfSign]=useState(null);
  const signMyself=async(doc)=>{
    try{
      const { data:{ user } } = await supabase.auth.getUser();
      const email=user?.email||null; const nm=(user?.user_metadata?.full_name)||email||'Me';
      const { data:req, error } = await supabase.from('signature_requests').insert({ user_id:userId, file_id:fileId, document_id:doc.id, title:doc.title||'Document', message:'Self-signature', status:'sent' }).select().single();
      if(error) throw error;
      const tok=sigToken();
      await supabase.from('signature_signers').insert({ request_id:req.id, user_id:userId, file_id:fileId, name:nm, email, role:'broker', sign_order:1, token:tok });
      await logFileEvent(fileId,userId,'esign_sent',`Self-sign: ${doc.title||''}`,{request_id:req.id});
      setSelfSign(tok);
    }catch(e){ if(window.__notify) window.__notify('Could not start signing: '+(e.message||e),'error'); }
  };
  const closeSelfSign=async()=>{ setSelfSign(null); await loadSigs(); const { data:d2 }=await supabase.from('file_documents').select('*').eq('file_id',fileId).order('created_at',{ascending:false}); if(d2) setDocs(d2); const { data:i2 }=await supabase.from('file_checklist_items').select('*').eq('file_id',fileId).order('sort',{ascending:true}); if(i2) setItems(i2); };
  const [loading,setLoading]=useState(true);
  const [ov,setOv]=useState(file);
  useEffect(()=>{ setOv(file); },[file]);
  const loadDeadlines = async()=>{ const { data } = await supabase.from('file_deadlines').select('*').eq('file_id',fileId).order('due_date',{ascending:true}); setDeadlines(data||[]); };
  const loadSigs = async()=>{ const { data } = await supabase.from('signature_requests').select('*, signers:signature_signers(*)').eq('file_id',fileId).order('created_at',{ascending:false}); setSigReqs(data||[]); };

  useEffect(()=>{ let alive=true; (async()=>{
    const [d,p,i,e,dl,sg]=await Promise.all([
      supabase.from('file_documents').select('*').eq('file_id',fileId).order('created_at',{ascending:false}),
      supabase.from('file_parties').select('*').eq('file_id',fileId).order('created_at',{ascending:true}),
      supabase.from('file_checklist_items').select('*').eq('file_id',fileId).order('sort',{ascending:true}),
      supabase.from('file_events').select('*').eq('file_id',fileId).order('created_at',{ascending:false}).limit(100),
      supabase.from('file_deadlines').select('*').eq('file_id',fileId).order('due_date',{ascending:true}),
      supabase.from('signature_requests').select('*, signers:signature_signers(*)').eq('file_id',fileId).order('created_at',{ascending:false}),
    ]);
    if(!alive) return;
    setDocs(d.data||[]); setParties(p.data||[]); setItems(i.data||[]); setEvents(e.data||[]); setDeadlines(dl.data||[]); setSigReqs(sg.data||[]); setLoading(false);
  })(); return ()=>{alive=false;}; },[fileId]);
  const sigByDoc = {}; for(const r of sigReqs){ if(r.document_id && r.status!=='voided' && !sigByDoc[r.document_id]) sigByDoc[r.document_id]=r; }

  // ---- CDA (admin): agent + pay plan + auto-calc ----
  const [cdaAgents,setCdaAgents]=useState([]);
  const [cdaPlan,setCdaPlan]=useState(null);
  const [cda,setCda]=useState(file.cda_data||{});
  const [cdaAgentId,setCdaAgentId]=useState(file.agent_id||'');
  const [cdaBusy,setCdaBusy]=useState(false);
  const [cdaCapYtd,setCdaCapYtd]=useState(0);
  const setCdaF=(k,v)=>setCda(c=>({...c,[k]:v}));
  const loadPlan=async(agentId)=>{ if(!agentId){ setCdaPlan(null); setCdaCapYtd(0); return; } const { data } = await supabase.from('pay_plans').select('*').eq('agent_id',agentId).eq('active',true).order('created_at',{ascending:false}).limit(1); setCdaPlan(data&&data[0]?data[0]:null); const yr=new Date().getFullYear(); const { data:led } = await supabase.from('cda_ledger').select('company_dollar,closed_on,created_at').eq('agent_id',agentId); const ytd=(led||[]).filter(r=>new Date(r.closed_on||r.created_at).getFullYear()===yr).reduce((s,r)=>s+(Number(r.company_dollar)||0),0); setCdaCapYtd(ytd); };
  useEffect(()=>{ if(!isAdmin) return; (async()=>{ const { data } = await supabase.from('agents').select('*').eq('user_id',userId).eq('active',true).order('name'); setCdaAgents(data||[]); })(); if(file.agent_id) loadPlan(file.agent_id); },[]);
  const pickAgent=async(id)=>{ setCdaAgentId(id); await supabase.from('files').update({ agent_id:id||null, updated_at:new Date().toISOString() }).eq('id',fileId); await loadPlan(id); };
  const saveCda=async()=>{ const { data } = await supabase.from('files').update({ cda_data:cda, updated_at:new Date().toISOString() }).eq('id',fileId).select().single(); if(data){ onChange(data); if(window.__notify) window.__notify('CDA inputs saved.','success'); } };
  const cdaCalc = computeCDA(ov, cda, cdaPlan||{}, cdaCapYtd);
  const agentObj = cdaAgents.find(x=>x.id===cdaAgentId);
  const uplineObj = agentObj?.upline_id? cdaAgents.find(x=>x.id===agentObj.upline_id):null;
  const generateCda=async()=>{
    if(!cdaAgentId){ if(window.__notify) window.__notify('Pick the agent first.','error'); return; }
    setCdaBusy(true);
    try{
      await saveCda();
      const c=cdaCalc; const M2=(n)=>money(n);
      const sections=[
        { heading:'Property & transaction', rows:[
          { label:'Property', value:[file.address,[file.city,file.state,file.zip].filter(Boolean).join(', ')].filter(Boolean).join(' — '), bold:true },
          { label:'Closing date', value: shortDate(ov.closing_date) },
          { label:'Contract price', value: M2(ov.contract_price) },
          { label:'Commission rate', value: c.totalRate!=null? c.totalRate+'%':'—' },
          { label:'Sides represented', value: ({buyer:'Buyer',seller:'Seller',both:'Both (dual)'}[c.sides]||c.sides) },
        ]},
        { heading:'Parties', rows:[
          { label:'Buyer', value: ov.buyer_name||'—' },
          { label:'Buyer phone / email', value:[cda.buyer_phone,cda.buyer_email].filter(Boolean).join('  ·  ')||'—', small:true, muted:true },
          { label:'Seller', value: ov.seller_name||'—' },
          { label:'Seller phone / email', value:[cda.seller_phone,cda.seller_email].filter(Boolean).join('  ·  ')||'—', small:true, muted:true },
        ]},
        { heading:'Cooperating brokerage', rows:[
          { label:'Co-op brokerage', value: cda.coop_brokerage||'—' },
          { label:'Co-op agent', value: cda.coop_agent_name||'—' },
          { label:'Co-op agent phone / email', value:[cda.coop_agent_phone,cda.coop_agent_email].filter(Boolean).join('  ·  ')||'—', small:true, muted:true },
          { label:'Commission to co-op brokerage (GCI)', value: M2(c.coopGci) },
        ]},
        { heading:'Title & mortgage', rows:[
          { label:'Title company', value: cda.title_company||'—' },
          { label:'Title contact', value:[cda.title_contact,cda.title_phone,cda.title_email].filter(Boolean).join('  ·  ')||'—', small:true, muted:true },
          { label:'Mortgage company', value: cda.lender_company||'—' },
          { label:'Loan officer', value:[cda.loan_officer,cda.lender_phone,cda.lender_email].filter(Boolean).join('  ·  ')||'—', small:true, muted:true },
        ]},
        { heading:'Commission math', rows:[
          { label:'Total commission (all sides)', value: M2(c.totalComm), bold:true },
          { label:'Less: commission to co-op brokerage', value: c.coopGci?('− '+M2(c.coopGci)):'—' },
          ...(c.referral?[{ label:`Less: outbound referral${cda.referral_to?` (${cda.referral_to})`:''}`, value:'− '+M2(c.referral) }]:[]),
          ...(c.royalty?[{ label:'Less: franchise/royalty', value:'− '+M2(c.royalty) }]:[]),
          { label:'Gross commission income to ROG (GCI)', value: M2(c.gciNet), bold:true },
        ]},
      ];
      const disbursement={ rows:[
        { label: c.split!=null?`Agent split (${c.split}% of GCI)`:'Agent gross', value: M2(c.agentGross), bold:true },
        ...c.disclosedFees.map(x=>({ label:x.label, value:'− '+M2(x.amount), neg:true })),
        ...c.contrib.map(x=>({ label:`Routed: ${x.label}`, value:'− '+M2(x.amount), muted:true })),
      ], net_label:'NET CASH TO AGENT', net_value: M2(c.agentCash) };
      const note=`Cooperating agent contact is provided for recruiting and coordination. Figures auto-calculated by PrismOS from the agent's active pay plan; verify against the executed Closing Disclosure before disbursement.`;
      const { data, error } = await supabase.functions.invoke('files-cda-generate', { body:{ file_id:fileId, doc_title:'Commission Disbursement Authorization', agent_name:agentObj?.name||'', sections, disbursement, note, recruiting_email: cda.recruiting_email||null, agent_id:cdaAgentId, closed_on: ov.closing_date||null, ledger:{ price:c.price, totalComm:c.totalComm, coopGci:c.coopGci, gciNet:c.gciNet, agentGross:c.agentGross, totalFees:c.totalFees, agentNet:c.agentNet, agentCash:c.agentCash, companyDollar:c.companyDollar, profitShare:c.profitShare, savings:c.savings, retirement:c.retirement } } });
      if(error||data?.error){ if(window.__notify) window.__notify('CDA failed: '+(error?.message||data?.error),'error'); return; }
      if(data.document) setDocs(prev=>[data.document,...prev]);
      const { data:i2 } = await supabase.from('file_checklist_items').select('*').eq('file_id',fileId).order('sort',{ascending:true}); if(i2) setItems(i2);
      if(window.__notify) window.__notify(data.recruiting_sent?'CDA generated · copy emailed to recruiting.':'CDA generated.','success');
      setTab('docs');
    }catch(e){ if(window.__notify) window.__notify('CDA failed: '+(e.message||e),'error'); }
    finally{ setCdaBusy(false); }
  };

  const cFlags = consistencyFlags(docs);

  const reqItems = items.filter(i=>i.required);
  const reqDone = reqItems.filter(i=>['approved','waived','na'].includes(i.status)).length;
  const pct = reqItems.length? Math.round(100*reqDone/reqItems.length):0;
  const cdApproved = items.some(i=>i.item_key==='closing_disclosure'&&['approved','waived'].includes(i.status));
  const readyToPay = reqItems.length>0 && reqDone===reqItems.length;

  useEffect(()=>{ if(setProgress) setProgress(p=>({...p,[fileId]:{done:reqDone,total:reqItems.length}})); },[reqDone,reqItems.length]);

  const saveOverview = async()=>{
    const clean={...ov};
    ['contract_price','list_price','emd','commission_gross','commission_split','commission_net','paid_amount'].forEach(k=>{ if(clean[k]==='') clean[k]=null; else if(clean[k]!=null) clean[k]=Number(clean[k]); });
    ['effective_date','closing_date'].forEach(k=>{ if(clean[k]==='') clean[k]=null; });
    clean.updated_at=new Date().toISOString();
    const { data, error } = await supabase.from('files').update(clean).eq('id',fileId).select().single();
    if(error){ if(window.__notify) window.__notify('Save failed: '+error.message,'error'); return; }
    onChange(data); if(window.__notify) window.__notify('Saved.','success');
  };
  const changeStatus = async(s)=>{
    setOv(o=>({...o,status:s}));
    const { data } = await supabase.from('files').update({status:s,updated_at:new Date().toISOString()}).eq('id',fileId).select().single();
    if(data) onChange(data);
    await logFileEvent(fileId,userId,'status_change',`Status → ${STATUS_META[s]?.label||s}`);
    setEvents(ev=>[{id:'t'+Date.now(),kind:'status_change',detail:`Status → ${STATUS_META[s]?.label||s}`,created_at:new Date().toISOString()},...ev]);
  };

  // ---------- checklist ----------
  const setItemStatus = async(it,status)=>{
    setItems(prev=>prev.map(x=>x.id===it.id?{...x,status}:x));
    await supabase.from('file_checklist_items').update({status,updated_at:new Date().toISOString()}).eq('id',it.id);
    await logFileEvent(fileId,userId,'checklist',`${it.label}: ${status}`);
  };
  const linkDoc = async(it,docId)=>{
    setItems(prev=>prev.map(x=>x.id===it.id?{...x,satisfied_by:docId||null,status:(docId&&x.status==='missing')?'received':x.status}:x));
    await supabase.from('file_checklist_items').update({satisfied_by:docId||null,status:(docId)?'received':'missing',updated_at:new Date().toISOString()}).eq('id',it.id);
  };
  const addItem = async()=>{
    const label=window.prompt('New checklist item:'); if(!label) return;
    const { data } = await supabase.from('file_checklist_items').insert({file_id:fileId,user_id:userId,label,category:'Other',required:false,sort:999}).select().single();
    if(data) setItems(prev=>[...prev,data]);
    await logFileEvent(fileId,userId,'checklist',`Added item: ${label}`);
  };
  const delItem = async(it)=>{ if(!await confirmDialog(`Remove "${it.label}"?`)) return; setItems(prev=>prev.filter(x=>x.id!==it.id)); await supabase.from('file_checklist_items').delete().eq('id',it.id); };
  const toggleReq = async(it)=>{ const required=!it.required; setItems(prev=>prev.map(x=>x.id===it.id?{...x,required}:x)); await supabase.from('file_checklist_items').update({required}).eq('id',it.id); };

  // ---------- documents ----------
  const [showUpload,setShowUpload]=useState(false);
  const [upType,setUpType]=useState('farbar_contract'); const [upTitle,setUpTitle]=useState(''); const [upFile,setUpFile]=useState(null); const [uploading,setUploading]=useState(false);
  const doUpload = async()=>{
    if(!upFile){ if(window.__notify) window.__notify('Choose a file.','error'); return; }
    setUploading(true);
    try{
      const { data:row, error } = await supabase.from('file_documents').insert({ file_id:fileId, user_id:userId, doc_type:upType, title:upTitle||DOCTYPE_LABEL[upType], file_name:upFile.name, mime:upFile.type, size_bytes:upFile.size, source:'upload' }).select().single();
      if(error) throw error;
      const safe=upFile.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path=`${userId}/${fileId}/${row.id}-${safe}`;
      const { error:upErr } = await supabase.storage.from('file-docs').upload(path,upFile,{ contentType:upFile.type||'application/pdf', upsert:false });
      if(upErr){ await supabase.from('file_documents').delete().eq('id',row.id); throw upErr; }
      await supabase.from('file_documents').update({storage_path:path}).eq('id',row.id);
      const saved={...row,storage_path:path};
      setDocs(prev=>[saved,...prev]);
      await logFileEvent(fileId,userId,'doc_uploaded',`${DOCTYPE_LABEL[upType]||upType} uploaded`,{doc_id:row.id});
      const key=DOCTYPE_TO_ITEM[upType]||upType;
      setItems(prev=>prev.map(it=>{ if(it.item_key===key && it.status==='missing'){ supabase.from('file_checklist_items').update({status:'received',satisfied_by:row.id,updated_at:new Date().toISOString()}).eq('id',it.id); return {...it,status:'received',satisfied_by:row.id}; } return it; }));
      if(WAIVER_TO_KIND[upType]){ await resolveDeadlineWaiver(fileId,userId,WAIVER_TO_KIND[upType]); await loadDeadlines(); }
      setUpFile(null); setUpTitle(''); setShowUpload(false);
    }catch(e){ if(window.__notify) window.__notify('Upload failed: '+(e.message||e),'error'); }
    finally{ setUploading(false); }
  };
  const viewDoc = async(d)=>{ if(!d.storage_path) return; const { data } = await supabase.storage.from('file-docs').createSignedUrl(d.storage_path,3600); if(data?.signedUrl) window.open(data.signedUrl,'_blank'); };
  const setDocType = async(d,doc_type)=>{ setDocs(prev=>prev.map(x=>x.id===d.id?{...x,doc_type}:x)); await supabase.from('file_documents').update({doc_type}).eq('id',d.id); };
  const reviewDoc = async(d,status)=>{
    let note=d.reviewer_note||null;
    if(status==='revision_requested'||status==='rejected'){ const r=window.prompt('Note (optional):',note||''); if(r!==null) note=r; }
    setDocs(prev=>prev.map(x=>x.id===d.id?{...x,review_status:status,reviewer_note:note}:x));
    await supabase.from('file_documents').update({review_status:status,reviewer_note:note}).eq('id',d.id);
    await logFileEvent(fileId,userId,'doc_review',`${DOCTYPE_LABEL[d.doc_type]||d.doc_type} → ${status.replace('_',' ')}`,{doc_id:d.id});
    if(status==='approved'){ const key=DOCTYPE_TO_ITEM[d.doc_type]||d.doc_type; setItems(prev=>prev.map(it=>{ if(it.item_key===key){ supabase.from('file_checklist_items').update({status:'approved',satisfied_by:d.id,updated_at:new Date().toISOString()}).eq('id',it.id); return {...it,status:'approved',satisfied_by:d.id}; } return it; })); }
  };
  const delDoc = async(d)=>{ if(!await confirmDialog('Delete this document?')) return; setDocs(prev=>prev.filter(x=>x.id!==d.id)); if(d.storage_path) await supabase.storage.from('file-docs').remove([d.storage_path]).catch(()=>{}); await supabase.from('file_documents').delete().eq('id',d.id); await logFileEvent(fileId,userId,'doc_deleted',`Deleted ${DOCTYPE_LABEL[d.doc_type]||d.doc_type}`); };

  // ---------- parties ----------
  const [pRole,setPRole]=useState('lender'); const [pSearch,setPSearch]=useState(''); 
  const partyMatches = pSearch.trim()? (contacts||[]).filter(c=>(c.name||'').toLowerCase().includes(pSearch.toLowerCase())).slice(0,6):[];
  const addParty = async(contact)=>{
    const ins={ file_id:fileId, user_id:userId, role:pRole, contact_id:contact?.id||null, name:contact?.name||pSearch.trim()||null };
    if(!ins.name){ if(window.__notify) window.__notify('Pick a contact or type a name.','error'); return; }
    const { data } = await supabase.from('file_parties').insert(ins).select().single();
    if(data){ setParties(prev=>[...prev,data]); setPSearch(''); await logFileEvent(fileId,userId,'party_added',`${pRole}: ${data.name}`); }
  };
  const delParty = async(pt)=>{ setParties(prev=>prev.filter(x=>x.id!==pt.id)); await supabase.from('file_parties').delete().eq('id',pt.id); };

  // ---------- Phase 4: extraction, disbursement, missing-doc email ----------
  const [extracting,setExtracting]=useState({});
  const extractDoc = async(d)=>{
    setExtracting(e=>({...e,[d.id]:true}));
    try{
      const { data, error } = await supabase.functions.invoke('files-doc-extract', { body:{ document_id:d.id } });
      if(error||data?.error){ if(window.__notify) window.__notify('Extract failed: '+(error?.message||data?.error),'error'); return; }
      const ai=data.ai||{};
      setDocs(prev=>prev.map(x=>x.id===d.id?{...x,extracted_terms:ai}:x));
      // if it's a CD, capture commission + receipt on the file
      if(d.doc_type==='closing_disclosure'){
        const cdComm=(ai.commission_to_brokerage!=null?ai.commission_to_brokerage:(ai.commission_total!=null?ai.commission_total:null));
        const patch={cd_received:true,updated_at:new Date().toISOString()}; if(cdComm!=null) patch.commission_cd=cdComm;
        const { data:uf } = await supabase.from('files').update(patch).eq('id',fileId).select().single(); if(uf){ onChange(uf); setOv(uf); }
        await logFileEvent(fileId,userId,'cd_received',`Closing Disclosure read · commission ${cdComm!=null?money(cdComm):'n/a'}`);
      }
      // contract terms -> offer to build timeline happens via Timeline tab; here just store
      if(window.__notify) window.__notify('Figures extracted.','success');
    }catch(e){ if(window.__notify) window.__notify('Extract failed: '+(e.message||e),'error'); }
    finally{ setExtracting(e=>({...e,[d.id]:false})); }
  };

  const expectedComm = ov.commission_gross!=null?Number(ov.commission_gross):null;
  const cdComm = ov.commission_cd!=null?Number(ov.commission_cd):null;
  const commVariance = (expectedComm!=null && cdComm!=null)? (cdComm-expectedComm):null;
  const commReconciled = commVariance!=null && Math.abs(commVariance) < 1;
  const cdApprovedDoc = items.some(i=>i.item_key==='closing_disclosure'&&['approved','waived'].includes(i.status)) || ov.cd_received;
  const readyToDisburse = reqItems.length>0 && reqDone===reqItems.length && (ov.cd_received||cdApprovedDoc);
  const nextBest = (()=>{
    if(ov.status==='paid') return null;
    const declined = Object.values(sigByDoc).find(r=>r.status!=='completed' && (r.signers||[]).some(s=>s.status==='declined'));
    if(declined) return { text:`A signer declined “${declined.title}”. Review and resend.`, cta:'Manage', act:()=>setManageReq(declined), tone:'red' };
    if(ov.cd_received && commVariance!=null && !commReconciled) return { text:`Commission doesn’t match the Closing Disclosure (${commVariance>=0?'+':''}${money(commVariance)}). Reconcile before disbursing.`, cta:'Review', act:()=>setTab('closing'), tone:'red' };
    if(readyToDisburse && ov.status!=='paid') return { text:'Everything required is in — you can disburse and mark this file paid.', cta:'Go to Closing', act:()=>setTab('closing'), tone:'green' };
    const pendingSig = Object.values(sigByDoc).find(r=>r.status==='sent');
    if(pendingSig){ const nx=(pendingSig.signers||[]).find(s=>s.status!=='signed'&&s.status!=='declined'); return { text:`Waiting on signature${nx?` from ${nx.name}`:''} for “${pendingSig.title}”.`, cta:'Manage', act:()=>setManageReq(pendingSig), tone:'gold' }; }
    const ownedMissing = items.find(it=>it.required && itemOrigin(it)==='owned' && it.status==='missing');
    if(ownedMissing) return { text:`Generate the ${ownedMissing.label}.`, cta:'Generate', act:()=>generateItem(ownedMissing), tone:'gold' };
    const extMissing = items.find(it=>it.required && itemOrigin(it)==='external' && it.status==='missing');
    if(extMissing) return { text:`Still need: ${extMissing.label}.`, cta:'Request', act:()=>openRequest(extMissing), tone:'gold' };
    const toReview = items.find(it=>it.required && it.status==='received');
    if(toReview) return { text:`${toReview.label} is in — review and approve it.`, cta:'Review', act:()=>setTab('checklist'), tone:'blue' };
    if(!ov.cd_received && ov.status!=='closed') return { text:'Waiting on the Closing Disclosure from title.', cta:'Timeline', act:()=>setTab('timeline'), tone:'gold' };
    return { text:'This file is in good shape — nothing needs you right now.', cta:null, tone:'green' };
  })();

  const markPaid = async()=>{
    const amtStr=window.prompt('Amount received ($):', cdComm!=null?String(cdComm):(expectedComm!=null?String(expectedComm):'')); if(amtStr===null) return;
    const amt=Number(amtStr)||null;
    const method=window.prompt('Method (check / wire / ach):','wire')||null;
    const when=window.prompt('Date received (YYYY-MM-DD):', new Date().toLocaleDateString('en-CA'))||new Date().toLocaleDateString('en-CA');
    const patch={ status:'paid', paid_amount:amt, paid_method:method, paid_at:new Date(`${when}T12:00:00`).toISOString(), disbursed_at:new Date().toISOString(), updated_at:new Date().toISOString() };
    const { data:uf } = await supabase.from('files').update(patch).eq('id',fileId).select().single();
    if(uf){ onChange(uf); setOv(uf); }
    await logFileEvent(fileId,userId,'paid',`Marked paid · ${money(amt)} via ${method||'?'} on ${when}`);
    if(window.__notify) window.__notify('File marked paid. 🎉','success');
  };

  const cdaText = ()=>{
    const lines=[];
    lines.push('COMMISSION DISBURSEMENT AUTHORIZATION');
    lines.push('Realty ONE Group Advantage');
    lines.push('');
    lines.push(`Property: ${file.address||''}${file.city?`, ${file.city}`:''} ${file.state||''} ${file.zip||''}`.trim());
    if(ov.buyer_name) lines.push(`Buyer: ${ov.buyer_name}`);
    if(ov.seller_name) lines.push(`Seller: ${ov.seller_name}`);
    if(ov.contract_price!=null) lines.push(`Sale price: ${money(ov.contract_price)}`);
    if(ov.closing_date) lines.push(`Closing date: ${shortDate(ov.closing_date)}`);
    lines.push('');
    if(cdComm!=null) lines.push(`Commission per Closing Disclosure: ${money(cdComm)}`);
    if(expectedComm!=null) lines.push(`Commission expected (file): ${money(expectedComm)}`);
    if(ov.commission_split!=null) lines.push(`Agent split: ${ov.commission_split}%`);
    if(ov.commission_net!=null) lines.push(`Net to agent: ${money(ov.commission_net)}`);
    lines.push('');
    lines.push('Please disburse the above commission to Realty ONE Group Advantage at closing.');
    return lines.join('\n');
  };
  const copyCDA = ()=>{ try{ navigator.clipboard.writeText(cdaText()); if(window.__notify) window.__notify('CDA copied to clipboard.','success'); }catch(e){ if(window.__notify) window.__notify('Copy failed.','error'); } };

  const [showMissing,setShowMissing]=useState(false);
  const [requestScope,setRequestScope]=useState(null);
  const [generating,setGenerating]=useState(false);
  const [showStudio,setShowStudio]=useState(false);
  const ITEM_TO_TEMPLATE={ cda:'cda', buyer_rep_cover:'buyer_rep_cover', compliance_attestation:'compliance_attestation' };
  const missingItems = items.filter(i=>i.required && !['approved','waived','na'].includes(i.status));
  const openRequest=(it)=>{ setRequestScope(it?[it]:null); setShowMissing(true); };
  const generateDoc=async(template)=>{
    setGenerating(true);
    try{
      const { data, error } = await supabase.functions.invoke('files-doc-generate', { body:{ file_id:fileId, template } });
      if(error||data?.error){ if(window.__notify) window.__notify('Generate failed: '+(error?.message||data?.error),'error'); return null; }
      const doc=data.document;
      if(doc){ setDocs(prev=>[doc,...prev]); }
      // refresh checklist (template may have satisfied an item)
      const { data:items2 } = await supabase.from('file_checklist_items').select('*').eq('file_id',fileId).order('sort',{ascending:true});
      if(items2) setItems(items2);
      setShowStudio(false);
      if(window.__notify) window.__notify('Document generated.','success');
      return doc;
    }catch(e){ if(window.__notify) window.__notify('Generate failed: '+(e.message||e),'error'); return null; }
    finally{ setGenerating(false); }
  };
  const generateItem=(it)=>{ const tpl=ITEM_TO_TEMPLATE[it.item_key]; if(tpl){ generateDoc(tpl); setTab('docs'); } else if(window.__notify) window.__notify('No template for this item yet — upload or mark it manually.','success'); };

  const delFile = async()=>{ if(!await confirmDialog(`Delete the entire file for ${file.address||'this property'}? This removes all its documents and checklist.`)) return; for(const dl of deadlines){ if(dl.task_id) await supabase.from('tasks').delete().eq('id',dl.task_id); if(dl.event_id) await supabase.from('events').delete().eq('id',dl.event_id); } await supabase.from('files').delete().eq('id',fileId); onDelete(fileId); };

  // ---------- deadlines / timeline ----------
  const generateTimeline = async()=>{
    const contractDoc = docs.find(d=>['farbar_contract','amendment','counteroffer','addendum'].includes(d.doc_type) && d.extracted_terms && Object.keys(d.extracted_terms).length);
    const ai = contractDoc? contractDoc.extracted_terms : {};
    const merged = { ...ai, closing_date: ai.closing_date || ov.closing_date || null };
    const made = await generateDeadlinesFromTerms(fileId, userId, merged, file.address);
    await loadDeadlines();
    if(window.__notify) window.__notify(made.length? `${made.length} deadline(s) added to your tasks & calendar.` : 'No new dates found to schedule. Add one manually below.','success');
  };
  const addDeadlineManual = async()=>{
    const label=window.prompt('Deadline label (e.g., Title commitment due):'); if(!label) return;
    const due=window.prompt('Due date (YYYY-MM-DD):'); if(!due||!/^\d{4}-\d{2}-\d{2}$/.test(due)){ if(window.__notify) window.__notify('Use date format YYYY-MM-DD.','error'); return; }
    await createDeadline(fileId,userId,'custom',label,due,'manual',file.address);
    await logFileEvent(fileId,userId,'deadline_created',`${label} — ${due}`);
    await loadDeadlines();
  };
  const setDeadlineStatus = async(dl,status)=>{
    setDeadlines(prev=>prev.map(x=>x.id===dl.id?{...x,status}:x));
    await supabase.from('file_deadlines').update({status,updated_at:new Date().toISOString()}).eq('id',dl.id);
    if((status==='waived'||status==='met'||status==='cancelled') && dl.task_id) await supabase.from('tasks').update({completed:true}).eq('id',dl.task_id);
    await logFileEvent(fileId,userId,'deadline_'+status,`${dl.label}: ${status}`);
  };
  const delDeadline = async(dl)=>{ if(!await confirmDialog(`Remove "${dl.label}"? Its task and calendar entry will be removed too.`)) return; setDeadlines(prev=>prev.filter(x=>x.id!==dl.id)); if(dl.task_id) await supabase.from('tasks').delete().eq('id',dl.task_id); if(dl.event_id) await supabase.from('events').delete().eq('id',dl.event_id); await supabase.from('file_deadlines').delete().eq('id',dl.id); };

  const cats = [...new Set(items.map(i=>i.category||'Other'))];
  const setOvF=(k,v)=>setOv(o=>({...o,[k]:v}));
  const DL_STATUS_COLOR={open:'var(--accent)',waived:'var(--yellow)',met:'var(--green)',passed:'var(--red)',cancelled:'var(--text-3)'};
  const TABS=[['overview','Overview'],['checklist','Checklist'],['timeline','Timeline'],['docs','Documents'],['closing','Closing'],...(isAdmin?[['cda','CDA']]:[]),['parties','Parties'],['activity','Activity']];

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'720px',width:'100%',maxHeight:'94vh',overflowY:'auto'}}>
        <div className="modal-header">
          <div style={{minWidth:0}}>
            <h3 style={{margin:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{file.address||'(no address)'}</h3>
            <div style={{fontSize:'12px',color:'var(--text-2)'}}>{[file.city,file.state,file.zip].filter(Boolean).join(', ')||'Buyer file'}</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* next best action */}
        {!loading && nextBest && (()=>{ const tc={red:'var(--red)',green:'var(--green)',gold:'var(--accent)',blue:'#3b82f6'}[nextBest.tone]||'var(--accent)'; return (
          <div style={{display:'flex',alignItems:'center',gap:'10px',background:'linear-gradient(135deg,var(--bg-card),var(--bg-hover))',border:`1px solid ${tc}`,borderRadius:'10px',padding:'12px 14px',marginBottom:'12px'}}>
            <div style={{width:'8px',height:'8px',borderRadius:'50%',background:tc,flexShrink:0,boxShadow:`0 0 8px ${tc}`}}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:'10px',fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)'}}>Next best action</div><div style={{fontSize:'13px',color:'var(--text-1)'}}>{nextBest.text}</div></div>
            {nextBest.cta && <button className="btn btn-primary btn-sm" onClick={nextBest.act} style={{whiteSpace:'nowrap'}}>{nextBest.cta}</button>}
          </div>
        ); })()}

        {/* completeness + readiness */}
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
          <StatusPill status={ov.status}/>
          <div style={{flex:1,height:'8px',background:'var(--bg-hover)',borderRadius:'999px',overflow:'hidden'}}>
            <div style={{width:pct+'%',height:'100%',background:pct===100?'var(--green)':'var(--accent)'}}/>
          </div>
          <span style={{fontSize:'12px',color:'var(--text-2)',whiteSpace:'nowrap'}}>{reqDone}/{reqItems.length} required</span>
        </div>
        {readyToPay
          ? <div style={{background:'rgba(34,197,94,.12)',border:'1px solid var(--green)',color:'var(--green)',borderRadius:'8px',padding:'8px 12px',fontSize:'13px',fontWeight:600,marginBottom:'10px'}}>✓ All required documents are in — this file is ready to disburse.</div>
          : <div style={{background:'var(--bg-hover)',borderRadius:'8px',padding:'8px 12px',fontSize:'12px',color:'var(--text-2)',marginBottom:'10px'}}>{reqItems.length-reqDone} required item(s) outstanding{!cdApproved?' · Closing Disclosure not yet in':''}.</div>}

        {/* tabs */}
        <div style={{display:'flex',gap:'4px',overflowX:'auto',borderBottom:'1px solid var(--border)',marginBottom:'12px'}}>
          {TABS.map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} className="btn btn-sm" style={{background:'none',border:'none',borderBottom:tab===id?'2px solid var(--accent)':'2px solid transparent',borderRadius:0,color:tab===id?'var(--text-1)':'var(--text-2)',fontWeight:tab===id?700:500,whiteSpace:'nowrap'}}>
              {label}{id==='docs'&&docs.length?` (${docs.length})`:''}
            </button>
          ))}
        </div>

        {loading? <div style={{color:'var(--text-2)',padding:'20px',textAlign:'center'}}>Loading…</div> : <>

        {tab==='overview' && (
          <div style={{display:'grid',gap:'10px'}}>
            {cFlags.length>0 && (
              <div style={{background:'rgba(245,158,11,.10)',border:'1px solid var(--yellow)',borderRadius:'8px',padding:'10px 12px'}}>
                <div style={{fontSize:'12px',fontWeight:700,color:'var(--yellow)',marginBottom:'4px'}}>⚠ Consistency check: {cFlags.length} conflict{cFlags.length>1?'s':''} across documents</div>
                {cFlags.map((f,idx)=>(
                  <div key={idx} style={{fontSize:'12px',color:'var(--text-2)',marginTop:'4px'}}>
                    <strong style={{color:'var(--text-1)'}}>{f.label}:</strong> {f.variants.map((v,i)=><span key={i}>{i>0?'  vs  ':''}{v.value} <span style={{color:'var(--text-3)'}}>({v.docs.join(', ')})</span></span>)}
                  </div>
                ))}
              </div>
            )}
            {docs.length>1 && cFlags.length===0 && <div style={{fontSize:'12px',color:'var(--green)'}}>✓ Consistency check: price, dates, and parties agree across {docs.length} documents.</div>}
            <label className="form-label">Status
              <select className="form-input" value={ov.status} onChange={e=>changeStatus(e.target.value)}>
                {FILE_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="form-label">Buyer name<input className="form-input" value={ov.buyer_name||''} onChange={e=>setOvF('buyer_name',e.target.value)}/></label>
            <label className="form-label">Seller name<input className="form-input" value={ov.seller_name||''} onChange={e=>setOvF('seller_name',e.target.value)}/></label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label className="form-label">Contract price<input className="form-input" type="number" value={ov.contract_price??''} onChange={e=>setOvF('contract_price',e.target.value)}/></label>
              <label className="form-label">EMD<input className="form-input" type="number" value={ov.emd??''} onChange={e=>setOvF('emd',e.target.value)}/></label>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label className="form-label">Effective date<input className="form-input" type="date" value={ov.effective_date||''} onChange={e=>setOvF('effective_date',e.target.value)}/></label>
              <label className="form-label">Closing date<input className="form-input" type="date" value={ov.closing_date||''} onChange={e=>setOvF('closing_date',e.target.value)}/></label>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label className="form-label">Commission gross<input className="form-input" type="number" value={ov.commission_gross??''} onChange={e=>setOvF('commission_gross',e.target.value)}/></label>
              <label className="form-label">Commission net<input className="form-input" type="number" value={ov.commission_net??''} onChange={e=>setOvF('commission_net',e.target.value)}/></label>
            </div>
            <label className="form-label">Notes<textarea className="form-input" rows={3} value={ov.notes||''} onChange={e=>setOvF('notes',e.target.value)}/></label>
            <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
              <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={delFile}><Icon name="trash" size={13}/> Delete file</button>
              <button className="btn btn-primary" onClick={saveOverview}>Save</button>
            </div>
          </div>
        )}

        {tab==='timeline' && (
          <div style={{display:'grid',gap:'10px'}}>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <button className="btn btn-primary btn-sm" onClick={generateTimeline}>Generate deadlines from contract</button>
              <button className="btn btn-ghost btn-sm" onClick={addDeadlineManual}>+ Add deadline</button>
            </div>
            {deadlines.length===0 && <div style={{color:'var(--text-2)',fontSize:'13px'}}>No deadlines yet. Filing an emailed contract auto-builds these; or generate / add them here. Each one creates a high-priority task and a calendar entry.</div>}
            {deadlines.map(dl=>{ const du=daysUntil(dl.due_date); const past= du!=null && du<0 && dl.status==='open'; return (
              <div key={dl.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px',background:'var(--bg-hover)',borderRadius:'8px'}}>
                <div style={{width:'4px',alignSelf:'stretch',minHeight:'34px',borderRadius:'4px',background:past?'var(--red)':(DL_STATUS_COLOR[dl.status]||'var(--accent)')}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:'13px',fontWeight:600}}>{dl.label}</div>
                  <div style={{fontSize:'12px',color:past?'var(--red)':'var(--text-2)'}}>{shortDate(dl.due_date)}{dl.status==='open'&&du!=null?` · ${du<0?`${-du}d overdue`:du===0?'today':`in ${du}d`}`:''}{dl.status!=='open'?` · ${dl.status}`:''}</div>
                </div>
                <select className="form-input" value={dl.status} onChange={e=>setDeadlineStatus(dl,e.target.value)} style={{width:'auto',padding:'4px 8px',fontSize:'12px',color:DL_STATUS_COLOR[dl.status]}}>
                  {['open','waived','met','passed','cancelled'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={()=>delDeadline(dl)} style={{color:'var(--text-3)',padding:'4px 7px'}}><Icon name="trash" size={12}/></button>
              </div>
            ); })}
          </div>
        )}

        {tab==='checklist' && (
          <div style={{display:'grid',gap:'14px'}}>
            {cats.map(cat=>(
              <div key={cat}>
                <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'6px'}}>{cat}</div>
                <div style={{display:'grid',gap:'6px'}}>
                  {items.filter(i=>(i.category||'Other')===cat).map(it=>{
                    const origin=itemOrigin(it); const done=['approved','waived','na'].includes(it.status);
                    return (
                    <div key={it.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px',background:'var(--bg-hover)',borderRadius:'8px'}}>
                      <span style={{color: done?'var(--green)':it.status==='received'?'#3b82f6':'var(--text-3)',fontWeight:700,fontSize:'15px',width:'16px',textAlign:'center',flexShrink:0}}>{done?'✓':it.status==='received'?'◐':'○'}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:'13px',display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                          <span>{it.label}</span>
                          <span title={origin==='owned'?'PrismOS generates this document':'Comes from outside — capture or request it'} style={{fontSize:'9px',fontWeight:700,letterSpacing:'.03em',textTransform:'uppercase',padding:'1px 6px',borderRadius:'999px',border:'1px solid '+(origin==='owned'?'var(--accent)':'var(--border)'),color:origin==='owned'?'var(--accent)':'var(--text-3)'}}>{origin==='owned'?'We generate':'External'}</span>
                          <span onClick={()=>toggleReq(it)} title="Toggle required" style={{cursor:'pointer',fontSize:'9px',fontWeight:700,padding:'1px 6px',borderRadius:'999px',background:it.required?'var(--accent-dim)':'transparent',border:'1px solid '+(it.required?'var(--accent)':'var(--border)'),color:it.required?'var(--accent)':'var(--text-3)'}}>{it.required?'REQUIRED':'optional'}</span>
                        </div>
                      </div>
                      {it.status==='missing' && (origin==='owned'
                        ? <button className="btn btn-primary btn-sm" onClick={()=>generateItem(it)} style={{padding:'4px 12px',whiteSpace:'nowrap'}}>Generate</button>
                        : <button className="btn btn-primary btn-sm" onClick={()=>openRequest(it)} style={{padding:'4px 12px',whiteSpace:'nowrap'}}>Request</button>)}
                      <select className="form-input" value={it.status} onChange={e=>setItemStatus(it,e.target.value)} style={{width:'auto',padding:'4px 8px',fontSize:'12px',color:CHK_META[it.status]?.color}}>
                        {CHK_STATUS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-sm" title="Remove" onClick={()=>delItem(it)} style={{padding:'4px 7px',color:'var(--text-3)'}}><Icon name="trash" size={12}/></button>
                    </div>
                  );})}
                </div>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addItem} style={{justifySelf:'start'}}>+ Add checklist item</button>
          </div>
        )}

        {tab==='docs' && (
          <div style={{display:'grid',gap:'10px'}}>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {!showUpload && <button className="btn btn-primary btn-sm" onClick={()=>setShowUpload(true)}><Icon name="paperclip" size={13}/> Upload document</button>}
              {!showStudio && !showUpload && <button className="btn btn-ghost btn-sm" onClick={()=>setShowStudio(true)} style={{color:'var(--accent)'}}><Icon name="sparkles" size={13}/> Create document</button>}
            </div>
            {showStudio && (
              <div className="panel" style={{display:'grid',gap:'8px',background:'linear-gradient(135deg,var(--bg-card),var(--bg-hover))',borderColor:'var(--accent)'}}>
                <div style={{fontSize:'13px',fontWeight:700,display:'flex',alignItems:'center',gap:'6px'}}><Icon name="sparkles" size={14}/> Document Studio</div>
                <div style={{fontSize:'12px',color:'var(--text-2)'}}>PrismOS will generate a branded, pre-filled PDF from this file’s data and drop it here.</div>
                {[['cda','Commission Disbursement Authorization','Pre-filled with price, commission, split & net'],['buyer_rep_cover','Buyer Representation Summary','Engagement cover sheet for the file'],['compliance_attestation','Broker Compliance Attestation','Auto-lists required-doc status for sign-off']].map(([t,label,desc])=>(
                  <button key={t} className="btn btn-ghost" disabled={generating} onClick={()=>generateDoc(t)} style={{justifyContent:'flex-start',textAlign:'left',display:'grid',gap:'2px',padding:'10px'}}>
                    <span style={{fontWeight:600,fontSize:'13px'}}>{label}</span>
                    <span style={{fontSize:'11px',color:'var(--text-3)'}}>{desc}</span>
                  </button>
                ))}
                <div style={{display:'flex',justifyContent:'flex-end'}}><button className="btn btn-ghost btn-sm" onClick={()=>setShowStudio(false)} disabled={generating}>{generating?'Generating…':'Close'}</button></div>
              </div>
            )}
            {showUpload && (
              <div className="panel" style={{display:'grid',gap:'8px',background:'var(--bg-hover)'}}>
                  <label className="form-label">Document type
                    <select className="form-input" value={upType} onChange={e=>setUpType(e.target.value)}>{FILE_DOC_TYPES.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>
                  </label>
                  <label className="form-label">Title (optional)<input className="form-input" value={upTitle} onChange={e=>setUpTitle(e.target.value)} placeholder={DOCTYPE_LABEL[upType]}/></label>
                  <input type="file" accept=".pdf,image/*,.doc,.docx" onChange={e=>setUpFile(e.target.files?.[0]||null)} style={{fontSize:'13px'}}/>
                  <div style={{display:'flex',justifyContent:'flex-end',gap:'8px'}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>{setShowUpload(false);setUpFile(null);}}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={doUpload} disabled={uploading}>{uploading?'Uploading…':'Upload'}</button>
                  </div>
                </div>)}
            {docs.length===0 && <div style={{color:'var(--text-2)',fontSize:'13px',padding:'8px'}}>No documents yet.</div>}
            {docs.map(d=>{
              const rs=d.review_status; const rsColor= rs==='approved'?'var(--green)':rs==='rejected'?'var(--red)':rs==='revision_requested'?'var(--yellow)':'var(--text-3)';
              return (
                <div key={d.id} className="panel" style={{display:'grid',gap:'6px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'8px',alignItems:'flex-start'}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:'13px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.title||DOCTYPE_LABEL[d.doc_type]}</div>
                      <div style={{fontSize:'11px',color:'var(--text-3)'}}>{d.file_name} · {d.size_bytes?Math.round(d.size_bytes/1024)+'KB':''}</div>
                      <div style={{display:'flex',gap:'5px',flexWrap:'wrap',marginTop:'4px'}}><OriginChip d={d}/><LifecycleChip state={d.execution_state}/></div>
                    </div>
                    <span style={{fontSize:'10px',fontWeight:700,color:rsColor,whiteSpace:'nowrap'}}>{(rs||'pending').replace('_',' ')}</span>
                  </div>
                  <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
                    <select className="form-input" value={d.doc_type} onChange={e=>setDocType(d,e.target.value)} style={{width:'auto',padding:'4px 8px',fontSize:'12px'}}>{FILE_DOC_TYPES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select>
                    <button className="btn btn-ghost btn-sm" onClick={()=>viewDoc(d)}><Icon name="eye" size={12}/> View</button>
                    <button className="btn btn-ghost btn-sm" disabled={!!extracting[d.id]} onClick={()=>extractDoc(d)} title="Use AI to read figures (price, dates, commission) from this document">{extracting[d.id]?'Reading…':'Extract figures'}</button>
                    {isAdmin && <>
                      <button className="btn btn-ghost btn-sm" style={{color:'var(--green)'}} onClick={()=>reviewDoc(d,'approved')}>Approve</button>
                      <button className="btn btn-ghost btn-sm" style={{color:'var(--yellow)'}} onClick={()=>reviewDoc(d,'revision_requested')}>Revise</button>
                      <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={()=>reviewDoc(d,'rejected')}>Reject</button>
                    </>}
                    <button className="btn btn-ghost btn-sm" onClick={()=>delDoc(d)} style={{color:'var(--text-3)'}}><Icon name="trash" size={12}/></button>
                  </div>
                  {(() => { const sr=sigByDoc[d.id]; const executed=d.execution_state==='executed';
                    if(executed) return <div style={{fontSize:'11px',color:'var(--green)',fontWeight:600}}>✓ Executed via PrismOS e-Sign</div>;
                    if(sr){ const signed=(sr.signers||[]).filter(s=>s.status==='signed').length; const total=(sr.signers||[]).length; const declined=(sr.signers||[]).some(s=>s.status==='declined');
                      return <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'11px',flexWrap:'wrap'}}><span style={{color:declined?'var(--red)':'var(--accent)',fontWeight:600}}>{declined?'Declined':`Out for signature — ${signed}/${total} signed`}</span><button className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'11px'}} onClick={()=>setManageReq(sr)}>Manage</button><button className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'11px'}} onClick={async()=>{ const links=(sr.signers||[]).map(s=>`${s.name}: https://darasapp.com/sign/${s.token}`).join('\n'); try{ await navigator.clipboard.writeText(links); if(window.__notify) window.__notify('Signing links copied.','success'); }catch(_){}}}>Copy links</button></div>;
                    }
                    return <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}><button className="btn btn-ghost btn-sm" onClick={()=>setSignDoc(d)} style={{color:'var(--accent)',padding:'2px 8px',fontSize:'12px'}}>✍ Send for signature</button><button className="btn btn-ghost btn-sm" onClick={()=>signMyself(d)} style={{color:'var(--text-2)',padding:'2px 8px',fontSize:'12px'}}>Sign it yourself</button></div>;
                  })()}
                  {d.reviewer_note && <div style={{fontSize:'11px',color:'var(--text-2)',fontStyle:'italic'}}>Note: {d.reviewer_note}</div>}
                </div>
              );
            })}
          </div>
        )}

        {tab==='closing' && (
          <div style={{display:'grid',gap:'12px'}}>
            <div className="panel" style={{display:'grid',gap:'6px',background:'var(--bg-hover)'}}>
              <div style={{fontWeight:700,fontSize:'13px'}}>Disbursement readiness</div>
              {[['All required documents approved', reqItems.length>0 && reqDone===reqItems.length],['Closing Disclosure received', !!ov.cd_received],['Commission reconciled', commReconciled]].map((row,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px'}}>
                  <span style={{color: row[1]?'var(--green)':'var(--text-3)',fontWeight:700}}>{row[1]?'✓':'○'}</span>
                  <span style={{color: row[1]?'var(--text-1)':'var(--text-2)'}}>{row[0]}</span>
                </div>
              ))}
            </div>
            <div className="panel" style={{display:'grid',gap:'4px'}}>
              <div style={{fontWeight:700,fontSize:'13px',marginBottom:'4px'}}>Commission reconciliation</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px'}}><span style={{color:'var(--text-2)'}}>Expected (file)</span><span>{expectedComm!=null?money(expectedComm):'—'}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px'}}><span style={{color:'var(--text-2)'}}>Per Closing Disclosure</span><span>{cdComm!=null?money(cdComm):'—'}</span></div>
              {commVariance!=null && <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',fontWeight:700,color: commReconciled?'var(--green)':'var(--red)'}}><span>Variance</span><span>{commVariance>=0?'+':''}{money(commVariance)}</span></div>}
              {cdComm==null && <div style={{fontSize:'12px',color:'var(--text-3)'}}>File the Closing Disclosure (or use “Extract figures” on it in Documents) to pull the commission.</div>}
            </div>
            <div className="panel" style={{display:'grid',gap:'6px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{fontWeight:700,fontSize:'13px'}}>Commission Disbursement Authorization</div><button className="btn btn-ghost btn-sm" onClick={copyCDA}>Copy</button></div>
              <pre style={{whiteSpace:'pre-wrap',fontSize:'12px',color:'var(--text-2)',margin:0,fontFamily:'inherit'}}>{cdaText()}</pre>
            </div>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {missingItems.length>0 && <button className="btn btn-ghost btn-sm" onClick={()=>setShowMissing(true)}>Request missing docs ({missingItems.length})</button>}
              {ov.status!=='paid'
                ? <button className="btn btn-primary btn-sm" disabled={!readyToDisburse} onClick={markPaid} title={readyToDisburse?'':'Complete required docs + Closing Disclosure first'}>Mark paid</button>
                : <span style={{fontSize:'13px',color:'var(--green)',fontWeight:700,alignSelf:'center'}}>✓ Paid {ov.paid_amount!=null?money(ov.paid_amount):''} {ov.paid_method?`via ${ov.paid_method}`:''} {ov.paid_at?`· ${shortDate(ov.paid_at.slice(0,10))}`:''}</span>}
            </div>
            {!readyToDisburse && ov.status!=='paid' && <div style={{fontSize:'12px',color:'var(--text-3)'}}>“Mark paid” unlocks once required docs are approved and the Closing Disclosure is in.</div>}
          </div>
        )}

        {tab==='cda' && isAdmin && (
          <div style={{display:'grid',gap:'12px'}}>
            <label className="form-label">Agent on this deal
              <select className="form-input" value={cdaAgentId} onChange={e=>pickAgent(e.target.value)}>
                <option value="">— select agent —</option>
                {cdaAgents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {cdaAgentId && !cdaPlan && <div style={{fontSize:'12px',color:'var(--yellow)'}}>No active pay plan for this agent yet — add one in Brokerage. Calculations will be partial.</div>}

            <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--accent)'}}>File financials</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label className="form-label">Sides represented<select className="form-input" value={cda.sides||'buyer'} onChange={e=>setCdaF('sides',e.target.value)}><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="both">Both (dual)</option></select></label>
              <label className="form-label">Total commission %<input className="form-input" value={cda.total_rate??''} onChange={e=>setCdaF('total_rate',e.target.value)} placeholder="e.g. 6"/></label>
              <label className="form-label">Our side GCI $ (optional override)<input className="form-input" value={cda.our_gci??''} onChange={e=>setCdaF('our_gci',e.target.value)} placeholder="auto if blank"/></label>
              <label className="form-label">Outbound referral $<input className="form-input" value={cda.referral_fee??''} onChange={e=>setCdaF('referral_fee',e.target.value)}/></label>
              <label className="form-label">Referral to<input className="form-input" value={cda.referral_to??''} onChange={e=>setCdaF('referral_to',e.target.value)}/></label>
              <label className="form-label">Agent owes brokerage $<input className="form-input" value={cda.agent_owes??''} onChange={e=>setCdaF('agent_owes',e.target.value)}/></label>
              <label className="form-label">Owed note<input className="form-input" value={cda.agent_owes_note??''} onChange={e=>setCdaF('agent_owes_note',e.target.value)} placeholder="e.g. sign rider"/></label>
              <label className="form-label">Recruiting email (copy to)<input className="form-input" value={cda.recruiting_email??''} onChange={e=>setCdaF('recruiting_email',e.target.value)}/></label>
            </div>

            <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--accent)'}}>Contacts (for the CDA)</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <label className="form-label">Buyer phone<input className="form-input" value={cda.buyer_phone??''} onChange={e=>setCdaF('buyer_phone',e.target.value)}/></label>
              <label className="form-label">Buyer email<input className="form-input" value={cda.buyer_email??''} onChange={e=>setCdaF('buyer_email',e.target.value)}/></label>
              <label className="form-label">Seller phone<input className="form-input" value={cda.seller_phone??''} onChange={e=>setCdaF('seller_phone',e.target.value)}/></label>
              <label className="form-label">Seller email<input className="form-input" value={cda.seller_email??''} onChange={e=>setCdaF('seller_email',e.target.value)}/></label>
              <label className="form-label">Co-op brokerage<input className="form-input" value={cda.coop_brokerage??''} onChange={e=>setCdaF('coop_brokerage',e.target.value)}/></label>
              <label className="form-label">Co-op agent<input className="form-input" value={cda.coop_agent_name??''} onChange={e=>setCdaF('coop_agent_name',e.target.value)}/></label>
              <label className="form-label">Co-op agent phone<input className="form-input" value={cda.coop_agent_phone??''} onChange={e=>setCdaF('coop_agent_phone',e.target.value)}/></label>
              <label className="form-label">Co-op agent email<input className="form-input" value={cda.coop_agent_email??''} onChange={e=>setCdaF('coop_agent_email',e.target.value)}/></label>
              <label className="form-label">Title company<input className="form-input" value={cda.title_company??''} onChange={e=>setCdaF('title_company',e.target.value)}/></label>
              <label className="form-label">Title contact<input className="form-input" value={cda.title_contact??''} onChange={e=>setCdaF('title_contact',e.target.value)}/></label>
              <label className="form-label">Title phone<input className="form-input" value={cda.title_phone??''} onChange={e=>setCdaF('title_phone',e.target.value)}/></label>
              <label className="form-label">Title email<input className="form-input" value={cda.title_email??''} onChange={e=>setCdaF('title_email',e.target.value)}/></label>
              <label className="form-label">Mortgage company<input className="form-input" value={cda.lender_company??''} onChange={e=>setCdaF('lender_company',e.target.value)}/></label>
              <label className="form-label">Loan officer<input className="form-input" value={cda.loan_officer??''} onChange={e=>setCdaF('loan_officer',e.target.value)}/></label>
              <label className="form-label">Lender phone<input className="form-input" value={cda.lender_phone??''} onChange={e=>setCdaF('lender_phone',e.target.value)}/></label>
              <label className="form-label">Lender email<input className="form-input" value={cda.lender_email??''} onChange={e=>setCdaF('lender_email',e.target.value)}/></label>
            </div>

            <div className="panel" style={{display:'grid',gap:'3px',background:'var(--bg-hover)'}}>
              <div style={{fontWeight:700,fontSize:'13px',marginBottom:'4px'}}>Live calculation</div>
              {[['Total commission',money(cdaCalc.totalComm)],['Co-op brokerage GCI',money(cdaCalc.coopGci)],...(cdaCalc.referral?[['Referral out','− '+money(cdaCalc.referral)]]:[]),...(cdaCalc.royalty?[['Franchise/royalty','− '+money(cdaCalc.royalty)]]:[]),['ROG GCI',money(cdaCalc.gciNet)],['Agent gross'+(cdaCalc.split!=null?` (${cdaCalc.split}%)`:''),money(cdaCalc.agentGross)]].map((r,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:'12px'}}><span style={{color:'var(--text-2)'}}>{r[0]}</span><span style={{fontWeight:i===4||i===5?700:400}}>{r[1]}</span></div>
              ))}
              {cdaCalc.disclosedFees.map((x,i)=><div key={'f'+i} style={{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'var(--red)'}}><span>{x.label}</span><span>− {money(x.amount)}</span></div>)}
              {cdaCalc.contrib.map((x,i)=><div key={'c'+i} style={{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'var(--text-3)'}}><span>Routed: {x.label}</span><span>− {money(x.amount)}</span></div>)}
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'14px',fontWeight:800,color:'var(--green)',borderTop:'1px solid var(--border)',marginTop:'4px',paddingTop:'4px'}}><span>Net cash to agent</span><span>{money(cdaCalc.agentCash)}</span></div>
              {cdaPlan?.split_type==='cap' && num(cdaPlan?.cap_amount)!=null && <div style={{fontSize:'11px',color:cdaCalc.capNote?'var(--accent)':'var(--text-3)',marginTop:'4px'}}>Cap: {money(cdaCapYtd)} / {money(num(cdaPlan.cap_amount))} company dollar YTD{cdaCalc.capNote?` · ${cdaCalc.capNote}`:''}</div>}
            </div>

            {(cdaCalc.hiddenFees.length>0 || cdaCalc.profitShare>0) && (
              <div className="panel" style={{display:'grid',gap:'3px',border:'1px dashed var(--text-3)'}}>
                <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',color:'var(--text-3)'}}>Internal only — not on CDA</div>
                {cdaCalc.profitShare>0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:'12px'}}><span style={{color:'var(--text-2)'}}>Profit share to upline{uplineObj?` (${uplineObj.name})`:''}</span><span>{money(cdaCalc.profitShare)}</span></div>}
                {cdaCalc.hiddenFees.map((x,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:'12px'}}><span style={{color:'var(--text-2)'}}>{x.label} (hidden)</span><span>{money(x.amount)}</span></div>)}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'var(--text-3)'}}><span>Company dollar retained</span><span>{money(cdaCalc.companyDollar)}</span></div>
              </div>
            )}

            <div style={{display:'flex',justifyContent:'flex-end',gap:'8px'}}>
              <button className="btn btn-ghost" onClick={saveCda}>Save inputs</button>
              <button className="btn btn-primary" onClick={generateCda} disabled={cdaBusy}>{cdaBusy?'Generating…':'Generate CDA'}</button>
            </div>
          </div>
        )}

        {tab==='parties' && (
          <div style={{display:'grid',gap:'10px'}}>
            <div className="panel" style={{display:'grid',gap:'8px',background:'var(--bg-hover)'}}>
              <div style={{display:'flex',gap:'8px'}}>
                <select className="form-input" value={pRole} onChange={e=>setPRole(e.target.value)} style={{width:'auto'}}>
                  {['buyer','seller','co_op_agent','lender','title','inspector','attorney','other'].map(r=><option key={r} value={r}>{r.replace('_',' ')}</option>)}
                </select>
                <input className="form-input" value={pSearch} onChange={e=>setPSearch(e.target.value)} placeholder="Search contacts or type a name"/>
              </div>
              {partyMatches.length>0 && <div style={{display:'grid',gap:'4px'}}>{partyMatches.map(c=><button key={c.id} className="btn btn-ghost btn-sm" style={{justifyContent:'flex-start',textAlign:'left'}} onClick={()=>addParty(c)}>{c.name}{c.company?` · ${c.company}`:''}</button>)}</div>}
              <button className="btn btn-primary btn-sm" onClick={()=>addParty(null)} style={{justifySelf:'start'}}>+ Add party</button>
            </div>
            {parties.length===0 && <div style={{color:'var(--text-2)',fontSize:'13px'}}>No parties added.</div>}
            {parties.map(pt=>(
              <div key={pt.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px',background:'var(--bg-hover)',borderRadius:'8px'}}>
                <div><span style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',color:'var(--accent)'}}>{(pt.role||'').replace('_',' ')}</span><div style={{fontSize:'13px'}}>{pt.name}</div></div>
                <button className="btn btn-ghost btn-sm" onClick={()=>delParty(pt)} style={{color:'var(--text-3)'}}><Icon name="trash" size={12}/></button>
              </div>
            ))}
          </div>
        )}

        {tab==='activity' && (
          <div style={{display:'grid',gap:'6px'}}>
            {events.length===0 && <div style={{color:'var(--text-2)',fontSize:'13px'}}>No activity yet.</div>}
            {events.map(ev=>(
              <div key={ev.id} style={{display:'flex',gap:'10px',fontSize:'12px',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                <span style={{color:'var(--text-3)',whiteSpace:'nowrap'}}>{new Date(ev.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})} {new Date(ev.created_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</span>
                <span style={{color:'var(--text-1)'}}>{ev.detail||ev.kind}</span>
              </div>
            ))}
          </div>
        )}
        </>}
      </div>
      {showMissing && <MissingDocsComposer file={file} ov={ov} missingItems={requestScope||missingItems} parties={parties} contacts={contacts} userId={userId} onClose={()=>{ setShowMissing(false); setRequestScope(null); }} onSent={()=>{ const n=(requestScope||missingItems).length; logFileEvent(fileId,userId,'missing_docs_requested',`Requested ${n} document(s)${requestScope?`: ${requestScope[0].label}`:''}`); }} />}
      {signDoc && <SignatureRequestModal file={file} doc={signDoc} parties={parties} contacts={contacts} userId={userId} onClose={()=>setSignDoc(null)} onCreated={()=>{ loadSigs(); }} />}
      {manageReq && <SignatureManageModal request={manageReq} file={file} userId={userId} onClose={()=>setManageReq(null)} onChanged={()=>{ loadSigs(); }} />}
      {selfSign && (
        <div className="modal-overlay" style={{zIndex:2400,padding:'12px'}}>
          <div style={{position:'relative',width:'100%',maxWidth:'660px',maxHeight:'94vh',overflowY:'auto',borderRadius:'12px'}}>
            <button className="modal-close" style={{position:'absolute',top:10,right:12,zIndex:3,background:'rgba(0,0,0,.4)',borderRadius:'50%'}} onClick={closeSelfSign}>×</button>
            <SignPortal token={selfSign}/>
          </div>
        </div>
      )}
    </div>
  );
}
