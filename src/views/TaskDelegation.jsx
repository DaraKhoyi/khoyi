import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../dataService';

// ── Delegation ───────────────────────────────────────────────────────────────
// Handing work to someone else is a REQUEST, not an insertion.
//
// The distinction this file exists to protect: attributing a commitment to
// someone (OwnerPicker) records who you're waiting on — it is your private
// note about the world. Delegating puts work in another human's list, and
// nothing lands there until they say yes. A system that can silently write
// into your task list is a system you stop trusting, and an agent who stops
// trusting the list stops opening the app.
//
// Consequences of that choice, all deliberate:
//   · Only people with a PrismOS LOGIN can be delegated to — consent needs
//     someone able to give it. Everyone else stays trackable via OwnerPicker.
//   · Declining is a first-class outcome with a reason, not a failure state.
//     The item returns to the sender rather than evaporating.
//   · On accept the recipient gets THEIR OWN task row (their user_id), so
//     existing per-user RLS holds unchanged and neither side can edit the
//     other's copy. The two rows stay linked through the delegation record.

const EMBER = '#C9563F';
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const lab = { fontSize: 9.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 800 };
const btn = (primary, tone) => ({
  background: primary ? (tone === 'bad' ? EMBER : 'var(--accent-2)') : 'transparent',
  color: primary ? '#1a1409' : 'var(--text-2)',
  border: primary ? 'none' : '1px solid var(--border)',
  borderRadius: 100, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
});
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

// Who can legally be asked: brokerage people who actually have an account.
export function useDelegatable(userId) {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    let dead = false;
    (async () => {
      const { data } = await supabase.from('agents')
        .select('id,name,email,auth_user_id,active')
        .not('auth_user_id', 'is', null);
      if (dead) return;
      setPeople((data || [])
        .filter(a => a.active !== false && a.auth_user_id && a.auth_user_id !== userId));
    })();
    return () => { dead = true; };
  }, [userId]);
  return people;
}

// ── Send a request ───────────────────────────────────────────────────────────
export function DelegateModal({ userId, task, onClose, onSent }) {
  const people = useDelegatable(userId);
  const [term, setTerm] = useState('');
  const [to, setTo] = useState(null);
  const [note, setNote] = useState('');
  const [due, setDue] = useState(task?.due_date || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (t ? people.filter(p => (p.name || '').toLowerCase().includes(t)
      || (p.email || '').toLowerCase().includes(t)) : people).slice(0, 25);
  }, [people, term]);

  async function send() {
    if (!to) { setErr('Choose who you are asking.'); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from('task_delegations').insert({
        task_id: task?.id || null,
        from_user_id: userId,
        to_auth_user_id: to.auth_user_id,
        to_name: to.name,
        title: (task?.title || '').trim(),
        note: note.trim() || null,
        due_date: due || null,
        priority: task?.priority || 'medium',
        status: 'pending',
      });
      if (error) throw error;
      // The sender's own copy becomes a tracker while they wait. It is NOT
      // completed — you are still on the hook until someone accepts.
      if (task?.id) {
        await supabase.from('tasks')
          .update({ waiting_on: `${to.name} (awaiting reply)` }).eq('id', task.id);
      }
      onSent && onSent(to);
      onClose && onClose();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.62)',
      zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(520px,100%)',
        borderRadius: '16px 16px 0 0', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ ...lab, marginBottom: 8 }}>Ask someone to take this</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
          {task?.title}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
          They get a request they can accept or decline. Nothing lands in their list until they accept.
        </div>

        {err && <div style={{ color: EMBER, fontSize: 12, marginBottom: 8 }}>{err}</div>}

        {!people.length && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 0', lineHeight: 1.55 }}>
            No one on your roster has a PrismOS login yet, so there's nobody who can accept.
            You can still mark who you're waiting on from the call review screen.
          </div>
        )}

        {people.length > 0 && (
          <>
            <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search your people…"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
                padding: '8px 10px', fontSize: 13, marginBottom: 8 }} />
            <div style={{ maxHeight: 168, overflowY: 'auto', marginBottom: 10 }}>
              {list.map(p => (
                <button key={p.auth_user_id} type="button" onClick={() => setTo(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: to && to.auth_user_id === p.auth_user_id ? 'rgba(197,169,94,.16)' : 'none',
                    border: '1px solid ' + (to && to.auth_user_id === p.auth_user_id ? 'var(--accent-2)' : 'transparent'),
                    borderRadius: 8, padding: '8px 9px', marginBottom: 3, color: 'var(--text-1)', fontSize: 13 }}>
                  {p.name}
                  <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 6 }}>{p.email}</span>
                </button>
              ))}
            </div>

            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Why them, or anything they need to know (optional)"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
                padding: '8px 10px', fontSize: 12.5, marginBottom: 8, resize: 'vertical' }} />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input type="date" value={due} onChange={e => setDue(e.target.value)}
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--text-1)', padding: '6px 9px', fontSize: 12 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>when you need it by</span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} onClick={send} style={btn(true)}>
                {busy ? 'Sending…' : `Send request${to ? ` to ${to.name.split(' ')[0]}` : ''}`}
              </button>
              <button disabled={busy} onClick={onClose} style={btn(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Answer a request ─────────────────────────────────────────────────────────
// Rendered for the RECIPIENT. Deliberately never auto-accepts, and never
// hides the decline button behind a menu — a request you cannot easily refuse
// is not a request.
export function DelegationInbox({ userId, onChanged }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);

  async function load() {
    const { data, error } = await supabase.from('task_delegations')
      .select('id,task_id,from_user_id,title,note,due_date,priority,status,to_name')
      .eq('to_auth_user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); return; }
    setRows(data || []);
  }
  useEffect(() => { if (userId) load(); /* eslint-disable-next-line */ }, [userId]);

  async function accept(d) {
    setBusy(d.id); setErr(null);
    try {
      // The recipient creates their OWN task — their user_id, their row. This is
      // why per-user RLS needs no exception for delegation.
      const pmap = { high: 'A', medium: 'B', low: 'C' };
      const { data: t, error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: d.title,
        due_date: d.due_date || null,
        priority: d.priority || 'medium',
        priority_system: 'eisenhower',
        eisenhower_quadrant: pmap[d.priority || 'medium'] || 'B',
        notes: d.note ? `Accepted from a teammate — ${d.note}` : 'Accepted from a teammate.',
        assignment_method: 'delegated',
        completed: false,
      }).select().single();
      if (error) throw error;
      await supabase.from('task_delegations').update({
        status: 'accepted', mirror_task_id: t.id, responded_at: new Date().toISOString(),
      }).eq('id', d.id);
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  async function decline(d) {
    setBusy(d.id); setErr(null);
    try {
      const { error } = await supabase.from('task_delegations').update({
        status: 'declined',
        decline_reason: reason.trim() || null,
        responded_at: new Date().toISOString(),
      }).eq('id', d.id);
      if (error) throw error;
      setDeclining(null); setReason('');
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  if (!rows || !rows.length) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...lab, marginBottom: 7 }}>Asked of you — {rows.length}</div>
      {err && <div style={{ ...card, color: EMBER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {rows.map(d => (
        <div key={d.id} style={{ ...card, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.4 }}>{d.title}</div>
          {d.note && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic', margin: '6px 0 0',
              paddingLeft: 9, borderLeft: '2px solid var(--accent-dim)', lineHeight: 1.5 }}>{d.note}</div>
          )}
          {d.due_date && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontWeight: 700 }}>
              wanted by {fmtDate(d.due_date)}
            </div>
          )}

          {declining === d.id ? (
            <div style={{ marginTop: 10 }}>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                placeholder="Why not? (optional — they'll see this)"
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                  border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
                  padding: '8px 10px', fontSize: 12.5, marginBottom: 8, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 7 }}>
                <button disabled={busy === d.id} onClick={() => decline(d)} style={btn(true, 'bad')}>Send decline</button>
                <button disabled={busy === d.id} onClick={() => { setDeclining(null); setReason(''); }} style={btn(false)}>Back</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
              <button disabled={busy === d.id} onClick={() => accept(d)} style={btn(true)}>Accept</button>
              <button disabled={busy === d.id} onClick={() => setDeclining(d.id)} style={btn(false)}>Decline</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Watch what you asked for ─────────────────────────────────────────────────
// The sender's side. A decline must be LOUD — the whole risk of delegation is
// assuming something is handled when it was refused three days ago.
export function DelegationOutbox({ userId, onChanged }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    const { data } = await supabase.from('task_delegations')
      .select('id,task_id,title,to_name,status,decline_reason,due_date,responded_at')
      .eq('from_user_id', userId).in('status', ['pending', 'declined'])
      .order('created_at', { ascending: false });
    setRows(data || []);
  }
  useEffect(() => { if (userId) load(); /* eslint-disable-next-line */ }, [userId]);

  // Take it back: either you changed your mind, or they said no and it is yours
  // again. Either way the tracker on your own task has to stop lying.
  async function reclaim(d) {
    setBusy(d.id);
    await supabase.from('task_delegations')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() }).eq('id', d.id);
    if (d.task_id) await supabase.from('tasks').update({ waiting_on: null }).eq('id', d.task_id);
    await load(); onChanged && onChanged(); setBusy(null);
  }

  if (!rows || !rows.length) return null;
  const declined = rows.filter(r => r.status === 'declined');
  const pending = rows.filter(r => r.status === 'pending');

  return (
    <div style={{ marginBottom: 18 }}>
      {declined.length > 0 && (
        <>
          <div style={{ ...lab, color: EMBER, marginBottom: 7 }}>Turned down — back on you</div>
          {declined.map(d => (
            <div key={d.id} style={{ ...card, borderColor: EMBER, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{d.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 4 }}>
                {d.to_name} declined{d.decline_reason ? ` — “${d.decline_reason}”` : '.'}
              </div>
              <button disabled={busy === d.id} onClick={() => reclaim(d)}
                style={{ ...btn(false), marginTop: 9 }}>Got it — it's mine</button>
            </div>
          ))}
        </>
      )}
      {pending.length > 0 && (
        <>
          <div style={{ ...lab, color: 'var(--text-3)', marginBottom: 7, marginTop: declined.length ? 14 : 0 }}>
            Waiting on a yes — {pending.length}
          </div>
          {pending.map(d => (
            <div key={d.id} style={{ ...card, padding: '10px 12px', marginBottom: 6,
              display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
                  <b style={{ color: 'var(--accent-2)' }}>{d.to_name}</b> — {d.title}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>hasn't answered yet</div>
              </div>
              <button disabled={busy === d.id} onClick={() => reclaim(d)}
                style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>Take back</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
