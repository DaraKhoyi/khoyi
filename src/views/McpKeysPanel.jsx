// McpKeysPanel — keys for assistants that connect to PrismOS by a pasted key
// (Settings, AI & Usage). Dara, 7 Oct 2026, for Grok.
//
// A key stands for the person who made it: whoever holds it can use the
// PrismOS connector as them. So it is shown ONCE when made (only a fingerprint
// is kept), every key is listed here with when it was last used, and any key
// can be switched off at once. Shown only to people the connector is on for.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { confirmDialog, notify, notifyError } from '../notify';

export const CONNECTOR_URL = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/prism-mcp';
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function McpKeysPanel() {
  const [allowed, setAllowed] = useState(false);
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);     // { name, key } — on screen once, then gone
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: ok, error: aErr } = await supabase.rpc('mcp_access_allowed');
    if (aErr || ok !== true) { setAllowed(false); return; }
    setAllowed(true);
    const { data, error } = await supabase.from('mcp_keys').select('id, name, key_prefix, created_at, last_used_at, revoked_at').order('created_at', { ascending: false });
    if (error) { notifyError('Connector keys did not load: ' + error.message); return; }
    setKeys(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_mcp_key', { p_name: name.trim() });
    setBusy(false);
    if (error || !data) { notifyError('That key was not made: ' + (error ? error.message : 'no answer')); return; }
    setFresh({ name: name.trim(), key: data }); setName(''); load();
  }
  async function revoke(k) {
    if (!await confirmDialog(`Switch off the key "${k.name}"? Whatever uses it stops working at once. This cannot be undone; you can make a new key.`)) return;
    const { error } = await supabase.rpc('revoke_mcp_key', { p_id: k.id });
    if (error) { notifyError('That key was not switched off: ' + error.message); return; }
    notify(`"${k.name}" is switched off.`, 'success'); load();
  }
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); notify(what + ' copied', 'success'); } catch (_) { notifyError('Could not copy. Press and hold the text to copy it.'); } };

  if (!allowed) return null;
  const live = keys.filter(k => !k.revoked_at), off = keys.filter(k => k.revoked_at);
  const box = { background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' };
  return (
    <div className="panel" style={{ marginBottom: '18px' }} data-testid="mcp-keys-panel">
      <div className="panel-header"><h3>Connector keys</h3></div>
      <div className="panel-body">
        <p style={{ fontSize: '12.5px', color: 'var(--text-2)', lineHeight: 1.5, marginTop: 0 }}>
          For an assistant that connects to PrismOS with a pasted key instead of signing in (Grok, for example). A key lets its holder use PrismOS <b>as you</b>: your contacts, calls, tasks and leads. Treat it like a password. It is shown once.
        </p>
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Connector address</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <code style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12.5, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{CONNECTOR_URL}</code>
            <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={() => copy(CONNECTOR_URL, 'Address')}>Copy</button>
          </div>
        </div>

        {fresh && (
          <div role="status" data-testid="mcp-key-fresh" style={{ ...box, borderColor: 'var(--accent)', background: 'rgba(197,169,94,0.10)', marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>Your key for “{fresh.name}”. Copy it now: it will not be shown again.</div>
            <code style={{ display: 'block', margin: '8px 0', fontSize: 12.5, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{fresh.key}</code>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" style={{ minHeight: 44 }} onClick={() => copy(fresh.key, 'Key')}>Copy key</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={() => setFresh(null)}>I have saved it</button>
            </div>
          </div>
        )}

        {live.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>No keys in use.</div> : live.map(k => (
          <div key={k.id} style={{ ...box, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{k.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{k.key_prefix}… · made {day(k.created_at)} · {k.last_used_at ? 'last used ' + day(k.last_used_at) : 'not used yet'}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={() => revoke(k)}>Switch off</button>
          </div>
        ))}

        <form onSubmit={create} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="What is it for? e.g. Grok" maxLength={60} aria-label="Name for a new key" style={{ flex: '1 1 180px', minHeight: 44 }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()} style={{ minHeight: 44 }}>{busy ? 'Making…' : 'Make a key'}</button>
        </form>
        {off.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>Switched off: {off.map(k => `${k.name} (${day(k.revoked_at)})`).join(', ')}</div>}
      </div>
    </div>
  );
}
