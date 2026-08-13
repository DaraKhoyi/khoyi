// Review — call follow-ups, pending recordings and the share-recording modal.
// The post-call cleanup surfaces, grouped because they share the recording domain.
// Extracted from App.js (strangle the monolith, step 26).
import React, { useCallback, useEffect, useState } from 'react';
import { audioNeedsConversion, transcodeAudioToMp3 } from '../audio';
import { supabase } from '../dataService';
import { lbl } from '../helpers';
import { Icon } from '../icons';
import { Tip } from '../tipsUi';
import { PriorityField } from './TrackerPanels';

export function CallFollowupsPanel({ userId, contacts = [], setTasks, defaultSystem = 'eisenhower' }) {
  const [shownCalls, setShownCalls] = useState(3);   // never a wall — 3 calls at a time
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState({});

  const nameForCall = (c) => {
    if (c.contact_id) { const m = contacts.find(x => x.id === c.contact_id); if (m) return m.name; }
    return c.participant || c.from_number || c.to_number || 'Unknown caller';
  };
  const sumText = (s) => {
    if (!s) return '';
    if (Array.isArray(s)) return s.filter(Boolean).join(' · ');
    if (typeof s === 'string') return s;
    if (typeof s === 'object') return s.summary || s.text || '';
    return String(s);
  };

  const load = async () => {
    try {
      const { data } = await supabase.from('quo_calls')
        .select('id,contact_id,participant,from_number,to_number,direction,op_created_at,completed_at,duration,summary,proposed_tasks')
        .eq('user_id', userId).eq('review_status', 'pending')
        .order('op_created_at', { ascending: false });
      const mapped = (data || []).map(c => ({
        ...c,
        items: (Array.isArray(c.proposed_tasks) ? c.proposed_tasks : [])
          .map((it, i) => ({ ...it, _i: i }))
          .filter(it => (it.status || 'pending') === 'pending'),
      })).filter(c => c.items.length > 0);
      setRows(mapped);
    } catch (e) { /* keep panel hidden on error */ }
    setLoaded(true);
  };
  useEffect(() => { if (userId) load(); }, [userId]);   // eslint-disable-line

  const fullArrayFor = (call, editedItems) => {
    const base = Array.isArray(call.proposed_tasks) ? call.proposed_tasks.map(x => ({ ...x })) : [];
    for (const ed of editedItems) {
      if (ed._i != null && base[ed._i]) {
        base[ed._i] = { ...base[ed._i], title: ed.title, due_date: ed.due_date || null, priority: ed.priority, status: ed.status || base[ed._i].status || 'pending' };
      }
    }
    return base;
  };
  const persist = async (callId, fullItems) => {
    const remaining = fullItems.filter(it => (it.status || 'pending') === 'pending').length;
    await supabase.from('quo_calls').update({
      proposed_tasks: fullItems,
      review_status: remaining ? 'pending' : 'done',
      updated_at: new Date().toISOString(),
    }).eq('id', callId);
  };
  const setItem = (callId, idx, patch) => {
    setRows(rs => rs.map(c => c.id !== callId ? c : { ...c, items: c.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  };

  const approve = async (call, idx) => {
    const it = call.items[idx];
    const key = call.id + ':' + it._i;
    if (working[key]) return;
    if (!(it.title || '').trim()) return;
    setWorking(w => ({ ...w, [key]: true }));
    try {
      const contact = call.contact_id ? contacts.find(x => x.id === call.contact_id) : null;
      const qmap = { high: 'A', medium: 'B', low: 'C' };
      const occurred = call.completed_at || call.op_created_at;
      const whenStr = occurred ? new Date(occurred).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      const ctxLine = `From ${String(call.direction || '').includes('out') ? 'a call you made' : 'a call'}${contact ? ` with ${contact.name}` : ''}${whenStr ? ` on ${whenStr}` : ''}.`;
      const notes = [it.note || '', ctxLine].filter(Boolean).join('\n\n');
      const row = {
        user_id: userId, title: it.title.trim(), notes,
        due_date: it.due_date || null,
        priority: it.priority || 'medium', list: 'inbox', status: 'todo',
        priority_system: defaultSystem, eisenhower_quadrant: defaultSystem === 'eisenhower' ? (qmap[it.priority] || 'B') : null, eisenhower_rank: defaultSystem === 'eisenhower' ? 1 : null,
        contact_id: call.contact_id || null,
        waiting_on: it.owner === 'them' ? (contact ? contact.name : 'the other party') : null,
      };
      const { data, error } = await supabase.from('tasks').insert(row).select().single();
      if (error) throw error;
      if (call.contact_id && data?.id) {
        await supabase.from('task_contacts').insert({ task_id: data.id, contact_id: call.contact_id, user_id: userId });
      }
      const full = fullArrayFor(call, call.items.map((x, i) => i === idx ? { ...x, status: 'approved' } : x));
      await persist(call.id, full);
      if (setTasks && data) setTasks(prev => [data, ...prev]);
      if (window.__notify) window.__notify('Task created' + (contact ? ' · ' + contact.name : ''), 'success');
      setRows(rs => rs.map(c => c.id !== call.id ? c : { ...c, proposed_tasks: full, items: c.items.filter((_, i) => i !== idx) }).filter(c => c.items.length > 0));
    } catch (e) {
      if (window.__notify) window.__notify('Could not create task: ' + (e.message || e), 'error');
    } finally {
      setWorking(w => { const n = { ...w }; delete n[key]; return n; });
    }
  };

  const markDone = async (call, idx) => {
    const it = call.items[idx];
    const key = call.id + ':' + it._i;
    if (working[key]) return;
    if (!(it.title || '').trim()) return;
    setWorking(w => ({ ...w, [key]: true }));
    try {
      const contact = call.contact_id ? contacts.find(x => x.id === call.contact_id) : null;
      const qmap = { high: 'A', medium: 'B', low: 'C' };
      const occurred = call.completed_at || call.op_created_at;
      const whenStr = occurred ? new Date(occurred).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      const ctxLine = `From ${String(call.direction || '').includes('out') ? 'a call you made' : 'a call'}${contact ? ` with ${contact.name}` : ''}${whenStr ? ` on ${whenStr}` : ''}. Marked done on review — already handled.`;
      const notes = [it.note || '', ctxLine].filter(Boolean).join('\n\n');
      // Record it as an already-COMPLETED task: it lives in your history (so
      // "what did I get done" is accurate) without ever hitting the active list.
      const nowIso = new Date().toISOString();
      const row = {
        user_id: userId, title: it.title.trim(), notes,
        due_date: it.due_date || null,
        priority: it.priority || 'medium', list: 'inbox', status: 'done', completed_at: nowIso,
        priority_system: defaultSystem, eisenhower_quadrant: defaultSystem === 'eisenhower' ? (qmap[it.priority] || 'B') : null, eisenhower_rank: defaultSystem === 'eisenhower' ? 1 : null,
        contact_id: call.contact_id || null,
        waiting_on: it.owner === 'them' ? (contact ? contact.name : 'the other party') : null,
      };
      const { data, error } = await supabase.from('tasks').insert(row).select().single();
      if (error) throw error;
      if (call.contact_id && data?.id) {
        await supabase.from('task_contacts').insert({ task_id: data.id, contact_id: call.contact_id, user_id: userId });
      }
      const full = fullArrayFor(call, call.items.map((x, i) => i === idx ? { ...x, status: 'approved' } : x));
      await persist(call.id, full);
      if (setTasks && data) setTasks(prev => [data, ...prev]);
      if (window.__notify) window.__notify('Marked done' + (contact ? ' · ' + contact.name : ''), 'success');
      setRows(rs => rs.map(c => c.id !== call.id ? c : { ...c, proposed_tasks: full, items: c.items.filter((_, i) => i !== idx) }).filter(c => c.items.length > 0));
    } catch (e) {
      if (window.__notify) window.__notify('Could not mark done: ' + (e.message || e), 'error');
    } finally {
      setWorking(w => { const n = { ...w }; delete n[key]; return n; });
    }
  };

  const dismiss = async (call, idx) => {
    const full = fullArrayFor(call, call.items.map((x, i) => i === idx ? { ...x, status: 'dismissed' } : x));
    await persist(call.id, full);
    setRows(rs => rs.map(c => c.id !== call.id ? c : { ...c, proposed_tasks: full, items: c.items.filter((_, i) => i !== idx) }).filter(c => c.items.length > 0));
  };

  const recheck = async () => {
    if (busy) return; setBusy(true);
    try { await supabase.functions.invoke('quo-call-process', { body: {} }); } catch (e) {}
    try { await supabase.functions.invoke('calls-to-knowledge', { body: {} }); } catch (e) {}
    await load(); setBusy(false);
  };

  if (loaded && rows.length === 0) return null;
  const total = rows.reduce((n, c) => n + c.items.length, 0);
  return (
    <div className="panel" style={{ marginBottom: '16px' }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name="quo" size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0 }}>Call follow-ups to review</h3>
          {total > 0 && <span className="nav-badge">{total}</span>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={recheck} disabled={busy} title="Scan recent calls for new follow-ups">{busy ? 'Checking…' : 'Check calls'}</button>
      </div>
      {rows.slice(0, shownCalls).map(call => (
        <div key={call.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>{nameForCall(call)}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              {String(call.direction || '').includes('out') ? 'Outgoing call' : 'Incoming call'}
              {call.duration ? ` · ${Math.max(1, Math.round(call.duration / 60))}m` : ''}
              {call.op_created_at ? ` · ${new Date(call.op_created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
            </span>
          </div>
          {sumText(call.summary) && <div style={{ fontSize: '11.5px', color: 'var(--text-2)', fontStyle: 'italic', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{sumText(call.summary)}</div>}
          {call.items.map((it, idx) => {
            const key = call.id + ':' + it._i;
            const wk = !!working[key];
            return (
              <div key={idx} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', marginBottom: '8px' }}>
                <div style={{ marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '999px',
                    background: it.owner === 'them' ? 'rgba(245,158,11,0.15)' : 'rgba(197,169,94,0.14)',
                    color: it.owner === 'them' ? 'var(--yellow)' : 'var(--accent)',
                    border: `1px solid ${it.owner === 'them' ? 'var(--yellow)' : 'var(--accent)'}` }}>
                    {it.owner === 'them' ? 'Waiting on them' : 'My task'}
                  </span>
                </div>
                <input value={it.title} onChange={e => setItem(call.id, idx, { title: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '13.5px', fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-1)', marginBottom: '6px' }} />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: it.note ? '6px' : '8px' }}>
                  <input type="date" value={it.due_date || ''} onChange={e => setItem(call.id, idx, { due_date: e.target.value })}
                    style={{ padding: '6px 8px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-1)', colorScheme: 'dark' }} />
                  <PriorityField system={defaultSystem} priority={it.priority || 'medium'} onChange={v => setItem(call.id, idx, { priority: v })} className=""
                    style={{ padding: '6px 8px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-1)' }} />
                </div>
                {it.note && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '8px' }}>{it.note}</div>}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-primary btn-sm" disabled={wk || !((it.title || '').trim())} onClick={() => approve(call, idx)}>{wk ? 'Adding…' : '+ Add task'}</button>
                  <button className="btn btn-ghost btn-sm" disabled={wk || !((it.title || '').trim())} onClick={() => markDone(call, idx)} style={{ borderColor: 'var(--sage, #7fae8f)', color: 'var(--sage, #7fae8f)' }}>✓ Done</button>
                  <button className="btn btn-ghost btn-sm" disabled={wk} onClick={() => dismiss(call, idx)}>Dismiss</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {rows.length > shownCalls && (
        <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:10, flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShownCalls(n => n + 3)}>
            Show 3 more ({rows.length - shownCalls} left)
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// ARI DAILY BRIEFING
// ─────────────────────────────────────────


// ResearchProgress — the research wait is 60-90s; a static spinner reads as
// frozen. This shows the SAME animated Prism tuning fork (ambient life) plus a
// narration of the phases the research actually moves through, advancing on a
// timed cadence: done steps check off, the current step is lit. The point isn't
// a real progress bar (we can't see inside the model) — it's making a long wait
// legible, so it reads as diligence, not a hang.





// ── splitQuotedReply ─────────────────────────────────────────────────────────
// A reply body is two different things stuck together: what YOU just wrote, and
// the thread you are replying to. Rewriting the whole box rewrites the other
// person's words too — which is both wrong and, on a long thread, expensive.
//
// Returns { body, quoted } where body is the part actually being composed. The
// boundary is whichever attribution line comes FIRST, because mail clients each
// use their own and a forwarded chain can contain several.
//
// Deliberately conservative: if no boundary is recognised the whole text is
// treated as the body. Failing to split is a minor annoyance; splitting in the
// wrong place would silently drop what someone wrote.



// ─────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// PWA INSTALL PROMPT
// ─────────────────────────────────────────
// When the site is opened in a regular mobile browser tab, the URL bar,
// address bar, and tab counter eat ~110px of vertical space and constantly
// remind the user this is "just a website." Installing the PWA solves that
// — when launched from the home screen it runs without browser chrome.
//
// This component:
//   1. Hides itself entirely once running standalone (already installed)
//   2. On Android Chrome / Edge: captures beforeinstallprompt and offers a
//      one-tap Install button that fires the real browser install dialog
//   3. On iOS Safari: the event doesn't fire (Apple doesn't expose it), so
//      it shows static instructions: "Tap Share, then Add to Home Screen"
//   4. Remembers a dismissal for 7 days via localStorage so it doesn't nag

export function PendingRecordings({ userId, contacts = [], events = [], onCount, inReview }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const load = React.useCallback(async () => {
    try { const { data } = await supabase.from('pending_recordings').select('*').eq('user_id', userId).in('status', ['pending', 'error']).order('recorded_at', { ascending: false }); setPending(Array.isArray(data) ? data : []); } catch (_) {}
    setLoading(false);
  }, [userId]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { if (onCount) onCount(pending.filter(p => p.status === 'pending').length); }, [pending, onCount]);
  const checkNow = async () => {
    setSyncing(true);
    try { const { data } = await supabase.functions.invoke('dropbox-sync', { body: {} }); if (window.__notify) window.__notify(((data && data.created) || 0) + ' new recording(s) found', 'success'); } catch (_) { if (window.__notify) window.__notify('Sync failed', 'error'); }
    await load(); setSyncing(false);
  };
  const candidatesFor = (rec) => {
    const t = rec.recorded_at ? new Date(rec.recorded_at).getTime() : 0;
    const scored = new Map();
    const add = (id, name, score, reason) => { if (!id) return; const cur = scored.get(id); if (!cur || cur.score < score) scored.set(id, { contact_id: id, name, score, reason }); };
    if (t) {
      for (const ev of (events || [])) {
        const sRaw = ev.start_at || ev.start_time || ev.start; const eRaw = ev.end_at || ev.end_time || ev.end;
        const es = sRaw ? new Date(sRaw).getTime() : 0; const ee = eRaw ? new Date(eRaw).getTime() : (es ? es + 3600000 : 0);
        if (es && t >= es && t <= (ee || es)) {
          if (ev.contact_id) { const c = contacts.find(x => x.id === ev.contact_id); add(ev.contact_id, (c && c.name) || 'Contact', 100, ev.title ? ('During \u201C' + ev.title + '\u201D') : 'On your calendar then'); }
          const title = (ev.title || ev.summary || '').toLowerCase();
          const desc = (ev.description || '').toLowerCase();
          if (title || desc) for (const c of contacts) {
            if (!c.name || c.name.length <= 3) continue;
            const nl = c.name.toLowerCase();
            if (title.includes(nl)) add(c.id, c.name, 90, 'Named in the meeting');
            else if (desc.includes(nl)) add(c.id, c.name, 85, 'Named in the meeting notes');
          }
        }
      }
    }
    const recent = [...contacts].filter(c => c.last_contact_at).sort((a, b) => new Date(b.last_contact_at) - new Date(a.last_contact_at)).slice(0, 3);
    for (const c of recent) add(c.id, c.name, 20, 'Recently in touch');
    return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 4);
  };
  const confirm = async (rec, ids, depth) => {
    try { await supabase.from('pending_recordings').update({ status: 'confirmed', confirmed_contact_ids: ids, research_depth: depth }).eq('id', rec.id); } catch (_) {}
    if (window.__notify) window.__notify('Queued — transcription + research starting', 'success');
    setPending(p => p.filter(x => x.id !== rec.id));
  };
  const personal = async (rec) => { try { await supabase.from('pending_recordings').update({ status: 'personal' }).eq('id', rec.id); } catch (_) {} setPending(p => p.filter(x => x.id !== rec.id)); };
  const ignore = async (rec) => { try { await supabase.from('pending_recordings').update({ status: 'ignored' }).eq('id', rec.id); } catch (_) {} setPending(p => p.filter(x => x.id !== rec.id)); };
  const retry = async (rec) => { try { await supabase.from('pending_recordings').update({ status: 'confirmed' }).eq('id', rec.id); } catch (_) {} if (window.__notify) window.__notify('Retrying…', 'success'); setPending(p => p.filter(x => x.id !== rec.id)); };
  const dismissErr = async (rec) => { try { await supabase.from('pending_recordings').update({ status: 'ignored' }).eq('id', rec.id); } catch (_) {} setPending(p => p.filter(x => x.id !== rec.id)); };
  const pendingItems = pending.filter(p => p.status === 'pending');
  const errored = pending.filter(p => p.status === 'error');
  if (loading) return null;
  if (!inReview && pendingItems.length === 0 && errored.length === 0) return null;
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.24em', textTransform:'uppercase', color:'#CBA35C' }}>Recordings to label</div>
        <div style={{ flex:1 }} />
        <button onClick={checkNow} disabled={syncing} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>{syncing ? 'Checking…' : '↻ Check now'}</button>
      </div>
      {pendingItems.length === 0
        ? <div style={{ fontSize:13, color:'#8C8475', padding:'6px 0 4px' }}>Nothing waiting. New meeting recordings show up here to label.</div>
        : pendingItems.map(rec => <PendingCard key={rec.id} rec={rec} contacts={contacts} candidates={candidatesFor(rec)} onConfirm={confirm} onPersonal={personal} onIgnore={ignore} />)}
      {errored.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:'#e0a86f', marginBottom:8 }}>⚠ Needs attention</div>
          {errored.map(rec => (
            <div key={rec.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', marginBottom:8, borderRadius:12, background:'rgba(224,168,111,.08)', border:'1px solid rgba(224,168,111,.34)' }}>
              <span style={{ fontSize:16 }}>⚠️</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12.5, color:'#F6F1E7', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{rec.file_name}</div>
                <div style={{ fontSize:11, color:'#8C8475' }}>Couldn't process — the file may still be uploading to Dropbox.</div>
              </div>
              <button onClick={() => retry(rec)} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>Retry</button>
              <button onClick={() => dismissErr(rec)} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>Dismiss</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PendingCard({ rec, contacts, candidates, onConfirm, onPersonal, onIgnore }) {
  const [selected, setSelected] = useState(() => new Set());
  const [depth, setDepth] = useState('deep');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setSelected(sset => { const n = new Set(sset); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const searchResults = q.trim().length >= 2 ? contacts.filter(c => c.name && c.name.toLowerCase().includes(q.toLowerCase()) && !selected.has(c.id)).slice(0, 6) : [];
  const selExtras = [...selected].map(id => contacts.find(c => c.id === id)).filter(c => c && !candidates.find(cd => cd.contact_id === c.id));
  const when = rec.recorded_at ? new Date(rec.recorded_at) : null;
  const whenStr = when ? when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unknown time';
  const sizeStr = rec.size_bytes ? (rec.size_bytes > 1e6 ? (rec.size_bytes/1e6).toFixed(1)+' MB' : Math.round(rec.size_bytes/1e3)+' KB') : '';
  const pill = (on) => ({ padding:'6px 12px', borderRadius:100, fontSize:12.5, fontWeight:600, cursor:'pointer', border:'1px solid '+(on?'#CBA35C':'rgba(203,163,92,.22)'), background:on?'rgba(203,163,92,.16)':'transparent', color:on?'#EBCB82':'#C8BFAE' });
  return (
    <div style={{ border:'1px solid rgba(203,163,92,.34)', borderRadius:16, padding:'16px', marginBottom:12, background:'linear-gradient(180deg,#1B1610,#100D09)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <span style={{ fontSize:22 }}>🎙️</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:'#F6F1E7', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{rec.file_name}</div>
          <div style={{ fontSize:11.5, color:'#8C8475' }}>{whenStr}{sizeStr?' · '+sizeStr:''}</div>
        </div>
      </div>
      <PendingAudio pendingId={rec.id} />
      <div style={{ fontFamily:'Fraunces, serif', fontSize:17, color:'#F6F1E7', marginBottom:10 }}>Who did you meet with?</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:7, marginBottom:8 }}>
        {candidates.map(cd => (
          <button key={cd.contact_id} onClick={() => toggle(cd.contact_id)} style={pill(selected.has(cd.contact_id))} title={cd.reason || ''}>{cd.name}{cd.reason && !selected.has(cd.contact_id) ? <span style={{ color:'#8C8475', fontWeight:400, fontSize:10, marginLeft:5 }}>{cd.reason}</span> : null}</button>
        ))}
        {candidates.length === 0 && <span style={{ fontSize:12, color:'#8C8475' }}>No calendar match — search below.</span>}
      </div>
      {selExtras.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:7, marginBottom:8 }}>
          {selExtras.map(c => (<button key={c.id} onClick={() => toggle(c.id)} style={pill(true)}>{c.name} ✕</button>))}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search to add someone else…" className="form-input" style={{ fontSize:13, width:'100%', marginBottom: searchResults.length?4:8 }} />
      {searchResults.length > 0 && (
        <div style={{ marginBottom:8 }}>
          {searchResults.map(c => <button key={c.id} onClick={() => { toggle(c.id); setQ(''); }} className="btn btn-ghost btn-sm" style={{ display:'block', width:'100%', textAlign:'left', marginBottom:2 }}>+ {c.name}</button>)}
        </div>
      )}
      {selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, fontSize:12, color:'#8C8475', flexWrap:'wrap' }}>
          <span>Research:</span>
          <button onClick={() => setDepth('deep')} style={{ ...pill(depth==='deep'), padding:'3px 10px', fontSize:11 }}>Deep · research + DISC</button>
          <button onClick={() => setDepth('quick')} style={{ ...pill(depth==='quick'), padding:'3px 10px', fontSize:11 }}>Quick</button>
        </div>
      )}
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button onClick={async () => { setBusy(true); await onConfirm(rec, [...selected], depth); }} disabled={busy || selected.size === 0} className="btn btn-primary btn-sm" style={{ flex:1, opacity:(selected.size===0?0.5:1) }}>{busy ? 'Starting…' : 'Confirm & run'}</button>
        <button onClick={() => onPersonal(rec)} className="btn btn-ghost btn-sm" style={{ fontSize:11 }} title="File it privately — no research or DISC">Personal</button>
        <button onClick={() => onIgnore(rec)} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>Ignore</button>
      </div>
    </div>
  );
}

export function PendingAudio({ pendingId }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Lazy: only mint the link when the user actually wants to listen. With hundreds of
  // pending items we must never fetch links for a whole list.
  const load = async () => {
    if (url || busy) return;
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('pending-audio-link', { body: { pending_id: pendingId } });
      if (error) throw error;
      if (data && data.url) setUrl(data.url);
      else setErr(data && data.error === 'unsupported_provider' ? 'Playback isn’t available for this source yet.' : 'Couldn’t load this audio.');
    } catch (_) { setErr('Couldn’t load this audio — try again.'); }
    setBusy(false);
  };
  if (url) return <audio src={url} controls preload="none" style={{ width:'100%', height:36, marginBottom:10 }} />;
  return (
    <div style={{ marginBottom:10 }}>
      <button onClick={load} disabled={busy} style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'7px 13px', borderRadius:100, border:'1px solid rgba(203,163,92,.4)', background:'transparent', color:'#EBCB82', fontSize:12.5, fontWeight:700, cursor:busy?'default':'pointer' }}>
        {busy ? 'Loading…' : '▶ Listen'}
      </button>
      {err && <div style={{ fontSize:11.5, color:'#e0965a', marginTop:5 }}>{err}</div>}
    </div>
  );
}

export function ShareRecordingModal({ file, userId, contacts = [], onClose }) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [search, setSearch] = useState('');
  const [firstSpeaker, setFirstSpeaker] = useState('me');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const base = (file && file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
    setTitle(base || `Shared recording ${new Date().toLocaleDateString()}`);
  }, [file]);

  const matches = search.trim() ? contacts.filter(c => (c.name || '').toLowerCase().includes(search.toLowerCase())).slice(0, 6) : [];
  const selectedName = contactId ? (contacts.find(c => c.id === contactId) || {}).name : '';
  const sizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : '0';

  async function process() {
    if (!file) return;
    setBusy(true); setErr(''); setProgress(5); setPhase('Preparing…');
    try {
      let up = file;
      if (audioNeedsConversion(file)) {
        setPhase('Compressing audio…');
        up = await transcodeAudioToMp3(file, (pct) => setProgress(Math.max(5, Math.round(pct * 0.5))));
      }
      if (up.size > 500 * 1024 * 1024) throw new Error(`Still ${(up.size / 1024 / 1024).toFixed(0)} MB (max 500). Try splitting it.`);
      setProgress(55); setPhase('Saving…');
      const { data: rec, error: insErr } = await supabase.from('recordings').insert({
        user_id: userId, contact_id: contactId || null, title: title.trim() || 'Shared recording',
        mime_type: up.type || 'audio/mpeg', size_bytes: up.size, recorded_at: new Date().toISOString(),
        first_speaker: firstSpeaker, transcription_status: 'pending',
      }).select().single();
      if (insErr) throw new Error(insErr.message);
      const safe = (up.name || 'audio.mp3').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${userId}/${rec.id}/${safe}`;
      const { error: upErr } = await supabase.storage.from('recordings').upload(path, up, { contentType: up.type || 'audio/mpeg', upsert: false });
      if (upErr) { await supabase.from('recordings').delete().eq('id', rec.id); throw new Error(upErr.message); }
      await supabase.from('recordings').update({ storage_path: path }).eq('id', rec.id);
      setProgress(85); setPhase('Transcribing…');
      supabase.functions.invoke('recording-transcribe', { body: { recording_id: rec.id, user_id: userId } }).catch(() => {});
      setProgress(100);
      if (window.__notify) window.__notify('Recording received — transcribing now. The summary and tasks will appear shortly.', 'success');
      onClose(true);
    } catch (e) {
      setErr((e && e.message) || String(e)); setBusy(false); setProgress(0); setPhase('');
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.62)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !busy && onClose(false)}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', padding: '18px 16px 24px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icon name="quo" size={16} />
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>Share a recording</div>
          <button onClick={() => !busy && onClose(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14, wordBreak: 'break-word' }}>{file && file.name} · {sizeMB} MB — we&rsquo;ll transcribe it, summarize it, and pull out tasks.</div>

        <label className="form-label">Title</label>
        <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} />

        <label className="form-label" style={{ marginTop: 10 }}>Link to a contact (optional)</label>
        {selectedName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-hover)', borderRadius: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{selectedName}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => { setContactId(''); setSearch(''); }}>Change</button>
          </div>
        ) : (
          <>
            <input className="form-input" placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} disabled={busy} />
            {matches.map(c => (
              <button key={c.id} onClick={() => { setContactId(c.id); setSearch(''); }} disabled={busy} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 13, marginTop: 4, cursor: 'pointer' }}>{c.name}</button>
            ))}
          </>
        )}

        <label className="form-label" style={{ marginTop: 10 }}>Who speaks first?</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['me', 'Me'], ['them', 'The other person']].map(([v, lbl]) => (
            <button key={v} onClick={() => setFirstSpeaker(v)} disabled={busy} style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${firstSpeaker === v ? 'var(--accent)' : 'var(--border)'}`, background: firstSpeaker === v ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-1)', fontSize: 13 }}>{lbl}</button>
          ))}
        </div>

        {err && <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: 8, color: 'var(--red)', fontSize: 12 }}>{err}</div>}
        {busy && <div style={{ marginTop: 14 }}><div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 5 }}>{phase}</div><div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', transition: 'width .3s' }} /></div></div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy || !file} onClick={process}>{busy ? 'Working…' : 'Transcribe & summarize'}</button>
      </div>
    </div>
  );
}

export function EmailRepliesPanel() {
  const [rows, setRows] = useState([]); const [loaded, setLoaded] = useState(false);
  const load = async () => {
    try { const { data } = await supabase.from('tasks').select('id,title,reply_intent,reply_confidence,last_reply_excerpt,assignee_email').eq('reply_needs_review', true).order('last_reply_at', { ascending: false }); setRows(data || []); } catch (e) {}
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line
  const confirmDone = async (t) => { await supabase.from('tasks').update({ completed: true, status: 'done', completed_at: new Date().toISOString(), reply_needs_review: false }).eq('id', t.id); load(); };
  const dismiss = async (t) => { await supabase.from('tasks').update({ reply_needs_review: false }).eq('id', t.id); load(); };
  if (loaded && !rows.length) return null;
  return (
    <div className="panel" style={{marginBottom:'16px'}}>
      <div className="panel-header"><h3>📨 Email replies to review</h3><span className="nav-badge">{rows.length}</span></div>
      {rows.map(t => (
        <div key={t.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600}}>{t.title}</div>
          <div style={{fontSize:'11px',color:'var(--accent)',margin:'2px 0'}}>✨ Claude read it as <strong>{t.reply_intent}</strong> · {Math.round((t.reply_confidence||0)*100)}% · from {t.assignee_email}</div>
          {t.last_reply_excerpt && <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic',marginBottom:'6px',whiteSpace:'pre-wrap',maxHeight:'70px',overflowY:'auto'}}>{t.last_reply_excerpt}</div>}
          <div style={{display:'flex',gap:'6px'}}>
            <button className="btn btn-primary btn-sm" onClick={()=>confirmDone(t)}>Mark done</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>dismiss(t)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// CALL FOLLOW-UPS TO REVIEW (Quo call → task inbox)
// quo-call-process extracts commitments from each recorded call and stages
// them on quo_calls.proposed_tasks (review_status='pending'). Here the user
// edits/approves them into real tasks (linked to the matched contact) or
// dismisses them. Renders nothing when there's nothing to review.
// ─────────────────────────────────────────

export function ReviewView({ userId, contacts = [], events = [], setTasks, priorityPref, setView }) {
  const [recCount, setRecCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  React.useEffect(() => {
    (async () => {
      try { const { data: calls } = await supabase.from('quo_calls').select('proposed_tasks').eq('user_id', userId).eq('review_status', 'pending'); setTaskCount((calls || []).reduce((a, c) => a + (Array.isArray(c.proposed_tasks) ? c.proposed_tasks.length : 0), 0)); } catch (_) {}
    })();
  }, [userId]);
  const box = (n, label, icon) => (
    <div style={{ flex:1, background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.28)', borderRadius:16, padding:'15px 16px' }}>
      <div style={{ fontSize:34, fontFamily:'Fraunces, serif', fontWeight:300, color: n>0?'#EBCB82':'#8C8475', lineHeight:1 }}>{n}</div>
      <div style={{ fontSize:11.5, color:'#C8BFAE', marginTop:6 }}>{icon} {label}</div>
    </div>
  );
  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--accent:#CBA35C;--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.10), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .form-input{background:#100D09;border:1px solid rgba(203,163,92,.24);color:#F6F1E7;}`}</style>
      <h2 style={{ fontFamily:'Fraunces, serif', fontWeight:300, fontSize:30, letterSpacing:'-.02em', margin:'0 0 4px', color:'#F6F1E7' }}>Review</h2>
      <p style={{ fontSize:13, color:'#C8BFAE', margin:'0 0 14px' }}>Quick decisions Prism is waiting on. Clear these and your task list stays only what you chose to do.</p>
      <Tip id="review" label="Decide here, do in Tasks">This is Prism's inbox to you — a recording to label, a to-do it heard on a call. Confirm what's real and it graduates into <b>Tasks</b> with a priority; dismiss the rest. Your A/B/C/D list stays clean because nothing lands there until you say yes.</Tip>
      <div style={{ display:'flex', gap:12, margin:'14px 0 20px' }}>
        {box(taskCount, 'tasks to review', '📝')}
        {box(recCount, 'recordings to label', '🎙️')}
      </div>
      <div style={{ marginBottom:24 }}><PendingRecordings userId={userId} contacts={contacts} events={events} onCount={setRecCount} inReview /></div>
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.24em', textTransform:'uppercase', color:'#CBA35C', marginBottom:10 }}>Suggested tasks</div>
      <CallFollowupsPanel userId={userId} contacts={contacts} setTasks={setTasks} defaultSystem={priorityPref} />
    </div>
  );
}
