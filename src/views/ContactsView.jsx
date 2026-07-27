import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { Tip, useBackClose, ContactDetailModal, HeaderSearchInput, Icon, MultiValueField, PropertyModal, QuoTextModal, SingleContactPicker, cadenceDue, confirmDialog, modal, notify, quoCall, quoNormPhone, owesReply, TipFor} from '../App';
import { BulkDiscComposer, dominantDiscLetter, DISC_STYLE_META } from './BulkDiscComposer';

const CONTACT_TYPES = [
  // Clients & Leads
  { id: 'client_residential', label: 'Client – Residential', icon: '🏠', category: 'Clients & Leads' },
  { id: 'client_commercial',  label: 'Client – Commercial',  icon: '🏬', category: 'Clients & Leads' },
  { id: 'buyer_lead',         label: 'Buyer Lead',           icon: '🔑', category: 'Clients & Leads' },
  { id: 'seller_lead',        label: 'Seller Lead',          icon: '🏷️', category: 'Clients & Leads' },
  { id: 'lead',               label: 'Lead',                 icon: '🌱', category: 'Clients & Leads' },
  { id: 'past_client',        label: 'Past Client',          icon: '⭐', category: 'Clients & Leads' },
  { id: 'renter_tenant',      label: 'Renter / Tenant',      icon: '🗝️', category: 'Clients & Leads' },
  { id: 'landlord',           label: 'Landlord',             icon: '🏘️', category: 'Clients & Leads' },
  { id: 'investor',           label: 'Investor',             icon: '📈', category: 'Clients & Leads' },
  { id: 'fsbo',               label: 'FSBO',                 icon: '🪧', category: 'Clients & Leads' },
  { id: 'expired',            label: 'Expired Listing',      icon: '⌛', category: 'Clients & Leads' },
  { id: 'flipper',            label: 'Flipper',              icon: '🔄', category: 'Clients & Leads' },
  // Brokerage & Agents (restricted = owners / broker admins / team leaders only)
  { id: 'our_agent',          label: 'Our Agent',            icon: '🌟', category: 'Brokerage & Agents', cls: 'restricted' },
  { id: 'staff',              label: 'Brokerage Staff',      icon: '🧑‍💻', category: 'Brokerage & Agents', cls: 'restricted' },
  { id: 'prospect_agent',     label: 'Prospect Agent',       icon: '🎣', category: 'Brokerage & Agents' },
  { id: 'recruit',            label: 'Recruit',              icon: '🎯', category: 'Brokerage & Agents' },
  { id: 'broker',             label: 'Broker',               icon: '👔', category: 'Brokerage & Agents' },
  { id: 'brokerage',          label: 'Brokerage',            icon: '🏢', category: 'Brokerage & Agents' },
  { id: 'agent',              label: 'Agent (other brokerage)', icon: '🤝', category: 'Brokerage & Agents' },
  // Transaction Partners
  { id: 'lender',             label: 'Lender',               icon: '🏦', category: 'Transaction Partners' },
  { id: 'title_escrow',       label: 'Title / Escrow',       icon: '📜', category: 'Transaction Partners' },
  { id: 'inspector',          label: 'Home Inspector',       icon: '🔍', category: 'Transaction Partners' },
  { id: 'appraiser',          label: 'Appraiser',            icon: '📐', category: 'Transaction Partners' },
  { id: 'attorney',           label: 'Attorney',             icon: '⚖️', category: 'Transaction Partners' },
  { id: 'insurance',          label: 'Insurance Agent',      icon: '🛡️', category: 'Transaction Partners' },
  { id: 'transaction_coordinator', label: 'Transaction Coordinator', icon: '📑', category: 'Transaction Partners' },
  { id: 'property_manager',   label: 'Property Manager',     icon: '🏤', category: 'Transaction Partners' },
  { id: 'stager_photographer',label: 'Stager / Photographer',icon: '📸', category: 'Transaction Partners' },
  // Trades & Construction
  { id: 'contractor',         label: 'Contractor',           icon: '🛠️', category: 'Trades & Construction' },
  { id: 'builder',            label: 'Builder',              icon: '🔨', category: 'Trades & Construction' },
  { id: 'developer',          label: 'Developer',            icon: '🏗️', category: 'Trades & Construction' },
  { id: 'commercial_tenant',  label: 'Commercial Tenant',    icon: '🏪', category: 'Trades & Construction' },
  // Professional Network
  { id: 'referral_partner',   label: 'Referral Partner',     icon: '🔗', category: 'Professional Network' },
  { id: 'cpa_financial',      label: 'CPA / Financial',      icon: '💵', category: 'Professional Network' },
  { id: 'doctor',             label: 'Doctor',               icon: '🩺', category: 'Professional Network' },
  { id: 'regulator',          label: 'Regulator',            icon: '📋', category: 'Professional Network' },
  { id: 'investments',        label: 'Investments',          icon: '💰', category: 'Professional Network' },
  // Personal
  { id: 'family',             label: 'Family',               icon: '👨‍👩‍👧', category: 'Personal' },
  { id: 'friend',             label: 'Friend',               icon: '🫂', category: 'Personal' },
  { id: 'personal',           label: 'Personal',             icon: '💛', category: 'Personal' },
  // Other / Legacy
  { id: 'vendor',             label: 'Vendor',               icon: '🔧', category: 'Other' },
  { id: 'partner',            label: 'Partner',              icon: '🤲', category: 'Other' },
  { id: 'client',             label: 'Client (legacy)',      icon: '🤝', category: 'Other' },
  { id: 'misc',               label: 'Misc',                 icon: '🗂️', category: 'Other' },
  { id: 'other',              label: 'Other',                icon: '❓', category: 'Other' },
];
const CONTACT_TYPE_LABELS = Object.fromEntries(CONTACT_TYPES.map(t => [t.id, t.label]));

// Live, expandable type list sourced from the contact_types table (falls back to the
// built-in list). Restricted types are filtered out unless the viewer is privileged.
function useContactTypes(canSeeRestricted){
  const [db,setDb]=useState(null);
  const reload=useCallback(async()=>{ try{ const { data } = await supabase.from('contact_types').select('id,label,icon,category,sort_order,visibility_class').eq('is_active',true).order('sort_order'); if(data && data.length) setDb(data.map(x=>({id:x.id,label:x.label,icon:x.icon,category:x.category,cls:x.visibility_class}))); }catch(_e){} },[]);
  useEffect(()=>{ reload(); },[reload]);
  const list = db || CONTACT_TYPES;
  return [list.filter(t => canSeeRestricted || (t.cls||'standard')!=='restricted'), reload];
}

// Create a private custom type owned by the current user (RLS keeps it private).
async function createCustomType(userId, label, icon){
  const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const { data, error } = await supabase.from('contact_types').insert({ id, label: (label||'').trim(), icon: icon||'🏷️', category: 'My Types', sort_order: 800, visibility_class: 'standard', owner_user_id: userId, is_active: true }).select().single();
  if(error) throw error;
  return data;
}

// Turn a Supabase/Postgres error into a specific, human-readable reason so save
// failures aren't hidden behind a generic toast. Full error is also logged.
function describeSaveError(error, verb = 'save') {
  const base = `Couldn't ${verb} contact`;
  if (!error) return `${base}. Try again.`;
  const code = error.code || '';
  const map = {
    '23514': 'a field has a value that isn’t allowed.',
    '23503': 'a selected option no longer exists — refresh and try again.',
    '23505': 'a contact with that value already exists.',
    '23502': 'a required field is missing.',
    '22P02': 'a field has an invalid value.',
    '42501': 'you don’t have permission to change this contact.',
  };
  const reason = map[code] || (error.message ? error.message : 'please try again.');
  return `${base}: ${reason}`;
}

// ─────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────

// Collapsible, labeled section used throughout the contact edit form. Defined at
// module scope so it keeps a stable identity (inputs inside never lose focus).
function EditSection({ icon, title, hint, summary, open, onToggle, children }) {
  return (
    <div style={{marginTop:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',overflow:'hidden'}}>
      <button type="button" onClick={onToggle} style={{width:'100%',display:'flex',alignItems:'center',gap:'10px',padding:'12px 14px',background:'transparent',border:'none',cursor:'pointer',textAlign:'left'}}>
        <span style={{color:'var(--accent)',display:'inline-flex',flexShrink:0}}><Icon name={icon} size={15} /></span>
        <span style={{flex:1,minWidth:0}}>
          <span style={{display:'block',fontSize:'12px',fontWeight:700,color:'var(--text-1)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{title}</span>
          {!open && summary && <span style={{display:'block',fontSize:'11.5px',color:'var(--text-3)',marginTop:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{summary}</span>}
        </span>
        <span style={{color:'var(--text-3)',fontSize:'11px',flexShrink:0}}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{padding:'0 14px 14px'}}>
        {hint && <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'12px',lineHeight:1.5}}>{hint}</div>}
        {children}
      </div>}
    </div>
  );
}

function parseVCard(raw) {
  if (!raw || !/BEGIN:VCARD/i.test(raw)) return null;
  const block = (raw.match(/BEGIN:VCARD[\s\S]*?END:VCARD/i) || [raw])[0];
  const unfolded = block.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n').map(l => l.trim()).filter(Boolean);
  const decodeVal = (v, params) => {
    let str = v;
    if (/QUOTED-PRINTABLE/i.test(params.ENCODING || '')) {
      str = str.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      try { str = decodeURIComponent(escape(str)); } catch (_) {}
    }
    return str.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
  };
  const c = { phones: [], emails: [], notes: '' };
  let fn = '', n = null; const extra = [];
  for (const line of lines) {
    const ci = line.indexOf(':'); if (ci < 0) continue;
    const left = line.slice(0, ci); const rawVal = line.slice(ci + 1);
    const segs = left.split(';');
    let prop = segs[0].toUpperCase();
    if (prop.includes('.')) prop = prop.split('.').pop();
    const params = {}; const types = [];
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.includes('=')) { const idx = seg.indexOf('='); const k = seg.slice(0, idx).toUpperCase(); const vv = seg.slice(idx + 1); params[k] = vv; if (k === 'TYPE') types.push(...vv.split(',').map(x => x.toUpperCase())); }
      else types.push(seg.toUpperCase());
    }
    const value = decodeVal(rawVal, params);
    if (!value && prop !== 'N') continue;
    switch (prop) {
      case 'FN': fn = value; break;
      case 'N': n = value.split(';'); break;
      case 'TEL': { const label = (types.includes('CELL') || types.includes('MOBILE')) ? 'Mobile' : types.includes('WORK') ? 'Work' : types.includes('HOME') ? 'Home' : 'Mobile'; c.phones.push({ value, label, is_default: c.phones.length === 0 }); break; }
      case 'EMAIL': { const label = types.includes('WORK') ? 'Work' : 'Personal'; c.emails.push({ value, label, is_default: c.emails.length === 0 }); break; }
      case 'ORG': c.company = value.split(';')[0].trim(); break;
      case 'TITLE': c.role = value; break;
      case 'NOTE': c.notes = value; break;
      case 'URL': extra.push('Website: ' + value); break;
      case 'BDAY': extra.push('Birthday: ' + value); break;
      case 'ADR': {
        const a = value.split(';');
        const street = [a[0], a[1], a[2]].filter(Boolean).join(' ').trim();
        if (types.includes('WORK')) { c.business_address = street; c.business_city = a[3] || ''; c.business_state = a[4] || ''; c.business_zip = a[5] || ''; }
        else { c.home_address = street; c.home_city = a[3] || ''; c.home_state = a[4] || ''; c.home_zip = a[5] || ''; }
        break;
      }
      default: break;
    }
  }
  if (fn) c.name = fn;
  else if (n) c.name = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ').trim();
  if (!c.name) c.name = ((c.emails[0] && c.emails[0].value) || (c.phones[0] && c.phones[0].value) || 'New contact');
  if (extra.length) c.notes = (c.notes ? c.notes + '\n' : '') + extra.join('\n');
  c.type = 'lead'; c.origin = 'manual';
  return c;
}

function VCardImportModal({ onClose, onParsed }) {
  useBackClose(onClose);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result || '')); setErr(''); };
    r.readAsText(file);
  };
  const go = () => {
    const parsed = parseVCard(text);
    if (!parsed) { setErr("That doesn't look like a vCard. Paste text that starts with BEGIN:VCARD, or choose a .vcf file."); return; }
    onParsed(parsed);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', maxHeight: '86vh', overflow: 'auto', background: '#100D09', border: '1px solid rgba(203,163,92,.28)', borderRadius: 16 }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(203,163,92,.2)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: '#CBA35C', marginBottom: 6 }}>Import</div>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, color: '#F6F1E7' }}>New contact from a vCard</div>
          <div style={{ fontSize: 12, color: '#8C8475', marginTop: 4 }}>Choose a .vcf file or paste the vCard text. We'll fill in a new contact for you to review and save.</div>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <label className="btn btn-ghost btn-sm" style={{ display: 'inline-block', cursor: 'pointer', marginBottom: 12 }}>
            Choose .vcf file
            <input type="file" accept=".vcf,text/vcard,text/x-vcard" onChange={onFile} style={{ display: 'none' }} />
          </label>
          <textarea value={text} onChange={e => { setText(e.target.value); setErr(''); }} rows={8} placeholder="...or paste vCard text here (starts with BEGIN:VCARD)"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'monospace', background: '#0c0a07', border: '1px solid rgba(203,163,92,.24)', borderRadius: 10, color: '#F6F1E7', resize: 'vertical' }} />
          {err && <div style={{ fontSize: 12, color: '#e0794f', marginTop: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(203,163,92,.2)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={go} disabled={!text.trim()}>Create contact</button>
        </div>
      </div>
    </div>
  );
}

function ContactModal({ onClose, onSave, onDelete, initial, onShowDetails, contacts = [], setContacts, userId, canSeeRestricted = false }) {

  useBackClose(onClose);
  const [typeOptions, reloadTypes] = useContactTypes(canSeeRestricted);
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'lead');
  // phones + emails: arrays of {value, label, is_default}. Initial state seeded
  // from the array column if present, else synthesized from the legacy single
  // phone/email columns. New contacts start with a single empty Mobile/Personal
  // entry so the form shows familiar field shapes.
  const [phones, setPhones] = useState(() => {
    if (Array.isArray(initial?.phones) && initial.phones.length > 0) return initial.phones;
    if (initial?.phone) return [{ value: initial.phone, label: 'Mobile', is_default: true }];
    return [{ value: '', label: 'Mobile', is_default: true }];
  });
  const [emails, setEmails] = useState(() => {
    if (Array.isArray(initial?.emails) && initial.emails.length > 0) return initial.emails;
    if (initial?.email) return [{ value: initial.email, label: 'Personal', is_default: true }];
    return [{ value: '', label: 'Personal', is_default: true }];
  });
  const [company, setCompany] = useState(initial?.company || '');
  const [role, setRole] = useState(initial?.role || '');
  const [profession, setProfession] = useState(initial?.profession || '');
  const [referredById, setReferredById] = useState(initial?.referred_by_contact_id || '');
  const [origin, setOrigin] = useState(initial?.origin ?? (initial ? '' : 'manual'));
  const [originDetail, setOriginDetail] = useState(initial?.origin_detail || '');
  const [priority, setPriority] = useState(initial?.priority || 'normal');
  const [notes, setNotes] = useState(initial?.notes || '');
  // Home address (one only)
  const [homeAddress, setHomeAddress] = useState(initial?.home_address || '');
  const [homeCity, setHomeCity] = useState(initial?.home_city || '');
  const [homeState, setHomeState] = useState(initial?.home_state || '');
  const [homeZip, setHomeZip] = useState(initial?.home_zip || '');
  const [homeOwnership, setHomeOwnership] = useState(initial?.home_ownership || '');
  const [homePurchaseYear, setHomePurchaseYear] = useState(initial?.home_purchase_year || '');
  // Business address (one only — no own/rent toggle)
  const [businessAddress, setBusinessAddress] = useState(initial?.business_address || '');
  const [businessCity, setBusinessCity] = useState(initial?.business_city || '');
  const [businessState, setBusinessState] = useState(initial?.business_state || '');
  const [businessZip, setBusinessZip] = useState(initial?.business_zip || '');
  // Address sections are collapsed by default — most contacts don't need a tap on
  // these to fill the screen. Each toggles independently.
  const [showHomeAddr, setShowHomeAddr] = useState(false);
  const [showBizAddr, setShowBizAddr] = useState(false);
  // 1099-NEC / W-9 — collapsed by default; sensitive PII (TIN) lives here
  const [show1099, setShow1099]                 = useState(!!(initial?.is_1099_vendor));
  const [is1099Vendor, setIs1099Vendor]         = useState(!!(initial?.is_1099_vendor));
  const [entityType, setEntityType]             = useState(initial?.entity_type || '');
  const [taxIdType, setTaxIdType]               = useState(initial?.tax_id_type || '');
  const [taxIdFull, setTaxIdFull]               = useState(initial?.tax_id_full || '');
  const [w9Collected, setW9Collected]           = useState(!!(initial?.w9_collected));
  const [w9CollectedDate, setW9CollectedDate]   = useState(initial?.w9_collected_date || '');
  const [exempt1099Reason, setExempt1099Reason] = useState(initial?.exempt_1099_reason || '');
  const [force1099, setForce1099]               = useState(!!(initial?.force_1099));
  const [openSec, setOpenSec] = useState({ identity:true, reach:true, source:false, addr:false, compliance:!!(initial?.is_1099_vendor), notes:true });
  const tog = (k) => setOpenSec(s => ({ ...s, [k]: !s[k] }));

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!name.trim()) {
      // iOS: a silent return looks like a dead button. Tell the user why.
      if (window.__notify) window.__notify('Add a name before saving.', 'error');
      return;
    }
    // Normalize phones/emails: drop empties, guarantee exactly one default.
    function normalize(arr) {
      const cleaned = (arr || [])
        .map(v => ({ value: (v.value || '').trim(), label: v.label || '', is_default: !!v.is_default }))
        .filter(v => v.value);
      if (cleaned.length === 0) return [];
      if (!cleaned.some(v => v.is_default)) cleaned[0].is_default = true;
      // Ensure only one default
      let seenDefault = false;
      return cleaned.map(v => {
        if (v.is_default && !seenDefault) { seenDefault = true; return v; }
        return { ...v, is_default: false };
      });
    }
    const cleanPhones = normalize(phones);
    const cleanEmails = normalize(emails);
    onSave({
      name: name.trim(), type,
      phones: cleanPhones, emails: cleanEmails,
      // phone/email columns intentionally omitted — the database trigger
      // derives them from the default entries in the arrays.
      company: company.trim() || null, role: role.trim() || null,
      profession: profession.trim() || null,
      referred_by_contact_id: referredById || null,
      origin: origin || null,
      origin_detail: originDetail.trim() || null,
      priority, notes: notes.trim() || null,
      home_address: homeAddress.trim() || null,
      home_city: homeCity.trim() || null,
      home_state: homeState.trim() || null,
      home_zip: homeZip.trim() || null,
      home_ownership: homeOwnership || null,
      home_purchase_year: homePurchaseYear ? Number(homePurchaseYear) : null,
      business_address: businessAddress.trim() || null,
      business_city: businessCity.trim() || null,
      business_state: businessState.trim() || null,
      business_zip: businessZip.trim() || null,
      // 1099-NEC / W-9 — empty strings → null so the DB CHECK constraints stay happy
      is_1099_vendor: is1099Vendor,
      entity_type: entityType || null,
      tax_id_type: taxIdType || null,
      tax_id_full: taxIdFull.trim() || null,
      w9_collected: w9Collected,
      w9_collected_date: w9CollectedDate || null,
      exempt_1099_reason: exempt1099Reason.trim() || null,
      force_1099: force1099,
    });
  }

  const [addingType,setAddingType]=useState(false);
  const [newTypeLabel,setNewTypeLabel]=useState('');
  const [newTypeIcon,setNewTypeIcon]=useState('🏷️');
  const [savingType,setSavingType]=useState(false);
  const saveCustomType=async()=>{ const lbl=newTypeLabel.trim(); if(!lbl) return; setSavingType(true); try{ const row=await createCustomType(userId,lbl,newTypeIcon); await reloadTypes(); setType(row.id); setAddingType(false); setNewTypeLabel(''); setNewTypeIcon('🏷️'); if(window.__notify) window.__notify('Added private type \u201c'+lbl+'\u201d','success'); }catch(e){ if(window.__notify) window.__notify('Could not add type.','error'); } setSavingType(false); };
  const VENDOR_TYPES = ['vendor','contractor','attorney','builder','developer','lender'];
  const showCompliance = VENDOR_TYPES.includes(type) || is1099Vendor;
  const mInitials = ((name || '').trim().split(/\s+/).map(w=>w[0]).filter(Boolean).slice(0,2).join('').toUpperCase()) || (initial ? '?' : '+');
  const homeSummary = [homeAddress,[homeCity,homeState].filter(Boolean).join(', '),homeZip].filter(Boolean).join(' · ').trim();
  const bizSummary = [businessAddress,[businessCity,businessState].filter(Boolean).join(', '),businessZip].filter(Boolean).join(' · ').trim();
  const originLabelMap = {manual:'Manual entry',referral:'Referral',open_house:'Open house',prospecting:'Cold list / prospecting',website:'Website / inbound',sphere:'Sphere / past client',event:'Event / networking',social:'Social media',email:'From email',csv:'CSV import',other:'Other'};
  const referredName = referredById ? ((contacts.find(c=>c.id===referredById)||{}).name || '') : '';

  return (
    <div className="modal-overlay overlay-fade" onClick={e => e.target === e.currentTarget && onClose()} style={{padding:0,alignItems:'stretch',justifyContent:'center'}}>
      <div className="modal sheet-rise" style={{maxWidth:'640px',width:'100%',height:'100dvh',maxHeight:'100dvh',minHeight:0,margin:0,padding:0,borderRadius:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Header mirrors the contact sheet so editing feels like the same surface */}
        <div style={{padding:'calc(14px + env(safe-area-inset-top, 0px)) 16px 14px',borderBottom:'1px solid var(--border)',background:'linear-gradient(180deg,var(--bg-card),var(--bg-base))'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <div style={{width:'48px',height:'48px',borderRadius:'50%',flexShrink:0,background:'linear-gradient(135deg,var(--bg-hover),var(--bg-card))',border:'2px solid var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'17px',color:'var(--accent)'}}>{mInitials}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{initial ? 'Editing' : 'New contact'}</div>
              <div style={{fontSize:'17px',fontWeight:800,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name || (initial ? initial.name : 'New contact')}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'5px',flexShrink:0}}>
              {initial && onShowDetails && <button type="button" onClick={()=>onShowDetails(initial)} title="View details" style={{height:'32px',padding:'0 11px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-card)',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:700}}>View →</button>}
              {initial && onDelete && <button type="button" onClick={()=>onDelete(initial)} title="Delete" style={{width:'32px',height:'32px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-card)',color:'var(--text-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="trash" size={15} /></button>}
              <button type="button" onClick={onClose} title="Close" style={{width:'32px',height:'32px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-card)',color:'var(--text-2)',cursor:'pointer',fontSize:'17px',lineHeight:1}}>×</button>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
          <div style={{flex:1,minHeight:0,overflowY:'auto',WebkitOverflowScrolling:'touch',padding:'10px 16px 6px'}}>

            <EditSection icon="contacts" title="Identity" open={openSec.identity} onToggle={()=>tog('identity')} hint="The basics — who they are and where they work." summary={[(CONTACT_TYPE_LABELS[type]||type), company].filter(Boolean).join(' · ')}>
              <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)} autoFocus required /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Type</label>
                  <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                    {(() => { const groups=[]; const seen={}; typeOptions.forEach(t=>{ const c=t.category||'Other'; if(!seen[c]){seen[c]={cat:c,items:[]};groups.push(seen[c]);} seen[c].items.push(t); }); return groups.map(g=>(<optgroup key={g.cat} label={g.cat}>{g.items.map(t=><option key={t.id} value={t.id}>{(t.icon?t.icon+' ':'')+t.label}</option>)}</optgroup>)); })()}
                  </select>
                  {!addingType
                    ? <button type="button" onClick={()=>setAddingType(true)} style={{marginTop:6,background:'none',border:'none',color:'var(--accent)',fontSize:11.5,fontWeight:600,cursor:'pointer',padding:0}}>+ New private type</button>
                    : <div style={{marginTop:8,padding:10,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg-base)'}}>
                        <div style={{fontSize:10.5,color:'var(--text-3)',marginBottom:7}}>Private to you — only you will see this type.</div>
                        <div style={{display:'flex',gap:6,marginBottom:7,flexWrap:'wrap'}}>{['🏷️','💎','⭐','🔥','📌','🧲','🏆','🌐'].map(em=>(<button key={em} type="button" onClick={()=>setNewTypeIcon(em)} style={{fontSize:16,lineHeight:1,padding:'4px 7px',borderRadius:8,cursor:'pointer',background:newTypeIcon===em?'var(--accent-glow)':'transparent',border:'1px solid '+(newTypeIcon===em?'var(--accent)':'var(--border)')}}>{em}</button>))}</div>
                        <div style={{display:'flex',gap:6}}>
                          <input className="form-input" value={newTypeLabel} onChange={e=>setNewTypeLabel(e.target.value)} placeholder="Type name (e.g. VIP, A-list lender)" style={{flex:1,margin:0}} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); saveCustomType(); } }} />
                          <button type="button" className="btn btn-primary btn-sm" disabled={savingType||!newTypeLabel.trim()} onClick={saveCustomType}>{savingType?'\u2026':'Add'}</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setAddingType(false);setNewTypeLabel('');}}>Cancel</button>
                        </div>
                      </div>}
                </div>
                <div className="form-group"><label className="form-label">Priority</label>
                  <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                    <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Company</label><input className="form-input" value={company} onChange={e=>setCompany(e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Role / Title</label><input className="form-input" value={role} onChange={e=>setRole(e.target.value)} /></div>
              </div>
              <div className="form-group" style={{marginBottom:0}}><label className="form-label">Profession</label><input className="form-input" value={profession} onChange={e=>setProfession(e.target.value)} placeholder="e.g. Realtor, Attorney, Jeweler, Doctor…" /></div>
            </EditSection>

            <EditSection icon="message" title="Reach" open={openSec.reach} onToggle={()=>tog('reach')} hint="Star one of each as the default — that’s what the Call / Text / Email buttons use." summary={[emails.filter(e=>e.value).length+' email'+(emails.filter(e=>e.value).length===1?'':'s'), phones.filter(p=>p.value).length+' phone'+(phones.filter(p=>p.value).length===1?'':'s')].join(' · ')}>
              <div className="form-group"><label className="form-label">Emails</label><MultiValueField values={emails} onChange={setEmails} kind="email" addLabel="+ Add email"/></div>
              <div className="form-group" style={{marginBottom:0}}><label className="form-label">Phones</label><MultiValueField values={phones} onChange={setPhones} kind="phone" addLabel="+ Add phone"/></div>
            </EditSection>

            <EditSection icon="link" title="Source" open={openSec.source} onToggle={()=>tog('source')} hint="Where this contact came from — powers your referral-source and lead reporting." summary={([referredName ? 'via '+referredName : '', origin ? (originLabelMap[origin]||origin) : ''].filter(Boolean).join(' · ')) || 'Not set'}>
              <div className="form-group">
                <label className="form-label">Referred by</label>
                <SingleContactPicker value={referredById || null} onChange={(id)=>setReferredById(id||'')} contacts={contacts} setContacts={setContacts} currentContactId={initial?.id} userId={userId} placeholder="Who referred this contact? Search or type to add…" defaultNewContactType="other" />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Origin</label>
                <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                  <select className="form-input" value={origin} onChange={e=>setOrigin(e.target.value)} style={{flex:'1 1 160px'}}>
                    <option value="">— Unspecified —</option>
                    <option value="manual">Manual entry</option>
                    <option value="referral">Referral</option>
                    <option value="open_house">Open house</option>
                    <option value="prospecting">Cold list / prospecting</option>
                    <option value="website">Website / inbound</option>
                    <option value="sphere">Sphere / past client</option>
                    <option value="event">Event / networking</option>
                    <option value="social">Social media</option>
                    <option value="email">From email</option>
                    <option value="csv">CSV import</option>
                    <option value="other">Other</option>
                  </select>
                  {origin && origin !== 'manual' && <input className="form-input" value={originDetail} onChange={e=>setOriginDetail(e.target.value)} placeholder={origin==='referral' ? 'Who / what source?' : origin==='event' ? 'Which event?' : origin==='social' ? 'Which platform?' : 'Detail (optional)'} style={{flex:'1 1 160px'}} />}
                </div>
              </div>
            </EditSection>

            <EditSection icon="home" title="Addresses" open={openSec.addr} onToggle={()=>tog('addr')} hint="Optional — home and business locations." summary={([homeSummary?'Home':'', bizSummary?'Business':''].filter(Boolean).join(' · ')) || 'None'}>
              <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'8px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="home" size={12} /> Home</div>
              <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">Street</label><input className="form-input" value={homeAddress} onChange={e=>setHomeAddress(e.target.value)} /></div>
              <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">City</label><input className="form-input" value={homeCity} onChange={e=>setHomeCity(e.target.value)} /></div>
              <div style={{display:'grid',gridTemplateColumns:'88px 1fr',gap:'12px',marginBottom:'8px'}}>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">State</label><input className="form-input" maxLength={2} value={homeState} onChange={e=>setHomeState(e.target.value.toUpperCase())} /></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">ZIP</label><input className="form-input" value={homeZip} onChange={e=>setHomeZip(e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Own / Rent</label>
                  <select className="form-select" value={homeOwnership} onChange={e=>setHomeOwnership(e.target.value)}><option value="">—</option><option value="own">Own</option><option value="rent">Rent</option></select>
                </div>
                {homeOwnership === 'own' && <div className="form-group"><label className="form-label">Year Purchased</label><input className="form-input" type="number" min="1800" max="2100" value={homePurchaseYear} onChange={e=>setHomePurchaseYear(e.target.value)} placeholder="e.g. 1998" /></div>}
              </div>
              <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',margin:'16px 0 8px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="building" size={12} /> Business</div>
              <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">Street</label><input className="form-input" value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} /></div>
              <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">City</label><input className="form-input" value={businessCity} onChange={e=>setBusinessCity(e.target.value)} /></div>
              <div style={{display:'grid',gridTemplateColumns:'88px 1fr',gap:'12px'}}>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">State</label><input className="form-input" maxLength={2} value={businessState} onChange={e=>setBusinessState(e.target.value.toUpperCase())} /></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">ZIP</label><input className="form-input" value={businessZip} onChange={e=>setBusinessZip(e.target.value)} /></div>
              </div>
            </EditSection>

            {showCompliance && (
              <EditSection icon="file" title="1099 / W-9" open={openSec.compliance} onToggle={()=>tog('compliance')} hint="For independent contractors / vendors paid $600+ in a calendar year. Sensitive info is stored encrypted — only you can read it." summary={is1099Vendor ? ('Flagged' + (w9Collected ? ' · W-9 ✓' : '')) : 'Not flagged'}>
                <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginBottom:'10px'}}>
                  <input type="checkbox" checked={is1099Vendor} onChange={e => setIs1099Vendor(e.target.checked)}/>
                  <span style={{fontSize:'12px',color:'var(--text-1)',fontWeight:600}}>Track as 1099-NEC vendor</span>
                </label>
                {is1099Vendor && (
                  <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="form-label">Entity type (from W-9)</label>
                      <select className="form-select" value={entityType} onChange={e => setEntityType(e.target.value)}>
                        <option value="">— Not set —</option>
                        <option value="individual">Individual</option>
                        <option value="sole_prop">Sole proprietor</option>
                        <option value="partnership">Partnership</option>
                        <option value="llc_single">LLC — single member (disregarded)</option>
                        <option value="llc_multi">LLC — multi-member (partnership)</option>
                        <option value="llc_s_corp">LLC taxed as S-corp</option>
                        <option value="llc_c_corp">LLC taxed as C-corp</option>
                        <option value="s_corp">S corporation</option>
                        <option value="c_corp">C corporation</option>
                        <option value="nonprofit">Tax-exempt / nonprofit</option>
                        <option value="other">Other</option>
                      </select>
                      <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',lineHeight:1.5}}>Corps generally do NOT need 1099s — except attorneys, which always do. Use Force 1099 below for those.</div>
                    </div>
                    <div className="form-row">
                      <div className="form-group" style={{flex:'0 0 110px',marginBottom:0}}>
                        <label className="form-label">TIN type</label>
                        <select className="form-select" value={taxIdType} onChange={e => setTaxIdType(e.target.value)}><option value="">—</option><option value="ssn">SSN</option><option value="ein">EIN</option></select>
                      </div>
                      <div className="form-group" style={{flex:1,marginBottom:0}}>
                        <label className="form-label">Tax ID number</label>
                        <input className="form-input" type="text" value={taxIdFull} onChange={e => setTaxIdFull(e.target.value)} placeholder={taxIdType === 'ein' ? '12-3456789' : '123-45-6789'} autoComplete="off"/>
                      </div>
                    </div>
                    <div className="form-row">
                      <label className="form-group" style={{flex:1,display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginBottom:0}}>
                        <input type="checkbox" checked={w9Collected} onChange={e => setW9Collected(e.target.checked)}/>
                        <span style={{fontSize:'12px',color:'var(--text-1)'}}>Signed W-9 on file</span>
                      </label>
                      {w9Collected && (
                        <div className="form-group" style={{flex:1,marginBottom:0}}>
                          <label className="form-label">Date received</label>
                          <input className="form-input" type="date" value={w9CollectedDate} onChange={e => setW9CollectedDate(e.target.value)}/>
                        </div>
                      )}
                    </div>
                    <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
                      <input type="checkbox" checked={force1099} onChange={e => setForce1099(e.target.checked)}/>
                      <span style={{fontSize:'12px',color:'var(--text-1)'}}>Force 1099 even if corporation (attorneys, etc.)</span>
                    </label>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="form-label">Exempt reason (optional)</label>
                      <input className="form-input" type="text" value={exempt1099Reason} onChange={e => setExempt1099Reason(e.target.value)} placeholder='e.g. "Paid via credit card"'/>
                    </div>
                  </div>
                )}
              </EditSection>
            )}

            <EditSection icon="edit" title="Notes" open={openSec.notes} onToggle={()=>tog('notes')} hint="Context, history, anything to remember." summary={notes ? (notes.slice(0,42).replace(/\n/g,' ') + (notes.length>42?'…':'')) : 'None'}>
              <textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Context, history, anything to remember…" style={{minHeight:'90px'}} />
            </EditSection>

          </div>
          <div className="modal-actions" style={{padding:'12px 16px calc(14px + env(safe-area-inset-bottom, 0px))',borderTop:'1px solid var(--border)',margin:0,flexShrink:0,position:'sticky',bottom:0,background:'var(--bg-card)',zIndex:2}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit}>{initial ? 'Save changes' : 'Create contact'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// EMAIL → CONTACT LINK REVIEW
// Shows suggestions from the contact-link-emails edge function and lets the
// user link, pick a different contact, skip, or block the sender.
// ─────────────────────────────────────────

function EmailLinkReviewModal({ userId, contacts, setContacts, onClose, onChanged, canSeeRestricted = false }) {

  useBackClose(onClose);
  const [typeOptions, reloadTypes] = useContactTypes(canSeeRestricted);
  const [suggestions, setSuggestions] = useState(null);
  const [newContactSuggestions, setNewContactSuggestions] = useState(null);
  const [busy, setBusy] = useState({});
  const [openSrc, setOpenSrc] = useState({});  // sender_email -> action label
  const [scanErr, setScanErr] = useState('');
  const [pickerFor, setPickerFor] = useState(null);  // sender_email when picking different contact
  const [pickerQuery, setPickerQuery] = useState('');
  // For "Add" on a new-contact suggestion
  const [addingNewFor, setAddingNewFor] = useState(null);
  const [newContactType, setNewContactType] = useState('lead');
  const [newContactName, setNewContactName] = useState('');

  // Keep onChanged in a ref so loadSuggestions stays stable. The parent passes a
  // fresh inline onChanged every render; if it were a dependency, loadSuggestions
  // (and its mount effect) would re-run on every render, resetting the modal to
  // "Scanning…" forever. The ref lets us always call the latest onChanged without
  // destabilizing the callback.
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; });

  const loadSuggestions = useCallback(async () => {
    setSuggestions(null);
    setNewContactSuggestions(null);
    setScanErr('');
    try {
      const invoke = supabase.functions.invoke('contact-link-emails', { body: { user_id: userId, apply_auto: false } });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000));
      const { data, error } = await Promise.race([invoke, timeout]);
      if (error) throw error;
      if (data?.ok) {
        setSuggestions(data.suggestions || []);
        setNewContactSuggestions(data.new_contact_suggestions || []);
        onChangedRef.current?.({ link: data.suggestions_count || 0, new: data.new_contact_suggestions_count || 0 });
      } else {
        setSuggestions([]); setNewContactSuggestions([]);
      }
    } catch (e) {
      setSuggestions([]); setNewContactSuggestions([]);
      setScanErr("Couldn't finish the scan — tap Refresh to try again.");
    }
  }, [userId]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  async function linkSenderToContact(senderEmail, senderName, contactId, msgMaxDate) {
    setBusy(b => ({ ...b, [senderEmail]: 'linking' }));
    try {
      // Set contact's email + last_contact_at
      const patch = { email: senderEmail };
      if (msgMaxDate) patch.last_contact_at = msgMaxDate;
      const { error } = await supabase.from('contacts').update(patch).eq('id', contactId);
      if (error) {
        notify("Couldn't link sender to contact. Try again.", 'error');
        return;
      }
      // Refresh contacts state
      const { data: fresh } = await supabase.from('contacts').select('*').order('name');
      if (fresh) setContacts(fresh);
      // Remove from local suggestion list (link AND new-contact, since linking covers both)
      let nextLink = [];
      let nextNew = (newContactSuggestions || []);
      setSuggestions(prev => {
        nextLink = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextLink;
      });
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  async function dismissSuggestion(senderEmail, contactId, reason) {
    setBusy(b => ({ ...b, [senderEmail]: 'dismissing' }));
    try {
      await supabase.from('contact_link_dismissals').insert({
        user_id: userId,
        sender_email: senderEmail,
        contact_id: reason === 'block_sender' ? null : contactId,
        reason,
      });
      let nextLink = [];
      let nextNew = (newContactSuggestions || []);
      setSuggestions(prev => {
        nextLink = (prev || []).filter(s => {
          if (reason === 'block_sender') return s.sender.email !== senderEmail;
          return !(s.sender.email === senderEmail && s.contact.id === contactId);
        });
        return nextLink;
      });
      if (reason === 'block_sender') {
        setNewContactSuggestions(prev => {
          nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
          return nextNew;
        });
      }
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Open the inline "Add" form for a new-contact suggestion
  function startAddingNew(suggestion) {
    setAddingNewFor(suggestion.sender.email);
    setNewContactName(suggestion.sender.name || '');
    setNewContactType('lead');
  }

  // Create the new contact from a suggestion
  async function createNewContact(suggestion) {
    const senderEmail = suggestion.sender.email;
    if (!newContactName.trim()) return;
    setBusy(b => ({ ...b, [senderEmail]: 'adding' }));
    try {
      const { data: created } = await supabase.from('contacts').insert({
        user_id: userId,
        name: newContactName.trim(),
        email: senderEmail,
        type: newContactType,
        priority: 'normal',
        last_contact_at: suggestion.sender.last_seen,
        notes: `Auto-suggested from ${suggestion.sender.msg_count} inbound email${suggestion.sender.msg_count === 1 ? '' : 's'}.`,
      }).select().single();
      if (created) {
        setContacts(prev => [created, ...prev]);
      }
      let nextNew = [];
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      setAddingNewFor(null);
      setTimeout(() => onChanged?.({ link: (suggestions || []).length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Dismiss a new-contact suggestion
  async function dismissNewContact(senderEmail, reason) {
    setBusy(b => ({ ...b, [senderEmail]: 'dismissing' }));
    try {
      await supabase.from('contact_link_dismissals').insert({
        user_id: userId,
        sender_email: senderEmail,
        contact_id: null,
        reason,  // 'not_a_new_contact' or 'block_sender'
      });
      let nextNew = [];
      let nextLink = (suggestions || []);
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      if (reason === 'block_sender') {
        setSuggestions(prev => {
          nextLink = (prev || []).filter(s => s.sender.email !== senderEmail);
          return nextLink;
        });
      }
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Picker for "different contact"
  const filteredContacts = (contacts || [])
    .filter(c => c.name && !c.email)  // only show contacts without an email
    .filter(c => !pickerQuery || c.name.toLowerCase().includes(pickerQuery.toLowerCase()))
    .slice(0, 30);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:'720px',width:'92%',maxHeight:'85vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px'}}>
          <div>
            <h3 style={{margin:0}}>Email senders</h3>
            <p style={{margin:'4px 0 0 0',fontSize:'12px',color:'var(--text-3)'}}>
              {suggestions === null ? 'Loading…' : (() => {
                const linkN = suggestions.length;
                const newN = (newContactSuggestions || []).length;
                if (linkN === 0 && newN === 0) return 'All caught up — no pending suggestions.';
                const parts = [];
                if (linkN > 0) parts.push(`${linkN} possible match${linkN === 1 ? '' : 'es'} to existing contacts`);
                if (newN > 0) parts.push(`${newN} potential new contact${newN === 1 ? '' : 's'}`);
                return parts.join(' · ') + '. Pick an action for each.';
              })()}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{padding:'0 16px 16px',overflowY:'auto',flex:1}}>
          {suggestions === null && !scanErr && <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Scanning…</div>}
          {scanErr && <div style={{padding:'28px 16px',textAlign:'center',color:'var(--yellow)',fontSize:'13px'}}>{scanErr}</div>}

          {suggestions && suggestions.length === 0 && (newContactSuggestions || []).length === 0 && (
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>✓</div>
              <div style={{color:'var(--text-2)',fontSize:'13px'}}>All caught up. Run scan again after new emails arrive.</div>
            </div>
          )}

          {suggestions && suggestions.length > 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,margin:'12px 0 8px 0'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="link" size={14} /> Possible matches to existing contacts ({suggestions.length})</span>
            </div>
          )}

          {suggestions && suggestions.map(s => {
            const isPicker = pickerFor === s.sender.email;
            const isBusy = !!busy[s.sender.email];
            return (
              <div key={`${s.sender.email}|${s.contact.id}`} style={{padding:'12px',marginBottom:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',flexWrap:'wrap',marginBottom:'10px'}}>
                  <div style={{flex:'1 1 280px',minWidth:0}}>
                    <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px',display:'flex',alignItems:'center',gap:'4px'}}><Icon name="mail" size={11} /> SENDER</div>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.sender.name || '(no name)'}</div>
                    <div style={{fontSize:'12px',color:'var(--text-2)',wordBreak:'break-all'}}>{s.sender.email}</div>
                    <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                      {s.sender.msg_count} message{s.sender.msg_count === 1 ? '' : 's'}
                      {s.sender.last_seen && <> · last {new Date(s.sender.last_seen).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <div style={{flex:'1 1 200px',minWidth:0}}>
                    <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px',display:'flex',alignItems:'center',gap:'4px'}}><Icon name="contacts" size={11} /> CONTACT</div>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.contact.name}</div>
                    <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                      {CONTACT_TYPE_LABELS[s.contact.type] || s.contact.type}
                      <span style={{marginLeft:'8px',color: s.score >= 90 ? 'var(--green)' : (s.score >= 75 ? 'var(--accent)' : 'var(--text-3)')}}>
                        score {s.score}{s.ambiguous && ' · ⚠️ ambiguous'}
                      </span>
                    </div>
                  </div>
                </div>

                {!isPicker && (
                  <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                    <button className="btn btn-primary btn-sm" disabled={isBusy}
                      onClick={() => linkSenderToContact(s.sender.email, s.sender.name, s.contact.id, s.sender.last_seen)}>
                      {busy[s.sender.email] === 'linking' ? '↻ Linking…' : <><Icon name="link" size={12} /> Link</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy}
                      onClick={() => { setPickerFor(s.sender.email); setPickerQuery(''); }}>
                      Different contact…
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy}
                      onClick={() => dismissSuggestion(s.sender.email, s.contact.id, 'not_a_match')}>
                      Skip
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy} style={{color:'var(--red)',marginLeft:'auto'}}
                      onClick={() => dismissSuggestion(s.sender.email, s.contact.id, 'block_sender')}
                      title="Mark this sender as not-a-real-person — won't be suggested for any contact again.">
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="ban" size={12} /> Block sender</span>
                    </button>
                  </div>
                )}

                {isPicker && (
                  <div style={{marginTop:'8px',padding:'10px',background:'var(--bg-panel)',borderRadius:'6px'}}>
                    <input className="form-input" autoFocus placeholder="Search contacts (without email)…"
                      value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} style={{marginBottom:'8px'}} />
                    <div style={{maxHeight:'200px',overflowY:'auto'}}>
                      {filteredContacts.length === 0 ? (
                        <div style={{padding:'10px',textAlign:'center',color:'var(--text-3)',fontSize:'12px'}}>
                          No contacts match.
                        </div>
                      ) : filteredContacts.map(c => (
                        <button key={c.id} onClick={() => { setPickerFor(null); linkSenderToContact(s.sender.email, s.sender.name, c.id, s.sender.last_seen); }}
                          style={{display:'block',width:'100%',textAlign:'left',padding:'8px 10px',background:'transparent',border:'1px solid transparent',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',cursor:'pointer'}}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          {c.name} <span style={{fontSize:'11px',color:'var(--text-3)'}}>· {CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPickerFor(null)} style={{marginTop:'8px'}}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}

          {/* NEW-CONTACT SUGGESTIONS (Option B) */}
          {newContactSuggestions && newContactSuggestions.length > 0 && (
            <>
              <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,margin:'18px 0 8px 0'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="sparkles" size={14} /> Potential new contacts ({newContactSuggestions.length})</span>
              </div>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'10px',lineHeight:1.5}}>
                People who've emailed you 3+ times but aren't in your contacts yet. Spam and automated senders are filtered out, but review each before adding.
              </div>
              {newContactSuggestions.map(s => {
                const senderEmail = s.sender.email;
                const isAdding = addingNewFor === senderEmail;
                const isBusy = !!busy[senderEmail];
                return (
                  <div key={`new-${senderEmail}`} style={{padding:'12px',marginBottom:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',flexWrap:'wrap',marginBottom:'10px'}}>
                      <div style={{flex:'1 1 280px',minWidth:0}}>
                        <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px',display:'flex',alignItems:'center',gap:'4px'}}><Icon name="mail" size={11} /> SENDER</div>
                        <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.sender.name || '(no name)'}</div>
                        <div style={{fontSize:'12px',color:'var(--text-2)',wordBreak:'break-all'}}>{s.sender.email}</div>
                        {s.confidence_signals && s.confidence_signals.length > 0 && (
                          <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'6px',lineHeight:1.5}}>
                            {s.confidence_signals.map((sig, i) => (
                              <div key={i}>· {sig}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {!isAdding && (
                      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                        <button className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => startAddingNew(s)}>
                          ＋ Add to contacts
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={isBusy}
                          onClick={() => dismissNewContact(senderEmail, 'not_a_new_contact')}>
                          {busy[senderEmail] === 'dismissing' ? '↻ Skipping…' : 'Skip'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={isBusy}
                          onClick={() => dismissNewContact(senderEmail, 'block_sender')}
                          style={{color:'var(--red)'}}>
                          <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="ban" size={12} /> Block sender</span>
                        </button>
                      </div>
                    )}

                    {isAdding && (
                      <div style={{padding:'10px',background:'var(--bg-card)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',fontWeight:600}}>Review before adding:</div>
                        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}}>
                          <div style={{flex:'1 1 200px'}}>
                            <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Name</label>
                            <input className="form-input" value={newContactName} onChange={e=>setNewContactName(e.target.value)} style={{padding:'6px 10px',fontSize:'12px',margin:0,width:'100%'}} />
                          </div>
                          <div style={{flex:'1 1 200px'}}>
                            <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Type</label>
                            <select className="form-select" value={newContactType} onChange={e=>setNewContactType(e.target.value)} style={{padding:'6px 8px',fontSize:'12px',margin:0,width:'100%'}}>
                              {typeOptions.map(t => (
                                <option key={t.id} value={t.id}>{(t.icon?t.icon+' ':'')+t.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'6px'}}>
                          <button className="btn btn-primary btn-sm" disabled={isBusy || !newContactName.trim()} onClick={() => createNewContact(s)}>
                            {busy[senderEmail] === 'adding' ? '↻ Adding…' : '✓ Add'}
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => setAddingNewFor(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <button className="btn btn-ghost btn-sm" onClick={loadSuggestions}>↻ Refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}


function ContactsView({ contacts, setContacts, userId, profiles, setProfiles, canSeeRestricted = false }) {
  const [typeOptions, reloadTypes] = useContactTypes(canSeeRestricted);
  const [textTo, setTextTo] = useState(null); // { contact, phone } for the Quo text composer
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [editFromDetail, setEditFromDetail] = useState(false);
  const [showVCard, setShowVCard] = useState(false);
  React.useEffect(() => {
    try {
      const v = window.__pendingSharedVCard;
      if (v) { window.__pendingSharedVCard = null; const parsed = parseVCard(v); if (parsed) { setEditContact(parsed); setShowModal(true); } }
      // Plain "show me this person" — no research side-effect.
      const oid = window.__pendingOpenContact;
      if (oid && contacts && contacts.length) {
        const c = contacts.find(x => x.id === oid);
        if (c) { window.__pendingOpenContact = null; setDetailContact(c); }
      }
      const rid = window.__pendingResearch;
      if (rid && contacts && contacts.length) { const c = contacts.find(x => x.id === rid); if (c) { window.__pendingResearch = null; window.__autoResearch = c.id; setDetailContact(c); } }
      const pf = window.__pendingContactPrefill;
      if (pf) { window.__pendingContactPrefill = null; window.__researchAfterSave = true; setEditContact({ name: pf.name || '', email: pf.email || '', phone: pf.phone || '', company: pf.company || '' }); setShowModal(true); }
    } catch (_) {}
  }, [contacts]);
  const [detailContact, setDetailContact] = useState(null);
  // Bulk lead-source tagging
  const [tagMode, setTagMode] = useState(false);
  const [selIds, setSelIds] = useState(() => new Set());
  const [tagSystems, setTagSystems] = useState([]);
  const [tagSysId, setTagSysId] = useState('');
  const [applyingTag, setApplyingTag] = useState(false);
  const [bulkChannel, setBulkChannel] = useState(null); // 'text' | 'email' when bulk DISC composer is open
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('lead_gen_systems').select('id,name,is_archived').eq('user_id', userId).order('name'); setTagSystems((data||[]).filter(s=>!s.is_archived)); })(); },[userId]);
  const toggleSel = (id)=> setSelIds(prev=>{ const nx=new Set(prev); nx.has(id)?nx.delete(id):nx.add(id); return nx; });
  const exitTag = ()=>{ setTagMode(false); setSelIds(new Set()); setTagSysId(''); };
  const applyTag = async ()=>{ if(!tagSysId || selIds.size===0) return; setApplyingTag(true); const ids=[...selIds]; const { error } = await supabase.from('contacts').update({ lead_gen_system_id: tagSysId }).in('id', ids); if(error){ if(window.__notify) window.__notify('Could not tag contacts.','error'); setApplyingTag(false); return; } setContacts(prev=>prev.map(c=> selIds.has(c.id) ? { ...c, lead_gen_system_id: tagSysId } : c)); if(window.__notify) window.__notify(ids.length+' contact'+(ids.length===1?'':'s')+' tagged.','success'); setApplyingTag(false); exitTag(); };
  const [typeFilter, setTypeFilter] = useState('all');
  // Rich filtering (pairs with multi-select: filter → Select all → message/tag)
  const [showFilters, setShowFilters] = useState(false);
  const [discFilter, setDiscFilter] = useState(() => new Set());       // 'D','I','S','C','none'
  const [leadSourceFilter, setLeadSourceFilter] = useState('');         // '' all · system id · 'unassigned'
  const [priorityFilter, setPriorityFilter] = useState(() => new Set()); // 'urgent','high','normal','low'
  const [reachFilter, setReachFilter] = useState('any');                // any · has_phone · has_email
  const [recencyFilter, setRecencyFilter] = useState('any');            // any · never · 30 · 60 · 90
  const [sortBy, setSortBy] = useState('last_name');  // 'last_name' | 'first_name' | 'last_contact_oldest' | 'last_contact_newest' | 'recently_added' | 'cadence_due'
  const [dueOnly, setDueOnly] = useState(false);
  const [search, setSearch] = useState('');
  // Render only a window of the (potentially thousands-long) contact list so the
  // page paints and scrolls fast on mobile; "Show more" extends it. The window
  // resets whenever the filter/search/sort changes so results start from the top.
  const [visibleCount, setVisibleCount] = useState(60);
  useEffect(() => { setVisibleCount(60); }, [search, typeFilter, dueOnly, sortBy, discFilter, leadSourceFilter, priorityFilter, reachFilter, recencyFilter]);

  // Email-to-contact linking state
  const [linkSummary, setLinkSummary] = useState(null);  // { suggestions_count, auto_filled, auto_linked } or null when never scanned
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Phone extraction state
  const [extractingPhones, setExtractingPhones] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState(null);

  // Duplicate detection state
  const [findingDupes, setFindingDupes] = useState(false);
  const [dupeGroups, setDupeGroups] = useState(null);  // null = never scanned; [] = scanned, none found
  const [showDupeReview, setShowDupeReview] = useState(false);

  // Load existing pending-suggestion count on mount (cheap dry-run)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-link-emails', {
          body: { user_id: userId, apply_auto: false },
        });
        if (!cancelled && data?.ok) {
          setLinkSummary({
            suggestions_count: data.suggestions_count || 0,
            new_contact_count: data.new_contact_suggestions_count || 0,
          });
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function runEmailLinkScan() {
    setScanning(true);
    try {
      const { data } = await supabase.functions.invoke('contact-link-emails', {
        body: { user_id: userId, apply_auto: true },
      });
      if (data?.ok) {
        setLinkSummary({
          suggestions_count: data.suggestions_count || 0,
          new_contact_count: data.new_contact_suggestions_count || 0,
          auto_linked: data.auto_linked,
          auto_filled: data.auto_filled,
          just_ran: true,
        });
        // Refresh contacts since some may have been auto-filled
        const { data: fresh } = await supabase.from('contacts').select('*').order('name');
        if (fresh) setContacts(fresh);
        const totalPending = (data.suggestions_count || 0) + (data.new_contact_suggestions_count || 0);
        if (totalPending > 0) setShowLinkReview(true);
      }
    } finally { setScanning(false); }
  }

  // Run signature-based phone extraction
  async function runPhoneExtraction() {
    setExtractingPhones(true);
    setPhoneMsg(null);
    try {
      const invoke = supabase.functions.invoke('contact-extract-phones', { body: { user_id: userId, apply: true } });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000));
      const { data } = await Promise.race([invoke, timeout]);
      if (data?.ok) {
        const { data: fresh } = await supabase.from('contacts').select('*').order('name');
        if (fresh) setContacts(fresh);
        if (data.filled > 0) {
          setPhoneMsg({ type: 'ok', text: `Filled ${data.filled} phone${data.filled === 1 ? '' : 's'} from email signatures.` });
        } else {
          setPhoneMsg({ type: 'info', text: `No new phones found in signatures (scanned ${data.scanned_contacts} contacts without phones).` });
        }
      } else {
        setPhoneMsg({ type: 'error', text: data?.error || 'Extraction failed.' });
      }
    } catch (err) {
      setPhoneMsg({ type: 'error', text: err?.message === 'timeout' ? 'Phone extraction is taking too long — tap Extract phones to try again.' : 'Extraction failed: ' + (err.message || err) });
    } finally {
      setExtractingPhones(false);
      setTimeout(() => setPhoneMsg(null), 6000);
    }
  }

  // Find duplicate contacts (manual review only — never auto-merge)
  async function runDuplicateScan() {
    setFindingDupes(true);
    try {
      const { data } = await supabase.functions.invoke('contact-find-duplicates', {
        body: { user_id: userId },
      });
      if (data?.ok) {
        setDupeGroups(data.groups || []);
        if ((data.groups || []).length > 0) setShowDupeReview(true);
      } else {
        setDupeGroups([]);
      }
    } finally { setFindingDupes(false); }
  }

  // Load duplicate count on mount (cheap one-shot)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-find-duplicates', {
          body: { user_id: userId },
        });
        if (!cancelled && data?.ok) {
          setDupeGroups(data.groups || []);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // O(1) lookup from contact_id → profile
  const profileByContact = useMemo(() => {
    const m = new Map();
    (profiles || []).forEach(p => { if (p.contact_id) m.set(p.contact_id, p); });
    return m;
  }, [profiles]);

  function handleProfileUpdate(updatedProfile) {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === updatedProfile.id);
      return exists
        ? prev.map(p => p.id === updatedProfile.id ? updatedProfile : p)
        : [...prev, updatedProfile];
    });
  }

  // Extract last name for sorting: "John Smith" -> "Smith", "Bob Van Der Berg" -> "Berg", "Cher" -> "Cher"
  function lastNameKey(c) {
    const name = (c.name || '').trim();
    if (!name) return '\uffff'; // sort blanks to end
    const parts = name.split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    return last.toLowerCase();
  }
  function firstNameKey(c) {
    const name = (c.name || '').trim();
    if (!name) return '\uffff';
    return (name.split(/\s+/)[0] || '').toLowerCase();
  }
  function lastContactKey(c) {
    // Most recent "touch" — last_contact_at if present, else updated_at
    const ts = c.last_contact_at || c.updated_at || c.created_at || null;
    return ts ? new Date(ts).getTime() : 0;
  }
  function lastTouchTs(c) {
    const cands = [c.last_contact_at, c.last_inbound_at, c.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime());
    return cands.length ? Math.max(...cands) : null;
  }
  function daysSinceTouch(c) { const t = lastTouchTs(c); return t === null ? null : Math.floor((Date.now() - t) / 86400000); }
  function cadenceDue(c) {
    const cad = c.cadence_days; if (!cad) return null;
    if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date())
      return { due: false, snoozed: true, snoozeUntil: c.reachout_snooze_until, daysSince: daysSinceTouch(c), overdueBy: null, cadence: cad };
    const ds = daysSinceTouch(c);
    return { due: ds === null ? true : ds >= cad, overdueBy: ds === null ? null : ds - cad, daysSince: ds, cadence: cad };
  }
  function relDaysShort(days) {
    if (days === null || days === undefined) return 'never';
    if (days === 0) return 'today';
    if (days === 1) return '1d';
    if (days < 7) return days + 'd';
    if (days < 30) return Math.floor(days / 7) + 'w';
    if (days < 365) return Math.floor(days / 30) + 'mo';
    return Math.floor(days / 365) + 'y';
  }
  const dueForOutreachCount = contacts.filter(c => { const s = cadenceDue(c); return s && s.due; }).length;

  const filtered = contacts.filter(c => {
    if (typeFilter !== 'all' && c.type !== typeFilter) return false;
    if (dueOnly) { const s = cadenceDue(c); if (!s || !s.due) return false; }
    if (discFilter.size) { const dl = dominantDiscLetter(profileByContact.get(c.id)) || 'none'; if (!discFilter.has(dl)) return false; }
    if (leadSourceFilter) {
      if (leadSourceFilter === 'unassigned') { if (c.lead_gen_system_id) return false; }
      else if (c.lead_gen_system_id !== leadSourceFilter) return false;
    }
    if (priorityFilter.size) { if (!priorityFilter.has(c.priority || 'normal')) return false; }
    if (reachFilter === 'has_phone' && !c.phone) return false;
    if (reachFilter === 'has_email' && !c.email) return false;
    if (recencyFilter !== 'any') {
      const ds = daysSinceTouch(c);
      if (recencyFilter === 'never') { if (ds !== null) return false; }
      else { const min = parseInt(recencyFilter, 10); if (ds !== null && ds < min) return false; }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (c.name||'').toLowerCase().includes(q) ||
             (c.company||'').toLowerCase().includes(q) ||
             (c.email||'').toLowerCase().includes(q) ||
             (c.notes||'').toLowerCase().includes(q);
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'last_name') {
      const la = lastNameKey(a), lb = lastNameKey(b);
      if (la !== lb) return la.localeCompare(lb);
      return firstNameKey(a).localeCompare(firstNameKey(b));
    }
    if (sortBy === 'first_name') {
      return firstNameKey(a).localeCompare(firstNameKey(b));
    }
    if (sortBy === 'last_contact_oldest') {
      // Oldest first — surfaces who you haven't reached out to recently
      return lastContactKey(a) - lastContactKey(b);
    }
    if (sortBy === 'last_contact_newest') {
      return lastContactKey(b) - lastContactKey(a);
    }
    if (sortBy === 'recently_added') {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    }
    if (sortBy === 'cadence_due') {
      const sa = cadenceDue(a), sb = cadenceDue(b);
      const ra = sa && sa.due ? (sa.overdueBy === null ? 1e9 : sa.overdueBy) : -1e9;
      const rb = sb && sb.due ? (sb.overdueBy === null ? 1e9 : sb.overdueBy) : -1e9;
      if (ra !== rb) return rb - ra; // most overdue first
      return lastContactKey(a) - lastContactKey(b);
    }
    return 0;
  });

  // Counts for filter chips (across the whole book so the user sees the universe)
  const discCounts = useMemo(() => {
    const m = { D:0, I:0, S:0, C:0, none:0 };
    contacts.forEach(c => { const k = dominantDiscLetter(profileByContact.get(c.id)) || 'none'; m[k] = (m[k]||0)+1; });
    return m;
  }, [contacts, profileByContact]);
  const priorityCounts = useMemo(() => {
    const m = { urgent:0, high:0, normal:0, low:0 };
    contacts.forEach(c => { const k = c.priority || 'normal'; if (m[k]!=null) m[k]++; });
    return m;
  }, [contacts]);
  const activeFilterCount = (typeFilter!=='all'?1:0) + (dueOnly?1:0) + (discFilter.size?1:0) + (leadSourceFilter?1:0) + (priorityFilter.size?1:0) + (reachFilter!=='any'?1:0) + (recencyFilter!=='any'?1:0);
  const clearAllFilters = () => { setTypeFilter('all'); setDueOnly(false); setDiscFilter(new Set()); setLeadSourceFilter(''); setPriorityFilter(new Set()); setReachFilter('any'); setRecencyFilter('any'); };
  const selectAllFiltered = () => setSelIds(new Set(sorted.map(c => c.id)));
  const toggleSetVal = (setter, val) => setter(prev => { const nx = new Set(prev); nx.has(val) ? nx.delete(val) : nx.add(val); return nx; });
  const FLABEL = { fontSize:'10px', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600, marginBottom:'6px' };
  const chipBtn = (on, color) => ({ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:999, fontSize:12, fontWeight:700, cursor:'pointer', border:`1px solid ${on?color:'var(--border)'}`, background:on?color+'22':'transparent', color:on?color:'var(--text-2)' });

  async function handleSave(data) {
    let savedRow = null;
    if (editContact) {
      const { data: updated, error } = await supabase.from('contacts').update(data).eq('id', editContact.id).select().single();
      if (error) {
        console.error('[contacts.update] save failed', { error, id: editContact.id, data });
        notify(describeSaveError(error, 'save'), 'error');
        return;
      }
      savedRow = updated;
      if (updated) setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    } else {
      const { data: created, error } = await supabase.from('contacts').insert({ ...data, user_id: userId }).select().single();
      if (error) {
        console.error('[contacts.insert] create failed', { error, data });
        notify(describeSaveError(error, 'create'), 'error');
        return;
      }
      savedRow = created;
      if (created) setContacts(prev => [created, ...prev]);
    }
    setShowModal(false);
    if (editFromDetail && savedRow) setDetailContact(savedRow);
    else if (window.__researchAfterSave && savedRow) { window.__researchAfterSave = false; window.__autoResearch = savedRow.id; setDetailContact(savedRow); }
    setEditContact(null); setEditFromDetail(false);
  }

  async function deleteContact(id) {
    if (!await confirmDialog('Delete this contact?')) return;
    // Snapshot for rollback
    const snapshot = contacts.find(c => c.id === id);
    setContacts(prev => prev.filter(c => c.id !== id));
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) {
      // Rollback
      if (snapshot) setContacts(prev => [snapshot, ...prev.filter(c => c.id !== id)]);
      notify("Couldn't delete contact. Reverted.", 'error');
    }
  }

  // Shared definition — this used to re-derive the rule and had drifted: it
  // honoured no_reply_needed_at but not comms_settled_at, so a Settled contact
  // still headlined "you owe a reply" here. The one-day grace and the snooze are
  // this screen's own additions on top of the shared rule.
  const oweReplyFn = (c) => owesReply(c)
    && (Date.now()-new Date(c.last_inbound_at))/86400000 >= 1
    && !(c.reachout_snooze_until && new Date(c.reachout_snooze_until)>new Date());
  const dueCount = useMemo(() => contacts.filter(c => { const cd = cadenceDue(c); return (cd && cd.due && !cd.snoozed) || oweReplyFn(c); }).length, [contacts]);
  const reachNext = useMemo(() => {
    const owe = contacts.find(oweReplyFn);
    if (owe) return { c: owe, why: 'you owe a reply · ' + relDaysShort(Math.floor((Date.now()-new Date(owe.last_inbound_at))/86400000)) + ' ago' };
    const due = contacts.find(c => { const cd = cadenceDue(c); return cd && cd.due && !cd.snoozed; });
    if (due) return { c: due, why: 'due for a touch · ' + relDaysShort(daysSinceTouch(due)) + ' since last' };
    return null;
  }, [contacts]);

  // Clear the "reach out" requirement. If it's an owe-a-reply, stamp
  // no_reply_needed_at at the inbound time — honest (doesn't fake a reply) and
  // auto-re-arms if they write again. If it's a cadence "due for a touch", snooze.
  // Either way the card auto-falls-through to cadence, or off entirely.
  const clearReachout = async (c, why) => {
    const isOwe = /owe a reply/.test(why || '');
    const patch = isOwe
      ? { no_reply_needed_at: c.last_inbound_at || new Date().toISOString() }
      : { reachout_snooze_until: new Date(Date.now() + 30*86400000).toISOString() };
    // optimistic update so the card re-evaluates immediately
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x));
    const { error } = await supabase.from('contacts').update(patch).eq('id', c.id);
    if (error) {
      // revert on failure
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, ...Object.fromEntries(Object.keys(patch).map(k=>[k, c[k]])) } : x));
      if (window.__notify) window.__notify('Could not clear: ' + error.message);
    }
  };
  return (
    <div className="ww-contacts">
      <style>{`
        .ww-contacts{
          --bg-base:#100D09; --bg-card:#1B1610; --bg-panel:#18130D; --bg-hover:#221B10;
          --border:rgba(203,163,92,.20); --border-strong:rgba(203,163,92,.40);
          --accent:#CBA35C; --accent-2:#EBCB82; --accent-dim:#946F2C; --accent-glow:rgba(203,163,92,.18);
          --text-1:#F6F1E7; --text-2:#C8BFAE; --text-3:#8C8475;
          font-family:Manrope,sans-serif;
          background:radial-gradient(120% 38% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;
          min-height:100%;
        }
        .ww-contacts .page-header h2{ font-family:'Fraunces',serif; font-weight:300; letter-spacing:-.02em; font-size:30px; }
        .ww-contacts .form-input, .ww-contacts .form-select, .ww-contacts .form-textarea{ background:#1B1610; border:1px solid rgba(203,163,92,.22); color:#F6F1E7; }
        .ww-contacts .form-input::placeholder, .ww-contacts .form-textarea::placeholder{ color:#736c5f; }
        .ww-contacts .form-input:focus, .ww-contacts .form-select:focus, .ww-contacts .form-textarea:focus{ border-color:#CBA35C; }
        .ww-contacts .btn-primary{ background:#EBCB82; color:#1a1409; border:none; }
        .ww-contacts .btn-ghost{ border:1px solid rgba(203,163,92,.34); color:#C8BFAE; }
        .ww-contacts .btn-ghost:hover{ border-color:#CBA35C; color:#EBCB82; }
        .ww-contacts .pill{ border-color:rgba(203,163,92,.24); }
        .ww-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.24em; text-transform:uppercase; color:#CBA35C; }
        .ww-next{ margin:16px 0 6px; border:1px solid rgba(203,163,92,.40); border-radius:18px; padding:15px 16px 14px; background:radial-gradient(90% 130% at 100% 0%, rgba(203,163,92,.12), transparent 55%), linear-gradient(180deg,#1B1610,#100D09); }
        .ww-next .lab{ font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#CBA35C; font-weight:700; margin-bottom:12px; }
        .ww-nrow{ display:flex; align-items:center; gap:13px; }
        .ww-nrow .nm{ flex:1; min-width:0; }
        .ww-nrow .nm .n{ font-size:17px; font-weight:700; color:#F6F1E7; }
        .ww-nrow .nm .m{ font-size:12.5px; color:#C8BFAE; margin-top:2px; }
        .ww-nrow .nm .m em{ color:#EBCB82; font-style:normal; font-weight:600; }
        .ww-acts{ display:flex; gap:8px; margin-top:13px; }
        .ww-acts a, .ww-acts button{ flex:1; text-align:center; background:transparent; border:1px solid rgba(203,163,92,.40); color:#C8BFAE; font-family:Manrope,sans-serif; font-size:12.5px; font-weight:600; padding:9px; border-radius:100px; cursor:pointer; text-decoration:none; }
        .ww-acts .p{ background:#EBCB82; color:#1a1409; border:none; font-weight:700; }
        .ww-acts .ww-clear{ flex:0 0 auto; padding:9px 14px; border-color:rgba(203,163,92,.22); color:#8C8475; }
        .ww-acts .ww-clear:hover{ border-color:rgba(203,163,92,.45); color:#C8BFAE; }
        .ww-av{ width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-family:'Fraunces',serif; font-size:15px; color:#EBCB82; border:1px solid rgba(203,163,92,.40); background:#18130D; text-transform:uppercase; }
        .ww-row{ display:flex; align-items:center; gap:13px; padding:14px 2px; border-bottom:1px solid rgba(203,163,92,.16); }
        .ww-row .ww-body{ flex:1; min-width:0; }
        .ww-row .ww-n{ font-size:15.5px; font-weight:700; color:#F6F1E7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ww-row .ww-m{ font-size:12.5px; color:#8C8475; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ww-right{ text-align:right; flex:none; display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
        .ww-disc{ font-family:'Fraunces',serif; font-size:15px; color:#CBA35C; letter-spacing:.04em; }
        .ww-touch{ font-size:11.5px; color:#8C8475; display:flex; align-items:center; gap:6px; }
        .ww-touch.due{ color:#EBCB82; }
        .ww-dot{ width:7px; height:7px; border-radius:50%; background:rgba(203,163,92,.40); }
        .ww-dot.due{ background:#EBCB82; box-shadow:0 0 8px rgba(235,203,130,.6); }
        .ww-quick{ margin:8px 0 6px; border:1px solid rgba(203,163,92,.22); border-radius:14px; overflow:hidden; background:#18130D; }
        .ww-qrow{ display:flex; align-items:center; gap:11px; padding:12px 14px; border-bottom:1px solid rgba(203,163,92,.12); cursor:pointer; }
        .ww-qrow:last-child{ border-bottom:none; }
        .ww-qrow:active{ background:rgba(203,163,92,.10); }
        .ww-qav{ width:31px; height:31px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-family:'Fraunces',serif; font-size:12px; color:#EBCB82; border:1px solid rgba(203,163,92,.40); background:#100D09; text-transform:uppercase; }
        .ww-qn{ font-size:15.5px; font-weight:700; color:#F6F1E7; white-space:nowrap; flex:none; }
        .ww-qm{ font-size:12.5px; color:#8C8475; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ww-qdisc{ font-family:'Fraunces',serif; font-size:14px; color:#CBA35C; flex:none; }
        .ww-qmore{ padding:10px 14px; font-size:12px; color:#8C8475; text-align:center; }
        .ww-qempty{ padding:16px 14px; font-size:13.5px; color:#8C8475; text-align:center; }
      `}</style>
      <TipFor screen="contacts" />
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'10px'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontFamily:"'Barlow Condensed',sans-serif",textTransform:'uppercase',letterSpacing:'.22em',fontSize:'11px',fontWeight:600,color:'var(--accent)',marginBottom:'3px'}}>Relationships</div><h2 style={{margin:'0 0 6px'}}>Your people.</h2><p style={{color:'var(--text-3)',fontSize:'13px'}}>{contacts.length} contacts{dueCount>0 && <> · <b style={{color:'var(--accent-2)',fontWeight:700}}>{dueCount} due</b> for a touch</>}</p></div>
        <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
          <button className="btn btn-ghost btn-sm" onClick={()=> tagMode ? exitTag() : setTagMode(true)} title="Select multiple contacts to message or tag" style={tagMode?{background:'var(--accent)',color:'#111',border:'1px solid var(--accent)',fontWeight:700}:{}}>{tagMode?'Done':'Select'}</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setShowVCard(true)} title="Create a contact from a vCard">vCard</button>
          <button className="btn-add-circle" onClick={()=>{setEditContact(null);setShowModal(true);}} title="New Contact" aria-label="New Contact">+</button>
        </div>
      </div>

      {tagMode && (
        <div style={{position:'fixed',left:0,right:0,bottom:0,zIndex:60,background:'var(--bg-card)',borderTop:'1px solid var(--accent)',padding:'12px 16px calc(12px + env(safe-area-inset-bottom,0px))',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',boxShadow:'0 -6px 20px rgba(0,0,0,0.45)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,width:'100%',flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:700,color:'var(--text-1)'}}>{selIds.size} selected</span>
            <button className="btn btn-ghost btn-sm" onClick={selectAllFiltered} title="Select every contact that matches your current filters">Select all ({sorted.length})</button>
            {selIds.size>0 && <button className="btn btn-ghost btn-sm" onClick={()=>setSelIds(new Set())}>Clear</button>}
            <div style={{display:'flex',gap:8,marginLeft:'auto'}}>
              <button className="btn btn-primary btn-sm" disabled={selIds.size===0} onClick={()=>setBulkChannel('text')} style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="message" size={14}/> Text</button>
              <button className="btn btn-primary btn-sm" disabled={selIds.size===0} onClick={()=>setBulkChannel('email')} style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="mail" size={14}/> Email</button>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,width:'100%',flexWrap:'wrap'}}>
            <select className="form-input" value={tagSysId} onChange={e=>setTagSysId(e.target.value)} style={{flex:'1 1 150px',minWidth:140,margin:0,padding:'8px 10px',fontSize:13}}>
              <option value="">Tag a lead source…</option>
              {tagSystems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" disabled={!tagSysId || selIds.size===0 || applyingTag} onClick={applyTag}>{applyingTag?'Applying…':'Apply tag'}</button>
            <button className="btn btn-ghost btn-sm" onClick={exitTag}>Done</button>
          </div>
        </div>
      )}

      {/* Search input — always visible, first thing on the page. The × clears the text (no collapse). */}
      <HeaderSearchInput
        value={search}
        onChange={setSearch}
        placeholder="🔍 Search contacts (name, email, company)…"
        onClose={() => {}}
        autoFocus={false}
      />

      {!tagMode && !search.trim() && <Tip id="disc" label="Reading the room">That gold letter on a contact is their <b>behavioral style</b> (DISC). A <b>D</b> wants the bottom line, fast; an <b>S</b> wants warmth and reassurance. Match your delivery to how they're wired and rapport comes easy — Prism reads it for you, so you never have to be the expert.</Tip>}
      {!tagMode && !search.trim() && reachNext && (
        <div className="ww-next">
          <div className="lab">Reach out next</div>
          <div className="ww-nrow">
            <div className="ww-av">{(reachNext.c.name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase()}</div>
            <div className="nm">
              <div className="n">{reachNext.c.name}</div>
              <div className="m">{[CONTACT_TYPE_LABELS[reachNext.c.type]||reachNext.c.type].filter(Boolean).join(' · ')} · <em>{reachNext.why}</em></div>
            </div>
            {(() => { const rp = profileByContact.get(reachNext.c.id); return rp?.primary_letter ? <span className="ww-disc" style={{fontSize:16}}>{rp.primary_letter}{rp.secondary_letter?'/'+rp.secondary_letter:''}</span> : null; })()}
          </div>
          <div className="ww-acts">
            {reachNext.c.phone && <a className="p" href={`tel:${(reachNext.c.phone||'').replace(/[^\d+]/g,'')}`} onClick={e=>e.stopPropagation()}>Call</a>}
            {reachNext.c.phone && <button onClick={()=>setTextTo({ contact: reachNext.c, phone: reachNext.c.phone })}>Text</button>}
            {reachNext.c.email && <button onClick={()=>{ if(window.__composeEmail) window.__composeEmail(reachNext.c.email); }}>Email</button>}
            <button onClick={()=>setDetailContact(reachNext.c)}>Open</button>
            <button className="ww-clear" title={/owe a reply/.test(reachNext.why) ? 'Mark handled — clears the reply you owe' : 'Not now — snooze this touch'} onClick={()=>clearReachout(reachNext.c, reachNext.why)}>Clear</button>
          </div>
        </div>
      )}

      {search.trim() && (
        <div className="ww-quick">
          {sorted.length === 0
            ? <div className="ww-qempty">No matches for “{search.trim()}”</div>
            : sorted.slice(0, 12).map(c => {
                const qp = profileByContact.get(c.id);
                const qi = (c.name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
                return (
                  <div key={c.id} className="ww-qrow" onClick={()=>{ if(tagMode){ toggleSel(c.id); } else { setDetailContact(c); } }}>
                    <div className="ww-qav">{qi}</div>
                    <span className="ww-qn">{c.name}</span>
                    <span className="ww-qm">{[CONTACT_TYPE_LABELS[c.type]||c.type, c.company].filter(Boolean).join(' · ')}</span>
                    {qp?.primary_letter && <span className="ww-qdisc">{qp.primary_letter}</span>}
                  </div>
                );
              })}
          {sorted.length > 12 && <div className="ww-qmore">+{sorted.length - 12} more — scroll for all</div>}
        </div>
      )}

      {/* Filters — pairs with multi-select: narrow the list, then Select all */}
      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom: showFilters?'10px':'14px'}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>setShowFilters(v=>!v)} style={activeFilterCount?{borderColor:'var(--accent)',color:'var(--accent)',fontWeight:700}:{}}>
          ⚲ Filters{activeFilterCount?` · ${activeFilterCount}`:''} {showFilters?'▲':'▾'}
        </button>
        {activeFilterCount>0 && <button className="btn btn-ghost btn-sm" onClick={clearAllFilters} style={{color:'var(--text-3)'}}>Clear all</button>}
        <span style={{marginLeft:'auto',fontSize:'12px',color:'var(--text-3)'}}>{sorted.length} match{sorted.length===1?'':'es'}</span>
      </div>

      {showFilters && (
        <div className="panel" style={{marginBottom:'14px',padding:'14px',display:'flex',flexDirection:'column',gap:'14px'}}>
          <div>
            <div style={FLABEL}>Behavioral style (DISC)</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['D','I','S','C'].map(k=>{ const m=DISC_STYLE_META[k]; return (
                <button key={k} onClick={()=>toggleSetVal(setDiscFilter,k)} style={chipBtn(discFilter.has(k),m.color)} title={m.name}>{k} · {discCounts[k]}</button>
              ); })}
              <button onClick={()=>toggleSetVal(setDiscFilter,'none')} style={chipBtn(discFilter.has('none'),'#9499b0')}>No DISC · {discCounts.none}</button>
            </div>
          </div>
          <div>
            <div style={FLABEL}>Priority</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[['urgent','#ef4444','Urgent'],['high','#f59e0b','High'],['normal','#9499b0','Normal'],['low','#6b7280','Low']].map(([v,col,lab])=>(
                <button key={v} onClick={()=>toggleSetVal(setPriorityFilter,v)} style={chipBtn(priorityFilter.has(v),col)}>{lab} · {priorityCounts[v]}</button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <div style={{flex:'1 1 180px',minWidth:160}}>
              <div style={FLABEL}>Lead source</div>
              <select className="form-select" value={leadSourceFilter} onChange={e=>setLeadSourceFilter(e.target.value)} style={{margin:0}}>
                <option value="">Any source</option>
                <option value="unassigned">— Unassigned —</option>
                {tagSystems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{flex:'1 1 150px',minWidth:140}}>
              <div style={FLABEL}>Reachable by</div>
              <select className="form-select" value={reachFilter} onChange={e=>setReachFilter(e.target.value)} style={{margin:0}}>
                <option value="any">Any</option>
                <option value="has_phone">Has phone</option>
                <option value="has_email">Has email</option>
              </select>
            </div>
            <div style={{flex:'1 1 160px',minWidth:150}}>
              <div style={FLABEL}>Last contacted</div>
              <select className="form-select" value={recencyFilter} onChange={e=>setRecencyFilter(e.target.value)} style={{margin:0}}>
                <option value="any">Any time</option>
                <option value="never">Never contacted</option>
                <option value="30">30+ days ago</option>
                <option value="60">60+ days ago</option>
                <option value="90">90+ days ago</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={sorted.length===0} onClick={()=>{ setTagMode(true); selectAllFiltered(); }} style={{alignSelf:'flex-start',display:'inline-flex',alignItems:'center',gap:6}}>
            <Icon name="users" size={14} /> Select all {sorted.length} & act
          </button>
        </div>
      )}

      {showFilters && (
      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'14px'}}>
        <button className="btn btn-ghost btn-sm" onClick={runEmailLinkScan} disabled={scanning}
          title="Scan inbox for senders that may match your contacts. Safe auto-fills are applied immediately; ambiguous matches go to review.">
          {scanning ? '↻ Scanning…' : <><Icon name="link" size={13} /> Scan emails</>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={runPhoneExtraction} disabled={extractingPhones}
          title="Extract phone numbers from email signatures and auto-fill empty contact.phone fields.">
          {extractingPhones ? '↻ Extracting…' : <><Icon name="quo" size={13} /> Extract phones</>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={runDuplicateScan} disabled={findingDupes}
          title="Find likely duplicate contacts based on email, phone, or name+company. Surfaces for review — never auto-merges.">
          {findingDupes ? '↻ Scanning…' : <><Icon name="search" size={13} /> Find dupes</>}
        </button>
      </div>
      )}

      {/* Phone extraction feedback */}
      {phoneMsg && (
        <div style={{padding:'8px 12px',marginBottom:'10px',borderRadius:'8px',
          background: phoneMsg.type === 'ok' ? 'rgba(34,197,94,0.10)' : phoneMsg.type === 'error' ? 'rgba(239,68,68,0.10)' : 'rgba(197,169,94,0.08)',
          border: `1px solid ${phoneMsg.type === 'ok' ? '#22c55e' : phoneMsg.type === 'error' ? '#ef4444' : 'var(--accent)'}`,
          color: phoneMsg.type === 'ok' ? '#22c55e' : phoneMsg.type === 'error' ? '#ef4444' : 'var(--text-1)',
          fontSize:'12px'}}>
          {phoneMsg.text}
        </div>
      )}

      {/* Duplicate banner */}
      {dupeGroups && dupeGroups.length > 0 && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(245,158,11,0.10)',border:'1px solid var(--yellow)',borderRadius:'8px',color:'var(--text-1)',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="alert" size={13} /> <strong>{dupeGroups.length}</strong> likely duplicate group{dupeGroups.length === 1 ? '' : 's'} found.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDupeReview(true)} style={{color:'var(--yellow)'}}>Review →</button>
        </div>
      )}

      {/* Just-ran feedback */}
      {linkSummary?.just_ran && (linkSummary.auto_linked + linkSummary.auto_filled > 0) && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(34, 197, 94, 0.10)',border:'1px solid #22c55e',borderRadius:'8px',color:'#22c55e',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>
            ✓ Linked {linkSummary.auto_linked || 0} contact{linkSummary.auto_linked === 1 ? '' : 's'} via email match
            {linkSummary.auto_filled > 0 && <>, filled {linkSummary.auto_filled} new email{linkSummary.auto_filled === 1 ? '' : 's'}</>}.
          </span>
          <button onClick={() => setLinkSummary(s => ({ ...s, just_ran: false }))} style={{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:'14px'}}>×</button>
        </div>
      )}

      {/* Pending suggestions banner */}
      {((linkSummary?.suggestions_count || 0) + (linkSummary?.new_contact_count || 0)) > 0 && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(197, 169, 94, 0.08)',border:'1px solid var(--accent)',borderRadius:'8px',color:'var(--text-1)',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          <span>
            {(() => {
              const m = linkSummary.suggestions_count || 0;
              const n = linkSummary.new_contact_count || 0;
              const parts = [];
              if (m > 0) parts.push(<span key="link"><strong>{m}</strong> possible match{m === 1 ? '' : 'es'}</span>);
              if (n > 0) parts.push(<span key="new"><strong>{n}</strong> potential new contact{n === 1 ? '' : 's'}</span>);
              return parts.reduce((acc, p, i) => i === 0 ? [p] : [...acc, ' · ', p], []);
            })()}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLinkReview(true)} style={{color:'var(--accent)'}}>Review →</button>
        </div>
      )}

      <div className="panel">
        <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
          {/* Search lives in header icon now — see the magnifying-glass next to the + button.
              Type filter + sort take the row to themselves. */}
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'flex-end'}}>
            <div style={{flex:'1 1 220px',minWidth:0}}>
              <label style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,display:'block',marginBottom:'4px'}}>Filter by type</label>
              <select className="form-select" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{margin:0}}>
                <option value="all">All ({contacts.length})</option>
                {typeOptions.map(t => {
                  const count = contacts.filter(c => c.type === t.id).length;
                  if (count === 0) return null;
                  return <option key={t.id} value={t.id}>{t.icon} {t.label} ({count})</option>;
                })}
              </select>
            </div>
            <div style={{flex:'1 1 200px',minWidth:0}}>
              <label style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,display:'block',marginBottom:'4px'}}>Sort by</label>
              <select className="form-select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{margin:0}}>
                <option value="last_name">Last name, first name</option>
                <option value="first_name">First name</option>
                <option value="last_contact_oldest">Last contact (oldest first) — overdue for reach-out</option>
                <option value="last_contact_newest">Last contact (newest first)</option>
                <option value="cadence_due">Due for outreach (most overdue)</option>
                <option value="recently_added">Recently added</option>
              </select>
            </div>
          </div>
          {dueForOutreachCount > 0 && (
            <div style={{marginTop:'8px'}}>
              <button onClick={()=>setDueOnly(v=>!v)}
                style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'4px 10px',borderRadius:'999px',fontSize:'11px',fontWeight:600,cursor:'pointer',
                  border:`1px solid ${dueOnly?'var(--red)':'var(--border)'}`, background: dueOnly?'rgba(239,68,68,0.12)':'transparent', color: dueOnly?'var(--red)':'var(--text-2)'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="alert" size={12} /> Due for outreach ({dueForOutreachCount})</span>{dueOnly?' · showing' : ''}
              </button>
            </div>
          )}
        </div>
        <div className="panel-body">
          {sorted.length === 0
            ? <div className="empty-state"><div className="empty-icon"><Icon name="users" size={28} /></div><p>No contacts here.</p></div>
            : <><div className="task-list">
                {sorted.slice(0, visibleCount).map(c => {
                  const p = profileByContact.get(c.id);
                  const cad = cadenceDue(c);
                  const owe = oweReplyFn(c);
                  const isDue = (cad && cad.due && !cad.snoozed) || owe;
                  const dt = daysSinceTouch(c);
                  const touchLabel = owe ? 'owes reply' : (cad && cad.due && !cad.snoozed) ? 'due' : (dt != null ? relDaysShort(dt)+' ago' : '');
                  const initials = (c.name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
                  return (
                    <div key={c.id} className="ww-row" style={{cursor:'pointer', ...(tagMode && selIds.has(c.id) ? {background:'var(--accent-glow)'} : {})}} onClick={()=>{ if(tagMode){ toggleSel(c.id); } else { setDetailContact(c); } }}>
                      {tagMode && <span style={{width:20,height:20,borderRadius:5,border:'1.5px solid '+(selIds.has(c.id)?'var(--accent)':'var(--text-3)'),background:selIds.has(c.id)?'var(--accent)':'transparent',color:'#111',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{selIds.has(c.id)?'\u2713':''}</span>}
                      <div className="ww-av">{initials}</div>
                      <div className="ww-body">
                        <div className="ww-n">{c.name}</div>
                        <div className="ww-m">{[CONTACT_TYPE_LABELS[c.type]||c.type, c.role, c.company].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="ww-right">
                        {p?.primary_letter && <span className="ww-disc">{p.primary_letter}{p.secondary_letter?'/'+p.secondary_letter:''}</span>}
                        {touchLabel && <span className={'ww-touch'+(isDue?' due':'')}>{touchLabel}<span className={'ww-dot'+(isDue?' due':'')} /></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {sorted.length > visibleCount && (
                <button className="btn btn-ghost" style={{width:'100%',marginTop:'10px'}}
                  onClick={() => setVisibleCount(v => v + 60)}>
                  Show more — {sorted.length - visibleCount} more contact{sorted.length - visibleCount === 1 ? '' : 's'}
                </button>
              )}
              </>
          }
        </div>
      </div>
      {textTo && <QuoTextModal contact={textTo.contact} phone={textTo.phone} userId={userId} onClose={()=>setTextTo(null)} />}
      {bulkChannel && (
        <BulkDiscComposer
          contacts={contacts.filter(c=>selIds.has(c.id))}
          profileByContact={profileByContact}
          channel={bulkChannel}
          userId={userId}
          onClose={()=>setBulkChannel(null)}
          onSent={()=>{ setBulkChannel(null); exitTag(); }}
        />
      )}
      {showVCard && <VCardImportModal onClose={()=>setShowVCard(false)} onParsed={(init)=>{ setShowVCard(false); setEditContact(init); setShowModal(true); }} />}
      {showModal && <ContactModal canSeeRestricted={canSeeRestricted}
        onClose={()=>{ try { window.__researchAfterSave = false; } catch(_){} setShowModal(false); if (editFromDetail && editContact) setDetailContact(editContact); setEditContact(null); setEditFromDetail(false); }}
        onSave={handleSave}
        onDelete={async (c)=>{ if(!await confirmDialog(`Delete contact "${c.name}"?`)) return; await deleteContact(c.id); setShowModal(false); setEditContact(null); setEditFromDetail(false); }}
        onShowDetails={(c)=>{ setShowModal(false); setEditContact(null); setEditFromDetail(false); setDetailContact(c); }}
        initial={editContact}
        contacts={contacts}
        setContacts={setContacts}
        userId={userId}
      />}
      {detailContact && (
        <ContactDetailModal
          contact={detailContact}
          profile={profileByContact.get(detailContact.id) || null}
          userId={userId}
          contacts={contacts}
          setContacts={setContacts}
          onClose={() => setDetailContact(null)}
          onEdit={() => { setEditFromDetail(true); setEditContact(detailContact); setDetailContact(null); setShowModal(true); }}
          onBack={() => { setEditFromDetail(true); setEditContact(detailContact); setDetailContact(null); setShowModal(true); }}
          onProfileUpdate={handleProfileUpdate}
        />
      )}
      {showLinkReview && (
        <EmailLinkReviewModal canSeeRestricted={canSeeRestricted}
          userId={userId}
          contacts={contacts}
          setContacts={setContacts}
          onClose={() => setShowLinkReview(false)}
          onChanged={(counts) => setLinkSummary(prev => ({
            ...prev,
            suggestions_count: counts.link,
            new_contact_count: counts.new,
          }))}
        />
      )}
      {showDupeReview && (
        <DuplicateReviewModal
          groups={dupeGroups || []}
          userId={userId}
          contacts={contacts}
          setContacts={setContacts}
          onClose={() => setShowDupeReview(false)}
          onMerged={(remainingGroups) => setDupeGroups(remainingGroups)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// DUPLICATE REVIEW MODAL — surfaces likely duplicates, user picks canonical + merges
// Never auto-merges. Merge action: copies missing fields from non-canonical into
// canonical, deletes non-canonical, optionally re-points any FK references (notes,
// profiles, etc).
// ─────────────────────────────────────────

function DuplicateReviewModal({ groups, userId, contacts, setContacts, onClose, onMerged }) {

  useBackClose(onClose);
  const [localGroups, setLocalGroups] = useState(groups);
  const [selectedCanonical, setSelectedCanonical] = useState({});  // groupKey -> contactId
  const [merging, setMerging] = useState({});  // groupKey -> bool
  const [errorMsg, setErrorMsg] = useState(null);

  // Pre-populate selected canonical from suggested
  useEffect(() => {
    const init = {};
    for (const g of groups) {
      init[g.key] = g.suggested_canonical_id;
    }
    setSelectedCanonical(init);
  }, [groups]);

  async function mergeGroup(group) {
    const canonicalId = selectedCanonical[group.key];
    if (!canonicalId) return;
    const canonical = group.contacts.find(c => c.id === canonicalId);
    const others = group.contacts.filter(c => c.id !== canonicalId);
    if (!canonical || others.length === 0) return;

    setMerging(m => ({ ...m, [group.key]: true }));
    setErrorMsg(null);
    try {
      // Step 1: build a "filled" patch — copy any field from others where canonical is empty.
      const patch = {};
      const fillIfEmpty = (field) => {
        if (canonical[field]) return;
        for (const o of others) {
          if (o[field]) { patch[field] = o[field]; return; }
        }
      };
      ['email', 'phone', 'company', 'role', 'type', 'notes', 'last_contact_at'].forEach(fillIfEmpty);

      // For notes: if BOTH have notes, concatenate (canonical stays first)
      const canonicalNotes = (canonical.notes || '').trim();
      const otherNotes = others.map(o => (o.notes || '').trim()).filter(Boolean).join('\n\n---\n\n');
      if (canonicalNotes && otherNotes) {
        patch.notes = canonicalNotes + '\n\n---\nMerged from duplicate:\n' + otherNotes;
      }

      // Step 2: update canonical contact with merged fields
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from('contacts').update(patch).eq('id', canonicalId);
        if (upErr) throw upErr;
      }

      // Step 3: re-point any profile rows from others to canonical (one profile per contact)
      // Strategy: if canonical already has a profile, keep it. Delete others' profiles.
      // If canonical has no profile but others do, re-point the first to canonical.
      const { data: canonicalProfile } = await supabase.from('profiles').select('id').eq('contact_id', canonicalId).maybeSingle();
      for (const o of others) {
        const { data: otherProfile } = await supabase.from('profiles').select('id').eq('contact_id', o.id).maybeSingle();
        if (!otherProfile) continue;
        if (canonicalProfile) {
          await supabase.from('profiles').delete().eq('id', otherProfile.id);
        } else {
          await supabase.from('profiles').update({ contact_id: canonicalId }).eq('id', otherProfile.id);
        }
      }

      // Step 4: delete the duplicates
      for (const o of others) {
        await supabase.from('contacts').delete().eq('id', o.id);
      }

      // Step 5: refresh contacts in parent + remove this group from list
      const { data: fresh } = await supabase.from('contacts').select('*').order('name');
      if (fresh) setContacts(fresh);
      const remaining = localGroups.filter(g => g.key !== group.key);
      setLocalGroups(remaining);
      onMerged?.(remaining);
    } catch (err) {
      setErrorMsg(`Merge failed: ${err.message || err}`);
    } finally {
      setMerging(m => { const n = { ...m }; delete n[group.key]; return n; });
    }
  }

  // Dismiss a group without merging (mark as "not duplicates")
  function skipGroup(group) {
    const remaining = localGroups.filter(g => g.key !== group.key);
    setLocalGroups(remaining);
    onMerged?.(remaining);
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex: 1100}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'780px',width:'94%',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{margin:0}}>Duplicate contacts</h3>
            <p style={{margin:'4px 0 0',fontSize:'12px',color:'var(--text-3)'}}>
              {localGroups.length === 0 ? 'All caught up.' : `${localGroups.length} group${localGroups.length === 1 ? '' : 's'} found. Pick the record to keep, then merge.`}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{padding:'0 16px 16px',overflowY:'auto',flex:1}}>
          {errorMsg && (
            <div style={{padding:'8px 12px',marginBottom:'10px',background:'rgba(239,68,68,0.10)',border:'1px solid #ef4444',borderRadius:'6px',color:'#ef4444',fontSize:'12px'}}>
              {errorMsg}
            </div>
          )}

          {localGroups.length === 0 && (
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>✓</div>
              <div style={{color:'var(--text-2)',fontSize:'13px'}}>No duplicate groups remaining.</div>
            </div>
          )}

          {localGroups.map(g => (
            <div key={g.key} style={{padding:'12px',marginBottom:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',gap:'8px',flexWrap:'wrap'}}>
                <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Match: {g.reason}</span>
                <span style={{fontSize:'11px',color:'var(--text-3)'}}>{g.contacts.length} records</span>
              </div>
              {g.contacts.map(c => {
                const isCanonical = selectedCanonical[g.key] === c.id;
                return (
                  <label key={c.id} style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px',marginBottom:'6px',
                    background: isCanonical ? 'rgba(197,169,94,0.10)' : 'var(--bg-card)',
                    border: isCanonical ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius:'6px', cursor:'pointer'}}>
                    <input type="radio" name={`canon-${g.key}`} checked={isCanonical}
                      onChange={() => setSelectedCanonical(p => ({ ...p, [g.key]: c.id }))}
                      style={{marginTop:'3px',flexShrink:0}} />
                    <div style={{flex:1,minWidth:0,fontSize:'12px',lineHeight:1.6}}>
                      <div style={{fontWeight:600,color:'var(--text-1)'}}>{c.name || '(no name)'}</div>
                      <div style={{color:'var(--text-2)'}}>
                        {c.email && <>{c.email} · </>}
                        {c.phone && <>{c.phone} · </>}
                        {c.company && <>{c.company}{c.role ? `, ${c.role}` : ''} · </>}
                        <span style={{color:'var(--text-3)'}}>type: {CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                      </div>
                      {c.notes && (
                        <div style={{color:'var(--text-3)',fontSize:'11px',marginTop:'4px',fontStyle:'italic',maxHeight:'40px',overflow:'hidden'}}>
                          {c.notes.substring(0, 150)}{c.notes.length > 150 ? '…' : ''}
                        </div>
                      )}
                      <div style={{color:'var(--text-3)',fontSize:'10px',marginTop:'4px'}}>
                        Completeness: {c.completeness_score} · Created {new Date(c.created_at).toLocaleDateString()}
                        {isCanonical && <span style={{color:'var(--accent)',marginLeft:'8px'}}>★ KEEP THIS ONE</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
              <div style={{display:'flex',gap:'6px',marginTop:'10px',justifyContent:'flex-end'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => skipGroup(g)} disabled={merging[g.key]}>
                  Not duplicates
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => mergeGroup(g)} disabled={merging[g.key]}>
                  {merging[g.key] ? '↻ Merging…' : `Merge ${g.contacts.length - 1} into selected`}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)'}}>Merging keeps the ★ record and deletes the others. Fields are copied from deleted records into ★ where ★ is empty.</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PROPERTIES VIEW
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// PROPERTY DETAIL MODAL (Pass 3 Batch B)
//
// Read-mostly detail surface for a single property. Mirrors ContactDetailModal's
// pattern: shows linked contacts, tasks, events, investments, drawings, and
// dated notes. Edit button opens the existing PropertyModal for the field-level
// editing.
// ─────────────────────────────────────────

export default ContactsView;
