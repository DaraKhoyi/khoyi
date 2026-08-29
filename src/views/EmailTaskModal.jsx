import React, { useState } from 'react';
import { supabase } from '../dataService';
import { snoozeOptions } from '../nbaSkips';

// Working an email down to zero needs more than reply / archive / delete.
// Most of what lands is neither "answer now" nor "gone" — it is "not yet", or
// "this is actually a job". Those two were the missing verbs:
//
//   TASK IT    an A/B/C/D task carrying the full email as its note, a due date,
//              and the email itself snoozed to reappear on that date — so the
//              task and the thing the task is about arrive together.
//   SNOOZE     the email leaves the inbox and comes back at a chosen time.
//
// Neither is new machinery. Tasks already carry email_thread_id and
// email_message_id; email_threads.snoozed_until already drives a cron that
// re-adds the INBOX label. This wires what exists onto the cards.

const QUADS = [
  { k: 'A', label: 'A', hint: 'Urgent and important — do it today' },
  { k: 'B', label: 'B', hint: 'Important, not urgent — schedule it' },
  { k: 'C', label: 'C', hint: 'Urgent, not important — delegate if you can' },
  { k: 'D', label: 'D', hint: 'Neither — do it last, or not at all' },
];

function ymd(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

// Snoozing removes INBOX at Gmail so it leaves the mailbox too, not just our
// view of it — otherwise "snoozed" means "still sitting in your inbox".
async function snoozeThreadUntil({ threadId, accountId, providerThreadId, until }) {
  if (!threadId || !until) return { ok: false, error: 'This card has no email thread attached.' };
  try {
    if (accountId && providerThreadId) {
      await supabase.functions.invoke('gmail-modify', {
        body: { account_id: accountId, thread_id: providerThreadId, action: 'archive' },
      });
    }
    const { error } = await supabase.from('email_threads')
      .update({ snoozed_until: new Date(until).toISOString() }).eq('id', threadId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

export { snoozeThreadUntil };

export default function EmailTaskModal({
  mode = 'task',          // 'task' | 'snooze'
  subject = '',
  body = '',
  fromName = '',
  contactId = null,
  threadId = null,
  accountId = null,
  providerThreadId = null,
  providerMessageId = null,
  onClose,
  onDone,
}) {
  const isSnooze = mode === 'snooze';
  const [quad, setQuad] = useState('A');
  const [title, setTitle] = useState(
    (subject ? String(subject).replace(/^\s*(re|fwd?)\s*:\s*/i, '').trim() : '') ||
    (fromName ? 'Follow up with ' + fromName : 'Follow up on this email'));
  const [notes, setNotes] = useState(String(body || '').trim());
  const [due, setDue] = useState(ymd(new Date(Date.now() + 86400000)));
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bringBack, setBringBack] = useState(true);

  const quickPicks = snoozeOptions(new Date());

  const doSnooze = async (when) => {
    setBusy(true); setErr('');
    const r = await snoozeThreadUntil({ threadId, accountId, providerThreadId, until: when });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    try {
      window.__notify && window.__notify('Snoozed until ' +
        new Date(when).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), 'success');
    } catch (_) {}
    onDone && onDone('snooze');
    onClose && onClose();
  };

  const save = async () => {
    if (!title.trim()) { setErr('Give the task a name.'); return; }
    setBusy(true); setErr('');
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u && u.user && u.user.id;
      if (!uid) { setBusy(false); setErr('Your session expired \u2014 pull down to refresh, then try again.'); return; }
      const row = {
        user_id: uid,
        title: title.trim(),
        notes: notes,                       // the whole email, not a summary
        eisenhower_quadrant: quad,
        priority_system: 'eisenhower',
        priority: quad === 'A' ? 'high' : quad === 'B' ? 'medium' : 'low',
        due_date: due,
        contact_id: contactId || null,
        // The link back to the mail, so the task is never orphaned from it.
        // These columns hold GMAIL ids, not our local uuids — verified against
        // the 21 tasks already linked this way. Writing the uuid would have
        // looked fine and silently linked to nothing.
        email_thread_id: providerThreadId || null,
        email_message_id: providerMessageId || null,
        status: 'open',
        completed: false,
      };
      const { error } = await supabase.from('tasks').insert(row);
      if (error) { setBusy(false); setErr('Could not create the task \u2014 ' + error.message); return; }

      // "Have the email come back to me on that due date."
      if (bringBack && threadId) {
        const when = new Date(due + 'T' + (time || '09:00') + ':00');
        const r = await snoozeThreadUntil({ threadId, accountId, providerThreadId, until: when });
        if (!r.ok) {
          // The task exists; be honest that only the return trip failed.
          setBusy(false);
          try { window.__notify && window.__notify('Task created, but the email could not be scheduled to return \u2014 ' + r.error, 'error'); } catch (_) {}
          onDone && onDone('task');
          onClose && onClose();
          return;
        }
      }
      setBusy(false);
      try { window.__notify && window.__notify('Task ' + quad + ' created for ' + due + (bringBack ? ' \u2014 the email comes back that morning.' : '.'), 'success'); } catch (_) {}
      onDone && onDone('task');
      onClose && onClose();
    } catch (e) {
      setBusy(false); setErr((e && e.message) || String(e));
    }
  };

  const input = { width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text-1)', fontSize: 13.5, boxSizing: 'border-box' };
  const lbl = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: 5 };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose && onClose()} style={{ zIndex: 1400 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '94%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{isSnooze ? 'Snooze this email' : 'Make this a task'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => !busy && onClose && onClose()}>{'\u2715'}</button>
        </div>

        <div style={{ padding: 16 }}>
          {isSnooze ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
                It leaves your inbox now and comes back then, as if it had just arrived.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
                {quickPicks.map(o => (
                  <button key={o.key} type="button" disabled={busy} onClick={() => doSnooze(o.when)}
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 12px', color: 'var(--text-2)', fontSize: 12.5, cursor: 'pointer' }}>
                    {o.label}
                  </button>
                ))}
              </div>
              <label style={lbl}>Or pick a date and time</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...input, flex: 2 }} />
                <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...input, flex: 1 }} />
              </div>
            </>
          ) : (
            <>
              <label style={lbl}>Priority</label>
              <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
                {QUADS.map(q => (
                  <button key={q.k} type="button" title={q.hint} onClick={() => setQuad(q.k)}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer', fontWeight: 800, fontSize: 14,
                      border: '1px solid ' + (quad === q.k ? '#EBCB82' : 'var(--border)'),
                      background: quad === q.k ? 'rgba(235,203,130,.16)' : 'transparent',
                      color: quad === q.k ? '#EBCB82' : 'var(--text-3)' }}>
                    {q.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: -8, marginBottom: 14 }}>
                {(QUADS.find(q => q.k === quad) || {}).hint}
              </div>

              <label style={lbl}>Task</label>
              <input value={title} onChange={e => setTitle(e.target.value)} style={{ ...input, marginBottom: 14 }} />

              <label style={lbl}>Due</label>
              <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...input, marginBottom: 14 }} />

              <label style={lbl}>Notes {'\u00B7'} the full email, edit freely</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8}
                style={{ ...input, marginBottom: 12, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />

              {threadId ? (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text-2)', cursor: 'pointer', lineHeight: 1.45 }}>
                  <input type="checkbox" checked={bringBack} onChange={e => setBringBack(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    Bring the email back on the due date
                    <span style={{ color: 'var(--text-3)' }}>{' \u2014 it leaves your inbox until then, so the task is the only thing asking for you.'}</span>
                  </span>
                </label>
              ) : null}
            </>
          )}

          {err ? <div style={{ marginTop: 12, fontSize: 12, color: '#fca5a5', lineHeight: 1.4 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => onClose && onClose()}>Cancel</button>
            {isSnooze ? (
              <button className="btn btn-primary" disabled={busy}
                onClick={() => doSnooze(new Date(due + 'T' + (time || '09:00') + ':00'))}>
                {busy ? 'Snoozing\u2026' : 'Snooze'}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving\u2026' : 'Create task'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
