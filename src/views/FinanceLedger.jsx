// FinanceLedger — the day-to-day money screen: the transaction list, the
// add/edit modal, bulk categorisation, and recurring templates.
//
// ~1,075 lines out of AccountingViews.jsx. This is the ONE part of Finance an
// agent touches often, so unlike the tax and budget splits it is not lazy for
// frequency reasons — it is separated because a 2,400-line file that mixes the
// daily ledger with reports, dashboards and settings has no single subject.
//
// It owns the lazy CsvImportModal declaration: importing a statement is a ledger
// action, nothing else referenced it, and keeping the declaration here means the
// shell has no path to the importer at all.
// Extracted from AccountingViews.jsx (see REFACTOR-PLAN.md).
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { canHover, modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours, normalizePayee, buildSuggester } from '../financeUtils';
import { KpiBox, KpiTile } from './FinanceTiles';
import { HeaderSearchIcon, HeaderSearchInput } from './SharedUi';

// Lazy on purpose: the importer is ~1,100 lines used a few times a year.
const CsvImportModal = React.lazy(() => import('./CsvImportModal').then(m => ({ default: m.CsvImportModal })));

export function FinanceLedger({ userId, transactions, setTransactions, taxCategories, systems, personalBudget, recurringTemplates, setRecurringTemplates, trackPersonal, readOnly }) {
  const [ledgerMode, setLedgerMode] = useState('transactions');  // 'transactions' | 'recurring'
  const [showModal, setShowModal] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [period, setPeriod] = useState('ytd');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('business');
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [editRecurring, setEditRecurring] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkCategorize, setShowBulkCategorize] = useState(false);

  useEffect(() => { if (!trackPersonal) setScopeFilter('business'); }, [trackPersonal]);

  const filtered = useMemo(() => {
    const now = new Date();
    let cutoff = null;
    if (period === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === 'ytd') cutoff = new Date(now.getFullYear(), 0, 1);
    let result = cutoff ? transactions.filter(t => new Date(t.date) >= cutoff) : transactions;
    if (!trackPersonal || scopeFilter === 'business') result = result.filter(t => t.scope === 'business');
    else if (scopeFilter === 'personal') result = result.filter(t => t.scope === 'personal');
    const q = (search || '').trim().toLowerCase();
    if (q) result = result.filter(t =>
      (t.payee || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.account || '').toLowerCase().includes(q));
    return result;
  }, [transactions, period, search, scopeFilter, trackPersonal]);

  function onSaved(saved) {
    if (editTx) setTransactions(prev => prev.map(t => t.id === saved.id ? saved : t));
    else setTransactions(prev => [saved, ...prev]);
    setShowModal(false); setEditTx(null);
  }
  async function deleteTx(tx) {
    if (!await confirmDialog(`Delete this transaction? (${fmtUSDCents(tx.amount)} to ${tx.payee || 'no payee'})`)) return;
    await supabase.from('transactions').update({ is_archived: true }).eq('id', tx.id);
    setTransactions(prev => prev.filter(t => t.id !== tx.id));
    setShowModal(false); setEditTx(null);
  }

  const totalIn  = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      {/* Mode tabs */}
      <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',width:'fit-content'}}>
        <button onClick={() => setLedgerMode('transactions')}
          style={{padding:'6px 14px',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:700,cursor:'pointer',
            background: ledgerMode === 'transactions' ? 'var(--accent)' : 'transparent',
            color: ledgerMode === 'transactions' ? 'var(--bg-base)' : 'var(--text-2)',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="notes" size={13} /> Transactions</button>
        <button onClick={() => setLedgerMode('recurring')}
          style={{padding:'6px 14px',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:700,cursor:'pointer',
            background: ledgerMode === 'recurring' ? 'var(--accent)' : 'transparent',
            color: ledgerMode === 'recurring' ? 'var(--bg-base)' : 'var(--text-2)',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="repeat" size={13} /> Recurring{(recurringTemplates?.length || 0) > 0 ? ` · ${recurringTemplates.length}` : ''}</button>
      </div>

      {ledgerMode === 'recurring' ? (
        <RecurringList
          userId={userId} recurringTemplates={recurringTemplates || []}
          setRecurringTemplates={setRecurringTemplates}
          taxCategories={taxCategories} systems={systems} personalBudget={personalBudget}
          trackPersonal={trackPersonal} readOnly={readOnly}
          onAdd={() => { setEditRecurring(null); setShowRecurringModal(true); }}
          onEdit={(r) => { setEditRecurring(r); setShowRecurringModal(true); }}
        />
      ) : (
      <>
      <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
        {[
          { id: 'month', label: 'This month' },
          { id: 'ytd',   label: 'YTD' },
          { id: 'all',   label: 'All' },
        ].map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            style={{padding:'6px 12px',border:'none',borderRadius:'999px',fontSize:'12px',fontWeight:600,
              background: period === p.id ? 'var(--accent)' : 'var(--bg-hover)',
              color: period === p.id ? 'var(--bg-base)' : 'var(--text-2)',cursor:'pointer'}}>{p.label}</button>
        ))}
        {trackPersonal && (
          <>
            <span style={{color:'var(--text-3)',fontSize:'11px',margin:'0 4px'}}>·</span>
            {['business','personal','all'].map(s => (
              <button key={s} onClick={() => setScopeFilter(s)}
                style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:'999px',fontSize:'11px',fontWeight:600,
                  background: scopeFilter === s ? 'var(--bg-hover)' : 'transparent',
                  color: scopeFilter === s ? 'var(--text-1)' : 'var(--text-3)',cursor:'pointer',textTransform:'capitalize'}}>{s}</button>
            ))}
          </>
        )}
        <div style={{flex:1}}/>
        <HeaderSearchIcon value={search} open={searchOpen} onToggle={() => setSearchOpen(o => !o)} />
        {!readOnly && (() => {
          // Count uncategorized in the current scope (independent of period
          // filter — backlog is backlog regardless of which month you're viewing)
          const effectiveScope = (!trackPersonal || scopeFilter === 'business') ? 'business' :
                                 scopeFilter === 'personal' ? 'personal' : 'business';
          const uncatYear = new Date().getFullYear();
          const uncategorizedCount = transactions.filter(t =>
            t.scope === effectiveScope && !t.tax_category_id && !t.is_archived &&
            t.date && Number(String(t.date).slice(0, 4)) === uncatYear
          ).length;
          if (uncategorizedCount === 0) return null;
          return (
            <button onClick={() => setShowBulkCategorize(true)}
              title={`Categorize ${uncategorizedCount} uncategorized ${effectiveScope} transactions`}
              style={{padding:'5px 10px',background:'rgba(245,158,11,0.10)',border:'1px solid #f59e0b',borderRadius:'6px',color:'#f59e0b',cursor:'pointer',fontSize:'11px',fontWeight:700,whiteSpace:'nowrap'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="tag" size={13} /> Categorize {uncategorizedCount}</span>
            </button>
          );
        })()}
        {!readOnly && (
          <button onClick={() => setShowImportModal(true)} title="Import CSV from bank/credit card" aria-label="Import CSV"
            style={{padding:'5px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:700,whiteSpace:'nowrap'}}>
            ⬆ Import
          </button>
        )}
        {!readOnly && <button className="btn-add-circle" onClick={() => { setEditTx(null); setShowModal(true); }} title="New transaction" aria-label="New transaction">+</button>}
      </div>

      {searchOpen && (
        <HeaderSearchInput value={search} onChange={setSearch} placeholder="🔍 Search payee / description / account…" onClose={() => setSearchOpen(false)} />
      )}

      <div className="panel" style={{padding:'10px 14px',display:'flex',justifyContent:'space-around',gap:'12px',fontVariantNumeric:'tabular-nums'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>In</div>
          <div style={{fontSize:'16px',color:'var(--green)',fontWeight:700}}>{fmtUSD(totalIn)}</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>Out</div>
          <div style={{fontSize:'16px',color:'var(--red)',fontWeight:700}}>{fmtUSD(totalOut)}</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>Net</div>
          <div style={{fontSize:'16px',color:(totalIn+totalOut)>=0?'var(--green)':'var(--red)',fontWeight:700}}>{fmtUSD(totalIn + totalOut)}</div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel"><div className="panel-body"><div className="empty-state" style={{padding:'40px 20px',textAlign:'center'}}>
          <div className="empty-icon"><Icon name="notes" size={28} /></div>
          <p style={{fontSize:'14px',color:'var(--text-1)',marginBottom:'4px'}}>No transactions in this period.</p>
          {!readOnly && <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Add transaction</button>}
        </div></div></div>
      ) : (
        <div className="panel"><div className="panel-body" style={{padding:0}}>
          {filtered.map(t => {
            const cat = taxCategories.find(c => c.id === t.tax_category_id);
            const sys = systems.find(s => s.id === t.lead_gen_system_id);
            const pcat = (personalBudget || []).find(p => p.id === t.personal_budget_line_id);
            return (
              <div key={t.id} onClick={() => { if (!readOnly) { setEditTx(t); setShowModal(true); } }}
                style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 12px',borderBottom:'1px solid var(--border)',cursor:readOnly?'default':'pointer'}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {t.payee || t.description || '(no payee)'}
                  </div>
                  <div style={{fontSize:'11px',color:'var(--text-3)',display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'2px'}}>
                    <span>{t.date}</span>
                    {cat && <span style={{padding:'2px 6px',borderRadius:'3px',background:`${cat.color}22`,color:cat.color,fontSize:'10px',fontWeight:600}}>{cat.name}</span>}
                    {sys && t.scope === 'business' && <span style={{padding:'2px 6px',borderRadius:'3px',background:`${sys.color}22`,color:sys.color,fontSize:'10px',fontWeight:600}}>{sys.name}</span>}
                    {t.scope === 'personal' && (
                      pcat
                        ? <span style={{padding:'2px 6px',borderRadius:'3px',background:'rgba(59,130,246,0.15)',color:'#3b82f6',fontSize:'10px',fontWeight:600}}>{pcat.category}</span>
                        : <span style={{padding:'2px 6px',borderRadius:'3px',background:'var(--bg-hover)',color:'var(--text-3)',fontSize:'10px',fontWeight:600}}>personal</span>
                    )}
                  </div>
                </div>
                <span style={{fontSize:'15px',fontWeight:700,color:Number(t.amount)>=0?'var(--green)':'var(--text-1)',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(t.amount)}</span>
              </div>
            );
          })}
        </div></div>
      )}

      {showModal && (
        <TransactionModal
          userId={userId} initial={editTx} trackPersonal={trackPersonal}
          taxCategories={taxCategories} systems={systems} personalBudget={personalBudget || []}
          onClose={() => { setShowModal(false); setEditTx(null); }}
          onSaved={onSaved}
          onDelete={editTx ? () => deleteTx(editTx) : null}
        />
      )}
      </>
      )}

      {showRecurringModal && (
        <RecurringTemplateModal
          userId={userId} initial={editRecurring} trackPersonal={trackPersonal}
          taxCategories={taxCategories} systems={systems} personalBudget={personalBudget || []}
          onClose={() => { setShowRecurringModal(false); setEditRecurring(null); }}
          onSaved={(saved) => {
            if (editRecurring) setRecurringTemplates(prev => prev.map(r => r.id === saved.id ? saved : r));
            else setRecurringTemplates(prev => [...prev, saved].sort((a, b) => a.next_run_date.localeCompare(b.next_run_date)));
            setShowRecurringModal(false); setEditRecurring(null);
          }}
        />
      )}

      {showImportModal && (
        <React.Suspense fallback={null}><CsvImportModal
          userId={userId}
          existingTransactions={transactions}
          taxCategories={taxCategories}
          trackPersonal={trackPersonal}
          onClose={() => setShowImportModal(false)}
          onImported={(rows) => {
            setTransactions(prev => [...rows, ...prev]);
            setShowImportModal(false);
          }}
          onBatchRevoked={(batchId) => {
            // Mark the affected rows as archived so the ledger drops them
            // from view without requiring a refresh.
            setTransactions(prev => prev.map(t =>
              t.import_batch_id === batchId ? { ...t, is_archived: true } : t
            ));
          }}
        /></React.Suspense>
      )}

      {showBulkCategorize && (
        <BulkCategorizeModal
          userId={userId}
          transactions={transactions}
          setTransactions={setTransactions}
          taxCategories={taxCategories}
          systems={systems}
          scope={(!trackPersonal || scopeFilter === 'business') ? 'business' : scopeFilter === 'personal' ? 'personal' : 'business'}
          onClose={() => setShowBulkCategorize(false)}
        />
      )}
    </div>
  );
}

// ─── CSV import — minimal but RFC 4180-aware parser ─────────────────
// Banks export CSV in widely varying formats. Handles the cases that
// actually show up in practice:
//   • quoted fields containing commas, quotes (""), and newlines
//   • UTF-8 BOM at start (Excel-exported CSV)
//   • \r\n line endings
//   • trailing empty rows
// Returns { headers, rows } where rows is an array of objects keyed by header.

export function TransactionModal({ userId, initial, taxCategories, systems, personalBudget, trackPersonal, onClose, onSaved, onDelete }) {


  useBackClose(onClose);
  const overheadSystem = systems.find(s => s.is_overhead);
  const advertisingCat = taxCategories.find(c => /advert/i.test(c.name));
  const personalCats = personalBudget || [];
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0,10));
  const [amount, setAmount] = useState(initial ? Math.abs(Number(initial.amount)) : '');
  const [direction, setDirection] = useState(initial && Number(initial.amount) > 0 ? 'in' : 'out');
  const [scope, setScope] = useState(initial?.scope || 'business');
  const [taxCategoryId, setTaxCategoryId] = useState(initial?.tax_category_id || taxCategories[0]?.id || '');
  const [systemId, setSystemId] = useState(initial?.lead_gen_system_id || overheadSystem?.id || '');
  const [personalBudgetLineId, setPersonalBudgetLineId] = useState(initial?.personal_budget_line_id || personalCats[0]?.id || '');
  const [payee, setPayee] = useState(initial?.payee || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [account, setAccount] = useState(initial?.account || '');
  const [saving, setSaving] = useState(false);
  // Receipt-parsing state
  const [receiptUrl, setReceiptUrl] = useState(initial?.receipt_url || null);
  const [receiptPath, setReceiptPath] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseInfo, setParseInfo] = useState(null);  // { confidence, vendor, notes }
  const [enteredVia, setEnteredVia] = useState(initial?.entered_via || 'manual');
  const fileInputRef = useRef(null);

  useEffect(() => { if (!trackPersonal) setScope('business'); }, [trackPersonal]);

  function onSystemChange(sysId) {
    setSystemId(sysId);
    const sys = systems.find(s => s.id === sysId);
    if (sys && !sys.is_overhead && advertisingCat) setTaxCategoryId(advertisingCat.id);
  }

  // ── Photo-receipt capture flow ────────────────────────────────────
  async function handleReceiptPicked(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (window.__notify) window.__notify('Image too large (10MB max)', 'error');
      return;
    }
    setParsing(true);
    setParseInfo(null);
    try {
      // 1. Upload to storage under {userId}/{timestamp}.{ext}
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw new Error('Upload failed: ' + upErr.message);
      setReceiptPath(path);

      // 2. Get a temporary URL for preview
      const { data: signed } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
      if (signed?.signedUrl) setReceiptUrl(signed.signedUrl);

      // 3. Call parse-receipt
      const { data, error } = await supabase.functions.invoke('parse-receipt', {
        body: { receipt_path: path },
      });
      if (error) throw new Error('Parse failed: ' + error.message);
      if (data?.error) throw new Error(data.error);

      // 4. Pre-fill form fields with what Claude extracted
      const extracted = data;
      if (extracted.amount) setAmount(Math.abs(Number(extracted.amount)));
      if (extracted.date) setDate(extracted.date);
      if (extracted.vendor) setPayee(extracted.vendor);
      if (extracted.description_guess) setDescription(extracted.description_guess);
      // Categories: only apply if Claude found a match in our chart of accounts
      if (extracted.is_business_likely !== false) {
        setScope('business');
        if (extracted.suggested_tax_category_id) setTaxCategoryId(extracted.suggested_tax_category_id);
        if (extracted.suggested_lead_gen_system_id) setSystemId(extracted.suggested_lead_gen_system_id);
        else if (overheadSystem) setSystemId(overheadSystem.id);
      } else if (trackPersonal) {
        setScope('personal');
      }
      // Direction: receipts are expenses unless Claude detects refund (amount<0)
      setDirection(Number(extracted.amount) < 0 ? 'in' : 'out');
      setEnteredVia('photo');
      setParseInfo({
        confidence: extracted.confidence,
        vendor: extracted.vendor,
        notes: extracted.notes,
      });
      if (window.__notify) window.__notify(`Receipt parsed · ${Math.round(extracted.confidence * 100)}% confidence`, 'success');
    } catch (err) {
      console.error('Receipt parse error:', err);
      if (window.__notify) window.__notify('Could not parse receipt: ' + err.message, 'error');
    } finally {
      setParsing(false);
    }
  }

  function clearReceipt() {
    setReceiptUrl(null);
    setReceiptPath(null);
    setParseInfo(null);
    if (enteredVia === 'photo') setEnteredVia('manual');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      if (window.__notify) window.__notify('Enter an amount', 'error'); return;
    }
    setSaving(true);
    const signedAmount = direction === 'in' ? Math.abs(Number(amount)) : -Math.abs(Number(amount));
    const payload = {
      user_id: userId, date, amount: signedAmount, scope,
      tax_category_id: scope === 'business' ? (taxCategoryId || null) : null,
      lead_gen_system_id: scope === 'business' ? (systemId || overheadSystem?.id || null) : null,
      personal_budget_line_id: scope === 'personal' ? (personalBudgetLineId || null) : null,
      payee: payee.trim() || null,
      description: description.trim() || null,
      account: account.trim() || null,
      receipt_url: receiptPath || (initial?.receipt_url ?? null),
      entered_via: enteredVia,
      ai_confidence: parseInfo?.confidence ?? initial?.ai_confidence ?? null,
    };
    if (initial) {
      const { data, error } = await supabase.from('transactions').update(payload).eq('id', initial.id).select().single();
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
      onSaved(data);
    } else {
      const { data, error } = await supabase.from('transactions').insert(payload).select().single();
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
      onSaved(data);
    }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'460px',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
          <h3 style={{margin:0}}>{initial ? 'Edit transaction' : 'New transaction'}</h3>
          {onDelete && <button onClick={onDelete} title="Delete" style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',padding:'4px 8px'}}><Icon name="trash" size={16} /></button>}
        </div>

        {/* Receipt capture — only on new transactions */}
        {!initial && (
          <div style={{marginBottom:'14px'}}>
            {!receiptUrl && !parsing && (
              <button type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{width:'100%',padding:'12px',background:'linear-gradient(135deg, rgba(197,169,94,0.12) 0%, rgba(197,169,94,0.04) 100%)',border:'1px dashed var(--accent)',borderRadius:'10px',color:'var(--accent)',cursor:'pointer',fontSize:'13px',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="camera" size={14} /> Snap receipt — AI will fill it in</span>
              </button>
            )}
            {parsing && (
              <div style={{padding:'14px',background:'var(--bg-hover)',borderRadius:'10px',display:'flex',alignItems:'center',gap:'10px',fontSize:'12px',color:'var(--text-2)'}}>
                <span className="spinner" style={{width:'16px',height:'16px',border:'2px solid var(--accent)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
                <span>Reading your receipt…</span>
              </div>
            )}
            {receiptUrl && !parsing && (
              <div style={{padding:'8px',background:'var(--bg-hover)',borderRadius:'10px'}}>
                <div style={{display:'flex',gap:'10px',alignItems:'flex-start'}}>
                  <img src={receiptUrl} alt="Receipt"
                    style={{width:'70px',height:'70px',objectFit:'cover',borderRadius:'6px',flexShrink:0,background:'var(--bg-base)'}}/>
                  <div style={{flex:1,minWidth:0,fontSize:'11px',color:'var(--text-2)',lineHeight:1.4}}>
                    {parseInfo ? (
                      <>
                        <div style={{color:'var(--accent)',fontWeight:700,marginBottom:'2px'}}>
                          ✓ Parsed · {Math.round((parseInfo.confidence || 0) * 100)}% confidence
                        </div>
                        {parseInfo.vendor && <div>Vendor: <strong style={{color:'var(--text-1)'}}>{parseInfo.vendor}</strong></div>}
                        <div style={{fontStyle:'italic',color:'var(--text-3)',marginTop:'2px'}}>Review fields below before saving.</div>
                      </>
                    ) : (
                      <div style={{color:'var(--text-3)'}}>Receipt attached</div>
                    )}
                  </div>
                  <button type="button" onClick={clearReceipt} title="Remove receipt"
                    style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'16px',padding:'0 4px',flexShrink:0}}>×</button>
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" capture="environment"
              style={{display:'none'}}
              onChange={(e) => { handleReceiptPicked(e.target.files?.[0]); e.target.value = ''; }}/>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',marginBottom:'12px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
            <button type="button" onClick={() => setDirection('out')}
              style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:700,fontSize:'13px',cursor:'pointer',
                background:direction==='out'?'var(--red)':'transparent',color:direction==='out'?'#fff':'var(--text-2)'}}>Expense</button>
            <button type="button" onClick={() => setDirection('in')}
              style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:700,fontSize:'13px',cursor:'pointer',
                background:direction==='in'?'var(--green)':'transparent',color:direction==='in'?'#fff':'var(--text-2)'}}>Income</button>
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:2}}>
              <label className="form-label">Amount</label>
              <input className="form-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus required />
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
          </div>

          {trackPersonal && (
            <div className="form-group">
              <label className="form-label">Scope</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
                <button type="button" onClick={() => setScope('business')}
                  style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:600,fontSize:'12px',cursor:'pointer',
                    background:scope==='business'?'var(--accent)':'transparent',color:scope==='business'?'var(--bg-base)':'var(--text-2)'}}>Business</button>
                <button type="button" onClick={() => setScope('personal')}
                  style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:600,fontSize:'12px',cursor:'pointer',
                    background:scope==='personal'?'var(--accent)':'transparent',color:scope==='personal'?'var(--bg-base)':'var(--text-2)'}}>Personal</button>
              </div>
            </div>
          )}

          {scope === 'business' && (
            <>
              <div className="form-group">
                <label className="form-label">Lead-gen system</label>
                <select className="form-input" value={systemId} onChange={e => onSystemChange(e.target.value)}>
                  {systems.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_overhead?' (default)':''}</option>)}
                </select>
                <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>
                  Picking a system other than Overhead auto-suggests "Advertising & Marketing" as the tax category.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Tax category (Schedule C bucket)</label>
                <select className="form-input" value={taxCategoryId} onChange={e => setTaxCategoryId(e.target.value)}>
                  {taxCategories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.schedule_c_line})</option>)}
                </select>
              </div>
            </>
          )}

          {scope === 'personal' && (
            <div className="form-group">
              <label className="form-label">Category</label>
              {personalCats.length === 0 ? (
                <div style={{fontSize:'12px',color:'var(--text-3)',fontStyle:'italic',padding:'8px',background:'var(--bg-base)',borderRadius:'6px'}}>
                  No personal categories yet. Add them in Blueprint → Personal expenses.
                </div>
              ) : (
                <select className="form-input" value={personalBudgetLineId} onChange={e => setPersonalBudgetLineId(e.target.value)}>
                  {personalCats.map(p => <option key={p.id} value={p.id}>{p.category}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Payee {direction === 'in' ? '(from)' : '(to)'}</label>
            <input className="form-input" type="text" value={payee} onChange={e => setPayee(e.target.value)} placeholder={direction === 'in' ? 'Who paid you' : 'Who did you pay'} />
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:2}}>
              <label className="form-label">Description (optional)</label>
              <input className="form-input" type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" />
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Account</label>
              <input className="form-input" type="text" value={account} onChange={e => setAccount(e.target.value)} placeholder="Biz Visa" />
            </div>
          </div>
          <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── FinanceSystems ─────────────────────────────────────────────────

export function BulkCategorizeModal({ userId, transactions, setTransactions, taxCategories, systems, scope, onClose }) {

  useBackClose(onClose);
  // The uncategorized backlog — only rows in the matching scope (so the
  // Business and Personal flows stay separated and the dropdowns stay
  // relevant) AND missing a tax_category_id.
  // Only THIS calendar year's backlog — older rows belong to a closed year and
  // would otherwise clutter the current year's categorize flow.
  const currentYear = new Date().getFullYear();
  const uncategorized = useMemo(() => transactions.filter(t =>
    t.scope === scope && !t.tax_category_id && !t.is_archived &&
    t.date && Number(String(t.date).slice(0, 4)) === currentYear
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [transactions, scope, currentYear]);

  // The categorized history — used to feed the auto-suggester.
  const suggester = useMemo(() => buildSuggester(
    transactions.filter(t => t.scope === scope && t.tax_category_id && !t.is_archived)
  ), [transactions, scope]);

  // Per-row local state — the chosen tax_category_id + lead_gen_system_id
  // for each transaction. Starts populated with auto-suggestions.
  const [picks, setPicks] = useState(() => {
    const initial = {};
    for (const t of uncategorized) {
      const suggestion = suggester.suggest(t.payee);
      initial[t.id] = {
        categoryId: suggestion?.categoryId || '',
        systemId: suggestion?.systemId || '',
        confidence: suggestion?.confidence || null,
        matchedFrom: suggestion?.matchedFrom || null,
        // Track whether the user has explicitly touched this row (so we
        // don't overwrite their picks if they hit Accept-all-suggestions)
        userTouched: false,
      };
    }
    return initial;
  });

  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return uncategorized;
    const q = search.toLowerCase();
    return uncategorized.filter(t => (t.payee || '').toLowerCase().includes(q));
  }, [uncategorized, search]);

  function updatePick(txId, patch) {
    setPicks(prev => ({ ...prev, [txId]: { ...prev[txId], ...patch, userTouched: true } }));
  }

  // Apply this row's pick to every other row with a similar payee
  function applyToMatching(sourceTxId) {
    const sourceTx = uncategorized.find(t => t.id === sourceTxId);
    if (!sourceTx) return;
    const sourcePick = picks[sourceTxId];
    if (!sourcePick?.categoryId) return;
    const sourceNorm = normalizePayee(sourceTx.payee);
    if (!sourceNorm) return;
    let count = 0;
    setPicks(prev => {
      const next = { ...prev };
      for (const t of uncategorized) {
        if (t.id === sourceTxId) continue;
        if (normalizePayee(t.payee) === sourceNorm) {
          next[t.id] = {
            categoryId: sourcePick.categoryId,
            systemId: sourcePick.systemId,
            confidence: 'manual',
            matchedFrom: sourceNorm,
            userTouched: true,
          };
          count++;
        }
      }
      return next;
    });
    if (window.__notify) window.__notify(`Applied to ${count} matching row${count===1?'':'s'}`, 'success');
  }

  // Accept all auto-suggestions (those the user hasn't explicitly touched)
  function acceptAllSuggestions() {
    let count = 0;
    setPicks(prev => {
      const next = { ...prev };
      for (const t of uncategorized) {
        const p = prev[t.id];
        if (p && !p.userTouched && !p.categoryId) {
          const sug = suggester.suggest(t.payee);
          if (sug) {
            next[t.id] = { ...p, categoryId: sug.categoryId, systemId: sug.systemId, confidence: sug.confidence, matchedFrom: sug.matchedFrom };
            count++;
          }
        }
      }
      return next;
    });
    if (window.__notify) window.__notify(`Accepted ${count} suggestion${count===1?'':'s'}`, 'success');
  }

  function clearRow(txId) {
    setPicks(prev => ({ ...prev, [txId]: { categoryId: '', systemId: '', confidence: null, matchedFrom: null, userTouched: true } }));
  }

  async function handleSave() {
    setSaving(true);
    // Build the list of rows to actually update — anything with a category set
    const toUpdate = uncategorized
      .filter(t => picks[t.id]?.categoryId)
      .map(t => ({
        id: t.id,
        tax_category_id: picks[t.id].categoryId,
        lead_gen_system_id: picks[t.id].systemId || null,
      }));
    if (toUpdate.length === 0) {
      setSaving(false);
      onClose();
      return;
    }
    // Supabase doesn't have batch UPDATE; do one per row but in parallel chunks
    const updated = [];
    const errors = [];
    const chunkSize = 10;
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      const chunk = toUpdate.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map(row =>
        supabase.from('transactions')
          .update({ tax_category_id: row.tax_category_id, lead_gen_system_id: row.lead_gen_system_id })
          .eq('id', row.id).select().single()
      ));
      for (const r of results) {
        if (r.error) errors.push(r.error.message);
        else if (r.data) updated.push(r.data);
      }
    }
    // Mirror into parent state so the UI updates immediately
    setTransactions(prev => prev.map(t => {
      const u = updated.find(x => x.id === t.id);
      return u || t;
    }));
    if (window.__notify) {
      if (errors.length > 0) window.__notify(`${updated.length} updated, ${errors.length} failed`, 'error');
      else window.__notify(`Categorized ${updated.length} transaction${updated.length===1?'':'s'}`, 'success');
    }
    setSaving(false);
    onClose();
  }

  // Bulk stats for the header
  const totalUncategorized = uncategorized.length;
  const totalPicked = Object.values(picks).filter(p => p.categoryId).length;
  const totalAutoSuggested = Object.values(picks).filter(p => p.categoryId && p.confidence && p.confidence !== 'manual' && !p.userTouched).length;
  const totalManual = Object.values(picks).filter(p => p.userTouched).length;

  const categoryOpts = useMemo(() =>
    [...taxCategories].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [taxCategories]
  );

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'880px',maxHeight:'92vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexShrink:0}}>
          <h3 style={{margin:0,fontSize:'15px'}}>
            Bulk categorize
            <span style={{fontSize:'11px',color:'var(--text-3)',fontWeight:400,marginLeft:'8px'}}>
              · {scope === 'business' ? 'Business' : 'Personal'} · {currentYear} · {totalUncategorized} uncategorized
            </span>
          </h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        {totalUncategorized === 0 ? (
          <div style={{padding:'40px 20px',textAlign:'center'}}>
            <div style={{fontSize:'40px',marginBottom:'8px'}}>✓</div>
            <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:600}}>Everything is categorized.</div>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Nothing to do here.</div>
          </div>
        ) : (
          <>
            {/* KPI strip + bulk actions */}
            <div style={{display:'flex',gap:'8px',marginBottom:'10px',flexWrap:'wrap',flexShrink:0}}>
              <div style={{flex:1,minWidth:'90px',padding:'7px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'9px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Auto-suggested</div>
                <div style={{fontSize:'16px',fontWeight:800,color:'var(--accent)'}}>{totalAutoSuggested}</div>
              </div>
              <div style={{flex:1,minWidth:'90px',padding:'7px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'9px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Manually set</div>
                <div style={{fontSize:'16px',fontWeight:800,color:'var(--text-1)'}}>{totalManual}</div>
              </div>
              <div style={{flex:1,minWidth:'90px',padding:'7px 10px',background:'var(--bg-hover)',border:'1px solid var(--accent)',borderRadius:'6px'}}>
                <div style={{fontSize:'9px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Will save</div>
                <div style={{fontSize:'16px',fontWeight:800,color:'var(--accent)'}}>{totalPicked} / {totalUncategorized}</div>
              </div>
            </div>

            <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
              <button onClick={acceptAllSuggestions}
                style={{padding:'5px 12px',background:'transparent',border:'1px solid var(--accent)',borderRadius:'5px',color:'var(--accent)',cursor:'pointer',fontWeight:700,fontSize:'11px'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="sparkles" size={13} /> Accept all suggestions</span>
              </button>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search by payee…"
                style={{flex:'1 1 180px',padding:'5px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11px',outline:'none'}}/>
            </div>

            {/* Scrollable table of rows */}
            <div style={{flex:1,minHeight:0,overflowY:'auto',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'10px'}}>
              {filtered.map(t => {
                const p = picks[t.id] || {};
                const isPicked = !!p.categoryId;
                const isAuto = isPicked && p.confidence && p.confidence !== 'manual' && !p.userTouched;
                return (
                  <div key={t.id} style={{display:'flex',flexDirection:'column',gap:'10px',padding:'12px 14px',borderBottom:'1px solid var(--border)',background: isPicked ? 'rgba(34,197,94,0.05)' : 'transparent'}}>
                    {/* Top line: payee + date on the left, amount on the right */}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px'}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.payee || '(no payee)'}</div>
                        <div style={{fontSize:'10.5px',color:'var(--text-3)',fontVariantNumeric:'tabular-nums',marginTop:'2px'}}>{t.date}</div>
                      </div>
                      <div style={{fontSize:'15px',fontVariantNumeric:'tabular-nums',fontWeight:800,whiteSpace:'nowrap',color: Number(t.amount) < 0 ? 'var(--red)' : 'var(--green)'}}>{fmtUSD(t.amount)}</div>
                    </div>
                    {/* Auto-suggest provenance */}
                    {isAuto && (
                      <div style={{fontSize:'10.5px',color:'var(--accent)',display:'inline-flex',alignItems:'center',gap:'5px',flexWrap:'wrap'}}>
                        <Icon name="sparkles" size={12} /> matched "{p.matchedFrom}" · {p.confidence}
                      </div>
                    )}
                    {/* Category + lead-gen system — full-width, labeled, wrap to stack on phones */}
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                      <label style={{flex:'1 1 150px',minWidth:0,display:'flex',flexDirection:'column',gap:'4px'}}>
                        <span style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,color:'var(--text-3)'}}>Category</span>
                        <select value={p.categoryId || ''} onChange={e => updatePick(t.id, { categoryId: e.target.value })}
                          style={{width:'100%',padding:'8px 10px',background:'var(--bg-base)',border:`1px solid ${isPicked?'var(--green)':'var(--border)'}`,borderRadius:'7px',color:'var(--text-1)',fontSize:'13px'}}>
                          <option value="">— choose category —</option>
                          {categoryOpts.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                        </select>
                      </label>
                      <label style={{flex:'1 1 150px',minWidth:0,display:'flex',flexDirection:'column',gap:'4px'}}>
                        <span style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,color:'var(--text-3)'}}>Lead-gen system</span>
                        <select value={p.systemId || ''} onChange={e => updatePick(t.id, { systemId: e.target.value })}
                          style={{width:'100%',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'7px',color:'var(--text-2)',fontSize:'13px'}}>
                          <option value="">— none —</option>
                          {systems.map(s => (<option key={s.id} value={s.id}>{s.name}{s.is_overhead ? ' (overhead)' : ''}</option>))}
                        </select>
                      </label>
                    </div>
                    {/* Footer: apply-to-all + clear, only once a category is chosen */}
                    {isPicked && (
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                        <button onClick={() => applyToMatching(t.id)} title="Apply this category to every row with the same payee"
                          style={{background:'transparent',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:'11.5px',fontWeight:600,padding:0,display:'inline-flex',alignItems:'center',gap:'4px'}}>
                          ↪ Apply to all matching
                        </button>
                        <button onClick={() => clearRow(t.id)}
                          style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text-3)',cursor:'pointer',fontSize:'11px',padding:'4px 12px',borderRadius:'6px'}}>Clear</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div style={{padding:'30px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic',fontSize:'12px'}}>
                  No matches for "{search}".
                </div>
              )}
            </div>

            {/* Boundary note */}
            <div style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',fontSize:'10.5px',color:'var(--text-3)',lineHeight:1.5,marginBottom:'10px',flexShrink:0}}>
              Auto-suggest learns from rows you've already categorized — the more history exists for a payee, the more confident the match. Rows without a category pick get skipped on save.
            </div>

            <div className="modal-actions" style={{display:'flex',justifyContent:'space-between',gap:'8px',flexShrink:0}}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || totalPicked === 0}>
                {saving ? 'Saving…' : `Save ${totalPicked} ${totalPicked===1?'row':'rows'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── RecurringList — list of recurring transaction templates ─────────

export function RecurringList({ userId, recurringTemplates, setRecurringTemplates, taxCategories, systems, personalBudget, trackPersonal, readOnly, onAdd, onEdit }) {
  const active = recurringTemplates.filter(r => r.is_active);
  const paused = recurringTemplates.filter(r => !r.is_active);

  async function togglePause(r) {
    const newActive = !r.is_active;
    await supabase.from('recurring_transactions').update({ is_active: newActive }).eq('id', r.id);
    setRecurringTemplates(prev => prev.map(x => x.id === r.id ? { ...x, is_active: newActive } : x));
  }

  async function deleteTemplate(r) {
    if (!await confirmDialog(`Delete recurring template "${r.template_payee || r.template_description || 'untitled'}"? Past transactions stay; only the future schedule is removed.`)) return;
    await supabase.from('recurring_transactions').delete().eq('id', r.id);
    setRecurringTemplates(prev => prev.filter(x => x.id !== r.id));
  }

  function renderRow(r) {
    const cat = taxCategories.find(c => c.id === r.template_tax_category_id);
    const sys = systems.find(s => s.id === r.template_system_id);
    const isExpense = Number(r.template_amount) < 0;
    const today = new Date().toISOString().slice(0, 10);
    const isDue = r.is_active && r.next_run_date <= today;
    return (
      <div key={r.id}
        onClick={() => !readOnly && onEdit(r)}
        style={{
          display:'flex',alignItems:'center',gap:'10px',padding:'10px 12px',
          background: r.is_active ? 'var(--bg-base)' : 'rgba(85,94,122,0.08)',
          border:'1px solid var(--border)',
          borderLeft: isDue ? '3px solid var(--accent)' : '1px solid var(--border)',
          borderRadius:'8px',cursor:readOnly?'default':'pointer',opacity:r.is_active?1:0.6,
        }}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {r.template_payee || r.template_description || '(untitled)'}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'2px'}}>
            <span style={{textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700,color:'var(--accent)',display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="repeat" size={11} /> {r.frequency}</span>
            <span>next: <strong style={{color:isDue?'var(--accent)':'var(--text-2)'}}>{r.next_run_date}</strong></span>
            {cat && <span style={{padding:'1px 5px',borderRadius:'3px',background:`${cat.color}22`,color:cat.color,fontWeight:600}}>{cat.name}</span>}
            {sys && r.template_scope === 'business' && <span style={{padding:'1px 5px',borderRadius:'3px',background:`${sys.color}22`,color:sys.color,fontWeight:600}}>{sys.name}</span>}
            {r.template_scope === 'personal' && <span style={{padding:'1px 5px',borderRadius:'3px',background:'var(--bg-hover)',color:'var(--text-3)',fontWeight:600}}>personal</span>}
          </div>
        </div>
        <span style={{fontSize:'14px',fontWeight:700,color:isExpense?'var(--text-1)':'var(--green)',fontVariantNumeric:'tabular-nums',flexShrink:0}}>
          {fmtUSDCents(r.template_amount)}
        </span>
        {!readOnly && (
          <div style={{display:'flex',gap:'4px',flexShrink:0}} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => togglePause(r)} title={r.is_active ? 'Pause' : 'Resume'}
              style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'14px',padding:'4px'}}>
              {r.is_active ? '⏸' : '▶️'}
            </button>
            <button onClick={() => deleteTemplate(r)} title="Delete"
              style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',padding:'4px'}}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
        <p style={{fontSize:'12px',color:'var(--text-3)',margin:0,lineHeight:1.5}}>
          Templates auto-create transactions on schedule. {active.length} active{paused.length > 0 ? ` · ${paused.length} paused` : ''}.
        </p>
        {!readOnly && (
          <button className="btn-add-circle" onClick={onAdd} title="New recurring template" aria-label="New recurring template">+</button>
        )}
      </div>

      {recurringTemplates.length === 0 ? (
        <div className="panel"><div className="empty-state" style={{padding:'30px 20px',textAlign:'center'}}>
          <div className="empty-icon"><Icon name="repeat" size={28} /></div>
          <p style={{fontSize:'13px',color:'var(--text-1)',marginBottom:'4px'}}>No recurring templates yet.</p>
          <p style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'12px',lineHeight:1.5}}>
            Set up monthly MLS dues, software subscriptions, NAR fees, anything that hits on a schedule. The app auto-adds the transaction each period.
          </p>
          {!readOnly && <button className="btn btn-primary btn-sm" onClick={onAdd}>+ New recurring template</button>}
        </div></div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              {active.map(renderRow)}
            </div>
          )}
          {paused.length > 0 && (
            <div style={{display:'flex',flexDirection:'column',gap:'4px',marginTop:'8px'}}>
              <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,paddingLeft:'4px'}}>
                Paused
              </div>
              {paused.map(renderRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RecurringTemplateModal({ userId, initial, taxCategories, systems, personalBudget, trackPersonal, onClose, onSaved }) {


  useBackClose(onClose);
  const overheadSystem = systems.find(s => s.is_overhead);
  const advertisingCat = taxCategories.find(c => /advert/i.test(c.name));
  const [amount, setAmount] = useState(initial ? Math.abs(Number(initial.template_amount)) : '');
  const [direction, setDirection] = useState(initial && Number(initial.template_amount) > 0 ? 'in' : 'out');
  const [scope, setScope] = useState(initial?.template_scope || 'business');
  const [taxCategoryId, setTaxCategoryId] = useState(initial?.template_tax_category_id || taxCategories[0]?.id || '');
  const [systemId, setSystemId] = useState(initial?.template_system_id || overheadSystem?.id || '');
  const [payee, setPayee] = useState(initial?.template_payee || '');
  const [description, setDescription] = useState(initial?.template_description || '');
  const [account, setAccount] = useState(initial?.template_account || '');
  const [frequency, setFrequency] = useState(initial?.frequency || 'monthly');
  const [nextRunDate, setNextRunDate] = useState(initial?.next_run_date || new Date().toISOString().slice(0,10));
  const [saving, setSaving] = useState(false);

  function onSystemChange(sysId) {
    setSystemId(sysId);
    const sys = systems.find(s => s.id === sysId);
    if (sys && !sys.is_overhead && advertisingCat) setTaxCategoryId(advertisingCat.id);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) { if (window.__notify) window.__notify('Enter an amount', 'error'); return; }
    setSaving(true);
    const signedAmount = direction === 'in' ? Math.abs(Number(amount)) : -Math.abs(Number(amount));
    const payload = {
      user_id: userId,
      template_amount: signedAmount,
      template_scope: scope,
      template_tax_category_id: scope === 'business' ? (taxCategoryId || null) : null,
      template_system_id: scope === 'business' ? (systemId || overheadSystem?.id || null) : null,
      template_payee: payee.trim() || null,
      template_description: description.trim() || null,
      template_account: account.trim() || null,
      frequency,
      next_run_date: nextRunDate,
      is_active: true,
    };
    if (initial) {
      const { data, error } = await supabase.from('recurring_transactions').update(payload).eq('id', initial.id).select().single();
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
      onSaved(data);
    } else {
      const { data, error } = await supabase.from('recurring_transactions').insert(payload).select().single();
      if (error) { if (window.__notify) window.__notify('Save failed: ' + error.message, 'error'); setSaving(false); return; }
      onSaved(data);
    }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'460px',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
          <h3 style={{margin:0,display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="repeat" size={15} /> {initial ? 'Edit recurring' : 'New recurring template'}</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',marginBottom:'12px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
            <button type="button" onClick={() => setDirection('out')}
              style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:700,fontSize:'13px',cursor:'pointer',
                background:direction==='out'?'var(--red)':'transparent',color:direction==='out'?'#fff':'var(--text-2)'}}>Expense</button>
            <button type="button" onClick={() => setDirection('in')}
              style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:700,fontSize:'13px',cursor:'pointer',
                background:direction==='in'?'var(--green)':'transparent',color:direction==='in'?'#fff':'var(--text-2)'}}>Income</button>
          </div>

          <div className="form-row">
            <div className="form-group" style={{flex:2}}>
              <label className="form-label">Amount</label>
              <input className="form-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus required />
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Frequency</label>
              <select className="form-input" value={frequency} onChange={e => setFrequency(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Next run date</label>
            <input className="form-input" type="date" value={nextRunDate} onChange={e => setNextRunDate(e.target.value)} required />
            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>
              The first auto-created transaction will land on this date. If it's today or earlier, it fires next time the app opens.
            </div>
          </div>

          {trackPersonal && (
            <div className="form-group">
              <label className="form-label">Scope</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
                <button type="button" onClick={() => setScope('business')}
                  style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:600,fontSize:'12px',cursor:'pointer',
                    background:scope==='business'?'var(--accent)':'transparent',color:scope==='business'?'var(--bg-base)':'var(--text-2)'}}>Business</button>
                <button type="button" onClick={() => setScope('personal')}
                  style={{padding:'8px',border:'none',borderRadius:'6px',fontWeight:600,fontSize:'12px',cursor:'pointer',
                    background:scope==='personal'?'var(--accent)':'transparent',color:scope==='personal'?'var(--bg-base)':'var(--text-2)'}}>Personal</button>
              </div>
            </div>
          )}

          {scope === 'business' && (
            <>
              <div className="form-group">
                <label className="form-label">Lead-gen system</label>
                <select className="form-input" value={systemId} onChange={e => onSystemChange(e.target.value)}>
                  {systems.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_overhead?' (default)':''}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tax category</label>
                <select className="form-input" value={taxCategoryId} onChange={e => setTaxCategoryId(e.target.value)}>
                  {taxCategories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.schedule_c_line})</option>)}
                </select>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Payee</label>
            <input className="form-input" type="text" value={payee} onChange={e => setPayee(e.target.value)} placeholder="e.g. Stellar MLS, NAR, Adobe" />
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:2}}>
              <label className="form-label">Description (optional)</label>
              <input className="form-input" type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this charge?" />
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Account</label>
              <input className="form-input" type="text" value={account} onChange={e => setAccount(e.target.value)} placeholder="Biz Visa" />
            </div>
          </div>

          <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : '✓ Create recurring'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
