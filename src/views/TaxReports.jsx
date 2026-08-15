// TaxReports — Schedule C, the quarterly estimate, the 1099 report and the tax
// settings modal, plus the Schedule C line map they share.
//
// ~1,355 lines out of AccountingViews.jsx. Tax work is seasonal: an agent opens
// these a handful of times a year, so they have no business in the chunk that
// loads every time someone checks their numbers.
// Extracted from AccountingViews.jsx (see REFACTOR-PLAN.md).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours } from '../financeUtils';
import { SE_TAX_2026, computeFederalIncomeTax, computeNetProfitFromData, computeQuarterlyTaxProjection, nextQuarterDueLabel } from '../taxMath';
import { KpiBox } from './FinanceTiles';

export const SCHEDULE_C_LINES = [
  { num: '8',   label: 'Advertising' },
  { num: '9',   label: 'Car and truck expenses', isMileage: true },
  { num: '10',  label: 'Commissions and fees paid out' },
  { num: '11',  label: 'Contract labor' },
  { num: '13',  label: 'Depreciation and Section 179' },
  { num: '14',  label: 'Employee benefit programs' },
  { num: '15',  label: 'Insurance (other than health)' },
  { num: '16a', label: 'Interest — mortgage' },
  { num: '16b', label: 'Interest — other' },
  { num: '17',  label: 'Legal and professional services' },
  { num: '18',  label: 'Office expense' },
  { num: '19',  label: 'Pension and profit-sharing plans' },
  { num: '20a', label: 'Rent or lease — vehicles, machinery, equipment' },
  { num: '20b', label: 'Rent or lease — other business property' },
  { num: '21',  label: 'Repairs and maintenance' },
  { num: '22',  label: 'Supplies' },
  { num: '23',  label: 'Taxes and licenses' },
  { num: '24a', label: 'Travel' },
  { num: '24b', label: 'Meals (50% deductible)' },
  { num: '25',  label: 'Utilities' },
  { num: '26',  label: 'Wages (less employment credits)' },
  { num: '27a', label: 'Other expenses' },
];

export function SCLine({ num, label, amount, subtitle, expanded, onToggle, children, hasData, isPositive }) {
  const dim = !hasData;
  const amtColor = !hasData ? 'var(--text-3)' : (isPositive ? 'var(--green)' : 'var(--text-1)');
  return (
    <div className="sc-line" style={{
      background: dim ? 'transparent' : 'var(--bg-base)',
      border: `1px solid ${dim ? 'var(--border)' : 'var(--border)'}`,
      borderRadius: '6px',
      overflow: 'hidden',
      opacity: dim ? 0.55 : 1,
    }}>
      <button type="button" onClick={onToggle} disabled={!hasData}
        style={{width:'100%',padding:'8px 12px',background:'transparent',border:'none',color:'var(--text-1)',cursor: hasData ? 'pointer' : 'default',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',textAlign:'left'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:'10px',minWidth:0,flex:1}}>
          <span className="sc-line-num" style={{fontSize:'10px',color:'var(--text-3)',fontWeight:700,minWidth:'36px',textTransform:'uppercase',letterSpacing:'0.04em'}}>{num}</span>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:'12.5px',fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</div>
            {subtitle && hasData && (
              <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'1px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{subtitle}</div>
            )}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
          <span className="sc-line-amt" style={{fontSize:'13px',fontWeight:700,fontVariantNumeric:'tabular-nums',color:amtColor,whiteSpace:'nowrap'}}>
            ${Number(amount || 0).toFixed(2).toLocaleString()}
          </span>
          {hasData && (
            <span style={{color:'var(--text-3)',fontSize:'10px',transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',transition:'transform 0.15s'}}>›</span>
          )}
        </div>
      </button>
      {expanded && hasData && children}
    </div>
  );
}

// ─── 2026 federal tax constants ─────────────────────────────────────
// From IRS Rev. Proc. 2025-32. The seven-bracket structure was made
// permanent by the One Big Beautiful Bill Act (OBBBA, July 2025); the
// boundaries below are the inflation-adjusted 2026 amounts.
// Update once the IRS announces the 2027 schedule.

export function WorkingsRow({ label, amount, bold }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',fontSize:'11.5px'}}>
      <span style={{color:'var(--text-2)',fontWeight: bold ? 700 : 400}}>{label}</span>
      <span style={{color: amount < 0 ? 'var(--red)' : 'var(--text-1)', fontVariantNumeric:'tabular-nums', fontWeight: bold ? 800 : 600}}>
        {amount < 0 ? '−' : ''}${Math.round(Math.abs(amount)).toLocaleString()}
      </span>
    </div>
  );
}

// Modal to capture filing status, prior-year safe harbor data, other income, etc.

export function WorkingsSection({ title, total, children }) {
  return (
    <div style={{marginBottom:'14px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'8px 10px',background:'var(--bg-hover)',borderRadius:'6px 6px 0 0',borderBottom:'1px solid var(--border)'}}>
        <span style={{fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>{title}</span>
        {total != null && (
          <span style={{fontSize:'13px',fontWeight:800,color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>
            ${Math.round(total).toLocaleString()}
          </span>
        )}
      </div>
      {children && (
        <div style={{padding:'4px 10px 8px',background:'var(--bg-base)',borderRadius:'0 0 6px 6px',border:'1px solid var(--border)',borderTop:'none'}}>
          {children}
        </div>
      )}
    </div>
  );
}

export function needs1099(contact, paidYTD) {
  if (!contact) return false;
  if (paidYTD < 600) return false;
  if (contact.exempt_1099_reason) return false;
  if (contact.force_1099) return true;
  // Corporations (S-corp / C-corp / LLC taxed as corp) are exempt unless
  // force_1099 is set (e.g., attorneys)
  const corp = ['s_corp','c_corp','llc_s_corp','llc_c_corp','nonprofit'];
  if (corp.includes(contact.entity_type)) return false;
  // Sole props, partnerships, LLCs (disregarded/multi), individuals: required
  return true;
}

// Label for the "why no 1099" column

export function exemptionReason(contact, paidYTD) {
  if (!contact) return null;
  if (paidYTD < 600) return 'Below $600';
  if (contact.exempt_1099_reason) return contact.exempt_1099_reason;
  if (contact.force_1099) return null;
  if (contact.entity_type === 's_corp' || contact.entity_type === 'llc_s_corp') return 'S corp — exempt';
  if (contact.entity_type === 'c_corp' || contact.entity_type === 'llc_c_corp') return 'C corp — exempt';
  if (contact.entity_type === 'nonprofit') return 'Nonprofit — exempt';
  return null;
}

export function ScheduleCReport({ userId, taxCategories }) {
  const now = new Date();
  const [taxYear, setTaxYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [mileageEntries, setMileageEntries] = useState([]);
  const [expandedLines, setExpandedLines] = useState({});  // { lineNum: bool }
  const [expandedTxLists, setExpandedTxLists] = useState({});  // { lineNum: bool }

  // Year selector — current + 3 prior years (most users will want the
  // current or just-completed tax year)
  const currentYear = now.getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  // Fetch the full year's transactions + mileage when the selected
  // year changes. We do not piggyback on FinanceView's transactions
  // because that's capped at 500 rows; a busy year-end Schedule C run
  // needs everything in scope.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const start = `${taxYear}-01-01`;
      const end = `${taxYear}-12-31`;
      const [{ data: tx }, { data: m }] = await Promise.all([
        supabase.from('transactions').select('*')
          .eq('user_id', userId).eq('scope', 'business').eq('is_archived', false)
          .gte('date', start).lte('date', end)
          .order('date', { ascending: true }).limit(5000),
        supabase.from('mileage_entries').select('*')
          .eq('user_id', userId).eq('category', 'business')
          .gte('date', start).lte('date', end)
          .order('date', { ascending: true }).limit(5000),
      ]);
      if (cancelled) return;
      setTransactions(tx || []);
      setMileageEntries(m || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, taxYear]);

  // Build the per-line rollup. For each Schedule C line:
  //   - find tax_categories where schedule_c_line matches (normalize "Line 17" vs "17")
  //   - sum the absolute value of negative transactions in those categories
  //   - apply each category's deduction_pct (e.g. meals 50%)
  //   - for Line 9, sum mileage_entries.computed_deduction instead
  const rollup = useMemo(() => {
    // Normalize a schedule_c_line value (e.g. "Line 17", "17", " line 17 ") to "17"
    function normalize(line) {
      if (!line) return '';
      return String(line).replace(/^line\s*/i, '').trim().toLowerCase();
    }
    // Group tax_categories by normalized line
    const catsByLine = {};
    taxCategories.forEach(c => {
      const key = normalize(c.schedule_c_line);
      if (!key) return;
      if (!catsByLine[key]) catsByLine[key] = [];
      catsByLine[key].push(c);
    });
    // Build the per-line totals
    const lineRollup = {};
    SCHEDULE_C_LINES.forEach(L => {
      const key = normalize(L.num);
      const cats = catsByLine[key] || [];
      let totalRaw = 0;
      let totalDeductible = 0;
      const perCategory = [];
      cats.forEach(cat => {
        const catTx = transactions.filter(t => t.tax_category_id === cat.id && Number(t.amount) < 0);
        const catRaw = catTx.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        const ded = Number(cat.deduction_pct || 1);
        const catDeductible = catRaw * ded;
        totalRaw += catRaw;
        totalDeductible += catDeductible;
        perCategory.push({
          category: cat,
          rawAmount: catRaw,
          deductionPct: ded,
          deductibleAmount: catDeductible,
          txCount: catTx.length,
          transactions: catTx,
        });
      });
      // Special case: Line 9 from mileage
      let mileageMiles = 0;
      let mileageDeduction = 0;
      let mileageCount = 0;
      if (L.isMileage) {
        mileageEntries.forEach(m => {
          mileageMiles += (Number(m.miles) || 0) * (m.is_round_trip ? 2 : 1);
          mileageDeduction += Number(m.computed_deduction) || 0;
          mileageCount += 1;
        });
        totalDeductible += mileageDeduction;
      }
      lineRollup[L.num] = {
        ...L,
        cats,
        perCategory,
        totalRaw,
        totalDeductible,
        mileageMiles, mileageDeduction, mileageCount,
        hasData: totalDeductible > 0,
      };
    });

    // Part I — Income (Line 1: gross receipts)
    const incomeTx = transactions.filter(t => Number(t.amount) > 0);
    const grossReceipts = incomeTx.reduce((s, t) => s + Number(t.amount), 0);
    // Group income by category for the drilldown
    const incomeByCategory = {};
    incomeTx.forEach(t => {
      const k = t.tax_category_id || '__uncat__';
      if (!incomeByCategory[k]) incomeByCategory[k] = { category: taxCategories.find(c => c.id === k) || null, amount: 0, txCount: 0, transactions: [] };
      incomeByCategory[k].amount += Number(t.amount);
      incomeByCategory[k].txCount += 1;
      incomeByCategory[k].transactions.push(t);
    });

    // Totals
    const totalExpenses = SCHEDULE_C_LINES.reduce((s, L) => s + lineRollup[L.num].totalDeductible, 0);
    const tentativeProfit = grossReceipts - totalExpenses;  // Line 29

    // Uncategorized expenses (warn the user — these don't flow to any line)
    const uncatExpenses = transactions.filter(t => Number(t.amount) < 0 && !t.tax_category_id);
    const uncatTotal = uncatExpenses.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    // Categorized expenses with no schedule_c_line set
    const catsMissingLine = taxCategories.filter(c => !c.schedule_c_line);
    const missingLineTx = transactions.filter(t => Number(t.amount) < 0 && catsMissingLine.some(c => c.id === t.tax_category_id));
    const missingLineTotal = missingLineTx.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    return {
      grossReceipts, incomeByCategory, incomeTxCount: incomeTx.length,
      lineRollup, totalExpenses, tentativeProfit,
      uncatExpenses, uncatTotal,
      missingLineTx, missingLineTotal,
    };
  }, [transactions, taxCategories, mileageEntries]);

  function toggle(lineNum) {
    setExpandedLines(prev => ({ ...prev, [lineNum]: !prev[lineNum] }));
  }
  function toggleTxList(lineNum) {
    setExpandedTxLists(prev => ({ ...prev, [lineNum]: !prev[lineNum] }));
  }
  function expandAll() {
    const next = {};
    SCHEDULE_C_LINES.forEach(L => { next[L.num] = true; });
    setExpandedLines(next);
  }
  function collapseAll() {
    setExpandedLines({});
    setExpandedTxLists({});
  }

  return (
    <div className="schedule-c-report" style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* ─── Print stylesheet — strip chrome, force single-column print ─── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .schedule-c-report, .schedule-c-report * { visibility: visible !important; }
          .schedule-c-report { position: absolute !important; left: 0; top: 0; width: 100%; padding: 20px !important; background: white !important; color: black !important; }
          .schedule-c-report .no-print { display: none !important; }
          .schedule-c-report .sc-line { break-inside: avoid; border-color: #ddd !important; background: white !important; color: black !important; }
          .schedule-c-report .sc-line-num { color: #555 !important; }
          .schedule-c-report .sc-line-amt { color: black !important; }
          .schedule-c-report .sc-summary { break-inside: avoid; }
        }
      `}</style>

      {/* Header bar */}
      <div className="no-print" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <span style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>Tax year:</span>
          <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))}
            style={{padding:'6px 14px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}{y === now.getFullYear() ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
          <button onClick={expandAll} style={{padding:'5px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>Expand all</button>
          <button onClick={collapseAll} style={{padding:'5px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11px',fontWeight:600}}>Collapse</button>
          <button onClick={() => window.print()} style={{padding:'5px 12px',background:'var(--accent)',border:'none',borderRadius:'6px',color:'var(--bg-base)',cursor:'pointer',fontSize:'11px',fontWeight:700}}><Icon name="printer" size={14} /> Print / Save PDF</button>
        </div>
      </div>

      {/* Title block — visible in print */}
      <div style={{textAlign:'center',padding:'14px',borderTop:'2px solid var(--text-1)',borderBottom:'2px solid var(--text-1)'}}>
        <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>IRS Form 1040</div>
        <div style={{fontSize:'18px',fontWeight:800,color:'var(--text-1)',marginTop:'2px'}}>Schedule C · Profit or Loss From Business</div>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'4px'}}>Tax Year {taxYear} · Sole Proprietorship</div>
      </div>

      {loading ? (
        <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
      ) : (
        <>
          {/* Warnings — uncategorized + missing-line categories */}
          {(rollup.uncatTotal > 0 || rollup.missingLineTotal > 0) && (
            <div className="no-print" style={{padding:'10px 14px',background:'rgba(245,158,11,0.10)',border:'1px solid rgba(245,158,11,0.4)',borderRadius:'8px',fontSize:'12px',color:'var(--text-2)',lineHeight:1.5}}>
              <div style={{fontWeight:700,color:'#f59e0b',marginBottom:'4px'}}>⚠ Data quality</div>
              {rollup.uncatTotal > 0 && (
                <div>
                  ${rollup.uncatTotal.toFixed(0).toLocaleString()} of expenses across {rollup.uncatExpenses.length} transactions have no tax category assigned. These are not included in any line below. Fix in the Ledger to capture them.
                </div>
              )}
              {rollup.missingLineTotal > 0 && (
                <div style={{marginTop:'4px'}}>
                  ${rollup.missingLineTotal.toFixed(0).toLocaleString()} of expenses across {rollup.missingLineTx.length} transactions are categorized but their tax category has no Schedule C line mapped. Fix in Finance → Blueprint → Categories.
                </div>
              )}
            </div>
          )}

          {/* ─── Part I — Income ─── */}
          <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>
              Part I · Income
            </div>
            <SCLine
              num="1" label="Gross receipts or sales"
              amount={rollup.grossReceipts}
              subtitle={`${rollup.incomeTxCount} income transaction${rollup.incomeTxCount === 1 ? '' : 's'}`}
              expanded={!!expandedLines['1']}
              onToggle={() => toggle('1')}
              isPositive
              hasData={rollup.grossReceipts > 0}
            >
              {Object.values(rollup.incomeByCategory).length === 0 ? (
                <div style={{padding:'10px 14px',fontSize:'11.5px',color:'var(--text-3)',fontStyle:'italic'}}>No income transactions recorded for {taxYear}.</div>
              ) : (
                <div style={{padding:'4px 14px 12px',display:'flex',flexDirection:'column',gap:'4px'}}>
                  {Object.values(rollup.incomeByCategory)
                    .sort((a, b) => b.amount - a.amount)
                    .map((ic, i) => (
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:'11.5px'}}>
                        <span style={{color:'var(--text-2)'}}>
                          {ic.category?.name || '— Uncategorized —'}
                          <span style={{color:'var(--text-3)',marginLeft:'8px',fontSize:'10px'}}>
                            ({ic.txCount} tx)
                          </span>
                        </span>
                        <span style={{color:'var(--green)',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>
                          ${ic.amount.toFixed(2).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </SCLine>

            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',marginTop:'6px',background:'var(--bg-base)',borderRadius:'6px',borderLeft:'3px solid var(--green)'}}>
              <span style={{fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>Line 7 · Gross income</span>
              <span style={{fontSize:'15px',fontWeight:800,color:'var(--green)',fontVariantNumeric:'tabular-nums'}}>
                ${rollup.grossReceipts.toFixed(2).toLocaleString()}
              </span>
            </div>
          </div>

          {/* ─── Part II — Expenses ─── */}
          <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>
              Part II · Expenses
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              {SCHEDULE_C_LINES.map(L => {
                const rl = rollup.lineRollup[L.num];
                const showLine = rl.hasData || rl.cats.length > 0 || L.isMileage;
                if (!showLine) return null;
                return (
                  <SCLine key={L.num}
                    num={L.num} label={L.label}
                    amount={rl.totalDeductible}
                    subtitle={
                      L.isMileage
                        ? `${rl.mileageCount} trip${rl.mileageCount===1?'':'s'} · ${Math.round(rl.mileageMiles).toLocaleString()} mi`
                        : rl.cats.map(c => c.name).join(' · ')
                    }
                    expanded={!!expandedLines[L.num]}
                    onToggle={() => toggle(L.num)}
                    hasData={rl.hasData}
                  >
                    {/* Per-category breakdown */}
                    {!L.isMileage && rl.perCategory.length > 0 && (
                      <div style={{padding:'4px 14px 8px',display:'flex',flexDirection:'column',gap:'4px'}}>
                        {rl.perCategory.map((pc, i) => (
                          <div key={i}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:'11.5px',gap:'8px'}}>
                              <span style={{color:'var(--text-2)',minWidth:0,flex:1}}>
                                {pc.category.name}
                                <span style={{color:'var(--text-3)',marginLeft:'8px',fontSize:'10px'}}>
                                  ({pc.txCount} tx
                                  {pc.deductionPct !== 1 && ` · ${(pc.deductionPct * 100).toFixed(0)}% deductible`})
                                </span>
                              </span>
                              <span style={{color:'var(--text-1)',fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>
                                {pc.deductionPct !== 1 ? (
                                  <>
                                    <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'10px'}}>${pc.rawAmount.toFixed(0).toLocaleString()} → </span>
                                    ${pc.deductibleAmount.toFixed(2).toLocaleString()}
                                  </>
                                ) : (
                                  <>${pc.deductibleAmount.toFixed(2).toLocaleString()}</>
                                )}
                              </span>
                            </div>
                          </div>
                        ))}
                        {/* Tx list toggle */}
                        {rl.perCategory.some(pc => pc.txCount > 0) && (
                          <button type="button" onClick={() => toggleTxList(L.num)}
                            className="no-print"
                            style={{alignSelf:'flex-start',marginTop:'4px',padding:'3px 8px',background:'transparent',border:'1px dashed var(--border)',borderRadius:'4px',color:'var(--text-3)',cursor:'pointer',fontSize:'10px',fontWeight:600}}>
                            {expandedTxLists[L.num] ? '× Hide transactions' : `+ Show ${rl.perCategory.reduce((s,pc)=>s+pc.txCount,0)} transactions`}
                          </button>
                        )}
                        {expandedTxLists[L.num] && (
                          <div style={{marginTop:'6px',padding:'8px',background:'var(--bg-base)',borderRadius:'4px',maxHeight:'220px',overflowY:'auto'}}>
                            {rl.perCategory.flatMap(pc => pc.transactions)
                              .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                              .map(t => (
                                <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',fontSize:'10.5px',color:'var(--text-3)',gap:'8px'}}>
                                  <span style={{flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{t.date}</span>
                                  <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                    {t.payee || t.description || '(no description)'}
                                  </span>
                                  <span style={{color:'var(--text-2)',fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>
                                    ${Math.abs(Number(t.amount)).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Mileage breakdown */}
                    {L.isMileage && (
                      <div style={{padding:'8px 14px 12px'}}>
                        {rl.mileageCount === 0 ? (
                          <div style={{fontSize:'11.5px',color:'var(--text-3)',fontStyle:'italic'}}>
                            No mileage entries for {taxYear}. Log trips under <strong><span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="car" size={12} /> Mileage</span></strong> to populate this line.
                          </div>
                        ) : (
                          <div style={{fontSize:'11.5px',color:'var(--text-2)',display:'flex',flexDirection:'column',gap:'3px'}}>
                            <div style={{display:'flex',justifyContent:'space-between'}}>
                              <span>Business miles driven</span>
                              <span style={{fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{Math.round(rl.mileageMiles).toLocaleString()} mi</span>
                            </div>
                            <div style={{display:'flex',justifyContent:'space-between'}}>
                              <span>Standard mileage rate × miles</span>
                              <span style={{fontWeight:700,fontVariantNumeric:'tabular-nums'}}>${rl.mileageDeduction.toFixed(2).toLocaleString()}</span>
                            </div>
                            <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px'}}>
                              From {rl.mileageCount} logged trip{rl.mileageCount===1?'':'s'}. Mileage uses the IRS standard rate for the entry's date.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </SCLine>
                );
              })}
            </div>
            {/* Line 28 total */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',marginTop:'8px',background:'var(--bg-base)',borderRadius:'6px',borderLeft:'3px solid var(--red)'}}>
              <span style={{fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>Line 28 · Total expenses</span>
              <span style={{fontSize:'15px',fontWeight:800,color:'var(--red)',fontVariantNumeric:'tabular-nums'}}>
                ${rollup.totalExpenses.toFixed(2).toLocaleString()}
              </span>
            </div>
          </div>

          {/* ─── Summary box ─── */}
          <div className="sc-summary" style={{padding:'16px',background:'var(--bg-card)',border:`2px solid ${rollup.tentativeProfit >= 0 ? 'var(--green)' : 'var(--red)'}`,borderRadius:'10px'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>Summary</div>
            <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 0'}}>
                <span style={{fontSize:'12px',color:'var(--text-2)'}}>Line 7 · Gross income</span>
                <span style={{fontSize:'13px',fontWeight:700,fontVariantNumeric:'tabular-nums',color:'var(--text-1)'}}>${rollup.grossReceipts.toFixed(2).toLocaleString()}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 0'}}>
                <span style={{fontSize:'12px',color:'var(--text-2)'}}>Line 28 · Total expenses</span>
                <span style={{fontSize:'13px',fontWeight:700,fontVariantNumeric:'tabular-nums',color:'var(--text-1)'}}>− ${rollup.totalExpenses.toFixed(2).toLocaleString()}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'8px 0',borderTop:'1px solid var(--border)',marginTop:'4px'}}>
                <span style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>Line 29 · Tentative profit / (loss)</span>
                <span style={{fontSize:'19px',fontWeight:800,fontVariantNumeric:'tabular-nums',color: rollup.tentativeProfit >= 0 ? 'var(--green)' : 'var(--red)'}}>
                  ${rollup.tentativeProfit.toFixed(2).toLocaleString()}
                </span>
              </div>
              <div style={{fontSize:'10.5px',color:'var(--text-3)',fontStyle:'italic',marginTop:'4px',lineHeight:1.5}}>
                This is the Schedule C bottom-line that flows to Form 1040 Line 3 (subject to SE tax on Schedule SE). Line 30 (home office) and Line 31 (net) are not yet computed — handled by your CPA or a dedicated home-office worksheet.
              </div>
            </div>
          </div>

          {/* ─── What this report does NOT cover ─── */}
          <div className="no-print" style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
            <div style={{fontWeight:700,color:'var(--text-2)',marginBottom:'4px',fontSize:'11.5px'}}>This preview is not a tax return.</div>
            It rolls your tracked transactions and mileage into the Schedule C line items so your CPA has a one-page handoff. It does <em>not</em> compute home-office (Line 30), depreciation (Line 13), 1099 vendor summary, self-employment tax (Schedule SE), quarterly estimated payments, or the federal income-tax bracket calculation. Have a CPA review before filing.
          </div>
        </>
      )}
    </div>
  );
}

// Reusable expandable line for Schedule C — shows num, label, amount,
// optional drilldown content when expanded. Lines with no data render
// dimmed so the form still reads "complete" even if nothing applies.

export function QuarterlyTaxReport({ userId, taxCategories }) {
  const now = new Date();
  const [taxYear, setTaxYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [mileageEntries, setMileageEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkings, setShowWorkings] = useState(false);

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const start = `${taxYear}-01-01`;
      const end = `${taxYear}-12-31`;
      const [{ data: tx }, { data: m }, { data: s }] = await Promise.all([
        supabase.from('transactions').select('*')
          .eq('user_id', userId).eq('is_archived', false)
          .gte('date', start).lte('date', end)
          .order('date', { ascending: true }).limit(5000),
        supabase.from('mileage_entries').select('*')
          .eq('user_id', userId).eq('category', 'business')
          .gte('date', start).lte('date', end)
          .order('date', { ascending: true }).limit(5000),
        supabase.from('user_tax_settings').select('*')
          .eq('user_id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      setTransactions(tx || []);
      setMileageEntries(m || []);
      setSettings(s || { filing_status: 'single', estimated_other_income: 0, withholding_ytd: 0, use_qbi_deduction: true, itemized_deductions: 0 });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, taxYear]);

  // Estimated tax payment YTD: sum of transactions in the Estimated Tax
  // Payments category for the selected year. Lets the user log Q1, Q2 etc.
  // in the Ledger as transactions and have them flow into "already paid".
  const estPaymentCat = useMemo(() =>
    taxCategories.find(c => c.name === 'Estimated Tax Payments'),
    [taxCategories]
  );
  const ytdEstimatedPaid = useMemo(() => {
    if (!estPaymentCat) return 0;
    return transactions
      .filter(t => t.tax_category_id === estPaymentCat.id)
      .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  }, [transactions, estPaymentCat]);

  // YTD net profit (business scope only — Schedule C)
  const ytd = useMemo(() => {
    const bizTx = transactions.filter(t => t.scope === 'business');
    return computeNetProfitFromData(bizTx, taxCategories, mileageEntries);
  }, [transactions, taxCategories, mileageEntries]);

  // How many months are elapsed in the selected tax year (for annualization).
  // Recomputes each render — cheap, and `now` is captured fresh each time.
  const currentMonthInThisYear = now.getMonth() + 1;
  const monthsElapsed = taxYear < now.getFullYear()
    ? 12
    : taxYear > now.getFullYear()
      ? 1
      : currentMonthInThisYear;

  // Run the projection
  const projection = useMemo(() => {
    if (!settings) return null;
    return computeQuarterlyTaxProjection({
      ytdNetProfit: ytd.netProfit,
      monthsElapsed,
      year: taxYear,
      filingStatus: settings.filing_status || 'single',
      otherIncome: Number(settings.estimated_other_income) || 0,
      withholding: Number(settings.withholding_ytd) || 0,
      useQbi: !!settings.use_qbi_deduction,
      itemizedDeductions: Number(settings.itemized_deductions) || 0,
      priorYearTax: Number(settings.prior_year_tax_owed) || null,
      priorYearAgi: Number(settings.prior_year_agi) || null,
      ytdEstimatedPaid,
    });
  }, [settings, ytd.netProfit, monthsElapsed, taxYear, ytdEstimatedPaid]);

  async function saveSettings(patch) {
    const updates = { user_id: userId, ...settings, ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('user_tax_settings').upsert(updates).select().single();
    if (error) {
      if (window.__notify) window.__notify('Save failed: ' + error.message, 'error');
      return;
    }
    setSettings(data);
  }

  const fmt = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

  if (loading || !settings || !projection) {
    return <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>;
  }

  const filingStatusLabel = {
    single: 'Single', mfj: 'Married filing jointly',
    mfs: 'Married filing separately', hoh: 'Head of household',
  }[settings.filing_status || 'single'];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <span style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>Tax year:</span>
          <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))}
            style={{padding:'6px 14px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}{y === now.getFullYear() ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setShowSettings(true)}
          style={{padding:'6px 12px',background:'transparent',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',cursor:'pointer',fontSize:'11.5px',fontWeight:600}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="settings" size={13} /> Tax settings · {filingStatusLabel}</span>
        </button>
      </div>

      {/* HEADLINE — what to set aside / owe now */}
      <div style={{
        padding:'18px',
        background: projection.currentlyOwed > 0
          ? 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(245,158,11,0.10))'
          : 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.06))',
        border: `2px solid ${projection.currentlyOwed > 0 ? 'var(--red)' : 'var(--green)'}`,
        borderRadius:'12px',
      }}>
        <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>
          {projection.currentlyOwed > 0 ? 'You are behind on estimated payments' : 'On track with estimated payments'}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:'12px',marginTop:'8px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'30px',fontWeight:800,color: projection.currentlyOwed > 0 ? 'var(--red)' : 'var(--green)',fontVariantNumeric:'tabular-nums',lineHeight:1}}>
              {fmt(projection.currentlyOwed > 0 ? projection.currentlyOwed : projection.recommendedQuarterly)}
            </div>
            <div style={{fontSize:'11.5px',color:'var(--text-2)',marginTop:'5px'}}>
              {projection.currentlyOwed > 0
                ? `Catch-up needed now · ${projection.quartersPassed} of 4 quarters elapsed`
                : `Set aside per quarter · next due ${projection.nextDueQuarter?.due.toLocaleDateString('en-US', {month:'short', day:'numeric'}) || '—'}`}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>YTD paid</div>
            <div style={{fontSize:'18px',fontWeight:700,color:'var(--text-1)',fontVariantNumeric:'tabular-nums',marginTop:'4px'}}>{fmt(ytdEstimatedPaid)}</div>
            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>via Estimated Tax Payments</div>
          </div>
        </div>
      </div>

      {/* Quarterly schedule */}
      <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>
          Quarterly Payment Schedule · {taxYear}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:'8px'}}>
          {projection.quarters.map((q, idx) => {
            const isPast = q.due <= now;
            const dueDateStr = q.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: q.due.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
            return (
              <div key={q.id} style={{
                padding:'10px 12px',
                background: isPast ? 'var(--bg-base)' : 'var(--bg-hover)',
                border: `1px solid ${isPast ? 'var(--border)' : 'var(--accent)'}`,
                borderRadius:'8px',
                opacity: isPast ? 0.75 : 1,
              }}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                  <span style={{fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>{q.label}</span>
                  <span style={{fontSize:'9px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>{q.covers}</span>
                </div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--accent)',fontVariantNumeric:'tabular-nums',marginTop:'6px'}}>
                  {fmt(projection.recommendedQuarterly)}
                </div>
                <div style={{fontSize:'10px',color:isPast?'var(--text-3)':'var(--text-2)',marginTop:'3px'}}>
                  Due {dueDateStr}{isPast ? ' · past' : ''}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'10px',lineHeight:1.5,fontStyle:'italic'}}>
          To log a paid estimate, add a transaction in the Ledger with category <strong style={{color:'var(--text-2)'}}>Estimated Tax Payments</strong>. The YTD paid total above will pick it up automatically.
        </div>
      </div>

      {/* Annual projection summary */}
      <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',flexWrap:'wrap',gap:'8px'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Annual Projection</div>
          <button onClick={() => setShowWorkings(v => !v)}
            style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'4px',color:'var(--text-3)',cursor:'pointer',fontSize:'10.5px',fontWeight:600}}>
            {showWorkings ? '× Hide working' : '+ Show working'}
          </button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))',gap:'10px'}}>
          <KpiBox label="Net profit YTD" value={fmt(ytd.netProfit)} sub={`${monthsElapsed} mo of ${taxYear}`}/>
          <KpiBox label="Annualized" value={fmt(projection.annualizedNetProfit)} sub="projected to year-end"/>
          <KpiBox label="SE tax (15.3%)" value={fmt(projection.se.total)} sub="Schedule SE" color="#f59e0b"/>
          <KpiBox label="Federal income tax" value={fmt(projection.fed.tax)} sub={`${fmtPct(projection.fed.effectiveRate)} effective`} color="#3b82f6"/>
          <KpiBox label="Total annual tax" value={fmt(projection.totalAnnualTax)} sub={`marginal ${fmtPct(projection.fed.marginalRate + 0.153)}`} color="var(--red)"/>
        </div>
      </div>

      {/* Workings — full walk through the math */}
      {showWorkings && (
        <div style={{padding:'14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'10px'}}>
            Working — how we got there
          </div>

          {/* Step 1: Net profit */}
          <WorkingsSection title="1. Schedule C net profit" total={ytd.netProfit}>
            <WorkingsRow label="Gross receipts (income transactions)" amount={ytd.grossReceipts}/>
            <WorkingsRow label="− Business expenses (deductible portion)" amount={-ytd.businessExpenses}/>
            <WorkingsRow label="− Mileage deduction (Line 9)" amount={-ytd.mileageDeduction}/>
          </WorkingsSection>

          <WorkingsSection title={`2. Annualize to full year (×${(12/monthsElapsed).toFixed(2)})`} total={projection.annualizedNetProfit}/>

          <WorkingsSection title="3. Self-employment tax" total={projection.se.total}>
            <WorkingsRow label={`SE earnings = net profit × ${SE_TAX_2026.se_deduction_factor}`} amount={projection.se.seEarnings}/>
            <WorkingsRow label={`Social Security tax (12.4% capped at ${fmt(SE_TAX_2026.ss_wage_base)})`} amount={projection.se.ssTax}/>
            <WorkingsRow label="Medicare tax (2.9%, no cap)" amount={projection.se.medicareTax}/>
            {projection.se.additionalMedicare > 0 && (
              <WorkingsRow label={`Additional Medicare (0.9% above ${settings.filing_status === 'mfj' ? '$250K' : '$200K'})`} amount={projection.se.additionalMedicare}/>
            )}
          </WorkingsSection>

          <WorkingsSection title="4. Adjusted Gross Income (AGI)" total={projection.agi}>
            <WorkingsRow label="Schedule C net profit (annualized)" amount={projection.annualizedNetProfit}/>
            <WorkingsRow label="+ Other income" amount={Number(settings.estimated_other_income) || 0}/>
            <WorkingsRow label="− Half of SE tax (above-the-line deduction)" amount={-projection.se.aboveLineDeduction}/>
          </WorkingsSection>

          <WorkingsSection title="5. Taxable income" total={projection.taxableIncome}>
            <WorkingsRow label="AGI" amount={projection.agi}/>
            <WorkingsRow label={`− ${projection.deductionType === 'itemized' ? 'Itemized' : 'Standard'} deduction (${filingStatusLabel})`} amount={-projection.deductionUsed}/>
            {projection.qbiDeduction > 0 && (
              <WorkingsRow label="− QBI deduction (20% of qualified biz income, Sec 199A)" amount={-projection.qbiDeduction}/>
            )}
          </WorkingsSection>

          <WorkingsSection title="6. Federal income tax (bracket walk)" total={projection.fed.tax}>
            {projection.fed.usedBrackets.map((b, i) => (
              <WorkingsRow key={i}
                label={`${(b.rate*100).toFixed(0)}% bracket · ${fmt(b.incomeInBracket)} of income`}
                amount={b.taxInBracket}/>
            ))}
          </WorkingsSection>

          <WorkingsSection title="7. Total annual tax" total={projection.totalAnnualTax}>
            <WorkingsRow label="SE tax" amount={projection.se.total}/>
            <WorkingsRow label="Federal income tax" amount={projection.fed.tax}/>
          </WorkingsSection>

          {projection.safeHarborAnnual != null && (
            <WorkingsSection title="8. Safe harbor comparison" total={null}>
              <WorkingsRow label={`Current-year projection ÷ 4`} amount={projection.quarterlyByCurrentYear}/>
              <WorkingsRow label={`Prior-year safe harbor ÷ 4 (× ${(projection.safeHarborAnnual / Number(settings.prior_year_tax_owed || 1) * 100 / 100).toFixed(2)})`} amount={projection.quarterlyBySafeHarbor || 0}/>
              <WorkingsRow label="Recommended (the lower of the two)" amount={projection.recommendedQuarterly} bold/>
            </WorkingsSection>
          )}
        </div>
      )}

      {/* Boundary note */}
      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
        <div style={{fontWeight:700,color:'var(--text-2)',marginBottom:'4px',fontSize:'11.5px'}}>This is a projection, not a tax return.</div>
        Florida residents have no state income tax — federal only. The numbers above assume real-estate agents are NOT classified as a Specified Service Trade or Business (SSTB), so the full 20% QBI deduction applies. AMT not modeled. The Additional Child Tax Credit, EITC, and other targeted credits are not included. Have your CPA review before sending the IRS a payment.
      </div>

      {/* Settings modal */}
      {showSettings && (
        <TaxSettingsModal
          settings={settings}
          onSave={async (patch) => { await saveSettings(patch); }}
          onClose={() => setShowSettings(false)}/>
      )}
    </div>
  );
}

// Small KPI tile (separate from RecruitingKpiTile so it's self-contained
// and doesn't depend on the recruiting feature)

export function Form1099Report({ userId }) {
  const now = new Date();
  const [taxYear, setTaxYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('1099_required');  // '1099_required' | 'all_flagged' | 'over_600' | 'all'

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  // 1099-NEC deadline countdown — Jan 31 of (taxYear + 1). For 2026 returns,
  // that's Jan 31, 2027. Computed inline since `now` changes every render.
  const deadline = new Date(taxYear + 1, 0, 31);
  const daysToDeadline = Math.round((deadline - now) / 86400000);

  // Load data scoped to the selected year. Only need business-scope
  // negative-amount transactions (payments to vendors).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const start = `${taxYear}-01-01`;
      const end = `${taxYear}-12-31`;
      const [{ data: tx }, { data: c }] = await Promise.all([
        supabase.from('transactions').select('*')
          .eq('user_id', userId).eq('scope', 'business').eq('is_archived', false)
          .gte('date', start).lte('date', end).lt('amount', 0)
          .limit(5000),
        supabase.from('contacts').select('id, name, company, type, is_1099_vendor, entity_type, tax_id_last4, tax_id_type, w9_collected, w9_collected_date, exempt_1099_reason, force_1099, business_address, business_city, business_state, business_zip, home_address, home_city, home_state, home_zip, email, phone')
          .eq('user_id', userId).limit(5000),
      ]);
      if (cancelled) return;
      setTransactions(tx || []);
      setContacts(c || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, taxYear]);

  // Build vendor summary: aggregate by contact_id where present, else by
  // lowercased payee string. Each "vendor" gets paidYTD, txCount, last
  // payment date, and the contact reference if linked.
  const vendors = useMemo(() => {
    const map = new Map();
    function keyFor(t) {
      // Prefer contact_id; if a transaction has both payee and contact_id,
      // contact_id wins. Else fall back to lowercased payee.
      // Note: transactions table doesn't have contact_id directly — payee is
      // a string. Link via payee match to contacts.name or .company.
      // (Future improvement: add transactions.contact_id FK.)
      const payee = (t.payee || '').trim();
      if (!payee) return '__no_payee__';
      // Try to find a contact whose name OR company matches the payee
      const c = contacts.find(c => 
        (c.name && c.name.toLowerCase() === payee.toLowerCase()) ||
        (c.company && c.company.toLowerCase() === payee.toLowerCase())
      );
      return c ? `c:${c.id}` : `p:${payee.toLowerCase()}`;
    }
    transactions.forEach(t => {
      const k = keyFor(t);
      if (!map.has(k)) {
        const isContact = k.startsWith('c:');
        const contact = isContact ? contacts.find(c => c.id === k.slice(2)) : null;
        map.set(k, {
          key: k,
          payee: t.payee || '(no payee)',
          contact,
          paidYTD: 0,
          txCount: 0,
          lastPayment: null,
          transactions: [],
        });
      }
      const v = map.get(k);
      v.paidYTD += Math.abs(Number(t.amount) || 0);
      v.txCount += 1;
      v.transactions.push(t);
      if (!v.lastPayment || (t.date && t.date > v.lastPayment)) v.lastPayment = t.date;
    });
    // Sort by paid descending
    return Array.from(map.values()).sort((a, b) => b.paidYTD - a.paidYTD);
  }, [transactions, contacts]);

  // Filter for the table display
  const filteredVendors = useMemo(() => {
    let v = vendors;
    if (filter === '1099_required') {
      v = v.filter(x => needs1099(x.contact, x.paidYTD));
    } else if (filter === 'all_flagged') {
      v = v.filter(x => x.contact?.is_1099_vendor || x.contact?.force_1099);
    } else if (filter === 'over_600') {
      v = v.filter(x => x.paidYTD >= 600);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      v = v.filter(x => 
        x.payee.toLowerCase().includes(q) ||
        (x.contact?.name || '').toLowerCase().includes(q) ||
        (x.contact?.company || '').toLowerCase().includes(q)
      );
    }
    return v;
  }, [vendors, filter, search]);

  // KPI rollups
  const kpis = useMemo(() => {
    const over600 = vendors.filter(v => v.paidYTD >= 600);
    const required = vendors.filter(v => needs1099(v.contact, v.paidYTD));
    const w9Collected = required.filter(v => v.contact?.w9_collected).length;
    const tinOnFile = required.filter(v => v.contact?.tax_id_last4).length;
    return {
      over600Count: over600.length,
      requiredCount: required.length,
      requiredTotalPaid: required.reduce((s, v) => s + v.paidYTD, 0),
      w9Collected, w9Missing: required.length - w9Collected,
      tinOnFile, tinMissing: required.length - tinOnFile,
    };
  }, [vendors]);

  // Toggle is_1099_vendor / w9_collected inline from the report
  async function quickToggle(contactId, field, value) {
    if (!contactId) return;
    const patch = { [field]: value };
    if (field === 'w9_collected' && value && !contacts.find(c => c.id === contactId)?.w9_collected_date) {
      patch.w9_collected_date = new Date().toISOString().slice(0, 10);
    }
    const { data, error } = await supabase
      .from('contacts').update(patch).eq('id', contactId).select().single();
    if (error) {
      if (window.__notify) window.__notify('Update failed: ' + error.message, 'error');
      return;
    }
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, ...data } : c));
  }

  // Promote an unmatched payee to a vendor contact
  async function promoteToContact(payeeName) {
    const { data, error } = await supabase
      .from('contacts')
      .insert({ user_id: userId, name: payeeName, type: 'vendor', is_1099_vendor: true })
      .select().single();
    if (error) {
      if (window.__notify) window.__notify('Could not create contact: ' + error.message, 'error');
      return;
    }
    setContacts(prev => [...prev, data]);
    if (window.__notify) window.__notify(`Created contact: ${payeeName} · flagged 1099`, 'success');
  }

  // CSV export of all 1099-required vendors
  function exportCSV() {
    const headers = ['Vendor', 'Company', 'TIN type', 'TIN last 4', 'Address', 'City', 'State', 'ZIP', 'Email', 'Phone', 'Paid YTD', 'W-9 received', 'Entity type'];
    const rows = filteredVendors.map(v => {
      const c = v.contact;
      const addr = c?.business_address || c?.home_address || '';
      const city = c?.business_city || c?.home_city || '';
      const st = c?.business_state || c?.home_state || '';
      const zip = c?.business_zip || c?.home_zip || '';
      return [
        c?.name || v.payee,
        c?.company || '',
        c?.tax_id_type || '',
        c?.tax_id_last4 ? `XXX-XX-${c.tax_id_last4}` : '',
        addr, city, st, zip,
        c?.email || '',
        c?.phone || '',
        v.paidYTD.toFixed(2),
        c?.w9_collected ? (c.w9_collected_date || 'yes') : 'no',
        c?.entity_type || '',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `1099-vendors-${taxYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fmt = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <span style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>Tax year:</span>
          <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))}
            style={{padding:'6px 14px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}{y === now.getFullYear() ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
        <button onClick={exportCSV} disabled={filteredVendors.length === 0}
          style={{padding:'6px 14px',background:'var(--accent)',border:'none',borderRadius:'6px',color:'var(--bg-base)',cursor:'pointer',fontSize:'11.5px',fontWeight:700,opacity:filteredVendors.length===0?0.4:1}}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Deadline countdown */}
      <div style={{
        padding:'10px 14px',
        background: daysToDeadline < 0
          ? 'rgba(239,68,68,0.10)'
          : daysToDeadline < 30
            ? 'rgba(245,158,11,0.10)'
            : 'var(--bg-base)',
        border: `1px solid ${daysToDeadline < 0 ? 'var(--red)' : daysToDeadline < 30 ? '#f59e0b' : 'var(--border)'}`,
        borderRadius:'8px',
        fontSize:'12px',
        color:'var(--text-2)',
      }}>
        <strong style={{color:'var(--text-1)'}}>
          {daysToDeadline < 0
            ? `⚠ ${Math.abs(daysToDeadline)} days PAST the Jan 31 deadline`
            : daysToDeadline === 0
              ? 'Today is the Jan 31 deadline'
              : `${daysToDeadline} days to the Jan 31 deadline`}
        </strong>
        {' — '} 1099-NEC forms must be sent to vendors by January 31, {taxYear + 1} and filed with the IRS by February 28 (paper) or March 31 (electronic). Penalty: $60–$310 per late form.
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:'8px'}}>
        <KpiBox label="Vendors paid $600+" value={kpis.over600Count} sub={`${vendors.length} vendors total`}/>
        <KpiBox label="1099-NEC required" value={kpis.requiredCount} sub={fmt(kpis.requiredTotalPaid)} color="var(--accent)"/>
        <KpiBox label="W-9 collected" value={`${kpis.w9Collected} / ${kpis.requiredCount}`} sub={kpis.w9Missing > 0 ? `${kpis.w9Missing} missing` : 'all on file'} color={kpis.w9Missing > 0 ? 'var(--red)' : 'var(--green)'}/>
        <KpiBox label="TIN on file" value={`${kpis.tinOnFile} / ${kpis.requiredCount}`} sub={kpis.tinMissing > 0 ? `${kpis.tinMissing} missing` : 'all on file'} color={kpis.tinMissing > 0 ? 'var(--red)' : 'var(--green)'}/>
      </div>

      {/* Filter + search */}
      <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',flexWrap:'wrap'}}>
          {[
            { id: '1099_required', label: '1099 required' },
            { id: 'all_flagged',   label: 'All flagged' },
            { id: 'over_600',      label: '$600+ paid' },
            { id: 'all',           label: 'All vendors' },
          ].map(o => (
            <button key={o.id} onClick={() => setFilter(o.id)}
              style={{padding:'5px 11px',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                background:filter===o.id?'var(--accent)':'transparent',
                color:filter===o.id?'var(--bg-base)':'var(--text-2)'}}>{o.label}</button>
          ))}
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search vendor…"
          style={{flex:'1 1 180px',padding:'6px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'11.5px',outline:'none'}}/>
      </div>

      {/* Vendor table */}
      {loading ? (
        <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
      ) : filteredVendors.length === 0 ? (
        <div style={{padding:'24px',textAlign:'center',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',color:'var(--text-3)',fontStyle:'italic'}}>
          No vendors match the current filter.
        </div>
      ) : (
        <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',overflow:'hidden'}}>
          <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,display:'grid',gridTemplateColumns:'1fr 100px 90px 70px 80px',gap:'8px',alignItems:'center'}}>
            <span>Vendor</span>
            <span style={{textAlign:'right'}}>Paid YTD</span>
            <span>Entity</span>
            <span>W-9</span>
            <span style={{textAlign:'right'}}>1099?</span>
          </div>
          {filteredVendors.map(v => {
            const c = v.contact;
            const required = needs1099(c, v.paidYTD);
            const reason = exemptionReason(c, v.paidYTD);
            return (
              <div key={v.key} style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',display:'grid',gridTemplateColumns:'1fr 100px 90px 70px 80px',gap:'8px',alignItems:'center',fontSize:'12px'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {c?.name || v.payee}
                    {!c && (
                      <button type="button" onClick={() => promoteToContact(v.payee)}
                        title="Create a contact for this payee"
                        style={{marginLeft:'8px',padding:'1px 7px',background:'transparent',border:'1px dashed var(--accent)',borderRadius:'4px',color:'var(--accent)',cursor:'pointer',fontSize:'9px',fontWeight:700}}>
                        + Add as contact
                      </button>
                    )}
                  </div>
                  <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'1px'}}>
                    {c?.company || ''}{c?.company ? ' · ' : ''}{v.txCount} tx
                    {c?.tax_id_last4 && <> · TIN ···{c.tax_id_last4}</>}
                  </div>
                </div>
                <div style={{textAlign:'right',fontWeight:700,fontVariantNumeric:'tabular-nums',color:v.paidYTD >= 600 ? 'var(--text-1)' : 'var(--text-3)'}}>
                  {fmt(v.paidYTD)}
                </div>
                <div style={{fontSize:'10.5px',color:'var(--text-3)'}}>
                  {c?.entity_type ? c.entity_type.replace(/_/g, ' ') : (c ? '—' : 'no contact')}
                </div>
                <div>
                  {c ? (
                    <button type="button" onClick={() => quickToggle(c.id, 'w9_collected', !c.w9_collected)}
                      style={{padding:'2px 7px',background:c.w9_collected?'rgba(34,197,94,0.15)':'transparent',border:`1px solid ${c.w9_collected?'var(--green)':'var(--border)'}`,borderRadius:'4px',color:c.w9_collected?'var(--green)':'var(--text-3)',cursor:'pointer',fontSize:'10px',fontWeight:700}}>
                      {c.w9_collected ? '✓ yes' : '○ no'}
                    </button>
                  ) : (
                    <span style={{fontSize:'10px',color:'var(--text-3)'}}>—</span>
                  )}
                </div>
                <div style={{textAlign:'right'}}>
                  {required ? (
                    <span style={{padding:'2px 7px',background:'rgba(197,169,94,0.15)',border:'1px solid var(--accent)',borderRadius:'4px',color:'var(--accent)',fontSize:'10px',fontWeight:700}}>required</span>
                  ) : reason ? (
                    <span title={reason} style={{padding:'2px 7px',background:'transparent',border:'1px solid var(--border)',borderRadius:'4px',color:'var(--text-3)',fontSize:'10px',fontWeight:600}}>exempt</span>
                  ) : c ? (
                    <button type="button" onClick={() => quickToggle(c.id, 'is_1099_vendor', !c.is_1099_vendor)}
                      style={{padding:'2px 7px',background:'transparent',border:'1px dashed var(--border)',borderRadius:'4px',color:c.is_1099_vendor?'var(--accent)':'var(--text-3)',cursor:'pointer',fontSize:'10px',fontWeight:600}}>
                      {c.is_1099_vendor ? 'flagged' : 'flag'}
                    </button>
                  ) : (
                    <span style={{fontSize:'10px',color:'var(--text-3)'}}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Boundary note */}
      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
        <div style={{fontWeight:700,color:'var(--text-2)',marginBottom:'4px',fontSize:'11.5px'}}>What this report does NOT do.</div>
        It does not generate the actual 1099-NEC form (PDF) — your CPA or filing service (Tax1099, Track1099, QuickBooks, etc.) handles that. Export the CSV and hand it off. It also does not handle 1099-MISC (rent, royalties, prizes), 1099-K (merchant card payments — those are handled by the processor), or state-level filings. Florida has no state 1099 requirement.
      </div>
    </div>
  );
}

// ─── BudgetReport ────────────────────────────────────────────────────
// Budget vs actual for every lead-gen system and recruiting system.
// Both tables carry monthly_budget — this report finally surfaces it
// against actual transaction spend so the monthly review answer is
// staring at you: "where are we overspending? where are we leaving
// budget on the table?"
//
// View options:
//   This month — MTD actual vs full-month budget, with a pace projection
//   Last month — full month vs full month
//   YTD        — sum YTD actual vs (monthly budget × months elapsed)

export function TaxSettingsModal({ settings, onSave, onClose }) {

  useBackClose(onClose);
  const [filingStatus, setFilingStatus] = useState(settings.filing_status || 'single');
  const [otherIncome, setOtherIncome] = useState(settings.estimated_other_income ?? 0);
  const [withholding, setWithholding] = useState(settings.withholding_ytd ?? 0);
  const [priorYearTax, setPriorYearTax] = useState(settings.prior_year_tax_owed ?? '');
  const [priorYearAgi, setPriorYearAgi] = useState(settings.prior_year_agi ?? '');
  const [useQbi, setUseQbi] = useState(settings.use_qbi_deduction !== false);
  const [itemized, setItemized] = useState(settings.itemized_deductions ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      filing_status: filingStatus,
      estimated_other_income: Number(otherIncome) || 0,
      withholding_ytd: Number(withholding) || 0,
      prior_year_tax_owed: priorYearTax === '' ? null : Number(priorYearTax),
      prior_year_agi: priorYearAgi === '' ? null : Number(priorYearAgi),
      use_qbi_deduction: useQbi,
      itemized_deductions: Number(itemized) || 0,
    });
    setSaving(false);
    onClose();
  }

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
          <h3 style={{margin:0,fontSize:'15px'}}>Tax settings</h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        <div className="form-group">
          <label className="form-label">Filing status</label>
          <select value={filingStatus} onChange={e => setFilingStatus(e.target.value)} style={inputStyle}>
            <option value="single">Single</option>
            <option value="mfj">Married filing jointly</option>
            <option value="mfs">Married filing separately</option>
            <option value="hoh">Head of household</option>
          </select>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>This year</div>

        <div className="form-group">
          <label className="form-label">Other annual income (spouse W-2, side W-2, interest…)</label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
            <input type="number" step="100" value={otherIncome}
              onChange={e => setOtherIncome(e.target.value)}
              style={{...inputStyle, paddingLeft:'20px'}}/>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>Added to your Schedule C net profit when computing AGI.</div>
        </div>

        <div className="form-group">
          <label className="form-label">Federal tax already withheld YTD (from W-2 income)</label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
            <input type="number" step="100" value={withholding}
              onChange={e => setWithholding(e.target.value)}
              style={{...inputStyle, paddingLeft:'20px'}}/>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>Subtracted from total tax owed. Skip if you're a pure 1099 contractor.</div>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Safe harbor (prior year)</div>
        <div style={{fontSize:'10.5px',color:'var(--text-3)',marginBottom:'8px',fontStyle:'italic',lineHeight:1.5}}>
          Paying 100% of last year's tax (110% if AGI &gt; $150K) avoids the underpayment penalty regardless of how this year goes. From last year's Form 1040.
        </div>

        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Prior year tax owed</label>
            <div style={{position:'relative'}}>
              <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
              <input type="number" step="100" value={priorYearTax}
                onChange={e => setPriorYearTax(e.target.value)}
                placeholder="From 1040 Line 24"
                style={{...inputStyle, paddingLeft:'20px'}}/>
            </div>
          </div>
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Prior year AGI</label>
            <div style={{position:'relative'}}>
              <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
              <input type="number" step="1000" value={priorYearAgi}
                onChange={e => setPriorYearAgi(e.target.value)}
                placeholder="From 1040 Line 11"
                style={{...inputStyle, paddingLeft:'20px'}}/>
            </div>
          </div>
        </div>

        <div style={{marginTop:'14px',marginBottom:'8px',fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Deductions</div>

        <div className="form-group">
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
            <input type="checkbox" checked={useQbi} onChange={e => setUseQbi(e.target.checked)}/>
            <span style={{fontSize:'12px',color:'var(--text-1)'}}>Apply 20% QBI deduction (Sec. 199A)</span>
          </label>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',marginLeft:'24px',lineHeight:1.5}}>
            Real-estate brokers / agents generally qualify for the full deduction. Disable only if your CPA tells you otherwise.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Itemized deductions (if you itemize)</label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
            <input type="number" step="100" value={itemized}
              onChange={e => setItemized(e.target.value)}
              placeholder="0 = use standard"
              style={{...inputStyle, paddingLeft:'20px'}}/>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>
            Standard deductions 2026: $16,100 single · $32,200 MFJ · $24,150 HoH. Used unless your itemized exceeds.
          </div>
        </div>

        <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'16px'}}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Form1099Report ──────────────────────────────────────────────────
// Year-end 1099-NEC vendor summary. Surfaces every vendor paid through
// business transactions, with a running annual total. The IRS requires
// a 1099-NEC for any non-corporate service vendor paid $600+ in a
// calendar year (with attorneys ALWAYS getting a 1099 even if a corp).
// Deadlines: copy to vendor by Jan 31; IRS filing by Feb 28 (paper) /
// Mar 31 (electronic). Penalty $60–$310 per missed form depending on
// lateness.
//
// Vendor identification: rolls up transactions by tax_id_full ($-match)
// where present, else by contact_id, else by lowercased payee string.
// This keeps cash payees who don't have a contact record from getting
// lost — they show up as "unmatched payees" and can be linked to a
// contact (or excluded with a reason).

// Rule: does this vendor need a 1099-NEC?
