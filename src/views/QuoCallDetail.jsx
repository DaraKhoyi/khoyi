// QuoCallDetail — self-loading AI summary + transcript for a Quo call.
// Extracted from App.js (strangle, first component move). Only dep is quoCall.
import React, { useState, useEffect } from 'react';
import { quoCall } from '../quo';

export default function QuoCallDetail({ callId }) {
  const [summary, setSummary] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, t] = await Promise.allSettled([
          quoCall(`/v1/call-summaries/${callId}`),
          quoCall(`/v1/call-transcripts/${callId}`),
        ]);
        if (!alive) return;
        if (s.status === 'fulfilled') setSummary(s.value?.data || null);
        if (t.status === 'fulfilled') setTranscript(t.value?.data || null);
      } catch (e) { if (alive) setErr(String(e.message || e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [callId]);
  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 0' }}>Loading call details…</div>;
  const sum = summary?.summary;
  const steps = summary?.nextSteps;
  const dialogue = transcript?.dialogue;
  if (!sum && !(steps && steps.length) && !(dialogue && dialogue.length)) {
    return <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 0' }}>No summary or transcript available (Business/Scale plan feature, or still processing).</div>;
  }
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sum && (<div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>AI SUMMARY</div><div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>{sum}</div></div>)}
      {Array.isArray(steps) && steps.length > 0 && (<div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>NEXT STEPS</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-1)' }}>{steps.map((x, i) => <li key={i}>{typeof x === 'string' ? x : x.text || JSON.stringify(x)}</li>)}</ul></div>)}
      {Array.isArray(dialogue) && dialogue.length > 0 && (
        <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>TRANSCRIPT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {dialogue.map((seg, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{seg.identifier || seg.speaker || 'Speaker'}: </span>
                <span style={{ color: 'var(--text-1)' }}>{seg.content || seg.text || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}
