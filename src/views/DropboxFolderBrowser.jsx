// DropboxFolderBrowser — settings panel extracted from App.js (strangle).
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { createPortal } from 'react-dom';
import PrismThinking from './PrismThinking';

export default function DropboxFolderBrowser({ connectionId, onClose, onPick }) {
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState([]);
  const [audioCount, setAudioCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const browse = React.useCallback(async (p) => {
    setLoading(true); setErr('');
    try {
      const { data, error } = await supabase.functions.invoke('dropbox-browse', { body: { connection_id: connectionId, path: p } });
      if (error || (data && data.error)) { setErr((data && data.error) || 'Could not list folders'); setFolders([]); }
      else { setFolders(data.folders || []); setAudioCount(data.audioCount || 0); setPath(p); }
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, [connectionId]);
  React.useEffect(() => { browse(''); }, [browse]);
  const parent = () => { const parts = path.split('/').filter(Boolean); parts.pop(); browse(parts.length ? '/' + parts.join('/') : ''); };
  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2600 }}>
      <div className="modal ww-prism" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '94%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#100D09' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 6, color: '#CBA35C', fontSize: 10, letterSpacing: '.24em', fontWeight: 700 }}>PICK A FOLDER TO WATCH</div>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, color: '#F6F1E7' }}>Dropbox</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, wordBreak: 'break-all' }}>{path || '/ (root)'}</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {path && <button onClick={parent} className="btn btn-ghost btn-sm" style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}>⬑ Up a level</button>}
          {loading ? <div style={{ padding: 20, textAlign: 'center' }}><PrismThinking label="Reading Dropbox" /></div>
            : err ? <div style={{ padding: 16, color: 'var(--red)', fontSize: 12 }}>{err}</div>
            : folders.length === 0 ? <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12.5 }}>No subfolders here.{audioCount > 0 ? ` ${audioCount} audio file(s) in this folder.` : ''}</div>
            : folders.map(fd => (
              <button key={fd.path} onClick={() => browse(fd.path)} className="btn btn-ghost btn-sm" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span>📁</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fd.name}</span><span style={{ color: 'var(--text-3)' }}>›</span>
              </button>
            ))}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, fontSize: 11.5, color: 'var(--text-3)' }}>{audioCount > 0 ? `${audioCount} recording(s) here now` : 'Watch the folder your recorder syncs to'}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button onClick={() => onPick(path)} className="btn btn-primary btn-sm" disabled={!path}>Watch this folder</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
