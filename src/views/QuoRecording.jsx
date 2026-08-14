// ── QuoRecording — the call-audio player, with a self-healing link ────────────
//
// WHY THIS FILE EXISTS
//
// Quo (OpenPhone) does not hand us a permanent address for call audio. It hands
// us a SIGNED link — https://share.quo.com/...?sig=… — that is valid for a while
// and then stops working. If we simply stored that link and rendered it, every
// recording would play beautifully for a few days and then quietly turn into a
// broken player, which is worse than no player at all.
//
// So: we store the link (cheap, no audio duplication, nothing to purge), and if
// it has gone stale by the time someone presses play, we ask Quo for a fresh one,
// swap it in, and write the new link back so the next person doesn't pay the
// round-trip. The listener sees a brief "getting the audio" and then it plays.
//
// The one thing we do NOT do is pretend. If Quo no longer has the recording at
// all, we say so plainly rather than leaving a dead control on the screen.
//
// ONE RULE, ONE PLACE: every place in the app that plays Quo call audio renders
// THIS component. Do not inline an <audio src={call.recording_url}> anywhere —
// that is the version that breaks silently in a fortnight.

import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../dataService';
import { quoCall } from '../quo';

export default function QuoRecording({ call }) {
  const [url, setUrl] = useState(call?.recording_url || null);
  // idle → the link we have looks fine. refreshing → asking Quo for a new one.
  // gone → Quo has no recording for this call. failed → we couldn't reach Quo.
  const [state, setState] = useState('idle');
  const triedRef = useRef(false);   // only ever re-mint once per mount
  const audioRef = useRef(null);

  const opId = call?.op_id || null;
  const rowId = call?.id || null;

  // The <audio> element failed to load the source. Nearly always an expired
  // signature; occasionally the recording is genuinely gone. Ask Quo which.
  const handleError = useCallback(async () => {
    if (triedRef.current || !opId) { setState('failed'); return; }
    triedRef.current = true;
    setState('refreshing');
    try {
      const res = await quoCall('/v1/call-recordings/' + opId);
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      const fresh = list.length ? (list[0].url || null) : null;
      if (!fresh) { setState('gone'); return; }

      setUrl(fresh);
      setState('idle');
      // Persist so the next listener doesn't repeat the round-trip. Best-effort:
      // if the write fails, playback still works for this session — but CHECK the
      // error rather than discarding it (supabase-js resolves, it does not throw).
      if (rowId) {
        const { error } = await supabase
          .from('quo_calls')
          .update({ recording_url: fresh, updated_at: new Date().toISOString() })
          .eq('id', rowId);
        if (error) console.warn('QuoRecording: could not cache refreshed link', error.message);
      }
      // Point the element at the new source and try again.
      requestAnimationFrame(() => { try { audioRef.current && audioRef.current.load(); } catch (_) {} });
    } catch (e) {
      console.warn('QuoRecording: refresh failed', String(e && e.message ? e.message : e));
      setState('failed');
    }
  }, [opId, rowId]);

  if (!url && state === 'idle') return null;

  const note =
    state === 'refreshing' ? 'Fetching a fresh link from Quo…'
      : state === 'gone' ? 'Quo no longer has the audio for this call. The transcript below is unaffected.'
        : state === 'failed' ? "Couldn't load the audio just now. The transcript below is unaffected."
          : null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 4, letterSpacing: '0.04em' }}>
        &#9654; RECORDING
      </div>
      {(state === 'idle' || state === 'refreshing') && url && (
        <audio
          ref={audioRef}
          controls
          preload="none"
          src={url}
          onError={handleError}
          style={{ width: '100%', height: 36, opacity: state === 'refreshing' ? 0.5 : 1 }}
        />
      )}
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>{note}</div>
      )}
    </div>
  );
}
