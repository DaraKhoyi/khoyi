import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── Transaction Pipeline ─────────────────────────────────────────────────────
// The brokerage's live deals, from offer-out to paid. Every deal card leads with
// the ONE next action and a health dot — the pipeline reads its own state so you
// see what needs you at a glance. All lifecycle logic lives in the DB (the
// transaction_state / advance_txn_stage / set_txn_milestone RPCs), so the board
// and the detail panel can never disagree about what a deal needs next.

const STAGES = [
  { key: 'offer_out',         label: 'Offer Out' },
  { key: 'under_negotiation', label: 'Negotiating' },
  { key: 'under_contract',    label: 'Under Contract' },
  { key: 'due_diligence',     label: 'Due Diligence' },
  { key: 'clear_to_close',    label: 'Clear to Close' },
  { key: 'closing',           label: 'Closing' },
  { key: 'closed',            label: 'Closed' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]));
const GOLD = '#C5A95E', CHAMP = '#EBCB82';
const HEALTH = {
  on_track:  { c: '#22c55e', t: 'On track' },
  attention: { c: '#EBCB82', t: 'Needs a look' },
  stalled:   { c: '#ef4444', t: 'Stalled' },
  done:      { c: '#6b7280', t: 'Done' },
};
const money = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
};

export default function TransactionPipeline() {
  const [deals, setDeals] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('txn_pipeline');
      if (error) throw error;
      setDeals(Array.isArray(data) ? data : []);
    } catch (_) { setDeals([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byStage = (k) => (deals || []).filter(d => d.stage === k);
  const active = (deals || []).filter(d => d.deal_status === 'active');
  const attention = active.filter(d => d.health === 'stalled' || d.health === 'attention');

  return (
    <div className="ww-txn" style={{ paddingBottom: 90 }}>
      <style>{`
        .ww-txn{ --card:#1B1610; --line:#2a2016; }
        .txn-rail{ display:flex; gap:12px; overflow-x:auto; padding:4px 2px 12px; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; }
        .txn-col{ flex:0 0 82vw; max-width:320px; scroll-snap-align:start; }
        @media(min-width:900px){ .txn-col{ flex:0 0 268px; } }
        .txn-card{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 14px; margin-bottom:10px; cursor:pointer; transition:border-color .15s, transform .1s; }
        .txn-card:hover{ border-color:${GOLD}; transform:translateY(-1px); }
        .txn-next{ color:${CHAMP}; font-size:13px; font-weight:600; line-height:1.25; }
        .dot{ width:8px; height:8px; border-radius:50%; display:inline-block; flex:none; }
      `}</style>

      <div className="page-header fade-up" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm"
            style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '8px 15px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            + New deal
          </button>
        </div>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Transactions</div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>The Pipeline.</h2>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {active.length} live {active.length === 1 ? 'deal' : 'deals'}
          {attention.length > 0 && <> · <span style={{ color: CHAMP }}>{attention.length} need{attention.length === 1 ? 's' : ''} attention</span></>}
        </div>
        <div className="gold-hairline" style={{ height: 1, background: 'linear-gradient(90deg,transparent,' + GOLD + '55,transparent)', margin: '10px 0' }} />
      </div>

      {deals === null ? (
        <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>Loading the pipeline…</div>
      ) : active.length === 0 ? (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-3)' }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: 'var(--text-2)', marginBottom: 6 }}>No live deals yet.</div>
          <div style={{ fontSize: 13, marginBottom: 14 }}>Start one when an agent sends an offer on a property.</div>
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm" style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 800, cursor: 'pointer' }}>+ New deal</button>
        </div>
      ) : (
        <div className="txn-rail">
          {STAGES.filter(s => s.key !== 'closed' || byStage('closed').length).map(s => {
            const col = byStage(s.key);
            return (
              <div key={s.key} className="txn-col">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 2px' }}>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.12em', fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--card)', borderRadius: 20, padding: '1px 8px', border: '1px solid var(--line)' }}>{col.length}</span>
                </div>
                {col.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', opacity: .5, padding: '8px 2px' }}>—</div>
                ) : col.map(d => (
                  <div key={d.id} className="txn-card" onClick={() => setOpenId(d.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span className="dot" style={{ background: (HEALTH[d.health] || HEALTH.done).c }} title={(HEALTH[d.health] || HEALTH.done).t} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.address || 'Untitled deal'}</span>
                    </div>
                    <div className="txn-next">→ {d.next_action}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{d.agent_name || '—'}</span>
                      <span>{d.gross_sale ? money(d.gross_sale) : (d.days_in_stage + 'd')}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {openId && <TxnDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {creating && <NewDeal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function TxnDetail({ id, onClose, onChanged }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('transaction_state', { p_id: id });
    setSt(data || null);
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  const call = async (fn, args) => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      if (data && data.error) { setErr(data.blocked_by ? `Blocked: ${data.blocked_by}` : data.error); }
      else if (data) { setSt(data); onChanged && onChanged(); }
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const NEXT = { offer_out: 'under_negotiation', under_negotiation: 'under_contract', under_contract: 'due_diligence', due_diligence: 'clear_to_close', clear_to_close: 'closing', closing: 'closed' };

  if (!st) return null;
  const ms = st.milestones || [];
  const curStageMs = ms.filter(m => m.stage === st.stage);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', borderBottom: 'none', padding: '18px 18px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.18em', fontSize: 10.5, color: GOLD }}>#{st.trans_id} · {STAGE_LABEL[st.stage] || st.stage}</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 23, color: 'var(--text-1)', lineHeight: 1.15 }}>{st.address || 'Untitled deal'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #2a2016', color: 'var(--text-2)', borderRadius: 8, width: 34, height: 34, flex: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* next action banner */}
        <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 12, background: 'linear-gradient(155deg,rgba(197,169,94,.14),rgba(197,169,94,.03))', border: '1px solid rgba(197,169,94,.4)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 3 }}>Next action</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: CHAMP }}>{st.next_action}</div>
        </div>

        {err && <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#fecaca', marginBottom: 12 }}>{err}</div>}

        {/* financing toggle (only matters while live) */}
        {st.deal_status === 'active' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Financing:</span>
            {['cash', 'financed'].map(t => (
              <button key={t} disabled={busy} onClick={() => call('set_txn_financing', { p_id: id, p_type: t })}
                style={{ fontSize: 12, textTransform: 'capitalize', padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                  border: '1px solid ' + (st.financing_type === t ? GOLD : '#2a2016'),
                  background: st.financing_type === t ? GOLD : 'transparent', color: st.financing_type === t ? '#100D09' : 'var(--text-2)', fontWeight: st.financing_type === t ? 700 : 500 }}>{t}</button>
            ))}
          </div>
        )}

        {/* milestones for the current stage */}
        {curStageMs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 8 }}>This stage</div>
            {curStageMs.map(m => {
              const done = m.status === 'done' || m.status === 'waived';
              return (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #1e1810' }}>
                  <button disabled={busy} onClick={() => call('set_txn_milestone', { p_id: id, p_key: m.key, p_status: done ? 'pending' : 'done' })}
                    style={{ width: 22, height: 22, borderRadius: 6, flex: 'none', cursor: 'pointer',
                      border: '1.5px solid ' + (done ? '#22c55e' : '#3a3020'),
                      background: done ? '#22c55e' : 'transparent', color: '#100D09', fontWeight: 900, fontSize: 13, lineHeight: 1 }}>{done ? '✓' : ''}</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: done ? 'var(--text-3)' : 'var(--text-1)', textDecoration: m.status === 'waived' ? 'line-through' : 'none' }}>{m.label}</div>
                    {m.help && !done && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{m.help}</div>}
                  </div>
                  {!done && <button disabled={busy} onClick={() => call('set_txn_milestone', { p_id: id, p_key: m.key, p_status: 'waived' })}
                    style={{ fontSize: 11, color: 'var(--text-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}>N/A</button>}
                </div>
              );
            })}
          </div>
        )}

        {/* stage controls */}
        {st.deal_status === 'active' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {NEXT[st.stage] && (
              <button disabled={busy} onClick={() => call('advance_txn_stage', { p_id: id, p_to_stage: NEXT[st.stage] })}
                style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                Move to {STAGE_LABEL[NEXT[st.stage]]} →
              </button>
            )}
            <button disabled={busy} onClick={() => { const r = prompt('Why is this deal dead? (e.g. buyer walked, financing fell through)'); if (r) call('set_txn_dead', { p_id: id, p_reason: r }); }}
              style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>
              Mark dead
            </button>
          </div>
        )}

        {/* deal facts */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e1810', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {[['Agent', st.agent_name], ['Gross sale', st.gross_sale ? money(st.gross_sale) : '—'], ['Commission', st.gross_commission ? money(st.gross_commission) : '—'], ['Days in stage', st.days_in_stage]].map(([k, v]) => (
            <div key={k}><div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div><div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600 }}>{v ?? '—'}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── New deal ─────────────────────────────────────────────────────────────────
function NewDeal({ onClose, onCreated }) {
  const [addr, setAddr] = useState('');
  const [buyer, setBuyer] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!addr.trim()) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc('create_prism_txn', { p_address: addr.trim(), p_buyer: buyer.trim() || null });
      onCreated(data?.id);
    } catch (_) { setBusy(false); }
  };
  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base,#0f0b07)', border: '1px solid #2a2016', borderRadius: 8, color: 'var(--text-1)', padding: '10px 12px', fontSize: 14, marginBottom: 10 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 210, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 480, borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', padding: '20px 18px 34px' }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 21, color: 'var(--text-1)', marginBottom: 3 }}>New deal.</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>An offer's going out. Start tracking it now — it may or may not proceed.</div>
        <input autoFocus value={addr} onChange={e => setAddr(e.target.value)} placeholder="Property address" style={inp} />
        <input value={buyer} onChange={e => setBuyer(e.target.value)} placeholder="Buyer name (optional)" style={inp} />
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button disabled={busy || !addr.trim()} onClick={create} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: (busy || !addr.trim()) ? .6 : 1 }}>{busy ? 'Creating…' : 'Start deal'}</button>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 10, padding: '11px 18px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
