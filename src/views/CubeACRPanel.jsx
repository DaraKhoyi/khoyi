// CubeACRPanel — settings panel extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { Tip } from '../tipsUi';

export default function CubeACRPanel({ userId, emailAccounts }) {
  const googleAccts = (emailAccounts || []).filter(a => a.provider === 'google' && a.is_active !== false);
  const [enabled, setEnabled] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [folderId, setFolderId] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [picker, setPicker] = useState(null); // { stack:[{id,name}], folders:[], loading, needsDrive, error }

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('cube_acr_settings').select('*').eq('user_id', userId).maybeSingle();
        if (data) { setEnabled(!!data.enabled); setAccountId(data.account_id); setFolderId(data.folder_id); setFolderName(data.folder_name || ''); }
        else if (googleAccts.length === 1) setAccountId(googleAccts[0].id);
      } catch (_e) {}
      setLoaded(true);
    })();
  }, []); // eslint-disable-line

  const save = async (patch) => {
    const next = { enabled, account_id: accountId, folder_id: folderId, folder_name: folderName, ...patch };
    setEnabled(next.enabled); setAccountId(next.account_id); setFolderId(next.folder_id); setFolderName(next.folder_name);
    try { await supabase.from('cube_acr_settings').upsert({ user_id: userId, enabled: next.enabled, account_id: next.account_id, folder_id: next.folder_id, folder_name: next.folder_name, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); } catch (_e) {}
  };

  const acct = googleAccts.find(a => a.id === accountId);
  const hasDrive = acct && (acct.scopes || []).some(s => String(s).includes('drive'));

  const connectDrive = async () => {
    if (!acct) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-oauth-start', { body: { return_to: window.location.origin + window.location.pathname, purpose: 'drive', login_hint: acct.email_address } });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (_e) { setConnecting(false); }
  };

  const loadFolders = async (stack) => {
    const parent = stack[stack.length - 1].id;
    setPicker(p => ({ ...(p || {}), stack, loading: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke('gdrive-folders', { body: { account_id: accountId, parent } });
      if (error) throw error;
      if (data?.needs_drive) { setPicker({ stack, folders: [], needsDrive: true }); return; }
      if (data?.error) throw new Error(data.error);
      setPicker({ stack, folders: data.folders || [], loading: false });
    } catch (e) { setPicker(p => ({ ...(p || {}), stack, loading: false, error: String(e.message || e) })); }
  };
  const openPicker = () => loadFolders([{ id: 'root', name: 'My Drive' }]);
  const drillInto = (f) => loadFolders([...(picker.stack), { id: f.id, name: f.name }]);
  const breadcrumbTo = (idx) => loadFolders(picker.stack.slice(0, idx + 1));
  const choose = (f) => { save({ folder_id: f.id, folder_name: f.name }); setPicker(null); };

  if (!loaded) return null;
  const labelStyle = { fontSize: 13, fontWeight: 600, color: 'var(--text-1)' };

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-header"><h3><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="quo" size={15} /> Call recording import</span></h3></div>
      <div className="panel-body">
        <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)', borderRadius: 999, padding: '3px 10px', marginBottom: 12 }}>Android only</div>

        {/* Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={labelStyle}>Cube ACR integration</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>When on, PrismOS watches your chosen Google Drive folder for new Cube ACR call recordings and turns each one into a summary, action items, and a DISC read. When off, it never touches your Drive.</div>
          </div>
          <button onClick={() => save({ enabled: !enabled })} role="switch" aria-checked={enabled} style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', background: enabled ? 'var(--accent)' : 'var(--border-strong)', position: 'relative', transition: 'background .15s' }}>
            <span style={{ position: 'absolute', top: 3, left: enabled ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
          </button>
        </div>

        {enabled && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Account selector */}
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Which Google Drive</div>
              {googleAccts.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Connect a Google account in “Connected Google Accounts” above first.</div>
              ) : (
                <select className="form-input" value={accountId || ''} onChange={e => save({ account_id: e.target.value || null, folder_id: null, folder_name: '' })} style={{ width: '100%' }}>
                  <option value="">Select an account…</option>
                  {googleAccts.map(a => <option key={a.id} value={a.id}>{a.email_address}</option>)}
                </select>
              )}
            </div>

            {/* Drive connect OR folder picker */}
            {acct && (
              !hasDrive ? (
                <div style={{ background: 'var(--bg-base)', border: '1px solid var(--accent-dim)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 10 }}>PrismOS needs read access to {acct.email_address}’s Google Drive to find your recordings. This is one-time and read-only.</div>
                  <button className="btn btn-primary btn-sm" disabled={connecting} onClick={connectDrive}>{connecting ? 'Opening Google…' : '+ Connect Google Drive'}</button>
                </div>
              ) : (
                <div>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>Recordings folder</div>
                  {folderId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10 }}>
                      <Icon name="folder" size={16} style={{ color: 'var(--accent)' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folderName || 'Selected folder'}</span>
                      <button className="btn btn-ghost btn-sm" onClick={openPicker}>Change</button>
                    </div>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={openPicker} style={{ borderColor: 'var(--accent-dim)', color: 'var(--accent)' }}>Browse Drive & choose folder</button>
                  )}

                  {picker && (
                    <div style={{ marginTop: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                      {picker.needsDrive ? (
                        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Drive access isn’t granted yet. <button onClick={connectDrive} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Connect Google Drive</button></div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-2)', marginBottom: 8 }}>
                            {(picker.stack || []).map((s, idx) => (
                              <span key={s.id}>
                                {idx > 0 && <span style={{ color: 'var(--text-3)', margin: '0 2px' }}>›</span>}
                                <button onClick={() => breadcrumbTo(idx)} style={{ background: 'none', border: 'none', color: idx === picker.stack.length - 1 ? 'var(--text-1)' : 'var(--accent)', fontWeight: idx === picker.stack.length - 1 ? 700 : 500, cursor: 'pointer', padding: 0, fontSize: 11.5 }}>{s.name}</button>
                              </span>
                            ))}
                          </div>
                          {picker.loading ? (
                            <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '8px 0' }}>Loading folders…</div>
                          ) : picker.error ? (
                            <div style={{ fontSize: 12, color: 'var(--red)' }}>{picker.error}</div>
                          ) : (picker.folders || []).length === 0 ? (
                            <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '4px 0' }}>No sub-folders here.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                              {picker.folders.map(f => (
                                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, background: 'var(--bg-card)' }}>
                                  <button onClick={() => drillInto(f)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                                    <Icon name="folder" size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                                    <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                  </button>
                                  <button onClick={() => choose(f)} className="btn btn-primary btn-sm" style={{ padding: '4px 11px', fontSize: 11.5 }}>Select</button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ marginTop: 8, textAlign: 'right' }}><button onClick={() => setPicker(null)} className="btn btn-ghost btn-sm">Close</button></div>
                        </>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>Tip: in Cube ACR (Premium), turn on cloud backup to Google Drive, then pick that same folder here.</div>
                </div>
              )
            )}

            <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-2)' }}>Heads up:</strong> Florida is an all-party consent state — get the other party’s consent before recording calls. PrismOS only reads the folder you choose.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
