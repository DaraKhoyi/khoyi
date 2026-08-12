// PropertyModal — view/edit a property record (address, beds/baths, equity, etc.).
// Extracted from App.js (strangle). All deps import from modules.
import React, { useState, useEffect, useRef } from 'react';
import { useBackClose } from '../backClose';
import { Icon } from '../icons';

export default function PropertyModal({ onClose, onSave, onDelete, initial }) {

  useBackClose(onClose);
  const [nickname, setNickname] = useState(initial?.nickname || '');
  const [category, setCategory] = useState(initial?.category || 'listing');
  const [address, setAddress] = useState(initial?.address || '');
  const [city, setCity] = useState(initial?.city || '');
  const [state, setState] = useState(initial?.state || '');
  const [zip, setZip] = useState(initial?.zip || '');
  const [status, setStatus] = useState(initial?.status || 'active');
  const [list_price, setListPrice] = useState(initial?.list_price || '');
  const [purchase_price, setPurchasePrice] = useState(initial?.purchase_price || '');
  const [current_value, setCurrentValue] = useState(initial?.current_value || '');
  const [beds, setBeds] = useState(initial?.beds || '');
  const [baths, setBaths] = useState(initial?.baths || '');
  const [sqft, setSqft] = useState(initial?.sqft || '');
  const [lot_size, setLotSize] = useState(initial?.lot_size || '');
  const [year_built, setYearBuilt] = useState(initial?.year_built || '');
  const [loan_balance, setLoanBalance] = useState(initial?.loan_balance || '');
  const [loan_rate, setLoanRate] = useState(initial?.loan_rate || '');
  const [loan_holders, setLoanHolders] = useState(initial?.loan_holders || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const num = v => v === '' || v === null || v === undefined ? null : Number(v);
  const txt = v => (v ?? '').trim() || null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!nickname.trim()) return;
    onSave({
      nickname: nickname.trim(), category,
      address: txt(address), city: txt(city), state: txt(state), zip: txt(zip),
      status,
      list_price: num(list_price), purchase_price: num(purchase_price), current_value: num(current_value),
      beds: num(beds), baths: num(baths), sqft: num(sqft), lot_size: num(lot_size), year_built: num(year_built),
      loan_balance: num(loan_balance), loan_rate: num(loan_rate), loan_holders: txt(loan_holders),
      notes: txt(notes),
    });
  }

  const equity = current_value && loan_balance ? Number(current_value) - Number(loan_balance) : null;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Property' : 'New Property'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Nickname</label><input className="form-input" value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Wellington, Villa Adriana…" autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={category} onChange={e=>setCategory(e.target.value)}>
                <option value="listing">Listing</option>
                <option value="investment">Investment</option>
                <option value="personal">Personal</option>
                <option value="rental">Rental</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
                <option value="off_market">Off Market</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label className="form-label">Address</label><input className="form-input" value={address} onChange={e=>setAddress(e.target.value)} placeholder="Street address" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">City</label><input className="form-input" value={city} onChange={e=>setCity(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">State</label><input className="form-input" value={state} onChange={e=>setState(e.target.value)} maxLength="2" /></div>
            <div className="form-group"><label className="form-label">ZIP</label><input className="form-input" value={zip} onChange={e=>setZip(e.target.value)} /></div>
          </div>

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Valuation</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Purchase Price ($)</label><input className="form-input" type="number" value={purchase_price} onChange={e=>setPurchasePrice(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Current Value ($)</label><input className="form-input" type="number" value={current_value} onChange={e=>setCurrentValue(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">List Price ($)</label><input className="form-input" type="number" value={list_price} onChange={e=>setListPrice(e.target.value)} /></div>
          </div>

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Mortgage</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Loan Balance ($)</label><input className="form-input" type="number" value={loan_balance} onChange={e=>setLoanBalance(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Rate (%)</label><input className="form-input" type="number" step="0.01" value={loan_rate} onChange={e=>setLoanRate(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Loan Holder(s)</label><input className="form-input" value={loan_holders} onChange={e=>setLoanHolders(e.target.value)} placeholder="Self / Spouse / Children" /></div>
          </div>
          {equity !== null && (
            <div style={{padding:'8px 12px',background:'var(--bg-hover)',borderRadius:'6px',marginBottom:'12px',fontSize:'13px',color:'var(--text-2)'}}>
              Equity: <strong style={{color:'var(--accent)'}}>${equity.toLocaleString()}</strong>
            </div>
          )}

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Details</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Beds</label><input className="form-input" type="number" value={beds} onChange={e=>setBeds(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Baths</label><input className="form-input" type="number" step="0.5" value={baths} onChange={e=>setBaths(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Sq Ft</label><input className="form-input" type="number" value={sqft} onChange={e=>setSqft(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Lot Size (acres)</label><input className="form-input" type="number" step="0.01" value={lot_size} onChange={e=>setLotSize(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Year Built</label><input className="form-input" type="number" value={year_built} onChange={e=>setYearBuilt(e.target.value)} /></div>
          </div>

          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Property</button>
          </div>
        </form>
      </div>
    </div>
  );
}
