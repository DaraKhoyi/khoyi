import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, quoFmtDur, quoFmtPhone, quoFmtWhen, quoLast10, quoNormPhone } from '../helpers';
import { CallFollowupsPanel } from './ReviewPanels';
import QuoCallDetail from './QuoCallDetail';
import QuoRecording from './QuoRecording';
import { quoCall } from '../quo';

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

function QuoTranscript({ call }) {
  const [showEng, setShowEng] = useState(true);
  const arr = Array.isArray(call.transcript) ? call.transcript : [];
  const hasEn = !!call.transcript_en;
  if (!arr.length && !hasEn) return null;
  const pill = (on) => ({ padding: '1px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, cursor: 'pointer', background: on ? 'var(--accent)' : 'transparent', color: on ? '#1a1409' : 'var(--text-2)', border: '1px solid var(--accent-dim)' });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>TRANSCRIPT</div>
        {hasEn && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
            <button onClick={() => setShowEng(true)} style={pill(showEng)}>English</button>
            <button onClick={() => setShowEng(false)} style={pill(!showEng)}>Original</button>
          </div>
        )}
      </div>
      {/* Say so when the language guess was shaky, instead of presenting a possibly
          wrong transcript as fact. A mostly-Farsi call once came back as "English"
          at 0.67 confidence and read as plausible nonsense with nothing flagged. */}
      {call?.raw?.cube?.language_uncertain && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 6, lineHeight: 1.5 }}>
          Language was unclear on this call{call?.raw?.cube?.language_code ? ` (best guess: ${String(call.raw.cube.language_code).toUpperCase()})` : ''} — if this reads wrong, set the language on that contact and it will transcribe correctly next time.
        </div>
      )}
      <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12.5 }}>
        {hasEn && showEng
          ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-1)' }}>{call.transcript_en}</div>
          : arr.map((d, i) => <div key={i}><b style={{ color: 'var(--text-2)' }}>{d.identifier || 'Speaker'}: </b>{d.content}</div>)}
      </div>
    </div>
  );
}

// Quick-text presets. Two panels use these: the dial pad ("QUICK TEXT") and the
// after-call panel ("NO ANSWER? QUICK FOLLOW-UP"), so they live at module scope.
// Referenced in both places but never defined — that crashed the panel outright.
//
// {name} is substituted with a LEADING SPACE plus first name, or an empty string
// when the number is not a known contact. So write "Hi{name}," and it reads
// "Hi John," with a match and "Hi," without one — never "Hi ,".
const TEXT_TEMPLATES = [
  { label: 'Just missed you', body: 'Hi{name}, just tried you — give me a ring when you get a minute.' },
  { label: 'Got a minute?',   body: 'Hi{name}, do you have a couple of minutes to talk today?' },
  { label: 'Following up',    body: 'Hi{name}, following up on our last conversation — where would you like to go from here?' },
  { label: 'On my way',       body: 'Hi{name}, on my way — see you shortly.' },
];

function QuoView({ contacts = [], userId, profiles = [], defaultSystem = 'eisenhower' }) {
  const [tab, setTab] = useState('dialer');             // dialer | feed | messages | calls
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
  // Dialer (the 10x phone driver): typed number, contact search, call/text channel,
  // and the post-call follow-up prompt.
  const [dialNum, setDialNum] = useState('');       // raw digits/text in the pad field
  const [dialSearch, setDialSearch] = useState(''); // contact search query
  const [callVia, setCallVia] = useState('quo');    // 'quo' | 'phone'
  const [afterCall, setAfterCall] = useState(null);  // {contact, phone} shown after a call is placed
  const [incomingCall, setIncomingCall] = useState(null); // live banner for a ringing inbound call
  const [showSetup, setShowSetup] = useState(false);      // number/sync/status — config, not daily use
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

  // DISC read by contact id (for the pre-call context + on-call coaching).
  const discByContact = useMemo(() => {
    const m = {};
    for (const p of profiles) if (p.contact_id && p.primary_letter && !m[p.contact_id]) m[p.contact_id] = p;
    return m;
  }, [profiles]);
  // One-line call coaching per DISC primary type — how to talk to them on a call.
  const DISC_CALL_COACH = {
    D: 'Direct type — be brief, lead with the bottom line, respect their time.',
    I: 'Expressive type — warm and personable, let them talk, keep energy up.',
    S: 'Steady type — unhurried and reassuring, no pressure, confirm next steps.',
    C: 'Analytical type — precise and factual, have details ready, avoid hype.',
  };
  // Last interaction per contact id (for "you last spoke…" on the context card).
  const [lastByContact, setLastByContact] = useState({});
  useEffect(() => {
    let go = true;
    (async () => {
      const { data } = await supabase.from('contact_interactions')
        .select('contact_id, channel, direction, brief, occurred_at')
        .order('occurred_at', { ascending: false }).limit(400);
      if (!go || !data) return;
      const m = {};
      for (const r of data) if (r.contact_id && !m[r.contact_id]) m[r.contact_id] = r;
      setLastByContact(m);
    })();
    return () => { go = false; };
  }, [userId]);

  // Recent people (from call history) + favorites (most-called), DISC-tagged.
  const recentPeople = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const c of [...calls].sort((a, b) => new Date(b.op_created_at || 0) - new Date(a.op_created_at || 0))) {
      const k = quoLast10(c.participant); if (!k || seen.has(k)) continue; seen.add(k);
      out.push({ phone: c.participant, contact: phoneToContact[k] || null, at: c.op_created_at, dir: c.direction });
      if (out.length >= 8) break;
    }
    return out;
  }, [calls, phoneToContact]);
  const favoritePeople = useMemo(() => {
    const cnt = {};
    for (const c of calls) { const k = quoLast10(c.participant); if (k) cnt[k] = (cnt[k] || 0) + 1; }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, n]) => { const c = calls.find(x => quoLast10(x.participant) === k); return { phone: c?.participant, contact: phoneToContact[k] || null, count: n }; })
      .filter(x => x.phone);
  }, [calls, phoneToContact]);

  // Pre-call context card: who they are, DISC + how to talk to them, last touch,
  // and quick call/text. Shown when the dialer has identified a contact.
  const renderPreCall = (contact, phone) => {
    if (!contact) return null;
    const disc = discByContact[contact.id];
    const last = lastByContact[contact.id];
    const coach = disc?.primary_letter ? DISC_CALL_COACH[disc.primary_letter.toUpperCase()] : null;
    const daysAgo = last?.occurred_at ? Math.floor((Date.now() - new Date(last.occurred_at)) / 86400000) : null;
    return (
      <div className="panel" style={{ padding: 14, marginBottom: 12, borderColor: 'rgba(203,163,92,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: coach || last ? 8 : 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, color: 'var(--text-1)', fontWeight: 700 }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{[contact.company, contact.role].filter(Boolean).join(' · ') || quoFmtPhone(phone)}</div>
          </div>
          {disc?.primary_letter && <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>{disc.primary_letter}{disc.secondary_letter ? '/' + disc.secondary_letter : ''}</span>}
        </div>
        {coach && <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45, marginBottom: last ? 6 : 0 }}>{coach}</div>}
        {last && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Last {last.channel || 'touch'}{last.direction ? ' (' + (last.direction === 'inbound' ? 'they reached out' : 'you reached out') + ')' : ''}{daysAgo != null ? ' · ' + (daysAgo === 0 ? 'today' : daysAgo + 'd ago') : ''}</div>}
      </div>
    );
  };

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
        // Only use a number the agent has EXPLICITLY saved. Do NOT auto-default
        // to list[0] — the Quo workspace is shared under one API key, so list[0]
        // is whoever's number comes back first (e.g. the broker's), and
        // auto-saving it silently assigns the wrong person's line to this agent.
        // Leave it unset until they pick one in the dropdown (changeNumber).
        const chosen = (st?.active_phone_number_id && list.some(n => n.id === st.active_phone_number_id)) ? st.active_phone_number_id : '';
        setFromId(chosen);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quo_calls' }, p => {
        setCalls(c => [p.new, ...c.filter(x => x.id !== p.new.id)]);
        // Live incoming-call identity: when a new inbound call arrives that's still
        // ringing/unanswered, surface who it is so you know before you pick up.
        const nc = p.new;
        if (nc && nc.direction === 'incoming' && !['completed', 'missed', 'no-answer', 'voicemail'].includes((nc.status || '').toLowerCase())) {
          const k = quoLast10(nc.participant);
          setIncomingCall({ phone: nc.participant, contact: phoneToContact[k] || null, at: Date.now() });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData]);

  // Auto-clear the incoming-call banner after 30s so it doesn't linger.
  useEffect(() => {
    if (!incomingCall) return;
    const t = setTimeout(() => setIncomingCall(null), 30000);
    return () => clearTimeout(t);
  }, [incomingCall]);

  async function changeNumber(id) {
    const n = numbers.find(x => x.id === id);
    // On a shared Quo/OpenPhone workspace every user's app sees ALL workspace
    // lines. Prevent an agent from selecting a line that another user has already
    // claimed as their active number — otherwise their calls/recordings would be
    // attributed to that line's real owner. One line = one owner.
    try {
      const { data: taken } = await supabase.from('quo_settings')
        .select('user_id').eq('active_phone_number_id', id).neq('user_id', userId).maybeSingle();
      if (taken) {
        setErr('That number is already assigned to another user in your workspace. Pick a line that is yours, or ask your admin to assign you one.');
        return;
      }
    } catch (_) { /* if the check fails, fall through — the webhook still attributes by line */ }
    setFromId(id); setSelected(null);
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

  // ── DIALER (the phone driver) ────────────────────────────────────────────────
  // Place a call on the chosen channel. 'quo' rings through your Quo number via the
  // OpenPhone deep link. 'phone' hands off to the device's native dialer (your
  // T-Mobile line) with the number pre-filled. Either way we log the intent and
  // surface the post-call follow-up card so nothing gets dropped.
  function placeCall(toRaw, contact) {
    const to = quoNormPhone(toRaw);
    if (!to || to.length < 11) { setErr('Enter a valid US / Canada number to call.'); return; }
    setErr('');
    if (callVia === 'quo') {
      if (!fromId) { setErr('Pick your Quo number first (top of screen), or switch to Phone.'); return; }
      quoDial(to);
    } else {
      // native T-Mobile line
      window.location.href = `tel:${to}`;
    }
    logCallIntent(to, contact);
    setAfterCall({ contact: contact || phoneToContact[quoLast10(to)] || null, phone: to });
  }
  // Text on the chosen channel. 'quo' opens the in-app Quo thread (server-send).
  // 'phone' opens the native SMS app on your T-Mobile line.
  function textVia(toRaw, contact) {
    const to = quoNormPhone(toRaw);
    if (!to || to.length < 11) { setErr('Enter a valid US / Canada number to text.'); return; }
    setErr('');
    if (callVia === 'quo') {
      setTab('messages'); openConvo(to, (contact && contact.name) || nameFor(to));
    } else {
      window.location.href = `sms:${to}`;
    }
  }
  // Best-effort: log an outbound call attempt so it shows in history + feeds the
  // "owe a reply" / cadence signals even before the Quo webhook lands (Quo) or at
  // all (native phone, which we otherwise can't see).
  async function logCallIntent(to, contact) {
    try {
      await supabase.from('contact_interactions').insert({
        user_id: userId, contact_id: contact?.id || phoneToContact[quoLast10(to)]?.id || null,
        channel: 'call', kind: 'call', direction: 'outbound',
        brief: `Outbound call via ${callVia === 'quo' ? 'Quo' : 'phone'}`,
        occurred_at: new Date().toISOString(),
      });
    } catch (_) { /* non-fatal — logging must never block dialing */ }
  }

  // Contacts matching the dialer search (name / company / number).
  const dialMatches = useMemo(() => {
    const q = dialSearch.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/[^0-9]/g, '');
    return contacts.filter(c => {
      const nm = (c.name || '').toLowerCase();
      const co = (c.company || '').toLowerCase();
      const ph = [c.phone, c.mobile, c.business_phone, c.home_phone].filter(Boolean).join(' ').replace(/[^0-9]/g, '');
      return nm.includes(q) || co.includes(q) || (digits.length >= 3 && ph.includes(digits));
    }).slice(0, 8);
  }, [dialSearch, contacts]);

  const callList = useMemo(() => calls.slice().sort((a, b) => new Date(b.op_created_at || 0) - new Date(a.op_created_at || 0)), [calls]);
  const feed = useMemo(() => {
    const rows = [];
    for (const m of msgs) rows.push({ k: 'text', id: m.id, at: m.op_created_at || m.created_at, dir: m.direction, body: m.body, who: m.direction === 'incoming' ? m.from_number : m.to_number, status: m.status });
    for (const c of calls) rows.push({ k: 'call', id: c.id, at: c.op_created_at || c.created_at, dir: c.direction, who: c.participant, dur: c.duration, status: c.status, summary: c.summary, next_steps: c.next_steps, transcript: c.transcript, transcript_en: c.transcript_en, op_id: c.op_id, recording_url: c.recording_url, raw: c.raw });
    return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  }, [msgs, calls]);

  if (loadingNums) return <div className="loading-screen" style={{ height: '50vh' }}><div className="spinner" /></div>;

  const TABS = [{ id: 'dialer', label: 'Dialer', icon: <Icon name="quo" size={13} /> }, { id: 'feed', label: 'Live feed', icon: <Icon name="zap" size={13} /> }, { id: 'messages', label: 'Messages', icon: <Icon name="message" size={13} /> }, { id: 'calls', label: 'Calls', icon: <Icon name="quo" size={13} /> }];

  return (
    <div className="view">
      {/* House page-title pattern: Barlow Condensed eyebrow ABOVE a Fraunces
          headline (same as Today and Someday). This screen had the eyebrow
          standing in AS the title, so it was the one page in the app with no
          headline at all — which is why the type read as the wrong font.
          Title and actions sit on separate rows so the header holds at large
          system font; a single row of title-plus-buttons has collapsed three
          times before. */}
      <div className="fade-up" style={{ marginBottom: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, minHeight: '40px', marginBottom: '4px' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>＋ New</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSetup(s => !s)} title="Number, sync & connection status">⚙</button>
        </div>
        <div style={{ marginBottom: '2px' }}><span className="gold-move" style={{ fontSize: 11, letterSpacing: '.22em', fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase' }}>Phone &amp; Text</span></div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: '0', display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}><Icon name="quo" size={24} style={{color:'var(--accent)',flexShrink:0}} /><span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>My Line.</span></h1>
        <hr className="gold-hairline" style={{ margin: '12px 0 0' }} />
      </div>

      {/* Setup & status — tucked away; this is configuration, not daily use. */}
      {showSetup && (
        <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Your number</span>
            <select value={fromNumber?.id || ''} onChange={e => changeNumber(e.target.value)} style={{ background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontWeight: 600 }}>
              <option value="">— pick your line —</option>
              {numbers.map(n => <option key={n.id} value={n.id}>{n.name ? n.name + ' · ' : ''}{quoFmtPhone(n.number)}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={syncNow} disabled={syncing} title="Pull latest history from Quo">{syncing ? 'Syncing…' : '⟳ Sync'}</button>
          </div>
          <QuoStatusPanel msgs={msgs} calls={calls} activeNumber={fromNumber?.number} />
        </div>
      )}

      {incomingCall && (
        <div className="panel" style={{ padding: 14, marginBottom: 12, borderColor: 'var(--green, #4ADE80)', background: 'rgba(74,222,128,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>📞</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--green, #4ADE80)', fontWeight: 700 }}>INCOMING CALL</div>
            <div style={{ fontSize: 15, color: 'var(--text-1)', fontWeight: 700 }}>
              {incomingCall.contact ? incomingCall.contact.name : quoFmtPhone(incomingCall.phone)}
              {incomingCall.contact && discByContact[incomingCall.contact.id]?.primary_letter && <span style={{ color: 'var(--accent)', marginLeft: 8, fontWeight: 800 }}>{discByContact[incomingCall.contact.id].primary_letter}</span>}
            </div>
            {incomingCall.contact
              ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{[incomingCall.contact.company, incomingCall.contact.role].filter(Boolean).join(' · ') || quoFmtPhone(incomingCall.phone)}{discByContact[incomingCall.contact.id]?.primary_letter ? ' · ' + (DISC_CALL_COACH[discByContact[incomingCall.contact.id].primary_letter.toUpperCase()] || '') : ''}</div>
              : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Not in your contacts</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setIncomingCall(null)}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {TABS.map(t => <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
      </div>

      {err && <div className="panel" style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13, padding: '8px 12px', marginBottom: 10 }}>{err}</div>}
      {syncing && <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 10 }}>⟳ Pulling your Quo history &amp; arming live sync…</div>}

      {tab === 'dialer' && (() => {
        const typed = quoNormPhone(dialNum);
        const typedContact = typed.length >= 11 ? (phoneToContact[quoLast10(typed)] || null) : null;
        const PAD = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
        const press = (k) => { setDialSearch(''); setDialNum(d => (d + k)); };
        return (
          <div>
            {/* Channel toggle: which line to use */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className={`btn btn-sm ${callVia === 'quo' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setCallVia('quo')}>
                Quo{fromNumber?.number ? ' · ' + quoFmtPhone(fromNumber.number) : ''}
              </button>
              <button className={`btn btn-sm ${callVia === 'phone' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setCallVia('phone')}>
                Phone (T-Mobile)
              </button>
            </div>

            {/* Contact search — matches your people by name / company / number */}
            <input className="form-input" value={dialSearch} onChange={e => { setDialSearch(e.target.value); }}
              placeholder="Search your contacts…" style={{ marginBottom: dialSearch ? 8 : 12 }} />
            {dialSearch.trim() && (
              <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                {dialMatches.length === 0
                  ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>No contact matches “{dialSearch.trim()}”. You can still dial the number on the pad below.</div>
                  : dialMatches.map(c => {
                      const ph = c.phone || c.mobile || c.business_phone || c.home_phone;
                      return (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{c.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{[c.company, ph ? quoFmtPhone(ph) : 'no number'].filter(Boolean).join(' · ')}</div>
                          </div>
                          {ph && <button className="btn btn-ghost btn-sm" onClick={() => textVia(ph, c)}>Text</button>}
                          {ph && <button className="btn btn-primary btn-sm" onClick={() => placeCall(ph, c)}>Call</button>}
                        </div>
                      );
                    })}
              </div>
            )}

            {/* The typed number + who it is */}
            {!dialSearch.trim() && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <div style={{ fontFamily: 'Fraunces, serif', fontSize: 30, color: 'var(--text-1)', letterSpacing: 1, minHeight: 40 }}>
                    {dialNum ? quoFmtPhone(dialNum) : <span style={{ color: 'var(--text-3)' }}>Enter a number</span>}
                  </div>
                  {typedContact
                    ? <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{typedContact.name}{typedContact.company ? ' · ' + typedContact.company : ''}</div>
                    : (typed.length >= 11 ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Not in your contacts</div> : <div style={{ minHeight: 18 }} />)}
                </div>

                {/* Number pad */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxWidth: 300, margin: '0 auto 12px' }}>
                  {PAD.map(([d, sub]) => (
                    <button key={d} onClick={() => press(d)}
                      style={{ padding: '12px 0', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'Fraunces, serif' }}>
                      <div style={{ fontSize: 22, lineHeight: 1 }}>{d}</div>
                      {sub && <div style={{ fontSize: 8.5, letterSpacing: 1.5, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
                    </button>
                  ))}
                </div>

                {/* Call / Text / backspace */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 300, margin: '0 auto' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => textVia(dialNum, typedContact)} disabled={typed.length < 11} style={{ flex: 1 }}>Text</button>
                  <button className="btn btn-primary" onClick={() => placeCall(dialNum, typedContact)} disabled={typed.length < 11} style={{ flex: 2 }}>Call</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDialNum(d => d.slice(0, -1))} disabled={!dialNum} title="Backspace">⌫</button>
                </div>

                {/* Pre-call context: who they are + how to talk to them */}
                {typedContact && <div style={{ marginTop: 14 }}>{renderPreCall(typedContact, typed)}</div>}

                {/* Quick text templates for the typed contact */}
                {typed.length >= 11 && (
                  <div style={{ marginTop: 10, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto' }}>
                    <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 6, fontWeight: 700 }}>QUICK TEXT</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {TEXT_TEMPLATES.map(t => (
                        <button key={t.label} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                          onClick={() => { const nm = typedContact?.name ? ' ' + typedContact.name.split(' ')[0] : ''; const body = t.body.replace('{name}', nm); if (callVia === 'quo') { setTab('messages'); openConvo(typed, typedContact?.name || nameFor(typed)); setCompose(body); } else { window.location.href = `sms:${typed}${/*body*/ '?&body=' + encodeURIComponent(body)}`; } }}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recents + favorites quick-dial when the pad is empty */}
                {!dialNum && (recentPeople.length > 0 || favoritePeople.length > 0) && (
                  <div style={{ marginTop: 18 }}>
                    {favoritePeople.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700 }}>FAVORITES</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {favoritePeople.map((f, i) => {
                            const disc = f.contact ? discByContact[f.contact.id] : null;
                            return (
                              <button key={i} onClick={() => placeCall(f.phone, f.contact)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 100, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 12.5 }}>
                                {f.contact?.name || quoFmtPhone(f.phone)}
                                {disc?.primary_letter && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{disc.primary_letter}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {recentPeople.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700 }}>RECENT</div>
                        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                          {recentPeople.map((r, i) => {
                            const disc = r.contact ? discByContact[r.contact.id] : null;
                            return (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: i < recentPeople.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{r.dir === 'incoming' ? '↙' : '↗'}</span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{r.contact?.name || quoFmtPhone(r.phone)}{disc?.primary_letter && <span style={{ color: 'var(--accent)', fontWeight: 700, marginLeft: 6 }}>{disc.primary_letter}</span>}</div>
                                </div>
                                <button className="btn btn-ghost btn-sm" onClick={() => textVia(r.phone, r.contact)}>Text</button>
                                <button className="btn btn-primary btn-sm" onClick={() => placeCall(r.phone, r.contact)}>Call</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Post-call follow-up — never drop a promise */}
            {afterCall && (
              <div className="panel" style={{ marginTop: 16, padding: 14, borderColor: 'var(--accent)' }}>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>AFTER THE CALL</div>
                <div style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 10 }}>
                  {afterCall.contact ? afterCall.contact.name : quoFmtPhone(afterCall.phone)} — what next?
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => textVia(afterCall.phone, afterCall.contact)}>Send a text</button>
                  {afterCall.contact && <button className="btn btn-ghost btn-sm" onClick={() => { if (window.__openContactResearch) window.__openContactResearch(afterCall.contact.id); }}>Open contact</button>}
                  {afterCall.contact && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await supabase.from('tasks').insert({ user_id: userId, title: `Follow up with ${afterCall.contact.name}`, priority: 'medium', contact_id: afterCall.contact.id }); if (window.__notify) window.__notify('Follow-up task added'); } catch (e) { setErr('Could not add task: ' + (e.message || e)); } }}>Add follow-up task</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setAfterCall(null)}>Done</button>
                </div>
                {/* If they didn't pick up: quick follow-up texts (VM-drop style) */}
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 6, fontWeight: 700 }}>NO ANSWER? QUICK FOLLOW-UP</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {TEXT_TEMPLATES.map(t => (
                      <button key={t.label} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                        onClick={() => { const nm = afterCall.contact?.name ? ' ' + afterCall.contact.name.split(' ')[0] : ''; const body = t.body.replace('{name}', nm); if (callVia === 'quo') { setTab('messages'); openConvo(afterCall.phone, afterCall.contact?.name || nameFor(afterCall.phone)); setCompose(body); } else { window.location.href = `sms:${afterCall.phone}?&body=${encodeURIComponent(body)}`; } setAfterCall(null); }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
                    <QuoRecording call={c} />
                    {(c.summary || (c.transcript && c.transcript.length)) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {c.summary && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUMMARY</div>{Array.isArray(c.summary) ? <ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{c.summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : <div style={{ fontSize: 13 }}>{c.summary}</div>}</div>}
                        {Array.isArray(c.next_steps) && c.next_steps.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>NEXT STEPS</div><ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{c.next_steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || '')}</li>)}</ul></div>}
                        {((Array.isArray(c.transcript) && c.transcript.length > 0) || c.transcript_en) && <QuoTranscript call={c} />}
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
                <QuoRecording call={it} />
                {(it.summary || (it.transcript && it.transcript.length)) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {it.summary && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUMMARY</div>{Array.isArray(it.summary) ? <ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{it.summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : <div style={{ fontSize: 13 }}>{it.summary}</div>}</div>}
                    {Array.isArray(it.next_steps) && it.next_steps.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>NEXT STEPS</div><ul style={{ margin: '2px 0 0 16px', fontSize: 13 }}>{it.next_steps.map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || '')}</li>)}</ul></div>}
                    {((Array.isArray(it.transcript) && it.transcript.length > 0) || it.transcript_en) && <QuoTranscript call={it} />}
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
