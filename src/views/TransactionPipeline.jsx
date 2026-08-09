import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { uploadDocuments } from './DocumentsView';
import LinkedDocuments from './LinkedDocuments';

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

export default function TransactionPipeline({ userId }) {
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
          {(() => { const vol = active.reduce((s, d) => s + (Number(d.gross_sale) || 0), 0); return vol > 0 ? <> · {money(vol)} in the pipeline</> : null; })()}
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

      {openId && <TxnDetail id={openId} userId={userId} onClose={() => setOpenId(null)} onChanged={load} />}
      {creating && <NewDeal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function TxnDetail({ id, userId, onClose, onChanged }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showFile, setShowFile] = useState(false);
  const [fundsFor, setFundsFor] = useState(null);   // milestone key being funded
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(false);
  const [deadOpen, setDeadOpen] = useState(false);
  const [tab, setTab] = useState('work');           // work | journey | history
  const [extract, setExtract] = useState(null);      // review panel after AI extraction
  const [extracting, setExtracting] = useState(false);
  const [datesEmail, setDatesEmail] = useState(null);
  const fileRefs = useRef({});

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('transaction_state', { p_id: id });
    setSt(data || null);
    const { data: ev } = await supabase.from('txn_events')
      .select('kind, from_stage, to_stage, milestone_key, actor_name, note, created_at')
      .eq('transaction_id', id).order('created_at', { ascending: false }).limit(40);
    setEvents(Array.isArray(ev) ? ev : []);
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  const call = async (fn, args) => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      if (data && data.error) { setErr(data.blocked_by ? `Blocked: ${data.blocked_by}` : data.error); }
      else if (data) { setSt(data); onChanged && onChanged(); refresh(); }
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const NEXT = { offer_out: 'under_negotiation', under_negotiation: 'under_contract', under_contract: 'due_diligence', due_diligence: 'clear_to_close', clear_to_close: 'closing', closing: 'closed' };

  // Upload a document for a milestone: files it to the transaction's library AND
  // marks the milestone done, carrying the document id so the file is reachable.
  const uploadFor = async (key, files) => {
    if (!files || !files.length) return;
    setBusy(true); setErr(null);
    try {
      const made = await uploadDocuments(Array.from(files), userId, [], [{ target_type: 'transaction', target_id: id }]);
      const docId = made && made[0] && made[0].id;
      await call('set_txn_milestone', { p_id: id, p_key: key, p_status: 'done', p_document_id: docId || null });
    } catch (e) { setErr(e.message || String(e)); setBusy(false); }
  };

  const FUND_METHODS = [
    ['wire', 'Wire from title company'],
    ['agent_check', 'Check from agent to deposit'],
    ['agent_deposit', 'Agent deposited to our account'],
    ['mailed_check', 'Check mailed to us'],
    ['other', 'Other'],
  ];

  // Read the executed contract with AI and open a review panel (propose, don't auto-apply).
  const runExtract = async (docId) => {
    setExtracting(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('txn-contract-extract', { body: { transaction_id: id, document_id: docId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setExtract(data);
    } catch (e) { setErr('Could not read the contract: ' + (e.message || e)); }
    setExtracting(false);
  };
  const applyExtract = async () => {
    const ex = extract?.extracted || {};
    const patch = {
      buyer_name: (ex.buyers || []).join(' & ') || null, seller_name: (ex.sellers || []).join(' & ') || null,
      purchase_price: ex.purchase_price || null, earnest_money: ex.earnest_money || null,
      financing_type: ex.financing_type || null, loan_type: ex.loan_type || null,
      effective_date: ex.effective_date || null, closing_date: ex.closing_date || null,
      address: ex.property_address || null, key_dates: extract?.key_dates || [], contract_data: ex,
    };
    setExtract(null);
    await call('apply_contract_extract', { p_id: id, p_data: patch, p_parties: extract?.parties || [] });
  };
  const openDatesEmail = async () => {
    setErr(null);
    try {
      const { data } = await supabase.rpc('txn_dates_email', { p_id: id });
      if (data?.error) throw new Error(data.error);
      setDatesEmail(data);
    } catch (e) { setErr('Could not build the email: ' + (e.message || e)); }
  };

  if (!st) return null;
  const ms = st.milestones || [];
  const curStageMs = ms.filter(m => m.stage === st.stage);
  const isDead = st.deal_status === 'dead';
  const isClosed = st.stage === 'closed';

  // one milestone row, reused by Work + Journey
  const MilestoneRow = (m, interactive) => {
    const done = m.status === 'done' || m.status === 'waived';
    const locked = m.broker_only && !st.viewer_is_broker;
    const canTap = interactive && st.can_edit && !locked && !isDead;
    const isFunds = m.key === 'funds_received';
    return (
      <div key={m.key} style={{ padding: '9px 0', borderBottom: '1px solid #1e1810', opacity: locked ? .6 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button disabled={busy || !canTap || (isFunds && !done)} onClick={() => { if (!canTap) return; if (isFunds && !done) { setFundsFor(fundsFor === m.key ? null : m.key); return; } call('set_txn_milestone', { p_id: id, p_key: m.key, p_status: done ? 'pending' : 'done' }); }}
            style={{ width: 22, height: 22, borderRadius: 6, flex: 'none', cursor: canTap ? 'pointer' : 'default',
              border: '1.5px solid ' + (done ? '#22c55e' : '#3a3020'),
              background: done ? '#22c55e' : 'transparent', color: '#100D09', fontWeight: 900, fontSize: 13, lineHeight: 1 }}>{done ? '✓' : ''}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: done ? 'var(--text-3)' : 'var(--text-1)', textDecoration: m.status === 'waived' ? 'line-through' : 'none' }}>{m.label}</div>
            {locked && !done && <div style={{ fontSize: 11, color: GOLD, marginTop: 1 }}>The brokerage handles this step</div>}
            {m.method && done && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{(FUND_METHODS.find(f => f[0] === m.method) || [null, m.method])[1]}{m.amount ? ' · ' + money(m.amount) : ''}</div>}
            {m.document_id && done && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 1 }}>Document on file ✓</div>}
            {m.key === 'executed_contract' && m.document_id && st.can_edit && (
              <button disabled={extracting || busy} onClick={() => runExtract(m.document_id)}
                style={{ marginTop: 5, fontSize: 11.5, color: GOLD, background: 'transparent', border: '1px solid ' + GOLD, borderRadius: 7, padding: '4px 10px', fontWeight: 600, cursor: 'pointer' }}>
                {extracting ? 'Reading contract…' : '✨ Extract details from contract'}
              </button>
            )}
            {!locked && m.help && !done && !isFunds && interactive && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{m.help}</div>}
          </div>
          {canTap && !done && m.wants_document && (<>
            <input ref={el => (fileRefs.current[m.key] = el)} type="file" style={{ display: 'none' }} onChange={e => uploadFor(m.key, e.target.files)} />
            <button disabled={busy} onClick={() => fileRefs.current[m.key] && fileRefs.current[m.key].click()}
              style={{ fontSize: 11.5, color: '#100D09', background: CHAMP, border: 'none', borderRadius: 7, padding: '5px 11px', fontWeight: 700, cursor: 'pointer' }}>Upload</button>
          </>)}
          {canTap && !done && isFunds && (
            <button disabled={busy} onClick={() => setFundsFor(fundsFor === m.key ? null : m.key)}
              style={{ fontSize: 11.5, color: '#100D09', background: CHAMP, border: 'none', borderRadius: 7, padding: '5px 11px', fontWeight: 700, cursor: 'pointer' }}>Record</button>
          )}
          {canTap && !done && !m.wants_document && !isFunds && <button disabled={busy} onClick={() => call('set_txn_milestone', { p_id: id, p_key: m.key, p_status: 'waived' })}
            style={{ fontSize: 11, color: 'var(--text-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}>N/A</button>}
        </div>
        {isFunds && fundsFor === m.key && !done && interactive && (
          <FundsForm methods={FUND_METHODS} busy={busy} onCancel={() => setFundsFor(null)}
            onSave={(method, amount, note) => { setFundsFor(null); call('set_txn_milestone', { p_id: id, p_key: 'funds_received', p_status: 'done', p_method: method, p_amount: amount, p_note: note }); }} />
        )}
      </div>
    );
  };

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '2px solid ' + (tab === k ? GOLD : 'transparent'), color: tab === k ? 'var(--text-1)' : 'var(--text-3)', fontSize: 12.5, fontWeight: tab === k ? 700 : 500, padding: '9px 0', cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', borderBottom: 'none', padding: '18px 18px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.18em', fontSize: 10.5, color: isDead ? '#ef4444' : GOLD }}>#{st.trans_id} · {isDead ? 'Dead' : (STAGE_LABEL[st.stage] || st.stage)}</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 23, color: 'var(--text-1)', lineHeight: 1.15 }}>{st.address || 'Untitled deal'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #2a2016', color: 'var(--text-2)', borderRadius: 8, width: 34, height: 34, flex: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* next action banner */}
        <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 12, background: isDead ? 'rgba(239,68,68,.08)' : 'linear-gradient(155deg,rgba(197,169,94,.14),rgba(197,169,94,.03))', border: '1px solid ' + (isDead ? 'rgba(239,68,68,.4)' : 'rgba(197,169,94,.4)') }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 3 }}>{isDead ? 'Status' : 'Next action'}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: isDead ? '#fca5a5' : CHAMP }}>{st.next_action}</div>
        </div>

        {st.stage === 'closing' && !st.viewer_is_broker && !isDead && (
          <div style={{ margin: '-6px 0 12px', fontSize: 12, color: 'var(--text-3)' }}>Submitted for disbursement. The brokerage takes it from here — you'll be notified when your commission is sent.</div>
        )}

        {err && <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#fecaca', marginBottom: 12 }}>{err}</div>}

        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1810', marginBottom: 14 }}>
          {tabBtn('work', 'Work')}
          {tabBtn('journey', 'Journey')}
          {tabBtn('history', 'History')}
        </div>

        {/* ── WORK: current-stage actions ── */}
        {tab === 'work' && (<>
          {st.deal_status === 'active' && st.can_edit && (
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
          {curStageMs.length > 0 && !isDead && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 8 }}>This stage</div>
              {curStageMs.map(m => MilestoneRow(m, true))}
            </div>
          )}
          {st.deal_status === 'active' && st.can_edit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {NEXT[st.stage] && (NEXT[st.stage] !== 'closed' || st.viewer_is_broker) && (
                <button disabled={busy} onClick={() => call('advance_txn_stage', { p_id: id, p_to_stage: NEXT[st.stage] })}
                  style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                  {NEXT[st.stage] === 'closing' ? 'Submit for disbursement →' : 'Move to ' + STAGE_LABEL[NEXT[st.stage]] + ' →'}
                </button>
              )}
              {!deadOpen && <button disabled={busy} onClick={() => setDeadOpen(true)}
                style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>Mark dead</button>}
            </div>
          )}
          {deadOpen && <DeadPicker busy={busy} onCancel={() => setDeadOpen(false)} onPick={(reason) => { setDeadOpen(false); call('set_txn_dead', { p_id: id, p_reason: reason }); }} />}
          {st.deal_status === 'active' && !st.can_edit && (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic' }}>You have view access to this deal.</div>
          )}

          {/* editable deal facts */}
          <TxnFacts st={st} editing={editing} setEditing={setEditing} busy={busy} onSave={(patch) => { setEditing(false); call('update_txn_facts', { p_id: id, ...patch }); }} />

          {/* key dates from the contract */}
          {Array.isArray(st.key_dates) && st.key_dates.length > 0 && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e1810' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' }}>Key dates</span>
                {st.can_edit && <button onClick={openDatesEmail} style={{ background: CHAMP, color: '#100D09', border: 'none', fontSize: 11.5, borderRadius: 7, padding: '5px 11px', fontWeight: 700, cursor: 'pointer' }}>Email the dates</button>}
              </div>
              {st.key_dates.map((d, i) => {
                const dt = new Date(d.date + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0);
                const days = Math.round((dt - today) / 86400000);
                const soon = days >= 0 && days <= 3, past = days < 0;
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #1e1810' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{d.label}</span>
                    <span style={{ fontSize: 13, color: past ? 'var(--text-3)' : soon ? '#EBCB82' : 'var(--text-1)', fontWeight: soon ? 700 : 500 }}>
                      {dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{!past && days <= 14 ? ` · ${days}d` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* the transaction file */}
          <div style={{ marginTop: 18, paddingTop: 4 }}>
            <button onClick={() => setShowFile(v => !v)} style={{ background: 'transparent', border: 'none', color: GOLD, fontSize: 11.5, fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
              {showFile ? '− Hide file' : '+ Transaction file'}
            </button>
            {showFile && <div style={{ marginTop: 8 }}><LinkedDocuments userId={userId} targetType="transaction" targetId={id} title="Documents" /></div>}
          </div>
        </>)}

        {/* ── JOURNEY: every milestone by stage ── */}
        {tab === 'journey' && <JourneyView st={st} STAGES={STAGES} STAGE_LABEL={STAGE_LABEL} row={MilestoneRow} />}

        {/* ── HISTORY: the audit timeline ── */}
        {tab === 'history' && <HistoryView events={events} STAGE_LABEL={STAGE_LABEL} />}

        {extract && <ExtractReview extract={extract} busy={busy} onCancel={() => setExtract(null)} onApply={applyExtract} />}
        {datesEmail && <DatesEmail data={datesEmail} onClose={() => setDatesEmail(null)} />}
      </div>
    </div>
  );
}

// ── Editable deal facts ──────────────────────────────────────────────────────
function TxnFacts({ st, editing, setEditing, busy, onSave }) {
  const [f, setF] = useState({});
  const [agents, setAgents] = useState([]);
  useEffect(() => { if (editing) {
    setF({ gross_sale: st.gross_sale || '', gross_commission: st.gross_commission || '', buyer: st.buyer_name || '', seller: st.seller_name || '', co_agent: st.co_agent || '', expected_close: st.expected_close_date || '', address: st.address || '', agent_id: st.agent_id || '' });
    if (st.viewer_is_broker) supabase.rpc('txn_agent_options').then(({ data }) => setAgents(Array.isArray(data) ? data : []));
  } }, [editing, st]);
  const num = (v) => v === '' || v == null ? null : Number(String(v).replace(/[^0-9.]/g, ''));
  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base,#0f0b07)', border: '1px solid #2a2016', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 13, marginTop: 4 };
  const lab = { fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' };

  if (!editing) {
    const facts = [
      ['Agent', st.agent_name], ['Gross sale', st.gross_sale ? money(st.gross_sale) : '—'],
      ['Commission', st.gross_commission ? money(st.gross_commission) : '—'],
      ['Expected close', st.expected_close_date || '—'],
      ['Buyer', st.buyer_name || '—'], ['Seller', st.seller_name || '—'],
    ];
    return (
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e1810' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' }}>Deal details</span>
          {st.can_edit && st.deal_status !== 'closed' && <button onClick={() => setEditing(true)} style={{ background: 'transparent', border: '1px solid #2a2016', color: GOLD, fontSize: 11.5, borderRadius: 7, padding: '4px 11px', cursor: 'pointer' }}>Edit</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {facts.map(([k, v]) => <div key={k}><div style={lab}>{k}</div><div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600 }}>{v ?? '—'}</div></div>)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e1810' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 4 }}>Edit deal details</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
        <div><div style={lab}>Gross sale ($)</div><input value={f.gross_sale} onChange={e => setF({ ...f, gross_sale: e.target.value })} inputMode="decimal" style={inp} /></div>
        <div><div style={lab}>Commission ($)</div><input value={f.gross_commission} onChange={e => setF({ ...f, gross_commission: e.target.value })} inputMode="decimal" style={inp} /></div>
        <div><div style={lab}>Buyer</div><input value={f.buyer} onChange={e => setF({ ...f, buyer: e.target.value })} style={inp} /></div>
        <div><div style={lab}>Seller</div><input value={f.seller} onChange={e => setF({ ...f, seller: e.target.value })} style={inp} /></div>
        <div><div style={lab}>Co-agent</div><input value={f.co_agent} onChange={e => setF({ ...f, co_agent: e.target.value })} style={inp} /></div>
        <div><div style={lab}>Expected close</div><input value={f.expected_close} onChange={e => setF({ ...f, expected_close: e.target.value })} type="date" style={inp} /></div>
      </div>
      <div style={{ marginTop: 6 }}><div style={lab}>Address</div><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} style={inp} /></div>
      {st.viewer_is_broker && agents.length > 0 && (
        <div style={{ marginTop: 6 }}><div style={lab}>Agent</div>
          <select value={f.agent_id || ''} onChange={e => setF({ ...f, agent_id: e.target.value })} style={inp}>
            <option value="">— unassigned —</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button disabled={busy} onClick={() => onSave({ p_gross_sale: num(f.gross_sale), p_gross_commission: num(f.gross_commission), p_buyer: f.buyer || null, p_seller: f.seller || null, p_co_agent: f.co_agent || null, p_expected_close: f.expected_close || null, p_address: f.address || null, p_agent_id: (st.viewer_is_broker && f.agent_id) ? f.agent_id : null })}
          style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Save details</button>
        <button onClick={() => setEditing(false)} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Journey: every milestone across every stage ──────────────────────────────
function JourneyView({ st, STAGES, STAGE_LABEL, row }) {
  const ms = st.milestones || [];
  const order = STAGES.map(s => s.key);
  const curIdx = order.indexOf(st.stage);
  const stagesWithMs = STAGES.filter(s => ms.some(m => m.stage === s.key));
  return (
    <div>
      {stagesWithMs.map(s => {
        const idx = order.indexOf(s.key);
        const stMs = ms.filter(m => m.stage === s.key);
        const allDone = stMs.every(m => m.status === 'done' || m.status === 'waived');
        const isCur = s.key === st.stage;
        const state = st.deal_status === 'closed' || allDone ? 'done' : isCur ? 'current' : idx < curIdx ? 'done' : 'upcoming';
        return (
          <div key={s.key} style={{ marginBottom: 14, opacity: state === 'upcoming' ? .55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: state === 'done' ? '#22c55e' : state === 'current' ? GOLD : '#3a3020' }} />
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.12em', fontSize: 12, fontWeight: 700, color: state === 'current' ? GOLD : 'var(--text-2)' }}>{STAGE_LABEL[s.key]}</span>
              {isCur && <span style={{ fontSize: 10, color: GOLD }}>· you are here</span>}
            </div>
            <div style={{ paddingLeft: 15 }}>{stMs.map(m => row(m, isCur && st.deal_status === 'active'))}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── History: the audit timeline ──────────────────────────────────────────────
function HistoryView({ events, STAGE_LABEL }) {
  if (!events || events.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>No history yet.</div>;
  const when = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const line = (e) => {
    if (e.kind === 'created') return 'Deal created';
    if (e.kind === 'stage_change') return 'Moved to ' + (STAGE_LABEL[e.to_stage] || (e.to_stage || '').replace(/_/g, ' '));
    if (e.kind === 'milestone') return (e.milestone_key || '').replace(/_/g, ' ') + (e.note && e.note !== 'done' ? ' — ' + e.note : '');
    return e.note || e.kind;
  };
  return (
    <div style={{ position: 'relative', paddingLeft: 4 }}>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 11, paddingBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.kind === 'stage_change' ? GOLD : e.kind === 'created' ? '#22c55e' : '#5a4d33', marginTop: 3 }} />
            {i < events.length - 1 && <span style={{ width: 1, flex: 1, background: '#2a2016', marginTop: 3 }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-1)', textTransform: 'capitalize' }}>{line(e)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{when(e.created_at)}{e.actor_name ? ' · ' + e.actor_name : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mark-dead reason picker ──────────────────────────────────────────────────
function DeadPicker({ busy, onPick, onCancel }) {
  const [other, setOther] = useState('');
  const [showOther, setShowOther] = useState(false);
  const reasons = ['Buyer walked', 'Financing fell through', 'Inspection issues', 'Appraisal came in low', 'Contract expired'];
  return (
    <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--bg-card,#1B1610)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Why is this deal dead?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {reasons.map(r => (
          <button key={r} disabled={busy} onClick={() => onPick(r)} style={{ fontSize: 12, background: 'transparent', border: '1px solid #2a2016', color: 'var(--text-2)', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}>{r}</button>
        ))}
        <button disabled={busy} onClick={() => setShowOther(v => !v)} style={{ fontSize: 12, background: 'transparent', border: '1px solid #2a2016', color: 'var(--text-2)', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}>Other…</button>
      </div>
      {showOther && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input autoFocus value={other} onChange={e => setOther(e.target.value)} placeholder="Reason" style={{ flex: 1, background: 'var(--bg-base,#0f0b07)', border: '1px solid #2a2016', borderRadius: 8, color: 'var(--text-1)', padding: '8px 11px', fontSize: 13 }} />
          <button disabled={busy || !other.trim()} onClick={() => onPick(other.trim())} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Mark dead</button>
        </div>
      )}
      <button onClick={onCancel} style={{ marginTop: 10, background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', padding: 0 }}>Cancel</button>
    </div>
  );
}

// ── Contract extraction review (propose, then apply) ────────────────────────
function ExtractReview({ extract, busy, onApply, onCancel }) {
  const ex = extract.extracted || {};
  const kd = extract.key_dates || [];
  const parties = extract.parties || [];
  const conf = ex.confidence || 'medium';
  const money = (n) => n ? '$' + Number(n).toLocaleString() : '—';
  const facts = [
    ['Buyer', (ex.buyers || []).join(' & ') || '—'], ['Seller', (ex.sellers || []).join(' & ') || '—'],
    ['Price', money(ex.purchase_price)], ['Earnest money', money(ex.earnest_money)],
    ['Financing', ex.financing_type || '—'], ['Loan', ex.loan_type || '—'],
  ];
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 250, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', padding: '18px 18px 34px' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.18em', fontSize: 10.5, color: GOLD }}>From the contract</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 21, color: 'var(--text-1)', marginBottom: 2 }}>Here's what I found.</div>
        <div style={{ fontSize: 12, color: conf === 'low' ? '#EBCB82' : 'var(--text-3)', marginBottom: 14 }}>
          {conf === 'low' ? 'Low confidence — please double-check each field before applying.' : 'Review, then apply. Nothing is saved until you confirm.'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 14 }}>
          {facts.map(([k, v]) => <div key={k}><div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div><div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, textTransform: k === 'Financing' || k === 'Loan' ? 'capitalize' : 'none' }}>{v}</div></div>)}
        </div>
        {kd.length > 0 && (<>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 6 }}>Critical dates</div>
          <div style={{ marginBottom: 14 }}>{kd.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e1810' }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{d.label}</span>
              <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          ))}</div>
        </>)}
        {parties.length > 0 && (<>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 6 }}>Parties</div>
          <div style={{ marginBottom: 16 }}>{parties.map((p, i) => (
            <div key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', padding: '3px 0' }}>
              <span style={{ textTransform: 'capitalize', color: 'var(--text-3)' }}>{(p.role || '').replace(/_/g, ' ')}:</span> {p.name || p.email}{p.email && p.name ? ` · ${p.email}` : ''}
            </div>
          ))}</div>
        </>)}
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={onApply} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Apply to deal</button>
          <button onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 10, padding: '11px 16px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Dates email — preview + open in mail ─────────────────────────────────────
function DatesEmail({ data, onClose }) {
  const to = (data.to || []).join(', ');
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(data.subject || '')}&body=${encodeURIComponent(data.body || '')}`;
  const copy = () => { try { navigator.clipboard.writeText((data.to?.length ? 'To: ' + to + '\n\n' : '') + 'Subject: ' + data.subject + '\n\n' + data.body); } catch (_) {} };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 250, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', padding: '18px 18px 34px' }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 21, color: 'var(--text-1)', marginBottom: 2 }}>Key dates email.</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>Ready to send to everyone on the deal. Review and open in your mail app.</div>
        {data.to?.length ? <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}><span style={{ color: 'var(--text-3)' }}>To:</span> {to}</div>
          : <div style={{ fontSize: 12.5, color: '#EBCB82', marginBottom: 8 }}>No party emails on file yet — add them in the deal, or copy the text below.</div>}
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}><span style={{ color: 'var(--text-3)' }}>Subject:</span> {data.subject}</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-1)', background: 'var(--bg-card,#1B1610)', border: '1px solid #2a2016', borderRadius: 10, padding: '12px 14px', marginBottom: 14, lineHeight: 1.5 }}>{data.body}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={mailto} style={{ background: CHAMP, color: '#100D09', textDecoration: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 800, fontSize: 14 }}>Open in mail</a>
          <button onClick={copy} style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid #2a2016', borderRadius: 10, padding: '11px 16px', fontSize: 14, cursor: 'pointer' }}>Copy</button>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-3)', border: 'none', borderRadius: 10, padding: '11px 12px', fontSize: 14, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Funds-received form ──────────────────────────────────────────────────────
function FundsForm({ methods, busy, onSave, onCancel }) {
  const [method, setMethod] = useState('wire');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base,#0f0b07)', border: '1px solid #2a2016', borderRadius: 8, color: 'var(--text-1)', padding: '9px 11px', fontSize: 13, marginTop: 6 };
  return (
    <div style={{ margin: '10px 0 4px 32px', padding: '12px 14px', background: 'var(--bg-card,#1B1610)', border: '1px solid #2a2016', borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>How did the money arrive?</div>
      <select value={method} onChange={e => setMethod(e.target.value)} style={inp}>
        {methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount received ($)" style={inp} />
      {method === 'other' && <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note" style={inp} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button disabled={busy} onClick={() => onSave(method, amount ? Number(String(amount).replace(/[^0-9.]/g, '')) : null, note || null)}
          style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 8, padding: '8px 15px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Record funds</button>
        <button onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid #2a2016', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
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
