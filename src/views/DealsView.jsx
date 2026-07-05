import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import { useBackClose, ActivityTimeline, Icon, MileageView, RecruitingKpiTile, SingleContactPicker, confirmDialog, lbl, modal, money, stageMeta } from '../App';

function ListingPresentationButton({ dealId }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function run() {
    setBusy(true);
    try { await supabase.functions.invoke('orchestrate-listing-presentation', { body: { deal_id: dealId } }); setDone(true); if (window.__notify) window.__notify('Listing presentation prepared \u2014 see "Prepared by AI"', 'success'); }
    catch (_) { if (window.__notify) window.__notify('Could not prepare a plan right now', 'error'); }
    setBusy(false);
  }
  return <button className="btn btn-ghost btn-sm" disabled={busy || done} onClick={run} style={{ marginBottom: '12px' }}>{busy ? 'Preparing plan\u2026' : done ? '\u2713 Presentation prepared' : '\uD83D\uDCCA Prep listing presentation'}</button>;
}

function NewListingButton({ dealId }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function run() {
    setBusy(true);
    try { await supabase.functions.invoke('orchestrate-new-listing', { body: { deal_id: dealId } }); setDone(true); if (window.__notify) window.__notify('Listing launch plan prepared \u2014 see "Prepared by AI"', 'success'); }
    catch (_) { if (window.__notify) window.__notify('Could not prepare a plan right now', 'error'); }
    setBusy(false);
  }
  return <button className="btn btn-ghost btn-sm" disabled={busy || done} onClick={run} style={{ marginBottom: '12px' }}>{busy ? 'Preparing plan\u2026' : done ? '\u2713 Plan prepared' : '\uD83C\uDFE0 Prep new-listing plan'}</button>;
}

function PostCloseButton({ dealId }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function run() {
    setBusy(true);
    try { await supabase.functions.invoke('orchestrate-post-close', { body: { deal_id: dealId } }); setDone(true); if (window.__notify) window.__notify('Post-close plan prepared \u2014 see "Prepared by AI"', 'success'); }
    catch (_) { if (window.__notify) window.__notify('Could not prepare a plan right now', 'error'); }
    setBusy(false);
  }
  return <button className="btn btn-ghost btn-sm" disabled={busy || done} onClick={run} style={{ marginBottom: '12px' }}>{busy ? 'Preparing plan\u2026' : done ? '\u2713 Plan prepared' : '\uD83E\uDD1D Prep post-close plan'}</button>;
}

function cleanDateInput(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const y = parseInt(s.slice(0, 4), 10);
  if (!y || y < 2015 || y > 2100) return '';
  return s;
}


const DEAL_STAGES = [
  { id: 'lead',           label: 'Lead',           color: '#9499b0', help: 'Interested — not actively searching yet' },
  { id: 'active',         label: 'Active',         color: '#3b82f6', help: 'Working with them — showing properties / listing prep' },
  { id: 'under_contract', label: 'Under Contract', color: '#7c5cff', help: 'PSA signed, in inspection / financing period' },
  { id: 'closing',        label: 'Closing',        color: '#f59e0b', help: 'Contingencies cleared, scheduled to close' },
  { id: 'closed',         label: 'Closed',         color: '#22c55e', help: 'Done — commission paid' },
  { id: 'lost',           label: 'Lost',           color: '#ef4444', help: 'File fell through or client went elsewhere' },
];

const DEAL_ACTIVE_STAGE_IDS = ['lead','active','under_contract','closing'];


const DEAL_SIDE_LABELS = {
  buyer:    'Buyer side',
  listing:  'Listing side',
  both:     'Both sides (dual)',
  referral: 'Referral only',
};

// Computes net commission = gross − Σ splits − Σ fees − Σ referral_fees.
// All inputs may be null / undefined / non-numeric; coerce safely.

function computeNetCommission(deal) {
  const gross = Number(deal?.gross_commission) || 0;
  const sumLines = (arr) => (Array.isArray(arr) ? arr : [])
    .reduce((s, x) => s + (Number(x?.amount) || 0), 0);
  return gross - sumLines(deal?.splits_paid) - sumLines(deal?.fees_paid) - sumLines(deal?.referral_fees_paid);
}


function DealsView({ deals, setDeals, contacts, setContacts, properties, userId }) {
  const [leadGenSystems, setLeadGenSystems] = useState([]);
  const [commissionTaxCategoryId, setCommissionTaxCategoryId] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [collapsedStages, setCollapsedStages] = useState({ closed: true, lost: true });
  const [dragDealId, setDragDealId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  function handleStageDrop(stage) {
    const deal = deals.find(d => d.id === dragDealId);
    setDragDealId(null); setDragOverStage(null);
    if (!deal || deal.status === stage.id) return;
    updateDeal(deal, { status: stage.id, status_changed_at: new Date().toISOString() });
  }
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDealName, setNewDealName] = useState('');
  const [newDealSide, setNewDealSide] = useState('buyer');
  const [newDealClientId, setNewDealClientId] = useState(null);
  const [adding, setAdding] = useState(false);

  // Load lead-gen systems (for the attribution dropdown) + look up the
  // Commission Income tax category once so the close-file flow has the
  // FK handy without hitting the DB again.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: sys }, { data: cats }] = await Promise.all([
        supabase.from('lead_gen_systems').select('id,name,color,is_overhead')
          .eq('user_id', userId).eq('is_active', true).order('name'),
        supabase.from('tax_categories').select('id,name')
          .eq('user_id', userId).eq('is_archived', false).eq('name', 'Commission Income').limit(1),
      ]);
      if (cancelled) return;
      setLeadGenSystems(sys || []);
      setCommissionTaxCategoryId(cats?.[0]?.id || null);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Group files by status
  const byStage = useMemo(() => {
    const g = {};
    DEAL_STAGES.forEach(s => { g[s.id] = []; });
    deals.forEach(d => {
      const s = d.status || 'lead';
      if (g[s]) g[s].push(d);
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => {
      const aT = a.status_changed_at || a.updated_at || a.created_at || '';
      const bT = b.status_changed_at || b.updated_at || b.created_at || '';
      return bT.localeCompare(aT);
    }));
    return g;
  }, [deals]);

  // KPIs
  const kpis = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeCount = deals.filter(d => DEAL_ACTIVE_STAGE_IDS.includes(d.status)).length;
    const closedThisYear = deals.filter(d => d.status === 'closed' && d.close_date && new Date(d.close_date) >= yearStart);
    const closedThisMonth = closedThisYear.filter(d => new Date(d.close_date) >= monthStart);
    const grossYTD = closedThisYear.reduce((s, d) => s + (Number(d.gross_commission) || 0), 0);
    const netYTD = closedThisYear.reduce((s, d) => s + (Number(d.net_commission) || 0), 0);
    const avgNet = closedThisYear.length > 0 ? netYTD / closedThisYear.length : null;
    // Pipeline value: estimated gross commission across active files
    const pipelineGross = deals
      .filter(d => DEAL_ACTIVE_STAGE_IDS.includes(d.status))
      .reduce((s, d) => s + (Number(d.gross_commission) || 0), 0);
    return {
      activeCount,
      closedYTD: closedThisYear.length,
      closedMTD: closedThisMonth.length,
      grossYTD, netYTD, avgNet, pipelineGross,
    };
  }, [deals]);

  function toggleStage(stage) {
    setCollapsedStages(prev => ({ ...prev, [stage]: !prev[stage] }));
  }

  async function addDeal() {
    if (!newDealName.trim()) return;
    setAdding(true);
    const { data, error } = await supabase
      .from('deals')
      .insert({
        user_id: userId,
        name: newDealName.trim(),
        side: newDealSide,
        primary_client_id: newDealClientId || null,
        status: 'lead',
        opened_date: new Date().toISOString().slice(0, 10),
      })
      .select().single();
    setAdding(false);
    if (error) {
      if (window.__notify) window.__notify('Could not add file: ' + error.message, 'error');
      return;
    }
    setDeals(prev => [data, ...prev]);
    setNewDealName(''); setNewDealSide('buyer'); setNewDealClientId(null);
    setShowAddForm(false);
    setSelectedDeal(data);
  }

  async function updateDeal(deal, patch) {
    // Recompute net_commission whenever any money input changes
    const moneyFields = ['gross_commission', 'splits_paid', 'fees_paid', 'referral_fees_paid'];
    const touchedMoney = Object.keys(patch).some(k => moneyFields.includes(k));
    let finalPatch = { ...patch };
    if (touchedMoney) {
      const projected = { ...deal, ...patch };
      finalPatch.net_commission = computeNetCommission(projected);
    }
    const { data, error } = await supabase
      .from('deals').update(finalPatch).eq('id', deal.id).select().single();
    if (error) {
      if (window.__notify) window.__notify('Save failed: ' + error.message, 'error');
      return null;
    }
    setDeals(prev => prev.map(d => d.id === deal.id ? data : d));
    if (selectedDeal?.id === deal.id) setSelectedDeal(data);
    return data;
  }

  async function deleteDeal(deal) {
    if (!await confirmDialog(`Delete deal "${deal.name || deal.client_name || '(unnamed)'}"? This cannot be undone.`)) return;
    await supabase.from('deals').delete().eq('id', deal.id);
    setDeals(prev => prev.filter(d => d.id !== deal.id));
    if (selectedDeal?.id === deal.id) setSelectedDeal(null);
  }

  // Close-file flow: marks status='closed', stamps close_date, and
  // creates a positive-amount income transaction tied to the file's
  // lead-gen system. This is what unlocks the ROI loop.
  async function closeDeal(deal, finalValues) {
    if (!commissionTaxCategoryId) {
      if (window.__notify) window.__notify('Set up the Commission Income tax category first.', 'error');
      return;
    }
    const closeDate = finalValues.close_date || new Date().toISOString().slice(0, 10);
    const merged = { ...deal, ...finalValues };
    const net = computeNetCommission(merged);
    // 1. Create the income transaction
    const txDescription = `Commission · ${deal.name || deal.client_name || 'deal'}`;
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        user_id: userId, date: closeDate, amount: net, scope: 'business',
        tax_category_id: commissionTaxCategoryId,
        lead_gen_system_id: deal.lead_gen_system_id || null,
        deal_id: deal.id,
        payee: deal.client_name || (contacts.find(c => c.id === deal.primary_client_id)?.name) || null,
        description: txDescription, account: 'Commission income', entered_via: 'deal_close',
      }).select().single();
    if (txErr) {
      if (window.__notify) window.__notify('Could not log commission income: ' + txErr.message, 'error');
      return;
    }
    // 2. Update the file
    await updateDeal(deal, {
      ...finalValues,
      status: 'closed',
      close_date: closeDate,
      net_commission: net,
      income_transaction_id: tx.id,
    });
    if (window.__notify) window.__notify(`File closed — $${Math.round(net).toLocaleString()} logged as commission income.`, 'success');
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="deals" size={26} style={{color:'var(--accent)',flexShrink:0}} />Files</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)}>+ File</button>
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'8px',marginBottom:'14px'}}>
        <RecruitingKpiTile label="Active pipeline" value={kpis.activeCount} sub={`${deals.length} total files`}/>
        <RecruitingKpiTile label="Closed YTD" value={kpis.closedYTD} sub={kpis.closedMTD > 0 ? `${kpis.closedMTD} this month` : null} color="var(--green)"/>
        <RecruitingKpiTile label="GCI YTD" value={`$${Math.round(kpis.grossYTD).toLocaleString()}`} sub="gross commission"/>
        <RecruitingKpiTile label="Net YTD" value={`$${Math.round(kpis.netYTD).toLocaleString()}`} sub="after splits/fees" color="var(--accent)"/>
        <RecruitingKpiTile label="Avg net / file" value={kpis.avgNet !== null ? `$${Math.round(kpis.avgNet).toLocaleString()}` : '—'} sub={kpis.closedYTD === 0 ? 'no closes YTD' : null}/>
        <RecruitingKpiTile label="Pipeline GCI" value={kpis.pipelineGross > 0 ? `$${Math.round(kpis.pipelineGross).toLocaleString()}` : '—'} sub="if all close"/>
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <div className="panel" style={{padding:'12px',marginBottom:'12px',background:'var(--bg-card)',border:'1px solid var(--accent)'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'10px',fontWeight:600}}>Add a file</div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            <input className="form-input" placeholder='Deal name (e.g. "Jala — 1234 Main St")'
              value={newDealName} onChange={e=>setNewDealName(e.target.value)} autoFocus/>
            <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
              {Object.entries(DEAL_SIDE_LABELS).map(([id, lbl]) => (
                <button key={id} type="button" onClick={() => setNewDealSide(id)}
                  style={{
                    padding:'5px 12px', borderRadius:'999px', cursor:'pointer', fontSize:'11px', fontWeight:700,
                    border: `1px solid ${newDealSide === id ? 'var(--accent)' : 'var(--border)'}`,
                    background: newDealSide === id ? 'var(--accent)' : 'transparent',
                    color: newDealSide === id ? 'var(--bg-base)' : 'var(--text-3)',
                  }}>{lbl}</button>
              ))}
            </div>
            <div>
              <label className="form-label" style={{fontSize:'10px'}}>Primary client (optional)</label>
              <SingleContactPicker value={newDealClientId} onChange={setNewDealClientId}
                contacts={contacts} setContacts={setContacts} userId={userId}
                placeholder="Search contacts or type to create…"/>
            </div>
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setShowAddForm(false); setNewDealName(''); setNewDealClientId(null); }}>Cancel</button>
              <button className="btn btn-primary btn-sm"
                onClick={addDeal} disabled={!newDealName.trim() || adding}>
                {adding ? 'Adding…' : '+ Add to Lead stage'}
              </button>
            </div>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',fontStyle:'italic'}}>
            Lands in the Lead stage. Tap the card to set sale price, commission, partners, source attribution, and dates.
          </div>
        </div>
      )}

      {/* Stage sections */}
      <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
        {DEAL_STAGES.map(stage => {
          const items = byStage[stage.id] || [];
          const isCollapsed = !!collapsedStages[stage.id];
          return (
            <div key={stage.id}
              onDragOver={(e) => { if (dragDealId) { e.preventDefault(); setDragOverStage(stage.id); } }}
              onDragLeave={() => setDragOverStage(s => s === stage.id ? null : s)}
              onDrop={() => handleStageDrop(stage)}
              style={{background:'var(--bg-card)',borderRadius:'10px',border:`1px solid ${dragOverStage===stage.id ? stage.color : 'var(--border)'}`,borderLeft:`4px solid ${stage.color}`,boxShadow: dragOverStage===stage.id ? `0 0 0 2px ${stage.color}55` : 'none',transition:'box-shadow 0.12s'}}>
              <button type="button" onClick={() => toggleStage(stage.id)}
                style={{width:'100%',padding:'10px 14px',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:stage.color}}/>
                  <span style={{fontWeight:700,fontSize:'13px'}}>{stage.label}</span>
                  <span style={{padding:'1px 7px',background:'var(--bg-hover)',color:'var(--text-2)',borderRadius:'10px',fontSize:'10px',fontVariantNumeric:'tabular-nums',fontWeight:700}}>{items.length}</span>
                </span>
                <span style={{color:'var(--text-3)',fontSize:'11px'}}>{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {dragDealId && dragOverStage === stage.id && isCollapsed && (
                <div style={{padding:'6px 14px 10px',fontSize:'11px',color:stage.color}}>Drop to move here</div>
              )}
              {!isCollapsed && (
                items.length === 0 ? (
                  <div style={{padding:'10px 14px 14px',fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>{dragDealId ? 'Drop here to move to ' + stage.label : stage.help + '.'}</div>
                ) : (
                  <div style={{padding:'2px 8px 8px',display:'flex',flexDirection:'column',gap:'4px'}}>
                    {items.map(d => (
                      <DealCard key={d.id} deal={d} stage={stage} contacts={contacts}
                        properties={properties}
                        onDragStart={() => setDragDealId(d.id)}
                        onDragEnd={() => { setDragDealId(null); setDragOverStage(null); }}
                        dragging={dragDealId === d.id}
                        onClick={() => setSelectedDeal(d)}/>
                    ))}
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {selectedDeal && (
        <DealDetailModal
          deal={selectedDeal}
          contacts={contacts} setContacts={setContacts}
          properties={properties}
          leadGenSystems={leadGenSystems}
          userId={userId}
          onClose={() => setSelectedDeal(null)}
          onSave={(patch) => updateDeal(selectedDeal, patch)}
          onDelete={() => deleteDeal(selectedDeal)}
          onCloseDeal={(finalValues) => closeDeal(selectedDeal, finalValues)}
        />
      )}
    </div>
  );
}

// Pipeline card — name + side + price hint + days-in-stage

function DealCard({ deal, stage, contacts, properties, onClick, onDragStart, onDragEnd, dragging }) {
  const client = deal.primary_client_id ? contacts.find(c => c.id === deal.primary_client_id) : null;
  const property = deal.property_id ? properties.find(p => p.id === deal.property_id) : null;
  const displayName = deal.name || client?.name || deal.client_name || '(unnamed file)';
  const sub = property?.address || deal.address || (client && deal.name ? null : (client?.name || deal.client_name));
  const moneyHint = deal.status === 'closed' && deal.net_commission
    ? `Net $${Math.round(deal.net_commission).toLocaleString()}`
    : deal.gross_commission
      ? `GCI $${Math.round(deal.gross_commission).toLocaleString()}`
      : deal.sale_price
        ? `$${Math.round(deal.sale_price).toLocaleString()}`
        : null;
  const sinceChange = deal.status_changed_at
    ? Math.max(0, Math.floor((Date.now() - new Date(deal.status_changed_at).getTime()) / 86400000))
    : null;
  return (
    <button type="button" onClick={onClick}
      draggable={!!onDragStart}
      onDragStart={(e) => { if (onDragStart) { try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', deal.id); } catch (_) {} onDragStart(); } }}
      onDragEnd={() => onDragEnd && onDragEnd()}
      style={{textAlign:'left',padding:'8px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',cursor: onDragStart ? 'grab' : 'pointer',color:'var(--text-1)',display:'flex',alignItems:'center',gap:'10px',opacity: dragging ? 0.4 : 1}}>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:'13px',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayName}</div>
        <div style={{fontSize:'10px',color:'var(--text-3)',display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'2px'}}>
          <span style={{padding:'1px 6px',borderRadius:'3px',background:'var(--bg-hover)',color:'var(--text-2)',fontWeight:600}}>
            {DEAL_SIDE_LABELS[deal.side] || deal.side}
          </span>
          {moneyHint && <span style={{color:'var(--text-2)',fontWeight:600}}>{moneyHint}</span>}
          {sub && <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'160px'}}>· {sub}</span>}
          {sinceChange !== null && <span title="Days in current stage">· {sinceChange}d in {stage.label.toLowerCase()}</span>}
        </div>
      </div>
      <span style={{color:'var(--text-3)',fontSize:'12px',flexShrink:0}}>›</span>
    </button>
  );
}

// File detail modal — the main editor. Inline section editors for
// people / pricing / dates / notes; the close-file flow is a confirm
// modal that pre-fills final numbers from the current file state.

function DealDetailModal({ deal, contacts, setContacts, properties, leadGenSystems, userId, onClose, onSave, onDelete, onCloseDeal }) {

  useBackClose(onClose);
  const [name, setName]                       = useState(deal.name || '');
  const [side, setSide]                       = useState(deal.side || 'buyer');
  const [listPrice, setListPrice]             = useState(deal.list_price ?? '');
  const [targetPrice, setTargetPrice]         = useState(deal.target_price ?? '');
  const [salePrice, setSalePrice]             = useState(deal.sale_price ?? '');
  const [commissionPct, setCommissionPct]     = useState(deal.commission_pct ?? '');
  const [grossCommission, setGrossCommission] = useState(deal.gross_commission ?? '');
  const [splitsPaid, setSplitsPaid]           = useState(Array.isArray(deal.splits_paid) ? deal.splits_paid : []);
  const [feesPaid, setFeesPaid]               = useState(Array.isArray(deal.fees_paid) ? deal.fees_paid : []);
  const [refsPaid, setRefsPaid]               = useState(Array.isArray(deal.referral_fees_paid) ? deal.referral_fees_paid : []);
  const [primaryClientId, setPrimaryClientId] = useState(deal.primary_client_id || null);
  const [coAgentId, setCoAgentId]             = useState(deal.co_agent_id || null);
  const [lenderId, setLenderId]               = useState(deal.lender_id || null);
  const [titleId, setTitleId]                 = useState(deal.title_id || null);
  const [inspectorId, setInspectorId]         = useState(deal.inspector_id || null);
  const [propertyId, setPropertyId]           = useState(deal.property_id || null);
  const [address, setAddress]                 = useState(deal.address || '');
  const [leadGenId, setLeadGenId]             = useState(deal.lead_gen_system_id || null);
  const [openedDate, setOpenedDate]           = useState(deal.opened_date || '');
  const [listDate, setListDate]               = useState(deal.list_date || '');
  const [contractDate, setContractDate]       = useState(deal.contract_date || '');
  const [closeDate, setCloseDate]             = useState(deal.close_date || '');
  const [lostDate, setLostDate]               = useState(deal.lost_date || '');
  const [lostReason, setLostReason]           = useState(deal.lost_reason || '');
  const [notes, setNotes]                     = useState(deal.notes || '');
  const [showCloseModal, setShowCloseModal]   = useState(false);

  const stageMeta = DEAL_STAGES.find(s => s.id === deal.status) || DEAL_STAGES[0];

  // Compute commission and net live from local state for display
  const liveDealForCompute = useMemo(() => ({
    gross_commission: Number(grossCommission) || 0,
    splits_paid: splitsPaid, fees_paid: feesPaid, referral_fees_paid: refsPaid,
  }), [grossCommission, splitsPaid, feesPaid, refsPaid]);
  const liveNet = computeNetCommission(liveDealForCompute);

  // Compute gross from sale_price * commission_pct when both present
  const computedGross = useMemo(() => {
    const sp = Number(salePrice); const pct = Number(commissionPct);
    if (sp > 0 && pct > 0) return Math.round((sp * pct / 100) * 100) / 100;
    return null;
  }, [salePrice, commissionPct]);

  function commit(field, value) {
    const patch = {};
    patch[field] = (value === '' || value === null) ? null : value;
    onSave(patch);
  }
  function commitStage(newStage) {
    if (newStage === 'closed') {
      // Closed stage goes through the close-file modal so we capture
      // final numbers and create the income transaction in one step.
      setShowCloseModal(true);
      return;
    }
    onSave({ status: newStage });
  }

  // Repeating-amount editor for splits / fees / referrals.
  // Each line: { label, amount, paid_to (optional) }
  function LineItemEditor({ value, onChange, addLabel, placeholder }) {
    const arr = Array.isArray(value) ? value : [];
    function update(i, patch) {
      onChange(arr.map((v, idx) => idx === i ? { ...v, ...patch } : v));
    }
    function remove(i) { onChange(arr.filter((_, idx) => idx !== i)); }
    function add() { onChange([...arr, { label: '', amount: 0 }]); }
    const total = arr.reduce((s, x) => s + (Number(x?.amount) || 0), 0);
    return (
      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        {arr.map((v, i) => (
          <div key={i} style={{display:'flex',gap:'4px'}}>
            <input type="text" value={v.label || ''}
              onChange={e => update(i, { label: e.target.value })}
              placeholder={placeholder}
              style={{
                flex:1, minWidth:0,
                background:'var(--bg-base)',color:'var(--text-1)',
                border:'1px solid var(--border)',borderRadius:'6px',
                padding:'6px 9px',fontSize:'12px',
              }}/>
            <div style={{position:'relative', width:'110px', flexShrink:0}}>
              <span style={{position:'absolute',left:'7px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'11px',pointerEvents:'none'}}>$</span>
              <input type="number" step="0.01" value={v.amount ?? ''}
                onChange={e => update(i, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}
                placeholder="0"
                style={{
                  width:'100%',
                  background:'var(--bg-base)',color:'var(--text-1)',
                  border:'1px solid var(--border)',borderRadius:'6px',
                  padding:'6px 9px 6px 18px',fontSize:'12px',
                }}/>
            </div>
            <button type="button" onClick={() => remove(i)} title="Remove"
              style={{padding:'4px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-3)',cursor:'pointer',fontSize:'13px',lineHeight:1}}>×</button>
          </div>
        ))}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginTop:'2px'}}>
          <button type="button" onClick={add}
            style={{padding:'4px 11px',background:'transparent',border:'1px dashed var(--border)',borderRadius:'6px',color:'var(--text-3)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>
            {addLabel}
          </button>
          {arr.length > 0 && (
            <span style={{fontSize:'10px',color:'var(--text-3)',fontVariantNumeric:'tabular-nums'}}>
              Subtotal: <strong style={{color:'var(--text-2)'}}>${Math.round(total).toLocaleString()}</strong>
            </span>
          )}
        </div>
      </div>
    );
  }

  const inputStyle = {
    width:'100%', padding:'7px 9px',
    background:'var(--bg-base)', color:'var(--text-1)',
    border:'1px solid var(--border)', borderRadius:'6px',
    fontSize:'12.5px', outline:'none',
  };
  const dollarWrap = (value, setter, field, placeholder='0') => (
    <div style={{position:'relative'}}>
      <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
      <input type="number" step="0.01" value={value ?? ''}
        onChange={e => setter(e.target.value)}
        onBlur={() => commit(field, value === '' ? null : Number(value))}
        placeholder={placeholder}
        style={{...inputStyle, paddingLeft:'20px'}}/>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'520px',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px',gap:'8px'}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'2px'}}>File</div>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              onBlur={() => commit('name', name.trim() || null)}
              placeholder="File name"
              style={{
                width:'100%', fontSize:'17px', fontWeight:700,
                background:'transparent',color:'var(--text-1)',
                border:'none', outline:'none', padding:'0',
              }}/>
          </div>
          <button onClick={onClose}
            style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        {deal.side === 'listing' && deal.status === 'lead' && <ListingPresentationButton dealId={deal.id} />}
        {deal.side === 'listing' && deal.status !== 'closed' && deal.status !== 'lead' && <NewListingButton dealId={deal.id} />}
        {deal.status === 'closed' && <PostCloseButton dealId={deal.id} />}

        {/* Stage pill row */}
        <div style={{marginBottom:'14px'}}>
          <label className="form-label">Stage</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
            {DEAL_STAGES.map(s => (
              <button key={s.id} type="button" onClick={() => commitStage(s.id)}
                style={{
                  padding:'4px 10px', borderRadius:'999px', cursor:'pointer', fontSize:'11px', fontWeight:700,
                  border: `1px solid ${deal.status === s.id ? s.color : 'var(--border)'}`,
                  background: deal.status === s.id ? `${s.color}26` : 'transparent',
                  color: deal.status === s.id ? s.color : 'var(--text-3)',
                }}>{s.label}</button>
            ))}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px'}}>{stageMeta.help}.</div>
        </div>

        {/* Side */}
        <div className="form-group">
          <label className="form-label">Side</label>
          <select value={side}
            onChange={e => { setSide(e.target.value); commit('side', e.target.value); }}
            style={inputStyle}>
            {Object.entries(DEAL_SIDE_LABELS).map(([id, lbl]) => (
              <option key={id} value={id}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* People */}
        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>People</div>
        <div className="form-group">
          <label className="form-label">Primary client</label>
          <SingleContactPicker value={primaryClientId}
            onChange={(id) => { setPrimaryClientId(id); commit('primary_client_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            placeholder="Search contacts or type to create…"/>
        </div>
        <div className="form-group">
          <label className="form-label">Co-agent (other side)</label>
          <SingleContactPicker value={coAgentId}
            onChange={(id) => { setCoAgentId(id); commit('co_agent_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            defaultNewContactType="other"
            placeholder="Other agent in the transaction…"/>
        </div>
        <div className="form-group">
          <label className="form-label">Lender</label>
          <SingleContactPicker value={lenderId}
            onChange={(id) => { setLenderId(id); commit('lender_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            defaultNewContactType="vendor"
            placeholder="Loan officer / mortgage broker…"/>
        </div>
        <div className="form-group">
          <label className="form-label">Title / escrow</label>
          <SingleContactPicker value={titleId}
            onChange={(id) => { setTitleId(id); commit('title_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            defaultNewContactType="vendor"
            placeholder="Title rep / closing agent…"/>
        </div>
        <div className="form-group">
          <label className="form-label">Inspector</label>
          <SingleContactPicker value={inspectorId}
            onChange={(id) => { setInspectorId(id); commit('inspector_id', id); }}
            contacts={contacts} setContacts={setContacts} userId={userId}
            defaultNewContactType="vendor"
            placeholder="Home inspector…"/>
        </div>

        {/* Property */}
        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Property</div>
        <div className="form-group">
          <label className="form-label">Property in PrismOS (optional)</label>
          <select value={propertyId || ''}
            onChange={e => { setPropertyId(e.target.value || null); commit('property_id', e.target.value || null); }}
            style={inputStyle}>
            <option value="">— Not linked —</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Address (free-form)</label>
          <input type="text" value={address} onChange={e => setAddress(e.target.value)}
            onBlur={() => commit('address', address.trim() || null)}
            placeholder="Street, City, State, ZIP" style={inputStyle}/>
        </div>

        {/* Lead-gen attribution */}
        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Attribution</div>
        <div className="form-group">
          <label className="form-label">Lead-gen system that generated this file</label>
          <select value={leadGenId || ''}
            onChange={e => { setLeadGenId(e.target.value || null); commit('lead_gen_system_id', e.target.value || null); }}
            style={inputStyle}>
            <option value="">— Not attributed —</option>
            {leadGenSystems.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.is_overhead ? ' (overhead)' : ''}</option>
            ))}
          </select>
          <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px'}}>
            Picks who gets ROI credit. Closed deals roll up into the system's income side.
          </div>
        </div>

        {/* Pricing */}
        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Pricing</div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">List price</label>
            {dollarWrap(listPrice, setListPrice, 'list_price')}
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Target</label>
            {dollarWrap(targetPrice, setTargetPrice, 'target_price')}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Sale price</label>
          {dollarWrap(salePrice, setSalePrice, 'sale_price')}
        </div>

        {/* Commission */}
        <div style={{marginTop:'10px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Commission</div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Commission %</label>
            <div style={{position:'relative'}}>
              <input type="number" step="0.01" value={commissionPct ?? ''}
                onChange={e => setCommissionPct(e.target.value)}
                onBlur={() => commit('commission_pct', commissionPct === '' ? null : Number(commissionPct))}
                placeholder="3.0" style={{...inputStyle, paddingRight:'22px'}}/>
              <span style={{position:'absolute',right:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>%</span>
            </div>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Gross commission</label>
            {dollarWrap(grossCommission, setGrossCommission, 'gross_commission')}
            {computedGross !== null && Number(grossCommission) !== computedGross && (
              <button type="button"
                onClick={() => { setGrossCommission(computedGross); commit('gross_commission', computedGross); }}
                style={{
                  marginTop:'4px',padding:'3px 8px',background:'transparent',
                  border:'1px solid var(--accent)',borderRadius:'4px',
                  color:'var(--accent)',cursor:'pointer',fontSize:'10px',fontWeight:600,
                }}>
                Use computed ${computedGross.toLocaleString()}
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Splits paid (brokerage, franchise, etc.)</label>
          <LineItemEditor value={splitsPaid}
            onChange={(next) => { setSplitsPaid(next); commit('splits_paid', next); }}
            addLabel="+ Add split" placeholder="e.g. Realty ONE franchise fee"/>
        </div>
        <div className="form-group">
          <label className="form-label">Other fees paid (E&O, transaction fees, etc.)</label>
          <LineItemEditor value={feesPaid}
            onChange={(next) => { setFeesPaid(next); commit('fees_paid', next); }}
            addLabel="+ Add fee" placeholder="e.g. Transaction coordinator"/>
        </div>
        <div className="form-group">
          <label className="form-label">Referral fees paid out</label>
          <LineItemEditor value={refsPaid}
            onChange={(next) => { setRefsPaid(next); commit('referral_fees_paid', next); }}
            addLabel="+ Add referral fee out" placeholder="e.g. Referred by Agent X"/>
        </div>

        {/* Net rollup */}
        <div style={{
          padding:'12px',marginTop:'4px',background:'var(--bg-base)',
          border:'1px solid var(--border)',borderRadius:'6px',
          display:'flex',justifyContent:'space-between',alignItems:'center',
        }}>
          <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
            Net to agent
          </span>
          <span style={{fontSize:'18px',fontWeight:800,color: liveNet >= 0 ? 'var(--accent)' : 'var(--red)',fontVariantNumeric:'tabular-nums'}}>
            ${Math.round(liveNet).toLocaleString()}
          </span>
        </div>

        {/* Dates */}
        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Timeline</div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Opened</label>
            <input type="date" value={cleanDateInput(openedDate)}
              onChange={e => { setOpenedDate(e.target.value); commit('opened_date', e.target.value); }}
              style={inputStyle}/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">{side === 'listing' || side === 'both' ? 'Listed' : 'List date'}</label>
            <input type="date" value={cleanDateInput(listDate)}
              onChange={e => { setListDate(e.target.value); commit('list_date', e.target.value); }}
              style={inputStyle}/>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Under contract</label>
            <input type="date" value={cleanDateInput(contractDate)}
              onChange={e => { setContractDate(e.target.value); commit('contract_date', e.target.value); }}
              style={inputStyle}/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">{deal.status === 'closed' ? 'Closed' : 'Expected close'}</label>
            <input type="date" value={cleanDateInput(closeDate)}
              onChange={e => { setCloseDate(e.target.value); commit('close_date', e.target.value); }}
              style={inputStyle}/>
          </div>
        </div>

        {/* Lost details */}
        {deal.status === 'lost' && (
          <>
            <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Lost</div>
            <div className="form-row">
              <div className="form-group" style={{flex:1}}>
                <label className="form-label">Lost on</label>
                <input type="date" value={cleanDateInput(lostDate)}
                  onChange={e => { setLostDate(e.target.value); commit('lost_date', e.target.value); }}
                  style={inputStyle}/>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Lost reason</label>
              <input type="text" value={lostReason} onChange={e => setLostReason(e.target.value)}
                onBlur={() => commit('lost_reason', lostReason.trim() || null)}
                placeholder="e.g. Went with another agent, financing fell through, life changed"
                style={inputStyle}/>
            </div>
          </>
        )}

        {/* Closed file — link to income transaction */}
        {deal.status === 'closed' && deal.income_transaction_id && (
          <div style={{
            padding:'10px 12px', marginTop:'4px',
            background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.3)',
            borderRadius:'6px', fontSize:'11.5px', color:'var(--text-2)',
          }}>
            ✓ Income transaction logged. <span style={{color:'var(--text-3)',fontSize:'10px'}}>(View it under Finance → Transactions.)</span>
          </div>
        )}

        {/* Notes */}
        <div className="form-group" style={{marginTop:'14px'}}>
          <label className="form-label">File notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            onBlur={() => commit('notes', notes.trim() || null)}
            rows={3}
            placeholder="Context, key dates, what to follow up on…"
            style={{...inputStyle, fontFamily:'inherit', resize:'vertical'}}/>
        </div>

        {/* Activity timeline */}
        <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'10px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="signal" size={13} /> Activity</div>
          <ActivityTimeline entityType="deal" entityId={deal.id} userId={userId} contacts={contacts} />
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginTop:'16px',paddingTop:'12px',borderTop:'1px solid var(--border)'}}>
          <button type="button" onClick={onDelete}
            style={{padding:'7px 12px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--red)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="trash" size={14} /> Delete file</span>
          </button>
          {deal.status !== 'closed' && deal.status !== 'lost' && (
            <button type="button" onClick={() => setShowCloseModal(true)}
              style={{padding:'8px 14px',background:'var(--green)',border:'none',borderRadius:'6px',color:'#fff',cursor:'pointer',fontSize:'12px',fontWeight:700}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="deals" size={14} /> Close file · log commission</span>
            </button>
          )}
        </div>
      </div>

      {showCloseModal && (
        <CloseDealModal
          deal={{
            ...deal,
            sale_price: salePrice === '' ? null : Number(salePrice),
            commission_pct: commissionPct === '' ? null : Number(commissionPct),
            gross_commission: grossCommission === '' ? null : Number(grossCommission),
            splits_paid: splitsPaid, fees_paid: feesPaid, referral_fees_paid: refsPaid,
          }}
          onClose={() => setShowCloseModal(false)}
          onConfirm={async (finalValues) => {
            await onCloseDeal(finalValues);
            setShowCloseModal(false);
          }}/>
      )}
    </div>
  );
}

// Close-file confirm modal — final pass at numbers + close date.
// Anything the user types here overwrites the file before logging income.

function CloseDealModal({ deal, onClose, onConfirm }) {

  useBackClose(onClose);
  const [salePrice, setSalePrice]             = useState(deal.sale_price ?? '');
  const [commissionPct, setCommissionPct]     = useState(deal.commission_pct ?? '');
  const [grossCommission, setGrossCommission] = useState(deal.gross_commission ?? '');
  const [closeDate, setCloseDate]             = useState(cleanDateInput(deal.close_date) || new Date().toISOString().slice(0,10));
  const [confirming, setConfirming]           = useState(false);

  // Live net based on whatever is in the form right now
  const liveNet = computeNetCommission({
    gross_commission: Number(grossCommission) || 0,
    splits_paid: deal.splits_paid,
    fees_paid: deal.fees_paid,
    referral_fees_paid: deal.referral_fees_paid,
  });

  async function confirm() {
    setConfirming(true);
    await onConfirm({
      sale_price: salePrice === '' ? null : Number(salePrice),
      commission_pct: commissionPct === '' ? null : Number(commissionPct),
      gross_commission: grossCommission === '' ? null : Number(grossCommission),
      close_date: closeDate,
    });
    setConfirming(false);
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{zIndex:1300}}>
      <div className="modal" style={{maxWidth:'420px'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
          <h3 style={{margin:0,fontSize:'14px'}}>Close this file</h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'18px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>
        <p style={{fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,marginBottom:'12px'}}>
          Confirm the final numbers. On save we'll mark the file closed and create an income transaction for the net commission, attributed to the file's lead-gen system.
        </p>

        <div className="form-group">
          <label className="form-label">Final sale price</label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
            <input className="form-input" type="number" step="0.01" value={salePrice ?? ''}
              onChange={e => setSalePrice(e.target.value)} style={{paddingLeft:'20px'}}/>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Commission %</label>
            <input className="form-input" type="number" step="0.01" value={commissionPct ?? ''}
              onChange={e => setCommissionPct(e.target.value)} placeholder="3.0"/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Gross commission</label>
            <div style={{position:'relative'}}>
              <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
              <input className="form-input" type="number" step="0.01" value={grossCommission ?? ''}
                onChange={e => setGrossCommission(e.target.value)} style={{paddingLeft:'20px'}}/>
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Close date</label>
          <input className="form-input" type="date" value={closeDate}
            onChange={e => setCloseDate(e.target.value)}/>
        </div>

        <div style={{
          padding:'12px', background:'rgba(34,197,94,0.08)',
          border:'1px solid rgba(34,197,94,0.3)', borderRadius:'6px',
          display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'8px',
        }}>
          <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Income to log</span>
          <span style={{fontSize:'17px',fontWeight:800,color:'var(--green)',fontVariantNumeric:'tabular-nums'}}>
            ${Math.round(liveNet).toLocaleString()}
          </span>
        </div>
        <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'6px'}}>
          = Gross − splits − fees − referral fees paid out.
        </div>

        <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={confirming}
            style={{background:'var(--green)',color:'#fff'}}>
            {confirming ? 'Closing…' : <><Icon name="deals" size={13} /> Close & log income</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MileageView ─────────────────────────────────────────────────────
// Per-trip business mileage tracker. IRS standard mileage rate × miles
// is the deduction; we capture the rate at entry time (via DB trigger)
// for audit trail. Real-estate agents typically drive 10–15K business
// miles/year; at 2026's $0.70/mi that's $7K–$10K of deductions that
// otherwise quietly evaporate.
//
// V1 scope: quick-log form (date/miles/purpose/round-trip), recent
// entries grouped by month, detailed edit modal with file/contact/
// property/lead-gen attribution. Future: calendar-event suggestions,
// CSV import, address-based auto-distance via Google Maps.


export default DealsView;
