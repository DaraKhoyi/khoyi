import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { ContactPicker } from '../App';
import ActivityTimeline from './ActivityTimeline';
import { useBackClose } from '../backClose';
import { confirmDialog, notify } from '../notify';
import { modal } from '../helpers';

function InvestmentModal({ onClose, onSave, onDelete, initial, properties, contacts = [], userId }) {

  useBackClose(onClose);
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState(initial?.kind || 'deal');
  const [stage, setStage] = useState(initial?.stage || 'screening');
  const [property_id, setPropertyId] = useState(initial?.property_id || '');
  const [amount, setAmount] = useState(initial?.amount || '');
  const [income_ytd, setIncomeYtd] = useState(initial?.income_ytd || '');
  const [expense_ytd, setExpenseYtd] = useState(initial?.expense_ytd || '');
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [contactIds, setContactIds] = useState([]);

  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('investment_contacts').select('contact_id').eq('investment_id', initial.id);
      if (!cancelled && data) setContactIds(data.map(r => r.contact_id));
    })();
    return () => { cancelled = true; };
  }, [initial?.id]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(), kind, stage, property_id: property_id || null,
      amount: amount ? Number(amount) : null,
      income_ytd: income_ytd ? Number(income_ytd) : null,
      expense_ytd: expense_ytd ? Number(expense_ytd) : null,
      due_date: due_date || null, notes: notes.trim() || null,
      _contact_ids: contactIds,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Investment' : 'New Investment'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)} autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Kind</label>
              <select className="form-select" value={kind} onChange={e=>setKind(e.target.value)}>
                <option value="deal">File</option>
                <option value="pnl">P&L</option>
                <option value="partner_comm">Partner Comm</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Stage</label>
              <select className="form-select" value={stage} onChange={e=>setStage(e.target.value)}>
                <option value="screening">Screening</option>
                <option value="due_diligence">Due Diligence</option>
                <option value="under_contract">Under Contract</option>
                <option value="active">Active</option>
                <option value="exited">Exited</option>
                <option value="dead">Dead</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Linked Property</label>
              <select className="form-select" value={property_id} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Amount ($)</label><input className="form-input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Income YTD</label><input className="form-input" type="number" value={income_ytd} onChange={e=>setIncomeYtd(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Expense YTD</label><input className="form-input" type="number" value={expense_ytd} onChange={e=>setExpenseYtd(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={due_date} onChange={e=>setDueDate(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} /></div>
          <ContactPicker contacts={contacts} selectedIds={contactIds} onChange={setContactIds} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Investment</button>
          </div>
        </form>
        {initial?.id && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)',background:'var(--bg-base)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'10px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="signal" size={13} /> Activity</div>
            <ActivityTimeline entityType="investment" entityId={initial.id} userId={userId} contacts={contacts} />
          </div>
        )}
      </div>
    </div>
  );
}


function InvestmentsView({ investments, setInvestments, properties, userId, contacts = [] }) {
  const [showModal, setShowModal] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [stageFilter, setStageFilter] = useState('all');

  const STAGES = [
    { id: 'all', label: 'All' },
    { id: 'screening', label: 'Screening' },
    { id: 'due_diligence', label: 'Due Dil' },
    { id: 'under_contract', label: 'Under Contract' },
    { id: 'active', label: 'Active' },
    { id: 'exited', label: 'Exited' },
    { id: 'dead', label: 'Dead' },
  ];

  const filtered = stageFilter === 'all' ? investments : investments.filter(i => i.stage === stageFilter);

  // Roll-ups (active only)
  const active = investments.filter(i => i.stage === 'active');
  const totalAmount = active.reduce((s,i) => s + Number(i.amount||0), 0);
  const totalIncome = active.reduce((s,i) => s + Number(i.income_ytd||0), 0);
  const totalExpense = active.reduce((s,i) => s + Number(i.expense_ytd||0), 0);
  const netYtd = totalIncome - totalExpense;

  async function handleSave(data) {
    const { _contact_ids, ...invData } = data;
    let savedId = null;
    if (editInv) {
      const { data: u } = await supabase.from('investments').update(invData).eq('id', editInv.id).select().single();
      if (u) { setInvestments(prev => prev.map(i => i.id === u.id ? u : i)); savedId = u.id; }
    } else {
      const { data: c } = await supabase.from('investments').insert({ ...invData, user_id: userId }).select().single();
      if (c) { setInvestments(prev => [c, ...prev]); savedId = c.id; }
    }
    if (savedId && Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_investment_contacts', {
        p_investment_id: savedId,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) notify("Saved investment, but contact links failed.", 'error');
    }
    setShowModal(false); setEditInv(null);
  }

  async function deleteInv(id) {
    if (!await confirmDialog('Delete this investment?')) return;
    await supabase.from('investments').delete().eq('id', id);
    setInvestments(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="investments" size={26} style={{color:'var(--accent)',flexShrink:0}} />Investments</h2><p>{investments.length} total · {active.length} active</p></div>
        <button className="btn-add-circle" onClick={()=>{setEditInv(null);setShowModal(true);}} title="New Investment" aria-label="New Investment">+</button>
      </div>

      <div className="cards-row">
        <div className="stat-card"><div className="stat-label">Active Capital</div><div className="stat-value">${totalAmount.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Income YTD</div><div className="stat-value" style={{color:'var(--green)'}}>${totalIncome.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Expense YTD</div><div className="stat-value" style={{color:'var(--red)'}}>${totalExpense.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Net YTD</div><div className="stat-value" style={{color: netYtd>=0?'var(--green)':'var(--red)'}}>${netYtd.toLocaleString()}</div></div>
      </div>

      <div className="panel">
        <div className="panel-header panel-header-compact">
          <h3>Investments</h3>
          <div className="filter-chip-row">
            {STAGES.map(s => (
              <button key={s.id} className={`filter-chip ${stageFilter===s.id?'active':''}`} onClick={()=>setStageFilter(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon"><Icon name="dollar" size={28} /></div><p>No investments here.</p></div>
            : <div className="task-list">
                {filtered.map(i => {
                  const linkedProp = properties.find(p => p.id === i.property_id);
                  return (
                    <div key={i.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditInv(i);setShowModal(true);}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                          {i.name}
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{(i.stage||'').replace('_',' ')}</span>
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-3)',fontSize:'11px'}}>{(i.kind||'').replace('_',' ')}</span>
                        </div>
                        {linkedProp && <div style={{fontSize:'13px',color:'var(--text-2)',display:'flex',alignItems:'center',gap:'4px',marginTop:'2px'}}><Icon name="pin" size={11} style={{flexShrink:0}} /> {linkedProp.nickname}</div>}
                        {i.amount && <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>${Number(i.amount).toLocaleString()}</div>}
                      </div>
                      <div className="task-meta">
                        <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteInv(i.id);}}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <InvestmentModal onClose={()=>{setShowModal(false);setEditInv(null);}} onSave={handleSave} onDelete={async (i)=>{ if(!await confirmDialog(`Delete investment "${i.name}"?`)) return; await deleteInv(i.id); setShowModal(false); setEditInv(null); }} initial={editInv} properties={properties} contacts={contacts} userId={userId} />}
    </div>
  );
}


// ─────────────────────────────────────────
// BRAIN VIEW (Soul / Memory / Playbooks / Decisions / Lessons / North Star)
// Hybrid search (FTS + trigram), tags, strength, streak gamification
// ─────────────────────────────────────────

export default InvestmentsView;
