import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon, QuoCallDetail, SYSTEMS, quoFmtDur, quoFmtPhone, quoFmtWhen, quoLast10 } from '../App';

const SYS_STATUS = {
  healthy:      { label: 'Online',    pill: 'pill-green',  dot: 'var(--green)'  },
  degraded:     { label: 'Degraded',  pill: 'pill-yellow', dot: 'var(--yellow)' },
  down:         { label: 'Offline',   pill: 'pill-red',    dot: 'var(--red)'    },
  unconfigured: { label: 'Not wired', pill: 'pill',        dot: 'var(--text-3)' },
  unknown:      { label: 'Unknown',   pill: 'pill',        dot: 'var(--text-3)' },
};

function QuoLiveFeed({ userId, contacts = [], max = 40, compact = false }) {
  const [items, setItems] = useState(null);
  const [openId, setOpenId] = useState(null);
  const phoneToName = useMemo(() => {
    const m = {};
    for (const c of contacts) for (const p of [c.phone, c.mobile, c.business_phone, c.home_phone].filter(Boolean)) {
      const k = quoLast10(p); if (k.length === 10 && !m[k]) m[k] = c.name;
    }
    return m;
  }, [contacts]);
  const nameFor = (e) => phoneToName[quoLast10(e)] || quoFmtPhone(e);

  const load = React.useCallback(async () => {
    const [m, c] = await Promise.all([
      supabase.from('quo_messages').select('*').order('op_created_at', { ascending: false }).limit(max),
      supabase.from('quo_calls').select('*').order('op_created_at', { ascending: false }).limit(max),
    ]);
    const rows = [];
    for (const x of (m.data || [])) rows.push({ k: 'text', id: x.id, at: x.op_created_at || x.created_at, dir: x.direction, body: x.body, who: x.direction === 'incoming' ? x.from_number : x.to_number });
    for (const x of (c.data || [])) rows.push({ k: 'call', id: x.id, at: x.op_created_at || x.created_at, dir: x.direction, who: x.participant, dur: x.duration, status: x.status, summary: x.summary, next_steps: x.next_steps, transcript: x.transcript, op_id: x.op_id });
    rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    setItems(rows.slice(0, max));
  }, [max]);

  useEffect(() => {
    load();
    const ch = supabase.channel('quo-feed-' + (compact ? 'sys' : 'main'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quo_messages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quo_calls' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, compact]);

  if (items === null) return <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>Loading feed…</div>;
  if (!items.length) return <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>No Quo activity logged yet. Hit “Sync now” in the Quo tab to backfill, then incoming texts and calls stream in live.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(it => {
        const out = it.dir === 'outgoing';
        if (it.k === 'call') {
          const missed = ['missed', 'no-answer', 'declined'].includes(it.status);
          const open = openId === it.id;
          return (
            <div key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div onClick={() => setOpenId(open ? null : it.id)} style={{ display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer', alignItems: 'center' }}>
                <span style={{ fontSize: 15 }}>{missed ? <Icon name="ban" size={15} /> : <Icon name="quo" size={15} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{nameFor(it.who)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{missed ? 'Missed call' : `Call · ${out ? 'outgoing' : 'incoming'}`}{it.dur ? ` · ${quoFmtDur(it.dur)}` : ''}{it.summary ? ' · summary ready' : ''}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{quoFmtWhen(it.at)}</span>
              </div>
              {open && !compact && (
                <div style={{ padding: '0 12px 12px 40px' }}>
                  {(it.summary || (it.transcript && it.transcript.length)) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {it.summary && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUMMARY</div><div style={{ fontSize: 13, color: 'var(--text-1)' }}>{Array.isArray(it.summary) ? <ul style={{ margin: '2px 0 0 16px' }}>{it.summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : it.summary}</div></div>}
                      {Array.isArray(it.next_steps) && it.next_steps.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>NEXT STEPS</div><ul style={{ margin: '2px 0 0 16px', fontSize: 13, color: 'var(--text-1)' }}>{it.next_steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || '')}</li>)}</ul></div>}
                      {Array.isArray(it.transcript) && it.transcript.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>TRANSCRIPT</div><div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 12.5 }}>{it.transcript.map((d, i) => <div key={i}><b style={{ color: 'var(--text-2)' }}>{d.identifier || 'Speaker'}: </b>{d.content}</div>)}</div></div>}
                    </div>
                  ) : <QuoCallDetail callId={it.op_id} />}
                </div>
              )}
            </div>
          );
        }
        return (
          <div key={it.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontSize: 15 }}>{out ? <Icon name="forward" size={15} /> : <Icon name="message" size={15} />}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{nameFor(it.who)} <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 400 }}>{out ? 'sent' : 'received'}</span></div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.body}</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{quoFmtWhen(it.at)}</span>
          </div>
        );
      })}
    </div>
  );
}


function SystemsView({ contacts = [], userId }) {
  const [results, setResults] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [, setTick] = useState(0); // re-render so "checked Xs ago" labels stay fresh
  const [selected, setSelected] = useState(SYSTEMS[0].id);

  async function runCheck(sys) {
    setResults(r => ({ ...r, [sys.id]: { ...(r[sys.id] || {}), running: true } }));
    if (!sys.check) {
      setResults(r => ({ ...r, [sys.id]: { status: 'unconfigured', detail: 'Health check not wired yet — add a check() in SYSTEMS', checkedAt: Date.now(), running: false } }));
      return;
    }
    try {
      const res = await Promise.race([
        sys.check(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Check timed out')), 12000)),
      ]);
      setResults(r => ({ ...r, [sys.id]: { ...res, checkedAt: Date.now(), running: false } }));
    } catch (e) {
      const timedOut = e?.message === 'Check timed out';
      setResults(r => ({ ...r, [sys.id]: { status: timedOut ? 'degraded' : 'down', detail: e?.message || 'Check threw an error', checkedAt: Date.now(), running: false } }));
    }
  }

  async function runAll() {
    setCheckingAll(true);
    await Promise.all(SYSTEMS.map(runCheck));
    setCheckingAll(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runAll(); }, []);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 15000); return () => clearInterval(t); }, []);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = (e) => setIsNarrow(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, []);

  function ago(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  }

  const sysForDesktop = SYSTEMS.find(s => s.id === selected) || SYSTEMS[0];
  const GOLD = '#C5A95E';

  const tally = SYSTEMS.reduce((a, s) => { const k = results[s.id]?.status || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {});
  const online = tally.healthy || 0, offline = tally.down || 0, degraded = tally.degraded || 0;

  // One detail renderer, used in the desktop right column AND inline (mobile accordion).
  const renderDetail = (item, inline = false) => {
    const r = results[item.id] || {};
    const st = r.status || 'unknown';
    const meta = SYS_STATUS[st] || SYS_STATUS.unknown;
    const inner = (<>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span style={{ fontSize: '22px' }}>{item.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text-1)' }}>{item.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.category}</div>
          </div>
        </div>
        <span className={`pill ${meta.pill}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />
          {r.running ? 'Checking…' : meta.label}
        </span>
      </div>

      <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>{item.description}</div>

      {r.detail && (
        <div style={{ fontSize: '13px', fontWeight: 500, color: st === 'down' ? 'var(--red)' : st === 'degraded' ? 'var(--yellow)' : st === 'healthy' ? 'var(--green)' : 'var(--text-2)' }}>
          {r.detail}
        </div>
      )}

      {r.meta?.accounts?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Accounts</div>
          {r.meta.accounts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '12px', padding: '8px 10px', background: 'var(--bg-card)', borderRadius: '8px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: (SYS_STATUS[a.st] || SYS_STATUS.unknown).dot, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email}</span>
              </span>
              <span style={{ color: (SYS_STATUS[a.st] || SYS_STATUS.unknown).dot, flexShrink: 0, fontWeight: 500 }}>{a.issue}</span>
            </div>
          ))}
        </div>
      )}

      {item.id === 'quo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Live activity</div>
          <div className="panel" style={{ padding: 0, overflow: 'hidden', margin: 0, maxHeight: inline ? 'none' : 360, overflowY: inline ? 'visible' : 'auto' }}>
            <QuoLiveFeed userId={userId} contacts={contacts} max={15} compact />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '2px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{r.checkedAt ? `Checked ${ago(r.checkedAt)}` : 'Not checked yet'}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => runCheck(item)} disabled={r.running}>Re-check</button>
      </div>
    </>);
    if (inline) {
      return <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', background: 'rgba(197,169,94,0.05)', borderTop: `2px solid ${GOLD}` }}>{inner}</div>;
    }
    return <div className="card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>{inner}</div>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: isNarrow ? 'column' : 'row', gap: isNarrow ? '12px' : '18px', height: isNarrow ? 'auto' : 'calc(100dvh - 64px)' }}>

      {/* ── Systems list: left rail on desktop, full-width on mobile ── */}
      <div style={{ width: isNarrow ? '100%' : '212px', minWidth: isNarrow ? 0 : '212px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, display:'flex', alignItems:'center', gap:'10px' }}><Icon name="systems" size={26} style={{color:'var(--accent)',flexShrink:0}} />Systems</h2>
          <button className="btn-add-circle btn-add-circle-sm" onClick={runAll} disabled={checkingAll} title="Re-check all" aria-label="Re-check all">↻</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <span className="pill pill-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />{online} online
          </span>
          <span className="pill pill-red" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />{offline} offline
          </span>
          {degraded > 0 && (
            <span className="pill pill-yellow" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--yellow)' }} />{degraded} degraded
            </span>
          )}
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: isNarrow ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column' }}>
          {SYSTEMS.map((item, idx) => {
            const ir = results[item.id] || {};
            const im = SYS_STATUS[ir.status || 'unknown'] || SYS_STATUS.unknown;
            const active = item.id === selected;
            return (
              <React.Fragment key={item.id}>
                <div
                  onClick={() => setSelected(prev => (isNarrow && prev === item.id) ? null : item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '11px 12px', cursor: 'pointer',
                    borderBottom: idx < SYSTEMS.length - 1 ? '1px solid var(--border)' : 'none',
                    borderLeft: `3px solid ${active ? GOLD : 'transparent'}`,
                    background: active ? 'rgba(197,169,94,0.12)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.icon}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: active ? 700 : 600, color: active ? GOLD : 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: im.dot, flexShrink: 0, boxShadow: ir.running ? `0 0 0 3px ${im.dot}33` : 'none' }} />
                      <span style={{ fontSize: '11px', color: im.dot }}>{ir.running ? 'Checking…' : im.label}</span>
                    </div>
                  </div>
                  {isNarrow && <span style={{ marginLeft: '6px', color: 'var(--accent)', fontSize: '15px', lineHeight: 1, transform: active ? 'rotate(90deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>▸</span>}
                </div>
                {isNarrow && active && renderDetail(item, true)}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Detail: right column on desktop only (mobile shows it inline above) ── */}
      {!isNarrow && (
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {renderDetail(sysForDesktop, false)}
        </div>
      )}
    </div>
  );
}

export default SystemsView;
