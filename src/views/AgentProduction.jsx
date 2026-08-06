import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── AgentProduction ─────────────────────────────────────────────────────────
// Production figures on an agent's contact record. Every number comes from the
// contact_production RPC — the maths lives in the database so two screens can
// never disagree, and the phone does none of it.
//
// Renders nothing at all when the contact is not an agent, or is an agent with
// no transactions: an empty grid of zeroes on a plumber's record is noise.

const G = '#CBA35C', CHAMP = '#EBCB82', GREEN = '#7fae8f', RED = '#e0794f';

const usd = (n, cents = false) => (n || n === 0)
  ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: cents ? 0 : 0 })
  : '—';
const compact = (n) => {
  if (!n && n !== 0) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 2) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const pct = (n) => (n || n === 0) ? Number(n).toFixed(n >= 10 ? 1 : 2) + '%' : '—';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const eyebrow = { fontFamily: 'Barlow Condensed,sans-serif', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: G, fontSize: 11.5, margin: '0 0 8px' };
const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8 };
const tileBox = { background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', minWidth: 0 };
const tileLab = { fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const tileVal = { fontFamily: 'Fraunces,serif', fontSize: 21, color: 'var(--text-1)', lineHeight: 1.15, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' };
const tileSub = { fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 };

function Tile({ label, value, sub, accent }) {
  return (
    <div style={tileBox}>
      <div style={tileLab}>{label}</div>
      <div style={{ ...tileVal, color: accent || 'var(--text-1)' }}>{value}</div>
      {sub ? <div style={tileSub}>{sub}</div> : null}
    </div>
  );
}

export default function AgentProduction({ contactId, canEdit = false }) {
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('contact_production', { p_contact_id: contactId });
    setLoading(false);
    if (error) { setP(null); return; }
    setP(data || null);
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  const saveGoal = async () => {
    const v = Number(String(goalDraft).replace(/[^0-9.]/g, ''));
    if (!v || v <= 0) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase.rpc('set_agent_goal', { p_contact_id: contactId, p_goal: v });
    setSaving(false);
    if (error) { window.__notify?.('Could not save the goal: ' + error.message, 'error'); return; }
    setEditing(false);
    load();
  };

  if (loading || !p || !p.linked) return null;
  const y = p.ytd || {}, l = p.l12 || {}, g = p.goal || {};
  // An agent with nothing on the books gets no panel — an empty grid says less
  // than no grid at all.
  if (!y.sales && !l.sales && !y.gci) return null;

  const goal = g.gci_goal;
  const progress = goal ? Math.min(100, Math.round((y.gci / goal) * 100)) : 0;
  const elapsed = Math.min(100, g.year_elapsed_pct || 0);
  const onTrack = g.on_track;

  return (
    <div style={{ ...card, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={eyebrow}>Production {'\u00B7'} {p.year}</div>
        {y.rank ? <div style={{ fontSize: 11, color: 'var(--text-3)' }}>#{y.rank} of {y.of} by GCI</div> : null}
      </div>

      {/* ── this year ── */}
      <div style={tileGrid}>
        <Tile label="Sales" value={y.sales ?? 0} sub={y.avg_price ? `avg ${compact(y.avg_price)}` : null} />
        <Tile label="Volume" value={compact(y.volume)} sub={y.list_side || y.buy_side ? `${y.list_side || 0} list / ${y.buy_side || 0} buy` : null} />
        <Tile label="GCI" value={compact(y.gci)} accent={CHAMP} sub={y.comm_rate ? `${pct(y.comm_rate)} avg rate` : null} />
        <Tile label="Agent kept" value={y.split_pct ? pct(y.split_pct) : '—'} sub={y.agent_earned ? compact(y.agent_earned) : null} />
        <Tile label="Company $" value={compact(y.company_dollar)} sub="what ROG earned" />
      </div>

      {/* ── goal + pace ── */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        {goal ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                <b style={{ color: 'var(--text-1)' }}>{compact(y.gci)}</b> of <b style={{ color: 'var(--text-1)' }}>{compact(goal)}</b> goal
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: onTrack ? GREEN : RED }}>
                {onTrack ? '\u2713 On track' : `Behind by ${compact(Math.abs(g.gap || 0))}`}
              </div>
            </div>
            {/* The bar is progress; the notch is where the calendar says you should
                be today. Progress alone cannot answer "am I on track". */}
            <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'var(--bg-base)', border: '1px solid var(--border)', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: progress + '%', height: '100%', background: `linear-gradient(90deg, ${G}, ${CHAMP})` }} />
            </div>
            <div style={{ position: 'relative', height: 12, marginTop: -11 }}>
              <div title="where the year is today" style={{ position: 'absolute', left: `calc(${elapsed}% - 1px)`, top: -1, width: 2, height: 12, background: onTrack ? GREEN : RED, borderRadius: 1 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
              <span>{progress}% of goal {'\u00B7'} {elapsed}% of the year gone</span>
              <span>projecting {compact(g.projected)}</span>
            </div>
            {canEdit && !editing && (
              <button onClick={() => { setGoalDraft(String(goal)); setEditing(true); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 10.5, cursor: 'pointer', padding: '4px 0 0' }}>
                edit goal
              </button>
            )}
          </>
        ) : editing ? null : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              No {p.year} goal set {'\u2014'} projecting <b style={{ color: CHAMP }}>{compact(g.projected)}</b> at this pace.
            </div>
            {canEdit && (
              <button onClick={() => { setGoalDraft(''); setEditing(true); }}
                style={{ background: 'rgba(203,163,92,.12)', border: `1px solid ${G}`, color: G, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Set a goal
              </button>
            )}
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input autoFocus value={goalDraft} onChange={e => setGoalDraft(e.target.value)} inputMode="numeric"
              placeholder={`${p.year} GCI goal, e.g. 150000`}
              style={{ flex: '1 1 150px', minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 14 }} />
            <button onClick={saveGoal} disabled={saving}
              style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              {saving ? 'Saving\u2026' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 8, padding: '9px 12px', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ── trailing 12 months ── */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Last 12 months</div>
        <div style={tileGrid}>
          <Tile label="Sales" value={l.sales ?? 0} />
          <Tile label="Volume" value={compact(l.volume)} />
          <Tile label="Gross commission" value={compact(l.gci)} accent={CHAMP} />
          <Tile label="Avg rate" value={pct(l.comm_rate)} />
          <Tile label="Agent kept" value={l.split_pct ? pct(l.split_pct) : '—'} sub={l.agent_earned ? compact(l.agent_earned) : null} />
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.45 }}>
          Rolling 12 months to today, by date received. {y.last_close ? `Last closing ${y.last_close}.` : 'No dated closing on file.'}
          {' '}Rates are commission over sale price; a few older rows have no date and sit outside this window.
        </div>
      </div>
    </div>
  );
}
