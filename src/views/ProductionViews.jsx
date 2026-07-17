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
        <b style={{ color: p.onTrack ? 'var(--accent-2)' : EMBER, letterSpacing: '.03em' }}>
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

  const producer = Number(row.gci) > 0;
  const staffEarner = !producer && Number(row.fee_income) > 0;

  // ── Staff / non-producing: a different job needs a different scoreboard ────
  // Josh earns TC fees, mentor splits and broker-of-record weeks. Showing him
  // GCI-against-goal cards would measure a plumber by his typing speed.
  if (staffEarner) return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...lab, color: 'var(--accent)' }}>Your 2026 · office &amp; support work</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <div style={card}>
          <div style={lab}>Paid to you — fees, not commission</div>
          <div style={{ ...big, color: 'var(--accent-2)' }}>{money(row.fee_income)}</div>
          <div style={sub}>{row.fee_rows} payments — transaction coordination, mentoring and broker-of-record work. Deliberately kept out of GCI: it isn’t commission, and counting it toward a commission goal would flatter the number.</div>
        </div>
        <div style={card}>
          <div style={lab}>Your own sales</div>
          <div style={big}>{row.sales}</div>
          <div style={sub}>No commission was received in your name this year — every 2026 commission has been paid out, so this is the full picture, not a lag. Your income above is for a different job.</div>
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
            {row.noside > 0 && <span style={{ color: EMBER }}>{row.noside} sale{row.noside === 1 ? '' : 's'} with no side recorded. </span>}
            {row.no_price > 0 && <span style={{ color: EMBER }}>{row.no_price} commission{row.no_price === 1 ? '' : 's'} with no sale price recorded — the money counts, the volume can’t.</span>}
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
        <div style={{ ...big, color: Number(row.goal) ? (usePace(row).onTrack ? 'var(--accent-2)' : EMBER) : 'var(--text-1)' }}>{money(row.gci)}</div>
        {Number(row.goal) > 0
          ? <PaceTrack row={row} />
          : <div style={sub}>No goal set. Add one in <b>Finance → Blueprint</b> and this tracks itself.</div>}
        {Number(row.fee_income) > 0 && <div style={sub}>Plus {money(row.fee_income)} in fees and mentor income — counted separately, not toward your goal.</div>}
        <Months months={row.months} />
      </div>
    </div>
  );
}


// ── Import the GOLD report ───────────────────────────────────────────────────
// The browser only READS the workbook and posts raw cells; every rule (what counts
// as a sale, who an agent is, which rows are subtotals) lives in the edge function.
// A second copy of those rules here would drift, and then the preview and the board
// would disagree about the office's own revenue.
// SheetJS is ~800KB, so it is dynamically imported: it becomes its own chunk and
// never lands in the main bundle that every agent downloads on every visit.
function ImportGold({ onDone }) {
  const [tabs, setTabs] = useState(null);
  const [tab, setTab] = useState('');
  const [rowsByTab, setRowsByTab] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function readFile(file) {
    setErr(null); setPreview(null); setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const map = {};
      wb.SheetNames.forEach(n => {
        map[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })
          .map(r => (r || []).map(c => c instanceof Date ? c.toISOString().slice(0, 10) : c));
      });
      setRowsByTab(map); setTabs(wb.SheetNames);
      const guess = wb.SheetNames.find(n => /paid\s*2026/i.test(n)) || wb.SheetNames[0];
      setTab(guess);
    } catch (e) { setErr('Could not read that file: ' + (e.message || e)); }
    setBusy(false);
  }

  async function run(dry) {
    setBusy(true); setErr(null);
    try {
      const year = parseInt((tab.match(/(20\d{2})/) || [])[1] || '2026', 10);
      const { data, error } = await supabase.functions.invoke('brokerage-import', {
        body: { tab, year, rows: rowsByTab[tab], dry_run: dry },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreview(data);
      if (!dry) { setTimeout(() => onDone && onDone(), 600); }
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={lab}>Import the GOLD report</div>
      <input type="file" accept=".xlsx,.xlsm,.xls" onChange={e => e.target.files?.[0] && readFile(e.target.files[0])}
        style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 10 }} />

      {tabs && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={tab} onChange={e => { setTab(e.target.value); setPreview(null); }}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 100,
              color: 'var(--text-1)', padding: '8px 12px', fontSize: 13 }}>
            {tabs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button disabled={busy} onClick={() => run(true)}
            style={{ background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 100,
              color: 'var(--text-1)', padding: '8px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
            {busy ? 'Reading…' : 'Preview changes'}
          </button>
        </div>
      )}

      {err && <div style={{ ...sub, color: EMBER }}>{err}</div>}

      {preview && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            <b>{preview.rows}</b> rows · <b>{preview.sales}</b> sales · {preview.rentals} leases · {preview.fees} fees
            {' · '}volume <b>{moneyM(preview.volume)}</b> · GCI <b>{money(preview.gci)}</b><br />
            <span style={{ color: 'var(--accent-2)' }}>{preview.added} new</span>
            {' · '}{preview.updated} updated
            {preview.removed > 0 && <span style={{ color: EMBER }}> · {preview.removed} gone from the sheet (will be deleted here)</span>}
            {preview.noPrice > 0 && <span style={{ color: EMBER }}> · {preview.noPrice} commission(s) with no sale price</span>}
            {preview.skipped > 0 && <span style={{ color: 'var(--text-3)' }}> · {preview.skipped} subtotal/blank rows ignored</span>}
          </div>

          {preview.unmatched?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: EMBER }}>
              <b>{preview.unmatched.length} name{preview.unmatched.length === 1 ? '' : 's'} not on the roster — these rows will NOT be imported:</b>
              <div style={{ color: 'var(--text-2)', marginTop: 4 }}>
                {preview.unmatched.map(u => `${u.name} (${u.rows})`).join(' · ')}
              </div>
              <div style={{ color: 'var(--text-3)', marginTop: 4 }}>
                Add them under Agent Roster, or fix the spelling in the sheet, then preview again.
              </div>
            </div>
          )}

          {preview.dry_run
            ? <button disabled={busy} onClick={() => run(false)}
                style={{ marginTop: 12, background: 'var(--accent-2)', color: '#1a1409', border: 'none', borderRadius: 100,
                  padding: '10px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                {busy ? 'Importing…' : `Import ${preview.rows} rows into ${preview.tab}`}
              </button>
            : <div style={{ ...sub, color: 'var(--accent-2)' }}>✓ Imported. Refreshing…</div>}
        </div>
      )}
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

  if (err) return <div className="view"><div style={{ ...card, color: EMBER }}>Couldn’t load production: {err}</div></div>;
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
          <div style={sub}>of {rows.length} on the roster · <b style={{ color: EMBER }}>{quiet.length}</b> with nothing paid this year</div></div>
        <div style={card}><div style={lab}>Goals set</div><div style={big}>{withGoal.length}</div>
          <div style={sub}>{withGoal.length === 0
            ? 'Nobody has a goal — "on track" can’t mean anything yet'
            : <><b style={{ color: EMBER }}>{behind.length}</b> behind pace</>}</div></div>
      </div>

      <ImportGold onDone={() => window.location.reload()} />

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
                  {r.noside > 0 && <span title={`${r.noside} sale(s) missing a Buy/List flag`} style={{ color: EMBER, marginLeft: 6, fontSize: 10 }}>⚑</span>}
                  {r.no_price > 0 && <span title={`${r.no_price} commission(s) with no sale price recorded`} style={{ color: EMBER, marginLeft: 4, fontSize: 10 }}>$?</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                  {r.sales} sales · L{r.listings}/B{r.buyers} · {r.comm_rate ? Number(r.comm_rate).toFixed(2) + '%' : '—'} · {moneyM(r.volume)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{money(r.gci)}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: !p.goal ? 'var(--text-3)' : (p.onTrack ? 'var(--accent-2)' : EMBER) }}>
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
