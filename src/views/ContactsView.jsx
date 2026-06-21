import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { ContactDetailModal, HeaderSearchIcon, HeaderSearchInput, Icon, MultiValueField, PropertyModal, SingleContactPicker, cadenceDue, modal, notify } from '../App';

const CONTACT_TYPES = [
  { id: 'attorney',           label: 'Attorney',           icon: '⚖️' },
  { id: 'broker',             label: 'Broker',             icon: '🧑‍💼' },
  { id: 'brokerage',          label: 'Brokerage',          icon: '🏢' },
  { id: 'builder',            label: 'Builder',            icon: '🔨' },
  { id: 'client_commercial',  label: 'Client – Commercial', icon: '🏬' },
  { id: 'client_residential', label: 'Client – Residential', icon: '🏠' },
  { id: 'commercial_tenant',  label: 'Commercial Tenant',  icon: '🏪' },
  { id: 'contractor',         label: 'Contractor',         icon: '🛠️' },
  { id: 'developer',          label: 'Developer',          icon: '🏗️' },
  { id: 'doctor',             label: 'Doctor',             icon: '🩺' },
  { id: 'family',             label: 'Family',             icon: '👨‍👩‍👧' },
  { id: 'flipper',            label: 'Flipper',            icon: '🔄' },
  { id: 'investments',        label: 'Investments',        icon: '💰' },
  { id: 'lender',             label: 'Lender',             icon: '🏦' },
  { id: 'our_agent',          label: 'Our Agent',          icon: '🌟' },
  { id: 'personal',           label: 'Personal',           icon: '💛' },
  { id: 'prospect_agent',     label: 'Prospect Agent',     icon: '🎣' },
  { id: 'regulator',          label: 'Regulator',          icon: '📋' },
  // Legacy / catchall last
  { id: 'client',             label: 'Client (legacy)',    icon: '🤝' },
  { id: 'lead',               label: 'Lead',               icon: '🌱' },
  { id: 'agent',              label: 'Agent (legacy)',     icon: '🧑‍💼' },
  { id: 'recruit',            label: 'Recruit',            icon: '🎯' },
  { id: 'partner',            label: 'Partner',            icon: '🤲' },
  { id: 'vendor',             label: 'Vendor',             icon: '🔧' },
  { id: 'misc',                label: 'Misc',              icon: '🗂️' },
  { id: 'other',              label: 'Other',              icon: '❓' },
];

const CONTACT_TYPE_LABELS = Object.fromEntries(CONTACT_TYPES.map(t => [t.id, t.label]));

// ─────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────

function ContactModal({ onClose, onSave, onDelete, initial, onShowDetails, contacts = [], setContacts, userId }) {
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

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Contact' : 'New Contact'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <div className="modal-header-actions">
            {initial && onShowDetails && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShowDetails(initial)}
                title="View activity, DISC, timeline" style={{fontSize:'11px',padding:'4px 10px'}}>
                More →
              </button>
            )}
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)} autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                {CONTACT_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Emails</label>
            <MultiValueField values={emails} onChange={setEmails} kind="email" addLabel="+ Add email"/>
          </div>
          <div className="form-group">
            <label className="form-label">Phones</label>
            <MultiValueField values={phones} onChange={setPhones} kind="phone" addLabel="+ Add phone"/>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Company</label><input className="form-input" value={company} onChange={e=>setCompany(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Role / Title</label><input className="form-input" value={role} onChange={e=>setRole(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Profession</label><input className="form-input" value={profession} onChange={e=>setProfession(e.target.value)} placeholder="e.g. Realtor, Attorney, Jeweler, Doctor…" /></div>

          <div className="form-group">
            <label className="form-label">Referred by</label>
            <SingleContactPicker
              value={referredById || null}
              onChange={(id) => setReferredById(id || '')}
              contacts={contacts}
              setContacts={setContacts}
              currentContactId={initial?.id}
              userId={userId}
              placeholder="Who referred this contact? Search or type to add…"
              defaultNewContactType="other"
            />
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Links to the person who referred them — powers referral-source tracking.</div>
          </div>

          <div className="form-group">
            <label className="form-label">Origin <span style={{color:'var(--text-3)',fontWeight:400}}>· where this lead came from</span></label>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <select className="form-input" value={origin} onChange={e=>setOrigin(e.target.value)} style={{flex:'1 1 180px'}}>
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
                <option value="clickup">ClickUp import</option>
                <option value="csv">CSV import</option>
                <option value="other">Other</option>
              </select>
              {origin && origin !== 'manual' && (
                <input className="form-input" value={originDetail} onChange={e=>setOriginDetail(e.target.value)} placeholder={origin==='referral' ? 'Who / what source?' : origin==='event' ? 'Which event?' : origin==='social' ? 'Which platform?' : 'Detail (optional)'} style={{flex:'1 1 180px'}} />
              )}
            </div>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>New contacts default to “Manual entry.” Imports are stamped automatically.</div>
          </div>

          {/* HOME ADDRESS — collapsed by default; tap header to expand */}
          {(() => {
            const homeSummary = [homeAddress, [homeCity, homeState].filter(Boolean).join(', '), homeZip]
              .filter(Boolean).join(' · ').trim();
            return (
              <div style={{marginTop:'18px',padding:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <button type="button" onClick={() => setShowHomeAddr(v => !v)}
                  style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',padding:0,marginBottom: showHomeAddr ? '10px' : 0,textAlign:'left'}}>
                  <span style={{display:'flex',flexDirection:'column',gap:'3px',flex:1,minWidth:0}}>
                    <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="home" size={13} /> Home Address</span>
                      {homeOwnership && <span style={{color:'var(--accent)',marginLeft:'6px'}}>· {homeOwnership === 'own' ? 'Own' : 'Rent'}</span>}
                    </span>
                    {!showHomeAddr && (
                      <span style={{fontSize:'13px',color: homeSummary ? 'var(--text-1)' : 'var(--text-3)',fontStyle: homeSummary ? 'normal' : 'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {homeSummary || 'Tap to add'}
                      </span>
                    )}
                  </span>
                  <span style={{color:'var(--text-3)',fontSize:'12px',marginLeft:'10px',flexShrink:0}}>{showHomeAddr ? '▼ Hide' : '▶ Edit'}</span>
                </button>
                {showHomeAddr && (
                  <>
                    <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">Street</label><input className="form-input" value={homeAddress} onChange={e=>setHomeAddress(e.target.value)} /></div>
                    <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">City</label><input className="form-input" value={homeCity} onChange={e=>setHomeCity(e.target.value)} /></div>
                    {/* State + ZIP share one row even on mobile — keeps a compact 2-line address */}
                    <div style={{display:'grid',gridTemplateColumns:'88px 1fr',gap:'12px',marginBottom:'8px'}}>
                      <div className="form-group" style={{marginBottom:0}}><label className="form-label">State</label><input className="form-input" maxLength={2} value={homeState} onChange={e=>setHomeState(e.target.value.toUpperCase())} /></div>
                      <div className="form-group" style={{marginBottom:0}}><label className="form-label">ZIP</label><input className="form-input" value={homeZip} onChange={e=>setHomeZip(e.target.value)} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label className="form-label">Own / Rent</label>
                        <select className="form-select" value={homeOwnership} onChange={e=>setHomeOwnership(e.target.value)}>
                          <option value="">—</option>
                          <option value="own">Own</option>
                          <option value="rent">Rent</option>
                        </select>
                      </div>
                      {homeOwnership === 'own' && (
                        <div className="form-group"><label className="form-label">Year Purchased</label>
                          <input className="form-input" type="number" min="1800" max="2100" value={homePurchaseYear} onChange={e=>setHomePurchaseYear(e.target.value)} placeholder="e.g. 1998" /></div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* BUSINESS ADDRESS — collapsed by default; tap header to expand */}
          {(() => {
            const bizSummary = [businessAddress, [businessCity, businessState].filter(Boolean).join(', '), businessZip]
              .filter(Boolean).join(' · ').trim();
            return (
              <div style={{marginTop:'12px',padding:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <button type="button" onClick={() => setShowBizAddr(v => !v)}
                  style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',padding:0,marginBottom: showBizAddr ? '10px' : 0,textAlign:'left'}}>
                  <span style={{display:'flex',flexDirection:'column',gap:'3px',flex:1,minWidth:0}}>
                    <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="building" size={13} /> Business Address</span>
                    </span>
                    {!showBizAddr && (
                      <span style={{fontSize:'13px',color: bizSummary ? 'var(--text-1)' : 'var(--text-3)',fontStyle: bizSummary ? 'normal' : 'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {bizSummary || 'Tap to add'}
                      </span>
                    )}
                  </span>
                  <span style={{color:'var(--text-3)',fontSize:'12px',marginLeft:'10px',flexShrink:0}}>{showBizAddr ? '▼ Hide' : '▶ Edit'}</span>
                </button>
                {showBizAddr && (
                  <>
                    <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">Street</label><input className="form-input" value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} /></div>
                    <div className="form-group" style={{marginBottom:'8px'}}><label className="form-label">City</label><input className="form-input" value={businessCity} onChange={e=>setBusinessCity(e.target.value)} /></div>
                    <div style={{display:'grid',gridTemplateColumns:'88px 1fr',gap:'12px'}}>
                      <div className="form-group" style={{marginBottom:0}}><label className="form-label">State</label><input className="form-input" maxLength={2} value={businessState} onChange={e=>setBusinessState(e.target.value.toUpperCase())} /></div>
                      <div className="form-group" style={{marginBottom:0}}><label className="form-label">ZIP</label><input className="form-input" value={businessZip} onChange={e=>setBusinessZip(e.target.value)} /></div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* 1099-NEC / W-9 — collapsible. Contains sensitive PII (TIN); only
              shown for active 1099 vendors by default. */}
          <div style={{marginTop:'12px',padding:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
            <button type="button" onClick={() => setShow1099(v => !v)}
              style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',padding:0,marginBottom: show1099 ? '10px' : 0}}>
              <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="file" size={13} /> 1099 / W-9</span> {is1099Vendor && <span style={{color:'var(--accent)'}}>· flagged</span>}
                {w9Collected && <span style={{color:'var(--green)'}}> · W-9 ✓</span>}
              </span>
              <span style={{color:'var(--text-3)',fontSize:'12px'}}>{show1099 ? '▼' : '▶'}</span>
            </button>
            {show1099 && (
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
                  <input type="checkbox" checked={is1099Vendor} onChange={e => setIs1099Vendor(e.target.checked)}/>
                  <span style={{fontSize:'12px',color:'var(--text-1)',fontWeight:600}}>Track as 1099-NEC vendor</span>
                </label>
                <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'-4px',marginLeft:'24px',lineHeight:1.5}}>
                  Check this for any independent contractor / service vendor paid $600+ in a calendar year (Cynthia, attorneys, contractors, etc.).
                </div>

                {is1099Vendor && (
                  <>
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
                      <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px',lineHeight:1.5}}>
                        Corps generally do NOT need 1099s — except attorneys, which always do. Use Force 1099 below for those.
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group" style={{flex:'0 0 110px',marginBottom:0}}>
                        <label className="form-label">TIN type</label>
                        <select className="form-select" value={taxIdType} onChange={e => setTaxIdType(e.target.value)}>
                          <option value="">—</option>
                          <option value="ssn">SSN</option>
                          <option value="ein">EIN</option>
                        </select>
                      </div>
                      <div className="form-group" style={{flex:1,marginBottom:0}}>
                        <label className="form-label">Tax ID number</label>
                        <input className="form-input" type="text" value={taxIdFull}
                          onChange={e => setTaxIdFull(e.target.value)}
                          placeholder={taxIdType === 'ein' ? '12-3456789' : '123-45-6789'}
                          autoComplete="off"/>
                      </div>
                    </div>
                    <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'-4px',lineHeight:1.5}}>
                      ⚠ Sensitive. Stored encrypted at rest by Supabase; only you can read it (RLS). Used only on the 1099-NEC year-end report.
                    </div>

                    <div className="form-row">
                      <label className="form-group" style={{flex:1,display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginBottom:0}}>
                        <input type="checkbox" checked={w9Collected} onChange={e => setW9Collected(e.target.checked)}/>
                        <span style={{fontSize:'12px',color:'var(--text-1)'}}>Signed W-9 on file</span>
                      </label>
                      {w9Collected && (
                        <div className="form-group" style={{flex:1,marginBottom:0}}>
                          <label className="form-label">Date received</label>
                          <input className="form-input" type="date" value={w9CollectedDate}
                            onChange={e => setW9CollectedDate(e.target.value)}/>
                        </div>
                      )}
                    </div>

                    <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
                      <input type="checkbox" checked={force1099} onChange={e => setForce1099(e.target.checked)}/>
                      <span style={{fontSize:'12px',color:'var(--text-1)'}}>Force 1099 even if corporation (attorneys, etc.)</span>
                    </label>

                    <div className="form-group" style={{marginBottom:0}}>
                      <label className="form-label">Exempt reason (optional)</label>
                      <input className="form-input" type="text" value={exempt1099Reason}
                        onChange={e => setExempt1099Reason(e.target.value)}
                        placeholder='e.g. "Paid via credit card" — those go on 1099-K, not 1099-NEC'/>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="form-group" style={{marginTop:'14px'}}><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Context, history, anything to remember…" /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Contact</button>
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

function EmailLinkReviewModal({ userId, contacts, setContacts, onClose, onChanged }) {
  const [suggestions, setSuggestions] = useState(null);
  const [newContactSuggestions, setNewContactSuggestions] = useState(null);
  const [busy, setBusy] = useState({});
  const [openSrc, setOpenSrc] = useState({});  // sender_email -> action label
  const [pickerFor, setPickerFor] = useState(null);  // sender_email when picking different contact
  const [pickerQuery, setPickerQuery] = useState('');
  // For "Add" on a new-contact suggestion
  const [addingNewFor, setAddingNewFor] = useState(null);
  const [newContactType, setNewContactType] = useState('lead');
  const [newContactName, setNewContactName] = useState('');

  const loadSuggestions = useCallback(async () => {
    setSuggestions(null);
    setNewContactSuggestions(null);
    const { data } = await supabase.functions.invoke('contact-link-emails', {
      body: { user_id: userId, apply_auto: false },
    });
    if (data?.ok) {
      setSuggestions(data.suggestions || []);
      setNewContactSuggestions(data.new_contact_suggestions || []);
      onChanged?.({
        link: data.suggestions_count || 0,
        new: data.new_contact_suggestions_count || 0,
      });
    } else {
      setSuggestions([]);
      setNewContactSuggestions([]);
    }
  }, [userId, onChanged]);

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
      const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
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
          {suggestions === null && <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Scanning…</div>}

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
                              {CONTACT_TYPES.map(t => (
                                <option key={t.id} value={t.id}>{t.label}</option>
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


function ContactsView({ contacts, setContacts, userId, profiles, setProfiles }) {
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [detailContact, setDetailContact] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('last_name');  // 'last_name' | 'first_name' | 'last_contact_oldest' | 'last_contact_newest' | 'recently_added' | 'cadence_due'
  const [dueOnly, setDueOnly] = useState(false);
  const [search, setSearch] = useState('');
  // Search input collapses into a header icon; open it on demand.
  const [searchOpen, setSearchOpen] = useState(false);

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
        const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
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
      const { data } = await supabase.functions.invoke('contact-extract-phones', {
        body: { user_id: userId, apply: true },
      });
      if (data?.ok) {
        const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
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
      setPhoneMsg({ type: 'error', text: 'Extraction failed: ' + (err.message || err) });
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

  async function handleSave(data) {
    if (editContact) {
      const { data: updated, error } = await supabase.from('contacts').update(data).eq('id', editContact.id).select().single();
      if (error) {
        notify("Couldn't save contact. Try again.", 'error');
        return;
      }
      if (updated) setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    } else {
      const { data: created, error } = await supabase.from('contacts').insert({ ...data, user_id: userId }).select().single();
      if (error) {
        notify("Couldn't create contact. Try again.", 'error');
        return;
      }
      if (created) setContacts(prev => [created, ...prev]);
    }
    setShowModal(false); setEditContact(null);
  }

  async function deleteContact(id) {
    if (!window.confirm('Delete this contact?')) return;
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

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'10px'}}>
        <div style={{flex:1,minWidth:0}}><h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="contacts" size={26} style={{color:'var(--accent)',flexShrink:0}} />Contacts</h2><p>{contacts.length} total · {sorted.length} shown</p></div>
        <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
          <HeaderSearchIcon
            value={search}
            open={searchOpen}
            onToggle={() => setSearchOpen(o => !o)}
          />
          <button className="btn-add-circle" onClick={()=>{setEditContact(null);setShowModal(true);}} title="New Contact" aria-label="New Contact">+</button>
        </div>
      </div>

      {/* Search input — collapsible. Only renders when icon is toggled open. */}
      {searchOpen && (
        <HeaderSearchInput
          value={search}
          onChange={setSearch}
          placeholder="🔍 Search contacts (name, email, company)…"
          onClose={() => setSearchOpen(false)}
        />
      )}
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
                {CONTACT_TYPES.map(t => {
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
            : <div className="task-list">
                {sorted.map(c => {
                  const p = profileByContact.get(c.id);
                  const discColors = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6' };
                  return (
                    <div key={c.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditContact(c);setShowModal(true);}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                          {c.name}
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                          {(() => {
                            const s = cadenceDue(c);
                            if (s && s.snoozed) return <span title={`Reach-out snoozed until ${new Date(s.snoozeUntil).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`} style={{fontSize:'10px',color:'var(--text-3)'}}>💤 snoozed</span>;
                            if (s && s.due) return <span className="pill" title={`Reach-out cadence: every ${c.cadence_days}d · last touch ${relDaysShort(s.daysSince)} ago`} style={{fontSize:'10px',padding:'2px 7px',fontWeight:700,background:'var(--red)',color:'#fff'}}>⚠ reach out</span>;
                            if (c.cadence_days) return <span title={`On a ${c.cadence_days}-day cadence · last touch ${relDaysShort(daysSinceTouch(c))} ago`} style={{fontSize:'10px',color:'var(--text-3)'}}>🕑 {relDaysShort(daysSinceTouch(c))}</span>;
                            return null;
                          })()}
                          {p?.primary_letter && (
                            <span title={`DISC ${p.primary_letter}${p.secondary_letter ? '/' + p.secondary_letter : ''} · ${p.confidence_pct || 0}% confidence · ${p.analysis_status || 'ready'}`}
                              className="pill"
                              style={{
                                fontSize:'10px', padding:'2px 7px', fontWeight:700,
                                background: discColors[p.primary_letter],
                                color: '#fff',
                                opacity: p.analysis_status === 'provisional' ? 0.6 : 1,
                              }}>
                              {p.primary_letter}{p.secondary_letter ? `/${p.secondary_letter}` : ''}
                              {p.confidence_pct ? ` ${p.confidence_pct}%` : ''}
                              {p.analysis_status === 'provisional' ? ' · prov' : ''}
                              {p.analysis_status === 'baseline_only' ? ' · base' : ''}
                            </span>
                          )}
                          {p?.drift_note && (
                            <span title={p.drift_note} style={{fontSize:'12px',color:'#f59e0b'}}>⚠</span>
                          )}
                        </div>
                        {(c.company || c.role) && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>{[c.role,c.company].filter(Boolean).join(' · ')}</div>}
                        {(c.email || c.phone) && (() => {
                          const tel = (c.phone || '').replace(/[^\d+]/g, '');
                          const chip = { display:'inline-flex', alignItems:'center', gap:'5px', padding:'5px 10px', borderRadius:'999px', background:'rgba(197,169,94,0.10)', border:'1px solid var(--border)', color:'var(--text-1)', fontSize:'11.5px', textDecoration:'none', lineHeight:1.4 };
                          const iconBtn = { display:'inline-flex', alignItems:'center', justifyContent:'center', width:'34px', height:'30px', borderRadius:'999px', background:'rgba(197,169,94,0.10)', border:'1px solid var(--border)', color:'var(--accent)', fontSize:'13px', textDecoration:'none' };
                          return (
                            <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px'}}>
                              {c.phone && <a href={`tel:${tel}`} onClick={e=>e.stopPropagation()} title="Call" style={chip}><Icon name="quo" size={12} style={{color:'var(--accent)'}} />&nbsp;{c.phone}</a>}
                              {c.phone && <a href={`sms:${tel}`} onClick={e=>e.stopPropagation()} title="Text" style={iconBtn}><Icon name="message" size={13} /></a>}
                              {c.email && <a href={`mailto:${c.email}`} onClick={e=>e.stopPropagation()} title="Email" style={{...chip, maxWidth:'100%', overflow:'hidden'}}><Icon name="mail" size={12} style={{color:'var(--accent)'}} />&nbsp;<span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email}</span></a>}
                            </div>
                          );
                        })()}
                        {(() => {
                          // Subtle communication state line
                          if (!c.last_inbound_at && !c.last_outbound_at) return null;
                          const lin = c.last_inbound_at;
                          const lout = c.last_outbound_at;
                          const dir = c.last_communication_direction;
                          const rel = (ts) => {
                            const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
                            if (d === 0) return 'today';
                            if (d === 1) return '1d ago';
                            if (d < 7) return `${d}d ago`;
                            if (d < 30) return `${Math.floor(d/7)}w ago`;
                            if (d < 365) return `${Math.floor(d/30)}mo ago`;
                            return `${Math.floor(d/365)}y ago`;
                          };
                          if (dir === 'inbound' && lin) {
                            const days = Math.floor((Date.now() - new Date(lin).getTime()) / 86400000);
                            const snz = c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date();
                            // Show owe-reply hint only if >= 1 day old and not snoozed
                            if (days >= 1 && !snz) {
                              return <div style={{fontSize:'11px',color:'var(--yellow)',marginTop:'3px',opacity:0.85}}>⬇ they wrote {rel(lin)} · awaiting reply</div>;
                            }
                            return <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'3px'}}>⬇ they wrote {rel(lin)}</div>;
                          }
                          if (dir === 'outbound' && lout) {
                            return <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'3px'}}>⬆ you wrote {rel(lout)}</div>;
                          }
                          return null;
                        })()}
                      </div>
                      <div className="task-meta">
                        <span className={`task-priority priority-${c.priority==='urgent'?'high':c.priority==='normal'?'medium':c.priority}`}>{c.priority}</span>
                        <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteContact(c.id);}}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <ContactModal
        onClose={()=>{setShowModal(false);setEditContact(null);}}
        onSave={handleSave}
        onDelete={async (c)=>{ if(!window.confirm(`Delete contact "${c.name}"?`)) return; await deleteContact(c.id); setShowModal(false); setEditContact(null); }}
        onShowDetails={(c)=>{ setShowModal(false); setDetailContact(c); }}
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
          onEdit={() => { setEditContact(detailContact); setDetailContact(null); setShowModal(true); }}
          onBack={() => { setEditContact(detailContact); setDetailContact(null); setShowModal(true); }}
          onProfileUpdate={handleProfileUpdate}
        />
      )}
      {showLinkReview && (
        <EmailLinkReviewModal
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
      const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
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
