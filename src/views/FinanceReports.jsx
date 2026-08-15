// FinanceReports — the reports tab and everything it hosts: the business and
// personal P&L, cost-centre breakdowns, and the lead-gen ROI report.
//
// ~700 lines out of AccountingViews.jsx, and the last extraction in that split.
// This module OWNS the lazy declarations for the tax and budget reports, because
// it is the tab host that renders them — putting them here means the finance
// shell has no path to any report at all, and each one still arrives only when
// its tab is opened.
// Extracted from AccountingViews.jsx (see REFACTOR-PLAN.md).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { canHover, modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours, getProrata } from '../financeUtils';
import { KpiBox, KpiTile } from './FinanceTiles';
// SysStat moved to FinanceSystems during the Prospecting split. Imported rather
// than re-declared — a second copy is exactly the drift this refactor exists to
// remove, and FinanceSystems is already in the graph via Prospecting.
import { SysStat } from './FinanceSystems';

// Seasonal reports stay lazy — each arrives when its tab is opened, not before.
const ScheduleCReport = React.lazy(() => import('./TaxReports').then(m => ({ default: m.ScheduleCReport })));
const QuarterlyTaxReport = React.lazy(() => import('./TaxReports').then(m => ({ default: m.QuarterlyTaxReport })));
const Form1099Report = React.lazy(() => import('./TaxReports').then(m => ({ default: m.Form1099Report })));
const BudgetReport = React.lazy(() => import('./BudgetForecast').then(m => ({ default: m.BudgetReport })));
const CashFlowForecast = React.lazy(() => import('./BudgetForecast').then(m => ({ default: m.CashFlowForecast })));

export function ReportHeader({ reportType, setReportType, period, setPeriod, trackPersonal }) {
  const options = [{ id:'business', label:'💼 Business · Tax' }];
  if (trackPersonal) options.push({ id:'personal', label:'🏠 Personal' });
  options.push({ id:'roi', label:'🎯 Operations · ROI' });
  options.push({ id:'budgets', label:'💰 Budgets' });
  options.push({ id:'cashflow', label:'📈 Cash Flow' });
  options.push({ id:'schedule_c', label:'📋 Schedule C' });
  options.push({ id:'quarterly', label:'💵 Quarterly Tax' });
  options.push({ id:'form_1099', label:'📑 1099s' });
  // These five use their own period/year selectors, hide the shared period dropdown
  const showPeriod = reportType !== 'schedule_c' && reportType !== 'quarterly' && reportType !== 'form_1099' && reportType !== 'budgets' && reportType !== 'cashflow';

  return (
    <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
      <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',flexWrap:'wrap'}}>
        {options.map(o => (
          <button key={o.id} onClick={() => setReportType(o.id)}
            style={{padding:'6px 12px',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:700,cursor:'pointer',
              background:reportType===o.id?'var(--accent)':'transparent',
              color:reportType===o.id?'var(--bg-base)':'var(--text-2)'}}>{o.label}</button>
        ))}
      </div>
      {showPeriod && (
        <select value={period} onChange={e => setPeriod(e.target.value)}
          style={{padding:'6px 12px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--text-1)',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
          <option value="month">This month</option>
          <option value="last-month">Last month</option>
          <option value="ytd">Year to date</option>
          <option value="all">All time</option>
        </select>
      )}
    </div>
  );
}

export function BusinessReport({ transactions, taxCategories, systems, recruitingSystems = [], advExpanded, setAdvExpanded, isCoach }) {
  const income = transactions.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expenseByCategory = {};
  transactions.filter(t => Number(t.amount) < 0).forEach(t => {
    const k = t.tax_category_id || 'uncategorized';
    if (!expenseByCategory[k]) expenseByCategory[k] = { total: 0, txns: [] };
    expenseByCategory[k].total += Math.abs(Number(t.amount));
    expenseByCategory[k].txns.push(t);
  });
  const totalExpense = Object.values(expenseByCategory).reduce((s, v) => s + v.total, 0);
  const net = income - totalExpense;
  const advertisingCat = taxCategories.find(c => /advert/i.test(c.name));
  const advCategoryData = advertisingCat ? expenseByCategory[advertisingCat.id] : null;
  const advBySystem = {};
  if (advCategoryData) {
    advCategoryData.txns.forEach(t => {
      const k = t.lead_gen_system_id || 'unassigned';
      advBySystem[k] = (advBySystem[k] || 0) + Math.abs(Number(t.amount));
    });
  }

  // ─── Cost-center rollup ────────────────────────────────────────────
  // Three buckets, summed by precedence so a single transaction doesn't
  // double-count: if a transaction has recruiting_system_id, it's
  // brokerage ops; else if it has lead_gen_system_id, it's agent lead gen;
  // else it's other / unattributed. The precedence reflects how Dara's
  // attributing in practice — recruiting work is the more specific tag.
  const recruitingBySystem = {};
  const leadGenBySystem = {};
  let otherTotal = 0;
  let recruitingTotal = 0;
  let leadGenTotal = 0;
  transactions.filter(t => Number(t.amount) < 0).forEach(t => {
    const amt = Math.abs(Number(t.amount));
    if (t.recruiting_system_id) {
      recruitingBySystem[t.recruiting_system_id] = (recruitingBySystem[t.recruiting_system_id] || 0) + amt;
      recruitingTotal += amt;
    } else if (t.lead_gen_system_id) {
      leadGenBySystem[t.lead_gen_system_id] = (leadGenBySystem[t.lead_gen_system_id] || 0) + amt;
      leadGenTotal += amt;
    } else {
      otherTotal += amt;
    }
  });
  const costCenterTotal = recruitingTotal + leadGenTotal + otherTotal;

  return (
    <div className="panel" style={{padding:'16px'}}>
      <h3 style={{margin:'0 0 4px',fontSize:'15px',color:'var(--text-1)'}}>Business — Tax Summary</h3>
      <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 14px'}}>
        Schedule C-ready. Hand this to your CPA. Mileage and Meals 50% applied in Phase 4.
      </p>

      <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'2px solid var(--border)'}}>
        <span style={{fontWeight:700,color:'var(--text-1)'}}>Gross commission income</span>
        <span style={{fontWeight:700,color:'var(--green)',fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(income)}</span>
      </div>

      {/* ─── COST CENTERS ─── */}
      {costCenterTotal > 0 && (
        <div style={{padding:'14px 0 8px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontWeight:700,color:'var(--text-1)',marginBottom:'4px'}}>Expenses by cost center</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'10px',lineHeight:1.5}}>
            Strategic view — where the money is going by purpose. Tax view (by Schedule C line) is below.
          </div>

          {/* Brokerage Ops & Recruiting */}
          {recruitingTotal > 0 && (
            <CostCenterBlock
              icon={<Icon name="recruiting" size={16} />}
              title="Brokerage Operations & Recruiting"
              subtitle="Building the agent base — overhead of running the franchise"
              total={recruitingTotal}
              accentColor="#7c5cff"
              percentOfTotal={costCenterTotal > 0 ? recruitingTotal / costCenterTotal : 0}
              systems={recruitingSystems}
              bySystemMap={recruitingBySystem}
              unassignedLabel="Other recruiting (unassigned system)"
            />
          )}

          {/* Agent Lead Generation */}
          {leadGenTotal > 0 && (
            <CostCenterBlock
              icon={<Icon name="chart" size={16} />}
              title="Agent Lead Generation"
              subtitle="Acquiring leads — direct income production"
              total={leadGenTotal}
              accentColor="var(--accent)"
              percentOfTotal={costCenterTotal > 0 ? leadGenTotal / costCenterTotal : 0}
              systems={systems}
              bySystemMap={leadGenBySystem}
              unassignedLabel="Other lead gen (unassigned system)"
            />
          )}

          {/* Other — no cost-center tag */}
          {otherTotal > 0 && (
            <CostCenterBlock
              icon={<Icon name="briefcase" size={16} />}
              title="Other Business Expenses"
              subtitle="No cost-center tag — usually office, utilities, professional fees"
              total={otherTotal}
              accentColor="var(--text-3)"
              percentOfTotal={costCenterTotal > 0 ? otherTotal / costCenterTotal : 0}
              systems={null}
              bySystemMap={null}
            />
          )}
        </div>
      )}

      <div style={{padding:'14px 0 8px'}}>
        <div style={{fontWeight:700,color:'var(--text-1)',marginBottom:'8px'}}>Deductible expenses by Schedule C line</div>
        {Object.keys(expenseByCategory).length === 0 ? (
          <p style={{fontSize:'12px',color:'var(--text-3)',fontStyle:'italic',margin:0}}>No expenses recorded in this period.</p>
        ) : (
          Object.entries(expenseByCategory).sort((a,b) => b[1].total - a[1].total).map(([cid, data]) => {
            const cat = taxCategories.find(c => c.id === cid);
            const isAdvertising = cat?.id === advertisingCat?.id;
            return (
              <div key={cid}>
                <div onClick={() => isAdvertising && setAdvExpanded(v => !v)}
                  style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:'13px',cursor:isAdvertising?'pointer':'default',borderBottom:'1px solid var(--border)'}}>
                  <span style={{color:'var(--text-2)',display:'flex',alignItems:'center',gap:'6px'}}>
                    {cat && <span style={{width:'8px',height:'8px',borderRadius:'2px',background:cat.color,display:'inline-block'}}/>}
                    {cat?.name || 'Uncategorized'}
                    {cat && <span style={{fontSize:'10px',color:'var(--text-3)',marginLeft:'4px'}}>{cat.schedule_c_line}</span>}
                    {isAdvertising && <span style={{color:'var(--text-3)',marginLeft:'4px',fontSize:'10px'}}>{advExpanded ? '▾' : '▸'} expand</span>}
                  </span>
                  <span style={{color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(data.total)}</span>
                </div>
                {isAdvertising && advExpanded && (
                  <div style={{padding:'6px 0 6px 24px',background:'var(--bg-base)',borderRadius:'6px',marginBottom:'4px'}}>
                    <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'4px'}}>Per-system breakdown (rollup detail)</div>
                    {Object.entries(advBySystem).sort((a,b) => b[1] - a[1]).map(([sid, total]) => {
                      const sys = systems.find(s => s.id === sid);
                      return (
                        <div key={sid} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px'}}>
                          <span style={{color:'var(--text-2)',display:'flex',alignItems:'center',gap:'6px'}}>
                            {sys && <span style={{width:'6px',height:'6px',borderRadius:'2px',background:sys.color,display:'inline-block'}}/>}
                            {sys?.name || 'Unassigned'}
                          </span>
                          <span style={{color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(total)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 4px',borderTop:'2px solid var(--border)'}}>
        <span style={{fontWeight:700,color:'var(--text-1)'}}>Total deductible expenses</span>
        <span style={{fontWeight:700,color:'var(--red)',fontVariantNumeric:'tabular-nums'}}>({fmtUSDCents(totalExpense)})</span>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',padding:'14px 0 4px'}}>
        <span style={{fontWeight:800,color:'var(--text-1)',fontSize:'16px'}}>Net taxable income</span>
        <span style={{fontWeight:800,color:net>=0?'var(--green)':'var(--red)',fontSize:'16px',fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(net)}</span>
      </div>
      <div style={{marginTop:'14px',padding:'10px',background:'var(--bg-base)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.5}}>
        <strong style={{color:'var(--text-2)'}}>For your CPA:</strong> Working summary. Final Schedule C will reflect mileage × IRS rate, each category × its <code style={{fontSize:'10px',padding:'1px 4px',background:'var(--bg-hover)',borderRadius:'3px'}}>deduction_pct</code> (Meals currently 100% per current IRS rules — adjustable per category), and any depreciation. Phase 4 generates the line-by-line preview.
        {isCoach && <div style={{marginTop:'6px',color:'var(--accent)'}}><Icon name="target" size={13} style={{verticalAlign:'-2px'}} /> Coach view: full underlying transactions visible in Ledger.</div>}
      </div>
    </div>
  );
}

// Cost-center display block — renders a labeled header tile + collapsible
// per-system breakdown. Used by BusinessReport for the strategic view
// (recruiting vs lead-gen vs other) that sits above the tax-category
// rollup.

export function PersonalReport({ transactions, personalBudget, period }) {
  const personalExpense = Math.abs(transactions.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0));
  const personalIncome = transactions.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const budgetedAnnual = personalBudget.reduce((s, line) => {
    if (line.is_vacation) return s + Number(line.annual_amount || 0);
    if (line.is_savings) return s + Number(line.annual_amount || Number(line.monthly_amount || 0) * 12);
    return s + Number(line.monthly_amount || 0) * 12;
  }, 0);

  // How many "months of budget" the current period represents.
  // month / last-month = 1 month; ytd = months elapsed this year; all = use annual.
  const now = new Date();
  const periodMonths = period === 'month' ? 1
    : period === 'last-month' ? 1
    : period === 'ytd' ? Math.max(1, now.getMonth() + 1)
    : 12;

  // Aggregate spending by personal_budget_line_id (expenses only — negative amounts)
  const spendByCat = {};
  transactions.filter(t => Number(t.amount) < 0).forEach(t => {
    const k = t.personal_budget_line_id || 'uncategorized';
    spendByCat[k] = (spendByCat[k] || 0) + Math.abs(Number(t.amount));
  });

  // Build category-vs-budget rows
  const categoryRows = personalBudget.map(line => {
    const actual = spendByCat[line.id] || 0;
    // Period budget: vacations/savings use annual_amount × (periodMonths/12);
    // others use monthly_amount × periodMonths
    const usesAnnual = line.is_vacation || line.is_savings;
    const periodBudget = usesAnnual
      ? Number(line.annual_amount || 0) * (periodMonths / 12)
      : Number(line.monthly_amount || 0) * periodMonths;
    const pct = periodBudget > 0 ? actual / periodBudget : null;
    return { line, actual, periodBudget, pct };
  }).sort((a, b) => b.actual - a.actual);

  const uncategorizedActual = spendByCat['uncategorized'] || 0;
  const totalBudgeted = categoryRows.reduce((s, r) => s + r.periodBudget, 0);
  const overallPct = totalBudgeted > 0 ? personalExpense / totalBudgeted : null;

  return (
    <div className="panel" style={{padding:'16px'}}>
      <h3 style={{margin:'0 0 4px',fontSize:'15px',color:'var(--text-1)'}}>Personal — Spending Summary</h3>
      <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 14px'}}>Personal cash flow vs. budget. Separate from tax reports.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'10px',marginBottom:'14px'}}>
        <KpiTile label="Period spending" value={fmtUSD(personalExpense)} sub="actual" />
        <KpiTile label="Period budget" value={fmtUSD(totalBudgeted)} sub={`${periodMonths} mo${periodMonths===1?'':'s'}`} />
        <KpiTile label="Vs budget" value={overallPct === null ? '—' : `${Math.round(overallPct*100)}%`} sub={overallPct === null ? 'no budget set' : overallPct > 1 ? 'over' : 'under'} />
        <KpiTile label="Period income" value={fmtUSD(personalIncome)} sub="personal" />
        <KpiTile label="Annual target" value={fmtUSD(budgetedAnnual)} sub="from Blueprint" />
      </div>

      {/* By-category breakdown */}
      {transactions.length === 0 ? (
        <p style={{fontSize:'12px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center',padding:'20px'}}>No personal transactions in this period.</p>
      ) : (
        <div style={{marginBottom:'14px'}}>
          <div style={{fontWeight:700,color:'var(--text-1)',marginBottom:'8px',fontSize:'13px'}}>By category — actual vs. period budget</div>
          {categoryRows.filter(r => r.actual > 0 || r.periodBudget > 0).map(({ line, actual, periodBudget, pct }) => {
            const overBudget = pct !== null && pct > 1;
            const barFill = pct === null ? 0 : Math.min(100, pct * 100);
            const barColor = pct === null ? 'var(--text-3)' : pct > 1 ? 'var(--red)' : pct > 0.8 ? '#f59e0b' : 'var(--green)';
            return (
              <div key={line.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',fontSize:'12px',marginBottom:'4px'}}>
                  <span style={{color:'var(--text-1)',fontWeight:500}}>{line.category}</span>
                  <span style={{fontVariantNumeric:'tabular-nums',color:overBudget?'var(--red)':'var(--text-1)'}}>
                    {fmtUSDCents(actual)}
                    {periodBudget > 0 && <span style={{color:'var(--text-3)',marginLeft:'6px'}}>/ {fmtUSD(periodBudget)}</span>}
                    {pct !== null && <span style={{color:barColor,marginLeft:'6px',fontWeight:700}}>{Math.round(pct*100)}%</span>}
                  </span>
                </div>
                {periodBudget > 0 && (
                  <div style={{position:'relative',height:'5px',background:'var(--bg-hover)',borderRadius:'3px',overflow:'hidden'}}>
                    <div style={{width:`${barFill}%`,height:'100%',background:barColor,transition:'width 0.4s'}}/>
                  </div>
                )}
              </div>
            );
          })}
          {uncategorizedActual > 0 && (
            <div style={{padding:'8px 0',borderBottom:'1px solid var(--border)',fontSize:'12px',display:'flex',justifyContent:'space-between'}}>
              <span style={{color:'var(--text-3)',fontStyle:'italic'}}>Uncategorized</span>
              <span style={{fontVariantNumeric:'tabular-nums',color:'var(--text-3)'}}>{fmtUSDCents(uncategorizedActual)}</span>
            </div>
          )}
        </div>
      )}

      {/* Transactions list */}
      {transactions.length > 0 && (
        <div>
          <div style={{fontWeight:700,color:'var(--text-1)',marginBottom:'8px',fontSize:'13px'}}>Recent personal transactions</div>
          {transactions.slice(0, 30).map(t => {
            const pcat = personalBudget.find(p => p.id === t.personal_budget_line_id);
            return (
              <div key={t.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:'12px',borderBottom:'1px solid var(--border)'}}>
                <span style={{color:'var(--text-2)',minWidth:0,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {t.date} — {t.payee || t.description || '(no payee)'}
                  {pcat && <span style={{marginLeft:'6px',color:'#3b82f6',fontSize:'10px',padding:'1px 5px',background:'rgba(59,130,246,0.15)',borderRadius:'3px'}}>{pcat.category}</span>}
                </span>
                <span style={{color:Number(t.amount)>=0?'var(--green)':'var(--text-1)',fontVariantNumeric:'tabular-nums',flexShrink:0,marginLeft:'8px'}}>{fmtUSDCents(t.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// THE BIG ONE — Operations ROI report. Includes time-cost. Gamified.

export function CostCenterBlock({ icon, title, subtitle, total, accentColor, percentOfTotal, systems, bySystemMap, unassignedLabel }) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = systems && bySystemMap;
  const breakdownEntries = hasBreakdown
    ? Object.entries(bySystemMap).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div style={{marginBottom:'8px',borderLeft:`3px solid ${accentColor}`,paddingLeft:'10px'}}>
      <button type="button" onClick={() => hasBreakdown && setExpanded(v => !v)}
        disabled={!hasBreakdown}
        style={{
          width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',
          background:'transparent',border:'none',padding:'6px 0',cursor: hasBreakdown ? 'pointer' : 'default',
          color:'var(--text-1)',gap:'8px',textAlign:'left',
        }}>
        <div style={{display:'flex',alignItems:'baseline',gap:'8px',minWidth:0,flex:1}}>
          <span style={{fontSize:'15px',flexShrink:0}}>{icon}</span>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{title}</div>
            <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'1px'}}>{subtitle}</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'baseline',gap:'10px',flexShrink:0}}>
          <span style={{fontSize:'10px',color:'var(--text-3)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>
            {(percentOfTotal * 100).toFixed(0)}%
          </span>
          <span style={{fontSize:'14px',fontWeight:800,color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>
            {fmtUSDCents(total)}
          </span>
          {hasBreakdown && (
            <span style={{color:'var(--text-3)',fontSize:'11px',transform: expanded ? 'rotate(90deg)' : 'rotate(0)',transition:'transform 0.15s'}}>›</span>
          )}
        </div>
      </button>
      {/* Tiny inline percentage bar */}
      <div style={{height:'2px',width:'100%',background:'var(--bg-base)',borderRadius:'1px',marginBottom:'4px',overflow:'hidden'}}>
        <div style={{width: `${(percentOfTotal*100).toFixed(1)}%`, height:'100%',background:accentColor,borderRadius:'1px',transition:'width 0.2s'}}/>
      </div>
      {expanded && hasBreakdown && (
        <div style={{padding:'4px 0 8px',marginLeft:'24px'}}>
          {breakdownEntries.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No spend by system.</div>
          ) : (
            breakdownEntries.map(([sid, amt]) => {
              const sys = systems.find(s => s.id === sid);
              const pct = total > 0 ? amt / total : 0;
              return (
                <div key={sid} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',fontSize:'11.5px',gap:'8px'}}>
                  <span style={{color:'var(--text-2)',display:'flex',alignItems:'center',gap:'6px',minWidth:0,flex:1}}>
                    <span style={{width:'6px',height:'6px',borderRadius:'2px',background: sys?.color || 'var(--text-3)',display:'inline-block',flexShrink:0}}/>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {sys?.name || unassignedLabel || 'Unassigned'}
                      {sys?.is_overhead && <span style={{fontSize:'9px',color:'var(--text-3)',marginLeft:'4px',padding:'0 4px',background:'var(--bg-hover)',borderRadius:'3px'}}>overhead</span>}
                    </span>
                  </span>
                  <span style={{fontSize:'10px',color:'var(--text-3)',fontVariantNumeric:'tabular-nums',flexShrink:0}}>
                    {(pct*100).toFixed(0)}%
                  </span>
                  <span style={{color:'var(--text-1)',fontVariantNumeric:'tabular-nums',fontWeight:600,flexShrink:0}}>
                    {fmtUSDCents(amt)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── ScheduleCReport ─────────────────────────────────────────────────
// IRS Form 1040 Schedule C preview for sole-proprietor real-estate
// agents. Aggregates a tax year's data into the actual Schedule C line
// items so future-Dara (or his CPA) gets a one-page handoff instead of
// a transactions dump.
//
// Sources:
//   Line 1 (gross receipts)         <- positive-amount transactions in business scope
//                                      (Commission Income category lives here, plus any
//                                       other income transactions like rebates received)
//   Line 9 (car & truck)            <- mileage_entries.computed_deduction (business category)
//   Lines 8 / 15 / 17 / 18 / 23 /
//     24a / 27a (expenses)          <- negative transactions grouped by tax_category.schedule_c_line,
//                                      with deduction_pct applied (e.g. meals 50%)
//
// Each line is expandable to show contributing tax categories and
// transaction counts, so the user can verify the rollup before sending
// to a CPA.
//
// What this v1 does NOT do:
//   - Line 10 / Commissions paid out (would need a transaction subtype)
//   - Line 13 / Depreciation (would need an asset register)
//   - Line 30 / Home office (would need a measured workspace setup)
//   - Self-employment tax projection (deferred to its own report)
//   - 1099 vendor summary (deferred)
//   - Real PDF export (use browser Print -> Save as PDF for v1)

// IRS Schedule C Part II line items in form order. Some lines combine
// multiple of our tax-category mappings; the seeded tax_categories
// reference these exact strings via the schedule_c_line column.

export function ROISystemCard({ row }) {
  const { system, cashSpent, incomeAttributed, minutes, timeCost, totalInvested, cashROI, trueROI, dealStats, closedCount, costPerDeal, dollarsPerDollar } = row;
  const roi = trueROI || 0;
  const fillPct = Math.min(100, (roi / 3) * 100);
  const color = roi >= 3 ? 'var(--green)' : roi >= 1 ? '#f59e0b' : roi > 0 ? 'var(--red)' : 'var(--text-3)';
  const statusBadge = roi >= 3 ? { label: '🔥 STRONG', bg: 'rgba(34,197,94,0.15)', color: 'var(--green)' }
    : roi >= 1 ? { label: '✓ PROFITABLE', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' }
    : roi > 0 ? { label: '⚠ UNDERWATER', bg: 'rgba(239,68,68,0.15)', color: 'var(--red)' }
    : { label: '📊 AWAITING DATA', bg: 'rgba(85,94,122,0.15)', color: 'var(--text-3)' };
  const activeCount = dealStats?.activeDeals?.length || 0;
  const pipelineEst = dealStats?.pipelineEst || 0;

  return (
    <div className="panel" style={{padding:'14px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',flexWrap:'wrap',gap:'8px'}}>
        <span style={{color:'var(--text-1)',fontSize:'14px',fontWeight:700,display:'flex',alignItems:'center',gap:'6px'}}>
          <span style={{width:'10px',height:'10px',borderRadius:'2px',background:system.color,display:'inline-block'}}/>
          {system.name}
        </span>
        <span style={{padding:'3px 10px',borderRadius:'4px',background:statusBadge.bg,color:statusBadge.color,fontSize:'10px',fontWeight:800,letterSpacing:'0.05em'}}>{statusBadge.label}</span>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
        <span style={{fontSize:'11px',color:'var(--text-3)'}}>True ROI (cash + time)</span>
        <span style={{fontSize:'24px',fontWeight:800,color,fontVariantNumeric:'tabular-nums'}}>{roi > 0 ? `${roi.toFixed(2)}x` : '—'}</span>
      </div>

      <div style={{position:'relative',height:'10px',background:'var(--bg-hover)',borderRadius:'5px',overflow:'hidden',border:'1px solid var(--border)'}}>
        <div style={{width:`${fillPct}%`,height:'100%',background:color,transition:'width 0.5s'}}/>
        <div style={{position:'absolute',top:'-2px',bottom:'-2px',left:'33.33%',width:'2px',background:'var(--text-3)',opacity:0.6}}/>
        <div style={{position:'absolute',top:'-2px',bottom:'-2px',right:'0',width:'2px',background:'var(--accent)'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:'9px',color:'var(--text-3)',marginTop:'3px'}}>
        <span>0x</span><span>1x break-even</span><span style={{color:'var(--accent)',fontWeight:700}}>3x target</span>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'8px',marginTop:'12px'}}>
        <SysStat label="Cash spent" value={fmtUSD(cashSpent)} />
        <SysStat label="Hours" value={fmtHours(minutes)} sub={fmtUSD(timeCost)} />
        <SysStat label="Total invested" value={fmtUSD(totalInvested)} />
        <SysStat label="Income" value={fmtUSD(incomeAttributed)} tone="green" />
      </div>

      {/* NEW — file economics row */}
      {(closedCount > 0 || activeCount > 0 || cashSpent > 0) && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'8px',marginTop:'8px',padding:'10px',background:'var(--bg-base)',borderRadius:'6px'}}>
          <SysStat label="Closed files" value={closedCount} sub={closedCount === 0 ? 'none in period' : 'period'} />
          <SysStat label="Cost per file"
            value={costPerDeal != null ? fmtUSD(costPerDeal) : '—'}
            sub={costPerDeal == null ? (closedCount === 0 ? 'no closes' : 'no cash spend') : `${closedCount} closed`}
            tone={costPerDeal != null && costPerDeal < (incomeAttributed / Math.max(1, closedCount)) * 0.33 ? 'green' : 'normal'} />
          <SysStat label="$ returned per $ spent"
            value={dollarsPerDollar != null ? `$${dollarsPerDollar.toFixed(2)}` : '—'}
            sub={dollarsPerDollar == null ? 'no cash spend' : ''}
            tone={dollarsPerDollar != null && dollarsPerDollar >= 3 ? 'green' : dollarsPerDollar != null && dollarsPerDollar < 1 ? 'red' : 'normal'} />
          <SysStat label="In pipeline"
            value={activeCount}
            sub={activeCount === 0 ? '—' : `est ${fmtUSD(pipelineEst)}`}
            tone={activeCount > 0 ? 'green' : 'muted'} />
        </div>
      )}

      {cashROI !== null && cashROI !== trueROI && (
        <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px',fontStyle:'italic'}}>
          Cash-only ROI: <strong style={{color:'var(--text-2)'}}>{cashROI.toFixed(2)}x</strong> · time changes the picture by {((cashROI - trueROI) / cashROI * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// END FINANCE MODULE
// ═════════════════════════════════════════════════════════════════════



// ─────────────────────────────────────────

export function ROIReport({ transactions, timeEntries, deals = [], systems, settings, period, inPeriod }) {
  const hourlyRate = Number(settings?.hourly_rate || 0);

  // File-derived stats per system:
  //   closedDeals   — files with status='closed' AND close_date in period
  //   activeDeals   — files not in a terminal state (closed / lost / referral)
  //   pipelineEst   — sum of estimated commission for active files
  //                   (target_price × commission_pct × 0.5 conservative split haircut)
  //                   Pipeline is period-independent — it reflects what's open today,
  //                   not what closed in the reporting window.
  function estimatedPipelineCommission(d) {
    const price = Number(d.target_price || d.list_price || 0);
    const pct = Number(d.commission_pct || 0.025);  // assume 2.5% if unset
    // Apply 50% haircut: agent typically keeps ~50% of gross commission after
    // brokerage splits, co-broke, and fees. Better to under-promise to Future-Dara.
    return price * pct * 0.5;
  }
  function dealsForSystem(systemId) {
    return deals.filter(d => d.lead_gen_system_id === systemId);
  }
  const dealStatsFor = (systemId) => {
    const sysDeals = dealsForSystem(systemId);
    const closedDeals = sysDeals.filter(d =>
      d.status === 'closed' && d.close_date && (!inPeriod || inPeriod(d.close_date))
    );
    const activeDeals = sysDeals.filter(d =>
      !['closed', 'lost'].includes(d.status)
    );
    const pipelineEst = activeDeals.reduce((s, d) => s + estimatedPipelineCommission(d), 0);
    return { closedDeals, activeDeals, pipelineEst };
  };

  const rows = systems.filter(s => !s.is_overhead).map(sys => {
    const sysTx = transactions.filter(t => t.lead_gen_system_id === sys.id);
    const cashSpent = Math.abs(sysTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0));
    const incomeAttributed = sysTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const sysTime = timeEntries.filter(te => te.lead_gen_system_id === sys.id);
    const minutes = sysTime.reduce((s, te) => s + Number(te.minutes), 0);
    const timeCost = (minutes / 60) * hourlyRate;
    const totalInvested = cashSpent + timeCost;
    const cashROI = cashSpent > 0 ? incomeAttributed / cashSpent : null;
    const trueROI = totalInvested > 0 ? incomeAttributed / totalInvested : null;
    const dealStats = dealStatsFor(sys.id);
    const closedCount = dealStats.closedDeals.length;
    const costPerDeal = closedCount > 0 ? cashSpent / closedCount : null;
    const dollarsPerDollar = cashSpent > 0 ? incomeAttributed / cashSpent : null;
    return {
      system: sys, cashSpent, incomeAttributed, minutes, timeCost, totalInvested,
      cashROI, trueROI, dealStats, closedCount, costPerDeal, dollarsPerDollar,
    };
  });
  const sortedRows = rows.sort((a, b) => (b.trueROI || 0) - (a.trueROI || 0));
  const totalCashSpent = rows.reduce((s, r) => s + r.cashSpent, 0);
  const totalTime = rows.reduce((s, r) => s + r.minutes, 0);
  const totalTimeCost = rows.reduce((s, r) => s + r.timeCost, 0);
  const totalIncome = rows.reduce((s, r) => s + r.incomeAttributed, 0);
  const totalInvested = totalCashSpent + totalTimeCost;
  const portfolioROI = totalInvested > 0 ? totalIncome / totalInvested : null;

  // Portfolio-level file stats (across all systems, plus unattributed files)
  const allClosedInPeriod = deals.filter(d =>
    d.status === 'closed' && d.close_date && (!inPeriod || inPeriod(d.close_date))
  );
  const allActiveDeals = deals.filter(d => !['closed', 'lost'].includes(d.status));
  const portfolioPipelineEst = allActiveDeals.reduce((s, d) => s + estimatedPipelineCommission(d), 0);
  const avgCommissionPerDeal = allClosedInPeriod.length > 0
    ? allClosedInPeriod.reduce((s, d) => s + Number(d.net_commission || 0), 0) / allClosedInPeriod.length
    : 0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      <div className="panel" style={{padding:'16px',background:'linear-gradient(135deg, rgba(197,169,94,0.08) 0%, rgba(197,169,94,0.02) 100%)',border:'1px solid var(--accent)'}}>
        <h3 style={{margin:'0 0 4px',fontSize:'15px',color:'var(--text-1)'}}><Icon name="target" size={15} style={{verticalAlign:'-2px'}} /> Operations · Lead-Gen ROI</h3>
        <p style={{fontSize:'11px',color:'var(--text-3)',margin:'0 0 14px'}}>
          What's working, what's not. <strong>Includes the cost of your time</strong> (hours × hourly rate) and now <strong>real file counts + pipeline</strong> from the Files module. Used for course correction, never for tax filing.
        </p>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'10px',marginBottom:'14px'}}>
          <SysStat label="Cash spent" value={fmtUSD(totalCashSpent)} />
          <SysStat label="Time invested" value={`${fmtHours(totalTime)} h`} sub={fmtUSD(totalTimeCost)} />
          <SysStat label="Total invested" value={fmtUSD(totalInvested)} />
          <SysStat label="Income attributed" value={fmtUSD(totalIncome)} tone="green" />
          <SysStat label="Portfolio ROI" value={portfolioROI === null ? '—' : `${portfolioROI.toFixed(2)}x`}
            tone={portfolioROI >= 3 ? 'green' : portfolioROI >= 1 ? 'normal' : portfolioROI !== null ? 'red' : 'muted'} />
        </div>

        {/* NEW — file counts + pipeline strip */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'10px',marginBottom:'14px',padding:'10px',background:'var(--bg-base)',borderRadius:'8px'}}>
          <SysStat label="Closed (period)" value={allClosedInPeriod.length} sub={allClosedInPeriod.length === 0 ? 'no files yet' : `avg ${fmtUSD(avgCommissionPerDeal)}`} />
          <SysStat label="In pipeline" value={allActiveDeals.length} sub={allActiveDeals.length === 0 ? 'no active files' : 'leads → closing'} />
          <SysStat label="Pipeline value est." value={fmtUSD(portfolioPipelineEst)} sub="50% split haircut" tone={portfolioPipelineEst > 0 ? 'green' : 'muted'} />
        </div>

        {/* The portfolio bar */}
        {portfolioROI !== null && (
          <div style={{padding:'12px',background:'var(--bg-base)',borderRadius:'8px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px'}}>
              <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>Portfolio progress to 3x target</span>
              <span style={{fontSize:'18px',fontWeight:800,color:portfolioROI>=3?'var(--green)':portfolioROI>=1?'#f59e0b':'var(--red)',fontVariantNumeric:'tabular-nums'}}>{portfolioROI.toFixed(2)}x</span>
            </div>
            <div style={{position:'relative',height:'12px',background:'var(--bg-hover)',borderRadius:'6px',overflow:'hidden',border:'1px solid var(--border)'}}>
              <div style={{width:`${Math.min(100,(portfolioROI/3)*100)}%`,height:'100%',background:portfolioROI>=3?'linear-gradient(90deg, var(--green), #4ade80)':portfolioROI>=1?'linear-gradient(90deg, #f59e0b, #fbbf24)':'linear-gradient(90deg, var(--red), #f87171)',transition:'width 0.5s'}}/>
              <div style={{position:'absolute',top:'-2px',bottom:'-2px',left:'33.33%',width:'2px',background:'var(--text-3)',opacity:0.6}}/>
              <div style={{position:'absolute',top:'-2px',bottom:'-2px',right:'0',width:'2px',background:'var(--accent)'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:'9px',color:'var(--text-3)',marginTop:'4px'}}>
              <span>0x</span><span>1x break-even</span><span style={{color:'var(--accent)',fontWeight:700}}>3x target</span>
            </div>
          </div>
        )}
      </div>

      {/* Per-system ROI cards */}
      {sortedRows.length === 0 ? (
        <div className="panel"><div className="empty-state" style={{padding:'30px',textAlign:'center'}}>
          <div className="empty-icon"><Icon name="target" size={28} /></div>
          <p style={{fontSize:'13px',color:'var(--text-2)'}}>Activate a lead-gen system in the Systems tab to populate this report.</p>
        </div></div>
      ) : sortedRows.map(r => (
        <ROISystemCard key={r.system.id} row={r} />
      ))}

      <div className="panel" style={{padding:'12px',background:'var(--bg-base)'}}>
        <div style={{fontSize:'11px',color:'var(--text-3)',lineHeight:1.5}}>
          <strong style={{color:'var(--text-2)'}}>Course-correction guide:</strong><br/>
          🔥 ≥3x ROI — keep feeding · ✓ 1-3x — profitable, room to optimize · ⚠ &lt;1x — diagnose or cut
        </div>
      </div>
    </div>
  );
}

export function FinanceReports({ userId, settings, transactions, taxCategories, systems, recruitingSystems, personalBudget, timeEntries, deals, trackPersonal, isCoach }) {
  const [reportType, setReportType] = useState('business');
  const [period, setPeriod] = useState('ytd');
  const [advExpanded, setAdvExpanded] = useState(false);

  useEffect(() => { if (!trackPersonal && reportType === 'personal') setReportType('business'); }, [trackPersonal, reportType]);

  const now = new Date();
  let cutoff = null;
  if (period === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'ytd') cutoff = new Date(now.getFullYear(), 0, 1);
  else if (period === 'last-month') cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodEnd = period === 'last-month' ? new Date(now.getFullYear(), now.getMonth(), 1) : null;

  const inPeriod = (d) => {
    const date = new Date(d);
    if (cutoff && date < cutoff) return false;
    if (periodEnd && date >= periodEnd) return false;
    return true;
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      <ReportHeader reportType={reportType} setReportType={setReportType} period={period} setPeriod={setPeriod} trackPersonal={trackPersonal} />

      {reportType === 'business' && (
        <BusinessReport
          transactions={transactions.filter(t => t.scope === 'business' && inPeriod(t.date))}
          taxCategories={taxCategories} systems={systems} recruitingSystems={recruitingSystems}
          advExpanded={advExpanded} setAdvExpanded={setAdvExpanded}
          isCoach={isCoach}
        />
      )}
      {reportType === 'personal' && trackPersonal && (
        <PersonalReport
          transactions={transactions.filter(t => t.scope === 'personal' && inPeriod(t.date))}
          personalBudget={personalBudget} period={period}
        />
      )}
      {reportType === 'roi' && (
        <ROIReport
          transactions={transactions.filter(t => t.scope === 'business' && inPeriod(t.date))}
          timeEntries={timeEntries.filter(te => inPeriod(te.occurred_at))}
          deals={deals || []}
          systems={systems} settings={settings} period={period}
          inPeriod={inPeriod}
        />
      )}
      {reportType === 'schedule_c' && (
        <React.Suspense fallback={null}><ScheduleCReport userId={userId} taxCategories={taxCategories} /></React.Suspense>
      )}
      {reportType === 'quarterly' && (
        <React.Suspense fallback={null}><QuarterlyTaxReport userId={userId} taxCategories={taxCategories} /></React.Suspense>
      )}
      {reportType === 'form_1099' && (
        <React.Suspense fallback={null}><Form1099Report userId={userId} /></React.Suspense>
      )}
      {reportType === 'budgets' && (
        <React.Suspense fallback={null}><BudgetReport userId={userId} systems={systems} recruitingSystems={recruitingSystems} /></React.Suspense>
      )}
      {reportType === 'cashflow' && (
        <React.Suspense fallback={null}><CashFlowForecast userId={userId} settings={settings} /></React.Suspense>
      )}
    </div>
  );
}
