// ClientTimeline — CRM Phase 1 (Dara, 10 Oct 2026): one phone-first feed per client.
// Calls, texts, emails, notes, journal, tasks, promises, recordings and calendar
// events, newest first, from ONE server call: public.contact_timeline (SECURITY
// INVOKER, so the live privacy rules decide what comes back — an agent's own
// clients are theirs; Company/Team Leads per tier; act-as sees no private content).
// One-tap actions: Call, Text (opens a draft — only the agent's own Send tap sends),
// Note, Task, and the voice mic. Nothing here sends anything by itself.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import QuoTextModal from './QuoTextModal';
import VoiceCapture from './VoiceCapture';

const KINDS = [
  ['all', 'All'], ['call', 'Calls'], ['text', 'Texts'], ['email', 'Email'], ['note', 'Notes'],
  ['promise', 'Promises'], ['task', 'Tasks'], ['recording', 'Recordings'], ['event', 'Meetings'], ['journal', 'Journal'],
];
const ICON = { call: '📞', text: '💬', email: '✉️', note: '📝', journal: '📓', task: '☑️', promise: '🤝', recording: '🎧', event: '📅' };
const PAGE = 40;
const gold = '#EBCB82';

function when(ts) {
  const d = new Date(ts); const now = new Date();
  const days = Math.round((now - d) / 864e5);
  if (d > now) return 'due ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days < 1) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function sub(r) {
  const m = r.meta || {};
  if (r.kind === 'call') return [r.direction === 'incoming' || r.direction === 'inbound' ? 'Incoming' : 'Outgoing', m.duration ? Math.round(m.duration / 60) + ' min' : (m.status === 'missed' || m.status === 'no-answer' ? 'Missed' : null)].filter(Boolean).join(' · ');
  if (r.kind === 'promise') return (m.owner === 'them' ? 'They promised' : 'You promised') + (m.status ? ' · ' + m.status : '');
  if (r.kind === 'task') return m.done ? 'Done' : (m.due ? 'Due ' + new Date(m.due + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Open');
  if (r.kind === 'text' || r.kind === 'email') return r.direction === 'inbound' || r.direction === 'incoming' ? 'From them' : 'From you';
  return null;
}

export default function ClientTimeline({ contact, userId }) {
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(null); // 'note' | 'task'
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState('');
  const [texting, setTexting] = useState(false);

  const load = useCallback(async (before = null) => {
    setErr('');
    const { data, error } = await supabase.rpc('contact_timeline', { p_contact: contact.id, p_before: before, p_limit: PAGE, p_kinds: kind === 'all' ? null : [kind] });
    if (error) { setErr('Couldn’t load the timeline. Pull down to retry.'); setRows(r => r || []); return; }
    setRows(r => before ? [...(r || []), ...(data || [])] : (data || []));
    setMore((data || []).length === PAGE);
  }, [contact.id, kind]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const own = contact.user_id === userId;
  const saveQuick = async () => {
    const text = draft.trim(); if (!text) return;
    const { error } = adding === 'note'
      ? await supabase.from('contact_notes').insert({ user_id: userId, contact_id: contact.id, body: text })
      : await supabase.from('tasks').insert({ user_id: userId, contact_id: contact.id, title: text, due_date: due || null, status: 'open', priority_system: 'eisenhower', assignment_method: 'self' });
    if (error) { setErr('Couldn’t save: ' + error.message); return; }
    setAdding(null); setDraft(''); setDue(''); load();
  };

  const act = { flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
  return (
    <section data-client-timeline style={{ margin: '4px 0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 8px' }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, color: 'var(--text-1)' }}>Timeline</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Everything with {contact.name?.split(' ')[0] || 'them'}, newest first</div>
      </div>
      {own && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          {contact.phone && <a data-tl-call href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} style={act}>📞 Call</a>}
          {contact.phone && <button type="button" data-tl-text style={act} onClick={() => setTexting(true)}>💬 Text</button>}
          <button type="button" data-tl-note style={act} onClick={() => { setAdding('note'); setDraft(''); }}>📝 Note</button>
          <button type="button" data-tl-task style={act} onClick={() => { setAdding('task'); setDraft(''); }}>☑️ Task</button>
          <VoiceCapture compact userId={userId} contactId={contact.id} contactName={contact.name} onSaved={() => load()} />
        </div>
      )}
      {adding && (
        <div style={{ border: '1px solid rgba(235,203,130,.4)', borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <textarea autoFocus aria-label={adding === 'note' ? 'New note' : 'New task'} rows={adding === 'note' ? 3 : 1} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={adding === 'note' ? 'What happened, what matters, next step…' : 'What needs doing?'}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 14 }} />
          {adding === 'task' && <input type="date" aria-label="Due" value={due} onChange={e => setDue(e.target.value)} style={{ marginTop: 6, minHeight: 40, background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 10px' }} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={saveQuick} style={{ ...act, flex: 'none', padding: '0 20px', background: gold, color: '#100D09', border: 'none', fontWeight: 800 }}>Save</button>
            <button type="button" onClick={() => setAdding(null)} style={{ ...act, flex: 'none', padding: '0 16px' }}>Cancel</button>
          </div>
        </div>
      )}
      <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 6, WebkitOverflowScrolling: 'touch' }}>
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} data-tl-filter={k} onClick={() => setKind(k)}
            style={{ flexShrink: 0, minHeight: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, cursor: 'pointer',
              border: '1px solid ' + (kind === k ? gold : 'var(--border)'), background: kind === k ? 'rgba(235,203,130,.14)' : 'transparent', color: kind === k ? gold : 'var(--text-2)' }}>{label}</button>
        ))}
      </div>
      {err && <div style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>{err}</div>}
      {rows === null && <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '12px 2px' }}>Loading…</div>}
      {rows && rows.length === 0 && !err && <div data-tl-empty style={{ color: 'var(--text-3)', fontSize: 13.5, padding: '14px 2px' }}>{kind === 'all' ? 'Nothing yet. Tap the mic after your next call and it lands here.' : 'Nothing of this kind yet.'}</div>}
      {(rows || []).map(r => (
        <div key={r.kind + r.item_id} data-tl-row={r.kind} style={{ display: 'flex', gap: 10, padding: '11px 2px', borderBottom: '1px solid var(--border)' }}>
          <div aria-hidden style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{ICON[r.kind] || '•'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', flexShrink: 0 }}>{when(r.at)}</div>
            </div>
            {sub(r) && <div style={{ fontSize: 11.5, color: gold, marginTop: 1 }}>{sub(r)}</div>}
            {r.body && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.body}</div>}
          </div>
        </div>
      ))}
      {more && <button type="button" onClick={() => load(rows[rows.length - 1].at)} style={{ ...act, width: '100%', marginTop: 10 }}>Show older</button>}
      {texting && <QuoTextModal contact={contact} phone={contact.phone} userId={userId} onClose={() => setTexting(false)} onSent={() => load()} />}
    </section>
  );
}
