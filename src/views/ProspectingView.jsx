// ProspectingView — the daily prospecting screen (today's activity, XP/ranks,
// time logging, ROI scoreboard).
//
// This lived inside AccountingViews.jsx and was re-exported from it, so opening
// Prospecting downloaded the ENTIRE accounting bundle (tax engine, CSV importer,
// cash-flow forecaster) just to render a daily activity screen. It is its own
// chunk now.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { noteProspecting } from '../screenNotes';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { Tip } from '../tipsUi';
import { confirmDialog } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct, fmtHours } from '../financeUtils';
import { FinanceSystems, TemplateLibraryModal, TemplateActivateModal } from './FinanceSystems';

const PROSPECT_RANKS = [
  { min: 0,    name: 'Prospector',    icon: '🌱', color: '#9ca3af' },
  { min: 250,  name: 'Connector',     icon: '🤝', color: '#60a5fa' },
  { min: 750,  name: 'Rainmaker',     icon: '🌧️', color: '#34d399' },
  { min: 1800, name: 'Closer',        icon: '🎯', color: '#fbbf24' },
  { min: 4000, name: 'Top Producer',  icon: '🚀', color: '#f59e0b' },
  { min: 8000, name: 'Rainmaker King',icon: '👑', color: '#C5A95E' },
];

function rankForXp(xp) {
  let cur = PROSPECT_RANKS[0], next = null;
  for (let i = 0; i < PROSPECT_RANKS.length; i++) {
    if (xp >= PROSPECT_RANKS[i].min) { cur = PROSPECT_RANKS[i]; next = PROSPECT_RANKS[i + 1] || null; }
  }
  const level = PROSPECT_RANKS.indexOf(cur) + 1;
  const toNext = next ? next.min - cur.min : 0;
  const into = next ? xp - cur.min : 0;
  const pctToNext = next ? Math.min(1, into / toNext) : 1;
  return { cur, next, level, pctToNext, into, toNext };
}

function pVibrate(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {} }

function pConfettiBurst() {
  try {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4000;overflow:hidden';
    const emojis = ['🎉', '✨', '🔥', '💪', '⭐', '🏆', '📈', '💯'];
    for (let i = 0; i < 32; i++) {
      const s = document.createElement('div');
      s.textContent = emojis[i % emojis.length];
      const dur = 1.7 + Math.random() * 1.3, delay = Math.random() * 0.35, size = 16 + Math.random() * 20;
      s.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:-44px;font-size:${size}px;animation:pconfetti ${dur}s ${delay}s ease-in forwards`;
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3400);
  } catch (_) {}
}


function ProspectingToday({ userId, settings, setSettings, systems, completions, setCompletions, timeEntries = [], setTimeEntries, readOnly, lifetimeDone, setLifetimeDone, onGoSystems, onGoLibrary, onGoRoi }) {
  const today = today_ymd();
  const wasPerfectRef = useRef(false);
  const [timeModalSystem, setTimeModalSystem] = useState(null);
  const hourlyRate = Number(settings?.hourly_rate || 0);

  // ── Per-system time tracker (single active timer) ──
  const activeSystemId = settings?.active_timer_system_id || null;
  const activeStartedAt = settings?.active_timer_started_at ? new Date(settings.active_timer_started_at).getTime() : null;
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!activeSystemId) return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [activeSystemId]);
  const runningMs = (activeSystemId && activeStartedAt) ? Math.max(0, nowTick - activeStartedAt) : 0;

  async function setActiveTimer(systemId, startedAtIso) {
    await supabase.from('finance_settings').update({ active_timer_system_id: systemId, active_timer_started_at: startedAtIso }).eq('user_id', userId);
    setSettings(prev => ({ ...prev, active_timer_system_id: systemId, active_timer_started_at: startedAtIso }));
  }
  async function logSegment(systemId, startedAtMs, capMin = 480) {
    const mins = Math.min(capMin, Math.round((Date.now() - startedAtMs) / 60000));
    if (mins >= 1) {
      const { data } = await supabase.from('time_entries').insert({
        user_id: userId, lead_gen_system_id: systemId, minutes: mins, occurred_at: new Date().toISOString(), description: '⏱ Timer',
      }).select().single();
      if (data && setTimeEntries) setTimeEntries(prev => [data, ...prev]);
    }
    return mins;
  }
  async function startTimer(systemId) {
    if (readOnly) return;
    if (activeSystemId && activeStartedAt) await logSegment(activeSystemId, activeStartedAt);
    await setActiveTimer(systemId, new Date().toISOString());
    pVibrate(16);
  }
  async function haltTimer() {
    if (activeSystemId && activeStartedAt) await logSegment(activeSystemId, activeStartedAt);
    await setActiveTimer(null, null);
    pVibrate(8);
  }
  // End-of-day safety: if a timer was left running from a previous day, log & clear on mount.
  useEffect(() => {
    if (!activeSystemId || !activeStartedAt) return;
    const startedYmd = new Date(activeStartedAt).toISOString().slice(0, 10);
    if (startedYmd !== today) { (async () => { await logSegment(activeSystemId, activeStartedAt); await setActiveTimer(null, null); })(); }
    // eslint-disable-next-line
  }, []);

  // Minutes logged today per system (+ live running)
  const todayMinsBySystem = {};
  timeEntries.forEach(te => {
    if (!te.lead_gen_system_id) return;
    if (new Date(te.occurred_at).toISOString().slice(0, 10) !== today) return;
    todayMinsBySystem[te.lead_gen_system_id] = (todayMinsBySystem[te.lead_gen_system_id] || 0) + Number(te.minutes || 0);
  });
  function fmtDur(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  }
  function fmtMins(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Week bounds (Sun–Sat) — tasks accumulate across the whole week, not per day.
  const { weekStartYmd, weekEndYmd } = (() => {
    const n = new Date(); const dow = n.getDay(); // 0=Sun … 6=Sat
    const start = new Date(n); start.setDate(n.getDate() - dow); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { weekStartYmd: start.toISOString().slice(0, 10), weekEndYmd: end.toISOString().slice(0, 10) };
  })();

  const todaysTasks = [];
  systems.forEach(sys => {
    if (sys.is_overhead) return;
    (Array.isArray(sys.daily_tasks) ? sys.daily_tasks : []).forEach(t => {
      const todayRow = completions.find(c => c.system_id === sys.id && c.task_id === t.id && c.date === today);
      // The "(N×/wk)" in the description is the reliable source of the weekly
      // target — the stored weekly_target is null and daily_target is inconsistent.
      const freqMatch = String(t.desc || '').match(/\((\d+)\s*[×x]\s*\/\s*wk\)/i);
      const weeklyTarget = Math.max(1, freqMatch ? parseInt(freqMatch[1], 10) : (Number(t.weekly_target) || Number(t.daily_target) || 1));
      const weeklyCount = completions
        .filter(c => c.system_id === sys.id && c.task_id === t.id && c.date >= weekStartYmd && c.date <= weekEndYmd)
        .reduce((s, c) => s + (c.count_done || 0), 0);
      todaysTasks.push({
        systemId: sys.id, systemName: sys.name, systemColor: sys.color,
        taskId: t.id, desc: t.desc,
        dailyTarget: t.daily_target || 1,
        weeklyTarget, weeklyCount,
        todayCount: todayRow?.count_done || 0,
        completionId: todayRow?.id || null,
      });
    });
  });
  // One line for the ALT-TAB switcher card (phrasing in screenNotes.js).
  useEffect(() => { noteProspecting(userId, todaysTasks); },
    [userId, todaysTasks.length, todaysTasks.map(x => x.todayCount).join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Group tasks by system, preserving systems order
  const taskGroups = [];
  systems.forEach(sys => {
    if (sys.is_overhead) return;
    const items = todaysTasks.filter(t => t.systemId === sys.id);
    if (items.length) taskGroups.push({ id: sys.id, name: sys.name, color: sys.color, items });
  });
  const tasksTotal = todaysTasks.length;
  const tasksDone = todaysTasks.filter(t => t.weeklyCount >= t.weeklyTarget).length;
  const pct = tasksTotal ? tasksDone / tasksTotal : 0;
  const isPerfect = tasksTotal > 0 && tasksDone === tasksTotal;

  // XP & rank (lifetime completed task-instances → XP)
  const xp = (lifetimeDone || 0) * 10 + tasksDone * 10;
  const rk = rankForXp(xp);

  // Handicap (golf-style, lower = better) from 30-day completion rate
  const last30 = completions;
  const sumDone = last30.reduce((s, c) => s + (c.count_done || 0), 0);
  const sumTarget = last30.reduce((s, c) => s + (c.target || 0), 0);
  const rate30 = sumTarget > 0 ? Math.min(1, sumDone / sumTarget) : 0;
  const handicap = (((1 - rate30) * 36)).toFixed(1);

  // This week day-dots (Mon→Sun): which days had ≥1 completion
  const weekDots = (() => {
    const now = new Date(); const dow = now.getDay(); // 0=Sun
    const start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0, 0, 0, 0);
    const daysWith = new Set(last30.filter(c => (c.count_done || 0) >= 1).map(c => c.date));
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      return { label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i], hit: daysWith.has(ymd), isToday: ymd === today, future: d > now };
    });
  })();

  const streak = settings?.current_prospecting_streak || 0;
  const best = settings?.best_prospecting_streak || 0;

  // Weekly hours invested vs the hours/week the agent committed in Blueprint
  const weekStartSunday = (() => { const n = new Date(); const dow = n.getDay(); const m = new Date(n); m.setDate(n.getDate() - dow); m.setHours(0, 0, 0, 0); return m; })();
  const weeklyMin = timeEntries.filter(te => new Date(te.occurred_at) >= weekStartSunday).reduce((s, te) => s + Number(te.minutes || 0), 0) + (activeSystemId ? runningMs / 60000 : 0);
  const weeklyHours = weeklyMin / 60;
  const weeklyTarget = Number(settings?.prospecting_hours_per_week) || 0;
  const weeklyPct = weeklyTarget > 0 ? Math.min(1, weeklyHours / weeklyTarget) : 0;
  const wR = 17, wC = 2 * Math.PI * wR;

  // Earned badges
  const badges = [];
  if (isPerfect) badges.push({ icon: '💯', label: 'Perfect week' });
  if (streak >= 3) badges.push({ icon: '🔥', label: `${streak}-day streak` });
  if (streak >= 7) badges.push({ icon: '⚡', label: 'On fire' });
  if (streak >= 30) badges.push({ icon: '🏆', label: 'Unstoppable' });
  if ((lifetimeDone || 0) >= 100) badges.push({ icon: '🎖️', label: 'Century club' });
  if (Number(handicap) <= 5 && sumTarget > 0) badges.push({ icon: '⛳', label: 'Scratch prospector' });

  const headline = tasksTotal === 0 ? 'No active systems yet'
    : isPerfect ? 'Perfect day — you showed up. 🎉'
    : pct >= 0.75 ? 'So close — finish strong!'
    : pct >= 0.5 ? "Halfway there. Keep the momentum."
    : pct > 0 ? "Good start. Stack the next one."
    : "Let's build today. One call at a time.";

  async function bumpTask(task, dir) {
    if (readOnly) return;
    const newToday = Math.max(0, task.todayCount + dir);
    const willComplete = dir > 0 && (task.weeklyCount + 1 >= task.weeklyTarget) && !(task.weeklyCount >= task.weeklyTarget);
    pVibrate(willComplete ? [0, 30, 30, 60] : dir > 0 ? 16 : 8);
    if (task.completionId) {
      await supabase.from('prospecting_completions').update({ count_done: newToday, completed_at: new Date().toISOString() }).eq('id', task.completionId);
      setCompletions(prev => prev.map(c => c.id === task.completionId ? { ...c, count_done: newToday } : c));
    } else if (dir > 0) {
      const { data } = await supabase.from('prospecting_completions').insert({
        user_id: userId, system_id: task.systemId, task_id: task.taskId, date: today, count_done: newToday, target: task.dailyTarget,
      }).select().single();
      if (data) setCompletions(prev => [data, ...prev]);
    }
    if (setLifetimeDone) setLifetimeDone(n => Math.max(0, (n || 0) + dir));
    await maybeUpdateStreak();
  }

  // One tap = one rep toward the weekly target. When complete, a tap undoes
  // today's most recent rep (can't unwind reps logged on earlier days here).
  function onTaskTap(task) {
    if (readOnly) return;
    const done = task.weeklyCount >= task.weeklyTarget;
    if (!done) bumpTask(task, +1);
    else if (task.todayCount > 0) bumpTask(task, -1);
  }

  // Celebrate the moment the board flips to 100%
  useEffect(() => {
    if (isPerfect && !wasPerfectRef.current) { pConfettiBurst(); pVibrate([0, 40, 40, 40, 40, 120]); }
    wasPerfectRef.current = isPerfect;
  }, [isPerfect]);

  async function maybeUpdateStreak() {
    if (!settings) return;
    const fresh = await supabase.from('prospecting_completions').select('date,count_done').eq('user_id', userId).gte('count_done', 1).order('date', { ascending: false }).limit(120);
    const freshDates = new Set((fresh.data || []).map(r => r.date));
    let s = 0; const cursor = new Date();
    while (true) {
      const ymd = cursor.toISOString().slice(0, 10);
      if (freshDates.has(ymd)) { s++; cursor.setDate(cursor.getDate() - 1); }
      else if (s === 0 && ymd === today_ymd()) { cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    const newBest = Math.max(s, settings.best_prospecting_streak || 0);
    if (s !== settings.current_prospecting_streak || newBest !== settings.best_prospecting_streak) {
      await supabase.from('finance_settings').update({ current_prospecting_streak: s, best_prospecting_streak: newBest, last_prospecting_date: s > 0 ? today_ymd() : settings.last_prospecting_date }).eq('user_id', userId);
      setSettings(prev => ({ ...prev, current_prospecting_streak: s, best_prospecting_streak: newBest, last_prospecting_date: s > 0 ? today_ymd() : prev.last_prospecting_date }));
    }
  }

  // Progress ring geometry
  const R = 44, C = 2 * Math.PI * R, ringColor = isPerfect ? 'var(--green)' : 'var(--accent)';

  // Shared KPI-tile styling so the stat row reads as one clean, aligned system.
  const tile = { background: 'var(--bg-base)', borderRadius: '12px', padding: '12px', border: '1px solid var(--border)', minWidth: 0 };
  const tileLabel = { fontSize: '9.5px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const tileNum = { fontSize: '24px', fontWeight: 300, fontFamily: 'Fraunces, serif', letterSpacing: '-0.01em', color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginTop: '4px' };
  const tileUnit = { fontSize: '10px', color: 'var(--text-3)', fontWeight: 600 };
  const tileSub = { fontSize: '9px', color: 'var(--text-3)', marginTop: '3px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* ── Gamified hero ── */}
      <div className="panel" style={{ padding: '18px', background: isPerfect ? 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02))' : 'linear-gradient(135deg, rgba(197,169,94,0.08), rgba(197,169,94,0.01))', border: `1px solid ${isPerfect ? 'rgba(34,197,94,0.4)' : 'var(--border)'}` }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'nowrap' }}>
          {/* Ring */}
          <div style={{ position: 'relative', width: '104px', height: '104px', flexShrink: 0 }}>
            <svg width="104" height="104" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="52" cy="52" r={R} fill="none" stroke="var(--bg-base)" strokeWidth="10" />
              <circle cx="52" cy="52" r={R} fill="none" stroke={ringColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '25px', fontWeight: 800, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{Math.round(pct * 100)}%</div>
              <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '2px' }}>{tasksDone}/{tasksTotal} done</div>
            </div>
          </div>
          {/* Rank + headline — upper-right */}
          <div style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '18px' }}>{rk.cur.icon}</span>
              <span style={{ fontSize: '15px', fontWeight: 800, color: rk.cur.color }}>{rk.cur.name}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-base)', borderRadius: '999px', padding: '2px 8px', fontWeight: 700 }}>LVL {rk.level}</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.35 }}>{headline}</div>
            {/* XP bar to next rank — anchored to bottom of the column */}
            <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-3)', marginBottom: '3px' }}>
                <span>{xp.toLocaleString()} XP</span>
                <span style={{ textAlign: 'right' }}>{rk.next ? `${rk.into}/${rk.toNext} → ${rk.next.name}` : 'Max rank 👑'}</span>
              </div>
              <div style={{ height: '7px', background: 'var(--bg-base)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${rk.pctToNext * 100}%`, height: '100%', background: `linear-gradient(90deg, ${rk.cur.color}, var(--accent))`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          </div>
        </div>

        {/* KPI tiles — three equal, aligned stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '16px' }}>
          <div style={tile}>
            <div style={{ ...tileLabel, display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name="flame" size={11} /> Streak</div>
            <div style={{ ...tileNum, color: streak > 0 ? '#ef4444' : 'var(--text-3)' }}>{streak}<span style={tileUnit}> day{streak === 1 ? '' : 's'}</span></div>
            <div style={tileSub}>best {best}</div>
          </div>
          <div style={tile} title="Prospecting handicap — like golf, lower is better. Improves as your 30-day completion rate climbs. 0.0 = scratch (perfect).">
            <div style={tileLabel}>⛳ Handicap</div>
            <div style={{ ...tileNum, color: Number(handicap) <= 8 ? 'var(--green)' : Number(handicap) <= 18 ? 'var(--accent)' : 'var(--text-2)' }}>{handicap}</div>
            <div style={tileSub}>{Math.round(rate30 * 100)}% · 30d</div>
          </div>
          <div style={tile} title="Hours you've tracked this week vs the hours/week you committed in Blueprint.">
            <div style={{ ...tileLabel, display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name="clock" size={11} /> Hours/wk</div>
            <div style={tileNum}>{weeklyHours.toFixed(1)}<span style={tileUnit}>{weeklyTarget > 0 ? ` / ${weeklyTarget}h` : 'h'}</span></div>
            {weeklyTarget > 0 ? (
              <div style={{ height: '4px', background: 'var(--bg-hover)', borderRadius: '3px', overflow: 'hidden', marginTop: '7px' }}>
                <div style={{ width: `${Math.min(weeklyPct, 1) * 100}%`, height: '100%', background: weeklyPct >= 1 ? 'var(--green)' : 'var(--accent)', transition: 'width 0.6s ease' }} />
              </div>
            ) : <div style={tileSub}>set in Blueprint</div>}
          </div>
        </div>

        {/* This week — full-width tracker so the seven days breathe */}
        <div style={{ ...tile, marginTop: '8px' }}>
          <div style={{ ...tileLabel, marginBottom: '9px', display:'inline-flex', alignItems:'center', gap:'5px' }}><Icon name="calendar" size={12} /> This week</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {weekDots.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ width: '100%', aspectRatio: '1', maxWidth: '30px', margin: '0 auto', borderRadius: '50%',
                  background: d.hit ? 'var(--green)' : d.future ? 'transparent' : 'var(--bg-hover)',
                  border: d.isToday ? '2px solid var(--accent)' : d.future ? '1px dashed var(--border)' : '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: d.hit ? '#fff' : 'var(--text-3)', fontSize: '12px', fontWeight: 700 }}>
                  {d.hit ? '✓' : ''}
                </div>
                <div style={{ fontSize: '9px', color: d.isToday ? 'var(--accent)' : 'var(--text-3)', marginTop: '4px', fontWeight: d.isToday ? 700 : 400 }}>{d.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }}>
            {badges.map((b, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: 'var(--text-1)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '999px', padding: '3px 9px' }}>{b.icon} {b.label}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Task board (grouped by system, each with its own timer) ── */}
      <div className="panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Today's prospecting</span>
          {tasksTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-3)', display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name="clock" size={11} /> {fmtMins(Object.values(todayMinsBySystem).reduce((a, b) => a + b, 0) + (activeSystemId ? runningMs / 60000 : 0))} today</span>
              <button onClick={onGoRoi} style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>ROI →</button>
            </div>
          )}
        </div>
        {tasksTotal === 0 ? (
          <div style={{ padding: '20px', background: 'var(--bg-base)', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ marginBottom: '8px', display:'flex', justifyContent:'center' }}><Icon name="target" size={30} style={{ color:'var(--text-3)' }} /></div>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.5 }}>No active prospecting systems yet. Activate one to get your daily money-making checklist — calls, notes, social, referrals.</p>
            {!readOnly && <button className="btn btn-primary btn-sm" onClick={onGoLibrary} style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}><Icon name="library" size={14} /> Open the System Library →</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {taskGroups.map(group => {
              const isRunning = activeSystemId === group.id;
              const loggedMin = todayMinsBySystem[group.id] || 0;
              const liveMin = loggedMin + (isRunning ? runningMs / 60000 : 0);
              const timeValue = (liveMin / 60) * hourlyRate;
              const gDone = group.items.filter(t => t.weeklyCount >= t.weeklyTarget).length;
              return (
                <div key={group.id} style={{ background: 'var(--bg-base)', borderRadius: '12px', border: `1px solid ${isRunning ? group.color : 'var(--border)'}`, overflow: 'hidden', boxShadow: isRunning ? `0 0 0 1px ${group.color}55` : 'none' }}>
                  {/* System header + timer */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', borderLeft: `4px solid ${group.color}`, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '120px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-1)' }}>{group.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '1px' }}>
                        {gDone}/{group.items.length} done ·{' '}
                        <button onClick={() => setTimeModalSystem(group)} title="Edit logged time"
                          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-2)', cursor: 'pointer', fontSize: '10px', fontWeight: 600, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}>
                          <Icon name="clock" size={12} /> {fmtMins(liveMin)}{hourlyRate > 0 && ` · $${Math.round(timeValue)}`} ✎
                        </button>
                      </div>
                    </div>
                    {!readOnly && (
                      isRunning ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: group.color, fontVariantNumeric: 'tabular-nums', minWidth: '56px', textAlign: 'right' }}>{fmtDur(runningMs)}</span>
                          <button onClick={haltTimer} title="Pause" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '30px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--yellow)', cursor: 'pointer', fontSize: '13px' }}>⏸</button>
                          <button onClick={haltTimer} title="Stop" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '30px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--red)', cursor: 'pointer', fontSize: '13px' }}>⏹</button>
                        </div>
                      ) : (
                        <button onClick={() => startTimer(group.id)} title="Start timer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '999px', border: `1px solid ${group.color}`, background: `${group.color}1a`, color: group.color, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
                          ▶ Start
                        </button>
                      )
                    )}
                  </div>
                  {/* Tasks */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px' }}>
                    {group.items.map(t => {
                      const done = t.weeklyCount >= t.weeklyTarget;
                      const multi = true; // always show a progress line for consistency
                      const pctW = Math.min(1, t.weeklyCount / t.weeklyTarget);
                      return (
                        <button key={`${t.systemId}-${t.taskId}`} onClick={() => onTaskTap(t)} disabled={readOnly}
                          style={{ display: 'flex', alignItems: multi ? 'flex-start' : 'center', gap: '11px', padding: '10px 11px', width: '100%',
                            background: done ? 'rgba(34,197,94,0.08)' : 'var(--bg-card)',
                            border: `1px solid ${done ? 'rgba(34,197,94,0.32)' : 'var(--border)'}`,
                            borderRadius: '9px', textAlign: 'left', cursor: readOnly ? 'default' : 'pointer', opacity: readOnly ? 0.7 : 1, transition: 'all 0.15s' }}>
                          <div style={{ width: '22px', height: '22px', borderRadius: '6px', marginTop: multi ? '1px' : 0,
                            background: done ? 'var(--green)' : (multi && t.weeklyCount > 0 ? 'rgba(197,169,94,0.15)' : 'transparent'),
                            border: `2px solid ${done ? 'var(--green)' : (multi && t.weeklyCount > 0 ? 'var(--accent)' : 'var(--text-3)')}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: done ? '#fff' : 'var(--accent)', fontSize: '12px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                            {done ? '✓' : (multi && t.weeklyCount > 0 ? t.weeklyCount : '')}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', color: done ? 'var(--text-3)' : 'var(--text-1)', textDecoration: done ? 'line-through' : 'none', fontWeight: 500, lineHeight: 1.35 }}>{t.desc}</div>
                            {multi && (
                              <div style={{ marginTop: '7px' }}>
                                <div style={{ height: '5px', background: 'var(--bg-hover)', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{ width: `${pctW * 100}%`, height: '100%', background: done ? 'var(--green)' : 'var(--accent)', borderRadius: '3px', transition: 'width 0.45s cubic-bezier(0.4,0,0.2,1)' }} />
                                </div>
                                <div style={{ fontSize: '9.5px', color: done ? 'var(--green)' : 'var(--text-3)', marginTop: '4px', fontWeight: 700, letterSpacing: '0.02em' }}>
                                  {done ? '✓ Done this week' : `${t.weeklyCount} of ${t.weeklyTarget} this week`}
                                </div>
                              </div>
                            )}
                          </div>
                          <span style={{ fontSize: '10px', color: done ? 'var(--green)' : 'var(--text-3)', fontWeight: 700, flexShrink: 0, marginTop: multi ? '1px' : 0 }}>+{t.weeklyTarget * 10}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {timeModalSystem && (
        <TimeLogModal system={timeModalSystem} userId={userId}
          timeEntries={timeEntries} setTimeEntries={setTimeEntries}
          hourlyRate={hourlyRate} onClose={() => setTimeModalSystem(null)} />
      )}
    </div>
  );
}

// ─── TimeLogModal — view / edit / delete / add today's time for one system ───

function TimeLogModal({ system, userId, timeEntries, setTimeEntries, hourlyRate, onClose }) {

  useBackClose(onClose);
  const today = today_ymd();
  const [addMin, setAddMin] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = timeEntries
    .filter(te => te.lead_gen_system_id === system.id && new Date(te.occurred_at).toISOString().slice(0, 10) === today)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const totalMin = rows.reduce((s, r) => s + Number(r.minutes || 0), 0);

  async function addManual() {
    const m = Math.round(Number(addMin) || 0);
    if (m < 1) return;
    setBusy(true);
    const { data } = await supabase.from('time_entries').insert({
      user_id: userId, lead_gen_system_id: system.id, minutes: m, occurred_at: new Date().toISOString(), description: '✎ Manual',
    }).select().single();
    if (data) setTimeEntries(prev => [data, ...prev]);
    setAddMin(''); setBusy(false);
  }
  async function updateEntry(id, m) {
    const mins = Math.max(0, Math.round(Number(m) || 0));
    setTimeEntries(prev => prev.map(e => e.id === id ? { ...e, minutes: mins } : e));
    await supabase.from('time_entries').update({ minutes: mins }).eq('id', id);
  }
  async function deleteEntry(id) {
    setTimeEntries(prev => prev.filter(e => e.id !== id));
    await supabase.from('time_entries').delete().eq('id', id);
  }
  const fmtClock = (iso) => { const d = new Date(iso); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: system.color, flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{system.name}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-3)', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '14px' }}>
          Today's time · {Math.floor(totalMin / 60) > 0 ? `${Math.floor(totalMin / 60)}h ` : ''}{totalMin % 60}m{hourlyRate > 0 && ` · ${fmtUSD((totalMin / 60) * hourlyRate)} value`}
        </div>

        {/* Add manual */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <input type="number" inputMode="numeric" placeholder="Minutes" value={addMin} onChange={e => setAddMin(e.target.value)}
            style={{ flex: 1, padding: '9px 11px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-1)', fontSize: '13px' }} />
          <button onClick={addManual} disabled={busy || !addMin}
            style={{ padding: '9px 16px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: (busy || !addMin) ? 0.5 : 1, whiteSpace: 'nowrap' }}>+ Add time</button>
        </div>

        {/* Entries */}
        {rows.length === 0 ? (
          <p style={{ fontSize: '12px', color: 'var(--text-3)', textAlign: 'center', padding: '20px', fontStyle: 'italic' }}>No time logged for this system today. Start a timer or add minutes above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 10px', background: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '13px', flexShrink: 0 }}>{r.description?.startsWith('<Icon name="clock" size={12} />') ? '⏱' : '<Icon name="edit" size={11} />'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>{fmtClock(r.occurred_at)} · {r.description?.startsWith('<Icon name="clock" size={11} />') ? 'Timer' : 'Manual'}</div>
                </div>
                <input type="number" inputMode="numeric" defaultValue={r.minutes}
                  onBlur={e => { const v = Number(e.target.value); if (v !== Number(r.minutes)) updateEntry(r.id, v); }}
                  style={{ width: '58px', padding: '5px 6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-1)', fontSize: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>min</span>
                <button onClick={() => deleteEntry(r.id)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: '15px', cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sparkline — tiny inline SVG line chart ───

function Sparkline({ values, color = 'var(--accent)', w = 132, h = 30 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const range = (max - min) || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = (h - pad) - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  const last = pts[pts.length - 1];
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
      <text x={pad} y={h - 1} fontSize="8" fill="var(--text-3)">8wk</text>
      <text x={w - pad} y={10} fontSize="8" fill={rising ? 'var(--green)' : 'var(--text-3)'} textAnchor="end">{rising ? '▲' : '▼'}</text>
    </svg>
  );
}

// ─── ProspectingROI — the true-ROI matrix (cash + time value vs income) ───

function ProspectingROI({ systems, transactions, timeEntries, completions, settings, onGoSystems }) {
  const hourly = Number(settings?.hourly_rate || 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const todayY = today_ymd();

  function stat(sys) {
    const sysTx = transactions.filter(t => t.lead_gen_system_id === sys.id && t.scope === 'business' && new Date(t.date) >= yearStart);
    const cash = Math.abs(sysTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0));
    const income = sysTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const teRows = timeEntries.filter(te => te.lead_gen_system_id === sys.id);
    const minutes = teRows.reduce((s, te) => s + Number(te.minutes || 0), 0);
    const minsToday = teRows.filter(te => new Date(te.occurred_at).toISOString().slice(0, 10) === todayY).reduce((s, te) => s + Number(te.minutes || 0), 0);
    const timeCost = (minutes / 60) * hourly;
    const invested = cash + timeCost;
    const roi = invested > 0 ? income / invested : null;
    return { cash, income, minutes, minsToday, timeCost, invested, roi };
  }
  function statusFor(st) {
    if (st.invested === 0) return { label: 'No data', color: 'var(--text-3)', icon: '❓' };
    if (st.roi === null || st.income === 0) return { label: 'Awaiting files', color: 'var(--text-3)', icon: '⏳' };
    if (st.roi >= 3) return { label: 'Strong', color: 'var(--green)', icon: '🔥' };
    if (st.roi >= 1) return { label: 'Profitable', color: 'var(--accent)', icon: '✓' };
    return { label: 'Underwater', color: 'var(--red)', icon: '⚠' };
  }
  function grade(roi) {
    if (roi === null) return { g: '—', c: 'var(--text-3)' };
    if (roi >= 5) return { g: 'A+', c: 'var(--green)' };
    if (roi >= 3) return { g: 'A', c: 'var(--green)' };
    if (roi >= 2) return { g: 'B', c: '#84cc16' };
    if (roi >= 1) return { g: 'C', c: 'var(--yellow)' };
    if (roi >= 0.5) return { g: 'D', c: '#f59e0b' };
    return { g: 'F', c: 'var(--red)' };
  }
  const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

  // 8-week cumulative true-ROI trend for the sparkline.
  function roiSeries(sys) {
    const sysTx = transactions.filter(t => t.lead_gen_system_id === sys.id && t.scope === 'business' && new Date(t.date) >= yearStart);
    const sysTe = timeEntries.filter(te => te.lead_gen_system_id === sys.id);
    const out = [];
    const now = new Date();
    for (let wk = 7; wk >= 0; wk--) {
      const cutoff = new Date(now); cutoff.setDate(now.getDate() - wk * 7); cutoff.setHours(23, 59, 59, 999);
      const cash = Math.abs(sysTx.filter(t => Number(t.amount) < 0 && new Date(t.date) <= cutoff).reduce((s, t) => s + Number(t.amount), 0));
      const income = sysTx.filter(t => Number(t.amount) > 0 && new Date(t.date) <= cutoff).reduce((s, t) => s + Number(t.amount), 0);
      const mins = sysTe.filter(te => new Date(te.occurred_at) <= cutoff).reduce((s, te) => s + Number(te.minutes || 0), 0);
      const invested = cash + (mins / 60) * hourly;
      out.push(invested > 0 ? income / invested : 0);
    }
    return out;
  }

  const rows = systems.filter(s => !s.is_overhead).map(s => ({ sys: s, st: stat(s) }));
  const totalCash = rows.reduce((a, r) => a + r.st.cash, 0);
  const totalTime = rows.reduce((a, r) => a + r.st.timeCost, 0);
  const totalInvested = rows.reduce((a, r) => a + r.st.invested, 0);
  const totalIncome = rows.reduce((a, r) => a + r.st.income, 0);
  const totalMin = rows.reduce((a, r) => a + r.st.minutes, 0);
  const totalMinToday = rows.reduce((a, r) => a + r.st.minsToday, 0);
  const blended = totalInvested > 0 ? totalIncome / totalInvested : null;
  const gr = grade(blended);
  const net = totalIncome - totalInvested;

  // Leaderboard: rank by ROI (entries with data first)
  const ranked = [...rows].sort((a, b) => {
    const ra = a.st.roi, rb = b.st.roi;
    if (ra === null && rb === null) return b.st.invested - a.st.invested;
    if (ra === null) return 1; if (rb === null) return -1;
    return rb - ra;
  });
  const medals = ['🥇', '🥈', '🥉'];
  const maxRoi = Math.max(1, ...rows.map(r => r.st.roi || 0));

  if (rows.length === 0) {
    return (
      <div className="panel" style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏆</div>
        <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '0 0 12px' }}>No active systems to measure yet. Activate a system, log some time and expenses, and your ROI scoreboard fills in here.</p>
        <button className="btn btn-primary btn-sm" onClick={onGoSystems} style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}><Icon name="systems" size={14} /> Go to Manage</button>
      </div>
    );
  }

  const Metric = ({ label, value, color }) => (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: '8.5px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 300, fontFamily: 'Fraunces, serif', letterSpacing: '-0.01em', color: color || 'var(--text-1)', fontVariantNumeric: 'tabular-nums', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Portfolio hero */}
      <div className="panel" style={{ padding: '18px', background: 'linear-gradient(135deg, rgba(197,169,94,0.08), rgba(197,169,94,0.01))' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'nowrap' }}>
          <div style={{ width: '92px', height: '92px', borderRadius: '50%', background: 'var(--bg-base)', border: `3px solid ${gr.c}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: '30px', fontWeight: 800, color: gr.c, lineHeight: 1 }}>{gr.g}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grade</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Blended true ROI</div>
            <div style={{ fontSize: '30px', fontWeight: 800, color: gr.c, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{blended === null ? '—' : `${blended.toFixed(2)}×`}</div>
            <div style={{ fontSize: '11px', color: net >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: '2px' }}>
              {net >= 0 ? '▲' : '▼'} {fmtUSD(Math.abs(net))} net {net >= 0 ? 'gain' : 'loss'} YTD
            </div>
            <div style={{ height: '7px', background: 'var(--bg-base)', borderRadius: '4px', overflow: 'hidden', marginTop: '8px' }}>
              <div style={{ width: `${Math.min(1, (blended || 0) / 5) * 100}%`, height: '100%', background: gr.c, transition: 'width 0.6s ease' }} />
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '3px' }}>scale: 0 → 5× ROI</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '14px' }}>
          {[
            { l: 'Cash spent', v: fmtUSD(totalCash), c: 'var(--red)' },
            { l: 'Time value', v: fmtUSD(totalTime), c: '#f59e0b' },
            { l: 'Invested', v: fmtUSD(totalInvested), c: 'var(--text-1)' },
            { l: 'Income', v: fmtUSD(totalIncome), c: 'var(--green)' },
          ].map((k, i) => (
            <div key={i} style={{ background: 'var(--bg-base)', borderRadius: '10px', padding: '9px 6px', textAlign: 'center', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '8.5px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 700, lineHeight: 1.25, minHeight: '21px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{k.l}</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: k.c, fontVariantNumeric: 'tabular-nums', marginTop: '3px' }}>{k.v}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name="clock" size={11} /> {fmtH(totalMin)} logged YTD{hourly > 0 ? ` @ ${fmtUSD(hourly)}/hr` : ''}</span>
          {totalMinToday > 0 && <span style={{ color: 'var(--accent)' }}>· {fmtH(totalMinToday)} today</span>}
          {hourly === 0 && <span style={{ color: 'var(--yellow)' }}>· Set your hourly rate in Finance → Blueprint to value your time</span>}
        </div>
      </div>

      {/* Leaderboard matrix */}
      <div className="panel" style={{ padding: '14px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '12px' }}>🏆 ROI scoreboard · ranked by return</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ranked.map((r, i) => {
            const st = r.st, sb = statusFor(st);
            const hasData = st.roi !== null;
            return (
              <div key={r.sys.id} style={{ background: 'var(--bg-base)', borderRadius: '10px', border: `1px solid ${i === 0 && hasData ? 'var(--accent)' : 'var(--border)'}`, borderLeft: `4px solid ${r.sys.color}`, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', width: '22px', textAlign: 'center', flexShrink: 0 }}>{hasData && i < 3 ? medals[i] : <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700 }}>#{i + 1}</span>}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sys.name}</div>
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: sb.color, background: `${sb.color}1a`, border: `1px solid ${sb.color}55`, borderRadius: '999px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{sb.icon} {sb.label}</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: sb.color, fontVariantNumeric: 'tabular-nums', minWidth: '52px', textAlign: 'right', flexShrink: 0 }}>{hasData ? `${st.roi.toFixed(1)}×` : '—'}</span>
                </div>
                {/* ROI bar */}
                <div style={{ height: '5px', background: 'var(--bg-card)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ width: `${Math.min(1, (st.roi || 0) / maxRoi) * 100}%`, height: '100%', background: sb.color, transition: 'width 0.5s ease' }} />
                </div>
                {/* Metric matrix — four even columns, full width so labels never collide */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', alignItems: 'end' }}>
                  <Metric label="Cash" value={fmtUSD(st.cash)} color="var(--red)" />
                  <Metric label={`Time (${fmtH(st.minutes)})`} value={fmtUSD(st.timeCost)} color="#f59e0b" />
                  <Metric label="Invested" value={fmtUSD(st.invested)} />
                  <Metric label="Income" value={fmtUSD(st.income)} color="var(--green)" />
                </div>
                {st.invested > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '9px', paddingTop: '9px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, flexShrink: 0 }}>8-wk trend</span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                      <Sparkline values={roiSeries(r.sys)} color={sb.color} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '10px', lineHeight: 1.5, fontStyle: 'italic' }}>
          True ROI = income ÷ (cash spent + value of your time). Time value uses your hourly rate, so a "cheap" system that eats your hours shows its real cost.
        </div>
      </div>
    </div>
  );
}


function ProspectingView({ userId, initialSub = null, subNonce = 0, barDriven = false }) {
  const [sub, setSub] = useState('today');
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub, subNonce]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [systems, setSystems] = useState([]);
  const [archivedSystems, setArchivedSystems] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [lifetimeDone, setLifetimeDone] = useState(0);
  const [activatingTemplate, setActivatingTemplate] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const [s, sys, arch, comp, tmpl, tx, te, life] = await Promise.all([
      supabase.from('finance_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('lead_gen_systems').select('*').eq('user_id', userId).eq('is_archived', false).order('is_overhead', { ascending: false }).order('name'),
      supabase.from('lead_gen_systems').select('*').eq('user_id', userId).eq('is_archived', true).order('archived_at', { ascending: false }),
      supabase.from('prospecting_completions').select('*').eq('user_id', userId).gte('date', last30.toISOString().slice(0, 10)).order('date', { ascending: false }),
      supabase.from('lead_gen_system_templates').select('*').order('system_number'),
      supabase.from('transactions').select('*').eq('user_id', userId).eq('is_archived', false).gte('date', yearStart).order('date', { ascending: false }).limit(500),
      supabase.from('time_entries').select('*').eq('user_id', userId).gte('occurred_at', yearStart),
      supabase.from('prospecting_completions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('count_done', 1),
    ]);
    setSettings(s.data); setSystems(sys.data || []); setArchivedSystems(arch.data || []); setCompletions(comp.data || []);
    setTemplates(tmpl.data || []); setTransactions(tx.data || []); setTimeEntries(te.data || []);
    setLifetimeDone(life.count || 0);
    setLoading(false);
  }, [userId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const userMode = settings?.user_mode || 'agent';
  const readOnly = userMode === 'partner';
  const isCoach = userMode === 'coach';
  const maxSystems = settings?.max_systems_allowed || 5;
  const activeNonOverhead = systems.filter(s => !s.is_overhead && s.is_active);
  const activeNames = new Set(activeNonOverhead.map(s => s.name.toLowerCase()));
  const atCap = activeNonOverhead.length >= maxSystems && !isCoach;
  const streak = settings?.current_prospecting_streak || 0;

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  const TABS = [
    { id: 'today', label: 'Today', iconName: 'zap' },
    { id: 'roi', label: 'ROI', iconName: 'chart' },
    { id: 'library', label: 'Library', iconName: 'library' },
    { id: 'systems', label: 'Manage', iconName: 'systems' },
  ];

  return (
    <div className="ww-prism" style={{ display: 'flex', flexDirection: 'column', gap: '14px', background:'radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09', minHeight:'100%' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '30px', fontWeight: 300, fontFamily: 'Fraunces, serif', letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}><Icon name="prospecting" size={24} style={{color:'var(--accent)',flexShrink:0}} />Prospecting</h2>
          {streak > 0 && <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}>🔥 {streak}-day streak</span>}
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{activeNonOverhead.length}/{maxSystems} systems active</span>
          {/* When the room bar carries Today / Systems / ROI, the pill row below
              would be a second tab strip saying the same three words on the same
              screen. Hide it and keep Manage — the one section the bar does not
              carry — reachable right here. */}
          {barDriven && (
            <button onClick={() => setSub(sub === 'systems' ? 'today' : 'systems')}
              style={{ padding: '3px 11px', borderRadius: 999, fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${sub === 'systems' ? 'var(--accent)' : 'var(--border)'}`,
                background: sub === 'systems' ? 'var(--accent)' : 'transparent',
                color: sub === 'systems' ? 'var(--bg-base)' : 'var(--text-2)' }}>
              {sub === 'systems' ? 'Done' : 'Manage'}
            </button>
          )}
          </span>
        </div>
        <div style={{ display: barDriven ? 'none' : 'flex', gap: '6px', paddingBottom: '2px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)}
              style={{ flex: '1 1 0', minWidth: 0, padding: '8px 6px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap', cursor: 'pointer',
                border: `1px solid ${sub === t.id ? 'var(--accent)' : 'var(--border)'}`,
                background: sub === t.id ? 'var(--accent)' : 'var(--bg-card)', color: sub === t.id ? 'var(--bg-base)' : 'var(--text-2)', transition: 'all 0.15s' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}><Icon name={t.iconName} size={13} /> {t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Tip id="systems" label="One system, 90 days">A "system" is a <b>repeatable daily action</b> — calls, notes, pop-bys. Working <b>one</b> consistently for 90 days beats dabbling in five. Prism tracks your streak because the <b>habit</b>, not the heroics, is what fills a pipeline.</Tip>
      {sub === 'today' && (
        <ProspectingToday userId={userId} settings={settings} setSettings={setSettings}
          systems={systems.filter(s => s.is_active)} completions={completions} setCompletions={setCompletions}
          timeEntries={timeEntries} setTimeEntries={setTimeEntries}
          readOnly={readOnly} lifetimeDone={lifetimeDone} setLifetimeDone={setLifetimeDone}
          onGoSystems={() => setSub('systems')} onGoLibrary={() => setSub('library')} onGoRoi={() => setSub('roi')} />
      )}
      {sub === 'systems' && (
        <FinanceSystems userId={userId} systems={systems} archivedSystems={archivedSystems} reload={loadAll}
          transactions={transactions} completions={completions} timeEntries={timeEntries}
          templates={templates} settings={settings} readOnly={readOnly} isCoach={isCoach} maxSystems={maxSystems} />
      )}
      {sub === 'roi' && (
        <ProspectingROI systems={systems} transactions={transactions} timeEntries={timeEntries}
          completions={completions} settings={settings} onGoSystems={() => setSub('systems')} />
      )}
      {sub === 'library' && (
        <TemplateLibraryModal asPage templates={templates || []} activeNames={activeNames}
          atCap={atCap} maxSystems={maxSystems} isCoach={isCoach}
          onClose={() => setSub('systems')} onPick={(t) => setActivatingTemplate(t)} />
      )}
      {activatingTemplate && (
        <TemplateActivateModal userId={userId} template={activatingTemplate}
          onClose={() => setActivatingTemplate(null)}
          onActivated={() => { setActivatingTemplate(null); loadAll(); }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DAILY JOURNAL — a living, timestamped daily log. Typed or voice entries get
// auto-transcribed, AI-linked to the real people/properties/projects/files you
// mention (high-confidence auto, the rest you confirm), surface action items as
// one-tap tasks, roll up into an end-of-day recap, and are semantically
// searchable across every day. Confirmed links also appear on each record's card.
// ═══════════════════════════════════════════════════════════════════════


export default ProspectingView;
