// ── File / document domain ─ extracted from App.js (strangle) ──
// Status/checklist config, origin+status chips, and the file-event logger. Shared
// across FileDetailModal, DocumentsView, the signature flow and email-filing.
import React from 'react';
import { supabase } from './dataService';

export function docOriginMeta(d){
  if(d.source==='generated') return { label:'PrismOS', color:'var(--accent)' };
  if(d.source==='email')     return { label:'From email', color:'#3b82f6' };
  return { label:'Uploaded', color:'var(--text-3)' };
}
export function OriginChip({ d }){ const m=docOriginMeta(d); return <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'.03em',textTransform:'uppercase',padding:'1px 7px',borderRadius:'999px',border:`1px solid ${m.color}`,color:m.color,whiteSpace:'nowrap'}}>{m.label}</span>; }
export function LifecycleChip({ state }){ const m={executed:{l:'Executed',c:'var(--green)'},draft:{l:'Draft',c:'var(--text-3)'},partial:{l:'Partial',c:'var(--yellow)'}}[state]; if(!m) return null; return <span style={{fontSize:'9px',fontWeight:700,padding:'1px 7px',borderRadius:'999px',background:m.c,color:'#fff',whiteSpace:'nowrap'}}>{m.l}</span>; }
export const FILE_STATUSES = [
  { value:'prospect',       label:'Prospect',        color:'var(--text-3)' },
  { value:'active',         label:'Active',          color:'#3b82f6' },
  { value:'under_contract', label:'Under Contract',  color:'var(--accent)' },
  { value:'pending',        label:'Pending',         color:'#a855f7' },
  { value:'clear_to_close', label:'Clear to Close',  color:'#14b8a6' },
  { value:'closed',         label:'Closed',          color:'var(--green)' },
  { value:'paid',           label:'Paid',            color:'var(--green)' },
  { value:'cancelled',      label:'Cancelled',       color:'var(--red)' },
];
export const STATUS_META = Object.fromEntries(FILE_STATUSES.map(s=>[s.value,s]));
export const CHK_STATUS = [
  { value:'missing',  label:'Missing',  color:'var(--text-3)' },
  { value:'received', label:'Received', color:'#3b82f6' },
  { value:'approved', label:'Approved', color:'var(--green)' },
  { value:'waived',   label:'Waived',   color:'var(--yellow)' },
  { value:'na',       label:'N/A',      color:'var(--text-3)' },
];
export const CHK_META = Object.fromEntries(CHK_STATUS.map(s=>[s.value,s]));
export const FARBAR_BUYER_CHECKLIST = [
  { key:'farbar_contract',   label:'FAR/BAR Contract (AS IS), fully executed', required:true,  cat:'Contract' },
  { key:'as_is_rider',       label:'AS IS / Comprehensive Rider',              required:false, cat:'Contract' },
  { key:'addenda',           label:'Addenda / Amendments (as applicable)',     required:false, cat:'Contract' },
  { key:'buyer_brokerage',   label:'Buyer Brokerage Agreement (signed)',       required:true,  cat:'Agency' },
  { key:'agency_disclosure', label:'Brokerage Relationship Disclosure',        required:true,  cat:'Agency' },
  { key:'seller_disclosure', label:'Seller’s Property Disclosure',        required:true,  cat:'Disclosures' },
  { key:'lead_paint',        label:'Lead-Based Paint Disclosure (pre-1978)',   required:false, cat:'Disclosures' },
  { key:'hoa_condo',         label:'HOA / Condo docs & rider (if applicable)', required:false, cat:'Disclosures' },
  { key:'financing',         label:'Pre-Approval or Proof of Funds',           required:true,  cat:'Financing' },
  { key:'emd_receipt',       label:'Escrow / EMD deposit receipt',             required:true,  cat:'Escrow' },
  { key:'inspection',        label:'Inspection / WDO report (or waiver)',      required:false, cat:'Inspections' },
  { key:'title_commitment',  label:'Title commitment',                         required:false, cat:'Closing' },
  { key:'closing_disclosure',label:'Closing Disclosure / ALTA settlement',     required:true,  cat:'Closing' },
  { key:'cda',               label:'Commission Disbursement Authorization',    required:true,  cat:'Closing' },
];
export function logFileEvent(fileId, userId, kind, detail, meta){
  return supabase.from('file_events').insert({ file_id:fileId, user_id:userId, kind, detail:detail||null, meta:meta||{} }).then(()=>{}).catch(()=>{});
}

export function shortDate(d){ if(!d) return '—'; try{ return new Date(d+(d.length<=10?'T00:00:00':'')).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }catch(e){ return d; } }
export function StatusPill({ status }){ const m=STATUS_META[status]||{label:status,color:'var(--text-3)'}; return <span style={{fontSize:'10px',fontWeight:700,padding:'2px 9px',borderRadius:'999px',background:m.color,color:'#fff',whiteSpace:'nowrap'}}>{m.label}</span>; }

// doc-type + deadline-waiver config and helpers (file subsystem)
export const FILE_DOC_TYPES = [
  { value:'farbar_contract',   label:'FAR/BAR Contract (AS IS)',            cat:'Contract' },
  { value:'as_is_rider',       label:'AS IS / Comprehensive Rider',         cat:'Contract' },
  { value:'addendum',          label:'Addendum',                            cat:'Contract' },
  { value:'amendment',         label:'Amendment',                           cat:'Contract' },
  { value:'counteroffer',      label:'Counteroffer',                        cat:'Contract' },
  { value:'buyer_brokerage',   label:'Buyer Brokerage Agreement',           cat:'Agency' },
  { value:'agency_disclosure', label:'Brokerage Relationship Disclosure',   cat:'Agency' },
  { value:'seller_disclosure', label:'Seller’s Property Disclosure',   cat:'Disclosures' },
  { value:'lead_paint',        label:'Lead-Based Paint Disclosure',         cat:'Disclosures' },
  { value:'hoa_condo',         label:'HOA / Condo Docs & Rider',            cat:'Disclosures' },
  { value:'financing',         label:'Pre-Approval / Proof of Funds',       cat:'Financing' },
  { value:'loan_estimate',     label:'Loan Estimate',                       cat:'Financing' },
  { value:'emd_receipt',       label:'Escrow / EMD Receipt',                cat:'Escrow' },
  { value:'inspection',        label:'Inspection Report',                   cat:'Inspections' },
  { value:'wdo',               label:'WDO / Termite Report',                cat:'Inspections' },
  { value:'appraisal',         label:'Appraisal',                           cat:'Inspections' },
  { value:'dd_waiver',         label:'Inspection Period Waiver',            cat:'Waivers' },
  { value:'appraisal_waiver',  label:'Appraisal Contingency Waiver',        cat:'Waivers' },
  { value:'financing_waiver',  label:'Financing Contingency Waiver',        cat:'Waivers' },
  { value:'title_commitment',  label:'Title Commitment',                    cat:'Closing' },
  { value:'closing_disclosure',label:'Closing Disclosure / ALTA',           cat:'Closing' },
  { value:'cda',               label:'Commission Disbursement Authorization',cat:'Closing' },
  { value:'wire_instructions', label:'Wire Instructions',                   cat:'Closing' },
  { value:'misc',              label:'Other Document',                      cat:'Other' },
];

export const DOCTYPE_LABEL = Object.fromEntries(FILE_DOC_TYPES.map(d=>[d.value,d.label]));

export const DOCTYPE_TO_ITEM = {
  farbar_contract:'farbar_contract', as_is_rider:'as_is_rider',
  addendum:'addenda', amendment:'addenda', counteroffer:'addenda',
  buyer_brokerage:'buyer_brokerage', agency_disclosure:'agency_disclosure',
  seller_disclosure:'seller_disclosure', lead_paint:'lead_paint', hoa_condo:'hoa_condo',
  financing:'financing', loan_estimate:'financing', emd_receipt:'emd_receipt',
  inspection:'inspection', wdo:'inspection', appraisal:'inspection',
  title_commitment:'title_commitment', closing_disclosure:'closing_disclosure', cda:'cda',
};

export const WAIVER_TO_KIND = { dd_waiver:'inspection', appraisal_waiver:'appraisal', financing_waiver:'financing' };

export async function resolveDeadlineWaiver(fileId, userId, kind){
  const { data:dls } = await supabase.from('file_deadlines').select('*').eq('file_id',fileId).eq('kind',kind).eq('status','open');
  for(const dl of (dls||[])){ await supabase.from('file_deadlines').update({status:'waived',updated_at:new Date().toISOString()}).eq('id',dl.id); if(dl.task_id) await supabase.from('tasks').update({completed:true}).eq('id',dl.task_id); await logFileEvent(fileId,userId,'contingency_waived',`${dl.label} waived`); }
  return (dls||[]).length;
}

export function consistencyFlags(docs){
  const fields=[['price','Contract price',v=>'$'+Number(v).toLocaleString()],['closing_date','Closing date',v=>v],['address','Property address',v=>v],['buyer','Buyer',v=>v],['seller','Seller',v=>v]];
  const flags=[];
  for(const [key,label,fmt] of fields){
    const seen={};
    for(const d of docs){ const t=d.extracted_terms||{}; let v=t[key]; if(key==='price'&&v!=null) v=Number(v); if(v===null||v===undefined||v==='') continue; const norm=(key==='address'||key==='buyer'||key==='seller')?String(v).toLowerCase().replace(/[^a-z0-9]/g,''):String(v); if(!seen[norm]) seen[norm]={val:v,docs:[]}; seen[norm].docs.push(DOCTYPE_LABEL[d.doc_type]||d.doc_type); }
    const vals=Object.values(seen);
    if(vals.length>1) flags.push({ label, variants: vals.map(x=>({ value: fmt(x.val), docs:[...new Set(x.docs)] })) });
  }
  return flags;
}

export function sigToken(){ return (crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Math.random().toString(36).slice(2)) + Math.random().toString(36).slice(2,8); }

// item origin + deadline generation (file subsystem)
export const OWNED_ITEM_KEYS = new Set(['cda','buyer_rep_cover','compliance_attestation','broker_cover']);

export function itemOrigin(it){ return OWNED_ITEM_KEYS.has(it.item_key) ? 'owned' : 'external'; }

export async function createDeadline(fileId, userId, kind, label, due_date, source, addr){
  let task_id=null, event_id=null;
  try{ const { data:task } = await supabase.from('tasks').insert({ user_id:userId, title:`${label} — ${addr||'file'}`, due_date, priority:'high', list:'inbox', notes:'Auto-generated from a buyer file (contract deadline).', completed:false }).select().single(); task_id=task?.id||null; }catch(e){}
  try{ const s=new Date(`${due_date}T13:00:00.000Z`).toISOString(); const e2=new Date(`${due_date}T13:30:00.000Z`).toISOString(); const { data:ev } = await supabase.from('events').insert({ user_id:userId, title:`${label}: ${addr||''}`.trim(), start_at:s, end_at:e2, all_day:true, category:'deadline', sync_status:'local', task_id }).select().single(); event_id=ev?.id||null; }catch(e){}
  const { data:dl } = await supabase.from('file_deadlines').insert({ file_id:fileId, user_id:userId, kind, label, due_date, status:'open', source, task_id, event_id }).select().single();
  return dl||null;
}

export async function generateDeadlinesFromTerms(fileId, userId, ai, addr){
  if(!ai) return [];
  const { data:existing } = await supabase.from('file_deadlines').select('kind,status').eq('file_id',fileId);
  const have = new Set((existing||[]).filter(d=>d.status!=='cancelled').map(d=>d.kind));
  const made=[];
  for(const def of DEADLINE_DEFS){ const v=ai[def.field]; if(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !have.has(def.kind)){ const dl=await createDeadline(fileId,userId,def.kind,def.label,v,'extracted',addr); if(dl){ made.push(dl); await logFileEvent(fileId,userId,'deadline_created',`${def.label} — ${v}`); } } }
  if(Array.isArray(ai.waives)){ for(const w of ai.waives){ if(['inspection','appraisal','financing'].includes(w)) await resolveDeadlineWaiver(fileId,userId,w); } }
  return made;
}

export function daysUntil(d){ if(!d) return null; const ms=new Date(d+'T00:00:00').getTime()-Date.now(); return Math.ceil(ms/86400000); }
