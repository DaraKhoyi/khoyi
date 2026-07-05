import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../App';

const KIND_LABEL = { task: 'Task', call: 'Call follow-up', deadline: 'Deadline', deal: 'Deal', appointment: 'Appointment', reply: 'Reply', reengage: 'Reconnect', review_ask: 'Review & referral', recruit: 'Recruiting', agent_plan: 'New-lead plan', owe_reply: 'Owe a reply' };
const ACT_LABEL = { open_task: 'Open', create_task: 'Add task', review_call: 'Review', review_deal: 'Open deal', open_event: 'View', review: 'Open', open_agentruns: 'Review', reply_contact: 'Reply' };
const PRI = { 1: { c: 'var(--red)', t: 'Urgent' }, 2: { c: 'var(--accent)', t: 'Important' }, 3: { c: 'var(--text-3)', t: 'When you can' } };

export default function ChiefOfStaffView({ userId, setView, setFocusTaskId, setFocusEventId, onOpenPlan }) {
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: q }, { data: s }] = await Promise.all([supabase.rpc('my_cos_queue'), supabase.rpc('my_cos_summary')]);
      setRows(Array.isArray(q) ? q : []);
      setSummary(typeof s === 'string' ? s : '');
    } catch (e) { setErr(String(e)); setRows([]); }
  }, []);
  useEffect(() => { load(); return () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} }; }, [load]);

  async function refresh() {
    setBusy(true); setErr('');
    try { await supabase.functions.invoke('chief-of-staff', { body: {} }); } catch (e) { setErr('Could not refresh — try again in a moment.'); }
    await load(); setBusy(false);
  }
  function listen() {
    try {
      if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
      if (!summary) return;
      const u = new SpeechSynthesisUtterance(summary); u.rate = 1.02; u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u); setSpeaking(true);
    } catch (_) {}
  }
  async function mark(id, status) { try { await supabase.from('cos_actions').update({ status, acted_at: new Date().toISOString() }).eq('id', id); } catch (_) {} load(); }
  async function act(a) {
    const p = a.action_payload || {};
    if (a.action_type === 'create_task') { try { await supabase.from('tasks').insert({ user_id: userId, title: p.title || a.title, due_date: p.due_date || null, priority: p.priority || 'medium', completed: false, list: 'inbox', notes: 'Added by your Chief of Staff' }); } catch (_) {} await mark(a.id, 'done'); return; }
    // navigation actions: go there and leave the item in the queue until you actually finish it
    if (a.action_type === 'open_task' && p.task_id) { setFocusTaskId && setFocusTaskId(p.task_id); setView && setView('tasks'); }
    else if (a.action_type === 'open_task') { setView && setView('tasks'); }
    else if (a.action_type === 'review_call') { setView && setView('tasks'); }
    else if (a.action_type === 'review_deal') { setView && setView('pipeline'); }
    else if (a.action_type === 'open_event' && p.event_id) { setFocusEventId && setFocusEventId(p.event_id); setView && setView('calendar'); }
    else if (a.action_type === 'open_agentruns') { setView && setView('agentruns'); }
    else if (a.action_type === 'reply_contact') {
      if (p.email) { try { window.__inboxOpenEmail = p.email; } catch (_) {} setView && setView('inbox'); }
      else { try { await supabase.from('tasks').insert({ user_id: userId, title: 'Reply to ' + (p.name || a.title), priority: 'high', completed: false, list: 'inbox', notes: 'They reached out and are waiting on you.' }); } catch (_) {} await mark(a.id, 'done'); }
    }
  }

  const pending = (rows || []).filter(r => r.status === 'pending');
  const obligations = pending.filter(r => r.bucket !== 'growth');
  const growth = pending.filter(r => r.bucket === 'growth');
  const done = (rows || []).filter(r => r.status !== 'pending');
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });

  const Card = (a, growthStyle) => {
    const pri = PRI[a.priority] || PRI[2];
    return (
      <div key={a.id} className="panel" style={{ marginTop: '10px', borderLeft: `3px solid ${growthStyle ? 'var(--accent)' : pri.c}` }}>
        <div className="panel-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            {!growthStyle && <span style={{ fontSize: '10px', fontWeight: 700, color: pri.c, textTransform: 'uppercase', letterSpacing: '.04em' }}>{pri.t}</span>}
            <span style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-hover)', borderRadius: '6px', padding: '1px 7px' }}>{KIND_LABEL[a.kind] || a.kind}</span>
          </div>
          <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</div>
          {a.why && <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '4px', lineHeight: 1.45 }}>{a.why}</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn btn-primary btn-sm" onClick={() => act(a)}>{ACT_LABEL[a.action_type] || 'Do it'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => mark(a.id, 'done')}>Mark done</button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--text-3)' }} onClick={() => mark(a.id, 'dismissed')}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><span>💼</span> Chief of Staff</h2>
          <div style={{ fontSize: '12.5px', color: 'var(--text-3)', marginTop: '2px' }}>{today}</div>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={refresh} title="Re-scan now">{busy ? 'Scanning…' : <><Icon name="refresh" size={13} /> Refresh</>}</button>
      </div>

      {summary && (
        <div className="panel" style={{ marginTop: '12px', background: 'linear-gradient(180deg, rgba(197,169,94,0.08), transparent)' }}>
          <div className="panel-body" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-1)', lineHeight: 1.5, flex: 1 }}>{summary}</div>
            <button className="btn btn-ghost btn-sm" onClick={listen} title="Listen">{speaking ? <>■</> : <Icon name="volume" size={14} />}</button>
          </div>
        </div>
      )}

      {rows === null && <div style={{ color: 'var(--text-3)', fontSize: '13px', padding: '18px 2px' }}>Loading your day…</div>}
      {err && <div style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>{err}</div>}

      {rows && obligations.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>What needs you</div>
          {obligations.map(a => Card(a, false))}
        </div>
      )}

      {rows && growth.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: '6px' }}><span>📈</span> Growth plays for today</div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }}>Nothing on fire here — these are the highest-value ways to move the business forward.</div>
          {growth.map(a => Card(a, true))}
        </div>
      )}

      {rows && obligations.length === 0 && growth.length === 0 && (
        <div className="panel" style={{ marginTop: '14px' }}><div className="panel-body" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-1)' }}>You're clear for now. ✨</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '6px' }}>Nothing needs a decision right now. Tap Refresh after calls or emails come in, and I'll line up what's next.</div>
        </div></div>
      )}

      {onOpenPlan && (
        <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'center' }}>
          <button className="btn btn-ghost" onClick={onOpenPlan}><Icon name="briefing" size={14} /> &nbsp;Plan my day — arrange this into an order</button>
        </div>
      )}

      {rows && done.length > 0 && (
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Handled today ({done.length})</div>
          {done.map(a => (
            <div key={a.id} style={{ fontSize: '12.5px', color: 'var(--text-3)', padding: '4px 2px', textDecoration: a.status === 'dismissed' ? 'line-through' : 'none' }}>{a.status === 'done' ? '✓' : '—'} {a.title}</div>
          ))}
        </div>
      )}
    </div>
  );
}
