import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { HeaderSearchIcon, HeaderSearchInput, RecruitingKpiTile } from './SharedUi';
import { useBackClose } from '../backClose';
import { Tip } from '../tipsUi';
import { confirmDialog } from '../notify';
import { fmtHours, fmtPct, fmtUSD, fmtUSDCents } from '../financeUtils';
import { SysStat } from './FinanceSystems';

const TIER_BANDS = [
  { id: 'rookie',       label: 'Rookie',       color: '#cd7f32' },
  { id: 'producer',     label: 'Producer',     color: '#c0c0c0' },
  { id: 'top_producer', label: 'Top Producer', color: '#c5a95e' },
  { id: 'mega',         label: 'Mega',         color: '#fbbf24' },
];


function computeTier(ytdGCI, settings, factor = 1) {
  if (!settings) return TIER_BANDS[0];
  const f = factor > 0 ? factor : 1;
  if (ytdGCI >= settings.tier_mega_min * f) return TIER_BANDS[3];
  if (ytdGCI >= settings.tier_top_producer_min * f) return TIER_BANDS[2];
  if (ytdGCI >= settings.tier_producer_min * f) return TIER_BANDS[1];
  return TIER_BANDS[0];
}

// First-year pro-rata. When an agent starts mid-year, a Jan-1-based annual goal,
// pace clock and budget make them look hopelessly behind and over-budget their
// partial year. With pro-rata on (and an activation date inside the current year),
// annual targets/budgets/time-commitments and the pace clock are scaled to the
// slice of the year the agent is actually active. Off by default -> no change.
function getProrata(settings) {
  const now = new Date();
  const y = now.getFullYear();
  const yearStart = new Date(y, 0, 1);
  const yearEnd = new Date(y, 11, 31);
  const daysInYear = Math.round((new Date(y + 1, 0, 1) - yearStart) / 86400000);
  const enabled = !!(settings && settings.prorate_first_year && settings.activation_date);
  let activeStart = yearStart;
  if (enabled) {
    const a = new Date(settings.activation_date + 'T00:00:00');
    if (!isNaN(a) && a.getFullYear() === y && a > yearStart) activeStart = a;
  }
  const activeDays = Math.round((yearEnd - activeStart) / 86400000) + 1;
  const factor = enabled ? Math.min(1, activeDays / daysInYear) : 1;
  const elapsed = Math.floor((now - activeStart) / 86400000) + 1;
  const activeDaysElapsed = Math.max(1, Math.min(activeDays, elapsed));
  return {
    active: enabled && factor < 1,
    factor, activeStart, activeDays, daysInYear, activeDaysElapsed,
    weeksActive: activeDays / 7,
    pct: Math.round(factor * 100),
    startLabel: activeStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}


function FinanceView({ userId, initialSub = null, subNonce = 0 }) {
  const [subView, setSubView] = useState(initialSub || 'dashboard');
  useEffect(() => { if (initialSub) setSubView(initialSub); }, [initialSub, subNonce]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [taxCategories, setTaxCategories] = useState([]);
  const [personalBudget, setPersonalBudget] = useState([]);
  const [systems, setSystems] = useState([]);
  const [recruitingSystems, setRecruitingSystems] = useState([]);
  const [deals, setDeals] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);
  const recurringRanRef = useRef(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);

    // First, advance any due recurring templates (one call per session)
    if (!recurringRanRef.current) {
      recurringRanRef.current = true;
      try {
        const { data: runResult } = await supabase.functions.invoke('run-recurring-transactions', { body: {} });
        if (runResult?.created > 0 && window.__notify) {
          window.__notify(`${runResult.created} recurring transaction${runResult.created>1?'s':''} added`, 'success');
        }
      } catch (e) {
        console.warn('Recurring runner failed (non-fatal):', e);
      }
    }

    const [s, tc, pb, sys, tx, comp, te, tmpl, rec, rsys, dl] = await Promise.all([
      supabase.from('finance_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('tax_categories').select('*').eq('user_id', userId).eq('is_archived', false).order('sort_order'),
      supabase.from('personal_budget_lines').select('*').eq('user_id', userId).eq('is_archived', false).order('sort_order'),
      supabase.from('lead_gen_systems').select('*').eq('user_id', userId).eq('is_active', true).order('is_overhead', { ascending: false }).order('name'),
      supabase.from('transactions').select('*').eq('user_id', userId).eq('is_archived', false).order('date', { ascending: false }).limit(500),
      supabase.from('prospecting_completions').select('*').eq('user_id', userId).gte('date', last30.toISOString().slice(0,10)).order('date', { ascending: false }),
      supabase.from('time_entries').select('*').eq('user_id', userId).gte('occurred_at', yearStart).order('occurred_at', { ascending: false }),
      supabase.from('lead_gen_system_templates').select('*').order('system_number'),
      supabase.from('recurring_transactions').select('*').eq('user_id', userId).order('next_run_date'),
      supabase.from('recruiting_systems').select('*').eq('user_id', userId).eq('is_active', true).order('is_overhead', { ascending: false }).order('name'),
      supabase.from('deals').select('*').eq('user_id', userId).limit(2000),
    ]);
    setSettings(s.data);
    setTaxCategories(tc.data || []);
    setPersonalBudget(pb.data || []);
    setSystems(sys.data || []);
    setRecruitingSystems(rsys.data || []);
    setTransactions(tx.data || []);
    setCompletions(comp.data || []);
    setTimeEntries(te.data || []);
    setTemplates(tmpl.data || []);
    setRecurringTemplates(rec.data || []);
    setDeals(dl.data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const trackPersonal = !!(settings?.track_personal);
  const userMode = settings?.user_mode || 'agent';
  const readOnly = userMode === 'partner';
  const isCoach = userMode === 'coach';
  const maxSystems = settings?.max_systems_allowed || 5;

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const ytdTx = transactions.filter(t => new Date(t.date) >= yearStart);
  const ytdIncome  = ytdTx.filter(t => t.scope === 'business' && Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const ytdExpense = ytdTx.filter(t => t.scope === 'business' && Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);
  const ytdNet = ytdIncome + ytdExpense;
  const tier = computeTier(ytdIncome, settings, getProrata(settings).factor);

  if (loading) return <div className="loading-screen"><div className="spinner"/></div>;

  async function changeUserMode(newMode) {
    await supabase.from('finance_settings').update({ user_mode: newMode }).eq('user_id', userId);
    setSettings(prev => ({ ...prev, user_mode: newMode }));
  }

  // One cohesive segmented-control language for both the mode switch and the
  // Mode switch + sub-tabs share one segmented-control language (see .seg-track
  // / .seg-btn in index.css): a recessed track with a gold-gradient active pill,
  // hover lift, and press feedback — so both controls read as a matched set.

  return (
    <div className="view ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .seg-track{background:#18130D;border:1px solid rgba(203,163,92,.18);} .ww-prism .seg-btn{color:#C8BFAE;} .ww-prism .seg-btn.active{background:linear-gradient(180deg,#EBCB82,#CBA35C)!important;color:#1a1409!important;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      {readOnly && (
        <div style={{padding:'8px 12px',background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.4)',borderRadius:'8px',marginBottom:'10px',fontSize:'12px',color:'var(--text-1)'}}>
          <Icon name="eye" size={13} style={{verticalAlign:'-2px'}} /> <strong>Partner mode</strong> — accountability view, read-only. Switch back in the mode pills above.
        </div>
      )}
      {isCoach && (
        <div style={{padding:'8px 12px',background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',borderRadius:'8px',marginBottom:'10px',fontSize:'12px',color:'var(--text-1)'}}>
          <Icon name="target" size={13} style={{verticalAlign:'-2px'}} /> <strong>Coach mode</strong> — system caps lifted, extra detail visible in reports.
        </div>
      )}

      <div className="view-header" style={{display:'flex',flexDirection:'column',gap:'12px',marginBottom:'14px'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'9px'}}><Icon name="finance" size={22} style={{color:'var(--accent)'}} /> Finance Dashboard</span>
            {settings && (
              <span className="fin-badge" style={{background:`${tier.color}1f`, color:tier.color, border:`1px solid ${tier.color}59`}}>{tier.label}</span>
            )}
            {settings?.current_prospecting_streak > 0 && (
              <span className="fin-badge" title={`Best ever: ${settings.best_prospecting_streak}`}
                style={{background:'rgba(239,68,68,0.13)', color:'#f06b6b', border:'1px solid rgba(239,68,68,0.4)', textTransform:'none', letterSpacing:'0.02em'}}>🔥 {settings.current_prospecting_streak}-day streak</span>
            )}
          </h2>
          <span style={{fontSize:'12px',color:'var(--text-3)',display:'inline-block',marginTop:'5px'}}>
            YTD: <strong style={{color:ytdNet>=0?'var(--green)':'var(--red)'}}>{fmtUSD(ytdNet)}</strong> net
            {' · '}<span style={{color:'var(--text-2)'}}>{fmtUSD(ytdIncome)} in</span>
            {' · '}<span style={{color:'var(--text-2)'}}>{fmtUSD(-ytdExpense)} out</span>
          </span>
        </div>

        {/* Mode switch — full-width segmented control */}
        <div className="seg-track" role="tablist" aria-label="Finance mode">
          {['agent','partner','coach'].map(m => (
            <button key={m} type="button" onClick={() => changeUserMode(m)}
              className={`seg-btn${userMode===m?' active':''}`}
              aria-selected={userMode===m}
              title={m === 'agent' ? 'Your full workspace' : m === 'partner' ? 'Read-only accountability view' : 'Coach: unlocks system limits + extra reports'}>
              <span style={{textTransform:'capitalize'}}>{m}</span>
            </button>
          ))}
        </div>

        {/* Sub-tabs — same segmented language, equal segments (no clipping) */}
        <div className="seg-track" role="tablist" aria-label="Finance section">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'blueprint', label: 'Blueprint' },
            { id: 'ledger',    label: 'Ledger' },
            { id: 'reports',   label: 'Reports' },
          ].map(t => (
            <button key={t.id} type="button" onClick={() => setSubView(t.id)}
              className={`seg-btn${subView===t.id?' active':''}`}
              aria-selected={subView===t.id}>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {subView === 'dashboard' && (<>
        <BrokerageHeroStrip />
        <CommissionSheetSettings />
        <FinanceDashboard
          userId={userId} settings={settings} setSettings={setSettings}
          ytdIncome={ytdIncome} ytdExpense={ytdExpense} ytdNet={ytdNet}
          transactions={transactions} systems={systems} tier={tier}
          completions={completions} setCompletions={setCompletions}
          readOnly={readOnly}
          onGoLedger={() => setSubView('ledger')}
          onGoBlueprint={() => setSubView('blueprint')}
          onGoSystems={() => setSubView('systems')}
        />
      </>)}
      {subView === 'blueprint' && (
        <FinanceBlueprint
          userId={userId} settings={settings} setSettings={setSettings}
          personalBudget={personalBudget} setPersonalBudget={setPersonalBudget}
          taxCategories={taxCategories} setTaxCategories={setTaxCategories}
          systems={systems} timeEntries={timeEntries} reload={loadAll} readOnly={readOnly}
          isCoach={isCoach} maxSystems={maxSystems}
        />
      )}
      {subView === 'ledger' && (
        <FinanceLedger
          userId={userId} transactions={transactions} setTransactions={setTransactions}
          taxCategories={taxCategories} systems={systems} personalBudget={personalBudget}
          recurringTemplates={recurringTemplates} setRecurringTemplates={setRecurringTemplates}
          trackPersonal={trackPersonal} readOnly={readOnly}
        />
      )}
      {subView === 'reports' && (
        <FinanceReports
          userId={userId}
          settings={settings} transactions={transactions} taxCategories={taxCategories}
          systems={systems} recruitingSystems={recruitingSystems}
          personalBudget={personalBudget} timeEntries={timeEntries} deals={deals}
          trackPersonal={trackPersonal} isCoach={isCoach}
        />
      )}
    </div>
  );
}

// ─── FinanceDashboard ────────────────────────────────────────────────
// ─── QuarterlyTaxBanner ──────────────────────────────────────────────
// Compact dashboard surface for the Quarterly Tax projection. Lives at
// the top of FinanceDashboard so the "set aside this month" number is
// visible the moment you open Finance — no need to dig into Reports →
// Quarterly Tax to see whether you're on track.
//
// Self-fetching: pulls user_tax_settings, tax_categories, current-year
// business transactions, and current-year business mileage. Reuses the
// existing pure functions computeNetProfitFromData() and
// computeQuarterlyTaxProjection() so the number matches the Reports tab
// exactly.
//
// Four render states:
//   1. Loading        → returns null (no flash of empty UI)
//   2. No settings    → small "Set up tax tracking" prompt with hint
//   3. Behind         → red banner with catch-up amount + next due date
//   4. On track       → green banner with per-quarter amount + next due date

function QuarterlyTaxBanner({ userId }) {
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
function compactMoney(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 2) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
// ── Commission Sheet link (Broker Settings) ───────────────────────────────
// Paste the Google Sheet URL, map tabs → years, sync now, and swap the file at
// year-end. The nightly `sheets-sync` reads whatever is configured here.
function CommissionSheetSettings() {
  const [cfg, setCfg] = useState(undefined);
  const [isBroker, setIsBroker] = useState(false);
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState([{ tab: 'Paid 2026', year: 2026 }, { tab: 'Paid 2025', year: 2025 }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { (async () => {
    try {
      const { data: dash } = await supabase.rpc('brokerage_dashboard');
      if (!dash || !dash.allowed) { setIsBroker(false); setCfg(null); return; }
      setIsBroker(true);
      const { data } = await supabase.from('commission_sheet_config').select('*').eq('is_active', true).order('updated_at', { ascending: false }).limit(1);
      const c = data?.[0] || null; setCfg(c);
      if (c) { setUrl(c.sheet_url || ''); if (Array.isArray(c.tab_map) && c.tab_map.length) setRows(c.tab_map); }
    } catch (_) { setIsBroker(false); setCfg(null); }
  })(); }, []);

  if (cfg === undefined) return null;
  if (!isBroker) return null;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data: idData } = await supabase.rpc('extract_sheet_id', { p_url: url });
      const sid = idData || url;
      const { data: u } = await supabase.auth.getUser();
      const payload = { user_id: u?.user?.id, spreadsheet_id: sid, sheet_url: url, tab_map: rows, is_active: true, updated_at: new Date().toISOString() };
      let res;
      if (cfg?.id) res = await supabase.from('commission_sheet_config').update(payload).eq('id', cfg.id).select().single();
      else res = await supabase.from('commission_sheet_config').insert(payload).select().single();
      if (res.error) throw res.error;
      setCfg(res.data); setMsg({ ok: true, t: 'Saved. The sheet will sync nightly.' });
    } catch (e) { setMsg({ ok: false, t: 'Could not save: ' + (e.message || e) }); }
    setBusy(false);
  };

  const syncNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('sheets-sync', { body: cfg?.id ? { config_id: cfg.id } : {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'sync failed');
      const s = (data.summary || []).map((x) => `${x.tab}: ${x.transactions ?? 0} txns${x.error ? ' (' + x.error + ')' : ''}`).join(' · ');
      setMsg({ ok: true, t: 'Synced. ' + s });
      const { data: fresh } = await supabase.from('commission_sheet_config').select('*').eq('id', cfg.id).single();
      if (fresh) setCfg(fresh);
    } catch (e) { setMsg({ ok: false, t: 'Sync failed: ' + (e.message || e) }); }
    setBusy(false);
  };

  const lab = { fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 };
  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 13 };

  return (
    <div style={{ marginBottom: 16, padding: '15px 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.2em', fontSize: 11, fontWeight: 700 }}>Commission Sheet</span>
        {cfg?.last_synced_at && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· last synced {new Date(cfg.last_synced_at).toLocaleString()}</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
        Link the live Google Sheet. It reconciles nightly — edit a past row and Prism updates it. Swap the file here at year-end.
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={lab}>Google Sheet URL</div>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" style={inp} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={lab}>Tabs to sync</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input value={r.tab} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, tab: e.target.value } : x))} placeholder="Tab name (e.g. Paid 2026)" style={{ ...inp, flex: '1 1 auto' }} />
            <input value={r.year} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, year: parseInt(e.target.value) || '' } : x))} inputMode="numeric" placeholder="Year" style={{ ...inp, width: 84, flex: 'none' }} />
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))} style={{ ...inp, width: 40, flex: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>×</button>
          </div>
        ))}
        <button onClick={() => setRows([...rows, { tab: '', year: new Date().getFullYear() }])} style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-2)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>+ Add a tab</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={save} disabled={busy || !url} style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: (busy || !url) ? .6 : 1 }}>{busy ? 'Working…' : 'Save link'}</button>
        {cfg?.id && <button onClick={syncNow} disabled={busy} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>Sync now</button>}
        {msg && <span style={{ fontSize: 12, color: msg.ok ? '#22c55e' : '#ef4444' }}>{msg.t}</span>}
      </div>
    </div>
  );
}

function BrokerageHeroStrip() {
  const [d, setD] = useState(undefined);
  useEffect(() => { (async () => {
    try { const { data, error } = await supabase.rpc('brokerage_dashboard'); if (error) throw error; setD(data); }
    catch (_) { setD(null); }
  })(); }, []);
  if (d === undefined) return <div style={{ padding: '18px 4px', color: 'var(--text-3)', fontSize: 12.5 }}>Loading brokerage numbers…</div>;
  if (!d || !d.allowed) return null; // non-brokerage viewers see nothing

  const G = '#C5A95E', CHAMP = '#EBCB82';
  const tiles = [
    { lab: 'Company Avg Sale Price', val: compactMoney(d.avg_price), sub: 'last 12 mo · $2.5K–$45K comm', live: true, hero: true },
    { lab: 'Avg Commission Rate', val: (d.avg_rate != null ? d.avg_rate + '%' : '—'), sub: 'same qualified deals', live: true, hero: true },
    { lab: 'Company Volume (YTD)', val: compactMoney(d.ytd_volume), sub: `${num(d.ytd_units)} closings · ${compactMoney(d.ytd_gci)} GCI`, live: true },
    { lab: 'Agents On-Track', val: d.on_track ? `${d.on_track.on}/${d.on_track.total}` : '—', sub: 'hitting their GCI goal — who needs a nudge?', live: true },
    { lab: 'Recruiting Pipeline', val: 'Soon', sub: 'projected GCI walking in the door', live: false },
    { lab: 'Retention & Health', val: 'Soon', sub: 'who\u2019s thriving, who\u2019s at risk', live: false },
  ];

  return (
    <div className="fade-up" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700 }}>Brokerage Dashboard</span>
        <span className="live-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
        <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{d.year} · {num(d.producers)} producing / {num(d.roster)} roster</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        {tiles.map((t, i) => (
          <div key={i} style={{
            position: 'relative', padding: '14px 15px', borderRadius: 14,
            background: t.hero ? 'linear-gradient(155deg, rgba(197,169,94,.14), rgba(197,169,94,.03))' : 'var(--bg-card)',
            border: '1px solid ' + (t.hero ? 'rgba(197,169,94,.45)' : 'var(--border)'),
            opacity: t.live ? 1 : .62,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.lab}</span>
              {!t.live && <span style={{ fontSize: 8.5, fontWeight: 800, color: G, border: '1px solid ' + G, borderRadius: 4, padding: '1px 4px' }}>SOON</span>}
            </div>
            <div className={t.hero ? 'gold-move' : ''} style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 26, lineHeight: 1, color: t.hero ? undefined : CHAMP, marginBottom: 5 }}>{t.val}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


function FinanceDashboard({
  userId, settings, setSettings, ytdIncome, ytdExpense, ytdNet,
  transactions, systems, tier, completions, setCompletions, readOnly,
  onGoLedger, onGoBlueprint, onGoSystems,
}) {
  const pr = getProrata(settings);
  const fullGoal = Number(settings?.annual_gci_goal) || 150000;
  const goal = fullGoal * pr.factor;
  const pct = goal > 0 ? Math.min(1, ytdIncome / goal) : 0;
  const now = new Date();
  const dayOfYear = pr.activeDaysElapsed;
  const expectedPct = pr.activeDays > 0 ? dayOfYear / pr.activeDays : 0;
  const expectedYTD = goal * expectedPct;
  const paceDelta = ytdIncome - expectedYTD;
  const paceStatus = paceDelta >= 0
    ? { label: `Ahead by ${fmtUSD(paceDelta)}`, color: 'var(--green)' }
    : { label: `Behind by ${fmtUSD(-paceDelta)}`, color: 'var(--red)' };
  const recent = transactions.slice(0, 5);

  const today = today_ymd();
  const todaysTasks = [];
  systems.forEach(sys => {
    if (sys.is_overhead) return;
    const tasks = Array.isArray(sys.daily_tasks) ? sys.daily_tasks : [];
    tasks.forEach(t => {
      const completion = completions.find(c => c.system_id === sys.id && c.task_id === t.id && c.date === today);
      todaysTasks.push({
        systemId: sys.id, systemName: sys.name, systemColor: sys.color,
        taskId: t.id, desc: t.desc, target: t.daily_target || 1,
        count_done: completion?.count_done || 0,
        completionId: completion?.id || null,
      });
    });
  });
  const tasksTotal = todaysTasks.length;
  const tasksDone = todaysTasks.filter(t => t.count_done >= t.target).length;

  async function toggleTaskCompletion(task) {
    if (readOnly) return;
    const newCount = task.count_done >= task.target ? 0 : task.target;
    if (task.completionId) {
      await supabase.from('prospecting_completions').update({ count_done: newCount, completed_at: new Date().toISOString() }).eq('id', task.completionId);
      setCompletions(prev => prev.map(c => c.id === task.completionId ? { ...c, count_done: newCount } : c));
    } else {
      const { data } = await supabase.from('prospecting_completions').insert({
        user_id: userId, system_id: task.systemId, task_id: task.taskId, date: today,
        count_done: newCount, target: task.target,
      }).select().single();
      if (data) setCompletions(prev => [data, ...prev]);
    }
    await maybeUpdateStreak();
  }

  async function maybeUpdateStreak() {
    if (!settings) return;
    const fresh = await supabase.from('prospecting_completions').select('date,count_done').eq('user_id', userId).gte('count_done', 1).order('date', { ascending: false }).limit(100);
    const freshDates = new Set((fresh.data || []).map(r => r.date));
    let streak = 0;
    const cursor = new Date();
    while (true) {
      const ymd = cursor.toISOString().slice(0,10);
      if (freshDates.has(ymd)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else if (streak === 0 && ymd === today_ymd()) { cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    const best = Math.max(streak, settings.best_prospecting_streak || 0);
    if (streak !== settings.current_prospecting_streak || best !== settings.best_prospecting_streak) {
      await supabase.from('finance_settings').update({
        current_prospecting_streak: streak, best_prospecting_streak: best,
        last_prospecting_date: streak > 0 ? today_ymd() : settings.last_prospecting_date,
      }).eq('user_id', userId);
      setSettings(prev => ({ ...prev, current_prospecting_streak: streak, best_prospecting_streak: best, last_prospecting_date: streak > 0 ? today_ymd() : prev.last_prospecting_date }));
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      <div className="panel" style={{padding:'18px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px',flexWrap:'wrap',gap:'8px'}}>
          <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>YTD GCI vs goal</span>
          <span style={{fontSize:'11px',color:paceStatus.color,fontWeight:600}}>{paceStatus.label}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'10px'}}>
          <span style={{fontSize:'38px',fontWeight:300,fontFamily:'Fraunces, serif',letterSpacing:'-0.01em',color:'var(--text-1)',lineHeight:1}}>{fmtUSD(ytdIncome)}</span>
          <span style={{fontSize:'14px',color:'var(--text-3)'}}>of {fmtUSD(goal)}{pr.active ? ' · first-yr' : ''}</span>
        </div>
        <div style={{position:'relative',height:'14px',background:'var(--bg-base)',borderRadius:'7px',overflow:'hidden',border:'1px solid var(--border)'}}>
          <div style={{width:`${pct * 100}%`,height:'100%',background:`linear-gradient(90deg, ${tier.color} 0%, var(--accent-2) 100%)`,transition:'width 0.5s ease'}}/>
          <div style={{position:'absolute',top:'-3px',bottom:'-3px',left:`${expectedPct * 100}%`,width:'2px',background:paceStatus.color,opacity:0.7}} title={`Pace: ${fmtUSD(expectedYTD)} by day ${dayOfYear}`}/>
        </div>
        <div style={{marginTop:'6px',fontSize:'11px',color:'var(--text-3)'}}>
          {fmtPct(pct, 0)} to goal · pace marker at {fmtPct(expectedPct, 0)} (day {dayOfYear} of {pr.active ? pr.activeDays : 365}){pr.active ? ` · first year pro-rated to ${pr.pct}% from ${pr.startLabel}` : ''}
        </div>
      </div>

      <Tip id="gci" label="Know your number">Your GCI pace shows whether you're <b>ahead or behind goal</b>, prorated to the days you've actually worked. Agents who check their number <b>weekly</b> hit goals; agents who guess, hope. Glance here often — it's your scoreboard.</Tip>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'10px'}}>
        <KpiTile label="This month net" value={fmtUSD(monthNet(transactions, 'business'))} sub="business" />
        <KpiTile label="YTD expense" value={fmtUSD(-ytdExpense)} sub="business deductions" />
        <KpiTile label="Projected EOY" value={fmtUSD(goal && expectedPct > 0 ? ytdIncome / expectedPct : ytdIncome)} sub="straight-line projection" />
        <KpiTile label="Next tax estimate" value={fmtUSD(nextTaxEstimate(ytdIncome, settings))} sub={nextQuarterDueLabel()} />
      </div>

      <div className="panel" style={{padding:'12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
          <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700}}>Recent activity</span>
          <button className="btn btn-ghost btn-sm" onClick={onGoLedger}>View all →</button>
        </div>
        {recent.length === 0 ? (
          <div style={{padding:'20px',textAlign:'center'}}>
            <div style={{marginBottom:'6px'}}><Icon name="notes" size={30} style={{color:'var(--text-3)'}} /></div>
            <p style={{fontSize:'13px',color:'var(--text-2)',marginBottom:'10px'}}>No transactions yet.</p>
            {!readOnly && <button className="btn btn-primary btn-sm" onClick={onGoLedger}>Add your first transaction</button>}
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            {recent.map(t => (
              <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 4px',borderBottom:'1px solid var(--border)',fontSize:'13px'}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{color:'var(--text-1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.payee || t.description || '(no payee)'}</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)'}}>{t.date}</div>
                </div>
                <span style={{fontWeight:700,color:Number(t.amount)>=0?'var(--green)':'var(--text-1)',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtUSDCents(t.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button className="btn btn-ghost" onClick={onGoBlueprint} style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="ruler" size={14} /> Open Blueprint</button>
          <button className="btn btn-ghost" onClick={onGoLedger}>+ Add transaction</button>
        </div>
      )}
    </div>
  );
}


function KpiTile({ label, value, sub }) {
  return (
    <div className="panel" style={{padding:'12px'}}>
      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:'4px'}}>{label}</div>
      <div style={{fontSize:'18px',fontWeight:700,color:'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{value}</div>
      <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>
    </div>
  );
}


function monthNet(transactions, scope) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  return transactions.filter(t => new Date(t.date) >= monthStart && (!scope || t.scope === scope))
    .reduce((s, t) => s + Number(t.amount), 0);
}

function nextTaxEstimate(ytdIncome, settings) {
  if (!settings) return 0;
  return Math.max(0, ytdIncome * Number(settings.estimated_tax_pct) / 4);
}

function nextQuarterDueLabel() {
  const now = new Date();
  const dates = [
    { date: new Date(now.getFullYear(), 3, 15),  label: 'due Apr 15' },
    { date: new Date(now.getFullYear(), 5, 15),  label: 'due Jun 15' },
    { date: new Date(now.getFullYear(), 8, 15),  label: 'due Sep 15' },
    { date: new Date(now.getFullYear()+1, 0, 15), label: 'due Jan 15' },
  ];
  const next = dates.find(d => d.date > now);
  return next ? next.label : 'this quarter';
}

// ─── FinanceBlueprint ────────────────────────────────────────────────

// Schedule C lines offered when creating/editing a custom business category.
const BIZ_CAT_LINES = [
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
const bpInput = { padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',width:'100%',boxSizing:'border-box' };
const bpAddWrap = { marginTop:'10px',padding:'12px',background:'var(--bg-base)',borderRadius:'8px',border:'1px solid var(--accent)',display:'flex',flexDirection:'column',gap:'8px' };
const bpIconBtn = { width:'26px',height:'26px',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-2)',fontSize:'15px',lineHeight:1,cursor:'pointer',padding:0 };
const bpKpiCol = { flex:1,minWidth:'130px',padding:'12px',background:'var(--bg-base)',borderRadius:'8px' };
const bpKpiLabel = { fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700 };
const bpKpiNum = { fontSize:'22px',fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:'4px' };
const bpKpiSub = { fontSize:'11px',color:'var(--text-3)',marginTop:'3px',fontVariantNumeric:'tabular-nums' };

// Personal budget row: inline rename + delete; amount keeps monthly/annual behavior.
function PersonalBudgetRow({ line, onChangeAmount, onSaveLabel, onDelete, readOnly }) {
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
function TaxCatRow({ cat, isAdv, advValue, onChangeBudget, onSaveMeta, onDelete, readOnly }) {
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

function FinanceBlueprint({
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


function BudgetRow({ line, onChange, readOnly }) {
  const usesAnnual = line.is_vacation || line.is_savings;
  const value = usesAnnual ? (line.annual_amount ?? '') : (line.monthly_amount ?? '');
  const placeholder = usesAnnual ? 'annual' : 'monthly';
  const accent = line.is_vacation ? '#22c55e' : line.is_savings ? '#3b82f6' : 'transparent';
  return (
    <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 8px',borderRadius:'6px'}}>
      <div style={{width:'4px',height:'24px',background:accent,borderRadius:'2px',flexShrink:0}}/>
      <span style={{flex:1,fontSize:'13px',color:'var(--text-1)',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
        {line.category}
        {usesAnnual && <span style={{color:accent,fontSize:'10px',marginLeft:'6px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>annual</span>}
      </span>
      <span style={{color:'var(--text-3)',fontSize:'13px'}}>$</span>
      <input type="number" step="1" value={value} placeholder={placeholder} disabled={readOnly}
        onChange={e => {
          const v = e.target.value === '' ? 0 : Number(e.target.value);
          if (usesAnnual) onChange(line.id, { annual_amount: v });
          else onChange(line.id, { monthly_amount: v });
        }}
        style={{width:'110px',padding:'5px 8px',textAlign:'right',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',fontVariantNumeric:'tabular-nums'}}/>
    </div>
  );
}


function SettingInput({ label, value, prefix, suffix, onSave, step = "1", readOnly }) {
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


function WaterfallRow({ label, value, icon, sub, tone }) {
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

function FinanceLedger({ userId, transactions, setTransactions, taxCategories, systems, personalBudget, recurringTemplates, setRecurringTemplates, trackPersonal, readOnly }) {
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
        <CsvImportModal
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
        />
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

function parseCSV(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', i = 0, inQuotes = false;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop blank trailing rows
  while (rows.length && rows[rows.length-1].every(c => c.trim() === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
  return { headers, rows: dataRows };
}

// Best-effort date parser. Banks use MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD,
// MM-DD-YY, etc. We try a few patterns in order of US-bank prevalence
// and return ISO YYYY-MM-DD or null.

function parseFlexibleDate(raw, formatHint) {
  if (!raw) return null;
  const s = String(raw).trim();
  // ISO already (YYYY-MM-DD)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // US format MM/DD/YYYY or MM/DD/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m && formatHint !== 'dmy') {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // DD/MM/YYYY (European)
  if (m && formatHint === 'dmy') {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  // MM-DD-YYYY with dashes
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (m) {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // Last resort: native Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Parse a money string ($, commas, parens-for-negative). Returns a Number.

function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  let s = String(raw).trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

// Heuristic to auto-pick a column when first opening the modal.
// Looks for header strings that commonly mean date/payee/amount across
// banks (BofA, Chase, Wells Fargo, Capital One, Amex, Citi, etc.).

function guessColumn(headers, kind) {
  const lc = headers.map(h => h.toLowerCase());
  const patterns = {
    date: [/^date$/, /trans.*date/, /posting.*date/, /^post.*date/, /eff.*date/, /trade.*date/],
    payee: [/^description$/, /^payee$/, /^merchant$/, /^name$/, /^detail/, /^memo$/, /transaction/],
    amount: [/^amount$/, /^total$/, /^debit.*credit/, /^transaction.*amount/],
    debit: [/^debit$/, /^withdraw/, /^charges$/, /^outflow/, /^paid out/, /^payments$/],
    credit: [/^credit$/, /^deposit/, /^inflow/, /^paid in/, /^payments rec/],
    description: [/^memo$/, /^note$/, /^category$/, /^description$/],
    external_id: [/^reference/, /^transaction.*id$/, /^txn.*id$/, /^id$/, /^check.*number/],
  };
  for (const re of (patterns[kind] || [])) {
    for (let i = 0; i < lc.length; i++) if (re.test(lc[i])) return headers[i];
  }
  return '';
}


function CsvImportModal({ userId, existingTransactions, taxCategories, trackPersonal, onClose, onImported, onBatchRevoked }) {


  useBackClose(onClose);
  const [tab, setTab] = useState('new');        // 'new' | 'recent' — top-level toggle
  const [step, setStep] = useState('upload');   // 'upload' | 'map' | 'preview' | 'importing' | 'done'
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [error, setError] = useState('');

  // Mapping state — what user has chosen for each column
  const [dateCol, setDateCol] = useState('');
  const [dateFormat, setDateFormat] = useState('mdy'); // 'mdy' | 'dmy' | 'auto'
  const [payeeCol, setPayeeCol] = useState('');
  const [amountMode, setAmountMode] = useState('single'); // 'single' | 'debit_credit'
  const [amountCol, setAmountCol] = useState('');
  const [debitCol, setDebitCol] = useState('');
  const [creditCol, setCreditCol] = useState('');
  const [amountSign, setAmountSign] = useState('standard'); // 'standard' | 'inverted'
  const [descCol, setDescCol] = useState('');
  const [extIdCol, setExtIdCol] = useState('');
  const [defaultScope, setDefaultScope] = useState('business');
  const [defaultAccount, setDefaultAccount] = useState('');

  // Preview state
  const [parsedRows, setParsedRows] = useState([]);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [importResult, setImportResult] = useState(null);

  // Saved bank profiles (csv_import_profiles) — reusable column mappings.
  // Loaded once on mount; used both for auto-detect (after upload) and as
  // a manual picker if the user wants to apply a different one.
  const [profiles, setProfiles] = useState([]);
  const [appliedProfileId, setAppliedProfileId] = useState(null);
  const [showSaveProfile, setShowSaveProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Recent import batches — surface in the 'Recent' tab so user can
  // revoke (archive) a batch that imported wrong.
  const [recentBatches, setRecentBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [revokingBatchId, setRevokingBatchId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.from('csv_import_profiles').select('*')
        .eq('user_id', userId).order('last_used_at', { ascending: false, nullsFirst: false }).order('name');
      if (!cancelled) setProfiles(data || []);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Load recent import batches by aggregating transactions with import_batch_id
  async function loadRecentBatches() {
    setLoadingBatches(true);
    const { data } = await supabase.from('transactions')
      .select('import_batch_id, import_source, imported_at, amount, is_archived')
      .eq('user_id', userId)
      .not('import_batch_id', 'is', null)
      .order('imported_at', { ascending: false })
      .limit(500);
    // Group by batch
    const map = new Map();
    for (const t of (data || [])) {
      if (!map.has(t.import_batch_id)) {
        map.set(t.import_batch_id, {
          id: t.import_batch_id, source: t.import_source, importedAt: t.imported_at,
          rowCount: 0, activeRowCount: 0, archivedRowCount: 0,
          totalAmount: 0, activeTotal: 0,
        });
      }
      const b = map.get(t.import_batch_id);
      b.rowCount++;
      b.totalAmount += Number(t.amount) || 0;
      if (t.is_archived) b.archivedRowCount++;
      else { b.activeRowCount++; b.activeTotal += Number(t.amount) || 0; }
    }
    setRecentBatches(Array.from(map.values()).slice(0, 20));
    setLoadingBatches(false);
  }

  useEffect(() => {
    if (tab === 'recent') loadRecentBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Apply a saved profile to the current mapping state. Mostly a state
  // assignment — does not auto-advance, lets the user verify on /map.
  function applyProfile(p) {
    if (!p) return;
    setDateCol(p.date_column || '');
    setDateFormat(p.date_format === 'dmy' ? 'dmy' : p.date_format === 'auto' ? 'auto' : 'mdy');
    setPayeeCol(p.payee_column || '');
    setAmountMode(p.amount_mode || 'single');
    setAmountCol(p.amount_column || '');
    setDebitCol(p.debit_column || '');
    setCreditCol(p.credit_column || '');
    setAmountSign(p.amount_sign === 'inverted' ? 'inverted' : 'standard');
    setDescCol(p.description_column || '');
    setExtIdCol(p.external_id_column || '');
    setDefaultScope(p.default_scope || 'business');
    if (p.default_account) setDefaultAccount(p.default_account);
    setAppliedProfileId(p.id);
  }

  // Detect a profile that matches the current file's headers (all the
  // profile's referenced columns must exist in the uploaded file). Returns
  // the best match or null.
  function findMatchingProfile(headerList) {
    const headerSet = new Set(headerList);
    for (const p of profiles) {
      const needed = [p.date_column, p.payee_column];
      if (p.amount_mode === 'single') needed.push(p.amount_column);
      else needed.push(p.debit_column, p.credit_column);
      const allPresent = needed.every(c => c && headerSet.has(c));
      if (allPresent) return p;
    }
    return null;
  }

  // Drag-and-drop state for the upload step
  const [isDragOver, setIsDragOver] = useState(false);

  // Process a File object (from input or drop). Validates that it's a
  // CSV, then parses + advances to the map step.
  function processFile(file) {
    if (!file) return;
    // Validate MIME / extension — browsers don't always set type for CSV
    // (especially on drag from Finder), so fall back to extension check.
    const isCsv = (file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || /\.csv$/i.test(file.name));
    if (!isCsv) {
      setError(`Not a CSV file (${file.name}). Drop a .csv exported from your bank or credit card.`);
      return;
    }
    setFileName(file.name);
    setError('');
    setAppliedProfileId(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { headers: h, rows: r } = parseCSV(ev.target.result);
        if (h.length === 0) { setError('File appears empty or has no header row.'); return; }
        if (r.length === 0) { setError('Header row found but no data rows.'); return; }
        setHeaders(h); setRawRows(r);
        // Account default = filename stem (without extension) — always set
        // first so a profile's default_account can override.
        setDefaultAccount(file.name.replace(/\.[^.]+$/, ''));
        // Tier 1: try to match a saved profile against the file's headers
        const matchingProfile = findMatchingProfile(h);
        if (matchingProfile) {
          applyProfile(matchingProfile);
        } else {
          // Tier 2: header-pattern heuristic for known bank formats
          const guessedDate = guessColumn(h, 'date');
          const guessedPayee = guessColumn(h, 'payee');
          const guessedAmt = guessColumn(h, 'amount');
          const guessedDebit = guessColumn(h, 'debit');
          const guessedCredit = guessColumn(h, 'credit');
          const guessedExtId = guessColumn(h, 'external_id');
          setDateCol(guessedDate);
          setPayeeCol(guessedPayee);
          if (guessedAmt) {
            setAmountMode('single'); setAmountCol(guessedAmt);
          } else if (guessedDebit && guessedCredit) {
            setAmountMode('debit_credit'); setDebitCol(guessedDebit); setCreditCol(guessedCredit);
          }
          setExtIdCol(guessedExtId);
        }
        setStep('map');
      } catch (err) {
        setError('Could not parse CSV: ' + err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
  }

  function onFile(e) {
    processFile(e.target.files?.[0]);
  }

  // Drag handlers — onDragOver must call preventDefault for drop to fire
  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragOver(false);
  }
  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  // Persist current mapping as a reusable profile
  async function saveAsProfile() {
    if (!newProfileName.trim()) return;
    setSavingProfile(true);
    const payload = {
      user_id: userId,
      name: newProfileName.trim(),
      date_column: dateCol,
      date_format: dateFormat,
      payee_column: payeeCol,
      amount_mode: amountMode,
      amount_column: amountMode === 'single' ? amountCol : null,
      debit_column: amountMode === 'debit_credit' ? debitCol : null,
      credit_column: amountMode === 'debit_credit' ? creditCol : null,
      amount_sign: amountSign,
      description_column: descCol || null,
      external_id_column: extIdCol || null,
      default_scope: defaultScope,
      default_account: defaultAccount || null,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    };
    const { data, error: err } = await supabase.from('csv_import_profiles').insert(payload).select().single();
    setSavingProfile(false);
    if (err) {
      if (window.__notify) window.__notify('Save failed: ' + err.message, 'error');
      return;
    }
    setProfiles(prev => [data, ...prev]);
    setAppliedProfileId(data.id);
    setShowSaveProfile(false);
    setNewProfileName('');
    if (window.__notify) window.__notify(`Saved profile "${data.name}"`, 'success');
  }

  // Bump the use_count + last_used_at when a profile is actually used in
  // an import. Fire-and-forget — don't block the import flow on the update.
  async function bumpProfileUsage(profileId) {
    if (!profileId) return;
    const p = profiles.find(x => x.id === profileId);
    if (!p) return;
    await supabase.from('csv_import_profiles')
      .update({ use_count: (Number(p.use_count) || 0) + 1, last_used_at: new Date().toISOString() })
      .eq('id', profileId);
  }

  // Revoke (archive) every transaction in a given import batch. Soft delete
  // via is_archived=true — no hard delete. User can dig the rows back out
  // by un-archiving in Supabase if needed.
  async function revokeBatch(batchId) {
    if (!batchId) return;
    const batch = recentBatches.find(b => b.id === batchId);
    if (!batch) return;
    const confirmMsg = `Archive all ${batch.activeRowCount} active transactions from "${batch.source || 'this import'}"? They'll disappear from the Ledger but can be restored from Supabase if needed.`;
    if (!await confirmDialog(confirmMsg)) return;
    setRevokingBatchId(batchId);
    const { error: err } = await supabase.from('transactions')
      .update({ is_archived: true })
      .eq('user_id', userId).eq('import_batch_id', batchId).eq('is_archived', false);
    setRevokingBatchId(null);
    if (err) {
      if (window.__notify) window.__notify('Revoke failed: ' + err.message, 'error');
      return;
    }
    // Mirror into local batch state
    setRecentBatches(prev => prev.map(b => b.id === batchId
      ? { ...b, archivedRowCount: b.archivedRowCount + b.activeRowCount, activeRowCount: 0, activeTotal: 0 }
      : b));
    // Tell parent so the Ledger drops the archived rows from view
    if (onBatchRevoked) onBatchRevoked(batchId);
    if (window.__notify) window.__notify(`Archived ${batch.activeRowCount} row${batch.activeRowCount===1?'':'s'} from this batch`, 'success');
  }

  // Build the parsed rows from current mapping
  function generatePreview() {
    const out = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rawDate = row[dateCol];
      const date = parseFlexibleDate(rawDate, dateFormat === 'dmy' ? 'dmy' : 'mdy');
      let amount = 0;
      if (amountMode === 'single') {
        amount = parseAmount(row[amountCol]);
        if (amountSign === 'inverted') amount = -amount;
      } else {
        const debit = parseAmount(row[debitCol]);
        const credit = parseAmount(row[creditCol]);
        // Debit reduces balance (outflow = negative), credit adds (inflow = positive)
        amount = credit - Math.abs(debit);
      }
      const payee = (row[payeeCol] || '').trim();
      const description = descCol ? (row[descCol] || '').trim() : '';
      const externalId = extIdCol ? (row[extIdCol] || '').trim() : '';
      out.push({
        rowIndex: i,
        date, amount, payee, description, externalId,
        valid: !!date && !!payee && amount !== 0,
        warnings: [
          !date ? 'invalid date' : null,
          !payee ? 'missing payee' : null,
          amount === 0 ? 'amount is zero' : null,
        ].filter(Boolean),
      });
    }
    return out;
  }

  // Dedup vs existing transactions. Match strategy (in priority order):
  //   1. external_id match (if both have one) — strongest signal
  //   2. date + abs(amount) + payee fuzzy match (date and amount must
  //      match exactly; payee match is case-insensitive substring either
  //      direction) — catches the common case of "DRY ATB" vs "ATB Dry
  //      Cleaners" while accepting occasional false negatives.
  function findDuplicate(parsed) {
    if (parsed.externalId) {
      const m = existingTransactions.find(t => t.external_id === parsed.externalId);
      if (m) return { match: m, reason: 'matched external_id' };
    }
    const ap = (parsed.payee || '').toLowerCase();
    for (const t of existingTransactions) {
      if (t.date !== parsed.date) continue;
      if (Math.abs(Number(t.amount) - parsed.amount) > 0.005) continue;
      const tp = (t.payee || '').toLowerCase();
      if (tp === ap || (ap && tp.includes(ap)) || (tp && ap.includes(tp))) {
        return { match: t, reason: 'matched date + amount + payee' };
      }
    }
    return null;
  }

  function proceedToPreview() {
    if (!dateCol || !payeeCol) { setError('Date and payee columns are required.'); return; }
    if (amountMode === 'single' && !amountCol) { setError('Pick an amount column.'); return; }
    if (amountMode === 'debit_credit' && (!debitCol || !creditCol)) { setError('Pick both debit and credit columns.'); return; }
    setError('');
    const out = generatePreview();
    setParsedRows(out);
    // Pre-select rows that are valid AND not duplicates
    const sel = new Set();
    out.forEach(p => {
      if (p.valid && !findDuplicate(p)) sel.add(p.rowIndex);
    });
    setSelectedRowIds(sel);
    setStep('preview');
  }

  function toggleRow(rowIndex) {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  async function doImport() {
    setStep('importing');
    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();
    const toInsert = parsedRows
      .filter(p => selectedRowIds.has(p.rowIndex) && p.valid)
      .map(p => ({
        user_id: userId,
        date: p.date,
        amount: p.amount,
        payee: p.payee,
        description: p.description || null,
        external_id: p.externalId || null,
        scope: defaultScope,
        account: defaultAccount || null,
        imported_at: now,
        import_source: fileName,
        import_batch_id: batchId,
      }));
    if (toInsert.length === 0) {
      setImportResult({ inserted: 0, errors: [] });
      setStep('done');
      return;
    }
    // Batch insert in chunks of 100 to avoid request-size limits
    const inserted = [];
    const errors = [];
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      const { data, error } = await supabase.from('transactions').insert(chunk).select();
      if (error) {
        errors.push(error.message);
      } else if (data) {
        inserted.push(...data);
      }
    }
    setImportResult({ inserted: inserted.length, errors, rows: inserted });
    // Bump profile use count (fire-and-forget, doesn't block UI)
    if (appliedProfileId && inserted.length > 0) bumpProfileUsage(appliedProfileId);
    setStep('done');
  }

  function finishUp() {
    if (importResult && importResult.rows) onImported(importResult.rows);
    else onClose();
  }

  const validCount = parsedRows.filter(p => p.valid).length;
  const dupCount = parsedRows.filter(p => p.valid && findDuplicate(p)).length;
  const selectedCount = selectedRowIds.size;

  const sel = (val, set, opts) => (
    <select value={val} onChange={e => set(e.target.value)}
      style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
      <option value="">— none —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'720px',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
          <h3 style={{margin:0,fontSize:'15px'}}>
            Import CSV
            {tab === 'new' && (
              <span style={{fontSize:'11px',color:'var(--text-3)',fontWeight:400,marginLeft:'8px'}}>
                · {step === 'upload' ? 'Pick a file' : step === 'map' ? 'Map columns' : step === 'preview' ? 'Review' : step === 'importing' ? 'Importing…' : 'Done'}
              </span>
            )}
          </h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        {/* Top-level tab toggle: New import vs Recent batches */}
        <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',marginBottom:'12px',width:'fit-content'}}>
          <button onClick={() => setTab('new')}
            style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
              background:tab==='new'?'var(--accent)':'transparent', color:tab==='new'?'var(--bg-base)':'var(--text-2)'}}>
            New import
          </button>
          <button onClick={() => setTab('recent')}
            style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
              background:tab==='recent'?'var(--accent)':'transparent', color:tab==='recent'?'var(--bg-base)':'var(--text-2)'}}>
            Recent imports
          </button>
        </div>

        {/* ── RECENT IMPORTS TAB ── */}
        {tab === 'recent' && (
          <div>
            {loadingBatches ? (
              <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
            ) : recentBatches.length === 0 ? (
              <div style={{padding:'30px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic',fontSize:'12px'}}>
                No previous CSV imports yet. Switch to "New import" to bring in your first file.
              </div>
            ) : (
              <>
                <div style={{fontSize:'10.5px',color:'var(--text-3)',marginBottom:'10px',lineHeight:1.5}}>
                  Click revoke to archive every transaction from that batch. They'll disappear from the Ledger but stay in the database (un-archive in Supabase if needed).
                </div>
                {recentBatches.map(b => {
                  const allRevoked = b.activeRowCount === 0 && b.rowCount > 0;
                  const dateStr = b.importedAt ? new Date(b.importedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
                  return (
                    <div key={b.id} style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',marginBottom:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px'}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:'12.5px',fontWeight:700,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {b.source || '(unlabeled batch)'}
                          </div>
                          <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'2px'}}>
                            {dateStr} · {b.activeRowCount} active / {b.rowCount} total{b.archivedRowCount > 0 ? ` (${b.archivedRowCount} archived)` : ''}
                          </div>
                          {b.activeRowCount > 0 && (
                            <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px',fontVariantNumeric:'tabular-nums'}}>
                              net <span style={{color: b.activeTotal >= 0 ? 'var(--green)' : 'var(--red)',fontWeight:700}}>
                                {b.activeTotal >= 0 ? '+' : '−'}${Math.abs(Math.round(b.activeTotal)).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                        {allRevoked ? (
                          <span style={{fontSize:'10px',color:'var(--text-3)',padding:'4px 10px',background:'var(--bg-hover)',borderRadius:'5px',fontWeight:700,flexShrink:0}}>
                            archived
                          </span>
                        ) : (
                          <button onClick={() => revokeBatch(b.id)} disabled={revokingBatchId === b.id}
                            style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--red)',borderRadius:'5px',color:'var(--red)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,flexShrink:0}}>
                            {revokingBatchId === b.id ? 'Revoking…' : 'Revoke batch'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'10px',fontStyle:'italic',textAlign:'center'}}>
                  Showing the {recentBatches.length} most recent batch{recentBatches.length===1?'':'es'}. Older batches still exist in the database; this view caps display.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── NEW IMPORT TAB ── */}
        {tab === 'new' && (<>

        {/* ── STEP 1: upload ── */}
        {step === 'upload' && (
          <div>
            {profiles.length > 0 && (
              <div style={{marginBottom:'14px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'6px'}}>Saved bank profiles</div>
                <div style={{fontSize:'10.5px',color:'var(--text-3)',marginBottom:'8px',lineHeight:1.5}}>
                  Auto-detected on upload when headers match. Or pick to pre-fill the mapping.
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                  {profiles.slice(0, 6).map(p => (
                    <span key={p.id} style={{padding:'3px 8px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'5px',fontSize:'10.5px',color:'var(--text-2)',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="save" size={12} /> {p.name}</span>
                      {p.use_count > 0 && <span style={{color:'var(--text-3)',fontSize:'9px'}}>·{p.use_count}×</span>}
                    </span>
                  ))}
                  {profiles.length > 6 && <span style={{fontSize:'10px',color:'var(--text-3)',alignSelf:'center'}}>+{profiles.length - 6} more</span>}
                </div>
              </div>
            )}
            <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              style={{
                padding:'30px 20px',
                border:`2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius:'10px',textAlign:'center',
                background: isDragOver ? 'rgba(197,169,94,0.06)' : 'transparent',
                transition: 'border-color 0.12s, background 0.12s',
              }}>
              <div style={{fontSize:'32px',marginBottom:'10px',transition:'transform 0.12s',transform: isDragOver ? 'scale(1.1)' : 'scale(1)'}}>
                {isDragOver ? <Icon name="archive" size={34} /> : <Icon name="file" size={34} />}
              </div>
              <p style={{fontSize:'13px',color:isDragOver?'var(--accent)':'var(--text-1)',marginBottom:'4px',fontWeight:600}}>
                {isDragOver ? 'Drop to import' : 'Drag a CSV file here, or pick one'}
              </p>
              <p style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'16px'}}>From your bank, credit card, or any financial source.</p>
              <input type="file" accept=".csv,text/csv" onChange={onFile}
                style={{display:'inline-block',padding:'6px 12px',background:'var(--accent)',color:'var(--bg-base)',border:'none',borderRadius:'6px',fontWeight:700,cursor:'pointer',fontSize:'12px'}}/>
            </div>
            {error && (
              <div style={{marginTop:'10px',padding:'8px 10px',background:'rgba(239,68,68,0.10)',border:'1px solid var(--red)',borderRadius:'6px',fontSize:'11px',color:'var(--red)'}}>
                {error}
              </div>
            )}
            <div style={{marginTop:'14px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
              <strong style={{color:'var(--text-2)',display:'block',marginBottom:'4px'}}>What works:</strong>
              Standard CSV with a header row. Handles bank exports from BofA, Chase, Wells Fargo, Capital One, Amex, Citi, and most credit unions. Date can be MM/DD/YYYY or YYYY-MM-DD. Amount can be one column (negative = expense) or two columns (Debit + Credit).
            </div>
          </div>
        )}

        {/* ── STEP 2: map ── */}
        {step === 'map' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',gap:'8px',flexWrap:'wrap'}}>
              <div style={{fontSize:'11px',color:'var(--text-3)'}}>
                {fileName} · {rawRows.length} rows
              </div>
              {profiles.length > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  {appliedProfileId && (
                    <span style={{fontSize:'10px',color:'var(--accent)',padding:'2px 7px',background:'rgba(197,169,94,0.10)',border:'1px solid var(--accent)',borderRadius:'4px',fontWeight:700}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="save" size={12} /> {profiles.find(p => p.id === appliedProfileId)?.name || 'profile'}</span>
                    </span>
                  )}
                  <select value={appliedProfileId || ''} onChange={e => {
                      const p = profiles.find(x => x.id === e.target.value);
                      if (p) applyProfile(p);
                    }}
                    style={{padding:'4px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',fontSize:'10.5px',cursor:'pointer'}}>
                    <option value="">{appliedProfileId ? 'change profile…' : 'apply saved profile…'}</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Sample rows */}
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'14px',overflowX:'auto'}}>
              <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'4px'}}>Sample (first 3 rows)</div>
              <table style={{width:'100%',fontSize:'10.5px',color:'var(--text-2)',borderCollapse:'collapse'}}>
                <thead>
                  <tr>{headers.map(h => <th key={h} style={{textAlign:'left',padding:'2px 6px',color:'var(--text-3)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 3).map((r, i) => (
                    <tr key={i}>{headers.map(h => <td key={h} style={{padding:'2px 6px',whiteSpace:'nowrap',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis'}}>{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Date column*</label>
                {sel(dateCol, setDateCol, headers)}
              </div>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Date format</label>
                <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}
                  style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                  <option value="mdy">MM/DD/YYYY (US)</option>
                  <option value="dmy">DD/MM/YYYY (EU)</option>
                  <option value="auto">YYYY-MM-DD (ISO)</option>
                </select>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Payee / description column*</label>
                {sel(payeeCol, setPayeeCol, headers)}
              </div>

              <div style={{gridColumn:'1 / -1',padding:'10px',background:'var(--bg-base)',borderRadius:'6px'}}>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'6px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Amount</div>
                <div style={{display:'flex',gap:'4px',marginBottom:'8px'}}>
                  <button onClick={() => setAmountMode('single')}
                    style={{flex:1,padding:'5px',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                      background: amountMode==='single' ? 'var(--accent)' : 'var(--bg-hover)',
                      color: amountMode==='single' ? 'var(--bg-base)' : 'var(--text-2)'}}>Single column (±)</button>
                  <button onClick={() => setAmountMode('debit_credit')}
                    style={{flex:1,padding:'5px',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                      background: amountMode==='debit_credit' ? 'var(--accent)' : 'var(--bg-hover)',
                      color: amountMode==='debit_credit' ? 'var(--bg-base)' : 'var(--text-2)'}}>Debit + Credit columns</button>
                </div>
                {amountMode === 'single' ? (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Amount column*</label>
                      {sel(amountCol, setAmountCol, headers)}
                    </div>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Sign convention</label>
                      <select value={amountSign} onChange={e => setAmountSign(e.target.value)}
                        style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                        <option value="standard">Negative = expense (default)</option>
                        <option value="inverted">Positive = expense (flip)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Debit column*</label>
                      {sel(debitCol, setDebitCol, headers)}
                    </div>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Credit column*</label>
                      {sel(creditCol, setCreditCol, headers)}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:600}}>Memo / description (optional)</label>
                {sel(descCol, setDescCol, headers)}
              </div>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:600}}>Bank ref / ID (optional)</label>
                {sel(extIdCol, setExtIdCol, headers)}
              </div>
            </div>

            <div style={{marginTop:'10px',padding:'10px',background:'var(--bg-base)',borderRadius:'6px'}}>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Defaults for imported rows</div>
              <div style={{display:'grid',gridTemplateColumns:trackPersonal ? '1fr 1fr' : '1fr',gap:'8px'}}>
                {trackPersonal && (
                  <div>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Scope</label>
                    <select value={defaultScope} onChange={e => setDefaultScope(e.target.value)}
                      style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                      <option value="business">Business</option>
                      <option value="personal">Personal</option>
                    </select>
                  </div>
                )}
                <div>
                  <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Account label</label>
                  <input value={defaultAccount} onChange={e => setDefaultAccount(e.target.value)}
                    placeholder="e.g. Chase Business Checking"
                    style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}/>
                </div>
              </div>
              <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px',lineHeight:1.5,fontStyle:'italic'}}>
                These apply to all imported rows. You can re-categorize after import using bulk-edit (planned) or per-row.
              </div>
            </div>

            {error && (
              <div style={{padding:'8px 10px',background:'rgba(239,68,68,0.10)',border:'1px solid var(--red)',borderRadius:'6px',fontSize:'11px',color:'var(--red)',marginTop:'10px'}}>
                {error}
              </div>
            )}

            <div className="modal-actions" style={{display:'flex',justifyContent:'space-between',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('upload')}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={proceedToPreview}>Preview →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: preview ── */}
        {step === 'preview' && (
          <div>
            <div style={{display:'flex',gap:'8px',marginBottom:'10px',flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Parsed</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--text-1)'}}>{parsedRows.length}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Valid</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--green)'}}>{validCount}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Duplicates</div>
                <div style={{fontSize:'17px',fontWeight:800,color: dupCount > 0 ? '#f59e0b' : 'var(--text-3)'}}>{dupCount}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-hover)',border:'1px solid var(--accent)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Selected</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--accent)'}}>{selectedCount}</div>
              </div>
            </div>

            <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap',fontSize:'11px'}}>
              <button onClick={() => setSelectedRowIds(new Set(parsedRows.filter(p => p.valid && !findDuplicate(p)).map(p => p.rowIndex)))}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Select non-duplicates
              </button>
              <button onClick={() => setSelectedRowIds(new Set(parsedRows.filter(p => p.valid).map(p => p.rowIndex)))}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Select all valid
              </button>
              <button onClick={() => setSelectedRowIds(new Set())}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Clear
              </button>
            </div>

            <div style={{maxHeight:'400px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'6px'}}>
              <table style={{width:'100%',fontSize:'11px',borderCollapse:'collapse'}}>
                <thead style={{position:'sticky',top:0,background:'var(--bg-hover)'}}>
                  <tr>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px',width:'30px'}}>✓</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Date</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Payee</th>
                    <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Amount</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map(p => {
                    const dup = p.valid ? findDuplicate(p) : null;
                    const selected = selectedRowIds.has(p.rowIndex);
                    return (
                      <tr key={p.rowIndex} onClick={() => p.valid && toggleRow(p.rowIndex)}
                        style={{borderBottom:'1px solid var(--border)',cursor: p.valid ? 'pointer' : 'default',opacity: p.valid ? 1 : 0.4,background: selected ? 'rgba(197,169,94,0.05)' : 'transparent'}}>
                        <td style={{padding:'5px 8px'}}>
                          {p.valid && <input type="checkbox" checked={selected} onChange={() => toggleRow(p.rowIndex)} onClick={e => e.stopPropagation()}/>}
                        </td>
                        <td style={{padding:'5px 8px',color:'var(--text-2)',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{p.date || '—'}</td>
                        <td style={{padding:'5px 8px',color:'var(--text-1)',maxWidth:'220px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.payee || '(no payee)'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',fontVariantNumeric:'tabular-nums',color: p.amount < 0 ? 'var(--red)' : 'var(--green)',fontWeight:600}}>{fmtUSD(p.amount)}</td>
                        <td style={{padding:'5px 8px',fontSize:'10px'}}>
                          {!p.valid ? (
                            <span style={{color:'var(--red)'}}>{p.warnings.join(', ')}</span>
                          ) : dup ? (
                            <span style={{color:'#f59e0b'}} title={dup.reason}>dup ({dup.reason})</span>
                          ) : (
                            <span style={{color:'var(--green)'}}>new</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{marginTop:'10px',fontSize:'10.5px',color:'var(--text-3)',lineHeight:1.5,fontStyle:'italic'}}>
              Duplicates are detected by exact date + amount + matching payee, or by matching bank reference ID. They're unchecked by default but you can re-select if you actually want to import them.
            </div>

            {/* Save-as-profile prompt — only when not already using a saved profile */}
            {!appliedProfileId && (
              <div style={{marginTop:'10px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                {!showSaveProfile ? (
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                    <span style={{fontSize:'11px',color:'var(--text-2)'}}>
                      Save this mapping as a bank profile? Next time, just upload — column mapping happens automatically.
                    </span>
                    <button onClick={() => { setShowSaveProfile(true); setNewProfileName(defaultAccount || ''); }}
                      style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--accent)',borderRadius:'5px',color:'var(--accent)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,flexShrink:0}}>
                      Save mapping
                    </button>
                  </div>
                ) : (
                  <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
                    <input type="text" value={newProfileName} onChange={e => setNewProfileName(e.target.value)}
                      placeholder='e.g. "Chase Business Checking"' autoFocus
                      style={{flex:'1 1 200px',padding:'5px 8px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',outline:'none'}}/>
                    <button onClick={saveAsProfile} disabled={savingProfile || !newProfileName.trim()}
                      style={{padding:'5px 10px',background:'var(--accent)',border:'none',borderRadius:'5px',color:'var(--bg-base)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,opacity:(!newProfileName.trim())?0.4:1}}>
                      {savingProfile ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setShowSaveProfile(false)}
                      style={{padding:'5px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-3)',cursor:'pointer',fontSize:'10.5px'}}>Cancel</button>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions" style={{display:'flex',justifyContent:'space-between',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('map')}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={doImport} disabled={selectedCount === 0}>
                Import {selectedCount} {selectedCount === 1 ? 'row' : 'rows'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: importing ── */}
        {step === 'importing' && (
          <div style={{padding:'40px',textAlign:'center'}}>
            <div style={{fontSize:'14px',color:'var(--text-1)',marginBottom:'4px'}}>Importing…</div>
            <div style={{fontSize:'11px',color:'var(--text-3)'}}>Inserting {selectedCount} transactions</div>
          </div>
        )}

        {/* ── STEP 5: done ── */}
        {step === 'done' && importResult && (
          <div>
            <div style={{padding:'30px 20px',textAlign:'center',background: importResult.inserted > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)',border: `1px solid ${importResult.inserted > 0 ? 'var(--green)' : '#f59e0b'}`,borderRadius:'10px',marginBottom:'12px'}}>
              <div style={{fontSize:'40px',marginBottom:'6px'}}>{importResult.inserted > 0 ? '✓' : '!'}</div>
              <div style={{fontSize:'18px',fontWeight:800,color: importResult.inserted > 0 ? 'var(--green)' : '#f59e0b',marginBottom:'4px'}}>
                {importResult.inserted} {importResult.inserted === 1 ? 'transaction' : 'transactions'} imported
              </div>
              {importResult.errors.length > 0 && (
                <div style={{fontSize:'11px',color:'var(--red)',marginTop:'8px'}}>
                  {importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}:
                  <div style={{marginTop:'4px',fontStyle:'italic'}}>{importResult.errors.slice(0,3).join(' · ')}</div>
                </div>
              )}
            </div>
            <div style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.5}}>
              Newly-imported rows are uncategorized. Open them in the Ledger to assign tax categories and lead-gen / recruiting systems. Bulk-categorization tools coming in a future build.
            </div>
            <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-primary" onClick={finishUp}>Done</button>
            </div>
          </div>
        )}

        </>)}
      </div>
    </div>
  );
}

// ─── Payee normalization + category auto-suggest ─────────────────────
// Strips the bank cruft that breaks naive payee matching. After this,
// "POS PURCHASE STARBUCKS #4521 TAMPA FL" and "STARBUCKS #1029 LUTZ FL"
// both normalize to "starbucks" so they suggest the same category.

function normalizePayee(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Common bank/card-network prefixes that contain no merchant info
    .replace(/\b(pos|atm|ach|eft|wire|debit|credit|purchase|payment|deposit|withdrawal|transfer|recurring|online|online banking|automatic|electronic|p2p|venmo|zelle|paypal payment to|paypal payment from|paypal\*?|sq ?\*|tst\*?|amzn ?mktp ?us|amazon\.com|amazon mktpl|amzn digital)\b/g, ' ')
    // Strip city/state/zip cruft at the end (e.g. "TAMPA FL", "lutz fl 33548")
    .replace(/\s+[a-z]{3,20}\s+[a-z]{2}\s*\d{0,5}\s*$/i, ' ')
    // Strip reference numbers, transaction IDs, store numbers
    .replace(/[#*]\s*\d+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    // Strip punctuation
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a category-suggestion lookup from past categorized transactions.
// Returns { suggest(payee) → { categoryId, systemId, confidence, source } | null }
// confidence: 'exact' (same normalized payee), 'prefix' (first 2 words match),
//             'fuzzy' (first word match with >2 prior occurrences).

function buildSuggester(categorizedTransactions) {
  // Group prior transactions by normalized payee → most-recent category mapping
  const byPayee = new Map();  // normalized → { cats: Map<id, {count, latest}>, syss: Map<id, {count, latest}> }
  for (const t of categorizedTransactions) {
    const norm = normalizePayee(t.payee);
    if (!norm) continue;
    if (!byPayee.has(norm)) byPayee.set(norm, { cats: new Map(), syss: new Map() });
    const e = byPayee.get(norm);
    if (t.tax_category_id) {
      const c = e.cats.get(t.tax_category_id) || { count: 0, latest: '' };
      c.count++;
      if (t.date > c.latest) c.latest = t.date;
      e.cats.set(t.tax_category_id, c);
    }
    if (t.lead_gen_system_id) {
      const s = e.syss.get(t.lead_gen_system_id) || { count: 0, latest: '' };
      s.count++;
      if (t.date > s.latest) s.latest = t.date;
      e.syss.set(t.lead_gen_system_id, s);
    }
  }
  // Pre-compute first-N-word indexes for fuzzy lookups
  const firstWordIndex = new Map();  // first word → Set of normalized payees containing it
  const twoWordIndex = new Map();
  for (const norm of byPayee.keys()) {
    const words = norm.split(' ');
    const first = words[0];
    const two = words.slice(0, 2).join(' ');
    if (first) {
      if (!firstWordIndex.has(first)) firstWordIndex.set(first, new Set());
      firstWordIndex.get(first).add(norm);
    }
    if (two && two !== first) {
      if (!twoWordIndex.has(two)) twoWordIndex.set(two, new Set());
      twoWordIndex.get(two).add(norm);
    }
  }
  // Pick the most-frequent (count, then most-recent) entry from a Map
  function topPick(m) {
    let best = null;
    for (const [id, info] of m.entries()) {
      if (!best || info.count > best.info.count ||
          (info.count === best.info.count && info.latest > best.info.latest)) {
        best = { id, info };
      }
    }
    return best ? best.id : null;
  }
  // Aggregate cats/syss across multiple matching normalized payees
  function combineEntries(norms) {
    const cats = new Map();
    const syss = new Map();
    for (const n of norms) {
      const e = byPayee.get(n);
      if (!e) continue;
      for (const [id, info] of e.cats.entries()) {
        const c = cats.get(id) || { count: 0, latest: '' };
        c.count += info.count;
        if (info.latest > c.latest) c.latest = info.latest;
        cats.set(id, c);
      }
      for (const [id, info] of e.syss.entries()) {
        const s = syss.get(id) || { count: 0, latest: '' };
        s.count += info.count;
        if (info.latest > s.latest) s.latest = info.latest;
        syss.set(id, s);
      }
    }
    return { cats, syss };
  }

  return {
    suggest(payee) {
      const norm = normalizePayee(payee);
      if (!norm) return null;
      // Tier 1: exact normalized match
      if (byPayee.has(norm)) {
        const e = byPayee.get(norm);
        const catId = topPick(e.cats);
        const sysId = topPick(e.syss);
        if (catId) return { categoryId: catId, systemId: sysId, confidence: 'exact', matchedFrom: norm };
      }
      // Tier 2: first-2-words prefix match
      const words = norm.split(' ');
      if (words.length >= 2) {
        const two = words.slice(0, 2).join(' ');
        const matches = twoWordIndex.get(two);
        if (matches && matches.size > 0) {
          const { cats, syss } = combineEntries(matches);
          const catId = topPick(cats);
          const sysId = topPick(syss);
          if (catId) return { categoryId: catId, systemId: sysId, confidence: 'prefix', matchedFrom: two };
        }
      }
      // Tier 3: first-word fuzzy (only if >=3 prior matches to avoid noise)
      const first = words[0];
      if (first && first.length >= 3) {
        const matches = firstWordIndex.get(first);
        if (matches && matches.size > 0) {
          const { cats, syss } = combineEntries(matches);
          // Need at least 3 prior occurrences total to confidently fuzzy-match
          let total = 0;
          for (const info of cats.values()) total += info.count;
          if (total >= 3) {
            const catId = topPick(cats);
            const sysId = topPick(syss);
            if (catId) return { categoryId: catId, systemId: sysId, confidence: 'fuzzy', matchedFrom: first };
          }
        }
      }
      return null;
    },
  };
}

// ─── BulkCategorizeModal ─────────────────────────────────────────────
// Cleans up the backlog of uncategorized transactions in one screen.
// Auto-suggests tax category + lead-gen system per row from payee history,
// then lets the user accept all or adjust per row, plus a "match this
// payee to all similar rows" shortcut. Single batched UPDATE on save.

function BulkCategorizeModal({ userId, transactions, setTransactions, taxCategories, systems, scope, onClose }) {

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

function RecurringList({ userId, recurringTemplates, setRecurringTemplates, taxCategories, systems, personalBudget, trackPersonal, readOnly, onAdd, onEdit }) {
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


function RecurringTemplateModal({ userId, initial, taxCategories, systems, personalBudget, trackPersonal, onClose, onSaved }) {


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


function TransactionModal({ userId, initial, taxCategories, systems, personalBudget, trackPersonal, onClose, onSaved, onDelete }) {


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

function FinanceReports({ userId, settings, transactions, taxCategories, systems, recruitingSystems, personalBudget, timeEntries, deals, trackPersonal, isCoach }) {
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
        <ScheduleCReport userId={userId} taxCategories={taxCategories} />
      )}
      {reportType === 'quarterly' && (
        <QuarterlyTaxReport userId={userId} taxCategories={taxCategories} />
      )}
      {reportType === 'form_1099' && (
        <Form1099Report userId={userId} />
      )}
      {reportType === 'budgets' && (
        <BudgetReport userId={userId} systems={systems} recruitingSystems={recruitingSystems} />
      )}
      {reportType === 'cashflow' && (
        <CashFlowForecast userId={userId} settings={settings} />
      )}
    </div>
  );
}


function ReportHeader({ reportType, setReportType, period, setPeriod, trackPersonal }) {
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


function BusinessReport({ transactions, taxCategories, systems, recruitingSystems = [], advExpanded, setAdvExpanded, isCoach }) {
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

function CostCenterBlock({ icon, title, subtitle, total, accentColor, percentOfTotal, systems, bySystemMap, unassignedLabel }) {
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

const SCHEDULE_C_LINES = [
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


function ScheduleCReport({ userId, taxCategories }) {
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

function SCLine({ num, label, amount, subtitle, expanded, onToggle, children, hasData, isPositive }) {
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

const TAX_BRACKETS_2026 = {
  single: [
    { rate: 0.10, min: 0,        max: 12400 },
    { rate: 0.12, min: 12400,    max: 50400 },
    { rate: 0.22, min: 50400,    max: 105700 },
    { rate: 0.24, min: 105700,   max: 201775 },
    { rate: 0.32, min: 201775,   max: 256225 },
    { rate: 0.35, min: 256225,   max: 640600 },
    { rate: 0.37, min: 640600,   max: null },
  ],
  mfj: [
    { rate: 0.10, min: 0,        max: 24800 },
    { rate: 0.12, min: 24800,    max: 100800 },
    { rate: 0.22, min: 100800,   max: 211400 },
    { rate: 0.24, min: 211400,   max: 403550 },
    { rate: 0.32, min: 403550,   max: 512450 },
    { rate: 0.35, min: 512450,   max: 768700 },
    { rate: 0.37, min: 768700,   max: null },
  ],
  // Married filing separately uses single brackets with halved breakpoints —
  // approximated here.
  mfs: [
    { rate: 0.10, min: 0,        max: 12400 },
    { rate: 0.12, min: 12400,    max: 50400 },
    { rate: 0.22, min: 50400,    max: 105700 },
    { rate: 0.24, min: 105700,   max: 201775 },
    { rate: 0.32, min: 201775,   max: 256225 },
    { rate: 0.35, min: 256225,   max: 384350 },
    { rate: 0.37, min: 384350,   max: null },
  ],
  hoh: [
    { rate: 0.10, min: 0,        max: 17700 },
    { rate: 0.12, min: 17700,    max: 67450 },
    { rate: 0.22, min: 67450,    max: 105700 },
    { rate: 0.24, min: 105700,   max: 201775 },
    { rate: 0.32, min: 201775,   max: 256200 },
    { rate: 0.35, min: 256200,   max: 640600 },
    { rate: 0.37, min: 640600,   max: null },
  ],
};

const STD_DEDUCTION_2026 = {
  single: 16100,
  mfj: 32200,
  mfs: 16100,
  hoh: 24150,
};

const SE_TAX_2026 = {
  ss_wage_base: 184500,                          // 2026 Social Security wage base
  ss_rate: 0.124,                                // SS tax rate (employer + employee)
  medicare_rate: 0.029,                          // Medicare tax rate
  additional_medicare_rate: 0.009,               // Additional Medicare on high earners
  additional_medicare_threshold_single: 200000,
  additional_medicare_threshold_mfj: 250000,
  se_deduction_factor: 0.9235,                   // 1 - (0.0765 / 2) ≈ accounts for the
                                                 //   "employer half" excluded from SE base
};
// Note on SSTB (Specified Service Trade or Business): real-estate brokers
// are NOT classified as SSTBs by the IRS — only specific professions like
// law, health, and accounting are. Real-estate agents qualify for the full
// QBI deduction regardless of income. SSTB thresholds are $201,775 single
// / $403,500 MFJ in 2026 if ever needed for other use cases.

// ─── Tax computation helpers ────────────────────────────────────────

function computeSETax(netProfit, filingStatus = 'single') {
  const c = SE_TAX_2026;
  if (!Number.isFinite(netProfit) || netProfit <= 0) {
    return { ssTax: 0, medicareTax: 0, additionalMedicare: 0, total: 0, aboveLineDeduction: 0, seEarnings: 0 };
  }
  // Net earnings subject to SE tax (the 0.9235 factor "evens out" the
  // employer half of SS/Medicare that wouldn't be subject to SE tax)
  const seEarnings = netProfit * c.se_deduction_factor;
  const ssTax = Math.min(seEarnings, c.ss_wage_base) * c.ss_rate;
  const medicareTax = seEarnings * c.medicare_rate;
  const addlThreshold = filingStatus === 'mfj'
    ? c.additional_medicare_threshold_mfj
    : c.additional_medicare_threshold_single;
  const additionalMedicare = Math.max(0, seEarnings - addlThreshold) * c.additional_medicare_rate;
  const total = ssTax + medicareTax + additionalMedicare;
  // Above-the-line deduction = half of (SS + Medicare). The Additional
  // Medicare 0.9% is NOT deductible above-the-line.
  const aboveLineDeduction = (ssTax + medicareTax) / 2;
  return { ssTax, medicareTax, additionalMedicare, total, aboveLineDeduction, seEarnings };
}


function computeFederalIncomeTax(taxableIncome, filingStatus = 'single') {
  const brackets = TAX_BRACKETS_2026[filingStatus] || TAX_BRACKETS_2026.single;
  if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) {
    return { tax: 0, marginalRate: brackets[0].rate, effectiveRate: 0, usedBrackets: [] };
  }
  let tax = 0;
  let lastBracket = brackets[0];
  const usedBrackets = [];
  for (const b of brackets) {
    if (taxableIncome > b.min) {
      const top = Math.min(taxableIncome, b.max == null ? Infinity : b.max);
      const inBracket = Math.max(0, top - b.min);
      const t = inBracket * b.rate;
      tax += t;
      usedBrackets.push({ ...b, incomeInBracket: inBracket, taxInBracket: t });
      lastBracket = b;
    }
  }
  return {
    tax,
    marginalRate: lastBracket.rate,
    effectiveRate: tax / taxableIncome,
    usedBrackets,
  };
}

// Computes Schedule C net profit from transactions + mileage. Used by
// QuarterlyTaxReport so its number lines up with the ScheduleCReport.

function computeNetProfitFromData(transactions, taxCategories, mileageEntries) {
  const grossReceipts = transactions
    .filter(t => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const catMap = Object.fromEntries(taxCategories.map(c => [c.id, c]));
  const businessExpenses = transactions
    .filter(t => Number(t.amount) < 0 && t.tax_category_id)
    .reduce((s, t) => {
      const cat = catMap[t.tax_category_id];
      if (!cat) return s;
      // Skip categories not on Schedule C (estimated tax payments, etc.)
      if (cat.schedule_c_line === '(not Schedule C)') return s;
      const ded = Number(cat.deduction_pct || 1);
      return s + Math.abs(Number(t.amount)) * ded;
    }, 0);
  const mileageDeduction = (mileageEntries || [])
    .filter(m => m.category === 'business')
    .reduce((s, m) => s + Number(m.computed_deduction || 0), 0);
  return {
    grossReceipts,
    businessExpenses,
    mileageDeduction,
    totalExpenses: businessExpenses + mileageDeduction,
    netProfit: grossReceipts - businessExpenses - mileageDeduction,
  };
}

// The full annual-tax projection. Pure function — takes settings + YTD
// data, returns everything the UI needs to render.

function computeQuarterlyTaxProjection({
  ytdNetProfit, monthsElapsed, year, filingStatus, otherIncome, withholding,
  useQbi, itemizedDeductions, priorYearTax, priorYearAgi, ytdEstimatedPaid,
}) {
  // Annualize YTD net profit to a full-year projection.
  // If we're in month 6, multiply by 12/6 = 2. Early in the year this is
  // noisy — by Q3 it stabilizes. Tail end of year, basically YTD = annual.
  const annualizedNetProfit = monthsElapsed > 0
    ? (ytdNetProfit * 12 / monthsElapsed)
    : ytdNetProfit;

  // SE tax computed on the annualized projection
  const se = computeSETax(annualizedNetProfit, filingStatus);

  // Adjusted Gross Income: Schedule C net + other income − half SE tax
  const agi = annualizedNetProfit + (otherIncome || 0) - se.aboveLineDeduction;

  // QBI deduction (Sec 199A). For real-estate agents (NOT an SSTB), full 20%
  // applies regardless of income. For SSTBs above the threshold, the
  // deduction phases out — out of scope for v1.
  let qbiDeduction = 0;
  if (useQbi && annualizedNetProfit > 0) {
    const qbiBase = annualizedNetProfit - se.aboveLineDeduction;
    qbiDeduction = Math.max(0, Math.min(qbiBase * 0.20, Math.max(0, agi) * 0.20));
  }

  // Use itemized if it exceeds the standard
  const stdDeduction = STD_DEDUCTION_2026[filingStatus] || STD_DEDUCTION_2026.single;
  const deductionUsed = (itemizedDeductions && itemizedDeductions > stdDeduction)
    ? itemizedDeductions
    : stdDeduction;
  const deductionType = (itemizedDeductions && itemizedDeductions > stdDeduction) ? 'itemized' : 'standard';

  // Taxable income after all deductions
  const taxableIncome = Math.max(0, agi - deductionUsed - qbiDeduction);

  // Federal income tax via bracket walk
  const fed = computeFederalIncomeTax(taxableIncome, filingStatus);

  // Total tax owed for the projected year (SE + federal income)
  const totalAnnualTax = se.total + fed.tax;

  // Net of W-2 withholding (if the user has any). Estimated payments
  // counted separately below in "currently owed" math.
  const totalAfterWithholding = Math.max(0, totalAnnualTax - (withholding || 0));

  // IRS safe harbor: pay 100% of prior-year tax (110% if AGI > $150K)
  // Avoids underpayment penalty regardless of actual current-year income.
  const safeHarborMultiplier = (priorYearAgi || 0) > 150000 ? 1.10 : 1.00;
  const safeHarborAnnual = priorYearTax ? Math.max(0, priorYearTax * safeHarborMultiplier - (withholding || 0)) : null;

  // The lower of the two strategies (current-year 90% rule vs prior-year safe harbor)
  const quarterlyByCurrentYear = totalAfterWithholding / 4;
  const quarterlyBySafeHarbor = safeHarborAnnual != null ? safeHarborAnnual / 4 : null;
  const recommendedQuarterly = quarterlyBySafeHarbor != null
    ? Math.min(quarterlyByCurrentYear, quarterlyBySafeHarbor)
    : quarterlyByCurrentYear;

  // Quarterly due dates (Apr 15 / Jun 15 / Sep 15 / Jan 15 of next year)
  const quarters = [
    { id: 'Q1', label: 'Q1', due: new Date(year, 3, 15), covers: 'Jan–Mar' },
    { id: 'Q2', label: 'Q2', due: new Date(year, 5, 15), covers: 'Apr–May' },
    { id: 'Q3', label: 'Q3', due: new Date(year, 8, 15), covers: 'Jun–Aug' },
    { id: 'Q4', label: 'Q4', due: new Date(year + 1, 0, 15), covers: 'Sep–Dec' },
  ];
  const now = new Date();
  const quartersPassed = quarters.filter(q => q.due <= now).length;
  const expectedYtdPaid = quartersPassed * recommendedQuarterly;
  const currentlyOwed = Math.max(0, expectedYtdPaid - (ytdEstimatedPaid || 0));
  const nextDueQuarter = quarters.find(q => q.due > now) || null;

  return {
    annualizedNetProfit, se, agi, qbiDeduction, deductionUsed, deductionType,
    taxableIncome, fed, totalAnnualTax, totalAfterWithholding,
    safeHarborAnnual, quarterlyByCurrentYear, quarterlyBySafeHarbor, recommendedQuarterly,
    quarters, quartersPassed, expectedYtdPaid, currentlyOwed, nextDueQuarter,
  };
}

// ─── QuarterlyTaxReport ──────────────────────────────────────────────
// Self-employment tax + federal income tax projection with a quarterly
// payment schedule. Sits on top of the same Schedule C data, then layers
// on SE tax (Schedule SE) and federal bracket math to produce the
// actionable number: "set aside $X per quarter."
//
// Florida has no state income tax — no state-side math needed.

function QuarterlyTaxReport({ userId, taxCategories }) {
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

function KpiBox({ label, value, sub, color }) {
  return (
    <div style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>{label}</div>
      <div style={{fontSize:'17px',fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:'4px',color: color || 'var(--text-1)'}}>{value}</div>
      {sub && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>}
    </div>
  );
}

// Section in the "show working" math walkthrough

function WorkingsSection({ title, total, children }) {
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


function WorkingsRow({ label, amount, bold }) {
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

function TaxSettingsModal({ settings, onSave, onClose }) {

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

function needs1099(contact, paidYTD) {
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

function exemptionReason(contact, paidYTD) {
  if (!contact) return null;
  if (paidYTD < 600) return 'Below $600';
  if (contact.exempt_1099_reason) return contact.exempt_1099_reason;
  if (contact.force_1099) return null;
  if (contact.entity_type === 's_corp' || contact.entity_type === 'llc_s_corp') return 'S corp — exempt';
  if (contact.entity_type === 'c_corp' || contact.entity_type === 'llc_c_corp') return 'C corp — exempt';
  if (contact.entity_type === 'nonprofit') return 'Nonprofit — exempt';
  return null;
}


function Form1099Report({ userId }) {
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


function BudgetReport({ userId, systems, recruitingSystems }) {
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

function BudgetSection({ title, subtitle, rows, rowPrefix, expandedRow, setExpandedRow, txnsForExpanded, severityFor, view, fmt }) {
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

const DEAL_STATUS_CONFIDENCE = {
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

const DEAL_STATUS_PROBABILITY = {
  closing:         0.90,
  under_contract:  0.75,
  active:          0.35,
  lead:            0.15,
};


function CashFlowForecast({ userId, settings }) {
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
                onMouseEnter={() => setHoveredDay(p)}
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


function PersonalReport({ transactions, personalBudget, period }) {
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

function ROIReport({ transactions, timeEntries, deals = [], systems, settings, period, inPeriod }) {
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


function ROISystemCard({ row }) {
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

export { FinanceView, QuarterlyTaxBanner };
