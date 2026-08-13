// QuarterlyTaxBanner — the "your estimated payment is due" strip.
//
// It renders inside SettingsView and used to be re-exported from
// AccountingViews.jsx, so opening Settings downloaded the ENTIRE ~250KB
// accounting bundle — tax engine, CSV importer, cash-flow forecaster — to show
// one banner. Its own module now.
// Extracted from AccountingViews.jsx.
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { fmtUSD } from '../financeUtils';
import { computeNetProfitFromData, computeQuarterlyTaxProjection, nextQuarterDueLabel } from '../taxMath';

export function QuarterlyTaxBanner({ userId }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [projection, setProjection] = useState(null);
  const [ytdPaid, setYtdPaid] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const now = new Date();
      const yearStart = `${now.getFullYear()}-01-01`;
      const yearEnd = `${now.getFullYear()}-12-31`;
      const [s, tc, tx, mile] = await Promise.all([
        supabase.from('user_tax_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('tax_categories').select('*').eq('user_id', userId).eq('is_archived', false),
        supabase.from('transactions').select('*').eq('user_id', userId).eq('is_archived', false).eq('scope', 'business').gte('date', yearStart).lte('date', yearEnd).limit(5000),
        supabase.from('mileage_entries').select('*').eq('user_id', userId).eq('category', 'business').gte('date', yearStart).lte('date', yearEnd).limit(5000),
      ]);
      if (cancelled) return;
      setSettings(s.data);
      if (!s.data) { setLoading(false); return; }

      const taxCats = tc.data || [];
      const transactions = tx.data || [];
      const mileage = mile.data || [];
      const estPaymentCat = taxCats.find(c => c.name === 'Estimated Tax Payments');
      const paid = estPaymentCat
        ? transactions
            .filter(t => t.tax_category_id === estPaymentCat.id)
            .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0)
        : 0;
      setYtdPaid(paid);

      const np = computeNetProfitFromData(transactions, taxCats, mileage);
      const monthsElapsed = now.getMonth() + 1;
      const proj = computeQuarterlyTaxProjection({
        ytdNetProfit: np.netProfit,
        monthsElapsed,
        year: now.getFullYear(),
        filingStatus: s.data.filing_status || 'single',
        otherIncome: Number(s.data.estimated_other_income) || 0,
        withholding: Number(s.data.withholding_ytd) || 0,
        useQbi: !!s.data.use_qbi_deduction,
        itemizedDeductions: Number(s.data.itemized_deductions) || 0,
        priorYearTax: Number(s.data.prior_year_tax_owed) || null,
        priorYearAgi: Number(s.data.prior_year_agi) || null,
        ytdEstimatedPaid: paid,
      });
      setProjection(proj);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) return null;
  const fmt = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  // State 2: no settings configured — small nudge to set them up
  if (!settings) {
    return (
      <div style={{
        padding:'10px 14px',
        background:'var(--bg-card)',
        border:'1px dashed var(--border)',
        borderRadius:'10px',
        display:'flex',
        alignItems:'center',
        justifyContent:'space-between',
        gap:'10px',
        flexWrap:'wrap',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',minWidth:0,flex:1}}>
          <Icon name="dollar" size={18} style={{flexShrink:0}} />
          <div style={{minWidth:0}}>
            <div style={{fontSize:'12px',fontWeight:700,color:'var(--text-1)'}}>Set up quarterly tax tracking</div>
            <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'1px'}}>
              Enter filing status + prior-year tax → get an automatic "set aside" number every month.
            </div>
          </div>
        </div>
        <div style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap'}}>
          Reports → 💵 Quarterly Tax → ⚙ Tax settings
        </div>
      </div>
    );
  }

  // Banner data
  const isBehind = projection.currentlyOwed > 0;
  const isNothingOwed = projection.totalAnnualTax <= 0;
  const accent = isBehind ? 'var(--red)' : isNothingOwed ? 'var(--text-3)' : 'var(--green)';
  const headlineAmount = isBehind ? projection.currentlyOwed : projection.recommendedQuarterly;
  const nextDue = projection.nextDueQuarter;
  const nextDueLabel = nextDue
    ? nextDue.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'year-end';

  // State 3/4: configured — show the projection banner
  return (
    <div style={{
      padding:'12px 14px',
      background: isBehind
        ? 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(245,158,11,0.08))'
        : isNothingOwed
          ? 'var(--bg-card)'
          : 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(59,130,246,0.05))',
      border: `1px solid ${accent}`,
      borderRadius:'10px',
      display:'flex',
      alignItems:'center',
      justifyContent:'space-between',
      gap:'12px',
      flexWrap:'wrap',
    }}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0,flex:1}}>
        <span style={{fontSize:'22px',flexShrink:0}}>{isBehind ? '⚠️' : isNothingOwed ? '💵' : '✓'}</span>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
            {isBehind
              ? 'Behind on estimated tax payments'
              : isNothingOwed
                ? 'No estimated tax owed at current run rate'
                : `Set aside per quarter · next due ${nextDueLabel}`}
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginTop:'3px',flexWrap:'wrap'}}>
            <span style={{fontSize:'22px',fontWeight:800,color:accent,fontVariantNumeric:'tabular-nums',lineHeight:1}}>
              {fmt(headlineAmount)}
            </span>
            {!isNothingOwed && (
              <span style={{fontSize:'11px',color:'var(--text-3)'}}>
                · {fmt(ytdPaid)} paid YTD of {fmt(projection.expectedYtdPaid)} expected
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap',textAlign:'right'}}>
        Annual proj. {fmt(projection.totalAnnualTax)}<br/>
        <span style={{color:'var(--text-3)'}}>open Reports → 💵 Quarterly Tax for breakdown</span>
      </div>
    </div>
  );
}


// ── Brokerage Dashboard hero strip ────────────────────────────────────────
// Broker/owner only. Six hero tiles: the two Dara asked for (company avg sale
// price + avg commission rate, both on last-12-mo deals with commission
// $2,500–$45,000) plus four "north-star" tiles. Some of the four are live now;
// the rest are marked "soon" so the vision is visible before it's fully built.

export default QuarterlyTaxBanner;
