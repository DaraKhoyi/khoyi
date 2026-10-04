import React, { useMemo, useState } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';

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

const DAYS_STALE = 30;   // by 30 days it has survived thirty daily "not today"s
const CARRIES_STALE = 5; // or five explicit rolls, whichever comes first

const ageDays = (t) => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);

export default function StaleDecide({ tasks, setTasks, userId }) {
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(null);
  const [shown, setShown] = useState(3);   // never a wall — 3 decisions at a time

  const stale = useMemo(() => (tasks || [])
    .filter(t => !t.completed && !t.dropped_at && !t.waiting_on)
    .filter(t => (t.carry_count || 0) >= CARRIES_STALE || ageDays(t) >= DAYS_STALE)
    .sort((a, b) => ageDays(b) - ageDays(a)), [tasks]);

  if (!stale.length) return null;

  const patch = (id, fields) => setTasks && setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t));

  async function doToday(t) {
    setBusy(t.id);
    const today = todayNY();
    const { error } = await supabase.from('tasks').update({ due_date: today, carry_count: 0 }).eq('id', t.id);
    if (error) { if (window.__notify) window.__notify('Could not move to today: ' + (error.message || error), 'error'); setBusy(null); return; }
    patch(t.id, { due_date: today, carry_count: 0 });
    setBusy(null);
  }
  async function schedule(t, date) {
    if (!date) return;
    setBusy(t.id);
    const { error } = await supabase.from('tasks').update({ due_date: date, carry_count: 0 }).eq('id', t.id);
    if (error) { if (window.__notify) window.__notify('Could not reschedule: ' + (error.message || error), 'error'); setBusy(null); return; }
    patch(t.id, { due_date: date, carry_count: 0 });
    setPicking(null); setBusy(null);
  }
  async function drop(t) {
    setBusy(t.id);
    // Not completed. Decided against. The distinction is the whole point.
    const dropped_at = new Date().toISOString();
    const { error } = await supabase.from('tasks').update({
      dropped_at,
      notes: (t.notes ? t.notes + '\n' : '') + `[let go on ${todayNY()} — decided against]`,
    }).eq('id', t.id);
    if (error) { if (window.__notify) window.__notify('Could not drop task: ' + (error.message || error), 'error'); setBusy(null); return; }
    patch(t.id, { dropped_at });
    setBusy(null);
  }

  const added = (t) => new Date(t.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', textAlign: 'left', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px',
          color: 'var(--text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>A few older tasks, when you want to look</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{open ? 'close' : 'look'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10, padding: '0 2px' }}>
            These have been on the list a while. Do it today, give it a date, or let it go.
            Any of the three is a good answer.
          </div>
          {stale.slice(0, shown).map(t => (
            <div key={t.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 12, marginBottom: 7 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.4 }}>{t.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
                Added {added(t)}
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
                    style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)',
                      borderRadius: 100, padding: '6px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Let it go</button>
                </div>
              )}
            </div>
          ))}
          {stale.length > shown && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + 3)}>
                Show 3 more
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>A few at a time is enough for one sitting.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
