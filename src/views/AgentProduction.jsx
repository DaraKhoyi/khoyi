import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── AgentProduction ─────────────────────────────────────────────────────────
// Production figures on an agent's contact record. Every number comes from the
// contact_production RPC — the maths lives in the database so two screens can
// never disagree, and the phone does none of it.
//
// TWO AUDIENCES, ONE COMPONENT:
//  • Agent viewing their own record → Sales · Volume · GCI · Avg Rate, plus their
//    two goals (GCI + Sales) with pace. NO dollars-kept, NO company dollar — the
//    RPC never even sends those to a non-broker, so they can't leak to the device.
//  • Broker / Owner (Dara, Alex, Josh) → all of the above PLUS "Agent kept" and
//    "Company $" — the P&L the brokerage runs on — behind a quiet Brokerage badge.
//
// Renders nothing for non-agents and nothing for agents with no transactions.

const G = '#CBA35C', CHAMP = '#EBCB82', GREEN = '#7fae8f', RED = '#e0794f', DEEP = '#9A8038';

const compact = (n) => {
  if (!n && n !== 0) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const pct = (n) => (n || n === 0) ? Number(n).toFixed(n >= 10 ? 1 : 2) + '%' : '—';
const num = (n) => (n || n === 0) ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 15 };
const eyebrow = { fontFamily: 'Barlow Condensed,sans-serif', fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: G, fontSize: 11.5, margin: 0 };
const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 };
const tileBox = { background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 11, padding: '11px 12px', minWidth: 0 };
const tileLab = { fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const tileVal = { fontFamily: 'Fraunces,serif', fontSize: 22, fontWeight: 300, color: 'var(--text-1)', lineHeight: 1.12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const tileSub = { fontSize: 10.5, color: 'var(--text-3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function Tile({ label, value, sub, accent, gold, broker }) {
  return (
    <div style={{ ...tileBox, ...(broker ? { borderColor: 'rgba(203,163,92,.32)', background: 'linear-gradient(180deg, rgba(203,163,92,.05), var(--bg-base))' } : {}) }}>
      <div style={{ ...tileLab, ...(broker ? { color: DEEP } : {}) }}>
        {label}{broker ? <span style={{ marginLeft: 4, opacity: .8 }}>◆</span> : null}
      </div>
      <div className={gold ? 'gold-move' : undefined} style={{ ...tileVal, ...(gold ? {} : { color: accent || 'var(--text-1)' }) }}>{value}</div>
      {sub ? <div style={tileSub}>{sub}</div> : null}
    </div>
  );
}

// The GOAL HERO — the emotional centre of the card. Each goal gets a big
// moving-gold headline (current pace toward target), a glowing gold track with a
// pace notch (where the calendar says you should be today), and an honest
// on-track / behind read. BOTH goals carry the moving gold — this is the thing an
// agent should feel every time they open their record.
function GoalHero({ label, currentNode, goalNode, unit, onTrack, progress, elapsed, projNode, footLeft }) {
  const railGrad = `linear-gradient(90deg, ${DEEP}, ${G} 40%, ${CHAMP} 70%, ${G})`;
  return (
    <div style={{
      position: 'relative', borderRadius: 14, padding: '15px 16px 14px',
      background: 'linear-gradient(180deg, rgba(203,163,92,.09), rgba(203,163,92,.02))',
      border: '1px solid rgba(203,163,92,.3)', overflow: 'hidden',
    }}>
      <div aria-hidden style={{ position: 'absolute', top: -40, right: -30, width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle, rgba(235,203,130,.14), transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="gold-move" style={{ fontFamily: 'Barlow Condensed,sans-serif', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', fontSize: 11.5 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.02em', color: onTrack ? GREEN : RED, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: onTrack ? GREEN : RED, boxShadow: `0 0 6px ${onTrack ? GREEN : RED}` }} />
          {onTrack ? 'On track' : 'Behind pace'}
        </span>
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
        <span className="gold-move" style={{ fontFamily: 'Fraunces,serif', fontWeight: 300, fontSize: 34, lineHeight: 1, letterSpacing: '-.01em' }}>{currentNode}</span>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>of</span>
        <span style={{ fontFamily: 'Fraunces,serif', fontWeight: 300, fontSize: 20, color: 'var(--text-1)', lineHeight: 1 }}>{goalNode}</span>
        {unit ? <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{unit}</span> : null}
        <span style={{ marginLeft: 'auto', fontFamily: 'Fraunces,serif', fontSize: 20, fontWeight: 300, color: onTrack ? GREEN : G }}>{progress}%</span>
      </div>
      <div style={{ position: 'relative', height: 12, borderRadius: 999, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(203,163,92,.18)', marginTop: 11, overflow: 'hidden' }}>
        <div style={{ width: Math.max(progress, 1.5) + '%', height: '100%', borderRadius: 999, background: railGrad, backgroundSize: '220% auto', animation: 'goldGlide 6s linear infinite', boxShadow: '0 0 10px rgba(235,203,130,.4)' }} />
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: -13 }}>
        <div title="where the year is today" style={{ position: 'absolute', left: `calc(${elapsed}% - 1px)`, top: -1, width: 2, height: 14, background: 'var(--text-1)', opacity: .85, borderRadius: 1, boxShadow: '0 0 3px rgba(0,0,0,.6)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, gap: 8 }}>
        <span>{footLeft}</span>
        <span>projecting <b style={{ color: onTrack ? GREEN : 'var(--text-2)', fontWeight: 700 }}>{projNode}</b></span>
      </div>
    </div>
  );
}

function LockTile() {
  return (
    <div style={{ ...tileBox, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 2, opacity: .45 }}>
      <span style={{ fontSize: 15, color: G }}>◆</span>
      <span style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Brokerage</span>
    </div>
  );
}

export default function AgentProduction({ contactId, canEdit = false }) {
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [gciDraft, setGciDraft] = useState('');
  const [salesDraft, setSalesDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    // One retry: on a cold iOS wake the very first call can still race the token
    // refresh and come back empty/errored. A single short retry turns a blank
    // card into a populated one without a visible flicker.
    let data = null, error = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      ({ data, error } = await supabase.rpc('contact_production', { p_contact_id: contactId }));
      if (!error && data && (data.linked || data.restricted)) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 600));
    }
    setLoading(false);
    if (error) { setP(null); return; }
    setP(data || null);
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  const saveGoals = async () => {
    const gci = Number(String(gciDraft).replace(/[^0-9.]/g, ''));
    const sales = Number(String(salesDraft).replace(/[^0-9.]/g, ''));
    setSaving(true);
    const { error } = await supabase.rpc('set_agent_goal', {
      p_contact_id: contactId,
      p_gci_goal: gci > 0 ? gci : null,
      p_sales_goal: sales > 0 ? sales : null,
    });
    setSaving(false);
    if (error) { window.__notify?.('Could not save goals: ' + error.message, 'error'); return; }
    setEditing(false);
    load();
  };

  if (loading || !p || !p.linked) return null;
  const y = p.ytd || {}, l = p.l12 || {}, g = p.goal || {};
  const broker = !!p.viewer_is_broker;
  if (!y.sales && !l.sales && !y.gci) return null;

  const elapsed = Math.min(100, g.year_elapsed_pct || 0);
  const gciGoal = g.gci_goal, salesGoal = g.sales_goal;
  const unitsGoal = g.units_goal;            // dollar volume goal ÷ avg sale price = target closings
  const avgPriceUsed = g.avg_price_used;     // the price we divided by (agent's own or company avg)
  const gciProg = gciGoal ? Math.min(100, Math.round((y.gci / gciGoal) * 100)) : 0;
  const salesProg = unitsGoal ? Math.min(100, Math.round((y.sales / unitsGoal) * 100)) : 0;
  const hasGoals = gciGoal || unitsGoal;

  return (
    <div style={{ ...card, marginTop: 14 }} className="fade-up">
      {/* header: title + rank, and a quiet Brokerage badge for owner/broker */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gold-move" style={eyebrow}>Production</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{'\u00B7'} {p.year}</span>
          {broker && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: DEEP, border: `1px solid ${DEEP}`, borderRadius: 5, padding: '2px 6px', textTransform: 'uppercase' }}>Brokerage view</span>}
        </div>
        {y.rank ? <div style={{ fontSize: 11, color: 'var(--text-3)' }}>#{y.rank} of {y.of} by GCI</div> : null}
      </div>

      {/* ── ROW 1 — Sales · Volume · GCI ── */}
      <div style={tileGrid}>
        <Tile label="Sales" value={y.sales ?? 0} sub={y.avg_price ? `avg ${compact(y.avg_price)}` : null} />
        <Tile label="Volume" value={compact(y.volume)} sub={(y.list_side || y.buy_side) ? `${y.list_side || 0} list / ${y.buy_side || 0} buy` : null} />
        <Tile label="GCI" value={compact(y.gci)} accent={CHAMP} sub={y.comm_rate ? `${pct(y.comm_rate)} rate` : null} />
      </div>

      {/* ── ROW 2 — Avg Rate · Agent Kept · Company $ (last two are broker-only) ── */}
      <div style={{ ...tileGrid, marginTop: 8 }}>
        <Tile label="Avg Rate" value={pct(y.comm_rate)} sub="commission / price" />
        {broker
          ? <Tile label="Agent Kept" value={y.split_pct ? pct(y.split_pct) : '—'} sub={y.agent_earned ? compact(y.agent_earned) : null} broker />
          : <LockTile />}
        {broker
          ? <Tile label="Company $" value={compact(y.company_dollar)} sub="what ROG earned" broker />
          : <LockTile />}
      </div>
      {!broker && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 6, opacity: .7, textAlign: 'center' }}>
          ◆ Split &amp; company figures are visible to brokerage leadership.
        </div>
      )}

      {/* ── GOALS + PACE — BOTH goals carry the moving gold; this is the hero ── */}
      <div style={{ marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--border)', display: 'grid', gap: 12 }}>
        {gciGoal ? (
          <GoalHero label="GCI Goal"
            currentNode={compact(y.gci)} goalNode={compact(gciGoal)}
            onTrack={g.gci_on_track} progress={gciProg} elapsed={elapsed}
            projNode={compact(g.gci_projected)}
            footLeft={<>{elapsed}% of year elapsed</>} />
        ) : null}
        {unitsGoal ? (
          <GoalHero label="Sales Goal"
            currentNode={num(y.sales)} goalNode={num(unitsGoal)} unit="closings"
            onTrack={g.sales_on_track} progress={salesProg} elapsed={elapsed}
            projNode={num(g.sales_projected)}
            footLeft={<>{num(y.sales)} of {num(unitsGoal)} closings{avgPriceUsed ? <span style={{ opacity: .7 }}> {'\u00B7'} at {compact(avgPriceUsed)} avg</span> : null}</>} />
        ) : null}

        {!hasGoals && !editing && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              No {p.year} goals yet {'\u2014'} projecting <b className="gold-move">{compact(g.gci_projected)}</b> GCI at this pace.
            </div>
            {canEdit && broker && (
              <button onClick={() => { setGciDraft(gciGoal ? String(gciGoal) : ''); setSalesDraft(salesGoal ? String(salesGoal) : ''); setEditing(true); }}
                style={{ background: 'rgba(203,163,92,.12)', border: `1px solid ${G}`, color: G, borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Set goals
              </button>
            )}
          </div>
        )}
        {hasGoals && canEdit && broker && !editing && (
          <button onClick={() => { setGciDraft(gciGoal ? String(gciGoal) : ''); setSalesDraft(salesGoal ? String(salesGoal) : ''); setEditing(true); }}
            style={{ justifySelf: 'start', background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 10.5, cursor: 'pointer', padding: 0 }}>
            edit goals
          </button>
        )}

        {editing && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 130px', minWidth: 0 }}>
                <span style={{ ...tileLab, color: G }}>GCI Goal ($)</span>
                <input autoFocus value={gciDraft} onChange={e => setGciDraft(e.target.value)} inputMode="numeric" placeholder="e.g. 150000"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 14, marginTop: 4 }} />
              </label>
              <label style={{ flex: '1 1 130px', minWidth: 0 }}>
                <span style={{ ...tileLab, color: G }}>Sales Volume Goal ($)</span>
                <input value={salesDraft} onChange={e => setSalesDraft(e.target.value)} inputMode="numeric" placeholder="e.g. 4000000"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 14, marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveGoals} disabled={saving}
                style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {saving ? 'Saving\u2026' : 'Save goals'}
              </button>
              <button onClick={() => setEditing(false)}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 8, padding: '9px 12px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── trailing 12 months ── */}
      <div style={{ marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--border)' }}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Last 12 months</div>
        <div style={tileGrid}>
          <Tile label="Sales" value={l.sales ?? 0} />
          <Tile label="Volume" value={compact(l.volume)} />
          <Tile label="GCI" value={compact(l.gci)} accent={CHAMP} />
        </div>
        <div style={{ ...tileGrid, marginTop: 8 }}>
          <Tile label="Avg Rate" value={pct(l.comm_rate)} />
          {broker
            ? <Tile label="Agent Kept" value={l.split_pct ? pct(l.split_pct) : '—'} sub={l.agent_earned ? compact(l.agent_earned) : null} broker />
            : <LockTile />}
          {broker
            ? <Tile label="Company $" value={compact(l.company_dollar)} sub="what ROG earned" broker />
            : <LockTile />}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.45 }}>
          Rolling 12 months to today, by date received. {y.last_close ? `Last closing ${y.last_close}.` : 'No dated closing on file.'}
          {' '}Rates are commission over sale price.
        </div>
      </div>
    </div>
  );
}
