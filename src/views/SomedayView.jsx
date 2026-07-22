import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../dataService';

// ── Someday / Maybe ──────────────────────────────────────────────────────────
// The parking lot for things worth keeping that don't belong on a schedule —
// a book to read, a movie to watch, an idea to revisit. Deliberately OUTSIDE the
// active task list, the past-due count and the NBA, so it can never add pressure.
// You visit it when you choose to, and promote anything to active with a date.

export default function SomedayView({ userId, setView }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [dueFor, setDueFor] = useState({});   // taskId -> date string being chosen

  const load = useCallback(async () => {
    const { data } = await supabase.from('tasks')
      .select('id, title, notes, someday_since, someday_note, created_at, priority')
      .eq('someday', true).is('archived_at', null).eq('completed', false)
      .order('someday_since', { ascending: false });
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const activate = async (id, due) => {
    setBusy(id);
    try {
      const { data } = await supabase.rpc('tasks_activate_someday', { p_task_id: id, p_due: due || null });
      if (data?.ok) {
        setRows(r => (r || []).filter(x => x.id !== id));
        if (window.__notify) window.__notify(due ? 'Back on your list, due ' + due : 'Back on your list for today.', 'success');
      }
    } catch (e) { if (window.__notify) window.__notify('Could not activate: ' + (e.message || e), 'error'); }
    setBusy(null);
  };
  const drop = async (id) => {
    if (!window.confirm('Remove this from Someday/Maybe? It will be archived (not deleted).')) return;
    setBusy(id);
    try {
      await supabase.from('tasks').update({ archived_at: new Date().toISOString(), archived_reason: 'someday_dropped' }).eq('id', id);
      setRows(r => (r || []).filter(x => x.id !== id));
    } catch (_) {}
    setBusy(null);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows || [];
    return (rows || []).filter(r => (r.title || '').toLowerCase().includes(s) || (r.notes || '').toLowerCase().includes(s));
  }, [rows, q]);

  const parkedAge = (r) => {
    const t = r.someday_since || r.created_at;
    if (!t) return '';
    const d = Math.floor((Date.now() - new Date(t)) / 86400000);
    return d === 0 ? 'today' : d < 30 ? d + 'd ago' : d < 365 ? Math.round(d / 30) + 'mo ago' : Math.round(d / 365) + 'y ago';
  };
  const todayISO = new Date().toISOString().slice(0, 10);
  const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  return (
    <div className="ww-prism" style={{ maxWidth: 720, margin: '0 auto' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--border:#2A2016;--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;--accent:#CBA35C;}`}</style>

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--accent)', fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif' }}>SOMEDAY / MAYBE</div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: '2px 0 4px' }}>
          Worth keeping. Not now.
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
          These don't count as past due and never appear in your day. Come browse when you want to — promote anything the moment it's ready.
        </div>
      </div>

      {rows && rows.length > 6 && (
        <input className="form-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search Someday/Maybe…" style={{ margin: '14px 0 10px' }} />
      )}

      {rows === null && <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 20 }}>Loading…</div>}

      {rows && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '34px 18px', marginTop: 16, borderRadius: 18, border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✦</div>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 300, color: 'var(--text-1)' }}>Nothing parked yet.</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
            When a task is worth keeping but doesn't belong on a schedule — a book to read, a place to visit, an idea to revisit —
            send it here instead of letting it rot in your task list.
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {filtered.map(r => (
          <div key={r.id} style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', marginBottom: 10 }}>
            <div style={{ fontSize: 15, color: 'var(--text-1)', fontFamily: 'Fraunces, serif', lineHeight: 1.3 }}>{r.title}</div>
            {r.notes && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.45 }}>{String(r.notes).slice(0, 180)}</div>}
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>parked {parkedAge(r)}</div>

            {dueFor[r.id] === undefined ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => setDueFor(d => ({ ...d, [r.id]: todayISO }))}>Make it active</button>
                <button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => drop(r.id)}>Not anymore</button>
              </div>
            ) : (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: '1px solid var(--accent)', background: 'rgba(203,163,92,0.06)' }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginBottom: 8 }}>When do you want to do it?</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => activate(r.id, todayISO)}>Today</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => activate(r.id, plusDays(7))}>Next week</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => activate(r.id, plusDays(30))}>Next month</button>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="date" className="form-input" value={dueFor[r.id]} onChange={e => setDueFor(d => ({ ...d, [r.id]: e.target.value }))} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => activate(r.id, dueFor[r.id])}>Set</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDueFor(d => { const n = { ...d }; delete n[r.id]; return n; })}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {rows && rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
          {rows.length} parked · none of these are counted as due or overdue.
        </div>
      )}
    </div>
  );
}
