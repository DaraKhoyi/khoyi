// CloudStorageSettings — settings panel extracted from App.js (strangle).
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { Tip } from '../tipsUi';
import PrismThinking from './PrismThinking';
import DropboxFolderBrowser from './DropboxFolderBrowser';
import { confirmDialog } from '../notify';

export default function CloudStorageSettings({ userId }) {
  const [conns, setConns] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [browseConn, setBrowseConn] = useState(null);
  const load = React.useCallback(async () => {
    try {
      const [{ data: c }, { data: fl }] = await Promise.all([
        supabase.from('cloud_connections').select('id, provider, account_label, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('watched_folders').select('id, connection_id, path, label, enabled, personal').eq('user_id', userId),
      ]);
      setConns(Array.isArray(c) ? c : []); setFolders(Array.isArray(fl) ? fl : []);
    } catch (_) {}
    setLoading(false);
  }, [userId]);
  React.useEffect(() => { load(); }, [load]);
  const connectDropbox = async () => {
    const nonce = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Math.random()).slice(2) + Date.now());
    try { await supabase.from('oauth_states').insert({ nonce, user_id: userId, provider: 'dropbox' }); } catch (_) {}
    const REDIRECT = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/dropbox-oauth-callback';
    const scope = 'files.metadata.read files.content.read account_info.read';
    window.location.href = `https://www.dropbox.com/oauth2/authorize?client_id=5nl3icnh0wjoyyn&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&token_access_type=offline&force_reauthentication=true&scope=${encodeURIComponent(scope)}&state=${nonce}`;
  };
  const disconnect = async (id) => {
    if (!window.confirm('Disconnect this account? Its watched folders and pending recordings will stop syncing.')) return;
    try { await supabase.functions.invoke('dropbox-disconnect', { body: { connection_id: id } }); } catch (_) { try { await supabase.from('cloud_connections').delete().eq('id', id); } catch (_2) {} }
    load();
  };
  const addFolder = async (connId, path) => {
    setBrowseConn(null);
    const label = path.split('/').filter(Boolean).pop() || 'Root';
    try { await supabase.from('watched_folders').insert({ user_id: userId, connection_id: connId, path, label }); } catch (_) {}
    load();
    if (window.__notify) window.__notify('Now watching ' + label, 'success');
  };
  // Removing a watched folder stops every recording in it from ever reaching the
  // app. It had NO confirmation and an empty catch, so a failed delete looked
  // exactly like a successful one: the row vanished from the list while the
  // folder was still watched. Both fixed — confirm before, and report failure.
  const removeFolder = async (fd) => {
    if (!await confirmDialog('Stop watching ' + (fd.path || 'this folder') + '?\n\nRecordings saved there will no longer reach Prism. Nothing already imported is deleted.')) return;
    const { error } = await supabase.from('watched_folders').delete().eq('id', fd.id);
    if (error) {
      if (window.__notify) window.__notify('Could not stop watching that folder — it is still active.', 'error');
      return;
    }
    setFolders(fs => fs.filter(x => x.id !== fd.id));
    if (window.__notify) window.__notify('Stopped watching ' + (fd.path || 'that folder') + '.', 'success');
  };
  const togglePersonal = async (fld) => { try { await supabase.from('watched_folders').update({ personal: !fld.personal }).eq('id', fld.id); setFolders(fs => fs.map(x => x.id === fld.id ? { ...x, personal: !x.personal } : x)); } catch (_) {} };
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: '0 0 4px' }}>Cloud storage</h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px' }}>Connect the cloud your voice recorder backs up to, then choose the folder PrismOS watches for new meeting recordings.</p>
      <Tip id="cloud_recordings" label="How recordings flow in">Record a meeting on your voice recorder — it backs up to Dropbox, and PrismOS watches the folder you pick here. New recordings appear in <b>Review</b> to label who you met with; then Prism transcribes them and researches each person for you.</Tip>
      {loading ? <PrismThinking label="Loading" /> : (
        <>
          {conns.map(c => {
            const cf = folders.filter(fd => fd.connection_id === c.id);
            return (
              <div key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🗂️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', textTransform: 'capitalize' }}>{c.provider} <span style={{ color: c.status === 'connected' ? 'var(--green)' : 'var(--red)', fontSize: 11 }}>● {c.status}</span></div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{c.account_label}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => disconnect(c.id)} style={{ fontSize: 11 }}>Disconnect</button>
                </div>
                <div style={{ marginLeft: 28, marginTop: 6 }}>
                  {cf.map(fd => (
                    <div key={fd.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
                      <span>📁</span>
                      <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all' }}>{fd.path}</span>
                      <button onClick={() => togglePersonal(fd)} className="btn btn-ghost btn-sm" style={{ fontSize: 13, padding: '10px 12px', minHeight: 44, color: fd.personal ? '#EBCB82' : 'var(--text-3)' }} title="Personal folders are never enriched">{fd.personal ? '🔒 Personal' : 'Enrich'}</button>
                      <button onClick={() => removeFolder(fd)} className="btn btn-ghost btn-sm" style={{ fontSize: 13, padding: '10px 12px', minHeight: 44 }}>Remove</button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => setBrowseConn(c.id)} style={{ fontSize: 11, marginTop: 4 }}>+ Choose folder to watch</button>
                </div>
              </div>
            );
          })}
          <button className="btn btn-primary btn-sm" onClick={connectDropbox} style={{ marginTop: 12 }}>+ {conns.length ? 'Connect a different Dropbox account' : 'Connect Dropbox'}</button>
          {conns.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Dropbox will ask you to sign in — choose or switch to the account you want, then disconnect the old one above.</div>}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>OneDrive and Google Drive can slot in later — the connector is provider-agnostic.</div>
        </>
      )}
      {browseConn && <DropboxFolderBrowser connectionId={browseConn} onClose={() => setBrowseConn(null)} onPick={(path) => addFolder(browseConn, path)} />}
    </div>
  );
}
