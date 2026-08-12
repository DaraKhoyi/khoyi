// ContactRecordingsSection — a contact's call recordings (+ IdentifyRecording sub).
// Extracted from App.js (ContactDetailModal child).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { audioNeedsConversion, transcodeAudioToMp3, resumableUpload } from '../audio';
import IdentifyRecording from './IdentifyRecording';
import { confirmDialog } from '../notify';
import { Icon } from '../icons';

export default function ContactRecordingsSection({ contact, userId, onTranscribed }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showEnglish, setShowEnglish] = useState(true);
  const [uploadForm, setUploadForm] = useState({ open: false, title: '', firstSpeaker: 'me', recordedAt: new Date().toISOString().slice(0, 16), file: null });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('recordings')
        .select('*').eq('contact_id', contact.id).order('recorded_at', { ascending: false });
      if (!cancelled) { setRecordings(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [contact.id]);

  async function refreshRecordings() {
    const { data } = await supabase.from('recordings')
      .select('*').eq('contact_id', contact.id).order('recorded_at', { ascending: false });
    setRecordings(data || []);
  }

  // Who-said-what was decided by machine and can be wrong. One tap puts the
  // human in charge of it — cheaper and far more reliable than a second AI pass
  // guessing at the first one's mistakes (measured: a re-read of the same
  // transcript disagreed with itself, confidently, on the same file).
  async function swapSpeakers(rec) {
    const flip = (t) => String(t || '').split('\n').map(ln =>
      ln.startsWith('Me: ') ? 'Them: ' + ln.slice(4)
      : ln.startsWith('Them: ') ? 'Me: ' + ln.slice(6) : ln).join('\n');
    const segs = Array.isArray(rec.transcript_segments)
      ? rec.transcript_segments.map(sg => ({ ...sg,
          speaker: sg.speaker === 'Me' ? 'Them' : sg.speaker === 'Them' ? 'Me' : sg.speaker }))
      : rec.transcript_segments;
    await supabase.from('recordings').update({
      transcript_text: flip(rec.transcript_text),
      transcript_en: rec.transcript_en ? flip(rec.transcript_en) : null,
      transcript_segments: segs,
      speaker_id_method: 'user-corrected',
      speaker_id_confidence: 'high',
    }).eq('id', rec.id);
    await refreshRecordings();
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadForm.file) { setError('Pick an audio file first.'); return; }
    if (!uploadForm.title.trim()) { setError('Add a title.'); return; }
    if (uploadForm.file.size > 500 * 1024 * 1024) {
      setError(`File too large (${(uploadForm.file.size / 1024 / 1024).toFixed(1)} MB). Max 500 MB. For anything bigger, split it.`);
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress(5);
    try {
      let fileToUpload = uploadForm.file;
      if (audioNeedsConversion(fileToUpload)) {
        setConverting(true);
        try {
          fileToUpload = await transcodeAudioToMp3(fileToUpload, (pct) => setUploadProgress(Math.max(5, Math.round(pct * 0.55))));
        } catch (convErr) {
          const detail = (convErr && (convErr.message || (convErr.toString && convErr.toString()))) || (typeof convErr === 'string' ? convErr : '') || 'unknown error';
          throw new Error(`Couldn't convert "${uploadForm.file.name}". Check your connection and retry, or set your call recorder to save as M4A/MP3/WAV. (${detail})`);
        } finally {
          setConverting(false);
        }
        setUploadProgress(58);
      }
      const { data: rec, error: insErr } = await supabase.from('recordings').insert({
        user_id: userId,
        contact_id: contact.id,
        title: uploadForm.title.trim(),
        mime_type: fileToUpload.type || 'audio/mpeg',
        size_bytes: fileToUpload.size,
        recorded_at: new Date(uploadForm.recordedAt).toISOString(),
        first_speaker: uploadForm.firstSpeaker,
        transcription_status: 'pending',
      }).select().single();
      if (insErr) throw new Error(`DB row failed: ${insErr.message}`);

      setUploadProgress(15);

      const safeFilename = fileToUpload.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${userId}/${rec.id}/${safeFilename}`;
      try {
        if (fileToUpload.size > 25 * 1024 * 1024) {
          // Large file — resumable/chunked upload survives mobile network drops.
          await resumableUpload({ bucket: 'recordings', path, file: fileToUpload, onProgress: (frac) => setUploadProgress(15 + Math.round(frac * 58)) });
        } else {
          const { error: upErr } = await supabase.storage.from('recordings').upload(path, fileToUpload, { contentType: fileToUpload.type || 'audio/mpeg', upsert: false });
          if (upErr) throw upErr;
        }
      } catch (upErr) {
        await supabase.from('recordings').delete().eq('id', rec.id);
        throw new Error(`Upload failed: ${(upErr && upErr.message) || upErr}`);
      }

      setUploadProgress(60);
      await supabase.from('recordings').update({ storage_path: path }).eq('id', rec.id);
      setUploadProgress(75);

      supabase.functions.invoke('recording-transcribe', {
        body: { recording_id: rec.id, user_id: userId },
      }).then(async () => {
        await refreshRecordings();
        if (onTranscribed) onTranscribed();
      }).catch(() => { /* error surfaces via the row's transcription_error */ });

      setUploadProgress(100);
      setUploadForm({ open: false, title: '', firstSpeaker: 'me', recordedAt: new Date().toISOString().slice(0, 16), file: null });
      await refreshRecordings();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1500);
    }
  }

  async function retryStuck() {
    // Fires transcription for every recording orphaned in 'pending' (has audio,
    // not purged). Runs through the signed-in session, same as the per-item retry.
    // The retry cron does this automatically every 5 min; this is the manual push.
    const stuck = recordings.filter(r => r.transcription_status === 'pending' && r.storage_path && !r.audio_purged);
    if (!stuck.length) return;
    setRetrying(true);
    let ok = 0;
    for (const rec of stuck) {
      try {
        await supabase.from('recordings').update({ transcription_status: 'transcribing', transcription_error: null }).eq('id', rec.id);
        await supabase.functions.invoke('recording-transcribe', { body: { recording_id: rec.id, user_id: userId } });
        ok++;
      } catch (_) { /* leave it pending; the cron will try again */ }
    }
    await refreshRecordings();
    if (onTranscribed) onTranscribed();
    setRetrying(false);
    if (window.__notify) window.__notify(`Re-running ${ok} recording${ok !== 1 ? 's' : ''} — transcribing now.`, 'success');
  }

  async function retranscribe(rec) {
    if (rec.audio_purged) { setError('Audio has been purged — cannot re-transcribe.'); return; }
    await supabase.from('recordings').update({ transcription_status: 'transcribing', transcription_error: null }).eq('id', rec.id);
    await refreshRecordings();
    try {
      await supabase.functions.invoke('recording-transcribe', { body: { recording_id: rec.id, user_id: userId } });
      await refreshRecordings();
      if (onTranscribed) onTranscribed();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function deleteRecording(rec) {    if (!await confirmDialog(`Delete "${rec.title}"? This removes the audio AND transcript.`)) return;
    if (rec.storage_path) {
      await supabase.storage.from('recordings').remove([rec.storage_path]).catch(() => {});
    }
    await supabase.from('recordings').delete().eq('id', rec.id);
    await refreshRecordings();
  }

  function statusBadge(s) {
    const map = {
      pending: { text: 'pending', color: 'var(--text-3)', bg: 'var(--bg-card)' },
      transcribing: { text: 'transcribing…', color: 'var(--accent)', bg: 'var(--accent-glow)' },
      ready: { text: '✓ ready', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
      error: { text: '⚠ error', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
      no_audio: { text: 'no audio', color: 'var(--text-3)', bg: 'var(--bg-card)' },
    };
    const m = map[s] || map.pending;
    return <span className="pill" style={{ fontSize: '10px', padding: '2px 7px', color: m.color, background: m.bg, border: `1px solid ${m.color}` }}>{m.text}</span>;
  }

  function fmtDuration(seconds) {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div className="ww-rec" style={{ marginBottom: '14px' }}>
      <style>{`.ww-rec{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.22);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;} .ww-rec .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-rec .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="mic" size={14} /> Recordings</span> {recordings.length > 0 && <span style={{ marginLeft: '4px', color: 'var(--text-2)' }}>({recordings.length})</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {recordings.some(r => r.transcription_status === 'pending' && r.storage_path && !r.audio_purged) && (
            <button className="btn btn-ghost btn-sm" onClick={retryStuck} disabled={retrying} style={{ fontSize: '11px' }}
              title="Re-run transcription on recordings stuck before processing">
              {retrying ? 'Retrying…' : '↻ Retry stuck'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setUploadForm(f => ({ ...f, open: !f.open }))} style={{ fontSize: '11px' }}>
            {uploadForm.open ? '× Cancel' : '+ Upload audio'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 10px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', color: '#ef4444', fontSize: '11px' }}>
          {error}
        </div>
      )}

      {uploadForm.open && (
        <form onSubmit={handleUpload} style={{ padding: '12px', background: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="file"
              accept="audio/*,.amr,.3gp,.3gpp,.awb,video/mp4,video/webm"
              onChange={e => setUploadForm(f => ({ ...f, file: e.target.files?.[0] || null, title: f.title || (e.target.files?.[0]?.name.replace(/\.[^.]+$/, '') || '') }))}
              style={{ fontSize: '12px', color: 'var(--text-2)' }}
              required
            />
            <input
              className="form-input"
              placeholder="Title (e.g. 'Discovery call with Sarah')"
              value={uploadForm.title}
              onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))}
              style={{ padding: '6px 10px', fontSize: '12px' }}
              required
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-3)', display: 'block', marginBottom: '2px' }}>When recorded</label>
                <input type="datetime-local" className="form-input" value={uploadForm.recordedAt}
                  onChange={e => setUploadForm(f => ({ ...f, recordedAt: e.target.value }))}
                  style={{ padding: '6px 8px', fontSize: '12px' }} required />
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-3)', display: 'block', marginBottom: '2px' }}>Who spoke first?</label>
                <select className="form-select" value={uploadForm.firstSpeaker}
                  onChange={e => setUploadForm(f => ({ ...f, firstSpeaker: e.target.value }))}
                  style={{ padding: '6px 8px', fontSize: '12px' }}>
                  <option value="me">I did</option>
                  <option value="contact">{contact.name || 'Contact'} did</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', lineHeight: 1.5 }}>
              Max 500 MB — long, multi-hour meetings are fine. Audio kept 90 days then auto-deleted; transcript stays forever. Transcribed automatically with speaker labels (you can edit later). Phone formats like .amr are auto-converted before transcription.
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={uploading}>
                {converting ? `Converting ${uploadProgress}%…` : uploading ? `Uploading ${uploadProgress}%…` : 'Upload & transcribe'}
              </button>
              {uploadProgress > 0 && (
                <div style={{ flex: 1, height: '4px', background: 'var(--bg-card)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-3)' }}>Loading…</div>
      ) : recordings.length === 0 ? (
        <div style={{ padding: '12px', background: 'var(--bg-base)', border: '1px dashed var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-3)', textAlign: 'center' }}>
          No recordings yet. Upload a call/meeting and Claude will fold it into the behavioral signal.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {recordings.map(r => {
            const isExpanded = expandedId === r.id;
            return (
              <div key={r.id} style={{ padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{r.title}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                      {r.recorded_at && <span>{new Date(r.recorded_at).toLocaleString()}</span>}
                      {r.duration_seconds && <span>· {fmtDuration(r.duration_seconds)}</span>}
                      {r.size_bytes && <span>· {(r.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                      {r.audio_purged && <span style={{ color: '#f59e0b' }}>· audio purged</span>}
                    </div>
                  </div>
                  {statusBadge(r.transcription_status)}
                  {r.transcript_text && (
                    <button onClick={() => setExpandedId(isExpanded ? null : r.id)} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: '10px' }}>
                      {isExpanded ? 'hide' : 'view'}
                    </button>
                  )}
                  <button onClick={() => retranscribe(r)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '10px' }} title="Re-transcribe" disabled={r.audio_purged}>↻</button>
                  <button onClick={() => deleteRecording(r)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '10px', color: '#ef4444' }} title="Delete">×</button>
                </div>
                {!r.contact_id && r.transcript_text && userId && (
                  <IdentifyRecording recording={r} userId={userId}
                    onLinked={() => { try { window.dispatchEvent(new Event('prism:recording-linked')); } catch(_){} }} />
                )}
                {r.transcription_error && (
                  <div style={{ marginTop: '6px', padding: '6px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', fontSize: '10px' }}>
                    {r.transcription_error}
                  </div>
                )}
                {isExpanded && r.transcript_text && (
                  <div style={{ marginTop: '8px' }}>
                    {r.transcript_en && (
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                        <button onClick={() => setShowEnglish(true)} className="btn btn-ghost btn-sm" style={{ padding: '2px 11px', fontSize: '10px', background: showEnglish ? 'var(--accent)' : 'transparent', color: showEnglish ? '#1a1409' : 'var(--text-2)', border: '1px solid var(--accent-dim)', fontWeight: 700 }}>English</button>
                        <button onClick={() => setShowEnglish(false)} className="btn btn-ghost btn-sm" style={{ padding: '2px 11px', fontSize: '10px', background: !showEnglish ? 'var(--accent)' : 'transparent', color: !showEnglish ? '#1a1409' : 'var(--text-2)', border: '1px solid var(--accent-dim)', fontWeight: 700 }}>Original</button>
                      </div>
                    )}
                    {/* Older transcripts had Me/Them assigned by WHO SPOKE FIRST,
                        not by identifying anyone — so a call the other person
                        opened reads entirely backwards. Say so plainly and make
                        the correction one tap. */}
                    {['positional-legacy', 'unresolved'].includes(r.speaker_id_method) && /^(Me|Them):/m.test(r.transcript_text || '') && (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px', padding: '7px 9px', background: 'rgba(245,158,11,0.10)', border: '1px solid #f59e0b', borderRadius: '6px', fontSize: '10.5px', color: 'var(--text-2)', lineHeight: 1.5 }}>
                        <span style={{ flex: '1 1 190px', minWidth: 0 }}>
                          Speakers here were guessed from who spoke first, not identified — if “Me” and “Them” are reversed, fix it.
                        </span>
                        <button onClick={() => swapSpeakers(r)} className="btn btn-ghost btn-sm"
                          style={{ padding: '3px 11px', fontSize: '10px', fontWeight: 700, border: '1px solid #f59e0b', color: '#f59e0b', flex: 'none' }}>
                          Swap Me / Them
                        </button>
                      </div>
                    )}
                    {r.speaker_id_method === 'user-corrected' && (
                      <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '5px' }}>
                        Speakers corrected by you.{' '}
                        <button onClick={() => swapSpeakers(r)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '10px', padding: 0, textDecoration: 'underline' }}>swap back</button>
                      </div>
                    )}
                    <div style={{ padding: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', color: 'var(--text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '320px', overflowY: 'auto' }}>
                      {(r.transcript_en && showEnglish) ? r.transcript_en : r.transcript_text}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
