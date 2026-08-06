import React, { useEffect, useState, useRef } from 'react';
import { supabase, SUPABASE_URL } from '../dataService';

// ── CallDetail ───────────────────────────────────────────────────────────────
// A recorded call used to land in the timeline as 3,908 characters of
// "Speaker A: / Speaker B:". The timeline now carries the summary; this is what
// opens when you want the rest.
//
// Two ideas run through it:
//  1. Names, not labels. The caller ID in the Cube ACR filename tells us who the
//     other party is, so the transcript reads "Tom Mikula" and "You".
//  2. Never fake certainty. A diarizer's "A" is arbitrary — the mapping is
//     inferred, and when the model is unsure the card says so and offers a
//     one-tap swap. A confident wrong name on a quote is worse than "Speaker A".

const EMBER = '#C9563F';
const wrap = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 };

function parseUtterances(transcript) {
  // Cube ACR gives us utterances; older rows are a flat "Speaker A: ..." string.
  // Both end up as [{ speaker, text }] so the renderer only knows one shape.
  if (!transcript) return [];
  if (typeof transcript === 'object') {
    const list = transcript.utterances || transcript.dialogue || transcript.segments;
    if (Array.isArray(list)) return list.map(u => ({ speaker: String(u.speaker ?? '?'), text: String(u.text ?? '') }));
    if (typeof transcript.text === 'string') transcript = transcript.text;
  }
  if (typeof transcript !== 'string') return [];
  const out = [];
  transcript.split('\n').forEach(line => {
    const m = line.match(/^\s*Speaker\s+([A-Z0-9]+)\s*:\s*(.*)$/);
    if (m) out.push({ speaker: m[1], text: m[2] });
    else if (line.trim() && out.length) out[out.length - 1].text += ' ' + line.trim();
    else if (line.trim()) out.push({ speaker: '?', text: line.trim() });
  });
  return out;
}

export default function CallDetail({ callId, contactName, onClose }) {
  const [call, setCall] = useState(undefined);
  const [tab, setTab] = useState('transcript');
  const [swapped, setSwapped] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioErr, setAudioErr] = useState(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const urlRef = useRef(null);

  useEffect(() => { (async () => {
    const { data } = await supabase.from('quo_calls')
      .select('id,transcript,summary,speaker_map,direction,duration,op_created_at,raw,contact_id')
      .eq('id', callId).maybeSingle();
    setCall(data || null);
  })(); }, [callId]);

  // Revoke the blob when we're done — a 30-minute call is a lot of memory to
  // leave lying around on a phone.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  if (call === undefined) return <div style={{ ...wrap, padding: 16, color: 'var(--text-3)', fontSize: 12 }}>Loading call…</div>;
  if (!call) return <div style={{ ...wrap, padding: 16, color: EMBER, fontSize: 12 }}>Couldn’t load that call.</div>;

  const utts = parseUtterances(call.transcript);
  const map = call.speaker_map || {};
  const who = (spk) => {
    let role = map[spk] || (spk === 'A' ? 'contact' : 'me');
    if (swapped) role = role === 'contact' ? 'me' : 'contact';
    return role === 'contact' ? (contactName || 'Them') : 'You';
  };
  const isThem = (spk) => who(spk) !== 'You';
  const hasRecording = !!call?.raw?.cube?.drive_file_id;
  const mins = Math.round((call.duration || 0) / 60);

  async function loadAudio() {
    setLoadingAudio(true); setAudioErr(null);
    try {
      // Streamed through call-audio so the Google token never reaches the
      // browser and nobody but the owner can pull a client's recorded call.
      const { data: { session } } = await supabase.auth.getSession();
      // Guard the fetch with a timeout: on a flaky mobile connection a bare
      // fetch can hang forever, leaving the spinner stuck (reads as a lock-up).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let res;
      try {
        res = await fetch(
          `${SUPABASE_URL}/functions/v1/call-audio?call_id=${encodeURIComponent(callId)}`,
          { headers: { Authorization: `Bearer ${session?.access_token}` }, signal: ctrl.signal }
        );
      } finally { clearTimeout(timer); }
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      urlRef.current = u; setAudioUrl(u);
    } catch (e) { setAudioErr(String(e.message || e)); }
    setLoadingAudio(false);
  }

  return (
    <div style={{ ...wrap, padding: 14, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 800 }}>
          {call.direction === 'outbound' ? 'Outgoing' : 'Incoming'} call · {mins}m
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['transcript', 'recording'].map(t => (
          <button key={t} onClick={() => setTab(t)} disabled={t === 'recording' && !hasRecording}
            style={{
              background: tab === t ? 'var(--accent-glow)' : 'transparent',
              border: '1px solid ' + (tab === t ? 'var(--border-strong)' : 'var(--border)'),
              color: t === 'recording' && !hasRecording ? 'var(--text-3)' : 'var(--text-1)',
              borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 700,
              cursor: t === 'recording' && !hasRecording ? 'default' : 'pointer',
            }}>
            {t === 'transcript' ? 'Transcript' : hasRecording ? 'Recording' : 'No recording'}
          </button>
        ))}
      </div>

      {tab === 'transcript' && (
        <>
          {/* Attribution is a claim about who said what. Say how sure we are. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {call.speaker_map ? 'Speakers matched from caller ID.' : 'Speakers not matched yet.'}
            </span>
            <button onClick={() => setSwapped(s => !s)}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)',
                borderRadius: 100, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {swapped ? 'Swapped — tap to undo' : 'Wrong way round?'}
            </button>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {utts.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No transcript stored for this call.</div>}
            {utts.map((u, i) => {
              const them = isThem(u.speaker);
              const first = i === 0 || utts[i - 1].speaker !== u.speaker;
              return (
                <div key={i} style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 3, borderRadius: 2, background: them ? 'var(--accent)' : 'var(--accent-dim)', flex: 'none', opacity: first ? 1 : .35 }} />
                  <div style={{ minWidth: 0 }}>
                    {first && <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800,
                      color: them ? 'var(--accent-2)' : 'var(--text-3)', marginBottom: 2 }}>{who(u.speaker)}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-1)' }}>{u.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'recording' && hasRecording && (
        <div>
          {!audioUrl && !loadingAudio && (
            <button onClick={loadAudio}
              style={{ background: 'var(--accent-2)', color: '#1a1409', border: 'none', borderRadius: 100,
                padding: '10px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              ▶ Play the recording
            </button>
          )}
          {loadingAudio && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Fetching the audio…</div>}
          {audioErr && <div style={{ fontSize: 12, color: EMBER }}>{audioErr}</div>}
          {audioUrl && <audio controls autoPlay src={audioUrl} style={{ width: '100%' }} />}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
            Recorded on your phone, stored in your Google Drive. It streams through PrismOS — the file is never made public.
          </div>
        </div>
      )}
    </div>
  );
}
