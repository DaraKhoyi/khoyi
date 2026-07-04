import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon, QuoCallDetail, CallFollowupsPanel, modal, quoCall, quoFmtDur, quoFmtPhone, quoFmtWhen, quoLast10, quoNormPhone } from '../App';

// At-a-glance health of the Quo (OpenPhone) integration: live API connection,
// active number, webhooks, texting, and calls — with a clear fix path when call
// recording isn't on yet (which is what unlocks transcripts + AI follow-ups).
function QuoStatusPanel({ msgs = [], calls = [], activeNumber }) {
  const [api, setApi] = useState({ loading: true });
  const [hooks, setHooks] = useState(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.functions.invoke('quo-status', { body: {} })
      .then(({ data }) => { if (alive) setApi({ loading: false, ...(data || { ok: false, error: 'No response' }) }); })
      .catch(e => { if (alive) setApi({ loading: false, ok: false, error: String(e.message || e) }); });
    supabase.from('quo_settings').select('webhooks_registered').maybeSingle()
      .then(({ data }) => { if (alive) setHooks(!!data?.webhooks_registered); });
    return () => { alive = false; };
  }, []);

  const GREEN = '#22c55e', AMBER = '#f59e0b', RED = '#ef4444', MUTE = 'var(--text-3)';
  const texts = msgs.length;
  const lastText = msgs.reduce((mx, m) => { const t = m.op_created_at || m.created_at; return (t && (!mx || new Date(t) > new Date(mx))) ? t : mx; }, null);
  const callsN = calls.length;
  const recN = calls.filter(c => c.recording_url).length;
  const trN = calls.filter(c => c.transcript).length;
  const recordingOn = recN > 0;
  const connColor = api.loading ? MUTE : (api.ok ? GREEN : RED);
  const overall = api.loading ? MUTE : (!api.ok ? RED : (!recordingOn ? AMBER : GREEN));

  const Dot = ({ c }) => <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0, marginTop: 5, boxShadow: c === MUTE ? 'none' : `0 0 7px ${c}80` }} />;
  const Row = ({ label, value, color, sub }) => (
    <div style={{ display: 'flex', gap: 11, padding: '9px 0', borderTop: '1px solid var(--border)' }}>
      <Dot c={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{label}</span>
          <span style={{ fontSize: 12, color, fontWeight: 700, whiteSpace: 'nowrap' }}>{value}</span>
        </div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );

  return (
    <div className="panel" style={{ padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2 }}>
        <Dot c={overall} />
        <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-1)' }}>Quo integration</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{api.loading ? 'checking…' : (api.ok ? `live${api.latency_ms ? ` · ${api.latency_ms}ms` : ''}` : 'offline')}</span>
      </div>
      <Row label="Connection" color={connColor}
        value={api.loading ? '…' : (api.ok ? 'Connected' : 'Error')}
        sub={api.ok ? `OpenPhone reachable${api.number_count ? ` · ${api.number_count} number${api.number_count > 1 ? 's' : ''}` : ''}` : (api.loading ? 'Checking OpenPhone…' : (api.error || 'Could not reach OpenPhone'))} />
      <Row label="Active number" color={activeNumber ? GREEN : AMBER} value={activeNumber ? quoFmtPhone(activeNumber) : '—'} />
      <Row label="Webhooks" color={hooks ? GREEN : (hooks === null ? MUTE : AMBER)}
        value={hooks ? 'Live' : (hooks === null ? '…' : 'Not armed')}
        sub={hooks ? 'Texts & calls stream in automatically' : 'Tap ⟳ Sync to arm live updates'} />
      <Row label="Texting" color={texts ? GREEN : AMBER}
        value={texts ? 'Working' : 'No messages'}
        sub={texts ? `${texts} message${texts > 1 ? 's' : ''}${lastText ? ` · last ${quoFmtWhen(lastText)}` : ''}` : 'Send or receive a text to start'} />
      <Row label="Calls" color={recordingOn ? GREEN : AMBER}
        value={recordingOn ? 'Working' : (callsN ? 'Recording off' : 'No calls')}
        sub={callsN ? `${callsN} logged · ${recN} recorded · ${trN} transcribed` : 'No calls logged yet'} />
      {!recordingOn && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 700 }}>⚠ Turn on call recording to unlock transcripts &amp; AI follow-ups</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>Calls are logging, but OpenPhone isn’t sending recordings yet — so there’s nothing to transcribe into tasks.</div>
          <button type="button" onClick={() => setShowSteps(s => !s)} style={{ marginTop: 7, background: 'transparent', border: 'none', color: AMBER, fontSize: 12, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
            {showSteps ? 'Hide steps' : 'Show me how →'}
          </button>
          {showSteps && (
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <li>Confirm your OpenPhone <strong>Business plan</strong> (recording + AI live there).</li>
              <li>OpenPhone → Settings → Phone numbers → your number → <strong>Auto-record calls: ON</strong> (inbound + outbound).</li>
              <li>Turn on <strong>AI call summaries / transcripts</strong> if shown separately.</li>
              <li>Set a <strong>recording announcement</strong> — Florida is two-party consent.</li>
              <li>Place calls <strong>through the OpenPhone app</strong>, then make one test call.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newTo, setNewTo] = useState('');
  const [openCall, setOpenCall] = useState(null);
  const threadRef = useRef(null);
  // On phones the messages view shows ONE pane at a time (list, then thread),
  // instead of a 2-column split that pushes the thread off-screen.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const on = e => setNarrow(e.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);

  // Honor a tab/conversation intent set elsewhere (quick-create FAB, or the
  // dashboard "Reply to…" card deep-linking to a specific text thread).
  useEffect(() => {
    try {
      if (window.__quoTab) {
        const t = window.__quoTab;
        window.__quoTab = null;
        if (typeof t === 'string') { if (t === 'messages' || t === 'calls' || t === 'feed') setTab(t); }
        else if (t && typeof t === 'object') {
          if (t.tab === 'messages' || t.tab === 'calls' || t.tab === 'feed') setTab(t.tab);
          if (t.phone) { setTab('messages'); openConvo(t.phone, t.name); }
        }
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
  // Full contact object by phone (for DISC-adapted AI drafting in a thread)
  const phoneToContact = useMemo(() => {
    const m = {};
    for (const c of contacts) for (const p of [c.phone, c.mobile, c.business_phone, c.home_phone].filter(Boolean)) {
      const k = quoLast10(p); if (k.length === 10 && !m[k]) m[k] = c;
    }
    return m;
  }, [contacts]);

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
    setSending(true); setErr(''); setDraftNote('');
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
  function openConvo(p, name) { setSelected({ participant: quoNormPhone(p), name: name || nameFor(p) }); setDraftNote(''); }
  // Have the AI write a text adapted to this contact's DISC behavioral style,
  // shaped by the recent thread, and drop it into the composer for a quick
  // review before sending it out through Quo.
  async function aiDraft() {
    if (!selected || drafting) return;
    setDrafting(true); setErr(''); setDraftNote('');
    try {
      const contact = phoneToContact[quoLast10(selected.participant)] || null;
      const recent = thread.slice(-6).reverse().map(m => `${m.direction === 'incoming' ? 'Them' : 'You'}: ${m.body}`);
      const lastIn = [...thread].reverse().find(m => m.direction === 'incoming');
      const { data, error } = await supabase.functions.invoke('ai-followup-draft', {
        body: {
          contactName: contact?.name || selected.name || null,
          company: contact?.company || null,
          role: contact?.role || null,
          contact_id: contact?.id || null,
          channel: 'text',
          kind: 'text conversation',
          entryBody: lastIn?.body || recent[0] || '',
          recentNotes: recent,
          senderName: 'Dara',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCompose(data?.body || '');
      setDraftNote(data?.intel_used
        ? `\u2726 Adapted to ${contact?.name ? contact.name + '\u2019s' : 'their'} behavioral style \u2014 review, then Send`
        : '\u2726 Drafted \u2014 no DISC profile yet, so neutral tone. Review, then Send');
    } catch (e) {
      setErr('AI draft failed: ' + String(e.message || e));
    } finally { setDrafting(false); }
  }
  function startNew() { const e = quoNormPhone(newTo); if (e.length < 11) { setErr('Enter a valid US/Canada number.'); return; } setShowNew(false); setNewTo(''); setTab('messages'); openConvo(e, nameFor(e)); }
  // Place the call THROUGH Quo (not the device's cell line) via Quo's official deep link.
  // Opens the Quo app and auto-dials, using the active Quo number as caller ID.
  function quoDial(toRaw) {
    const to = quoNormPhone(toRaw);
    if (!to || to.length < 11) { setErr('Enter a valid US / Canada number to call.'); return; }
    const fromNum = numbers.find(n => n.id === fromId)?.number;
    window.location.href = `openphone://dial?number=${encodeURIComponent(to)}${fromNum ? `&from=${encodeURIComponent(fromNum)}` : ''}&action=call`;
  }
  function startCall() { const e = quoNormPhone(newTo); if (e.length < 11) { setErr('Enter a valid US / Canada number.'); return; } setShowNew(false); setNewTo(''); quoDial(e); }

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

      <QuoStatusPanel msgs={msgs} calls={calls} activeNumber={fromNumber?.number} />
      <CallFollowupsPanel userId={userId} contacts={contacts} />

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
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(220px,300px) 1fr', gap: 14, minHeight: 'min(68vh,560px)' }}>
          <div className="panel" style={{ padding: 0, overflow: 'hidden', display: (narrow && selected) ? 'none' : 'flex', flexDirection: 'column' }}>
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
          <div className="panel" style={{ padding: 0, overflow: 'hidden', display: (narrow && !selected) ? 'none' : 'flex', flexDirection: 'column' }}>
            {!selected ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>Pick a conversation, or ＋ New.</div>
              : <>
                <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px', minWidth:0 }}>{narrow && <button onClick={() => setSelected(null)} aria-label="Back to conversations" style={{ background:'none', border:'none', color:'var(--accent)', fontSize:'22px', lineHeight:1, cursor:'pointer', padding:'0 4px 0 0', flexShrink:0 }}>‹</button>}<div style={{ minWidth:0 }}><div style={{ fontWeight: 700, fontSize: 15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{selected.name}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{quoFmtPhone(selected.participant)}</div></div></div>
                  <button className="btn btn-primary btn-sm" onClick={() => quoDial(selected.participant)}><Icon name="quo" size={14} /> Call</button>
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
                <div style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={aiDraft} disabled={drafting}
                      title="Let AI write a message adapted to this contact's behavioral style"
                      style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: drafting ? 'default' : 'pointer', opacity: drafting ? 0.6 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {drafting ? 'Drafting…' : '✦ AI draft'}
                    </button>
                    {draftNote && <span style={{ fontSize: 11.5, color: 'var(--accent)', lineHeight: 1.3 }}>{draftNote}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea value={compose} onChange={e => { setCompose(e.target.value); if (draftNote) setDraftNote(''); }} rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Text ${selected.name}…`} style={{ flex: 1, resize: 'none', background: 'var(--bg-base)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', maxHeight: 120 }} />
                    <button className="btn btn-primary" disabled={sending || !compose.trim()} onClick={send} style={{ height: 40 }}>{sending ? '…' : 'Send'}</button>
                  </div>
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
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{nameFor(c.participant)}</div><div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{missed ? 'Missed' : `${out ? 'Outgoing' : 'Incoming'}`}{c.duration ? ` · ${quoFmtDur(c.duration)}` : ''}{c.summary ? ' · 📝 summary' : ''}{c.transcript ? ' · 📄 transcript' : ''}{c.recording_url ? ' · 🔊 recording' : ''}</div></div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{quoFmtWhen(c.op_created_at)}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{open ? '▲' : '▼'}</span>
                  </div>
                  {open && <div style={{ padding: '0 14px 14px 40px' }}>
                    {c.recording_url && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>▶ RECORDING</div>
                        <audio controls preload="none" src={c.recording_url} style={{ width: '100%', height: 36 }} />
                      </div>
                    )}
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
            <div className="modal-header"><h3>New message or call</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>✕</button></div>
            <div style={{ padding: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>To (US / Canada number)</label>
              <input autoFocus value={newTo} onChange={e => setNewTo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') startNew(); }} placeholder="727-555-1234" style={{ width: '100%', marginTop: 6, background: 'var(--bg-base)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button><button className="btn btn-ghost" onClick={startCall}><Icon name="quo" size={13} /> Call</button><button className="btn btn-primary" onClick={startNew}>Message</button></div>
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
