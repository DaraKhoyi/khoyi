// BudgetForecast — the planning half of Finance: the annual budget, the cash-flow
// forecast, and the Blueprint that turns a GCI goal into the activity behind it.
//
// ~1,470 lines out of AccountingViews.jsx. This is deliberate, forward-looking
// work an agent sits down to do — not the daily ledger — so it has no business in
// the chunk that loads every time someone glances at their numbers.
//
// The bp* constants are Blueprint's own style tokens and move WITH it; nothing
// outside this cluster used them. getProrata went to financeUtils instead,
// because the finance shell genuinely shares it and a static import from here
// back into AccountingViews would undo the lazy split.
// Extracted from AccountingViews.jsx (see REFACTOR-PLAN.md).
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd, canHover } from '../helpers';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours, getProrata } from '../financeUtils';
import { KpiBox, KpiTile } from './FinanceTiles';

export const bpIconBtn = { width:'26px',height:'26px',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',fontSize:'15px',lineHeight:1,cursor:'pointer',padding:0 };

export const bpInput = { padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',width:'100%',boxSizing:'border-box' };

export const bpKpiCol = { flex:1,minWidth:'130px',padding:'12px',background:'var(--bg-base)',borderRadius:'8px' };

export const bpKpiLabel = { fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700 };

export const bpKpiNum = { fontSize:'22px',fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:'4px' };

export const bpKpiSub = { fontSize:'11px',color:'var(--text-3)',marginTop:'3px',fontVariantNumeric:'tabular-nums' };

// Personal budget row: inline rename + delete; amount keeps monthly/annual behavior.

export const bpAddWrap = { marginTop:'10px',padding:'12px',background:'var(--bg-base)',borderRadius:'8px',border:'1px solid var(--accent)',display:'flex',flexDirection:'column',gap:'8px' };

export const BIZ_CAT_LINES = [
  { v: '—', label: '— (no tax line · budget only)' },
  { v: 'Line 8',   label: 'Line 8 · Advertising' },
  { v: 'Line 9',   label: 'Line 9 · Car & truck' },
  { v: 'Line 10',  label: 'Line 10 · Commissions & fees' },
  { v: 'Line 11',  label: 'Line 11 · Contract labor' },
  { v: 'Line 13',  label: 'Line 13 · Depreciation' },
  { v: 'Line 15',  label: 'Line 15 · Insurance' },
  { v: 'Line 17',  label: 'Line 17 · Legal & professional' },
  { v: 'Line 18',  label: 'Line 18 · Office expense' },
  { v: 'Line 20',  label: 'Line 20 · Rent or lease' },
  { v: 'Line 21',  label: 'Line 21 · Repairs & maintenance' },
  { v: 'Line 22',  label: 'Line 22 · Supplies' },
  { v: 'Line 23',  label: 'Line 23 · Taxes & licenses' },
  { v: 'Line 24a', label: 'Line 24a · Travel' },
  { v: 'Line 24b', label: 'Line 24b · Meals' },
  { v: 'Line 25',  label: 'Line 25 · Utilities' },
  { v: 'Line 27a', label: 'Line 27a · Other expenses' },
];

export const DEAL_STATUS_CONFIDENCE = {
  closing:         'high',     // about to close
  under_contract:  'medium',   // contract signed, on path to close
  active:          'low',      // listed, not yet under contract
  lead:            'low',      // earliest stage
};

// Probability factor applied to each file's expected commission when
// confidence weighting is on. These reflect typical real-estate
// fall-through rates by stage. Conservative on early-stage to avoid the
// classic optimism trap (every active listing is going to close!).
//   closing         — about to close: 90% (still some inspection/financing risk)
//   under_contract  — contract signed: 75% (~25% fall-through is realistic)
//   active          — listed only:     35% (most listings take months or relist)
//   lead            — earliest:        15% (most leads never convert at all)

export const DEAL_STATUS_PROBABILITY = {
  closing:         0.90,
  under_contract:  0.75,
  active:          0.35,
  lead:            0.15,
};

export function SettingInput({ label, value, prefix, suffix, onSave, step = "1", readOnly }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div>
      <label style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,display:'block',marginBottom:'4px'}}>{label}</label>
      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
        {prefix && <span style={{color:'var(--text-3)',fontSize:'13px'}}>{prefix}</span>}
        <input type="number" step={step} value={local ?? ''} disabled={readOnly}
          onChange={e => setLocal(e.target.value === '' ? 0 : Number(e.target.value))}
          onBlur={() => !readOnly && onSave(local)}
          style={{flex:1,padding:'6px 10px',textAlign:'right',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontVariantNumeric:'tabular-nums'}}/>
        {suffix && <span style={{color:'var(--text-3)',fontSize:'13px'}}>{suffix}</span>}
      </div>
    </div>
  );
}

export function PersonalBudgetRow({ line, onChangeAmount, onSaveLabel, onDelete, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(line.category);
  useEffect(() => { setLabel(line.category); }, [line.category]);
  const usesAnnual = line.is_vacation || line.is_savings;
  const value = usesAnnual ? (line.annual_amount ?? '') : (line.monthly_amount ?? '');
  const placeholder = usesAnnual ? 'annual' : 'monthly';
  const accent = line.is_vacation ? '#22c55e' : line.is_savings ? '#3b82f6' : 'transparent';
  async function commit() {
    const t = (label || '').trim();
    if (t && t !== line.category) await onSaveLabel(line.id, t);
    else setLabel(line.category);
    setEditing(false);
  }
  return (
    <div style={{display:'flex',alignItems:'center',gap:'6px',padding:'6px 4px',borderRadius:'6px'}}>
      <div style={{width:'4px',height:'24px',background:accent,borderRadius:'2px',flexShrink:0}}/>
      {editing ? (
        <input autoFocus value={label} onChange={e=>setLabel(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape'){ setLabel(line.category); setEditing(false); } }}
          onBlur={commit}
          style={{flex:1,minWidth:0,padding:'4px 8px',background:'var(--bg-base)',border:'1px solid var(--accent)',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}/>
      ) : (
        <div style={{flex:1,fontSize:'13px',color:'var(--text-1)',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {line.category}
          {usesAnnual && <span style={{color:accent,fontSize:'10px',marginLeft:'6px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>annual</span>}
        </div>
      )}
      <span style={{color:'var(--text-3)',fontSize:'13px'}}>$</span>
      <input type="number" step="1" value={value} placeholder={placeholder} disabled={readOnly}
        onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); onChangeAmount(line.id, usesAnnual ? { annual_amount: v } : { monthly_amount: v }); }}
        style={{width:'88px',padding:'5px 8px',textAlign:'right',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',fontVariantNumeric:'tabular-nums'}}/>
      {!readOnly && (<>
        <button onClick={() => editing ? commit() : setEditing(true)} title={editing?'Save name':'Rename'} style={bpIconBtn}>{editing?'✓':'✎'}</button>
        <button onClick={() => onDelete(line)} title="Delete" style={bpIconBtn}>×</button>
      </>)}
    </div>
  );
}

// Business (Chart of Accounts) row: inline edit of name + description + Schedule C line; delete; budget input.

export function TaxCatRow({ cat, isAdv, advValue, onChangeBudget, onSaveMeta, onDelete, readOnly }) {
  const locked = !!cat.is_locked || isAdv;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [desc, setDesc] = useState(cat.description || '');
  const [line, setLine] = useState(cat.schedule_c_line || '—');
  useEffect(() => { setName(cat.name); setDesc(cat.description || ''); setLine(cat.schedule_c_line || '—'); }, [cat]);
  const value = isAdv ? advValue : Number(cat.monthly_budget || 0);
  const lineShown = (cat.schedule_c_line === '—' || cat.schedule_c_line === '(not Schedule C)') ? '' : cat.schedule_c_line;
  async function save() {
    const patch = {};
    const nm = (name || '').trim();
    if (nm && nm !== cat.name) patch.name = nm;
    if ((desc || '') !== (cat.description || '')) patch.description = (desc || '').trim() || null;
    if (line !== cat.schedule_c_line) patch.schedule_c_line = line;
    if (Object.keys(patch).length) await onSaveMeta(cat.id, patch);
    setEditing(false);
  }
  if (editing && !locked) {
    return (
      <div style={bpAddWrap}>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Category name" style={bpInput}/>
        <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Description (optional)" style={bpInput}/>
        <select value={line} onChange={e=>setLine(e.target.value)} style={bpInput}>
          {BIZ_CAT_LINES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>{ setName(cat.name); setDesc(cat.description||''); setLine(cat.schedule_c_line||'—'); setEditing(false); }}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{display:'flex',alignItems:'center',gap:'6px',padding:'6px 4px',borderRadius:'6px'}}>
      <div style={{width:'4px',height:'24px',background:cat.color,borderRadius:'2px',flexShrink:0,alignSelf:'flex-start',marginTop:'3px'}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'13px',color:'var(--text-1)'}}>
          {cat.name}
          {lineShown && <span style={{fontSize:'10px',color:'var(--text-3)',marginLeft:'6px'}}>{lineShown}</span>}
          {isAdv && <span style={{fontSize:'9px',color:'var(--accent)',marginLeft:'6px',padding:'2px 6px',background:'rgba(197,169,94,0.12)',borderRadius:'3px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>Auto-rolled</span>}
        </div>
        {cat.description && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px',lineHeight:1.4}}>{cat.description}</div>}
      </div>
      <span style={{color:'var(--text-3)',fontSize:'13px'}}>$</span>
      <input type="number" step="1" value={value} disabled={readOnly || locked}
        onChange={e => onChangeBudget(cat.id, Number(e.target.value) || 0)}
        style={{width:'80px',padding:'5px 8px',textAlign:'right',background: locked ? 'var(--bg-hover)' : 'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',color: locked ? 'var(--text-3)' : 'var(--text-1)',fontSize:'13px',fontVariantNumeric:'tabular-nums',cursor: locked ? 'not-allowed' : 'text'}}
        title={isAdv ? 'Locked — sum of lead-gen system budgets' : (locked ? 'Structural category — locked' : '')}/>
      <span style={{color:'var(--text-3)',fontSize:'11px'}}>/mo</span>
      {!readOnly && !locked && (<>
        <button onClick={()=>setEditing(true)} title="Edit" style={bpIconBtn}>✎</button>
        <button onClick={()=>onDelete(cat)} title="Delete" style={bpIconBtn}>×</button>
      </>)}
    </div>
  );
}

export function WaterfallRow({ label, value, icon, sub, tone }) {
  const valColor = tone === 'gold' ? 'var(--accent)' : 'var(--text-1)';
  const valBold  = tone === 'gold' ? 800 : 600;
  return (
    <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 4px',borderBottom:'1px solid var(--border)'}}>
      <span style={{fontSize:'18px'}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:500}}>{label}</div>
        {sub && <div style={{fontSize:'10px',color:'var(--text-3)'}}>{sub}</div>}
      </div>
      <span style={{fontSize:tone==='gold'?'18px':'15px',color:valColor,fontWeight:valBold,fontVariantNumeric:'tabular-nums'}}>{value.toLocaleString()}</span>
    </div>
  );
}

// ─── FinanceLedger ───────────────────────────────────────────────────

export function BudgetSection({ title, subtitle, rows, rowPrefix, expandedRow, setExpandedRow, txnsForExpanded, severityFor, view, fmt }) {
  const sectionTotal = rows.reduce((s, r) => s + r.actual, 0);
  const sectionBudget = rows.reduce((s, r) => s + r.periodBudget, 0);
  const sectionPct = sectionBudget > 0 ? sectionTotal / sectionBudget : 0;
  return (
    <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <div style={{fontSize:'12.5px',color:'var(--text-1)',fontWeight:700}}>{title}</div>
          <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'1px'}}>{subtitle}</div>
        </div>
        <div style={{fontSize:'13px',fontWeight:700,color: severityFor(sectionPct).text,fontVariantNumeric:'tabular-nums'}}>
          {fmt(sectionTotal)} / {fmt(sectionBudget)} <span style={{fontSize:'11px',color:'var(--text-3)',marginLeft:'4px'}}>({(sectionPct*100).toFixed(0)}%)</span>
        </div>
      </div>

      {rows.map(r => {
        const rowKey = `${rowPrefix}:${r.system.id}`;
        const expanded = expandedRow === rowKey;
        const sev = severityFor(r.pct);
        const paceSev = severityFor(r.pacedPct);
        return (
          <div key={rowKey} style={{borderTop:'1px solid var(--border)',padding:'10px 0'}}>
            <button onClick={() => setExpandedRow(expanded ? null : rowKey)}
              style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'transparent',border:'none',padding:0,cursor:'pointer',gap:'10px',textAlign:'left'}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',minWidth:0,flex:1}}>
                <span style={{width:'8px',height:'8px',borderRadius:'2px',background:r.system.color || 'var(--text-3)',flexShrink:0}}/>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:'12.5px',color:'var(--text-1)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {r.system.name}
                    {r.system.is_overhead && <span style={{fontSize:'9px',color:'var(--text-3)',marginLeft:'6px',padding:'1px 5px',background:'var(--bg-hover)',borderRadius:'3px',fontWeight:700}}>overhead</span>}
                  </div>
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:'12.5px',fontWeight:700,color: sev.text,fontVariantNumeric:'tabular-nums'}}>
                  {fmt(r.actual)} <span style={{color:'var(--text-3)',fontWeight:500}}>/ {fmt(r.periodBudget)}</span>
                </div>
                <div style={{fontSize:'10px',color: r.variance >= 0 ? sev.text : 'var(--text-3)',marginTop:'1px',fontWeight:600}}>
                  {r.variance >= 0 ? '+' : '−'}{fmt(Math.abs(r.variance))} ({(r.pct*100).toFixed(0)}%) <span style={{color:'var(--text-3)',fontWeight:400}}>· {sev.label}</span>
                </div>
              </div>
              <span style={{color:'var(--text-3)',fontSize:'11px',transform: expanded ? 'rotate(90deg)' : 'rotate(0)',transition:'transform 0.15s',flexShrink:0}}>›</span>
            </button>

            {/* Progress bar */}
            <div style={{marginTop:'6px',height:'5px',background:'var(--bg-base)',borderRadius:'2.5px',overflow:'hidden',position:'relative'}}>
              <div style={{height:'100%',width: `${Math.min(100, r.pct * 100).toFixed(1)}%`,background: sev.bar,borderRadius:'2.5px',transition:'width 0.2s'}}/>
              {/* Pace projection ghost bar (MTD only) */}
              {view === 'mtd' && r.pacedPct > r.pct + 0.05 && (
                <div style={{position:'absolute',top:0,left:`${Math.min(100, r.pct * 100).toFixed(1)}%`,width:`${Math.min(100 - Math.min(100, r.pct * 100), (r.pacedPct - r.pct) * 100).toFixed(1)}%`,height:'100%',background:paceSev.bar,opacity:0.3}}/>
              )}
              {/* 100% marker if over */}
              {r.pct > 1 && (
                <div style={{position:'absolute',top:0,left:'100%',transform:'translateX(-1px)',width:'2px',height:'100%',background:'var(--text-1)'}}/>
              )}
            </div>
            {view === 'mtd' && r.pacedPct > r.pct + 0.05 && (
              <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>
                At current pace: <strong style={{color: paceSev.text,fontStyle:'normal'}}>{fmt(r.paced)} ({(r.pacedPct*100).toFixed(0)}%)</strong> by month-end
              </div>
            )}

            {/* Expanded transactions */}
            {expanded && (
              <div style={{marginTop:'10px',padding:'8px 10px',background:'var(--bg-base)',borderRadius:'6px'}}>
                {txnsForExpanded.length === 0 ? (
                  <div style={{fontSize:'10.5px',color:'var(--text-3)',fontStyle:'italic'}}>No transactions in this period.</div>
                ) : (
                  <>
                    <div style={{fontSize:'9.5px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'6px'}}>
                      {txnsForExpanded.length} transaction{txnsForExpanded.length===1?'':'s'}
                    </div>
                    {txnsForExpanded.map(t => (
                      <div key={t.id} style={{display:'flex',justifyContent:'space-between',gap:'8px',padding:'3px 0',fontSize:'11px'}}>
                        <span style={{color:'var(--text-3)',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',flexShrink:0}}>{t.date}</span>
                        <span style={{color:'var(--text-2)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.payee || '(no payee)'}</span>
                        <span style={{color:'var(--red)',fontVariantNumeric:'tabular-nums',fontWeight:600,flexShrink:0}}>{fmt(Math.abs(t.amount))}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CashFlowForecast ────────────────────────────────────────────────
// 90-day forward projection. Combines:
//   - Open pipeline files (lead/active/under_contract/closing) with their
//     expected close dates and expected commission income
//   - Recurring transactions (recurring_transactions table) projected
//     forward by frequency from next_run_date
// Renders an inline daily-balance line chart + a chronological event
// list so the user can see WHEN cash gets tight, not just IF.
//
// Starting balance:
//   If user has set finance_settings.current_cash_balance, the chart
//   shows projected BALANCE. Without it, shows projected NET ACTIVITY
//   (cumulative income - expenses from today).

// Confidence per file status — used for UI tagging + weighting.
// Hoisted to module scope so useMemo doesn't need it as a dependency.

export function BudgetReport({ userId, systems, recruitingSystems }) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);  // stable key for memo deps
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();
  const [view, setView] = useState('mtd');  // 'mtd' | 'last' | 'ytd'
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);

  // Date window for the selected view — depends only on stable date parts
  const dateWindow = useMemo(() => {
    const y = currentYear;
    const m = currentMonth;
    if (view === 'last') {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);     // last day of prior month
      return {
        start: start.toISOString().slice(0, 10),
        end:   end.toISOString().slice(0, 10),
        label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        budgetMultiplier: 1,
        isCurrent: false,
      };
    }
    if (view === 'ytd') {
      const start = new Date(y, 0, 1);
      return {
        start: start.toISOString().slice(0, 10),
        end:   todayKey,
        label: `${y} YTD`,
        budgetMultiplier: m + 1,  // months elapsed including current
        isCurrent: true,
      };
    }
    // 'mtd' — this month
    const start = new Date(y, m, 1);
    return {
      start: start.toISOString().slice(0, 10),
      end:   todayKey,
      label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      budgetMultiplier: 1,
      isCurrent: true,
    };
  }, [view, currentYear, currentMonth, todayKey]);

  // Pace factor for MTD: if we're 10 days into a 30-day month, factor = 3.0
  const paceFactor = useMemo(() => {
    if (view !== 'mtd') return 1;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    return daysInMonth / Math.max(1, currentDay);
  }, [view, currentYear, currentMonth, currentDay]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data } = await supabase.from('transactions')
        .select('id, date, amount, payee, scope, tax_category_id, lead_gen_system_id, recruiting_system_id, is_archived')
        .eq('user_id', userId).eq('scope', 'business').eq('is_archived', false)
        .gte('date', dateWindow.start).lte('date', dateWindow.end)
        .lt('amount', 0)
        .limit(5000);
      if (cancelled) return;
      setTransactions(data || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, dateWindow.start, dateWindow.end]);

  // Roll up actual spend per system within the period
  const leadGenActuals = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      if (t.lead_gen_system_id && !t.recruiting_system_id) {
        m[t.lead_gen_system_id] = (m[t.lead_gen_system_id] || 0) + Math.abs(Number(t.amount));
      }
    }
    return m;
  }, [transactions]);

  const recruitingActuals = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      if (t.recruiting_system_id) {
        m[t.recruiting_system_id] = (m[t.recruiting_system_id] || 0) + Math.abs(Number(t.amount));
      }
    }
    return m;
  }, [transactions]);

  // Transactions for an expanded row
  const txnsForSystem = useMemo(() => {
    if (!expandedRow) return [];
    const [kind, id] = expandedRow.split(':');
    if (kind === 'lg') return transactions.filter(t => t.lead_gen_system_id === id && !t.recruiting_system_id).sort((a,b) => (b.date||'').localeCompare(a.date||''));
    if (kind === 'r')  return transactions.filter(t => t.recruiting_system_id === id).sort((a,b) => (b.date||'').localeCompare(a.date||''));
    return [];
  }, [expandedRow, transactions]);

  // Build the row list — inlined as useMemo (was a helper, but a stable
  // function reference is harder than just inlining)
  const leadGenRows = useMemo(() =>
    (systems || [])
      .filter(s => Number(s.monthly_budget) > 0)
      .map(s => {
        const periodBudget = Number(s.monthly_budget) * dateWindow.budgetMultiplier;
        const actual = leadGenActuals[s.id] || 0;
        const variance = actual - periodBudget;
        const pct = periodBudget > 0 ? actual / periodBudget : 0;
        const paced = view === 'mtd' ? actual * paceFactor : actual;
        const pacedPct = periodBudget > 0 ? paced / periodBudget : 0;
        return { system: s, periodBudget, actual, variance, pct, paced, pacedPct };
      })
      .sort((a, b) => b.actual - a.actual),
    [systems, leadGenActuals, dateWindow.budgetMultiplier, view, paceFactor]
  );
  const recruitingRows = useMemo(() =>
    (recruitingSystems || [])
      .filter(s => Number(s.monthly_budget) > 0)
      .map(s => {
        const periodBudget = Number(s.monthly_budget) * dateWindow.budgetMultiplier;
        const actual = recruitingActuals[s.id] || 0;
        const variance = actual - periodBudget;
        const pct = periodBudget > 0 ? actual / periodBudget : 0;
        const paced = view === 'mtd' ? actual * paceFactor : actual;
        const pacedPct = periodBudget > 0 ? paced / periodBudget : 0;
        return { system: s, periodBudget, actual, variance, pct, paced, pacedPct };
      })
      .sort((a, b) => b.actual - a.actual),
    [recruitingSystems, recruitingActuals, dateWindow.budgetMultiplier, view, paceFactor]
  );

  const totalBudget = leadGenRows.reduce((s, r) => s + r.periodBudget, 0) + recruitingRows.reduce((s, r) => s + r.periodBudget, 0);
  const totalActual = leadGenRows.reduce((s, r) => s + r.actual, 0) + recruitingRows.reduce((s, r) => s + r.actual, 0);
  const totalVariance = totalActual - totalBudget;
  const totalPct = totalBudget > 0 ? totalActual / totalBudget : 0;

  const fmt = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  // Color/severity for a variance — green well-under, gold approaching,
  // amber over a little, red far over
  function severityFor(pct) {
    if (pct > 1.20) return { bar: 'var(--red)',    text: 'var(--red)',    label: 'far over' };
    if (pct > 1.00) return { bar: '#f59e0b',       text: '#f59e0b',       label: 'over' };
    if (pct > 0.90) return { bar: '#facc15',       text: 'var(--text-1)', label: 'at limit' };
    if (pct > 0.50) return { bar: 'var(--green)',  text: 'var(--text-1)', label: 'on track' };
    return                  { bar: 'var(--green)',  text: 'var(--text-2)', label: 'well under' };
  }

  const totalSev = severityFor(totalPct);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* Header: view selector */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
          {[
            { id: 'mtd',  label: 'This month' },
            { id: 'last', label: 'Last month' },
            { id: 'ytd',  label: 'YTD' },
          ].map(o => (
            <button key={o.id} onClick={() => setView(o.id)}
              style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
                background:view===o.id?'var(--accent)':'transparent',
                color:view===o.id?'var(--bg-base)':'var(--text-2)'}}>{o.label}</button>
          ))}
        </div>
        <div style={{fontSize:'11px',color:'var(--text-3)'}}>
          {dateWindow.label}
          {dateWindow.budgetMultiplier > 1 && <span style={{marginLeft:'6px'}}>· budget × {dateWindow.budgetMultiplier} months</span>}
        </div>
      </div>

      {/* HEADLINE — combined budget vs actual */}
      <div style={{
        padding:'16px',
        background: totalSev.bar === 'var(--red)' ? 'rgba(239,68,68,0.08)' : totalSev.bar === '#f59e0b' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)',
        border: `2px solid ${totalSev.bar}`,
        borderRadius:'12px',
      }}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
              Total {view === 'mtd' ? 'MTD' : view === 'last' ? 'last month' : 'YTD'}
            </div>
            <div style={{fontSize:'26px',fontWeight:800,color: totalSev.text,fontVariantNumeric:'tabular-nums',marginTop:'4px',lineHeight:1}}>
              {fmt(totalActual)} <span style={{fontSize:'14px',color:'var(--text-3)',fontWeight:600}}>/ {fmt(totalBudget)}</span>
            </div>
            <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'5px'}}>
              {totalVariance >= 0 ? '↑ over by ' : '↓ under by '}
              <strong style={{color: totalVariance >= 0 ? totalSev.text : 'var(--green)'}}>
                {fmt(Math.abs(totalVariance))} ({(totalPct * 100).toFixed(0)}%)
              </strong>
            </div>
          </div>
          {view === 'mtd' && paceFactor > 1.05 && (
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>On pace for</div>
              <div style={{fontSize:'18px',fontWeight:700,color: severityFor(totalActual * paceFactor / Math.max(1, totalBudget)).text,fontVariantNumeric:'tabular-nums',marginTop:'4px'}}>
                {fmt(totalActual * paceFactor)}
              </div>
              <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>by month-end</div>
            </div>
          )}
        </div>
        {/* Top-level progress bar */}
        <div style={{marginTop:'12px',height:'10px',background:'var(--bg-base)',borderRadius:'5px',overflow:'hidden',position:'relative'}}>
          <div style={{height:'100%',width: `${Math.min(100, totalPct * 100).toFixed(1)}%`,background: totalSev.bar,borderRadius:'5px',transition:'width 0.2s'}}/>
          {totalPct > 1 && (
            <div style={{position:'absolute',top:0,left:'100%',transform:'translateX(-1px)',width:'2px',height:'100%',background:'var(--text-1)'}}/>
          )}
        </div>
      </div>

      {loading && (
        <div style={{padding:'30px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
      )}

      {!loading && leadGenRows.length === 0 && recruitingRows.length === 0 && (
        <div style={{padding:'30px',textAlign:'center',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',color:'var(--text-3)'}}>
          <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:600,marginBottom:'4px'}}>No budgets set</div>
          <div style={{fontSize:'11.5px',fontStyle:'italic'}}>Add a <code style={{padding:'1px 5px',background:'var(--bg-hover)',borderRadius:'3px',fontSize:'10.5px'}}>monthly_budget</code> to any lead-gen or recruiting system to start seeing variance here.</div>
        </div>
      )}

      {/* LEAD-GEN section */}
      {!loading && leadGenRows.length > 0 && (
        <BudgetSection
          title="📈 Agent Lead Generation"
          subtitle="Per-system budget vs actual spend"
          rows={leadGenRows}
          rowPrefix="lg"
          expandedRow={expandedRow}
          setExpandedRow={setExpandedRow}
          txnsForExpanded={txnsForSystem}
          severityFor={severityFor}
          view={view}
          fmt={fmt}
        />
      )}

      {/* RECRUITING section */}
      {!loading && recruitingRows.length > 0 && (
        <BudgetSection
          title="🪪 Brokerage Operations & Recruiting"
          subtitle="Per-system budget vs actual spend"
          rows={recruitingRows}
          rowPrefix="r"
          expandedRow={expandedRow}
          setExpandedRow={setExpandedRow}
          txnsForExpanded={txnsForSystem}
          severityFor={severityFor}
          view={view}
          fmt={fmt}
        />
      )}

      {/* Boundary note */}
      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
        <div style={{fontWeight:700,color:'var(--text-2)',marginBottom:'4px',fontSize:'11.5px'}}>How to read this.</div>
        Actual rolls up every business-scope transaction tagged with the system in the selected period. Budgets come from each system's <code style={{padding:'1px 4px',background:'var(--bg-hover)',borderRadius:'3px',fontSize:'10.5px'}}>monthly_budget</code> field, multiplied by months in the period (for YTD). "On pace" projects MTD actual to month-end based on calendar days elapsed — useful early in the month when raw % can mislead. Systems with no budget are hidden; transactions with no system are not counted here.
      </div>
    </div>
  );
}

// One section (lead-gen or recruiting), reusable

export function CashFlowForecast({ userId, settings }) {
  const [horizonDays, setHorizonDays] = useState(90);  // 30 | 60 | 90
  const [useConfidenceWeighting, setUseConfidenceWeighting] = useState(true);
  const [recurring, setRecurring] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [cashBalance, setCashBalance] = useState(settings?.current_cash_balance ?? '');
  const [cashAsOf, setCashAsOf] = useState(settings?.current_cash_balance_as_of || new Date().toISOString().slice(0, 10));
  const [savingBalance, setSavingBalance] = useState(false);
  const [hoveredDay, setHoveredDay] = useState(null);

  // Pull open files + active recurring templates
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: rec }, { data: dls }] = await Promise.all([
        supabase.from('recurring_transactions').select('*')
          .eq('user_id', userId).eq('is_active', true),
        supabase.from('deals').select('id, name, client_name, address, status, gross_commission, net_commission, sale_price, commission_pct, close_date, contract_date, side')
          .eq('user_id', userId)
          .in('status', ['lead', 'active', 'under_contract', 'closing']),
      ]);
      if (cancelled) return;
      setRecurring(rec || []);
      setDeals(dls || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Refresh cash balance fields from settings if they change (e.g., after save)
  useEffect(() => {
    if (settings?.current_cash_balance != null) setCashBalance(String(settings.current_cash_balance));
    if (settings?.current_cash_balance_as_of) setCashAsOf(settings.current_cash_balance_as_of);
  }, [settings?.current_cash_balance, settings?.current_cash_balance_as_of]);

  // Project a recurring template forward through the horizon, returning
  // an array of {date, amount, payee} for every occurrence in window.
  function projectRecurring(template, fromDate, toDate) {
    const out = [];
    let cursor = new Date(template.next_run_date);
    const end = new Date(toDate);
    const start = new Date(fromDate);
    let safety = 200;  // avoid runaway loops
    while (cursor <= end && safety-- > 0) {
      if (cursor >= start) {
        out.push({
          date: cursor.toISOString().slice(0, 10),
          amount: Number(template.template_amount),
          payee: template.template_payee || 'Recurring',
          source: 'recurring',
          sourceId: template.id,
          confidence: 'high',
        });
      }
      // Advance by frequency
      const f = template.frequency;
      if (f === 'daily')       cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      else if (f === 'weekly') cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
      else if (f === 'biweekly') cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 14);
      else if (f === 'monthly') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      else if (f === 'quarterly') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 3, cursor.getDate());
      else if (f === 'yearly') cursor = new Date(cursor.getFullYear() + 1, cursor.getMonth(), cursor.getDate());
      else break;  // unknown frequency
    }
    return out;
  }

  // Estimate when a file will pay. Use close_date if set; otherwise
  // estimate from contract_date + 30 days (typical real estate close
  // window), else skip (no projectable date).
  function estimateDealClose(deal) {
    if (deal.close_date) return deal.close_date;
    if (deal.contract_date) {
      const d = new Date(deal.contract_date);
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  // Compute a file's expected commission to-agent in priority order
  function dealExpectedCommission(deal) {
    if (deal.net_commission != null && Number(deal.net_commission) > 0) return Number(deal.net_commission);
    if (deal.gross_commission != null && Number(deal.gross_commission) > 0) return Number(deal.gross_commission);
    if (deal.sale_price && deal.commission_pct) {
      return Number(deal.sale_price) * (Number(deal.commission_pct) / 100);
    }
    return 0;
  }

  // Confidence rolled up from DEAL_STATUS_CONFIDENCE (module-scope)

  // Build the full event list and the daily projection
  const { events, projection, summary } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const horizonEnd = new Date(today);
    horizonEnd.setDate(today.getDate() + horizonDays);
    const horizonISO = horizonEnd.toISOString().slice(0, 10);

    // Collect projected events
    const events = [];

    // Recurring transactions
    for (const r of recurring) {
      const occurrences = projectRecurring(r, todayISO, horizonISO);
      for (const o of occurrences) events.push(o);
    }

    // Open files
    for (const d of deals) {
      const closeDate = estimateDealClose(d);
      if (!closeDate || closeDate > horizonISO) continue;
      const rawAmount = dealExpectedCommission(d);
      if (rawAmount <= 0) continue;
      const probability = useConfidenceWeighting ? (DEAL_STATUS_PROBABILITY[d.status] ?? 1) : 1;
      const amount = rawAmount * probability;
      events.push({
        date: closeDate < todayISO ? todayISO : closeDate,  // overdue → bucket today
        amount,
        rawAmount,
        probability,
        payee: d.name || d.client_name || d.address || `File ${d.id.slice(0, 8)}`,
        source: 'deal',
        sourceId: d.id,
        sourceStatus: d.status,
        confidence: DEAL_STATUS_CONFIDENCE[d.status] || 'low',
        dealEstimate: !d.close_date,  // flagged if we estimated the close date
      });
    }

    // Sort events chronologically
    events.sort((a, b) => a.date.localeCompare(b.date));

    // Build the daily projection
    const hasBalance = cashBalance !== '' && !Number.isNaN(Number(cashBalance));
    const startBalance = hasBalance ? Number(cashBalance) : 0;
    const balanceStartDate = cashAsOf || todayISO;

    // Start from the as-of balance, walk forward day by day. If as-of is
    // in the past, we walk from there; chart still only shows future.
    const projection = [];
    let running = startBalance;
    const allDates = [];
    const startWalk = new Date(Math.min(new Date(balanceStartDate), today));
    startWalk.setHours(0, 0, 0, 0);

    // Index events by date for O(1) lookup
    const eventsByDate = {};
    for (const e of events) {
      (eventsByDate[e.date] ||= []).push(e);
    }

    let cursor = new Date(startWalk);
    while (cursor <= horizonEnd) {
      const iso = cursor.toISOString().slice(0, 10);
      const dayEvents = eventsByDate[iso] || [];
      const dayIn = dayEvents.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
      const dayOut = dayEvents.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
      running = running + dayIn - dayOut;
      // Only push days from today forward into the chart
      if (cursor >= today) {
        allDates.push(iso);
        projection.push({
          date: iso,
          balance: running,
          dayIn, dayOut,
          dayNet: dayIn - dayOut,
          eventCount: dayEvents.length,
          events: dayEvents,
        });
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }

    // Summary stats
    const totalIn = events.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const totalOut = events.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
    const netChange = totalIn - totalOut;
    const minBalance = projection.length ? Math.min(...projection.map(p => p.balance)) : startBalance;
    const minBalanceDay = projection.find(p => p.balance === minBalance);
    const endBalance = projection.length ? projection[projection.length - 1].balance : startBalance;
    const firstNegativeDay = projection.find(p => p.balance < 0);

    return {
      events, projection,
      summary: {
        hasBalance, startBalance, totalIn, totalOut, netChange,
        minBalance, minBalanceDay, endBalance, firstNegativeDay,
        eventCount: events.length,
      },
    };
  }, [recurring, deals, horizonDays, cashBalance, cashAsOf, useConfidenceWeighting]);

  async function saveBalance() {
    setSavingBalance(true);
    const { error } = await supabase.from('finance_settings')
      .update({
        current_cash_balance: cashBalance === '' ? null : Number(cashBalance),
        current_cash_balance_as_of: cashAsOf || null,
      })
      .eq('user_id', userId);
    setSavingBalance(false);
    if (error) {
      if (window.__notify) window.__notify('Save failed: ' + error.message, 'error');
      return;
    }
    if (window.__notify) window.__notify('Balance saved', 'success');
    setShowSettings(false);
  }

  const fmt = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const fmtDateShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // ── SVG chart sizing ──────────────────────────────────────────────
  const chartW = 720;  // virtual width — SVG scales to viewBox
  const chartH = 180;
  const padL = 50, padR = 12, padT = 12, padB = 24;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const chartData = projection;
  const balances = chartData.map(p => p.balance);
  const minY = Math.min(0, ...balances);   // always include zero
  const maxY = Math.max(0, ...balances);
  const yRange = Math.max(1, maxY - minY);
  const xFor = (i) => padL + (chartData.length > 1 ? (i / (chartData.length - 1)) * plotW : plotW / 2);
  const yFor = (val) => padT + plotH - ((val - minY) / yRange) * plotH;
  const zeroY = yFor(0);

  // Path data for the balance line (only if we have a balance to project)
  const pathData = summary.hasBalance && chartData.length > 0
    ? chartData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(p.balance).toFixed(2)}`).join(' ')
    : '';

  // Fill area beneath line (green above zero, red below)
  const areaData = summary.hasBalance && chartData.length > 0
    ? `${pathData} L ${xFor(chartData.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L ${xFor(0).toFixed(2)} ${zeroY.toFixed(2)} Z`
    : '';

  // X-axis tick positions — every ~15 days for 90d, every ~10 for 60d, etc.
  const xTickStep = Math.max(1, Math.floor(chartData.length / 6));
  const xTicks = [];
  for (let i = 0; i < chartData.length; i += xTickStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== chartData.length - 1) xTicks.push(chartData.length - 1);

  // Y-axis tick values
  const yTickCount = 4;
  const yTicks = [];
  for (let i = 0; i <= yTickCount; i++) yTicks.push(minY + (yRange * i / yTickCount));

  // Group events into the upcoming-events list, by week-of bucket
  const eventGroups = useMemo(() => {
    const groups = {};
    for (const e of events) {
      const d = new Date(e.date + 'T00:00:00');
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
      const weekKey = monday.toISOString().slice(0, 10);
      (groups[weekKey] ||= { weekStart: weekKey, items: [], net: 0 }).items.push(e);
      groups[weekKey].net += e.amount;
    }
    return Object.values(groups).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }, [events]);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px'}}>
            {[30, 60, 90].map(d => (
              <button key={d} onClick={() => setHorizonDays(d)}
                style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
                  background:horizonDays===d?'var(--accent)':'transparent',
                  color:horizonDays===d?'var(--bg-base)':'var(--text-2)'}}>{d} days</button>
            ))}
          </div>
          <label title="Apply probability factors to pipeline income by deal stage (closing 90%, under_contract 75%, active 35%, lead 15%). Reflects typical fall-through rates so you don't budget around the optimistic scenario."
            style={{display:'flex',alignItems:'center',gap:'5px',cursor:'pointer',fontSize:'11px',color:'var(--text-2)',padding:'4px 8px',border:'1px solid var(--border)',borderRadius:'6px',background:useConfidenceWeighting?'rgba(197,169,94,0.08)':'transparent'}}>
            <input type="checkbox" checked={useConfidenceWeighting} onChange={e => setUseConfidenceWeighting(e.target.checked)}
              style={{cursor:'pointer',margin:0}}/>
            <span style={{fontWeight:700,color:useConfidenceWeighting?'var(--accent)':'var(--text-2)'}}><Icon name="scale" size={14} /> Confidence-weighted</span>
          </label>
        </div>
        <button onClick={() => setShowSettings(s => !s)}
          style={{padding:'5px 12px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>
          <Icon name="dollar" size={13} /> Cash balance{summary.hasBalance ? `: ${fmt(summary.startBalance)}` : ': not set'}
        </button>
      </div>

      {/* Settings inline */}
      {showSettings && (
        <div style={{padding:'12px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'8px'}}>Cash position</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
            <div>
              <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'3px'}}>Current cash balance</label>
              <div style={{position:'relative'}}>
                <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
                <input type="number" step="0.01" value={cashBalance} onChange={e => setCashBalance(e.target.value)}
                  placeholder="0.00"
                  style={{width:'100%',padding:'6px 8px 6px 20px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'12px',outline:'none'}}/>
              </div>
            </div>
            <div>
              <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'3px'}}>As of</label>
              <input type="date" value={cashAsOf} onChange={e => setCashAsOf(e.target.value)}
                style={{width:'100%',padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'12px',outline:'none'}}/>
            </div>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'10px',fontStyle:'italic',lineHeight:1.5}}>
            Total liquid cash across whatever accounts you're tracking. Without this set, the chart shows cumulative net activity instead of balance.
          </div>
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
            <button onClick={() => setShowSettings(false)} className="btn btn-ghost btn-sm">Cancel</button>
            <button onClick={saveBalance} disabled={savingBalance} className="btn btn-primary btn-sm">{savingBalance ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:'8px'}}>
        <KpiBox label="Projected end balance" value={summary.hasBalance ? fmt(summary.endBalance) : fmt(summary.netChange)}
          sub={summary.hasBalance ? `in ${horizonDays} days` : `net change · ${horizonDays}d`}
          color={summary.hasBalance ? (summary.endBalance >= 0 ? 'var(--green)' : 'var(--red)') : (summary.netChange >= 0 ? 'var(--green)' : 'var(--red)')}/>
        <KpiBox label="Expected income" value={fmt(summary.totalIn)} sub={`from ${deals.length} open files + recurring`} color="var(--green)"/>
        <KpiBox label="Expected outflows" value={fmt(summary.totalOut)} sub={`from recurring transactions`} color="var(--red)"/>
        {summary.hasBalance && summary.firstNegativeDay ? (
          <KpiBox label="⚠ Cash runs out" value={fmtDateShort(summary.firstNegativeDay.date)}
            sub={`balance hits ${fmt(summary.firstNegativeDay.balance)}`} color="var(--red)"/>
        ) : summary.hasBalance ? (
          <KpiBox label="Lowest point" value={fmt(summary.minBalance)}
            sub={summary.minBalanceDay ? `on ${fmtDateShort(summary.minBalanceDay.date)}` : '—'}
            color={summary.minBalance < 0 ? 'var(--red)' : summary.minBalance < summary.startBalance * 0.25 ? '#f59e0b' : 'var(--text-1)'}/>
        ) : (
          <KpiBox label="Events" value={summary.eventCount} sub={`across ${horizonDays} days`}/>
        )}
      </div>

      {/* Chart panel */}
      <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'10px'}}>
          <div style={{fontSize:'12px',color:'var(--text-1)',fontWeight:700}}>
            {summary.hasBalance ? 'Projected daily balance' : 'Cumulative net activity'}
          </div>
          {hoveredDay && (
            <div style={{fontSize:'11px',color:'var(--text-2)'}}>
              <span style={{color:'var(--text-3)'}}>{fmtDateShort(hoveredDay.date)}: </span>
              <strong style={{color: hoveredDay.balance < 0 ? 'var(--red)' : 'var(--text-1)'}}>{fmt(hoveredDay.balance)}</strong>
              {hoveredDay.eventCount > 0 && <span style={{color:'var(--text-3)',marginLeft:'6px'}}>· {hoveredDay.eventCount} event{hoveredDay.eventCount===1?'':'s'}</span>}
            </div>
          )}
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
        ) : chartData.length === 0 ? (
          <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>
            No projected activity in the next {horizonDays} days. Add recurring transactions or open deals to populate the forecast.
          </div>
        ) : (
          <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:'100%',height:'auto',display:'block'}} preserveAspectRatio="none">
            {/* Y-axis gridlines + labels */}
            {yTicks.map((v, i) => (
              <g key={`y${i}`}>
                <line x1={padL} y1={yFor(v)} x2={chartW - padR} y2={yFor(v)} stroke="var(--border)" strokeWidth="0.5"/>
                <text x={padL - 4} y={yFor(v) + 3} textAnchor="end" fontSize="9" fill="var(--text-3)">
                  ${Math.round(v).toLocaleString()}
                </text>
              </g>
            ))}
            {/* Zero line emphasized */}
            <line x1={padL} y1={zeroY} x2={chartW - padR} y2={zeroY} stroke="var(--text-3)" strokeWidth="1" strokeDasharray="2 2"/>
            {/* Area fill */}
            {summary.hasBalance && areaData && (
              <>
                <defs>
                  <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="var(--green)" stopOpacity="0.02"/>
                  </linearGradient>
                </defs>
                <path d={areaData} fill="url(#gradGreen)"/>
              </>
            )}
            {/* Balance line */}
            {pathData && (
              <path d={pathData} fill="none" stroke="var(--accent)" strokeWidth="2"/>
            )}
            {/* Negative segments overlay in red */}
            {summary.hasBalance && chartData.map((p, i) => {
              if (i === 0) return null;
              const prev = chartData[i - 1];
              if (p.balance >= 0 && prev.balance >= 0) return null;
              return (
                <line key={`neg${i}`}
                  x1={xFor(i - 1)} y1={yFor(prev.balance)}
                  x2={xFor(i)} y2={yFor(p.balance)}
                  stroke="var(--red)" strokeWidth="2"/>
              );
            })}
            {/* Event markers */}
            {chartData.map((p, i) => p.eventCount > 0 && (
              <circle key={`m${i}`} cx={xFor(i)} cy={yFor(p.balance)} r="2.5"
                fill={p.dayNet >= 0 ? 'var(--green)' : 'var(--red)'} stroke="var(--bg-card)" strokeWidth="1"/>
            ))}
            {/* Hover hit areas */}
            {chartData.map((p, i) => (
              <rect key={`h${i}`}
                x={xFor(i) - (plotW / chartData.length / 2)}
                y={padT}
                width={plotW / chartData.length}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => { if (!canHover()) return; setHoveredDay(p); }}
                onMouseLeave={() => setHoveredDay(null)}/>
            ))}
            {/* X-axis tick labels */}
            {xTicks.map(i => (
              <text key={`x${i}`} x={xFor(i)} y={chartH - 6} textAnchor="middle" fontSize="9" fill="var(--text-3)">
                {fmtDateShort(chartData[i].date)}
              </text>
            ))}
          </svg>
        )}
        {!summary.hasBalance && (
          <div style={{marginTop:'8px',padding:'8px 10px',background:'rgba(245,158,11,0.08)',border:'1px solid #f59e0b',borderRadius:'6px',fontSize:'10.5px',color:'var(--text-2)'}}>
            <Icon name="bulb" size={13} style={{verticalAlign:'-2px'}} /> Set your current cash balance above to see projected end-of-period balance and "cash runs out" warnings.
          </div>
        )}
      </div>

      {/* Upcoming events list */}
      {!loading && events.length > 0 && (
        <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'12px',color:'var(--text-1)',fontWeight:700,marginBottom:'10px'}}>
            Upcoming events · {events.length} total
          </div>
          {eventGroups.slice(0, 8).map(g => {
            const weekDate = new Date(g.weekStart + 'T00:00:00');
            const weekEnd = new Date(weekDate); weekEnd.setDate(weekDate.getDate() + 6);
            return (
              <div key={g.weekStart} style={{marginBottom:'10px'}}>
                <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid var(--border)',marginBottom:'4px'}}>
                  <span style={{fontSize:'10.5px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
                    Week of {fmtDateShort(g.weekStart)}
                  </span>
                  <span style={{fontSize:'11px',color: g.net >= 0 ? 'var(--green)' : 'var(--red)',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>
                    net {g.net >= 0 ? '+' : '−'}{fmt(Math.abs(g.net))}
                  </span>
                </div>
                {g.items.map((e, i) => (
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',fontSize:'11.5px',gap:'8px'}}>
                    <span style={{color:'var(--text-3)',fontVariantNumeric:'tabular-nums',flexShrink:0,minWidth:'48px'}}>{fmtDateShort(e.date)}</span>
                    <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text-2)'}}>
                      {e.payee}
                      {e.source === 'deal' && (
                        <span style={{fontSize:'9px',color:'var(--text-3)',marginLeft:'6px',padding:'1px 5px',background:'var(--bg-hover)',borderRadius:'3px',fontWeight:600}}>
                          {e.sourceStatus}{e.dealEstimate ? ' · est.' : ''}{useConfidenceWeighting && e.probability < 1 ? ` · ${Math.round(e.probability*100)}%` : ''}
                        </span>
                      )}
                      {e.source === 'recurring' && (
                        <span style={{fontSize:'9px',color:'var(--text-3)',marginLeft:'6px',padding:'1px 5px',background:'var(--bg-hover)',borderRadius:'3px',fontWeight:600}}>
                          recurring
                        </span>
                      )}
                    </span>
                    <span style={{flexShrink:0,textAlign:'right',lineHeight:1.2}}>
                      <span style={{fontVariantNumeric:'tabular-nums',fontWeight:700,color: e.amount >= 0 ? 'var(--green)' : 'var(--red)'}}>
                        {e.amount >= 0 ? '+' : '−'}{fmt(Math.abs(e.amount))}
                      </span>
                      {e.source === 'deal' && useConfidenceWeighting && e.probability < 1 && (
                        <div style={{fontSize:'9px',color:'var(--text-3)',fontVariantNumeric:'tabular-nums'}}>
                          of {fmt(e.rawAmount)} raw
                        </div>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {eventGroups.length > 8 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center',marginTop:'8px'}}>
              + {eventGroups.length - 8} more week{eventGroups.length - 8 === 1 ? '' : 's'} of activity beyond
            </div>
          )}
        </div>
      )}

      {/* Boundary note */}
      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
        <div style={{fontWeight:700,color:'var(--text-2)',marginBottom:'4px',fontSize:'11.5px'}}>How this projection is built.</div>
        Recurring transactions are projected forward from their <code style={{padding:'1px 4px',background:'var(--bg-hover)',borderRadius:'3px',fontSize:'10px'}}>next_run_date</code> by frequency. Open files contribute expected commission income on their close_date (or contract_date + 30 days if no close set, flagged "est."). With <strong>confidence weighting</strong> on (default), each file is discounted by typical fall-through rates: closing 90%, under_contract 75%, active 35%, lead 15%. Toggle off to see the raw optimistic case. Projection does NOT include: unplanned expenses, manual one-off items, taxes (see Quarterly Tax tab), or transactions you log directly after this forecast loads.
      </div>
    </div>
  );
}

export function FinanceBlueprint({
  userId, settings, setSettings, personalBudget, setPersonalBudget,
  taxCategories, setTaxCategories, systems, timeEntries = [], reload, readOnly, isCoach, maxSystems,
}) {
  const [saving, setSaving] = useState(false);
  const [addingPersonal, setAddingPersonal] = useState(false);
  const [pDraft, setPDraft] = useState({ category: '', kind: 'regular', amount: '' });
  const [addingBiz, setAddingBiz] = useState(false);
  const [bDraft, setBDraft] = useState({ name: '', description: '', monthly_budget: '', schedule_c_line: '—' });

  const personalAnnual = personalBudget.reduce((sum, line) => {
    if (line.is_vacation) return sum + Number(line.annual_amount || 0);
    if (line.is_savings) return sum + Number(line.annual_amount || (Number(line.monthly_amount || 0) * 12));
    return sum + Number(line.monthly_amount || 0) * 12;
  }, 0);

  // Advertising & Marketing is auto-rolled from systems (NOT from tax_categories.monthly_budget).
  // Other 9 tax categories are agent-set.
  const advertisingCat = taxCategories.find(c => /advert/i.test(c.name));
  const systemsMonthlyTotal = systems.reduce((s, sys) => s + Number(sys.monthly_budget || 0), 0);
  const nonAdvBusinessMonthly = taxCategories
    .filter(c => c.id !== advertisingCat?.id)
    .reduce((s, c) => s + Number(c.monthly_budget || 0), 0);
  const businessAnnual = (systemsMonthlyTotal + nonAdvBusinessMonthly) * 12;
  const prorata = getProrata(settings);

  const grandTotalNeed = personalAnnual + businessAnnual;
  const taxPct = Number(settings?.estimated_tax_pct) || 0.25;
  const grossNeeded = grandTotalNeed / (1 - taxPct);
  const gciGoal = grossNeeded;
  const gciPerTxn = Number(settings?.avg_transaction_price || 0) * Number(settings?.avg_commission_pct || 0) * Number(settings?.broker_split_pct || 0);
  const txnsNeeded = gciPerTxn > 0 ? Math.ceil(gciGoal / gciPerTxn) : 0;
  const rates = { signedToClose: 0.85, apptToSigned: 0.60, convoToAppt: 0.20, leadToConvo: 0.30 };
  const signedNeeded = Math.ceil(txnsNeeded / rates.signedToClose);
  const apptsNeeded  = Math.ceil(signedNeeded / rates.apptToSigned);
  const convosNeeded = Math.ceil(apptsNeeded  / rates.convoToAppt);
  const leadsNeeded  = Math.ceil(convosNeeded / rates.leadToConvo);
  const weeklyLeads  = Math.ceil(leadsNeeded / 48);

  // Prospecting hourly value: GCI goal ÷ prospecting hours/week ÷ 48 weeks.
  const prospectHours = Number(settings?.prospecting_hours_per_week) || 0;
  const prospectHourlyValue = prospectHours > 0 ? gciGoal / (prospectHours * 48) : 0;
  async function saveProspectHours(v) {
    if (readOnly) return;
    const hrs = Math.max(0, Number(v) || 0);
    const rate = hrs > 0 ? Math.round((gciGoal / (hrs * 48)) * 100) / 100 : 0;
    await updateSetting({ prospecting_hours_per_week: hrs, hourly_rate: rate });
    if (window.__notify) window.__notify(hrs > 0 ? `Prospecting hour valued at ${fmtUSD(rate)}/hr` : 'Prospecting hours cleared', 'success');
  }
  async function updateBudgetLine(id, patch) {
    if (readOnly) return;
    setPersonalBudget(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
    await supabase.from('personal_budget_lines').update(patch).eq('id', id);
  }
  async function updateTaxCatBudget(id, monthly_budget) {
    if (readOnly) return;
    setTaxCategories(prev => prev.map(c => c.id === id ? { ...c, monthly_budget } : c));
    await supabase.from('tax_categories').update({ monthly_budget }).eq('id', id);
  }
  // ── Personal category CRUD ──────────────────────────────────────────
  async function addPersonalLine() {
    if (readOnly) return;
    const category = (pDraft.category || '').trim();
    if (!category) return;
    const isSav = pDraft.kind === 'savings', isVac = pDraft.kind === 'vacation';
    const usesAnnual = isSav || isVac;
    const amt = Number(pDraft.amount) || 0;
    const sort = Math.max(0, ...personalBudget.map(l => Number(l.sort_order) || 0)) + 1;
    const row = { user_id: userId, category, is_savings: isSav, is_vacation: isVac,
      monthly_amount: usesAnnual ? 0 : amt, annual_amount: usesAnnual ? amt : null, sort_order: sort, is_archived: false };
    const { data, error } = await supabase.from('personal_budget_lines').insert(row).select().single();
    if (!error && data) {
      setPersonalBudget(prev => [...prev, data]);
      setPDraft({ category: '', kind: 'regular', amount: '' });
      setAddingPersonal(false);
      if (window.__notify) window.__notify('Personal category added', 'success');
    } else if (window.__notify) window.__notify('Could not add category', 'error');
  }
  async function savePersonalLabel(id, category) {
    setPersonalBudget(prev => prev.map(l => l.id === id ? { ...l, category } : l));
    await supabase.from('personal_budget_lines').update({ category }).eq('id', id);
  }
  async function deletePersonalLine(line) {
    if (readOnly) return;
    if (!await confirmDialog(`Delete "${line.category}" from your personal budget? It is a planning input only — no recorded transactions are affected.`, { confirmLabel: 'Delete' })) return;
    setPersonalBudget(prev => prev.filter(l => l.id !== line.id));
    await supabase.from('personal_budget_lines').update({ is_archived: true }).eq('id', line.id);
    if (window.__notify) window.__notify(`"${line.category}" removed`, 'success');
  }
  // ── Business category CRUD ──────────────────────────────────────────
  async function addBusinessCat() {
    if (readOnly) return;
    const name = (bDraft.name || '').trim();
    if (!name) return;
    const sort = Math.max(0, ...taxCategories.filter(c => (Number(c.sort_order) || 0) < 99999).map(c => Number(c.sort_order) || 0)) + 1;
    const row = { user_id: userId, name, description: (bDraft.description || '').trim() || null,
      monthly_budget: Number(bDraft.monthly_budget) || 0, schedule_c_line: bDraft.schedule_c_line || '—',
      color: '#C5A95E', sort_order: sort, is_archived: false, is_locked: false, is_auto: false, deduction_pct: 1 };
    const { data, error } = await supabase.from('tax_categories').insert(row).select().single();
    if (!error && data) {
      setTaxCategories(prev => [...prev, data].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)));
      setBDraft({ name: '', description: '', monthly_budget: '', schedule_c_line: '—' });
      setAddingBiz(false);
      if (window.__notify) window.__notify('Business category added', 'success');
    } else if (window.__notify) window.__notify('Could not add category', 'error');
  }
  async function saveBusinessMeta(id, patch) {
    setTaxCategories(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    await supabase.from('tax_categories').update(patch).eq('id', id);
  }
  async function deleteBusinessCat(cat) {
    if (readOnly) return;
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('tax_category_id', cat.id);
    const n = count || 0;
    const other = taxCategories.find(c => c.name === 'Other Business Expenses' && !c.is_archived && c.id !== cat.id);
    let msg = `Remove "${cat.name}" from your chart of accounts?`;
    if (n > 0 && other) msg += ` Its ${n} recorded transaction${n > 1 ? 's' : ''} will be moved to "Other Business Expenses" so your deductions are preserved.`;
    else if (n > 0) msg += ` It has ${n} recorded transaction${n > 1 ? 's' : ''}; the category will be archived but those transactions keep pointing to it.`;
    if (!await confirmDialog(msg, { confirmLabel: 'Delete' })) return;
    if (n > 0 && other) await supabase.from('transactions').update({ tax_category_id: other.id }).eq('user_id', userId).eq('tax_category_id', cat.id);
    await supabase.from('tax_categories').update({ is_archived: true }).eq('id', cat.id);
    setTaxCategories(prev => prev.filter(c => c.id !== cat.id));
    if (window.__notify) window.__notify(`"${cat.name}" removed`, 'success');
  }
  async function updateSetting(patch) {
    if (readOnly) return;
    setSettings(prev => ({ ...prev, ...patch }));
    await supabase.from('finance_settings').update(patch).eq('user_id', userId);
  }
  async function saveBlueprint() {
    if (readOnly) return;
    setSaving(true);
    const hrs = Number(settings?.prospecting_hours_per_week) || 0;
    const rate = hrs > 0 ? Math.round((gciGoal / (hrs * 48)) * 100) / 100 : (Number(settings?.hourly_rate) || 0);
    await updateSetting({ annual_gci_goal: Math.round(gciGoal), hourly_rate: rate });
    setSaving(false);
    if (window.__notify) window.__notify(`Blueprint saved · GCI goal: ${fmtUSD(gciGoal)}`, 'success');
  }

  const trackPersonal = !!(settings?.track_personal);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      <div className="panel" style={{padding:'14px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:'200px'}}>
          <div style={{fontSize:'13px',color:'var(--text-1)',fontWeight:600}}>Also track personal expenses?</div>
          <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px',lineHeight:1.4}}>
            Off (default): Ledger is business-only. On: personal scope appears, and a separate Personal report unlocks.
          </div>
        </div>
        <label style={{display:'inline-flex',alignItems:'center',gap:'8px',cursor:readOnly?'default':'pointer',padding:'8px 12px',background:'var(--bg-hover)',borderRadius:'8px'}}>
          <input type="checkbox" checked={trackPersonal} disabled={readOnly}
            onChange={e => updateSetting({ track_personal: e.target.checked })}
            style={{width:'18px',height:'18px',cursor:readOnly?'default':'pointer'}}/>
          <span style={{fontSize:'12px',fontWeight:700,color:trackPersonal?'var(--accent)':'var(--text-2)'}}>{trackPersonal ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      {isCoach && (
        <div className="panel" style={{padding:'14px'}}>
          <h3 style={{margin:'0 0 8px',fontSize:'14px',color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="target" size={14} /> Coach controls</h3>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <label style={{fontSize:'12px',color:'var(--text-2)'}}>Max active systems allowed:</label>
            <input type="number" min="1" max="35" step="1" value={maxSystems}
              onChange={e => updateSetting({ max_systems_allowed: Math.max(1, Number(e.target.value) || 5) })}
              style={{width:'70px',padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',textAlign:'center',fontVariantNumeric:'tabular-nums'}}/>
            <span style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>Agents default to 5. Coach can raise.</span>
          </div>
        </div>
      )}

      <div className="panel" style={{padding:'16px',background:'linear-gradient(135deg, rgba(197,169,94,0.08) 0%, rgba(197,169,94,0.02) 100%)',border:'1px solid var(--accent)'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:'6px'}}>Your required GCI</div>
        <div style={{fontSize:'32px',fontWeight:800,color:'var(--accent)',fontVariantNumeric:'tabular-nums'}}>{fmtUSD(gciGoal)}</div>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'4px',lineHeight:1.5}}>
          To net <strong>{fmtUSD(grandTotalNeed)}</strong> after {fmtPct(taxPct, 0)} tax · requires <strong>{txnsNeeded} closed deals</strong>
        </div>
        {prorata.active && (
          <div style={{fontSize:'11px',color:'var(--accent)',marginTop:'6px',fontWeight:600,lineHeight:1.5}}>
            First year (pro-rated to {prorata.pct}% from {prorata.startLabel}): target <strong>{fmtUSD(gciGoal * prorata.factor)}</strong> · ~{Math.max(1, Math.round(txnsNeeded * prorata.factor))} closed deals
          </div>
        )}
        {!readOnly && (
          <div style={{marginTop:'10px',display:'flex',gap:'12px',flexWrap:'wrap'}}>
            <button className="btn btn-primary btn-sm" onClick={saveBlueprint} disabled={saving}>
              {saving ? 'Saving…' : <><Icon name="save" size={13} /> Save as goal</>}
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{padding:'14px'}}>
        <h3 style={{margin:'0 0 4px',fontSize:'14px',color:'var(--text-1)'}}>Personal expenses</h3>
        <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 12px'}}>
          Budget inputs only — drive the GCI calculation above. {!trackPersonal && <em>You won't enter these as daily transactions unless personal tracking is on.</em>}
        </p>
        <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
          {personalBudget.filter(l => !l.is_archived).map(line => (
            <PersonalBudgetRow key={line.id} line={line} onChangeAmount={updateBudgetLine}
              onSaveLabel={savePersonalLabel} onDelete={deletePersonalLine} readOnly={readOnly} />
          ))}
        </div>
        {!readOnly && (addingPersonal ? (
          <div style={bpAddWrap}>
            <input autoFocus placeholder="Category name (e.g. Gym)" value={pDraft.category}
              onChange={e => setPDraft(d => ({ ...d, category: e.target.value }))} style={bpInput}/>
            <div style={{display:'flex',gap:'8px'}}>
              <select value={pDraft.kind} onChange={e => setPDraft(d => ({ ...d, kind: e.target.value }))} style={{...bpInput, flex:1}}>
                <option value="regular">Monthly expense</option>
                <option value="savings">Savings (annual target)</option>
                <option value="vacation">Vacation (annual budget)</option>
              </select>
              <input type="number" placeholder={pDraft.kind === 'regular' ? '$/mo' : '$/yr'} value={pDraft.amount}
                onChange={e => setPDraft(d => ({ ...d, amount: e.target.value }))} style={{...bpInput, width:'92px'}}/>
            </div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAddingPersonal(false); setPDraft({ category: '', kind: 'regular', amount: '' }); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={addPersonalLine}>Add</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={() => setAddingPersonal(true)}>+ Add personal category</button>
        ))}
        <div style={{marginTop:'12px',padding:'10px 12px',background:'var(--bg-base)',borderRadius:'8px',display:'flex',justifyContent:'space-between'}}>
          <span style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Personal annual{prorata.active ? ' · first-yr' : ''}</span>
          <span style={{fontSize:'14px',color:'var(--text-1)',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{fmtUSD(prorata.active ? personalAnnual * prorata.factor : personalAnnual)}</span>
        </div>
      </div>

      <div className="panel" style={{padding:'14px'}}>
        <h3 style={{margin:'0 0 4px',fontSize:'14px',color:'var(--text-1)'}}>Business expenses (Chart of Accounts)</h3>
        <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 12px'}}>
          Monthly budget per tax category — what you expect to spend running your business. Advertising & Marketing is auto-calculated as the sum of your lead-gen system budgets (edit those in the Systems tab).
        </p>
        <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
          {taxCategories.filter(c => !c.is_archived && c.name !== 'Time Value').map(cat => (
            <TaxCatRow key={cat.id} cat={cat} isAdv={cat.id === advertisingCat?.id} advValue={systemsMonthlyTotal}
              onChangeBudget={updateTaxCatBudget} onSaveMeta={saveBusinessMeta} onDelete={deleteBusinessCat} readOnly={readOnly} />
          ))}
        </div>
        {!readOnly && (addingBiz ? (
          <div style={bpAddWrap}>
            <input autoFocus placeholder="Category name (e.g. Coaching)" value={bDraft.name}
              onChange={e => setBDraft(d => ({ ...d, name: e.target.value }))} style={bpInput}/>
            <input placeholder="Description (optional)" value={bDraft.description}
              onChange={e => setBDraft(d => ({ ...d, description: e.target.value }))} style={bpInput}/>
            <div style={{display:'flex',gap:'8px'}}>
              <select value={bDraft.schedule_c_line} onChange={e => setBDraft(d => ({ ...d, schedule_c_line: e.target.value }))} style={{...bpInput, flex:1}}>
                {BIZ_CAT_LINES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <input type="number" placeholder="$/mo" value={bDraft.monthly_budget}
                onChange={e => setBDraft(d => ({ ...d, monthly_budget: e.target.value }))} style={{...bpInput, width:'92px'}}/>
            </div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAddingBiz(false); setBDraft({ name: '', description: '', monthly_budget: '', schedule_c_line: '—' }); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={addBusinessCat}>Add</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={() => setAddingBiz(true)}>+ Add business category</button>
        ))}
        <div style={{marginTop:'12px',padding:'10px 12px',background:'var(--bg-base)',borderRadius:'8px',display:'flex',justifyContent:'space-between'}}>
          <span style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Business annual{prorata.active ? ' · first-yr' : ''}</span>
          <span style={{fontSize:'14px',color:'var(--text-1)',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{fmtUSD(prorata.active ? businessAnnual * prorata.factor : businessAnnual)}</span>
        </div>
      </div>

      {/* TIME VALUE — non-deductible KPI: prospecting hours committed vs actually logged, each valued at the hourly rate. */}
      {(() => {
        const hourlyRate = Number(settings?.hourly_rate || 0);
        const committedPerWeek = Number(settings?.prospecting_hours_per_week || 0);
        const pr = getProrata(settings);
        const WEEKS = 48 * pr.factor;
        const committedAnnualHours = committedPerWeek * WEEKS;
        const committedAnnualValue = committedAnnualHours * hourlyRate;
        const now = new Date();
        const weeksElapsed = Math.min(WEEKS, Math.max(0, (now - pr.activeStart) / (7 * 24 * 3600 * 1000)));
        const committedToDateHours = committedPerWeek * weeksElapsed;
        const committedToDateValue = committedToDateHours * hourlyRate;
        const loggedMinutes = (timeEntries || []).reduce((sum, te) => sum + Number(te.minutes || 0), 0);
        const loggedHours = loggedMinutes / 60;
        const loggedValue = loggedHours * hourlyRate;
        const pct = committedToDateHours > 0 ? loggedHours / committedToDateHours : 0;
        const aheadHours = loggedHours - committedToDateHours;
        const onTrack = pct >= 0.95;
        const ready = hourlyRate > 0 && committedPerWeek > 0;
        return (
          <div className="panel" style={{padding:'16px',border:'1px solid var(--accent)',background:'linear-gradient(135deg, rgba(197,169,94,0.07), rgba(197,169,94,0.01))'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',flexWrap:'wrap'}}>
              <Icon name="clock" size={15} style={{color:'var(--accent)'}} />
              <h3 style={{margin:0,fontSize:'14px',color:'var(--text-1)'}}>Time Value</h3>
              <span style={{fontSize:'9px',color:'var(--accent)',padding:'2px 6px',background:'rgba(197,169,94,0.12)',borderRadius:'3px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>KPI · non-deductible</span>
            </div>
            <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 14px',lineHeight:1.5}}>
              The true cost of prospecting isn't only cash — it's your time. This compares the hours you <strong>committed</strong> to prospecting against the hours you've <strong>actually logged</strong>, each valued at your hourly rate{ready ? <> of <strong style={{color:'var(--accent)'}}>{fmtUSD(hourlyRate)}/hr</strong></> : ''}. It is never a cash expense and never touches your taxes.
            </p>
            {!ready ? (
              <div style={{padding:'12px',background:'var(--bg-base)',borderRadius:'8px',fontSize:'12px',color:'var(--text-2)',lineHeight:1.5}}>
                Set <strong>Prospecting hours / week</strong> in Strategy inputs below to activate this KPI. Together with your GCI goal, it sets the hourly value of your time.
              </div>
            ) : (
              <>
                <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
                  <div style={bpKpiCol}>
                    <div style={bpKpiLabel}>Committed (year-to-date)</div>
                    <div style={{...bpKpiNum, color:'var(--text-1)'}}>{fmtUSD(committedToDateValue)}</div>
                    <div style={bpKpiSub}>{committedToDateHours.toFixed(1)} hrs · {committedPerWeek}/wk pace</div>
                  </div>
                  <div style={bpKpiCol}>
                    <div style={bpKpiLabel}>Logged (actual)</div>
                    <div style={{...bpKpiNum, color: onTrack ? 'var(--green)' : 'var(--accent)'}}>{fmtUSD(loggedValue)}</div>
                    <div style={bpKpiSub}>{loggedHours.toFixed(1)} hrs invested this year</div>
                  </div>
                </div>
                <div style={{marginTop:'12px'}}>
                  <div style={{height:'8px',background:'var(--bg-base)',borderRadius:'999px',overflow:'hidden'}}>
                    <div style={{width:`${Math.min(100, pct * 100)}%`,height:'100%',background: onTrack ? 'var(--green)' : 'var(--accent)',transition:'width .6s ease'}} />
                  </div>
                  <div style={{marginTop:'6px',fontSize:'11px',fontWeight:600,color: aheadHours >= 0 ? 'var(--green)' : 'var(--yellow)'}}>
                    {aheadHours >= 0
                      ? `On pace — ${aheadHours.toFixed(1)} hrs ahead of your commitment (${fmtUSD(Math.abs(aheadHours) * hourlyRate)} of extra time invested)`
                      : `${Math.abs(aheadHours).toFixed(1)} hrs behind your commitment (${fmtUSD(Math.abs(aheadHours) * hourlyRate)} of time not yet invested)`}
                  </div>
                </div>
                <div style={{marginTop:'12px',paddingTop:'10px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',fontSize:'11px',color:'var(--text-3)'}}>
                  <span>Full-year commitment</span>
                  <span style={{fontVariantNumeric:'tabular-nums'}}>{committedAnnualHours.toFixed(0)} hrs · {fmtUSD(committedAnnualValue)}</span>
                </div>
              </>
            )}
            <p style={{fontSize:'10px',color:'var(--text-3)',margin:'12px 0 0',lineHeight:1.5,fontStyle:'italic',paddingTop:'10px',borderTop:'1px solid var(--border)'}}>
              † Non-tax-deductible. This figure is not a cash expense and never appears on your Schedule C or in any tax report. It exists only to reveal the true cost of your prospecting systems — committed hours × hourly rate, compared with hours actually logged × hourly rate. Logged hours come from the timers and time entries in Prospecting; your hourly rate is set in Strategy inputs (GCI goal ÷ committed hours ÷ 48 weeks).
            </p>
          </div>
        );
      })()}

      <div className="panel" style={{padding:'14px'}}>
        <h3 style={{margin:'0 0 12px',fontSize:'14px',color:'var(--text-1)'}}>Strategy inputs</h3>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'10px'}}>
          <SettingInput label="Avg transaction price" value={settings?.avg_transaction_price} prefix="$" onSave={v => updateSetting({ avg_transaction_price: v })} readOnly={readOnly} />
          <SettingInput label="Commission %" value={Number(settings?.avg_commission_pct) * 100} suffix="%" onSave={v => updateSetting({ avg_commission_pct: v / 100 })} step="0.01" readOnly={readOnly} />
          <SettingInput label="Your split with broker" value={Number(settings?.broker_split_pct) * 100} suffix="%" onSave={v => updateSetting({ broker_split_pct: v / 100 })} step="0.5" readOnly={readOnly} />
          <SettingInput label="Estimated tax %" value={Number(settings?.estimated_tax_pct) * 100} suffix="%" onSave={v => updateSetting({ estimated_tax_pct: v / 100 })} step="1" readOnly={readOnly} />
          <SettingInput label="Prospecting hours / week" value={settings?.prospecting_hours_per_week} suffix="hrs" onSave={saveProspectHours} step="0.5" readOnly={readOnly} />
        </div>
        {/* First-year pro-rata control */}
        <div style={{marginTop:'12px',padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:readOnly?'default':'pointer',fontSize:'13px',color:'var(--text-1)',fontWeight:600}}>
            <input type="checkbox" checked={!!settings?.prorate_first_year} disabled={readOnly}
              onChange={e => updateSetting({ prorate_first_year: e.target.checked })} />
            First year — pro-rate my targets &amp; budgets
          </label>
          <p style={{fontSize:'11px',color:'var(--text-3)',margin:'6px 0 8px',lineHeight:1.5}}>
            If you started part-way through the year, this scales your GCI goal, budgets, pace clock and time commitment to the slice of the year you're actually working — so a mid-year start isn't measured against a full January–December year. Your saved goal stays the full-year figure; only the first-year view is pro-rated.
          </p>
          <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
            <span style={{fontSize:'12px',color:'var(--text-2)'}}>Started on</span>
            <input type="date" className="form-input" style={{maxWidth:'180px'}} value={settings?.activation_date || ''}
              disabled={readOnly || !settings?.prorate_first_year}
              onChange={e => updateSetting({ activation_date: e.target.value || null })} />
            {settings?.prorate_first_year && settings?.activation_date && (
              <span style={{fontSize:'11px',color:'var(--accent)',fontWeight:700}}>{getProrata(settings).pct}% of {new Date().getFullYear()} active</span>
            )}
          </div>
        </div>
        {/* Auto-computed prospecting hourly value */}
        <div style={{marginTop:'12px',padding:'12px 14px',background:'linear-gradient(135deg, rgba(197,169,94,0.10), rgba(197,169,94,0.02))',border:'1px solid var(--accent)',borderRadius:'10px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:'10px',color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:800}}>Your prospecting hour is worth</div>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'3px',fontVariantNumeric:'tabular-nums'}}>
              {fmtUSD(gciGoal)} GCI&nbsp;÷&nbsp;{prospectHours || 0} hrs/wk&nbsp;÷&nbsp;48 wks
            </div>
          </div>
          <div style={{fontSize:'26px',fontWeight:800,color:'var(--accent)',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>
            {prospectHours > 0 ? `${fmtUSD(prospectHourlyValue)}/hr` : '—'}
          </div>
        </div>
        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px',fontStyle:'italic',lineHeight:1.5}}>
          Auto-calculated from your GCI goal and the hours you commit to prospecting each week. This sets your hourly rate, which values your time in the Prospecting ROI matrix and the operations report — so every hour you track shows what it's really worth toward your goal.
        </p>
      </div>

      <div className="panel" style={{padding:'14px'}}>
        <h3 style={{margin:'0 0 4px',fontSize:'14px',color:'var(--text-1)'}}>Activity waterfall</h3>
        <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 12px'}}>What you actually have to do. Funnel rates are industry benchmarks (Tom Ferry / NAR).</p>
        <WaterfallRow label="Closed transactions needed" value={txnsNeeded} icon={<Icon name="deals" size={18} />} tone="gold" />
        <WaterfallRow label="Signed clients" value={signedNeeded} icon={<Icon name="edit" size={18} />} sub={`${fmtPct(rates.signedToClose, 0)} signed → close`} />
        <WaterfallRow label="Appointments" value={apptsNeeded} icon={<Icon name="users" size={18} />} sub={`${fmtPct(rates.apptToSigned, 0)} appt → signed`} />
        <WaterfallRow label="Real conversations" value={convosNeeded} icon={<Icon name="message" size={18} />} sub={`${fmtPct(rates.convoToAppt, 0)} convo → appt`} />
        <WaterfallRow label="Total leads" value={leadsNeeded} icon={<Icon name="target" size={18} />} sub={`${fmtPct(rates.leadToConvo, 0)} lead → convo`} />
        <div style={{marginTop:'14px',padding:'12px',background:'var(--bg-base)',borderRadius:'8px',border:'1px dashed var(--accent)'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>Weekly minimum (48 working weeks)</div>
          <div style={{fontSize:'22px',color:'var(--accent)',fontWeight:800,marginTop:'4px',fontVariantNumeric:'tabular-nums'}}>{weeklyLeads} leads per week</div>
        </div>
      </div>
    </div>
  );
}
