import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { KpiTile, KpiBox } from './FinanceTiles';
import { getProrata } from '../financeUtils';
// Budget + forecast is sit-down planning work, not the daily ledger — lazy so it
// does not ride along on every finance visit.
const BudgetReport = React.lazy(() => import('./BudgetForecast').then(m => ({ default: m.BudgetReport })));
const CashFlowForecast = React.lazy(() => import('./BudgetForecast').then(m => ({ default: m.CashFlowForecast })));
const FinanceBlueprint = React.lazy(() => import('./BudgetForecast').then(m => ({ default: m.FinanceBlueprint })));
// Tax work is seasonal — an agent opens these a few times a year, so they are
// lazy and do not ride along in the chunk that loads on every finance visit.
const ScheduleCReport = React.lazy(() => import('./TaxReports').then(m => ({ default: m.ScheduleCReport })));
const QuarterlyTaxReport = React.lazy(() => import('./TaxReports').then(m => ({ default: m.QuarterlyTaxReport })));
const Form1099Report = React.lazy(() => import('./TaxReports').then(m => ({ default: m.Form1099Report })));
// Tax work is seasonal — an agent opens these a few times a year, so they are
// lazy and do not ride along in the chunk that loads on every finance visit.
import { normalizePayee, buildSuggester } from '../financeUtils';
// Lazy on purpose: the importer is ~1,100 lines used a few times a year. A static
// import would bundle it into the finance chunk and undo the whole point.
const CsvImportModal = React.lazy(() => import('./CsvImportModal').then(m => ({ default: m.CsvImportModal })));
import { SE_TAX_2026, computeNetProfitFromData, computeQuarterlyTaxProjection, nextQuarterDueLabel } from '../taxMath';
import { Icon } from '../icons';
import { canHover, modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
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
        <React.Suspense fallback={null}><FinanceBlueprint
          userId={userId} settings={settings} setSettings={setSettings}
          personalBudget={personalBudget} setPersonalBudget={setPersonalBudget}
          taxCategories={taxCategories} setTaxCategories={setTaxCategories}
          systems={systems} timeEntries={timeEntries} reload={loadAll} readOnly={readOnly}
          isCoach={isCoach} maxSystems={maxSystems}
        /></React.Suspense>
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


function monthNet(transactions, scope) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  return transactions.filter(t => new Date(t.date) >= monthStart && (!scope || t.scope === scope))
    .reduce((s, t) => s + Number(t.amount), 0);
}

function nextTaxEstimate(ytdIncome, settings) {
  if (!settings) return 0;
  return Math.max(0, ytdIncome * Number(settings.estimated_tax_pct) / 4);
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

export { FinanceView };
