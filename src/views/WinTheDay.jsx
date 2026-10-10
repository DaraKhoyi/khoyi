// Win the Day — the single Top 3 (Phase A, 10 Oct 2026, Dara approved 1:45 PM ET).
// Replaces three lists that competed for "the 3 things" (GoalsBand, TodayThree,
// ChiefQueue) for people in the pilot (pilot_features 'win_the_day').
//   1. Choose: suggestions (promises <48h, Company Lead waiting, missed caller,
//      tasks due, active deals) + Add Your Own. Exactly three, then Verify.
//   2. Today: check off, or Roll to tomorrow. Items rolled from yesterday, or
//      chosen last night, arrive pre-picked and only need Verify.
// Data: day_goals (own rows only, policy day_goals_own). In-app only; nothing is sent.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { tap } from '../lib/tap';

const G = '#C5A95E';
const SERIF = "'Bodoni Moda', 'Playfair Display', Georgia, serif";
const SANS = "'Montserrat', 'Manrope', -apple-system, sans-serif";
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const say = (m, k) => { if (window.__notify) window.__notify(m, k || 'error'); };
const KIND = { promise: 'Promise', company_lead: 'Company Lead', missed_call: 'Missed call', task: 'Task', deal: 'Deal', own: 'Your own' };
const done = (g) => !!g.done_at;
const label = (it) => it.kind === 'missed_call' ? 'Call back ' + (it.who || it.name || it.phone || 'a missed caller')
  : it.kind === 'company_lead' ? 'Reach ' + (it.who || it.name || it.phone || 'your Company Lead')
  : (it.title || '') + (it.who ? ' · ' + it.who : '');

const s = {
  sec: { fontFamily: SERIF, fontSize: 21, color: 'var(--text-1)', margin: '26px 0 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  note: { fontFamily: SANS, fontSize: 12, color: 'var(--text-3)' },
  card: { background: '#16130E', border: '1px solid #2A241A', borderRadius: 14, padding: 14, marginBottom: 10, fontFamily: SANS },
  sel: { borderColor: G, background: '#211B10' },
  kind: { fontSize: 10.5, color: G, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 },
  title: { fontSize: 15, color: 'var(--text-1)', lineHeight: 1.4, marginTop: 2 },
  btn: { width: '100%', minHeight: 50, borderRadius: 12, border: 'none', background: G, color: '#0B0A08', fontFamily: SANS, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  quiet: { minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid #2A241A', background: 'transparent', color: 'var(--text-1)', fontFamily: SANS, fontSize: 13, cursor: 'pointer' },
  input: { flex: 1, minHeight: 44, background: '#0F0D0A', border: '1px solid #2A241A', color: 'var(--text-1)', borderRadius: 10, padding: '0 12px', fontFamily: SANS, fontSize: 15 },
  row: { display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0' },
  ck: (on) => ({ width: 30, height: 30, flex: 'none', borderRadius: '50%', border: '2px solid ' + G, background: on ? G : 'transparent', color: '#0B0A08', fontWeight: 700, cursor: 'pointer' }),
};

export default function WinTheDay({ userId, setTasks }) {
  const today = todayNY(), tomorrow = addDays(today, 1);
  const [goals, setGoals] = useState(null);       // today's day_goals
  const [sugs, setSugs] = useState([]);
  const [mode, setMode] = useState('start');      // start | pick | today
  const [picked, setPicked] = useState([]);       // [{ref,kind,title,task_id?,commitment_id?,goal_id?}]
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('day_goals').select('*').eq('user_id', userId).eq('day', today).order('pos').order('created_at');
    if (error) { setGoals([]); return; }
    const live = (data || []).filter(g => !g.outcome);
    setGoals(live);
    if (live.length && live.every(g => g.confirmed_at)) setMode('today');
    else if (live.length) {   // chosen last night or rolled from yesterday: pre-picked, needs Verify
      setPicked(live.slice(0, 3).map(g => ({ ref: 'goal:' + g.id, kind: g.task_id ? 'task' : g.commitment_id ? 'promise' : 'own', title: g.text, goal_id: g.id })));
      setMode('pick');
    } else setMode('start');
  }, [userId, today]);
  useEffect(() => { load(); }, [load]);

  const openPick = async () => {
    tap('today.top3.choose');
    setMode('pick');
    const { data } = await supabase.rpc('win_the_day_suggestions');
    setSugs(Array.isArray(data?.items) ? data.items : []);
  };
  const toggle = (it) => {
    setPicked(p => {
      if (p.some(x => x.ref === it.ref)) return p.filter(x => x.ref !== it.ref);
      if (p.length >= 3) { say('You have three. Tap one to swap it out.', 'info'); return p; }
      tap('today.top3.pick.' + (KIND[it.kind] ? it.kind : 'other'));
      return [...p, { ...it, title: it.kind === 'own' || it.goal_id ? it.title : label(it) }];
    });
  };
  const addOwn = () => {
    const t = own.trim().slice(0, 300); if (!t) return;
    if (picked.length >= 3) { say('You have three. Tap one to swap it out.', 'info'); return; }
    tap('today.top3.add_own');
    setPicked(p => [...p, { ref: 'own:' + Date.now(), kind: 'own', title: t }]); setOwn('');
  };
  const verify = async () => {
    if (picked.length !== 3 || busy) return;
    setBusy(true); tap('today.top3.verify');
    const at = new Date().toISOString();
    const keep = picked.filter(p => p.goal_id).map(p => p.goal_id);
    // Pre-picked goals not kept are set aside, not deleted (reversible).
    const drop = (goals || []).filter(g => !keep.includes(g.id)).map(g => g.id);
    if (drop.length) await supabase.from('day_goals').update({ outcome: 'let_go' }).in('id', drop);
    if (keep.length) await supabase.from('day_goals').update({ confirmed_at: at }).in('id', keep);
    const rows = picked.filter(p => !p.goal_id).map((p, i) => ({
      user_id: userId, day: today, pos: keep.length + i + 1, text: String(p.title || '').slice(0, 300), confirmed_at: at,
      task_id: p.kind === 'task' ? p.id : null, commitment_id: p.kind === 'promise' ? p.id : null,
    }));
    const { error } = rows.length ? await supabase.from('day_goals').insert(rows) : { error: null };
    setBusy(false);
    if (error) { say('Could not save your three: ' + error.message); return; }
    setPicked([]); say('Your three are set. Go win the day.', 'success'); await load();
  };
  const check = async (g) => {
    const v = done(g) ? null : new Date().toISOString();
    tap(v ? 'today.top3.check' : 'today.top3.uncheck');
    const { error } = await supabase.from('day_goals').update({ done_at: v }).eq('id', g.id);
    if (error) { say('Could not save that: ' + error.message); return; }
    if (g.task_id) {
      await supabase.from('tasks').update({ completed: !!v, completed_at: v }).eq('id', g.task_id);
      setTasks && setTasks(prev => prev.map(t => t.id === g.task_id ? { ...t, completed: !!v, completed_at: v } : t));
    }
    setGoals(gs => gs.map(x => x.id === g.id ? { ...x, done_at: v } : x));
    const n = (goals || []).filter(x => x.id === g.id ? !!v : done(x)).length;
    if (v && n === 3) say('Day won. All three done.', 'success');
  };
  const roll = async (g) => {
    tap('today.top3.roll');
    const { error: e1 } = await supabase.from('day_goals').insert({ user_id: userId, day: tomorrow, pos: 9, text: g.text, task_id: g.task_id, commitment_id: g.commitment_id });
    if (e1) { say('Could not move that: ' + e1.message); return; }
    await supabase.from('day_goals').update({ outcome: 'tomorrow', moved_to: tomorrow }).eq('id', g.id);
    say('Moved to tomorrow. It will be waiting for you.', 'info'); await load();
  };

  if (goals === null) return null;

  if (mode === 'today') {
    const n = goals.filter(done).length;
    return (
      <section data-testid="win-the-day">
        <div style={s.sec}><span>Win the Day</span><span style={s.note}>{n} of {goals.length} done</span></div>
        <div style={s.card}>
          {goals.map((g, i) => (
            <div key={g.id} style={{ ...s.row, borderTop: i ? '1px solid #2A241A' : 'none' }}>
              <button type="button" aria-label={done(g) ? 'Mark not done' : 'Mark done'} style={s.ck(done(g))} onClick={() => check(g)}>{done(g) ? '✓' : ''}</button>
              <div style={{ flex: 1, ...s.title, marginTop: 0, textDecoration: done(g) ? 'line-through' : 'none', color: done(g) ? 'var(--text-3)' : 'var(--text-1)' }}>{g.text}</div>
              {!done(g) && <button type="button" style={{ ...s.quiet, fontSize: 12, minHeight: 34 }} onClick={() => roll(g)}>Roll to tomorrow</button>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mode === 'start') {
    return (
      <section data-testid="win-the-day">
        <div style={s.sec}><span>Win the Day</span></div>
        <button type="button" style={s.btn} onClick={openPick}>Choose My Top 3 Actions for Today</button>
      </section>
    );
  }

  const shown = sugs.filter(x => !picked.some(p => p.ref === x.ref));
  return (
    <section data-testid="win-the-day">
      <div style={s.sec}><span>Choose your Top 3</span><span style={s.note}>{picked.length} of 3</span></div>
      {picked.map((p, i) => (
        <div key={p.ref} style={{ ...s.card, ...s.sel, cursor: 'pointer' }} onClick={() => toggle(p)}>
          <div style={s.kind}>{i + 1} · {KIND[p.kind] || 'Suggested'}</div><div style={s.title}>{p.title}</div>
        </div>
      ))}
      {picked.length === 3
        ? <button type="button" style={{ ...s.btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={verify}>Verify</button>
        : <>
            {sugs.length === 0 && <div style={{ ...s.note, margin: '4px 0 10px' }}>Nothing urgent waiting. Add your own below.</div>}
            {shown.map(it => (
              <div key={it.ref} style={{ ...s.card, cursor: 'pointer' }} onClick={() => toggle(it)}>
                <div style={s.kind}>{KIND[it.kind] || 'Suggested'}{it.late ? ' · late' : ''}</div>
                <div style={s.title}>{label(it)}</div>
              </div>
            ))}
            <div style={{ ...s.card, display: 'flex', gap: 8 }}>
              <input style={s.input} value={own} placeholder="Add your own" maxLength={300}
                onChange={e => setOwn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOwn(); }} />
              <button type="button" style={s.quiet} onClick={addOwn}>Add</button>
            </div>
          </>}
    </section>
  );
}
