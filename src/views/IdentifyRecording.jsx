import React, { useState } from 'react';
import { supabase } from '../dataService';

// ── IdentifyRecording ────────────────────────────────────────────────────────
// The "who was in this recording?" button, for a recording with no contact linked.
// Calls recording-identify, shows ranked candidates with the reason for each, and
// links the ones you confirm. Nothing is auto-linked — a wrong link would feed a
// stranger's words into that contact's DISC read.

const EMBER = '#C9563F';
const conf = { high: '#22c55e', medium: '#C5A95E', low: '#8C8475' };

export default function IdentifyRecording({ recording, userId, onLinked }) {
  const [state, setState] = useState('idle'); // idle | working | done
  const [result, setResult] = useState(null);
  const [linked, setLinked] = useState(new Set());
  const [err, setErr] = useState('');

  async function run() {
    setState('working'); setErr('');
    try {
      const { data, error } = await supabase.functions.invoke('recording-identify', {
        body: { recording_id: recording.id, user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data); setState('done');
    } catch (e) { setErr(String(e.message || e)); setState('idle'); }
  }

  async function link(candidate) {
    // A recording carries one contact_id today; if it already has one we still
    // record the extra person as an interaction so the link isn't lost.
    try {
      if (!recording.contact_id) {
        await supabase.from('recordings').update({ contact_id: candidate.contact_id }).eq('id', recording.id);
      }
      await supabase.from('contact_interactions').insert({
        user_id: userId, contact_id: candidate.contact_id, kind: 'meeting', channel: 'recording',
        direction: 'in', occurred_at: recording.recorded_at || new Date().toISOString(),
        brief: `In a recorded meeting${result?.matched_event ? ` — ${result.matched_event.title}` : ''}`,
        entity_type: 'recording', entity_id: recording.id,
      });
      // queue a DISC read now that we know this recording is theirs
      await supabase.from('disc_analysis_queue').insert({
        user_id: userId, contact_id: candidate.contact_id, reason: 'meeting recording linked', status: 'pending',
      }).then(() => {}, () => {}); // ignore dup-queue conflicts
      setLinked(prev => new Set(prev).add(candidate.contact_id));
      onLinked && onLinked(candidate);
    } catch (e) { setErr(String(e.message || e)); }
  }

  if (state === 'idle') return (
    <div style={{ marginTop: 6 }}>
      <button onClick={run} style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 100,
        border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
        Who’s in this recording?
      </button>
      {err && <span style={{ fontSize: 11, color: EMBER, marginLeft: 8 }}>{err}</span>}
    </div>
  );

  if (state === 'working') return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>Reading names and checking your calendar…</div>
  );

  return (
    <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
      {result?.matched_event && (
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>
          Overlaps your event <b>“{result.matched_event.title}”</b>
        </div>
      )}
      {result?.candidates?.length ? (
        <>
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 7, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>
            Likely in the room — tap to confirm
          </div>
          {result.candidates.map(c => (
            <div key={c.contact_id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0' }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: conf[c.confidence], flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{c.why.join(' · ')}</div>
              </div>
              {linked.has(c.contact_id)
                ? <span style={{ fontSize: 11, color: conf.high, fontWeight: 700 }}>✓ linked</span>
                : <button onClick={() => link(c)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px',
                    borderRadius: 100, border: 'none', background: 'var(--accent-2)', color: '#1a1409', cursor: 'pointer' }}>Link</button>}
            </div>
          ))}
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
          No names spoken and no calendar match — nothing to go on for this one.
          {result?.spoken_names?.length > 0 && <> (Heard: {result.spoken_names.join(', ')}, but none match a contact.)</>}
        </div>
      )}
    </div>
  );
}
