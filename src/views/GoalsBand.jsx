import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { calm } from '../calm';

// ── GOALS FOR THE DAY (4 Oct 2026) ──────────────────────────────────────────
// Dara: "the ability to look at all the outstanding things and pick 3 things
// from the back log or current items to schedule as Goals for the Day."
//
// Where they live: the top of Today, under the greeting and the next
// appointment, ABOVE everything inbound. Every coaching school puts the agent's
// own agenda before the inbox; this screen now does too.
//
// The rules (design brief, decisions 7 and 8; the research behind them is in
// the report "Behavior tuned daily work design"):
//   • The person chooses. PrismOS offers a short list and never picks.
//   • Their own words. A task can be rewritten into the result it is for.
//   • Three by default, one to five. Never presented as science.
//   • An optional "when — and if not, then" line: the best-supported planning
//     technique there is (implementation intentions).
//   • Contract deadlines sit in their own band above, and never count as goals.
//   • The end of the day shows what got done FIRST; each goal left open gets one
//     quiet choice. No score, no "2 of 3", no streak — ever.
//   • Only the person sees them (row-level security; no staff policy exists).
// Schema and helpers: supabase/sql/2026-10-04d_goals_for_the_day.sql.

const WORD = ['', 'one', 'two', 'three', 'four', 'five'];
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = (ymd) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const say = (m, kind) => { if (window.__notify) window.__notify(m, kind || 'error'); };

export default function GoalsBand({ userId, tasks = [], setTasks, events = [], setView, firstName = '', compact = false }) {
  // compact (the Tasks screen): today's goals only — no welcome, no contract dates, no evening prompt.
  const today = todayNY();
  const tomorrow = addDays(today, 1);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1;

  const [rows, setRows] = useState(null);          // today's and tomorrow's goals
  const [n, setN] = useState(3);
  const [deadlines, setDeadlines] = useState([]);
  const [rolled, setRolled] = useState(false);     // goals have rolled forward several days running
  const [away, setAway] = useState(false);         // back after a week or more
  const [picking, setPicking] = useState(null);    // null | 'today' | 'tomorrow'
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [g, d, s, r] = await Promise.all([
      supabase.from('day_goals').select('*').eq('user_id', userId).in('day', [today, tomorrow]).order('pos').order('created_at'),
      supabase.rpc('my_contract_deadlines', { p_days: 7 }),
      supabase.from('user_settings').select('daily_goal_count,last_open_at').eq('user_id', userId).maybeSingle(),
      supabase.from('day_goals').select('day').eq('user_id', userId).eq('outcome', 'tomorrow').gte('day', addDays(today, -4)).lt('day', today),
    ]);
    if (g.error) { setRows([]); return; }
    setRows(g.data || []);
    setDeadlines(Array.isArray(d.data) ? d.data : []);
    if (s.data?.daily_goal_count) setN(s.data.daily_goal_count);
    setRolled(new Set((r.data || []).map(x => x.day)).size >= 3);
    return s.data || null;
  }, [userId, today, tomorrow]);

  // Once per visit: note the visit (so a week away can be met with a welcome,
  // never a backlog), having first read when the last one was.
  useEffect(() => {
    let go = true;
    (async () => {
      const s = await load();
      if (!go || !userId) return;
      const last = s?.last_open_at ? Date.parse(s.last_open_at) : null;
      if (last && Date.now() - last > 7 * 864e5) setAway(true);
      if (!compact && (!last || Date.now() - last > 36e5)) {
        const { error } = await supabase.from('user_settings').upsert({ user_id: userId, last_open_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) console.warn('last_open_at:', error.message);
      }
    })();
    return () => { go = false; };
  }, [load, userId]);

  // The queue's nudge ("Choose what really happens today") opens the picker.
  useEffect(() => {
    const open = () => { if (compact) return; setPicking('today'); try { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} };
    window.addEventListener('prism:open-goals', open);
    return () => window.removeEventListener('prism:open-goals', open);
  }, []);

  const taskById = useMemo(() => new Map((tasks || []).map(t => [t.id, t])), [tasks]);
  const isDone = useCallback((g) => !!g.done_at || !!(g.task_id && taskById.get(g.task_id)?.completed), [taskById]);
  if (!userId || rows === null) return null;

  const mine = rows.filter(g => g.day === today);
  const next = rows.filter(g => g.day === tomorrow);
  const patch = (id, f) => setRows(rs => rs.map(g => g.id === id ? { ...g, ...f } : g));

  const toggle = async (g) => {
    const done = !isDone(g);
    const done_at = done ? new Date().toISOString() : null;
    const { error } = await supabase.from('day_goals').update({ done_at }).eq('id', g.id);
    if (error) { say('Could not save that: ' + error.message); return; }
    patch(g.id, { done_at });
    if (g.task_id && taskById.has(g.task_id)) {
      const { error: tErr } = await supabase.from('tasks').update({ completed: done, completed_at: done_at }).eq('id', g.task_id);
      if (tErr) { say('The goal is saved, but the task could not be updated: ' + tErr.message); return; }
      setTasks && setTasks(prev => prev.map(t => t.id === g.task_id ? { ...t, completed: done, completed_at: done_at } : t));
      try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
    }
  };
  const confirmAll = async () => {
    const at = new Date().toISOString();
    const { error } = await supabase.from('day_goals').update({ confirmed_at: at }).eq('user_id', userId).eq('day', today).is('confirmed_at', null);
    if (error) { say('Could not save that: ' + error.message); return; }
    setRows(rs => rs.map(g => g.day === today ? { ...g, confirmed_at: g.confirmed_at || at } : g));
  };

  const chosenLastNight = mine.length > 0 && mine.every(g => !g.confirmed_at && String(g.created_at).slice(0, 10) < today && !g.done_at && !g.outcome);
  const anyOpen = mine.some(g => !isDone(g) && !g.outcome);
  const question = `What ${n === 1 ? 'one thing' : (WORD[n] || 'three') + ' things'} would make today a win?`;

  return (
    <div ref={ref} data-testid={compact ? 'goals-band-compact' : 'goals-band'} style={{ marginTop: compact ? 0 : 22, marginBottom: compact ? 18 : 0 }}>
      {away && !compact && (
        <div data-testid="welcome-back" style={{ ...calm.row, paddingTop: 0 }}>
          <div style={calm.rowTitle}>Welcome back{firstName ? ', ' + firstName : ''}.</div>
          <div style={calm.rowWhy}>Nothing was lost while you were away. Start with one small thing below. What I kept for you is under Done for you, whenever you want it.</div>
          <div style={calm.actions}>
            <button type="button" style={calm.btnQuiet} onClick={() => setView && setView('chief')}>See what I kept</button>
            <button type="button" style={calm.btnQuiet} onClick={() => setAway(false)}>Got it</button>
          </div>
        </div>
      )}

      {deadlines.length > 0 && !compact && (
        <div data-testid="deadline-band" style={{ padding: '12px 14px', marginBottom: 18, borderRadius: 12, border: '1px solid rgba(197,169,94,.45)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 4 }}>Contract dates this week</div>
          {deadlines.map((d, i) => (
            <div key={i} style={{ fontSize: 15, color: 'var(--text-1)', lineHeight: 1.6 }}>
              <strong>{d.label}</strong> — {longDate(d.date)}{d.date === today ? ' (today)' : ''}<span style={{ color: 'var(--text-3)' }}>{' · ' + d.about}</span>
            </div>
          ))}
        </div>
      )}

      {mine.length === 0 && picking !== 'today' && (
        <div data-testid="goals-prompt">
          <div style={{ ...calm.section, marginTop: 0 }}>{isMonday ? 'A new week. ' : ''}{question}</div>
          <div style={calm.actions}>
            <button type="button" data-testid="goals-choose" style={calm.btnPrimary} onClick={() => setPicking('today')}>Choose</button>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Yours to pick, in your own words. Only you see them.</span>
          </div>
        </div>
      )}

      {mine.length > 0 && picking !== 'today' && !closing && (
        <div data-testid="goals-today">
          <div style={{ ...calm.section, marginTop: 0 }}>Today</div>
          {chosenLastNight && (
            <div style={{ ...calm.actions, marginTop: 4 }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>You chose these last night. Still right?</span>
              <button type="button" style={calm.btnPrimary} onClick={confirmAll}>Yes</button>
              <button type="button" style={calm.btnQuiet} onClick={() => setPicking('today')}>Change</button>
            </div>
          )}
          {mine.map((g, i) => {
            const done = isDone(g);
            return (
              <div key={g.id} data-testid="goal-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: i ? calm.HAIR : 'none' }}>
                <button type="button" data-testid="goal-done" role="checkbox" aria-checked={done} aria-label={done ? 'Done' : 'Mark done'} onClick={() => toggle(g)}
                  style={{ flexShrink: 0, width: 44, height: 44, margin: '-10px -10px -10px -10px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid ' + (done ? '#C5A95E' : 'var(--text-3)'), background: done ? '#C5A95E' : 'transparent', color: '#100D09', fontSize: 14, lineHeight: '18px', textAlign: 'center', fontWeight: 800 }}>{done ? '✓' : ''}</span>
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...calm.rowTitle, color: done ? 'var(--text-3)' : 'var(--text-1)' }}>{g.text}</div>
                  {g.when_text && !done && <div style={calm.rowWhy}>{g.when_text}</div>}
                  {g.outcome && !done && <div style={calm.rowWhy}>{g.outcome === 'tomorrow' ? 'Moved to tomorrow.' : g.outcome === 'date' ? 'Moved to ' + (g.moved_to ? longDate(g.moved_to) : 'another day') + '.' : g.outcome === 'someday' ? 'Kept for someday.' : 'Let go.'}</div>}
                </div>
              </div>
            );
          })}
          <div style={calm.actions}>
            {!chosenLastNight && <button type="button" data-testid="goals-change" style={calm.btnQuiet} onClick={() => setPicking('today')}>Change</button>}
            {hour >= 16 && anyOpen && <button type="button" data-testid="goals-close-day" style={calm.btnQuiet} onClick={() => setClosing(true)}>Close out the day</button>}
          </div>
        </div>
      )}

      {picking === 'today' && <Picker day={today} label="today" goals={mine} n={n} setN={setN} userId={userId} tasks={tasks} busyDay={(events || []).filter(e => e && e.start_at && !e.all_day && e.status !== 'cancelled' && new Date(e.start_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today).length >= 4} rolled={rolled} onChange={load} onClose={() => setPicking(null)} />}

      {closing && <CloseDay goals={mine} isDone={isDone} today={today} tomorrow={tomorrow} userId={userId} taskById={taskById} setTasks={setTasks} onChange={load} onClose={() => setClosing(false)} />}

      {hour >= 15 && !compact && picking !== 'today' && !closing && (
        picking === 'tomorrow'
          ? <Picker day={tomorrow} label="tomorrow" goals={next} n={n} setN={setN} userId={userId} tasks={tasks} busyDay={false} rolled={rolled} onChange={load} onClose={() => setPicking(null)} />
          : <div style={{ marginTop: 6 }}>
              <button type="button" data-testid="goals-tomorrow" style={calm.link} onClick={() => setPicking('tomorrow')}>
                {next.length ? 'Tomorrow is chosen — look or change ›' : `Pick tomorrow’s ${n === 1 ? 'one' : WORD[n] || 'three'} ›`}
              </button>
            </div>
      )}
    </div>
  );
}

// ── Choosing ─────────────────────────────────────────────────────────────────
function Picker({ day, label, goals, n, setN, userId, tasks, busyDay, rolled, onChange, onClose }) {
  const [cands, setCands] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [find, setFind] = useState('');
  const [editing, setEditing] = useState(null);   // { id, text, when_text }
  useEffect(() => {
    let go = true;
    (async () => { const { data, error } = await supabase.rpc('goal_candidates', { p_day: day }); if (go) setCands(error || !Array.isArray(data) ? [] : data); })();
    return () => { go = false; };
  }, [day, goals.length]);
  const full = goals.length >= n;
  const add = async (t, link = {}) => {
    const clean = String(t || '').trim(); if (!clean || busy) return;
    if (full) { say(`That is your ${WORD[n] || n}. Take one out to swap, or change how many below.`, 'info'); return; }
    setBusy(true);
    const { error } = await supabase.from('day_goals').insert({ user_id: userId, day, pos: goals.length + 1, text: clean.slice(0, 300), confirmed_at: day === todayNY() ? new Date().toISOString() : null, ...link });
    setBusy(false);
    if (error) { say('Could not add that: ' + error.message); return; }
    setText(''); await onChange();
  };
  const remove = async (g) => {
    const { error } = await supabase.from('day_goals').delete().eq('id', g.id);
    if (error) { say('Could not take that out: ' + error.message); return; }
    await onChange();
  };
  const saveEdit = async () => {
    const clean = String(editing.text || '').trim(); if (!clean) return;
    const { error } = await supabase.from('day_goals').update({ text: clean.slice(0, 300), when_text: String(editing.when_text || '').trim().slice(0, 200) || null }).eq('id', editing.id);
    if (error) { say('Could not save that: ' + error.message); return; }
    setEditing(null); await onChange();
  };
  const changeN = async (k) => {
    const { error } = await supabase.from('user_settings').upsert({ user_id: userId, daily_goal_count: k }, { onConflict: 'user_id' });
    if (error) { say('Could not save that: ' + error.message); return; }
    setN(k);
  };
  const linked = new Set(goals.map(g => g.task_id).filter(Boolean));
  const open = useMemo(() => (tasks || []).filter(t => !t.completed && !t.dropped_at && !linked.has(t.id)
    && (!find.trim() || String(t.title || '').toLowerCase().includes(find.trim().toLowerCase()))).slice(0, 12), [tasks, find, goals]);   // eslint-disable-line react-hooks/exhaustive-deps
  const input = { width: '100%', minHeight: 44, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontFamily: calm.SANS, fontSize: 15 };
  return (
    <div data-testid="goals-picker">
      <div style={{ ...calm.section, marginTop: 0 }}>{`Your goals for ${label}`}</div>
      <div style={calm.sectionNote}>
        Write each one as the result you want. Only you see these.
        {busyDay ? ' Today is full on your calendar — two may be plenty.' : ''}
        {rolled ? ' A few of these have rolled forward lately. Smaller goals, or fewer, might fit the days you are having.' : ''}
      </div>

      {goals.map((g, i) => (
        <div key={g.id} data-testid="picked-goal" style={i ? calm.rowRule : calm.row}>
          {editing && editing.id === g.id ? (
            <div>
              <input aria-label="Goal" style={input} value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} />
              <input aria-label="When, and if not, then" style={{ ...input, marginTop: 8, fontSize: 14 }} placeholder="When? e.g. after the 2 pm showing; if that runs over, after dinner" value={editing.when_text || ''} onChange={e => setEditing({ ...editing, when_text: e.target.value })} />
              <div style={calm.actions}><button type="button" style={calm.btnPrimary} onClick={saveEdit}>Save</button><button type="button" style={calm.btnQuiet} onClick={() => setEditing(null)}>Cancel</button></div>
            </div>
          ) : (
            <>
              <div style={calm.rowTitle}>{g.text}</div>
              {g.when_text && <div style={calm.rowWhy}>{g.when_text}</div>}
              <div style={calm.actions}>
                <button type="button" style={calm.btnQuiet} onClick={() => setEditing({ id: g.id, text: g.text, when_text: g.when_text || '' })}>Reword, or add when</button>
                <button type="button" style={calm.btnQuiet} onClick={() => remove(g)}>Take out</button>
              </div>
            </>
          )}
        </div>
      ))}

      {!full && (
        <div style={{ marginTop: 12 }}>
          <input data-testid="goal-input" aria-label="A goal, in your own words" style={input} placeholder="In your own words…" value={text}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(text); }} />
          <div style={calm.actions}><button type="button" data-testid="goal-add" disabled={busy || !text.trim()} style={{ ...calm.btnPrimary, opacity: text.trim() ? 1 : 0.5 }} onClick={() => add(text)}>Add</button></div>
        </div>
      )}

      {!full && cands.length > 0 && (
        <div data-testid="goal-suggestions">
          <div style={{ ...calm.sectionNote, marginTop: 18 }}>Or start from one of these:</div>
          {cands.map((c, i) => (
            <div key={c.src + c.id} style={i ? calm.rowRule : calm.row}>
              <div style={calm.rowTitle}>{c.title}</div>
              <div style={calm.rowWhy}>{c.hint}</div>
              <div style={calm.actions}><button type="button" disabled={busy} style={calm.btnQuiet} onClick={() => add(c.title, c.src === 'task' ? { task_id: c.id } : { commitment_id: c.id })}>Add</button></div>
            </div>
          ))}
        </div>
      )}

      {!full && (
        <div style={{ marginTop: 6 }}>
          <button type="button" data-testid="goal-see-all" style={calm.link} onClick={() => setAll(v => !v)}>{all ? 'Hide my task list' : 'See everything on my list ›'}</button>
          {all && (
            <div>
              <input aria-label="Find a task" style={{ ...input, fontSize: 14 }} placeholder="Find a task…" value={find} onChange={e => setFind(e.target.value)} />
              {open.length === 0 ? <div style={calm.empty}>Nothing matches.</div> : open.map((t, i) => (
                <div key={t.id} style={i ? calm.rowRule : calm.row}>
                  <div style={calm.rowTitle}>{t.title}</div>
                  <div style={calm.actions}><button type="button" disabled={busy} style={calm.btnQuiet} onClick={() => add(t.title, { task_id: t.id })}>Add</button></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ ...calm.actions, marginTop: 16 }}>
        <button type="button" data-testid="goals-done" style={calm.btnPrimary} onClick={onClose}>{goals.length ? 'That is my day' : 'Not now'}</button>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>How many a day:</span>
        {[1, 2, 3, 4, 5].map(k => (
          <button key={k} type="button" aria-pressed={k === n} aria-label={k + ' a day'} onClick={() => changeN(k)}
            style={{ minWidth: 36, minHeight: 36, borderRadius: 18, border: 'none', cursor: 'pointer', fontFamily: calm.SANS, fontSize: 13.5, fontWeight: 700, background: k === n ? '#C5A95E' : 'transparent', color: k === n ? '#100D09' : 'var(--text-3)' }}>{k}</button>
        ))}
      </div>
    </div>
  );
}

// ── The end of the day ───────────────────────────────────────────────────────
// What got done comes first. Each goal left open gets one quiet choice. A plan
// for an unfinished thing is what lets it stop running in the back of the mind.
function CloseDay({ goals, isDone, today, tomorrow, userId, taskById, setTasks, onChange, onClose }) {
  const [dating, setDating] = useState(null);
  const done = goals.filter(isDone);
  const left = goals.filter(g => !isDone(g) && !g.outcome);
  const carry = async (g, day) => {
    const { error } = await supabase.from('day_goals').insert({ user_id: userId, day, pos: 9, text: g.text, when_text: null, task_id: g.task_id, commitment_id: g.commitment_id });
    if (error) { say('Could not move that: ' + error.message); return false; }
    return true;
  };
  const close = async (g, outcome, date) => {
    if (outcome === 'tomorrow' && !(await carry(g, tomorrow))) return;
    if (outcome === 'date') {
      if (!date || date <= today) return;
      if (!(await carry(g, date))) return;
      if (g.task_id && taskById.has(g.task_id)) {
        const { error: tErr } = await supabase.from('tasks').update({ due_date: date }).eq('id', g.task_id);
        if (!tErr) setTasks && setTasks(prev => prev.map(t => t.id === g.task_id ? { ...t, due_date: date } : t));
      }
    }
    // "Someday" means it: the linked task moves to the Someday list, off the day.
    if (outcome === 'someday' && g.task_id && taskById.has(g.task_id)) {
      const { error: sErr } = await supabase.from('tasks').update({ status: 'someday' }).eq('id', g.task_id);
      if (sErr) { say('Could not move the task to Someday: ' + sErr.message); return; }
      setTasks && setTasks(prev => prev.map(t => t.id === g.task_id ? { ...t, status: 'someday' } : t));
    }
    const { error } = await supabase.from('day_goals').update({ outcome, moved_to: outcome === 'date' ? date : outcome === 'tomorrow' ? tomorrow : null }).eq('id', g.id);
    if (error) { say('Could not save that: ' + error.message); return; }
    setDating(null); await onChange();
  };
  return (
    <div data-testid="close-day">
      {done.length > 0 && <>
        <div style={{ ...calm.section, marginTop: 0 }}>What got done today</div>
        {done.map(g => <div key={g.id} data-testid="closed-done" style={{ fontSize: 15, color: 'var(--text-1)', padding: '6px 0' }}>✓ {g.text}</div>)}
      </>}
      {left.length > 0 && <>
        <div style={{ ...calm.section, marginTop: done.length ? 22 : 0 }}>Still open</div>
        <div style={calm.sectionNote}>Give each one a place, and it can stop following you around tonight.</div>
        {left.map((g, i) => (
          <div key={g.id} data-testid="close-row" style={i ? calm.rowRule : calm.row}>
            <div style={calm.rowTitle}>{g.text}</div>
            {dating === g.id
              ? <div style={calm.actions}>
                  <input type="date" aria-label="Pick a date" min={tomorrow} onChange={e => close(g, 'date', e.target.value)}
                    style={{ minHeight: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontSize: 14 }} />
                  <button type="button" style={calm.btnQuiet} onClick={() => setDating(null)}>Cancel</button>
                </div>
              : <div style={calm.actions}>
                  <button type="button" style={calm.btnPrimary} onClick={() => close(g, 'tomorrow')}>Tomorrow</button>
                  <button type="button" style={calm.btnQuiet} onClick={() => setDating(g.id)}>A date</button>
                  <button type="button" style={calm.btnQuiet} onClick={() => close(g, 'someday')}>Someday</button>
                  <button type="button" style={calm.btnQuiet} onClick={() => close(g, 'let_go')}>Let it go</button>
                </div>}
          </div>
        ))}
      </>}
      {left.length === 0 && <div data-testid="day-closed" style={{ ...calm.rowWhy, marginTop: 12 }}>The day is closed. Rest well.</div>}
      <div style={calm.actions}><button type="button" style={calm.btnQuiet} onClick={onClose}>{left.length ? 'Later' : 'Done'}</button></div>
    </div>
  );
}
