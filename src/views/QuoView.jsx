import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon, QuoCallDetail, modal, quoCall, quoFmtDur, quoFmtPhone, quoFmtWhen, quoLast10, quoNormPhone } from '../App';

function QuoView({ contacts = [], userId }) {
  const [tab, setTab] = useState('feed');               // feed | messages | calls
  const [numbers, setNumbers] = useState([]);
  const [fromId, setFromId] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loadingNums, setLoadingNums] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);       // {participant, name}
  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newTo, setNewTo] = useState('');
  const [openCall, setOpenCall] = useState(null);
  const threadRef = useRef(null);

  // Honor a tab intent set by the quick-create FAB (Text -> messages, Call -> calls)
  useEffect(() => {
    try {
      if (window.__quoTab) {
        const t = window.__quoTab;
        window.__quoTab = null;
        if (t === 'messages' || t === 'calls' || t === 'feed') setTab(t);
      }
    } catch (e) {}
  }, []);

  const fromNumber = numbers.find(n => n.id === fromId) || numbers[0] || null;
  const phoneToName = useMemo(() => {
    const m = {};
    for (const c of contacts) for (const p of [c.phone, c.mobile, c.business_phone, c.home_phone].filter(Boolean)) {
      const k = quoLast10(p); if (k.length === 10 && !m[k]) m[k] = c.name;
    }
    return m;
  }, [contacts]);
  const nameFor = (e) => phoneToName[quoLast10(e)] || quoFmtPhone(e);

  // load stored messages + calls
  const loadData = React.useCallback(async () => {
    const [m, c] = await Promise.all([
      supabase.from('quo_messages').select('*').order('op_created_at', { ascending: false }).limit(500),
      supabase.from('quo_calls').select('*').order('op_created_at', { ascending: false }).limit(300),
    ]);
    setMsgs(m.data || []);
    setCalls(c.data || []);
  }, []);

  // numbers + settings + first-run sync
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await quoCall('/v1/phone-numbers');
        if (!alive) return;
        const list = (res?.data || []).map(n => ({ id: n.id, number: n.number || n.phoneNumber, name: n.name }));
        setNumbers(list);
        const { data: st } = await supabase.from('quo_settings').select('*').eq('user_id', userId).maybeSingle();
        const chosen = (st?.active_phone_number_id && list.some(n => n.id === st.active_phone_number_id)) ? st.active_phone_number_id : (list[0]?.id || '');
        setFromId(chosen);
        if (!st?.active_phone_number_id && chosen) {
          const n = list.find(x => x.id === chosen);
          await supabase.from('quo_settings').upsert({ user_id: userId, active_phone_number_id: chosen, active_number: n?.number, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        }
        // first-run: register webhooks + backfill
        if (!st?.webhooks_registered) {
          setSyncing(true);
          supabase.functions.invoke('quo-sync', { body: {} }).then(() => { if (alive) { loadData(); setSyncing(false); } }).catch(() => { if (alive) setSyncing(false); });
        }
      } catch (e) { if (alive) setErr(String(e.message || e)); }
      finally { if (alive) setLoadingNums(false); }
    })();
    return () => { alive = false; };
  }, [userId, loadData]);

  // initial data + realtime
  useEffect(() => {
    loadData();
    const ch = supabase.channel('quo-main')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quo_messages' }, p => setMsgs(m => [p.new, ...m.filter(x => x.op_id !== p.new.op_id)]))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quo_calls' }, p => setCalls(c => [p.new, ...c.filter(x => x.id !== p.new.id)]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData]);

  async function changeNumber(id) {
    setFromId(id); setSelected(null);
    const n = numbers.find(x => x.id === id);
    await supabase.from('quo_settings').upsert({ user_id: userId, active_phone_number_id: id, active_number: n?.number, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }

  async function syncNow() {
    setSyncing(true); setErr('');
    try { const { data } = await supabase.functions.invoke('quo-sync', { body: {} }); if (data?.ok === false) setErr(data.error || 'Sync failed'); await loadData(); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setSyncing(false); }
  }

  // build conversation list from stored messages
  const convos = useMemo(() => {
    const map = {};
    for (const m of msgs) {
      const other = m.direction === 'incoming' ? m.from_number : m.to_number;
      const k = quoLast10(other);
      if (!k) continue;
      if (!map[k] || new Date(m.op_created_at) > new Date(map[k].at)) map[k] = { other, at: m.op_created_at, last: m.body, dir: m.direction };
    }
    return Object.values(map).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  }, [msgs]);

  const thread = useMemo(() => {
    if (!selected) return [];
    const k = quoLast10(selected.participant);
    return msgs.filter(m => quoLast10(m.direction === 'incoming' ? m.from_number : m.to_number) === k)
      .slice().sort((a, b) => new Date(a.op_created_at || 0) - new Date(b.op_created_at || 0));
  }, [msgs, selected]);
  useEffect(() => { if (thread.length && threadRef.current) setTimeout(() => { threadRef.current.scrollTop = threadRef.current.scrollHeight; }, 40); }, [thread.length, selected]);

  async function send() {
    const text = compose.trim();
    if (!text || !selected?.participant || !fromNumber?.number || sending) return;
    setSending(true); setErr('');
    const tmp = { id: 'tmp-' + Date.now(), op_id: 'tmp-' + Date.now(), direction: 'outgoing', from_number: fromNumber.number, to_number: selected.participant, body: text, op_created_at: new Date().toISOString(), status: 'queued' };
    setMsgs(m => [tmp, ...m]); setCompose('');
    try {
      await quoCall('/v1/messages', { method: 'POST', body: { content: text, from: fromNumber.number, to: [selected.participant] } });
      // the message.delivered webhook will persist + realtime-replace the optimistic row
    } catch (e) {
      setErr('Send failed: ' + String(e.message || e));
      setMsgs(m => m.map(x => x.id === tmp.id ? { ...x, status: 'failed' } : x));
    } finally { setSending(false); }
  }
  function openConvo(p, name) { setSelected({ participant: quoNormPhone(p), name: name || nameFor(p) }); }
  function startNew() { const e = quoNormPhone(newTo); if (e.length < 11) { setErr('Enter a valid US/Canada number.'); return; } setShowNew(false); setNewTo(''); setTab('messages'); openConvo(e, nameFor(e)); }

  const callList = useMemo(() => calls.slice().sort((a, b) => new Date(b.op_created_at || 0) - new Date(a.op_created_at || 0)), [calls]);
  const feed = useMemo(() => {
    const rows = [];
    for (const m of msgs) rows.push({ k: 'text', id: m.id, at: m.op_created_at || m.created_at, dir: m.direction, body: m.body, who: m.direction === 'incoming' ? m.from_number : m.to_number, status: m.status });
    for (const c of calls) rows.push({ k: 'call', id: c.id, at: c.op_created_at || c.created_at, dir: c.direction, who: c.participant, dur: c.duration, status: c.status, summary: c.summary, next_steps: c.next_steps, transcript: c.transcript, op_id: c.op_id });
    return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  }, [msgs, calls]);

  if (loadingNums) return <div className="loading-screen" style={{ height: '50vh' }}><div className="spinner" /></div>;

  const TABS = [{ id: 'feed', label: 'Live feed', icon: <Icon name="zap" size={13} /> }, { id: 'messages', label: 'Messages', icon: <Icon name="message" size={13} /> }, { id: 'calls', label: 'Calls', icon: <Icon name="quo" size={13} /> }];

  return (
    <div className="view">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}><Icon name="quo" size={26} style={{ color: 'var(--accent)', flexShrink: 0 }} />Quo</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Number</span>
          <select value={fromNumber?.id || ''} onChange={e => changeNumber(e.target.value)} style={{ background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontWeight: 600 }}>
            {numbers.map(n => <option key={n.id} value={n.id}>{n.name ? n.name + ' · ' : ''}{quoFmtPhone(n.number)}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={syncNow} disabled={syncing} title="Pull latest history from Quo">{syncing ? 'Syncing…' : '⟳ Sync'}</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>＋ New</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {TABS.map(t => <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
      </div>

      {err && <div className="panel" style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13, padding: '8px 12px', marginBottom: 10 }}>{err}</div>}
      {syncing && <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 10 }}>⟳ Pulling your Quo history &amp; arming live sync…</div>}

      {tab === 'feed' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {feed.length === 0
            ? <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>No activity yet. Tap “Sync” to backfill — after that, every incoming and outgoing text, plus every call with its recording &amp; transcript, streams in here live.</div>
            : <QuoFeedRows feed={feed} nameFor={nameFor} openCall={openCall} setOpenCall={setOpenCall} />}
        </div>
      )}

      {tab === 'messages' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,300px) 1fr', gap: 14, minHeight: 'min(68vh,560px)' }}>
          <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Conversations</div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {convos.length === 0 ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>No messages yet.</div>
                : convos.map(cv => {
                  const active = selected && quoLast10(selected.participant) === quoLast10(cv.other);
                  return (
                    <div key={cv.other} onClick={() => openConvo(cv.other, nameFor(cv.other))} style={{ padding: '11px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: active ? 'var(--accent-glow)' : 'transparent', borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ fontWeight: 600, fontSize: 13.5, color: active ? 'var(--accent)' : 'var(--text-1)' }}>{nameFor(cv.other)}</span><span style={{ fontSize: 11, color: 'var(--text-3)' }}>{quoFmtWhen(cv.at)}</span></div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cv.dir === 'incoming' ? '' : '↗ '}{cv.last}</div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!selected ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>Pick a conversation, or ＋ New.</div>
              : <>
                <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{quoFmtPhone(selected.participant)}</div></div>
                  <button className="btn btn-primary btn-sm" onClick={() => { window.location.href = 'tel:' + selected.participant; }}><Icon name="quo" size={14} /> Call</button>
                </div>
                <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {thread.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13, margin: 'auto' }}>No messages yet. Say hello 👋</div>
                    : thread.map(m => { const out = m.direction === 'outgoing'; return (
                      <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                        <div style={{ background: out ? 'var(--accent)' : 'var(--bg-base)', color: out ? '#000' : 'var(--text-1)', border: out ? 'none' : '1px solid var(--border)', borderRadius: 14, padding: '8px 12px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: out ? 600 : 400 }}>{m.body}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2, textAlign: out ? 'right' : 'left' }}>{quoFmtWhen(m.op_created_at)}{m.status === 'failed' ? ' · failed' : m.status === 'queued' ? ' · sending…' : ''}</div>
                      </div>
                    ); })}
                </div>
                <div style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <textarea value={compose} onChange={e => setCompose(e.target.value)} rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Text ${selected.name}…`} style={{ flex: 1, resize: 'none', background: 'var(--bg-base)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', maxHeight: 120 }} />
                  <button className="btn btn-primary" disabled={sending || !compose.trim()} onClick={send} style={{ height: 40 }}>{sending ? '…' : 'Send'}</button>
                </div>
              </>}
          </div>
        </div>
      )}

      {tab === 'calls' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {callList.length === 0 ? <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>No calls logged yet.</div>
            : callList.map(c => {
              const out = c.direction === 'outgoing', missed = ['missed', 'no-answer', 'declined'].includes(c.status), open = openCall === c.id;
              return (
                <div key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div onClick={() => setOpenCall(open ? null : c.id)} style={{ display: 'flex', gap: 10, padding: '11px 14px', cursor: 'pointer', alignItems: 'center' }}>
                    <span style={{ fontSize: 16 }}>{missed ? <Icon name="ban" size={15} /> : <Icon name="quo" size={15} />}</span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{nameFor(c.participant)}</div><div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{missed ? 'Missed' : `${out ? 'Outgoing' : 'Incoming'}`}{c.duration ? ` · ${quoFmtDur(c.duration)}` : ''}{c.summary ? ' · 📝 summary' : ''}{c.transcript ? ' · 📄 transcript' : ''}</div></div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{quoFmtWhen(c.op_created_at)}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{open ? '▲' : '▼'}</span>
                  </div>
                  {open && <div style={{ padding: '0 14px 14px 40px' }}>
                    {(c.summary || (c.transcript && c.transcript.length)) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {c.summary && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUMMARY</div>{Array.isArray(c.summary) ? <ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{c.summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : <div style={{ fontSize: 13 }}>{c.summary}</div>}</div>}
                        {Array.isArray(c.next_steps) && c.next_steps.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>NEXT STEPS</div><ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{c.next_steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || '')}</li>)}</ul></div>}
                        {Array.isArray(c.transcript) && c.transcript.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>TRANSCRIPT</div><div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12.5 }}>{c.transcript.map((d, i) => <div key={i}><b style={{ color: 'var(--text-2)' }}>{d.identifier || 'Speaker'}: </b>{d.content}</div>)}</div></div>}
                      </div>
                    ) : <QuoCallDetail callId={c.op_id} />}
                  </div>}
                </div>
              );
            })}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)} style={{ zIndex: 1200 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header"><h3>New message</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>✕</button></div>
            <div style={{ padding: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>To (US / Canada number)</label>
              <input autoFocus value={newTo} onChange={e => setNewTo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') startNew(); }} placeholder="727-555-1234" style={{ width: '100%', marginTop: 6, background: 'var(--bg-base)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button><button className="btn btn-primary" onClick={startNew}>Open</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Feed rows with expandable call detail (shared by the Live feed tab).

function QuoFeedRows({ feed, nameFor, openCall, setOpenCall }) {
  return (
    <div>
      {feed.map(it => {
        const out = it.dir === 'outgoing';
        if (it.k === 'call') {
          const missed = ['missed', 'no-answer', 'declined'].includes(it.status), open = openCall === it.id;
          return (
            <div key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div onClick={() => setOpenCall(open ? null : it.id)} style={{ display: 'flex', gap: 10, padding: '11px 14px', cursor: 'pointer', alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{missed ? <Icon name="ban" size={15} /> : <Icon name="quo" size={15} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{nameFor(it.who)}</div><div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{missed ? 'Missed call' : `Call · ${out ? 'outgoing' : 'incoming'}`}{it.dur ? ` · ${quoFmtDur(it.dur)}` : ''}{it.summary ? ' · 📝' : ''}</div></div>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{quoFmtWhen(it.at)}</span>
              </div>
              {open && <div style={{ padding: '0 14px 14px 40px' }}>
                {(it.summary || (it.transcript && it.transcript.length)) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {it.summary && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUMMARY</div>{Array.isArray(it.summary) ? <ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{it.summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : <div style={{ fontSize: 13 }}>{it.summary}</div>}</div>}
                    {Array.isArray(it.next_steps) && it.next_steps.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>NEXT STEPS</div><ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{it.next_steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || '')}</li>)}</ul></div>}
                    {Array.isArray(it.transcript) && it.transcript.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>TRANSCRIPT</div><div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12.5 }}>{it.transcript.map((d, i) => <div key={i}><b style={{ color: 'var(--text-2)' }}>{d.identifier || 'Speaker'}: </b>{d.content}</div>)}</div></div>}
                  </div>
                ) : <QuoCallDetail callId={it.op_id} />}
              </div>}
            </div>
          );
        }
        return (
          <div key={it.id} style={{ display: 'flex', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontSize: 16 }}>{out ? <Icon name="forward" size={15} /> : <Icon name="message" size={15} />}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{nameFor(it.who)} <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 400 }}>{out ? 'sent' : 'received'}</span></div><div style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.body}</div></div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{quoFmtWhen(it.at)}{it.status === 'failed' ? ' · failed' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}


export default QuoView;
