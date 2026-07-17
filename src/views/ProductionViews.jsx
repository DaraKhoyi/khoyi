import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

// ── Production ───────────────────────────────────────────────────────────────
// Two consumers of ONE rpc (public.production_stats):
//   MyProduction   -> the agent's own numbers, top of "My numbers"
//   ProductionBoard-> the office, at Brokerage > Agent Roster > Commission On Track?
// Rank is computed in the database on purpose: an agent must be able to learn
// "you are #7" without being able to read what anyone else earned.

const EMBER = '#C9563F';   // warm ember: reads as 'behind' without shouting
const money  = n => '$' + Math.round(Number(n) || 0).toLocaleString();
const moneyM = n => (Number(n) || 0) >= 1e6 ? '$' + ((Number(n)/1e6).toFixed(2)) + 'M' : money(n);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const yearFrac = () => {
  const now = new Date(), y = now.getFullYear();
  const start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
  return (now - start) / (end - start);
};

export function usePace(row) {
  const goal = Number(row?.goal) || 0;
  const gci = Number(row?.gci) || 0;
  const yf = yearFrac();
  if (!goal) return { goal: 0 };
  const expected = goal * yf;
  const onTrack = gci >= expected;
  const perDeal = row.sales > 0 ? gci / row.sales : 0;
  // "How many transactions behind" only means something if we know what a deal is
  // worth to this person. With no closings yet there is no such number, and
  // inventing one from the office average would be a guess wearing a number's clothes.
  const behindBy = (!onTrack && perDeal > 0) ? Math.max(1, Math.ceil((expected - gci) / perDeal)) : null;
  return { goal, expected, onTrack, yf, shortfall: expected - gci, ahead: gci - expected, behindBy, pct: goal ? gci / goal : 0 };
}

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 16px 14px' };
const lab  = { fontSize: 9.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 800, marginBottom: 8 };
const big  = { fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 34, lineHeight: 1 };
const sub  = { fontSize: 11.5, color: 'var(--text-2)', marginTop: 7, lineHeight: 1.5 };

function PaceTrack({ row }) {
  const p = usePace(row);
  if (!p.goal) return null;
  const fillW = Math.min(p.pct * 100, 100);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ position: 'relative', height: 30, borderRadius: 8, background: 'rgba(246,241,231,.07)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: '0 auto 0 0', width: fillW + '%', borderRadius: 8,
          background: p.onTrack ? 'linear-gradient(90deg,rgba(203,163,92,.30),rgba(235,203,130,.65))'
                                : 'linear-gradient(90deg,rgba(201,86,63,.28),rgba(201,86,63,.62))',
          transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: (p.yf * 100) + '%', width: 2, background: 'var(--text-1)', opacity: .8 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
        <b style={{ color: p.onTrack ? 'var(--accent-2)' : 'EMBER', letterSpacing: '.03em' }}>
          {p.onTrack
            ? `ON TRACK — ${money(p.ahead)} ahead of pace`
            : `BEHIND — ${money(p.shortfall)} short${p.behindBy ? ` · about ${p.behindBy} more transaction${p.behindBy === 1 ? '' : 's'}` : ''}`}
        </b>
        <span style={{ color: 'var(--text-2)' }}>{Math.round(p.pct * 100)}% of {money(p.goal)} · year {Math.round(p.yf * 100)}% gone</span>
      </div>
    </div>
  );
}

function Months({ months }) {
  const vals = MON.map((_, i) => Number(months?.[String(i + 1).padStart(2, '0')]) || 0);
  const mx = Math.max(...vals, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginTop: 12 }}>
      {vals.map((v, i) => (
        <div key={i} title={`${MON[i]}: ${money(v)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5, height: '100%' }}>
          <div style={{ width: '100%', height: Math.max(v > 0 ? (v / mx) * 100 : 2, 2) + '%', borderRadius: '4px 4px 0 0',
            background: 'linear-gradient(180deg,var(--accent-2),var(--accent-dim))', opacity: v ? 1 : .16 }} />
          <span style={{ fontSize: 8.5, letterSpacing: '.08em', color: 'var(--text-3)', fontWeight: 700 }}>{MON[i][0]}</span>
        </div>
      ))}
    </div>
  );
}

// ── The agent's own numbers ──────────────────────────────────────────────────
export function MyProduction({ year = 2026 }) {
  const [row, setRow] = useState(undefined);   // undefined = loading, null = no row
  useEffect(() => { (async () => {
    try {
      const { data, error } = await supabase.rpc('production_stats', { p_year: year });
      if (error) throw error;
      setRow((data || []).find(r => r.is_me) || null);
    } catch (e) { setRow(null); }
  })(); }, [year]);

  if (row === undefined) return <div style={{ ...card, marginBottom: 14, color: 'var(--text-3)', fontSize: 12 }}>Loading your production…</div>;
  if (!row) return null;

  const producer = row.sales > 0;
  const staffEarner = !producer && Number(row.fee_income) > 0;

  // ── Staff / non-producing: a different job needs a different scoreboard ────
  // Josh earns TC fees, mentor splits and broker-of-record weeks. Showing him
  // GCI-against-goal cards would measure a plumber by his typing speed.
  if (staffEarner) return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...lab, color: 'var(--accent)' }}>Your 2026 · office &amp; support work</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <div style={card}>
          <div style={lab}>Paid to you</div>
          <div style={{ ...big, color: 'var(--accent-2)' }}>{money(row.fee_income)}</div>
          <div style={sub}>{row.fee_rows} payments — transaction coordination, mentoring and broker work</div>
        </div>
        <div style={card}>
          <div style={lab}>Your own sales</div>
          <div style={big}>{row.sales}</div>
          <div style={sub}>Nothing closed in your name this year. If you have closings that simply haven’t been paid out yet, they won’t appear here until they are.</div>
        </div>
      </div>
    </div>
  );

  // ── New / no production yet: never open with a rank ────────────────────────
  // A screen that greets a brand-new agent with "$0 · #51 · BEHIND" is hostile
  // to exactly the person we most want using this app.
  if (!producer) return (
    <div style={{ marginBottom: 18 }}>
      <div style={lab}>Your 2026</div>
      <div style={card}>
        <div style={{ ...big, fontSize: 26 }}>Your first closing isn’t in yet.</div>
        <div style={{ ...sub, fontSize: 12.5 }}>
          Nothing has been paid out in your name in 2026 — so there’s nothing to rank, and no pace to be behind on.
          {Number(row.goal) > 0 && <> Your goal of <b style={{ color: 'var(--accent-2)' }}>{money(row.goal)}</b> is set and waiting.</>}
          {' '}The moment a closing is paid, this fills in on its own.
        </div>
      </div>
    </div>
  );

  // ── Producing agent: the full set ─────────────────────────────────────────
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={lab}>Your 2026 production</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <div style={card}>
          <div style={lab}>Gross sales volume</div>
          <div style={big}>{moneyM(row.volume)}</div>
          <div style={sub}>{row.sales} closed · avg {moneyM(row.avg_price)} · best {moneyM(row.top_sale)}</div>
        </div>

        <div style={card}>
          <div style={lab}>Sides represented</div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
            <div><div style={big}>{row.listings}</div><div style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--text-3)', fontWeight: 700, marginTop: 3 }}>LISTINGS</div></div>
            <div><div style={big}>{row.buyers}</div><div style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--text-3)', fontWeight: 700, marginTop: 3 }}>BUYERS</div></div>
          </div>
          <div style={sub}>
            {row.double_ends > 0 && <><b style={{ color: 'var(--accent-2)' }}>{row.double_ends} double-ended</b> — both sides, paid twice. </>}
            {row.rentals > 0 && <>{row.rentals} lease{row.rentals === 1 ? '' : 's'} counted separately. </>}
            {row.noside > 0 && <span style={{ color: 'EMBER' }}>{row.noside} sale{row.noside === 1 ? '' : 's'} with no side recorded.</span>}
          </div>
        </div>

        <div style={card}>
          <div style={lab}>Avg commission rate</div>
          <div style={big}>{row.comm_rate ? Number(row.comm_rate).toFixed(2) + '%' : '—'}</div>
          <div style={sub}>Before fees or splits · weighted across {moneyM(row.volume)}</div>
        </div>

        <div style={card}>
          <div style={lab}>Rank in office</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, color: 'var(--accent)' }}>#</span>
            <span style={big}>{row.rank_gci}</span>
            {row.rank_gci <= 20 && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: 100, border: '1px solid var(--border)', color: 'var(--accent-2)', marginLeft: 4 }}>
              {row.rank_gci <= 3 ? ['Top of the house', 'Runner-up', 'Third'][row.rank_gci - 1] : 'Top 20'}</span>}
          </div>
          <div style={sub}>of {row.producers} agents who closed this year · #{row.rank_vol} by volume</div>
        </div>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={lab}>GCI against your goal</div>
        <div style={{ ...big, color: Number(row.goal) ? (usePace(row).onTrack ? 'var(--accent-2)' : 'EMBER') : 'var(--text-1)' }}>{money(row.gci)}</div>
        {Number(row.goal) > 0
          ? <PaceTrack row={row} />
          : <div style={sub}>No goal set. Add one in <b>Finance → Blueprint</b> and this tracks itself.</div>}
        {Number(row.fee_income) > 0 && <div style={sub}>Plus {money(row.fee_income)} in fees and mentor income.</div>}
        <Months months={row.months} />
      </div>
    </div>
  );
}

// ── The office board (staff only) ────────────────────────────────────────────
export default function ProductionBoard({ year = 2026 }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { (async () => {
    try {
      const { data, error } = await supabase.rpc('production_stats', { p_year: year });
      if (error) throw error;
      setRows(data || []);
    } catch (e) { setErr(e.message || String(e)); }
  })(); }, [year]);

  if (err) return <div className="view"><div style={{ ...card, color: 'EMBER' }}>Couldn’t load production: {err}</div></div>;
  if (!rows) return <div className="view"><div style={{ color: 'var(--text-3)' }}>Loading production…</div></div>;

  const producers = rows.filter(r => r.sales > 0);
  const quiet = rows.filter(r => r.sales === 0 && Number(r.fee_income) === 0 && !r.is_staff_role);
  const officeVol = producers.reduce((s, r) => s + Number(r.volume), 0);
  const officeGci = rows.reduce((s, r) => s + Number(r.gci), 0);
  const show = producers.filter(r => !q || r.agent_name.toLowerCase().includes(q.toLowerCase()));
  const withGoal = producers.filter(r => Number(r.goal) > 0);
  const behind = withGoal.filter(r => !usePace(r).onTrack);

  return (
    <div className="view ww-prism">
      <div style={{ marginBottom: 16 }}>
        <div style={lab}>Brokerage · {year}</div>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 32, margin: '4px 0 0' }}>Commission on track?</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 14 }}>
        <div style={card}><div style={lab}>Office volume</div><div style={big}>{moneyM(officeVol)}</div>
          <div style={sub}>{producers.reduce((s, r) => s + r.sales, 0)} closed sales</div></div>
        <div style={card}><div style={lab}>Office GCI</div><div style={big}>{moneyM(officeGci)}</div>
          <div style={sub}>Gross commission received</div></div>
        <div style={card}><div style={lab}>Producing agents</div><div style={big}>{producers.length}</div>
          <div style={sub}>of {rows.length} on the roster · <b style={{ color: 'EMBER' }}>{quiet.length}</b> with nothing paid this year</div></div>
        <div style={card}><div style={lab}>Goals set</div><div style={big}>{withGoal.length}</div>
          <div style={sub}>{withGoal.length === 0
            ? 'Nobody has a goal — "on track" can’t mean anything yet'
            : <><b style={{ color: 'EMBER' }}>{behind.length}</b> behind pace</>}</div></div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an agent…"
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 100,
          color: 'var(--text-1)', padding: '11px 16px', fontSize: 14, marginBottom: 12, outline: 'none' }} />

      <div style={{ ...card, padding: 8 }}>
        {show.map(r => {
          const p = usePace(r);
          return (
            <div key={r.agent_id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 10, alignItems: 'center',
              padding: '9px 8px', borderRadius: 8, background: r.is_me ? 'rgba(203,163,92,.10)' : 'transparent' }}>
              <span style={{ fontFamily: 'Fraunces, Georgia, serif', color: 'var(--accent)', fontSize: 14 }}>
                {String(r.rank_gci).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.agent_name}
                  {r.noside > 0 && <span title={`${r.noside} sale(s) missing a Buy/List flag`} style={{ color: 'EMBER', marginLeft: 6, fontSize: 10 }}>⚑</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                  {r.sales} sales · L{r.listings}/B{r.buyers} · {r.comm_rate ? Number(r.comm_rate).toFixed(2) + '%' : '—'} · {moneyM(r.volume)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{money(r.gci)}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: !p.goal ? 'var(--text-3)' : (p.onTrack ? 'var(--accent-2)' : 'EMBER') }}>
                  {!p.goal ? 'no goal' : (p.onTrack ? 'on track' : `${money(p.shortfall)} short`)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {quiet.length > 0 && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={lab}>Nothing paid this year — {quiet.length} agents</div>
          <div style={{ ...sub, marginBottom: 8 }}>The people a production report usually hides. Worth a conversation, not a chart.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {quiet.map(r => <span key={r.agent_id} style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 100,
              border: '1px solid var(--border)', color: 'var(--text-2)' }}>{r.agent_name}</span>)}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.7 }}>
        Source: <b>Paid 2026</b> tab of the GOLD report. Leases are counted separately from sales — their commission is
        roughly one month’s rent, so folding them in would report rates above 50%. Monthly subtotal rows inside the sheet
        are excluded. Commission rate is weighted (commission ÷ volume). Goals come from each agent’s
        <b> Finance → Blueprint</b>. ⚑ marks sales with no Buy/List flag recorded.
      </div>
    </div>
  );
}
