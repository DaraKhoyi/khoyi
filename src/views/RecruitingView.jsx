import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import { DealsView, Icon, RecruitingKpiTile, modal, stageMeta } from '../App';

const RECRUITING_STAGES = [
  { id: 'lead',         label: 'Lead',         color: '#9499b0', help: 'Spotted / cold / not contacted yet' },
  { id: 'qualified',    label: 'Qualified',    color: '#3b82f6', help: 'Met or talked — interested enough to keep working' },
  { id: 'interviewing', label: 'Interviewing', color: '#f59e0b', help: 'In active conversations / sit-downs' },
  { id: 'offer',        label: 'Offer',        color: '#7c5cff', help: 'Offer or contract on the table' },
  { id: 'signed',       label: 'Signed',       color: '#22c55e', help: 'Joined the brokerage' },
  { id: 'lost',         label: 'Lost',         color: '#ef4444', help: 'Did not convert — declined or went elsewhere' },
  { id: 'parked',       label: 'Parked',       color: '#555e7a', help: 'Deferred — revisit later' },
];

const RECRUITING_ACTIVE_STAGES = ['lead','qualified','interviewing','offer'];


function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  return Math.floor((new Date(d2) - new Date(d1)) / 86400000);
}


function RecruitingView({ contacts, setContacts, userId }) {
  const [recruitingSystems, setRecruitingSystems] = useState([]);
  const [recruitingTransactions, setRecruitingTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecruit, setSelectedRecruit] = useState(null);
  const [collapsedStages, setCollapsedStages] = useState({ signed: true, lost: true, parked: true });
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
      const [{ data: sys }, { data: tx }] = await Promise.all([
        supabase.from('recruiting_systems').select('*').eq('user_id', userId).eq('is_active', true).order('is_overhead', { ascending: false }).order('name'),
        supabase.from('transactions').select('*').eq('user_id', userId).not('recruiting_system_id', 'is', null).gte('date', yearStart),
      ]);
      if (cancelled) return;
      setRecruitingSystems(sys || []);
      setRecruitingTransactions(tx || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // All recruits = contacts with type='recruit'. Group by stage.
  const recruits = useMemo(() => contacts.filter(c => c.type === 'recruit'), [contacts]);
  const byStage = useMemo(() => {
    const g = {};
    RECRUITING_STAGES.forEach(s => { g[s.id] = []; });
    recruits.forEach(r => {
      const stage = r.recruiting_stage || 'lead';
      if (g[stage]) g[stage].push(r);
    });
    // Sort newest-stage-change first within each stage
    Object.values(g).forEach(arr => arr.sort((a,b) => {
      const aT = a.recruiting_stage_changed_at || a.created_at || '';
      const bT = b.recruiting_stage_changed_at || b.created_at || '';
      return bT.localeCompare(aT);
    }));
    return g;
  }, [recruits]);

  // KPI calculations
  const kpis = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeCount = recruits.filter(r => RECRUITING_ACTIVE_STAGES.includes(r.recruiting_stage || 'lead')).length;
    const signedYTD = recruits.filter(r => r.recruiting_stage === 'signed' && r.recruiting_signed_at && new Date(r.recruiting_signed_at) >= yearStart).length;
    const signedMTD = recruits.filter(r => r.recruiting_stage === 'signed' && r.recruiting_signed_at && new Date(r.recruiting_signed_at) >= monthStart).length;
    const lostYTD = recruits.filter(r => r.recruiting_stage === 'lost' && r.recruiting_lost_at && new Date(r.recruiting_lost_at) >= yearStart).length;
    const spendYTD = recruitingTransactions.filter(t => Number(t.amount) < 0).reduce((s,t) => s + Math.abs(Number(t.amount)), 0);
    const costPerSigned = signedYTD > 0 ? spendYTD / signedYTD : null;
    const pipelineGCI = recruits
      .filter(r => RECRUITING_ACTIVE_STAGES.includes(r.recruiting_stage || 'lead'))
      .reduce((s,r) => s + Number(r.recruiting_estimated_annual_gci || 0), 0);
    return { activeCount, signedYTD, signedMTD, lostYTD, spendYTD, costPerSigned, pipelineGCI };
  }, [recruits, recruitingTransactions]);

  function toggleStage(stage) {
    setCollapsedStages(prev => ({ ...prev, [stage]: !prev[stage] }));
  }

  async function addRecruit() {
    if (!newName.trim()) return;
    setAdding(true);
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        user_id: userId,
        name: newName.trim(),
        type: 'recruit',
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
        status: 'active',
        recruiting_stage: 'lead',
        recruiting_first_contact_at: new Date().toISOString().slice(0,10),
        recruiting_stage_changed_at: new Date().toISOString(),
      })
      .select().single();
    setAdding(false);
    if (error) {
      if (window.__notify) window.__notify('Could not add recruit: ' + error.message, 'error');
      return;
    }
    setContacts(prev => [...prev, data].sort((a,b) => (a.name||'').localeCompare(b.name||'')));
    setNewName(''); setNewEmail(''); setNewPhone('');
    setShowAddForm(false);
  }

  async function updateRecruit(recruit, patch) {
    // Stamp recruiting_stage_changed_at if the stage actually changed
    const finalPatch = { ...patch };
    if (patch.recruiting_stage && patch.recruiting_stage !== recruit.recruiting_stage) {
      finalPatch.recruiting_stage_changed_at = new Date().toISOString();
      // Auto-stamp terminal dates when entering signed/lost
      if (patch.recruiting_stage === 'signed' && !recruit.recruiting_signed_at) {
        finalPatch.recruiting_signed_at = new Date().toISOString().slice(0,10);
      }
      if (patch.recruiting_stage === 'lost' && !recruit.recruiting_lost_at) {
        finalPatch.recruiting_lost_at = new Date().toISOString().slice(0,10);
      }
    }
    const { data, error } = await supabase.from('contacts').update(finalPatch).eq('id', recruit.id).select().single();
    if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); return; }
    setContacts(prev => prev.map(c => c.id === recruit.id ? data : c));
    if (selectedRecruit?.id === recruit.id) setSelectedRecruit(data);
  }

  if (loading) {
    return <div className="page-shell"><div style={{padding:'20px',color:'var(--text-3)'}}>Loading recruiting…</div></div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="recruiting" size={26} style={{color:'var(--accent)',flexShrink:0}} />Recruiting</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)}>+ Recruit</button>
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'8px',marginBottom:'14px'}}>
        <RecruitingKpiTile label="Active in pipeline" value={kpis.activeCount} sub={`${recruits.length} total`}/>
        <RecruitingKpiTile label="Signed YTD" value={kpis.signedYTD} sub={kpis.signedMTD > 0 ? `${kpis.signedMTD} this month` : null} color="var(--green)"/>
        <RecruitingKpiTile label="Lost YTD" value={kpis.lostYTD} color="var(--red)"/>
        <RecruitingKpiTile label="Spend YTD" value={`$${Math.round(kpis.spendYTD).toLocaleString()}`}/>
        <RecruitingKpiTile label="Cost / signed agent" value={kpis.costPerSigned !== null ? `$${Math.round(kpis.costPerSigned).toLocaleString()}` : '—'} sub={kpis.costPerSigned === null ? 'no signings YTD' : null}/>
        <RecruitingKpiTile label="Pipeline GCI est." value={kpis.pipelineGCI > 0 ? `$${Math.round(kpis.pipelineGCI).toLocaleString()}` : '—'} sub="annual"/>
      </div>

      {/* Add recruit inline form */}
      {showAddForm && (
        <div className="panel" style={{padding:'12px',marginBottom:'12px',background:'var(--bg-card)',border:'1px solid var(--accent)'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'8px',fontWeight:600}}>Add a recruit</div>
          <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
            <input className="form-input" placeholder="Name (required)" value={newName} onChange={e=>setNewName(e.target.value)} autoFocus/>
            <input className="form-input" placeholder="Email" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/>
            <input className="form-input" placeholder="Phone" type="tel" value={newPhone} onChange={e=>setNewPhone(e.target.value)}/>
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',marginTop:'4px'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddForm(false); setNewName(''); setNewEmail(''); setNewPhone(''); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={addRecruit} disabled={!newName.trim() || adding}>
                {adding ? 'Adding…' : '+ Add to Lead stage'}
              </button>
            </div>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px',fontStyle:'italic'}}>
            Lands in "Lead" stage. Tap the card to set source, stage, est. GCI, and notes.
          </div>
        </div>
      )}

      {/* Stage sections */}
      <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
        {RECRUITING_STAGES.map(stage => {
          const items = byStage[stage.id] || [];
          const isCollapsed = !!collapsedStages[stage.id];
          return (
            <div key={stage.id} style={{background:'var(--bg-card)',borderRadius:'10px',border:'1px solid var(--border)',borderLeft:`4px solid ${stage.color}`}}>
              <button type="button" onClick={() => toggleStage(stage.id)}
                style={{width:'100%',padding:'10px 14px',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:stage.color}}/>
                  <span style={{fontWeight:700,fontSize:'13px'}}>{stage.label}</span>
                  <span style={{padding:'1px 7px',background:'var(--bg-hover)',color:'var(--text-2)',borderRadius:'10px',fontSize:'10px',fontVariantNumeric:'tabular-nums',fontWeight:700}}>{items.length}</span>
                </span>
                <span style={{color:'var(--text-3)',fontSize:'11px'}}>{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {!isCollapsed && (
                items.length === 0 ? (
                  <div style={{padding:'10px 14px 14px',fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>{stage.help}.</div>
                ) : (
                  <div style={{padding:'2px 8px 8px',display:'flex',flexDirection:'column',gap:'4px'}}>
                    {items.map(r => (
                      <RecruitCard key={r.id} recruit={r}
                        systems={recruitingSystems}
                        onClick={() => setSelectedRecruit(r)}
                        stage={stage}/>
                    ))}
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {selectedRecruit && (
        <RecruitDetailModal
          recruit={selectedRecruit}
          systems={recruitingSystems}
          onClose={() => setSelectedRecruit(null)}
          onSave={(patch) => updateRecruit(selectedRecruit, patch)}
        />
      )}
    </div>
  );
}


function RecruitCard({ recruit, systems, stage, onClick }) {
  const source = systems.find(s => s.id === recruit.recruiting_source_system_id);
  const sinceChange = recruit.recruiting_stage_changed_at ? daysBetween(recruit.recruiting_stage_changed_at, new Date()) : null;
  const sinceFirst = recruit.recruiting_first_contact_at ? daysBetween(recruit.recruiting_first_contact_at, new Date()) : null;
  return (
    <button type="button" onClick={onClick}
      style={{textAlign:'left',padding:'8px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--text-1)',display:'flex',alignItems:'center',gap:'10px'}}>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:'13px',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{recruit.name || '(unnamed)'}</div>
        <div style={{fontSize:'10px',color:'var(--text-3)',display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'2px'}}>
          {source && (
            <span style={{padding:'1px 6px',borderRadius:'3px',background:`${source.color}26`,color:source.color,fontWeight:600}}>
              {source.name}
            </span>
          )}
          {sinceChange !== null && <span title="Days in current stage">{sinceChange}d in {stage.label.toLowerCase()}</span>}
          {sinceChange === null && sinceFirst !== null && <span title="Days since first contact">{sinceFirst}d total</span>}
          {recruit.recruiting_estimated_annual_gci > 0 && <span>· est. ${Math.round(recruit.recruiting_estimated_annual_gci/1000)}k GCI</span>}
        </div>
      </div>
      <span style={{color:'var(--text-3)',fontSize:'12px',flexShrink:0}}>›</span>
    </button>
  );
}


function RecruitDetailModal({ recruit, systems, onClose, onSave }) {
  const [stage, setStage] = useState(recruit.recruiting_stage || 'lead');
  const [sourceId, setSourceId] = useState(recruit.recruiting_source_system_id || '');
  const [firstContact, setFirstContact] = useState(recruit.recruiting_first_contact_at || '');
  const [sitDown, setSitDown] = useState(recruit.recruiting_sit_down_at || '');
  const [signedDate, setSignedDate] = useState(recruit.recruiting_signed_at || '');
  const [lostDate, setLostDate] = useState(recruit.recruiting_lost_at || '');
  const [lostReason, setLostReason] = useState(recruit.recruiting_lost_reason || '');
  const [estGCI, setEstGCI] = useState(recruit.recruiting_estimated_annual_gci || '');
  const [notes, setNotes] = useState(recruit.recruiting_notes || '');

  const stageMeta = RECRUITING_STAGES.find(s => s.id === stage) || RECRUITING_STAGES[0];

  function commit(field, value) {
    const patch = {};
    patch[field] = (value === '' || value === null) ? null : value;
    onSave(patch);
  }

  function commitStage(newStage) {
    setStage(newStage);
    onSave({ recruiting_stage: newStage });
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'480px',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px',gap:'8px'}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'2px'}}>Recruit</div>
            <h3 style={{margin:0,fontSize:'17px',overflow:'hidden',textOverflow:'ellipsis'}}>{recruit.name}</h3>
            {(recruit.email || recruit.phone) && (
              <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                {recruit.email}{recruit.email && recruit.phone ? ' · ' : ''}{recruit.phone}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        {/* Stage selector — visual stage row, tap to set */}
        <div style={{marginBottom:'14px'}}>
          <label className="form-label">Stage</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
            {RECRUITING_STAGES.map(s => (
              <button key={s.id} type="button" onClick={() => commitStage(s.id)}
                style={{
                  padding:'4px 10px', borderRadius:'999px', cursor:'pointer', fontSize:'11px', fontWeight:700,
                  border: `1px solid ${stage === s.id ? s.color : 'var(--border)'}`,
                  background: stage === s.id ? `${s.color}26` : 'transparent',
                  color: stage === s.id ? s.color : 'var(--text-3)',
                }}>
                {s.label}
              </button>
            ))}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px'}}>{stageMeta.help}.</div>
        </div>

        {/* Source */}
        <div className="form-group">
          <label className="form-label">Source (recruiting system)</label>
          <select className="form-input" value={sourceId}
            onChange={e => { setSourceId(e.target.value); commit('recruiting_source_system_id', e.target.value); }}>
            <option value="">— Not attributed —</option>
            {systems.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.is_overhead ? ' (overhead)' : ''}</option>
            ))}
          </select>
        </div>

        {/* Dates row */}
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">First contact</label>
            <input className="form-input" type="date" value={firstContact || ''}
              onChange={e => { setFirstContact(e.target.value); commit('recruiting_first_contact_at', e.target.value); }}/>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Sit-down date</label>
            <input className="form-input" type="date" value={sitDown || ''}
              onChange={e => { setSitDown(e.target.value); commit('recruiting_sit_down_at', e.target.value); }}/>
          </div>
        </div>

        {stage === 'signed' && (
          <div className="form-group">
            <label className="form-label">Signed date</label>
            <input className="form-input" type="date" value={signedDate || ''}
              onChange={e => { setSignedDate(e.target.value); commit('recruiting_signed_at', e.target.value); }}/>
          </div>
        )}

        {stage === 'lost' && (
          <>
            <div className="form-group">
              <label className="form-label">Lost date</label>
              <input className="form-input" type="date" value={lostDate || ''}
                onChange={e => { setLostDate(e.target.value); commit('recruiting_lost_at', e.target.value); }}/>
            </div>
            <div className="form-group">
              <label className="form-label">Lost reason</label>
              <input className="form-input" type="text" value={lostReason || ''}
                onChange={e => setLostReason(e.target.value)}
                onBlur={() => commit('recruiting_lost_reason', lostReason)}
                placeholder="e.g. Stayed with current brokerage, went to competitor X, retired"/>
            </div>
          </>
        )}

        <div className="form-group">
          <label className="form-label">Estimated annual GCI</label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
            <input className="form-input" type="number" step="any" value={estGCI ?? ''}
              onChange={e => setEstGCI(e.target.value)}
              onBlur={() => commit('recruiting_estimated_annual_gci', estGCI === '' ? null : Number(estGCI))}
              style={{paddingLeft:'20px'}} placeholder="0"/>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'3px'}}>
            Their estimated yearly gross commission income. Used to size the pipeline.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Recruiting notes</label>
          <textarea className="form-input" value={notes || ''} rows={4}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => commit('recruiting_notes', notes)}
            placeholder="What you learned, what they care about, what to follow up on…"
            style={{fontFamily:'inherit',resize:'vertical'}}/>
        </div>

        <div style={{padding:'10px',background:'var(--bg-base)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.5,marginTop:'4px'}}>
          To edit name, email, phone, or other contact fields, open this person under Contacts.
          All recruiting-specific edits autosave here.
        </div>
      </div>
    </div>
  );
}

// ─── DealsView ───────────────────────────────────────────────────────
// Pipeline view for real-estate files. Mirrors RecruitingView shape so
// the two pipeline screens feel like siblings. Each file moves through
// six stages: lead → active → under_contract → closing → closed (or
// → lost from any active stage). Closing a file auto-creates an income
// transaction tied to the lead-gen system that generated it, which is
// what makes lead-gen ROI math actually possible.


export default RecruitingView;
