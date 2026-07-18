import React, { useMemo, useState } from 'react';
import { supabase } from '../dataService';

// ── StaleDecide ──────────────────────────────────────────────────────────────
// The bill for "not today".
//
// Carry-forward made deferring free and silent: every one of Dara's 69 overdue
// tasks displayed "1 day late", including one born in May. So 68 tasks quietly
// reached 30-60 days old while the list insisted everything was fresh. At his
// real pace (~2.4/day) that pile takes 86 days to clear — it cannot be worked
// out of, only decided down.
//
// A task carried thirty times is not a task. It is a decision he keeps not
// making. This screen makes him make it — three doors, no fourth:
//   Do it today · Pick a real date · Drop it
// "Drop" is not "complete". It gets its own field so a decision to let go never
// inflates the number of things he actually did.

const EMBER = '#C9563F';
const DAYS_STALE = 30;   // by 30 days it has survived thirty daily "not today"s
const CARRIES_STALE = 5; // or five explicit rolls, whichever comes first

const ageDays = (t) => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);

export default function StaleDecide({ tasks, setTasks, userId }) {
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(null);

  const stale = useMemo(() => (tasks || [])
    .filter(t => !t.completed && !t.dropped_at && !t.waiting_on)
    .filter(t => (t.carry_count || 0) >= CARRIES_STALE || ageDays(t) >= DAYS_STALE)
    .sort((a, b) => ageDays(b) - ageDays(a)), [tasks]);

  if (!stale.length) return null;

  const patch = (id, fields) => setTasks && setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t));

  async function doToday(t) {
    setBusy(t.id);
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('tasks').update({ due_date: today }).eq('id', t.id);
    patch(t.id, { due_date: today, carry_count: 0 });
    await supabase.from('tasks').update({ carry_count: 0 }).eq('id', t.id);
    setBusy(null);
  }
  async function schedule(t, date) {
    if (!date) return;
    setBusy(t.id);
    await supabase.from('tasks').update({ due_date: date, carry_count: 0 }).eq('id', t.id);
    patch(t.id, { due_date: date, carry_count: 0 });
    setPicking(null); setBusy(null);
  }
  async function drop(t) {
    setBusy(t.id);
    // Not completed. Decided against. The distinction is the whole point.
    await supabase.from('tasks').update({
      dropped_at: new Date().toISOString(),
      notes: (t.notes ? t.notes + '\n' : '') + `[dropped after ${ageDays(t)} days${t.carry_count ? ` and ${t.carry_count} carries` : ''} — decided against, not done]`,
    }).eq('id', t.id);
    patch(t.id, { dropped_at: new Date().toISOString() });
    setBusy(null);
  }

  const oldest = ageDays(stale[0]);

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', textAlign: 'left', background: 'var(--bg-card)',
          border: `1px solid ${EMBER}55`, borderRadius: 12, padding: '12px 14px',
          color: 'var(--text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: EMBER }}>{stale.length} need a decision</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>oldest {oldest} days · carried, not done</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{open ? 'later' : 'decide'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10, padding: '0 2px' }}>
            These have been moved to tomorrow over and over. That’s already an answer —
            it just never got recorded. Three doors, no fourth.
          </div>
          {stale.slice(0, 12).map(t => (
            <div key={t.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 12, marginBottom: 7 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.4 }}>{t.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
                {ageDays(t)} days old{t.carry_count ? ` · moved ${t.carry_count}×` : ''}
              </div>
              {picking === t.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 9, alignItems: 'center' }}>
                  <input type="date" autoFocus onChange={e => schedule(t, e.target.value)}
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--border)',
                      borderRadius: 8, color: 'var(--text-1)', padding: '6px 9px', fontSize: 12 }} />
                  <button onClick={() => setPicking(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}>cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                  <button disabled={busy === t.id} onClick={() => doToday(t)}
                    style={{ background: 'var(--accent-2)', color: '#1a1409', border: 'none', borderRadius: 100,
                      padding: '6px 13px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>Do it today</button>
                  <button disabled={busy === t.id} onClick={() => setPicking(t.id)}
                    style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)',
                      borderRadius: 100, padding: '6px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Pick a real date</button>
                  <button disabled={busy === t.id} onClick={() => drop(t)}
                    style={{ background: 'transparent', color: EMBER, border: `1px solid ${EMBER}55`,
                      borderRadius: 100, padding: '6px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Drop it</button>
                </div>
              )}
            </div>
          ))}
          {stale.length > 12 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: '6px 0' }}>
              {stale.length - 12} more — twelve at a time is enough for one sitting.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
