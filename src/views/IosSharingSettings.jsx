// IosSharingSettings — settings panel extracted from App.js (strangle).
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import PrismThinking from './PrismThinking';

export default function IosSharingSettings({ userId }) {
  const ENDPOINT = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/ios-ingest';
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const load = React.useCallback(async () => {
    try { const { data } = await supabase.from('ingest_tokens').select('token').eq('user_id', userId).maybeSingle(); if (data && data.token) setToken(data.token); } catch (_) {}
    setLoading(false);
  }, [userId]);
  React.useEffect(() => { load(); }, [load]);
  const genToken = () => { const r = (window.crypto && crypto.randomUUID) ? (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '') : (Math.random().toString(36).slice(2) + Date.now().toString(36)); return 'pxi_' + r.slice(0, 40); };
  const create = async () => { const t = genToken(); try { await supabase.from('ingest_tokens').upsert({ user_id: userId, token: t }, { onConflict: 'user_id' }); setToken(t); } catch (_) {} };
  const regenerate = async () => { if (!window.confirm('Generate a new key? Your existing iPhone shortcut will stop working until you paste the new key into it.')) return; await create(); };
  const copy = (txt, which) => { try { navigator.clipboard.writeText(txt); setCopied(which); setTimeout(() => setCopied(''), 1500); } catch (_) {} };
  const fullUrl = token ? (ENDPOINT + '?token=' + token) : ENDPOINT;
  const codeBox = { flex: 1, fontSize: 11, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' };
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: '0 0 4px' }}>iPhone sharing</h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>iPhone can't add PrismOS to the share sheet on its own, so we use a one-time Apple Shortcut. Once it's set up, Share → Save to PrismOS works for recordings, documents, contacts, and notes — the same as Android.</p>
      {loading ? <PrismThinking label="Loading" /> : !token ? (
        <button className="btn btn-primary btn-sm" onClick={create}>Set up iPhone sharing</button>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginTop: 6 }}>Your personal key</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <code style={codeBox}>{token}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(token, 'key')} style={{ fontSize: 11 }}>{copied === 'key' ? 'Copied' : 'Copy'}</button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginTop: 12 }}>Full URL (paste this into the shortcut)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <code style={codeBox}>{fullUrl}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(fullUrl, 'url')} style={{ fontSize: 11 }}>{copied === 'url' ? 'Copied' : 'Copy'}</button>
          </div>
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(203,163,92,.06)', border: '1px solid rgba(203,163,92,.28)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EBCB82', marginBottom: 8 }}>Create the shortcut (one time, ~2 min)</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <li>Open the <b>Shortcuts</b> app → tap <b>+</b> for a new shortcut.</li>
              <li>Tap <b>Add Action</b>, search <b>Get Contents of URL</b>, add it.</li>
              <li>Paste the <b>Full URL</b> above into the URL field.</li>
              <li>Expand it (the arrow): set <b>Method</b> to <b>POST</b>, and <b>Request Body</b> to <b>File</b>.</li>
              <li>For the file value, choose <b>Shortcut Input</b>.</li>
              <li>Open the shortcut's settings → turn on <b>Show in Share Sheet</b> → accept <b>Any</b>.</li>
              <li>Name it <b>Save to PrismOS</b> and done.</li>
            </ol>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>Then: open a recording, document, or contact → <b>Share</b> → <b>Save to PrismOS</b>. It lands in the right place automatically.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={regenerate} style={{ fontSize: 11, marginTop: 12, color: 'var(--text-3)' }}>Regenerate key</button>
        </>
      )}
    </div>
  );
}
