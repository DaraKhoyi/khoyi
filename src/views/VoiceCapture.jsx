// VoiceCapture — CRM Phase 1 voice-first logging (Dara, 10 Oct 2026).
// One big gold mic. Talk ~20 seconds; the existing voice-note function transcribes
// it (AssemblyAI) and turns it into a note plus suggested task and promise cards.
// Every card has Edit and Cancel; NOTHING is saved until the agent taps Save, and
// nothing is ever sent to anyone (no text, no email). Save calls save_voice_note
// (SECURITY INVOKER: only onto the agent's own contact). Failed uploads stay on the
// phone (outbox) and retry, so a dead zone never loses a memo.
import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../dataService';
import { enqueue } from '../outbox';
import { pendingVoiceReviews, dropVoiceReview } from '../lib/voiceReviews';

const gold = '#EBCB82';
const lbl = { fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 };
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 14, lineHeight: 1.45 };
const btn = (primary) => ({ minHeight: 48, borderRadius: 12, padding: '0 20px', fontSize: 15, fontWeight: primary ? 800 : 500, cursor: 'pointer',
  background: primary ? gold : 'transparent', color: primary ? '#100D09' : 'var(--text-2)', border: primary ? 'none' : '1px solid var(--border)' });

function Card({ item, kind, onChange, onCancel }) {
  const [edit, setEdit] = useState(false);
  return (
    <div data-voice-card={kind} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 10.5, color: gold, textTransform: 'uppercase', letterSpacing: '.06em' }}>{kind === 'promise' ? (item.owner === 'them' ? 'They promised' : 'You promised') : 'Task'}</div>
      {edit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input aria-label="Title" value={item.title || ''} onChange={e => onChange({ ...item, title: e.target.value })} style={field} />
          <input aria-label="Due" type="date" value={item.due || ''} onChange={e => onChange({ ...item, due: e.target.value })} style={field} />
        </div>
      ) : (
        <div style={{ fontSize: 14.5, color: 'var(--text-1)', marginTop: 2 }}>{item.title}{item.due && <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}> · due {new Date(item.due + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={{ ...btn(false), minHeight: 40, padding: '0 14px', fontSize: 13.5 }} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        <button type="button" style={{ ...btn(false), minHeight: 40, padding: '0 14px', fontSize: 13.5 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function VoiceReview({ result, transcript, onSave, onDiscard, busy }) {
  const [note, setNote] = useState(result?.note || transcript || '');
  const [tasks, setTasks] = useState((result?.tasks || []).filter(t => t && t.title));
  const [promises, setPromises] = useState((result?.promises || []).filter(t => t && t.title));
  return (
    <div data-voice-review>
      <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 22, color: 'var(--text-1)' }}>Here’s what I heard.</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '2px 0 14px' }}>Nothing is saved until you tap Save. Nothing is sent to anyone.</div>
      {result?.contact_name && <div style={{ marginBottom: 12 }}><div style={lbl}>About</div>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-1)' }}>{result.contact_name}{!result.contact_id && <span style={{ fontSize: 11.5, color: gold, fontWeight: 400 }}> · not matched — the note won’t attach to a contact</span>}</div></div>}
      {result?.capped && <div style={{ fontSize: 12.5, color: gold, marginBottom: 10 }}>You’ve reached this month’s AI allowance, so this is the plain transcript. Suggestions return on the 1st.</div>}
      <div style={lbl}>Note</div>
      <textarea aria-label="Note" value={note} onChange={e => setNote(e.target.value)} rows={4} style={{ ...field, marginBottom: 12 }} />
      {promises.length > 0 && <div style={lbl}>Promises ({promises.length})</div>}
      {promises.map((p, i) => <Card key={'p' + i} kind="promise" item={p} onChange={v => setPromises(promises.map((x, j) => j === i ? v : x))} onCancel={() => setPromises(promises.filter((_, j) => j !== i))} />)}
      {tasks.length > 0 && <div style={{ ...lbl, marginTop: 6 }}>Tasks ({tasks.length})</div>}
      {tasks.map((t, i) => <Card key={'t' + i} kind="task" item={t} onChange={v => setTasks(tasks.map((x, j) => j === i ? v : x))} onCancel={() => setTasks(tasks.filter((_, j) => j !== i))} />)}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="button" disabled={busy} style={{ ...btn(true), flex: 1 }} onClick={() => onSave({ note, tasks, promises })}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" style={btn(false)} onClick={onDiscard}>Cancel</button>
      </div>
    </div>
  );
}

export default function VoiceCapture({ userId, contactId = null, contactName = '', onSaved, compact = false }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | working | review | done | error
  const [secs, setSecs] = useState(0);
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [queued, setQueued] = useState([]);   // retried offline notes waiting for review
  const [fromQueue, setFromQueue] = useState(null);
  useEffect(() => {
    if (compact || !userId) return undefined;
    const sync = () => setQueued(pendingVoiceReviews(userId));
    sync(); window.addEventListener('voice-reviews', sync);
    return () => window.removeEventListener('voice-reviews', sync);
  }, [compact, userId]);
  const openQueued = () => { const q = queued[0]; if (!q) return; setFromQueue(q.id); setData({ transcript: q.transcript, result: q.result }); setPhase('review'); };
  const finishQueued = () => { if (fromQueue) { dropVoiceReview(userId, fromQueue); setFromQueue(null); } };
  const rec = useRef(null); const chunks = useRef([]); const timer = useRef(null); const cancelled = useRef(false);

  const start = async () => {
    setMsg(''); cancelled.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); chunks.current = [];
      mr.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); if (!cancelled.current) process(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })); };
      mr.start(); rec.current = mr; setSecs(0); setPhase('recording');
      timer.current = setInterval(() => setSecs(s => { if (s >= 119) stop(); return s + 1; }), 1000);
    } catch (_) { setMsg('PrismOS needs microphone access to record a voice note.'); setPhase('error'); }
  };
  const stop = () => { clearInterval(timer.current); try { rec.current && rec.current.state !== 'inactive' && rec.current.stop(); } catch (_) {} setPhase('working'); };
  const cancel = () => { cancelled.current = true; clearInterval(timer.current); try { rec.current && rec.current.state !== 'inactive' && rec.current.stop(); } catch (_) {} setPhase('idle'); };

  const process = async (blob) => {
    let b64 = null;
    try {
      b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const { data: d, error } = await supabase.functions.invoke('voice-note', { body: { audio_base64: b64, contact_id: contactId } });
      if (error || d?.error) throw new Error(d?.error || 'Could not process the note');
      if (d.empty) { setMsg('I couldn’t hear anything. Try again a little closer to the phone.'); setPhase('error'); return; }
      setData({ ...d, result: { ...(d.result || {}), capped: !!d.capped } }); setPhase('review');
    } catch (e) {
      try { await enqueue(userId, 'voice_note', { audio_base64: b64, contact_id: contactId }, 'Voice note'); setMsg('Couldn’t process it right now (' + (e.message || 'error') + '). It’s saved on your phone and will retry, nothing is lost.'); }
      catch (_) { setMsg((e.message || 'Something went wrong') + '. The recording could not be kept on this device.'); }
      setPhase('error');
    }
  };

  const save = async ({ note, tasks, promises }) => {
    setPhase('saving');
    const { error } = await supabase.rpc('save_voice_note', { p_contact: data?.result?.contact_id || contactId || null, p_note: note, p_tasks: tasks, p_promises: promises });
    if (error) { setMsg('Could not save: ' + error.message); setPhase('error'); return; }
    finishQueued(); setPhase('done'); onSaved && onSaved(); setTimeout(() => { setPhase('idle'); setData(null); }, 1500);
  };

  const mic = (
    <button type="button" data-voice-mic onClick={phase === 'idle' ? start : undefined} aria-label={contactName ? 'Voice note about ' + contactName : 'Record a voice note'}
      style={{ width: compact ? 56 : 76, height: compact ? 56 : 76, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
        background: phase === 'done' ? '#22c55e' : 'linear-gradient(150deg,#EBCB82,#C5A95E)', color: '#100D09', fontSize: compact ? 24 : 32, boxShadow: '0 8px 22px rgba(197,169,94,.35)' }}>
      {phase === 'done' ? '✓' : '🎙'}
    </button>
  );
  const open = ['recording', 'working', 'review', 'saving', 'error'].includes(phase);
  return (
    <>
      {compact ? mic : (
        <div data-voice-hero style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', border: '1px solid rgba(235,203,130,.35)', borderRadius: 16, background: 'rgba(235,203,130,.06)', margin: '6px 0 12px' }}>
          {mic}
          <div><div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, color: 'var(--text-1)' }}>{phase === 'done' ? 'Filed.' : 'Just talk.'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.4 }}>Say who, what happened, and what’s next. I’ll write the note and suggest the tasks and promises.</div></div>
        </div>
      )}
      {!compact && queued.length > 0 && phase === 'idle' && (
        <button type="button" data-voice-queued onClick={openQueued} style={{ ...btn(false), width: '100%', marginBottom: 12, borderColor: 'rgba(235,203,130,.5)', color: gold }}>
          🎙 {queued.length === 1 ? '1 voice note' : queued.length + ' voice notes'} recorded offline, ready to review
        </button>
      )}
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-base)', width: '100%', maxWidth: 560, borderRadius: '18px 18px 0 0', border: '1px solid var(--border)', padding: '20px 18px 30px', maxHeight: '92vh', overflowY: 'auto' }}>
            {phase === 'recording' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ ...lbl, color: gold, fontSize: 12 }}>Listening{contactName ? ' · ' + contactName : ''}</div>
                <div style={{ width: 96, height: 96, borderRadius: '50%', margin: '10px auto 12px', border: '2px solid ' + gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, animation: 'livePulse 1.4s ease-in-out infinite' }}>🎙</div>
                <div style={{ fontSize: 28, fontFamily: "'Fraunces',serif", color: 'var(--text-1)' }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
                  <button type="button" style={btn(true)} onClick={stop}>Done</button>
                  <button type="button" style={btn(false)} onClick={cancel}>Cancel</button>
                </div>
              </div>
            )}
            {(phase === 'working' || phase === 'saving') && <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-1)' }}>{phase === 'working' ? 'Writing it up…' : 'Saving…'}</div>}
            {phase === 'error' && <div style={{ textAlign: 'center', padding: '18px 0' }}><div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 14 }}>{msg}</div><button type="button" style={btn(false)} onClick={() => setPhase('idle')}>Close</button></div>}
            {phase === 'review' && data && <VoiceReview result={data.result} transcript={data.transcript} busy={false} onSave={save} onDiscard={() => { finishQueued(); setPhase('idle'); setData(null); }} />}
          </div>
        </div>
      )}
    </>
  );
}
