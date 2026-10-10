import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { todayNY } from '../clock';
import { onDay } from '../occurrences';
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
import TodayThree from './TodayThree';
import VoiceCapture from './VoiceCapture';
import WinTheDay from './WinTheDay';

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
    const now = Date.now();
    // Today's events by the one shared rule (src/occurrences.js): repeats
    // expanded, each occurrence at its own time. This screen used to work
    // repeats out for itself and knew only "every N days/weeks/months".
    const todays = onDay(events, new Date()).filter(e => !e.all_day && e.status !== 'cancelled' && e.event_kind !== 'task_block')
      .filter(e => new Date(e.end_at || e.start_at).getTime() >= now);
    return { first: todays[0] || null, more: Math.max(0, todays.length - 1) };
  }, [events]);

  const isFirstRun = contacts.length === 0 && tasks.length === 0 && events.length === 0;

  // How this person asked to be shown things (Settings → How PrismOS shows things
  // to me). Three under "Needs you today" unless they chose one at a time.
  const [present, setPresent] = useState({ today_items: 3 });
  // Win the Day pilot (10 Oct 2026): one Top 3 replaces GoalsBand + TodayThree +
  // "Needs you today" for people in pilot_features. Read from my_presentation()
  // (no extra request); missing key = off = the current Today.
  const pilot = Array.isArray(present.pilots) && present.pilots.includes('win_the_day');
  useEffect(() => {
    let go = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('my_presentation');
      if (!go || error || !data) return;
      setPresent(data);
      // a starting guess for the learning pace applies only where this device has no choice of its own
      try { if (data.tips_pace && !localStorage.getItem('prism_tips_pace')) localStorage.setItem('prism_tips_pace', data.tips_pace); } catch (_) {}
    };
    load();
    window.addEventListener('prism:presentation-changed', load);
    return () => { go = false; window.removeEventListener('prism:presentation-changed', load); };
  }, [myUserId]);

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
      {!isFirstRun && pilot && <WinTheDay userId={myUserId} setTasks={setTasks} />}
      {!isFirstRun && !pilot && <GoalsBand userId={myUserId} tasks={tasks} setTasks={setTasks} events={events} setView={setView} firstName={first} />}

      {/* 1c — THREE THINGS, one tap each (9 Oct 2026, Dara: compressed CRM plan).
          After the person's own goals (the agenda comes before anything inbound),
          before the rest of the day. Promises due within 48 hours lead, then a
          Company Lead waiting, then a missed caller. In-app only. */}
      {!isFirstRun && !pilot && <TodayThree userId={myUserId} setView={setView} />}

      {/* 2 — What PrismOS did */}
      {!pilot && <HandledLine setView={setView} />}

      {/* 3 — What needs you. A live lead first: it is money and it is perishable. */}
      <div style={{ marginTop: 18 }}>
        <LeadConcierge myUserId={myUserId} setView={setView} contacts={contacts} />
      </div>
      <DelegationInbox userId={myUserId} onChanged={notifyTasks} />
      {!isFirstRun && !pilot && <div style={calm.section}>Needs you today</div>}
      {!isFirstRun && !pilot && <ChiefQueue userId={myUserId} setView={setView} limit={3} oneAtATime={present.today_items === 1} onChanged={notifyTasks} />}
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
          {/* Pilot: call review and the rest of "Needs you" stay one tap down, never lost. */}
          {pilot && <HandledLine setView={setView} />}
          {pilot && <ChiefQueue userId={myUserId} setView={setView} limit={3} oneAtATime={present.today_items === 1} onChanged={notifyTasks} />}
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
  return (<>
    <VoiceCapture userId={userId} />
    <div style={{ ...calm.actions, marginTop: 4, marginBottom: 8 }}>
      {onOpenPlan && <button type="button" style={calm.btnQuiet} onClick={() => onOpenPlan()}>Plan my day</button>}
    </div>
  </>);
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
  if (!brief) return null;
  const ICON = { signal: '📡', reply: '↩️', alert: '⏰', contacts: '👥', dollar: '$', inbox: '📥', mail: '📥' };
  return (
    <div className="fade-up" style={{ marginBottom: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase' }}>This morning</span>
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

