// ChatMessageBubble — one message in the Ask Ari chat (markdown, tool cards, images).
// Extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { Icon } from '../icons';

export default function ChatMessageBubble({
  message, messageKey, getSignedUrl, signedUrls, onZoom,
  taxCatMap, systemMap, taxCats = [], personalCats = [], leadSystems = [], addCategory,
  receiptPushed, receiptSaving, onPushReceipt,
}) {
  const [imgUrl, setImgUrl] = useState(null);
  const [scope, setScope] = useState(message.receipt_data?.scope || 'business');
  const [bizCatId, setBizCatId] = useState(message.receipt_data?.tax_category_id || '');
  const [perCatId, setPerCatId] = useState(message.receipt_data?.personal_budget_line_id || '');
  const [leadId, setLeadId] = useState(message.receipt_data?.lead_gen_system_id || '');
  const [mealsWho, setMealsWho] = useState('');
  const [mealsWhy, setMealsWhy] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => {
    if (!message.image_path) return;
    // Use cached URL if available, otherwise mint a fresh one
    if (signedUrls[message.image_path]) {
      setImgUrl(signedUrls[message.image_path]);
    } else {
      getSignedUrl(message.image_path).then(setImgUrl);
    }
  }, [message.image_path, signedUrls, getSignedUrl]);

  const rd = message.receipt_data;
  const taxName = rd?.tax_category_id ? taxCatMap[rd.tax_category_id] : null;
  const sysName = rd?.lead_gen_system_id ? systemMap[rd.lead_gen_system_id] : null;
  const cats = scope === 'business' ? taxCats : personalCats;
  const catId = scope === 'business' ? bizCatId : perCatId;
  const setCatId = (v) => (scope === 'business' ? setBizCatId(v) : setPerCatId(v));
  const selCat = cats.find(c => c.id === catId) || null;
  const isMeals = scope === 'business' && !!(selCat && (selCat.is_meals_partial || /meal|entertain/i.test(selCat.name)));
  const ctrlStyle = { width:'100%', boxSizing:'border-box', padding:'6px 8px', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:'6px', color:'var(--text-1)', fontSize:'12px' };

  return (
    <div className={`chat-bubble-wrap ${message.role}`}>
      <div style={{display:'flex',flexDirection:'column',alignItems: message.role==='user'?'flex-end':'flex-start',maxWidth:'100%'}}>
        {(message.content || message.image_path) && (
          <div className={`chat-bubble ${message.role}`}>
            {message.image_path && (
              imgUrl ? (
                <img
                  src={imgUrl}
                  alt={message.role === 'user' ? 'You sent an image' : 'Image'}
                  className="chat-bubble-image"
                  onClick={() => onZoom(imgUrl)}
                />
              ) : (
                <div className="chat-bubble-image" style={{width:'200px',height:'150px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div className="spinner" style={{width:'16px',height:'16px',border:'2px solid var(--accent)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
                </div>
              )
            )}
            {message.content && <div>{message.content}</div>}
          </div>
        )}
        {/* Receipt CTA card — shown under the assistant reply when receipt detected */}
        {rd && message.role === 'assistant' && (
          <div className="chat-receipt-card">
            {receiptPushed?.ok ? (
              <div className="chat-receipt-pushed">
                <span>✓</span>
                <span>Added ${Math.abs(Number(rd.amount || 0)).toFixed(2)} to accounting</span>
              </div>
            ) : (
              <>
                <div className="chat-receipt-card-header">
                  <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="clipboard" size={12} /> Receipt detected</span>
                  <span className="chat-receipt-card-confidence">
                    {Math.round((rd.confidence || 0) * 100)}% confident
                  </span>
                </div>
                <div className="chat-receipt-fields">
                  <label>Vendor</label>
                  <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:600}}>{rd.vendor || '—'}</div>
                  <label>Amount</label>
                  <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:700}}>${Math.abs(Number(rd.amount || 0)).toFixed(2)}</div>
                  <label>Date</label>
                  <div style={{fontSize:'13px',color:'var(--text-2)'}}>{rd.date || '—'}</div>
                  <label>Scope</label>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',background:'var(--bg-hover)',padding:'2px',borderRadius:'6px'}}>
                    <button type="button" onClick={() => { setScope('business'); setAddingCat(false); }}
                      style={{padding:'5px',border:'none',borderRadius:'4px',fontWeight:600,fontSize:'11px',cursor:'pointer',
                        background:scope==='business'?'var(--accent)':'transparent',
                        color:scope==='business'?'var(--bg-base)':'var(--text-2)'}}>Business</button>
                    <button type="button" onClick={() => { setScope('personal'); setAddingCat(false); }}
                      style={{padding:'5px',border:'none',borderRadius:'4px',fontWeight:600,fontSize:'11px',cursor:'pointer',
                        background:scope==='personal'?'var(--accent)':'transparent',
                        color:scope==='personal'?'var(--bg-base)':'var(--text-2)'}}>Personal</button>
                  </div>
                  <label>Category</label>
                  <div>
                    <select value={addingCat ? '__add__' : catId}
                      onChange={e => { const v = e.target.value; if (v === '__add__') { setAddingCat(true); } else { setCatId(v); setAddingCat(false); } }}
                      style={ctrlStyle}>
                      <option value="">— Select —</option>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value="__add__">+ Add new {scope} category…</option>
                    </select>
                  </div>
                  {addingCat && (
                    <div style={{gridColumn:'1 / -1',display:'flex',gap:'6px',marginTop:'2px'}}>
                      <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name" autoFocus
                        style={{...ctrlStyle,flex:1}} />
                      <button type="button" disabled={savingCat || !newCatName.trim()}
                        onClick={async () => { setSavingCat(true); const c = await addCategory(newCatName, scope); setSavingCat(false); if (c) { setCatId(c.id); setNewCatName(''); setAddingCat(false); } }}
                        style={{padding:'6px 12px',background:'var(--accent)',color:'var(--bg-base)',border:'none',borderRadius:'6px',fontWeight:700,fontSize:'12px',cursor:'pointer',opacity:(savingCat||!newCatName.trim())?0.5:1}}>
                        {savingCat ? '…' : 'Add'}
                      </button>
                      <button type="button" onClick={() => { setAddingCat(false); setNewCatName(''); }}
                        style={{padding:'6px 10px',background:'transparent',color:'var(--text-3)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>×</button>
                    </div>
                  )}
                  {isMeals && (<>
                    <label>Who</label>
                    <div><input value={mealsWho} onChange={e => setMealsWho(e.target.value)} placeholder="Who you met with" style={ctrlStyle} /></div>
                    <label>Why</label>
                    <div><input value={mealsWhy} onChange={e => setMealsWhy(e.target.value)} placeholder="Business purpose" style={ctrlStyle} /></div>
                  </>)}
                  {scope === 'business' && (<>
                  <label>Lead gen</label>
                  <div>
                    <select value={leadId} onChange={e => setLeadId(e.target.value)} style={ctrlStyle}>
                      <option value="">None</option>
                      {leadSystems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  </>)}
                </div>
                <div className="chat-receipt-card-actions">
                  <button
                    type="button"
                    className="chat-receipt-save"
                    onClick={() => onPushReceipt({ scope, tax_category_id: scope === 'business' ? (catId || null) : null, personal_budget_line_id: scope === 'personal' ? (catId || null) : null, lead_gen_system_id: scope === 'business' ? (leadId || null) : null, meals_who: isMeals ? (mealsWho || null) : null, meals_why: isMeals ? (mealsWhy || null) : null })}
                    disabled={receiptSaving}
                  >
                    {receiptSaving ? 'Saving…' : 'Push to accounting →'}
                  </button>
                  <button
                    type="button"
                    className="chat-receipt-dismiss"
                    onClick={() => onPushReceipt({ scope, dismiss: true }) /* no-op confirm: dismiss locally */}
                    style={{display:'none'}}  // hidden in v1 — push or do nothing
                  >
                    Not now
                  </button>
                </div>
                {receiptPushed?.error && (
                  <div style={{marginTop:'8px',fontSize:'11px',color:'var(--red)'}}>
                    {receiptPushed.error}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {message.research_action && (
          <div style={{ marginTop: 8 }}>
            {message.research_action.kind === 'research' ? (
              <button type="button"
                onClick={() => { if (window.__openContactResearch) window.__openContactResearch(message.research_action.contact_id, null, message.research_action.hint); }}
                style={{ background:'var(--accent)', color:'#000', border:'none', borderRadius:999, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
                🔎 Research {message.research_action.name}
              </button>
            ) : message.research_action.kind === 'create' ? (
              <button type="button"
                onClick={() => { if (window.__openContactResearch) window.__openContactResearch(null, message.research_action); }}
                style={{ background:'transparent', color:'var(--accent)', border:'1px solid var(--accent)', borderRadius:999, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
                🔎 Create contact &amp; research {message.research_action.name}
              </button>
            ) : null}
            {(message.research_action.kind === 'research' || message.research_action.kind === 'create') && (
              <div style={{ fontSize:10.5, color:'var(--text-3)', marginTop:5 }}>Runs a full web search</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
