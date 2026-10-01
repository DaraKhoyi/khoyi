import React, { useState } from 'react';
import { supabase } from '../dataService';

// LIBRARY: LISTEN, OPEN, READ (30 Sep 2026).
//
// Dara shared Ricky Caruth's talk — the cleaned recording, its transcript and a
// summary — "available to everyone using the app". The library listed shared
// items but gave no way to play, open or read them, and the storage rule let
// only the owner fetch a file. Now (supabase/sql/2026-09-30_library_shared_talks.sql)
// anyone who can see a library entry can open its file, and this gives them the
// three things they need: Listen (audio plays here), Open (the original file),
// Read (the full text — a transcript with speakers and times).

const btn = { fontSize: '11px', padding: '3px 9px', minHeight: 32, borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' };

export default function LibraryOpen({ s }) {
  const [audio, setAudio] = useState(null);
  const [text, setText] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAudio = s.source_type === 'audio' || String(s.mime_type || '').startsWith('audio/');

  async function signed() {
    const { data, error } = await supabase.storage.from('knowledge').createSignedUrl(s.original_path, 60 * 60);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open the file');
    return data.signedUrl;
  }
  async function listen() {
    if (audio) { setAudio(null); return; }
    setBusy(true);
    try { setAudio(await signed()); } catch (e) { if (window.__notify) window.__notify(String(e.message || e), 'error'); }
    setBusy(false);
  }
  async function open() {
    setBusy(true);
    try { window.open(await signed(), '_blank', 'noopener'); } catch (e) { if (window.__notify) window.__notify(String(e.message || e), 'error'); }
    setBusy(false);
  }
  async function read() {
    if (text !== null) { setText(null); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from('knowledge_sources').select('extracted_text').eq('id', s.id).maybeSingle();
      if (error) throw error;
      setText(data?.extracted_text || 'No text yet.');
    } catch (e) { if (window.__notify) window.__notify('Could not load the text: ' + (e.message || e), 'error'); }
    setBusy(false);
  }

  return (
    <>
      {s.original_path && isAudio && <button type="button" disabled={busy} onClick={listen} style={btn}>{audio ? 'Hide player' : 'Listen'}</button>}
      {s.original_path && !isAudio && <button type="button" disabled={busy} onClick={open} style={btn}>Open file</button>}
      {s.status === 'ready' && <button type="button" disabled={busy} onClick={read} style={btn}>{text !== null ? 'Hide text' : (isAudio ? 'Read transcript' : 'Read')}</button>}
      {(audio || text !== null) && (
        <div style={{ flexBasis: '100%', order: 99, marginTop: 8 }}>
          {audio && <audio controls preload="metadata" src={audio} style={{ width: '100%' }} />}
          {text !== null && (
            <div style={{ marginTop: audio ? 8 : 0, maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6,
              color: 'var(--text-1)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>{text}</div>
          )}
        </div>
      )}
    </>
  );
}
