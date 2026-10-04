import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { enqueue } from '../outbox';
import { todayNY } from '../clock';
import { supabase } from '../dataService';
import { pushHealth, resaveThisDevice, connectThisDevice, pushSupported, isIOS, isStandalone } from '../push';
import { CallFollowupsPanel } from './ReviewPanels';
import ChiefQueue from './ChiefQueue';
import CommitmentReview from './CommitmentReview';
import StaleDecide from './StaleDecide';
import { DelegationInbox, DelegationOutbox } from './TaskDelegation';
import ConnectionAlertBanner from './ConnectionAlertBanner';
import LeadConcierge from './LeadConcierge';
import CallList from './CallList';
import { HandledLine } from './DoneForYou';
import GoalsBand from './GoalsBand';
import { calm } from '../calm';

// ── TODAY — one app that makes everything else disappear (1 Oct 2026) ────────
//
// Josh, after a week on his iPhone: "When you open the app, instead of
// immediately understanding your day, you get '1 out of 84 — do this next.'
// Then a reply to someone who emailed three months ago. Then another person to
// call. 2,406 inbox items, 152 contacts, 8 tasks. A morning brief on its way. A
// microphone floating over that. Way too much going on. Your brain doesn't go
// 'my system handled everything', it goes 'now I have 84 more things to do'."
// Dara: "Frankly, I was feeling the same — overwhelmed." Ray had said it nightly.
//
// So Today answers ONE question, in this order, and stops:
//   1. Your day     — the greeting, the date, the next thing on your calendar.
//   2. What I did   — "PrismOS handled N things for you; these wait for your OK."
//   3. Needs you    — a new lead if there is one, then the THREE things that
//                     matter today from the one queue (chief_queue). No "1 of 84".
//                     Every row says who and why; every row can be "not today".
//   4. Everything else is one tap down: the brief, the call list, old tasks,
//      progress, alerts set-up, how much PrismOS does on its own. Nothing was
//      removed — it was moved out of the way.
//
// What left for good: the "Do this next" carousel (its emails-that-bounced and
// documents-that-ask kinds moved INTO chief_queue, so nothing is lost), the
// triage deck of counts, and the floating microphone.

const fmtTime = (d) => d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

export default function TodayView({
  contacts = [], setContacts, tasks = [], setTasks, events = [], deals = [],
  gciGoal = 0, setView, myUserId = null, oweReplyMap = {}, setOweReplyMap,
  agentName = '', onOpenPlan,
}) {
  const [more, setMore] = useState(false);
  const notifyTasks = () => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} };
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (agentName || '').trim().split(/\s+/)[0];
  const dateLine = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });

  // The next thing on today's calendar — the first thing a person wants to know.
  const next = useMemo(() => {
    const now = Date.now(); const today = todayNY();
    const todays = (events || []).filter(e => e && e.start_at && !e.all_day && e.status !== 'cancelled'
      && new Date(e.start_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today
      && new Date(e.end_at || e.start_at).getTime() >= now)
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    return { first: todays[0] || null, more: Math.max(0, todays.length - 1) };
  }, [events]);

  const isFirstRun = contacts.length === 0 && tasks.length === 0 && events.length === 0;

  return (
    <div className="ww-prism" data-testid="today-calm" style={calm.page}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:#2A2016;--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;--accent:#CBA35C;}`}</style>

      {/* Above everything, but only when something is actually broken. */}
      <ConnectionAlertBanner setView={setView} />
      <EnableNotifications myUserId={myUserId} urgentOnly />

      {/* 1 — Your day */}
      <h1 style={calm.greeting}>{greeting}{first ? ', ' + first + '.' : '.'}</h1>
      <div style={calm.date}>{dateLine}</div>
      {next.first && (
        <button type="button" onClick={() => setView && setView('calendar')}
          style={{ ...calm.link, display: 'block', marginTop: 14, color: 'var(--text-1)', fontWeight: 500, fontSize: 15 }}>
          <span style={{ color: 'var(--text-3)' }}>Next · </span>{fmtTime(new Date(next.first.start_at))} — {next.first.title || 'Appointment'}
          {next.more > 0 && <span style={{ color: 'var(--text-3)' }}>{'  ·  then ' + next.more + ' more today'}</span>}
        </button>
      )}

      {isFirstRun && (
        <div style={{ marginTop: 22 }}>
          <div style={calm.section}>Three things to start</div>
          <div style={calm.sectionNote}>PrismOS gets useful the moment it knows your people and your mail.</div>
          {[
            ['Connect your email', 'Fills your inbox, your briefing and who owes you a reply — all from one connection.', () => setView('settings')],
            ['Bring in your contacts', 'Import from Google, or add the ten people you speak to most.', () => setView('google_contacts')],
            ['Record a voice note', 'Say what happened after a showing. It files itself.', () => setMore(true)],
          ].map(([title, why, go], i) => (
            <div key={i} style={i ? calm.rowRule : calm.row}>
              <div style={calm.rowTitle}>{title}</div>
              <div style={calm.rowWhy}>{why}</div>
              <div style={calm.actions}><button type="button" style={calm.btnPrimary} onClick={go}>Start</button></div>
            </div>
          ))}
        </div>
      )}

      {/* 1b — YOUR agenda, before anything inbound (4 Oct): contract dates this week,
          then the goals you chose for today. */}
      {!isFirstRun && <GoalsBand userId={myUserId} tasks={tasks} setTasks={setTasks} events={events} setView={setView} firstName={first} />}

      {/* 2 — What PrismOS did */}
      <HandledLine setView={setView} />

      {/* 3 — What needs you. A live lead first: it is money and it is perishable. */}
      <div style={{ marginTop: 18 }}>
        <LeadConcierge myUserId={myUserId} setView={setView} contacts={contacts} />
      </div>
      <DelegationInbox userId={myUserId} onChanged={notifyTasks} />
      {!isFirstRun && <div style={calm.section}>Needs you today</div>}
      {!isFirstRun && <ChiefQueue userId={myUserId} setView={setView} limit={3} onChanged={notifyTasks} />}
      {/* The day-before question, in the app itself (4 Oct): the push reaches only people
          with a device registered — 5 of 17 accounts. Shown only on the day it applies. */}
      {!isFirstRun && <div style={{ marginTop: 18 }}><SetAsideTomorrow userId={myUserId} /></div>}

      {/* 4 — Everything else, one tap down */}
      <div style={{ marginTop: 30, borderTop: calm.HAIR }}>
        <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more}
          style={{ ...calm.link, width: '100%', color: 'var(--text-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 52 }}>
          <span>{more ? 'Less' : 'More, when you want it'}</span>
          <span style={{ color: 'var(--text-3)' }}>{more ? '▴' : '▾'}</span>
        </button>
      </div>
      {more && (
        <div data-testid="today-more">
          <QuickActions setView={setView} userId={myUserId} onOpenPlan={onOpenPlan} />
          <MorningBrief setView={setView} />
          <CallList />
          <DelegationOutbox userId={myUserId} onChanged={notifyTasks} />
          <StaleDecide tasks={tasks} setTasks={setTasks} userId={myUserId} />
          <CallFollowupsPanel userId={myUserId} contacts={contacts} setTasks={setTasks} />
          <TidyOldTasks userId={myUserId} setTasks={setTasks} tasks={tasks} />
          <HowYoureDoing tasks={tasks} />
          <EnableNotifications myUserId={myUserId} calmOnly />
        </div>
      )}
    </div>
  );
}

// Voice note, Plan my day — tools, not tasks. Quiet links, no floating button.
function QuickActions({ setView, userId, onOpenPlan }) {
  return (
    <div style={{ ...calm.actions, marginTop: 4, marginBottom: 8 }}>
      <VoiceNote setView={setView} userId={userId} inline />
      {onOpenPlan && <button type="button" style={calm.btnQuiet} onClick={() => onOpenPlan()}>Plan my day</button>}
    </div>
  );
}

// How you're doing — a reward at the end, never a gate at the start.
function HowYoureDoing({ tasks }) {
  const todayISO = todayNY();
  const p = useMemo(() => {
    const dayISO = (d) => new Date(Date.now() - d * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const doneToday = tasks.filter(t => t.completed && (t.completed_at || '').slice(0, 10) === todayISO).length;
    const week = [];
    for (let i = 6; i >= 0; i--) { const d = dayISO(i); week.push(tasks.filter(t => t.completed && (t.completed_at || '').slice(0, 10) === d).length); }
    return { doneToday, week, weekTotal: week.reduce((a, b) => a + b, 0) };
  }, [tasks, todayISO]);
  return (
    <div style={calm.rowRule}>
      <div style={calm.rowTitle}>{p.doneToday === 0 ? 'Nothing checked off yet today.' : `${p.doneToday} done today.`}</div>
      <div style={calm.rowWhy}>{p.weekTotal} in the last seven days</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 24, marginTop: 10, maxWidth: 220 }}>
        {p.week.map((n, i) => {
          const max = Math.max(1, ...p.week);
          return <div key={i} title={`${n} done`} style={{ flex: 1, height: `${Math.max(3, (n / max) * 24)}px`, borderRadius: 2, background: i === 6 ? '#C5A95E' : 'rgba(197,169,94,0.3)' }} />;
        })}
      </div>
    </div>
  );
}

// Old tasks — offered as tidying, never as a wall of shame. Reversible, logged,
// one-tap undo (groom_* RPCs). Nothing is deleted.
function TidyOldTasks({ userId, setTasks, tasks }) {
  const [cands, setCands] = useState([]);
  const [show, setShow] = useState(false);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('groom_stale_preview', { p_min_age_days: 30 });
    setCands(error ? [] : (data || []));
  }, []);
  useEffect(() => { load(); }, [load, tasks.length]);
  const chosen = () => Object.entries(sel).filter(([, v]) => v).map(([k]) => k);
  const run = async (rpc, args, done) => {
    const ids = chosen(); if (!ids.length) return;
    setBusy(true);
    const { data, error } = await supabase.rpc(rpc, { p_task_ids: ids, ...args });
    setBusy(false);
    if (error || !data?.ok) { if (window.__notify) window.__notify('Could not do that: ' + (error?.message || data?.error || ''), 'error'); return; }
    setLastBatch(data.batch_id);
    setTasks && setTasks(pr => pr.filter(t => !ids.includes(t.id)));
    setShow(false);
    if (window.__notify) window.__notify(done(data), 'success');
    load();
  };
  const undo = async () => {
    const { data, error } = await supabase.rpc('groom_undo', { p_batch_id: lastBatch });
    if (error || !data?.ok) { if (window.__notify) window.__notify('Could not undo: ' + (error?.message || data?.error || ''), 'error'); return; }
    if (window.__notify) window.__notify('Restored.', 'success'); setLastBatch(null); load();
  };
  if (!cands.length && !lastBatch) return null;
  const n = chosen().length;
  return (
    <div style={calm.rowRule}>
      <div style={calm.rowTitle}>Some tasks have been open a month or more</div>
      <div style={calm.rowWhy}>Old tasks make the list feel heavier than it is. Park them or archive them — nothing is deleted.</div>
      <div style={calm.actions}>
        {!show && cands.length > 0 && <button type="button" style={calm.btnQuiet} onClick={() => { setSel(Object.fromEntries(cands.map(g => [g.task_id, true]))); setShow(true); }}>Review them</button>}
        {lastBatch && <button type="button" style={calm.btnQuiet} onClick={undo}>Undo the last tidy</button>}
      </div>
      {show && (
        <div style={{ marginTop: 6 }}>
          {cands.map(g => (
            <label key={g.task_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: calm.HAIR, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!sel[g.task_id]} onChange={e => setSel(s => ({ ...s, [g.task_id]: e.target.checked }))} style={{ marginTop: 4 }} />
              <span style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.45 }}>{g.title}<span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-3)' }}>{g.reason}</span></span>
            </label>
          ))}
          <div style={calm.actions}>
            <button type="button" disabled={busy || !n} style={calm.btnPrimary} onClick={() => run('tasks_park_someday', { p_note: null }, d => `Moved ${d.parked} to Someday/Maybe.`)}>Someday / Maybe</button>
            <button type="button" disabled={busy || !n} style={calm.btnQuiet} onClick={() => run('groom_stale_archive', { p_level: 2 }, d => `Archived ${d.archived}.`)}>Archive</button>
            <button type="button" style={calm.btnQuiet} onClick={() => setShow(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Voice-Note to Everything ──────────────────────────────────────────────────
// Tap, talk for 20 seconds after a showing, and PrismOS files it: a clean contact
// note, the to-dos with due dates, and a drafted follow-up. Ease of use is the new
// #1 thing agents want — this is the "saves brainpower" feature they'll open the
// app for between appointments. Records with MediaRecorder, transcribes + extracts
// server-side, then hands back a review card. Nothing saves until they tap Apply.
function VoiceNote({ setView, userId, inline = false }) {
  const [phase, setPhase] = useState('idle');   // idle | recording | working | review | error
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [msg, setMsg] = useState('');
  const recRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const timerRef = React.useRef(null);

  const start = async () => {
    setMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        await process(blob);
      };
      mr.start();
      recRef.current = mr; setPhase('recording'); setSecs(0);
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (_) { setMsg('Microphone access is needed to capture a voice note.'); setPhase('error'); }
  };
  const stop = () => { clearInterval(timerRef.current); try { recRef.current && recRef.current.stop(); } catch (_) {} setPhase('working'); };
  const cancel = () => { clearInterval(timerRef.current); try { recRef.current && recRef.current.stop(); } catch (_) {} chunksRef.current = []; setPhase('idle'); };

  const process = async (blob) => {
    let b64 = null;
    try {
      b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const { data, error } = await supabase.functions.invoke('voice-note', { body: { audio_base64: b64 } });
      if (error || data?.error) throw new Error(data?.error || 'Could not process the note');
      if (data.empty) { setMsg('I couldn\u2019t hear anything — try again.'); setPhase('error'); return; }
      setTranscript(data.transcript || ''); setResult(data.result || null); setPhase('review');
    } catch (e) {
      // Keep the audio on the phone and retry, so the worst outcome is a delay,
      // never a loss. BUT DO NOT LIE ABOUT WHY: saying "No signal" for EVERY
      // failure is how a broken voice note went unnoticed — the transcription
      // service rejected every submission and the app blamed the connection.
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false)
        || /failed to fetch|networkerror|load failed|connection/i.test(String((e && e.message) || ''));
      try {
        await enqueue(userId, 'voice_note', { audio_base64: b64 }, 'Voice note (' + Math.round(blob.size / 1024) + 'KB)');
        setMsg(offline
          ? 'No signal — the recording is saved on your phone and will send itself when you’re back online.'
          : 'Couldn’t process that note: ' + (e.message || 'unknown error')
            + '. The recording is saved on your phone and will retry — nothing is lost.');
      } catch (_) {
        setMsg((e.message || 'Something went wrong') + ' — and the recording could not be saved on this device.');
      }
      setPhase('error');
    }
  };

  const apply = async () => {
    setPhase('working');
    try {
      await supabase.rpc('apply_voice_note', {
        p_contact_id: result.contact_id || null, p_note: result.note || transcript,
        p_tasks: (result.tasks || []).filter(t => t.title), p_title: result.contact_name ? ('Note · ' + result.contact_name) : 'Voice note',
      });
      setPhase('done'); setTimeout(() => { setPhase('idle'); setResult(null); }, 1600);
    } catch (e) { setMsg('Could not save: ' + (e.message || e)); setPhase('error'); }
  };

  // A quiet button in Today's "More" — Josh: "A microphone floating over
  // that. Way too much going on." No floating trigger any more.
  if ((phase === 'idle' || phase === 'done') && inline) {
    return (
      <button type="button" onClick={phase === 'idle' ? start : undefined} style={calm.btnQuiet}>
        {phase === 'done' ? '✓ Filed' : '🎙 Voice note'}
      </button>
    );
  }
  if (phase === 'idle' || phase === 'done') {
    return (
      <button onClick={phase === 'idle' ? start : undefined}
        style={{ position: 'fixed', right: 18, bottom: 92, zIndex: 1200, width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer', background: phase === 'done' ? '#22c55e' : 'linear-gradient(150deg,#EBCB82,#C5A95E)', color: '#100D09', fontSize: 22, boxShadow: '0 8px 24px rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        title="Voice note">
        {phase === 'done' ? '✓' : '🎙'}
      </button>
    );
  }

  return (
    <div onClick={phase === 'review' ? undefined : cancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base)', width: '100%', maxWidth: 560, borderRadius: '18px 18px 0 0', border: '1px solid var(--border)', padding: '20px 18px 34px', maxHeight: '90vh', overflowY: 'auto' }}>
        {phase === 'recording' && (
          <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.16em', fontSize: 12, color: '#EBCB82', marginBottom: 10 }}>Listening…</div>
            <div style={{ width: 84, height: 84, borderRadius: '50%', margin: '0 auto 14px', background: 'rgba(235,203,130,.14)', border: '2px solid #EBCB82', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, animation: 'livePulse 1.4s ease-in-out infinite' }}>🎙</div>
            <div style={{ fontSize: 26, fontFamily: "'Fraunces',serif", color: 'var(--text-1)', marginBottom: 4 }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 18 }}>Say who it's about, what happened, and any next steps.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={stop} style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 12, padding: '12px 26px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Done</button>
              <button onClick={cancel} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 18px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
        {phase === 'working' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>✨</div>
            <div style={{ fontSize: 15, color: 'var(--text-1)' }}>Turning your note into filed work…</div>
          </div>
        )}
        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 14, color: '#fca5a5', marginBottom: 16 }}>{msg}</div>
            <button onClick={() => setPhase('idle')} style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 18px', cursor: 'pointer' }}>Close</button>
          </div>
        )}
        {phase === 'review' && result && (
          <>
            <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 21, color: 'var(--text-1)', marginBottom: 2 }}>Here's what I heard.</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>Review and file it — nothing is saved until you tap Apply.</div>
            {result.contact_name && (
              <div style={{ marginBottom: 12 }}><div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>About</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{result.contact_name}{!result.contact_id && <span style={{ fontSize: 11, color: '#EBCB82', fontWeight: 400 }}> · not matched to a contact</span>}</div></div>
            )}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Note</div>
              <textarea value={result.note || ''} onChange={e => setResult({ ...result, note: e.target.value })} rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5 }} />
            </div>
            {(result.tasks || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Tasks ({result.tasks.length})</div>
                {result.tasks.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: '#22c55e', fontSize: 13 }}>✓</span>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-1)' }}>{t.title}</span>
                    {t.due && <span style={{ fontSize: 11.5, color: '#EBCB82' }}>{new Date(t.due + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    <button onClick={() => setResult({ ...result, tasks: result.tasks.filter((_, j) => j !== i) })} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {result.followup && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Suggested follow-up</div>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--text-1)', fontStyle: 'italic' }}>“{result.followup}”</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={apply} style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Apply</button>
              <button onClick={() => { setPhase('idle'); setResult(null); }} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 18px', fontSize: 14, cursor: 'pointer' }}>Discard</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Set aside tomorrow ────────────────────────────────────────────────────────
// Panel, 1 Oct: suggestions from calls were set aside unreviewed by the hourly
// rule, and the only agents who ever kept one were those who happened to open
// the list. Now a push goes out the day before (warn_commitments_before_set_aside,
// 2026-10-01 SQL) and lands HERE: the exact follow-ups at risk, keep-or-skip in
// place. setAsideAt() mirrors public.commitment_set_aside_at() — change both or neither.
const FUSE_DAYS = { immediate: 3, near: 14 };
function nyMidnightAfter(due) {           // start of the day after `due`, New York time
  const [y, m, d] = due.split('-').map(Number);
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d + 1, off);
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(t));
    if (h === 0) return t;
  }
  return Date.UTC(y, m - 1, d + 1, 4);
}
function setAsideAt(c) {
  const byAge = Date.parse(c.created_at) + (FUSE_DAYS[c.fuse || 'near'] || 30) * 864e5;
  return c.due_date ? Math.max(byAge, nyMidnightAfter(c.due_date)) : byAge;
}
function SetAsideTomorrow({ userId }) {
  const [ids, setIds] = useState(null);
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    try {
      // THE DIAL: the question is asked only at "Do and tell". Off = nothing will be
      // set aside; quiet = the person chose not to be asked.
      const { data: dial } = await supabase.rpc('my_dial');
      const tidy = ((dial?.items || []).find(i => i.cat === 'tidy_followups') || {}).level || 'tell';
      if (dial?.paused || tidy !== 'tell') { setIds([]); return; }
      const { data } = await supabase.from('commitments').select('id,created_at,fuse,due_date')
        .eq('user_id', userId).eq('status', 'proposed').is('auto_expired_at', null)
        .or('fuse.is.null,fuse.neq.immediate');
      const edge = Date.now() + 864e5;
      const soon = (data || []).filter(c => setAsideAt(c) <= edge).map(c => c.id);
      setIds(soon); setN(x => x + 1);
    } catch (_) { setIds([]); }
  }, [userId]);
  useEffect(() => { if (userId) load(); }, [userId, load]);
  if (!ids || !ids.length) return null;
  return (
    <div className="fade-up" style={{ marginBottom: 14, border: '1px solid rgba(197,169,94,.45)', borderRadius: 16, padding: '13px 15px 4px', background: 'rgba(197,169,94,.06)' }}>
      {/* Ray (panel), 1 Oct: no "last chance", no deadline-as-threat. An offer,
          and the truth that nothing is lost — it can always be picked back up. */}
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.18em', fontSize: 11, fontWeight: 700, color: '#EBCB82', marginBottom: 4 }}>From your calls · still worth doing?</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}>
        Keep what still matters. PrismOS tidies the rest away tomorrow — you can always pick {ids.length === 1 ? 'it' : 'them'} back up.
      </div>
      <CommitmentReview key={n} userId={userId} compact onlyIds={ids} onChanged={load} />
    </div>
  );
}

// ── Turn on notifications ─────────────────────────────────────────────────────
// The multiplier: new-lead alerts and the Morning Brief only reach a phone if a
// WORKING device is connected. Logic lives in ../push.js. This card:
//   • stays up until a device that is not refusing alerts exists (a saved but
//     broken phone used to make it vanish for good);
//   • says, in numbers, how many alerts this week reached nobody;
//   • ends setup only when a real test alert reaches the phone, and says so.
// iOS: Safari only allows web push from the installed Home Screen app, so an
// un-installed iPhone gets the Add-to-Home-Screen steps instead.
function EnableNotifications({ myUserId, urgentOnly = false, calmOnly = false }) {
  // checking | ready | broken | ios_install | unsupported | busy | done | on
  const [state, setState] = useState('checking');
  const [msg, setMsg] = useState('');
  const [health, setHealth] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const ios = isIOS(), standalone = isStandalone();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await resaveThisDevice(myUserId);              // keep this phone's row fresh
        const h = await pushHealth(myUserId);
        if (!live) return;
        setHealth(h);
        // "Not now" holds for the session — unless alerts are being missed.
        try { if (sessionStorage.getItem('hidePushPrompt') === '1' && !h.missed7d) { setDismissed(true); return; } } catch (_) {}
        if (h.working > 0) { setState('on'); return; }
        if (!pushSupported()) { setState(ios && !standalone ? 'ios_install' : 'unsupported'); return; }
        if (ios && !standalone) { setState('ios_install'); return; }
        setState(h.devices > 0 ? 'broken' : 'ready');
      } catch (_) { if (live) setState('ready'); }
    })();
    return () => { live = false; };
  }, [myUserId, ios, standalone]);

  const enable = async () => {
    setState('busy'); setMsg('');
    try {
      const r = await connectThisDevice(myUserId);
      if (r.ok) { setMsg(r.message); setState('done'); setHealth(h => h && { ...h, working: (h.working || 0) + 1 }); return; }
      setMsg(r.message); setState(health && health.devices > 0 ? 'broken' : 'ready');
    } catch (e) { setMsg('Could not turn on alerts: ' + (e.message || e)); setState('ready'); }
  };
  const hide = () => { try { sessionStorage.setItem('hidePushPrompt', '1'); } catch (_) {} setDismissed(true); };

  if (dismissed || state === 'checking' || state === 'on') return null;
  // At the top of Today only when alerts are being MISSED or the phone stopped
  // accepting them. Setting alerts up the first time lives in "More".
  if (urgentOnly && !((health && health.missed7d) || state === 'broken')) return null;
  if (calmOnly && ((health && health.missed7d) || state === 'broken')) return null;   // already shown at the top

  const missed = (health && health.missed7d) || 0;
  const wrap = { margin: '14px 0', background: 'rgba(246,241,231,.035)', borderRadius: 16, padding: '15px 17px' };   // calm: a quiet card, no gold frame
  const head = (label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 15 }}>{state === 'done' ? '✓' : '🔔'}</span>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#EBCB82' }}>{label}</span>
      <button onClick={hide} aria-label="Hide" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 17, cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  );
  const title = (t) => <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 18, color: 'var(--text-1)', lineHeight: 1.3, marginBottom: 6 }}>{t}</div>;
  const missedLine = missed > 0 && (
    <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 8, lineHeight: 1.5 }}>
      PrismOS tried to alert you {missed === 1 ? 'once' : missed + ' times'} this week. None reached your phone.
    </div>
  );

  // The finish line — setup is done because the phone got the test, not because a row saved.
  if (state === 'done') {
    return (
      <div className="fade-up" style={wrap}>
        {head('Alerts connected')}
        {title('This phone will get your lead alerts.')}
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{msg} If it didn’t pop up, check that notifications for PrismOS are allowed in your phone’s settings.</div>
      </div>
    );
  }

  if (state === 'ios_install') {
    return (
      <div className="fade-up" style={wrap}>
        {head('Don’t miss a lead')}
        {missedLine}
        {title('Add PrismOS to your Home Screen to get alerts.')}
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          On iPhone, tap the <strong>Share</strong> button <span style={{ color: 'var(--accent)' }}>↑</span> in Safari, choose <strong>“Add to Home Screen,”</strong> then open PrismOS from your home screen and you’ll see a one-tap “Turn on alerts” here.
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>It takes 15 seconds and it’s how you get new-lead alerts and your morning brief on your phone.</div>
      </div>
    );
  }

  if (state === 'unsupported') {
    if (!missed) return null;   // nothing they can do here, and nothing missed — stay quiet
    return (
      <div className="fade-up" style={wrap}>
        {head('Alerts can’t reach you')}
        {missedLine}
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>This browser can’t receive alerts. Open darasapp.com in Chrome on Android, or from the Home Screen app on iPhone, and turn them on there.</div>
      </div>
    );
  }

  const broken = state === 'broken' || (state === 'busy' && health && health.devices > 0);
  return (
    <div className="fade-up" style={wrap}>
      {head(broken ? 'Alerts aren’t arriving' : 'Don’t miss a lead')}
      {missedLine}
      {title(broken ? 'Your phone stopped accepting PrismOS alerts.' : 'Get new-lead alerts the moment they come in.')}
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
        {broken
          ? 'Tap below to reconnect this phone. We’ll send a test alert so you can see it work.'
          : 'Turn on alerts and PrismOS will ping you when a lead reaches out — plus your morning brief each day. We’ll send a test so you know it worked.'}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button disabled={state === 'busy'} onClick={enable} style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          {state === 'busy' ? 'Connecting…' : broken ? 'Reconnect this phone' : 'Turn on alerts'}
        </button>
        <button onClick={hide} style={{ background: 'transparent', color: 'var(--text-3)', border: 'none', fontSize: 12.5, cursor: 'pointer' }}>Not now</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}
    </div>
  );
}

// ── The Morning Money Brief ───────────────────────────────────────────────────
// One glance each morning at what's about your money today — leads, owed replies,
// deadlines, people going cold. Delivered as a push at 8am AND shown here (so it
// works even before an agent turns push on). Tapping a line jumps to the work.
function MorningBrief({ setView }) {
  const [brief, setBrief] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    supabase.rpc('morning_brief_today').then(({ data }) => { if (data && data.headline) setBrief(data); });
  }, []);
  if (hidden) return null;
  // A missing brief and an empty one looked identical — the card just vanished, and
  // that reads as broken. Yesterday's numbers would be worse: acting on a stale
  // count is the real harm.
  if (!brief) return (
    <div className="fade-up" style={{ marginBottom: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: '#9A7B2E', marginBottom: 5 }}>
        Your morning brief
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55 }}>
        Written fresh each morning — this one is on its way. Everything below is live now.
      </div>
    </div>
  );
  const ICON = { signal: '📡', reply: '↩️', alert: '⏰', contacts: '👥', dollar: '$', inbox: '📥', mail: '📥' };
  return (
    <div className="fade-up" style={{ marginBottom: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase' }}>☀ Your morning brief</span>
        <button onClick={() => setHidden(true)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 17, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 19, color: 'var(--text-1)', lineHeight: 1.3, marginBottom: (brief.items && brief.items.length) ? 12 : 0 }}>
        {brief.headline}
      </div>
      {/* setView was handed the WHOLE payload, so 'contacts:owe' set a view id that
          does not exist and two of the three brief rows were dead. Split on the colon. */}
      {Array.isArray(brief.items) && brief.items.map((it, i) => (
        <button key={i} onClick={() => {
            const [v, sub] = String(it.payload || '').split(':');
            if (!v) return;
            if (sub && window.__deepLink) window.__deepLink({ view: v, sub, n: Date.now() });
            if (setView) setView(v);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginTop: i ? 8 : 0, cursor: 'pointer' }}>
          <span style={{ fontSize: 15 }}>{ICON[it.icon] || '•'}</span>
          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-1)' }}>{it.label}</span>
          <span style={{ color: 'var(--accent)', fontSize: 16 }}>›</span>
        </button>
      ))}
    </div>
  );
}

