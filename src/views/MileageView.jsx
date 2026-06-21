import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import { Icon, RecruitingKpiTile, SingleContactPicker, confirmDialog, modal } from '../App';

const MILEAGE_CATEGORIES = [
  { id: 'business', label: 'Business',  color: 'var(--accent)' },
  { id: 'medical',  label: 'Medical',   color: '#3b82f6' },
  { id: 'charity',  label: 'Charity',   color: '#22c55e' },
  { id: 'personal', label: 'Personal',  color: '#9499b0' },  // no deduction
];


function MileageView({ mileageEntries, setMileageEntries, deals, contacts, setContacts, properties, userId }) {
  const [rates, setRates] = useState([]);
  const [leadGenSystems, setLeadGenSystems] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);

  // Quick-log form state. Lives at the top of the view; date defaults
  // to today so the most common case (logging today's miles before bed)
  // takes three taps: miles, purpose, save.
  const [qDate, setQDate]               = useState(() => new Date().toISOString().slice(0, 10));
  const [qMiles, setQMiles]             = useState('');
  const [qPurpose, setQPurpose]         = useState('');
  const [qRoundTrip, setQRoundTrip]     = useState(false);
  const [qExpanded, setQExpanded]       = useState(false);
  const [qFromAddress, setQFromAddress] = useState('');
  const [qToAddress, setQToAddress]     = useState('');
  const [qCategory, setQCategory]       = useState('business');
  const [qDealId, setQDealId]           = useState(null);
  const [qContactId, setQContactId]     = useState(null);
  const [qPropertyId, setQPropertyId]   = useState(null);
  const [qLeadGenId, setQLeadGenId]     = useState(null);
  const [qNotes, setQNotes]             = useState('');
  const [saving, setSaving]             = useState(false);

  // Load IRS rates + lead-gen systems for attribution dropdown
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: r }, { data: s }] = await Promise.all([
        supabase.from('mileage_rates').select('*').order('year', { ascending: false }),
        supabase.from('lead_gen_systems').select('id,name,color,is_overhead')
          .eq('user_id', userId).eq('is_active', true).order('name'),
      ]);
      if (cancelled) return;
      setRates(r || []);
      setLeadGenSystems(s || []);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Current-year IRS rate for the badge
  const currentYear = new Date().getFullYear();
  const currentRate = useMemo(() => {
    const exact = rates.find(r => r.year === currentYear);
    return exact || rates[0] || null;
  }, [rates, currentYear]);

  // YTD aggregates (business category only — that's what Schedule C cares about)
  const kpis = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const ytd = mileageEntries.filter(e => e.category === 'business' && new Date(e.date) >= yearStart);
    const mtd = ytd.filter(e => new Date(e.date) >= monthStart);
    function sumMiles(arr) {
      return arr.reduce((s, e) => s + (Number(e.miles) || 0) * (e.is_round_trip ? 2 : 1), 0);
    }
    function sumDeduction(arr) {
      return arr.reduce((s, e) => s + (Number(e.computed_deduction) || 0), 0);
    }
    const ytdMiles = sumMiles(ytd);
    const ytdDeduction = sumDeduction(ytd);
    const mtdMiles = sumMiles(mtd);
    const monthsSoFar = now.getMonth() + 1;
    const avgMilesPerMonth = monthsSoFar > 0 ? ytdMiles / monthsSoFar : 0;
    return { ytdMiles, ytdDeduction, mtdMiles, avgMilesPerMonth, count: ytd.length };
  }, [mileageEntries]);

  // Group entries by year-month for the recent list
  const grouped = useMemo(() => {
    const g = {};
    mileageEntries.forEach(e => {
      const key = (e.date || '').slice(0, 7);  // YYYY-MM
      if (!g[key]) g[key] = [];
      g[key].push(e);
    });
    return Object.entries(g)
      .map(([key, entries]) => {
        const miles = entries.reduce((s, e) => s + (Number(e.miles) || 0) * (e.is_round_trip ? 2 : 1), 0);
        const deduction = entries.reduce((s, e) => s + (Number(e.computed_deduction) || 0), 0);
        return { key, entries, miles, deduction };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [mileageEntries]);

  async function quickSave() {
    if (!qMiles || !qPurpose.trim()) return;
    const miles = Number(qMiles);
    if (!(miles > 0)) return;
    setSaving(true);
    const payload = {
      user_id: userId,
      date: qDate,
      miles,
      is_round_trip: qRoundTrip,
      purpose: qPurpose.trim(),
      category: qCategory,
      from_address: qFromAddress.trim() || null,
      to_address: qToAddress.trim() || null,
      deal_id: qDealId || null,
      contact_id: qContactId || null,
      property_id: qPropertyId || null,
      lead_gen_system_id: qLeadGenId || null,
      notes: qNotes.trim() || null,
    };
    const { data, error } = await supabase
      .from('mileage_entries').insert(payload).select().single();
    setSaving(false);
    if (error) {
      if (window.__notify) window.__notify('Could not log mileage: ' + error.message, 'error');
      return;
    }
    setMileageEntries(prev => [data, ...prev]);
    // Reset
    setQMiles(''); setQPurpose(''); setQRoundTrip(false);
    setQFromAddress(''); setQToAddress(''); setQCategory('business');
    setQDealId(null); setQContactId(null); setQPropertyId(null);
    setQLeadGenId(null); setQNotes(''); setQExpanded(false);
    if (window.__notify) {
      const effMiles = qRoundTrip ? miles * 2 : miles;
      const ded = data.computed_deduction || 0;
      window.__notify(`Logged ${effMiles} mi · $${Number(ded).toFixed(2)} deduction`, 'success');
    }
  }

  async function updateEntry(entry, patch) {
    const { data, error } = await supabase
      .from('mileage_entries').update(patch).eq('id', entry.id).select().single();
    if (error) {
      if (window.__notify) window.__notify('Save failed: ' + error.message, 'error');
      return null;
    }
    setMileageEntries(prev => prev.map(e => e.id === entry.id ? data : e));
    if (editingEntry?.id === entry.id) setEditingEntry(data);
    return data;
  }

  async function deleteEntry(entry) {
    if (!await confirmDialog(`Delete this ${entry.miles}-mile entry from ${entry.date}?`)) return;
    await supabase.from('mileage_entries').delete().eq('id', entry.id);
    setMileageEntries(prev => prev.filter(e => e.id !== entry.id));
    if (editingEntry?.id === entry.id) setEditingEntry(null);
  }

  function formatMonth(key) {
    // YYYY-MM → "June 2026"
    if (!key) return '';
    const [y, m] = key.split('-');
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[Number(m) - 1]} ${y}`;
  }

  const inputStyle = {
    background:'var(--bg-base)', color:'var(--text-1)',
    border:'1px solid var(--border)', borderRadius:'6px',
    padding:'7px 9px', fontSize:'12.5px', outline:'none',
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="mileage" size={26} style={{color:'var(--accent)',flexShrink:0}} />Mileage</h2>
        {currentRate && (
          <span style={{padding:'4px 10px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'999px',fontSize:'10.5px',color:'var(--text-2)',fontWeight:600,whiteSpace:'nowrap'}}>
            IRS {currentYear}: ${Number(currentRate.business_rate).toFixed(3)}/mi
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'8px',marginBottom:'14px'}}>
        <RecruitingKpiTile label="Miles YTD" value={Math.round(kpis.ytdMiles).toLocaleString()} sub={`${kpis.count} trips`}/>
        <RecruitingKpiTile label="Deduction YTD" value={`$${Math.round(kpis.ytdDeduction).toLocaleString()}`} sub="Schedule C Line 9" color="var(--accent)"/>
        <RecruitingKpiTile label="This month" value={Math.round(kpis.mtdMiles).toLocaleString()} sub="business miles"/>
        <RecruitingKpiTile label="Avg / month" value={Math.round(kpis.avgMilesPerMonth).toLocaleString()} sub={`pace: ${Math.round(kpis.avgMilesPerMonth * 12).toLocaleString()}/yr`}/>
      </div>

      {/* Quick log form */}
      <div className="panel" style={{padding:'12px',marginBottom:'14px',background:'var(--bg-card)',border:'1px solid var(--accent)'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>
          Quick log
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {/* Row 1: date + miles + round trip */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 92px',gap:'6px',alignItems:'stretch'}}>
            <input type="date" value={qDate} onChange={e => setQDate(e.target.value)} style={inputStyle}/>
            <div style={{position:'relative'}}>
              <input type="number" step="0.1" inputMode="decimal" value={qMiles}
                onChange={e => setQMiles(e.target.value)} placeholder="Miles"
                style={{...inputStyle, width:'100%', paddingRight:'30px'}}/>
              <span style={{position:'absolute',right:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'10px',pointerEvents:'none',fontWeight:600}}>mi</span>
            </div>
          </div>
          {/* Row 2: purpose (full width) */}
          <input type="text" value={qPurpose} onChange={e => setQPurpose(e.target.value)}
            placeholder='Purpose — e.g. "Showing 14841 Oak Vine"'
            style={inputStyle}/>
          {/* Row 3: round trip + advanced toggle */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
            <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11.5px',color:'var(--text-2)',cursor:'pointer'}}>
              <input type="checkbox" checked={qRoundTrip} onChange={e => setQRoundTrip(e.target.checked)}/>
              Round trip <span style={{fontSize:'10px',color:'var(--text-3)'}}>(doubles miles)</span>
            </label>
            <button type="button" onClick={() => setQExpanded(v => !v)}
              style={{padding:'3px 9px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-3)',cursor:'pointer',fontSize:'10.5px',fontWeight:600}}>
              {qExpanded ? '× Hide details' : '+ More details'}
            </button>
          </div>

          {/* Expanded fields */}
          {qExpanded && (
            <div style={{display:'flex',flexDirection:'column',gap:'8px',padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                <input type="text" value={qFromAddress} onChange={e => setQFromAddress(e.target.value)}
                  placeholder="From address" style={inputStyle}/>
                <input type="text" value={qToAddress} onChange={e => setQToAddress(e.target.value)}
                  placeholder="To address" style={inputStyle}/>
              </div>
              <div>
                <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Category</div>
                <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                  {MILEAGE_CATEGORIES.map(c => (
                    <button key={c.id} type="button" onClick={() => setQCategory(c.id)}
                      style={{
                        padding:'4px 10px', borderRadius:'999px', cursor:'pointer', fontSize:'10.5px', fontWeight:700,
                        border: `1px solid ${qCategory === c.id ? c.color : 'var(--border)'}`,
                        background: qCategory === c.id ? `${c.color}26` : 'transparent',
                        color: qCategory === c.id ? c.color : 'var(--text-3)',
                      }}>{c.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Link to a deal (optional)</div>
                <select value={qDealId || ''} onChange={e => setQDealId(e.target.value || null)}
                  style={{...inputStyle, width:'100%'}}>
                  <option value="">— None —</option>
                  {deals.filter(d => !['lost'].includes(d.status)).map(d => (
                    <option key={d.id} value={d.id}>{d.name || d.client_name || '(unnamed)'}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Contact (optional)</div>
                <SingleContactPicker value={qContactId} onChange={setQContactId}
                  contacts={contacts} setContacts={setContacts} userId={userId}
                  placeholder="Search contacts…"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                <div>
                  <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Property</div>
                  <select value={qPropertyId || ''} onChange={e => setQPropertyId(e.target.value || null)}
                    style={{...inputStyle, width:'100%'}}>
                    <option value="">— None —</option>
                    {properties.map(p => (
                      <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Lead-gen attribution</div>
                  <select value={qLeadGenId || ''} onChange={e => setQLeadGenId(e.target.value || null)}
                    style={{...inputStyle, width:'100%'}}>
                    <option value="">— None —</option>
                    {leadGenSystems.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <input type="text" value={qNotes} onChange={e => setQNotes(e.target.value)}
                placeholder="Notes (optional)" style={inputStyle}/>
            </div>
          )}

          {/* Save button + preview */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',fontVariantNumeric:'tabular-nums'}}>
              {qMiles && Number(qMiles) > 0 && currentRate ? (
                <>
                  <strong style={{color:'var(--text-2)'}}>{qRoundTrip ? Number(qMiles) * 2 : Number(qMiles)} mi</strong>
                  {' '}× ${Number(currentRate.business_rate).toFixed(3)}
                  {' = '}
                  <strong style={{color:'var(--accent)'}}>
                    ${((qRoundTrip ? Number(qMiles) * 2 : Number(qMiles)) * Number(currentRate.business_rate)).toFixed(2)}
                  </strong>
                  {' deduction'}
                </>
              ) : (
                'Enter miles to see deduction estimate'
              )}
            </div>
            <button type="button" onClick={quickSave}
              disabled={!qMiles || !qPurpose.trim() || saving}
              className="btn btn-primary"
              style={{padding:'7px 16px',fontSize:'12.5px',fontWeight:700}}>
              {saving ? 'Saving…' : '✓ Log trip'}
            </button>
          </div>
        </div>
      </div>

      {/* Recent entries grouped by month */}
      {grouped.length === 0 ? (
        <div className="panel" style={{padding:'18px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>
          No trips logged yet. Use the form above to log your first one.
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {grouped.map(g => (
            <div key={g.key} style={{background:'var(--bg-card)',borderRadius:'10px',border:'1px solid var(--border)'}}>
              <div style={{
                padding:'10px 14px',borderBottom:'1px solid var(--border)',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',
              }}>
                <span style={{fontWeight:700,fontSize:'12.5px',color:'var(--text-1)'}}>{formatMonth(g.key)}</span>
                <span style={{fontSize:'11px',color:'var(--text-2)',fontVariantNumeric:'tabular-nums'}}>
                  {Math.round(g.miles).toLocaleString()} mi · <strong style={{color:'var(--accent)'}}>${Math.round(g.deduction).toLocaleString()}</strong>
                </span>
              </div>
              <div style={{padding:'4px 8px 8px',display:'flex',flexDirection:'column',gap:'2px'}}>
                {g.entries.map(e => (
                  <MileageRow key={e.id} entry={e}
                    deals={deals} contacts={contacts} properties={properties}
                    onClick={() => setEditingEntry(e)}
                    onDelete={() => deleteEntry(e)}/>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingEntry && (
        <MileageDetailModal
          entry={editingEntry}
          deals={deals}
          contacts={contacts} setContacts={setContacts}
          properties={properties}
          leadGenSystems={leadGenSystems}
          rates={rates}
          userId={userId}
          onClose={() => setEditingEntry(null)}
          onSave={(patch) => updateEntry(editingEntry, patch)}
          onDelete={() => deleteEntry(editingEntry)}/>
      )}
    </div>
  );
}

// Compact row in the entries list. Tap to edit; × to delete.

function MileageRow({ entry, deals, contacts, properties, onClick, onDelete }) {
  const deal = entry.deal_id ? deals.find(d => d.id === entry.deal_id) : null;
  const contact = entry.contact_id ? contacts.find(c => c.id === entry.contact_id) : null;
  const property = entry.property_id ? properties.find(p => p.id === entry.property_id) : null;
  const effectiveMiles = (Number(entry.miles) || 0) * (entry.is_round_trip ? 2 : 1);
  const day = (entry.date || '').slice(8, 10);
  const linkLabel = deal?.name || deal?.client_name
    || contact?.name
    || property?.nickname || property?.address
    || null;
  return (
    <div style={{
      padding:'8px 10px', background:'var(--bg-base)',
      border:'1px solid var(--border)', borderRadius:'6px',
      display:'flex', alignItems:'center', gap:'10px',
    }}>
      <button type="button" onClick={onClick}
        style={{flex:1,minWidth:0,textAlign:'left',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',padding:0,display:'flex',alignItems:'center',gap:'10px'}}>
        <span style={{
          width:'32px',height:'32px',borderRadius:'8px',
          background:'var(--bg-hover)',display:'flex',
          alignItems:'center',justifyContent:'center',
          fontSize:'13px',fontWeight:700,color:'var(--text-2)',flexShrink:0,
          fontVariantNumeric:'tabular-nums',
        }}>{day}</span>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:'12.5px',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {entry.purpose || '(no purpose)'}
          </div>
          <div style={{fontSize:'10.5px',color:'var(--text-3)',display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'1px'}}>
            <span style={{color:'var(--text-2)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>
              {effectiveMiles} mi
              {entry.is_round_trip && <span style={{color:'var(--text-3)',fontWeight:400}}> ⤴︎</span>}
            </span>
            <span style={{color:'var(--accent)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>
              ${Number(entry.computed_deduction || 0).toFixed(2)}
            </span>
            {linkLabel && <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'180px'}}>· {linkLabel}</span>}
            {entry.category !== 'business' && (
              <span style={{padding:'1px 6px',borderRadius:'3px',background:'var(--bg-hover)',fontWeight:600,textTransform:'uppercase',fontSize:'9px'}}>{entry.category}</span>
            )}
          </div>
        </div>
      </button>
      <button type="button" onClick={onDelete}
        title="Delete" aria-label="Delete"
        style={{padding:'4px 8px',background:'transparent',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'14px',lineHeight:1,flexShrink:0}}>
        ×
      </button>
    </div>
  );
}

// Detail modal — all fields editable for an existing entry.

function MileageDetailModal({ entry, deals, contacts, setContacts, properties, leadGenSystems, rates, userId, onClose, onSave, onDelete }) {
  const [date, setDate]                 = useState(entry.date || '');
  const [miles, setMiles]               = useState(entry.miles ?? '');
  const [isRoundTrip, setIsRoundTrip]   = useState(!!entry.is_round_trip);
  const [purpose, setPurpose]           = useState(entry.purpose || '');
  const [category, setCategory]         = useState(entry.category || 'business');
  const [fromAddress, setFromAddress]   = useState(entry.from_address || '');
  const [toAddress, setToAddress]       = useState(entry.to_address || '');
  const [vehicle, setVehicle]           = useState(entry.vehicle || '');
  const [startingOdo, setStartingOdo]   = useState(entry.starting_odometer ?? '');
  const [endingOdo, setEndingOdo]       = useState(entry.ending_odometer ?? '');
  const [dealId, setDealId]             = useState(entry.deal_id || null);
  const [contactId, setContactId]       = useState(entry.contact_id || null);
  const [propertyId, setPropertyId]     = useState(entry.property_id || null);
  const [leadGenId, setLeadGenId]       = useState(entry.lead_gen_system_id || null);
  const [notes, setNotes]               = useState(entry.notes || '');

  function commit(field, value) {
    const patch = {};
    patch[field] = (value === '' || value === null) ? null : value;
    onSave(patch);
  }

  const effectiveMiles = (Number(miles) || 0) * (isRoundTrip ? 2 : 1);
  const yr = (date || '').slice(0, 4);
  const yearRate = rates.find(r => r.year === Number(yr));
  const rateForCategory = yearRate ? (
    category === 'business' ? yearRate.business_rate :
    category === 'medical'  ? yearRate.medical_rate :
    category === 'charity'  ? yearRate.charity_rate : 0
  ) : 0;
  const livePreview = effectiveMiles * (Number(rateForCategory) || 0);

  const inputStyle = {
    width:'100%', padding:'7px 9px',
    background:'var(--bg-base)', color:'var(--text-1)',
    border:'1px solid var(--border)', borderRadius:'6px',
    fontSize:'12.5px', outline:'none',
  };

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'480px',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
          <h3 style={{margin:0,fontSize:'15px'}}>Edit mileage entry</h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Date</label>
            <input type="date" value={date}
              onChange={e => { setDate(e.target.value); commit('date', e.target.value); }}
              style={inputStyle}/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Miles</label>
            <input type="number" step="0.1" value={miles}
              onChange={e => setMiles(e.target.value)}
              onBlur={() => commit('miles', miles === '' ? null : Number(miles))}
              style={inputStyle}/>
          </div>
        </div>

        <div className="form-group">
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11.5px',color:'var(--text-2)',cursor:'pointer'}}>
            <input type="checkbox" checked={isRoundTrip}
              onChange={e => { setIsRoundTrip(e.target.checked); commit('is_round_trip', e.target.checked); }}/>
            Round trip <span style={{fontSize:'10px',color:'var(--text-3)'}}>(doubles miles)</span>
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Purpose</label>
          <input type="text" value={purpose}
            onChange={e => setPurpose(e.target.value)}
            onBlur={() => commit('purpose', purpose.trim())}
            placeholder="What this trip was for"
            style={inputStyle}/>
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
            {MILEAGE_CATEGORIES.map(c => (
              <button key={c.id} type="button"
                onClick={() => { setCategory(c.id); commit('category', c.id); }}
                style={{
                  padding:'5px 11px', borderRadius:'999px', cursor:'pointer', fontSize:'11px', fontWeight:700,
                  border: `1px solid ${category === c.id ? c.color : 'var(--border)'}`,
                  background: category === c.id ? `${c.color}26` : 'transparent',
                  color: category === c.id ? c.color : 'var(--text-3)',
                }}>{c.label}</button>
            ))}
          </div>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Addresses</div>
        <div className="form-group">
          <label className="form-label">From</label>
          <input type="text" value={fromAddress}
            onChange={e => setFromAddress(e.target.value)}
            onBlur={() => commit('from_address', fromAddress.trim() || null)}
            placeholder="Starting address" style={inputStyle}/>
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input type="text" value={toAddress}
            onChange={e => setToAddress(e.target.value)}
            onBlur={() => commit('to_address', toAddress.trim() || null)}
            placeholder="Destination" style={inputStyle}/>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Vehicle & odometer</div>
        <div className="form-group">
          <label className="form-label">Vehicle</label>
          <input type="text" value={vehicle}
            onChange={e => setVehicle(e.target.value)}
            onBlur={() => commit('vehicle', vehicle.trim() || null)}
            placeholder="e.g. 2024 Tesla Model Y" style={inputStyle}/>
        </div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Starting odometer</label>
            <input type="number" value={startingOdo}
              onChange={e => setStartingOdo(e.target.value)}
              onBlur={() => commit('starting_odometer', startingOdo === '' ? null : Number(startingOdo))}
              style={inputStyle}/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Ending odometer</label>
            <input type="number" value={endingOdo}
              onChange={e => setEndingOdo(e.target.value)}
              onBlur={() => commit('ending_odometer', endingOdo === '' ? null : Number(endingOdo))}
              style={inputStyle}/>
          </div>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Attribution (optional)</div>
        <div className="form-group">
          <label className="form-label">Deal</label>
          <select value={dealId || ''}
            onChange={e => { setDealId(e.target.value || null); commit('deal_id', e.target.value || null); }}
            style={inputStyle}>
            <option value="">— None —</option>
            {deals.map(d => (
              <option key={d.id} value={d.id}>{d.name || d.client_name || '(unnamed)'}{d.status === 'closed' ? ' (closed)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Contact</label>
          <SingleContactPicker value={contactId}
            onChange={(id) => { setContactId(id); commit('contact_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            placeholder="Who you were meeting / showing for…"/>
        </div>
        <div className="form-group">
          <label className="form-label">Property</label>
          <select value={propertyId || ''}
            onChange={e => { setPropertyId(e.target.value || null); commit('property_id', e.target.value || null); }}
            style={inputStyle}>
            <option value="">— None —</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Lead-gen system</label>
          <select value={leadGenId || ''}
            onChange={e => { setLeadGenId(e.target.value || null); commit('lead_gen_system_id', e.target.value || null); }}
            style={inputStyle}>
            <option value="">— None —</option>
            {leadGenSystems.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.is_overhead ? ' (overhead)' : ''}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => commit('notes', notes.trim() || null)}
            rows={2}
            style={{...inputStyle, fontFamily:'inherit', resize:'vertical'}}/>
        </div>

        {/* Live deduction preview */}
        <div style={{
          padding:'12px', background:'var(--bg-base)',
          border:'1px solid var(--border)', borderRadius:'6px',
          display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'4px',
        }}>
          <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
            Deduction
          </span>
          <span style={{fontSize:'17px',fontWeight:800,color:'var(--accent)',fontVariantNumeric:'tabular-nums'}}>
            ${livePreview.toFixed(2)}
          </span>
        </div>
        <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px'}}>
          {effectiveMiles} mi × ${Number(rateForCategory || 0).toFixed(3)}/mi ({yr || 'current'} {category} rate).
          {' '}Saved value: <strong>${Number(entry.computed_deduction || 0).toFixed(2)}</strong>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginTop:'16px',paddingTop:'12px',borderTop:'1px solid var(--border)'}}>
          <button type="button" onClick={onDelete}
            style={{padding:'7px 12px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--red)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="trash" size={14} /> Delete</span>
          </button>
          <button type="button" onClick={onClose}
            className="btn btn-primary"
            style={{padding:'7px 14px',fontSize:'12px',fontWeight:700}}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}


export default MileageView;
