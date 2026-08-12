// EmailAliasesPanel — settings panel extracted from App.js (strangle).
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

export default function EmailAliasesPanel({ emailAliases, setEmailAliases, emailAccounts, userId }) {
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(null);   // alias id currently being updated
  const [editingName, setEditingName] = useState(null);  // {id, value}
  const [msg, setMsg] = useState(null);

  // The email-purpose Google account (only it has a sendAs list)
  const emailAccount =
    emailAccounts.find(a => a.is_active && (a.purposes || []).includes('email')) ||
    emailAccounts.find(a => a.is_active && (a.scopes || []).some(s => s.includes('gmail')));

  const aliases = (emailAliases || []).slice().sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.email_address.localeCompare(b.email_address);
  });

  function flash(text, type = 'ok') {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function syncAliases() {
    if (!emailAccount) { flash('Connect a Gmail account first.', 'error'); return; }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-aliases-sync', {
        body: { user_id: userId, account_id: emailAccount.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { data: fresh } = await supabase.from('email_aliases').select('*').order('email_address', { ascending: true });
      if (fresh) setEmailAliases(fresh);
      flash(`Synced ${data.synced} sender ${data.synced === 1 ? 'address' : 'addresses'} from Gmail.`);
    } catch (e) {
      flash('Sync failed: ' + (e.message || e), 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function setDefault(alias) {
    if (alias.is_default) return;
    setBusy(alias.id);
    try {
      // The DB trigger clears is_default on other rows when we set this one.
      const { error } = await supabase.from('email_aliases').update({ is_default: true }).eq('id', alias.id);
      if (error) throw error;
      setEmailAliases(prev => prev.map(a => ({ ...a, is_default: a.id === alias.id })));
      flash(`Default sender set to ${alias.email_address}.`);
    } catch (e) {
      flash('Failed: ' + (e.message || e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveName(alias, newName) {
    const cleaned = (newName || '').trim();
    if (cleaned === (alias.display_name || '')) {
      setEditingName(null);
      return;
    }
    setBusy(alias.id);
    try {
      const { error } = await supabase.from('email_aliases').update({ display_name: cleaned || null }).eq('id', alias.id);
      if (error) throw error;
      setEmailAliases(prev => prev.map(a => a.id === alias.id ? { ...a, display_name: cleaned || null } : a));
      flash(`Display name updated for ${alias.email_address}.`);
      setEditingName(null);
    } catch (e) {
      flash('Failed: ' + (e.message || e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header" style={{justifyContent:'space-between'}}>
        <h3 style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="mail" size={15} /> Sender Addresses</h3>
        <button className="btn btn-ghost btn-sm" onClick={syncAliases} disabled={syncing || !emailAccount}>
          {syncing ? '↻ Syncing…' : '↻ Sync from Gmail'}
        </button>
      </div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
          These are the addresses you can send mail "From" inside Prism. They mirror the <strong>Send mail as</strong> list in your Gmail Settings. The address marked <strong style={{color:'var(--accent)'}}>default</strong> is pre-selected in Compose; replies override it to match whatever address the original was sent to.
        </p>

        {msg && (
          <div style={{padding:'10px 12px',marginBottom:'12px',borderRadius:'6px',fontSize:'12px',
            background: msg.type === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${msg.type === 'ok' ? '#22c55e' : '#ef4444'}`,
            color: msg.type === 'ok' ? '#22c55e' : '#ef4444'}}>{msg.text}</div>
        )}

        {!emailAccount && (
          <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'8px',fontSize:'12px',color:'var(--text-3)'}}>
            Connect a Gmail account above first — sender addresses are pulled from that account's Gmail Settings.
          </div>
        )}

        {emailAccount && aliases.length === 0 && (
          <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'8px',fontSize:'12px',color:'var(--text-3)'}}>
            No sender addresses synced yet. Click <strong>Sync from Gmail</strong> above.
          </div>
        )}

        {aliases.length > 0 && (
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {aliases.map(a => {
              const isEditing = editingName?.id === a.id;
              return (
                <div key={a.id} style={{
                  padding:'12px',
                  background: a.is_default ? 'var(--accent-glow)' : 'var(--bg-base)',
                  border: `1px solid ${a.is_default ? 'var(--accent-dim)' : 'var(--border)'}`,
                  borderRadius:'8px',
                  display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap'
                }}>
                  <div style={{flex:1, minWidth:'200px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
                      <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{a.email_address}</span>
                      {a.is_default && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'var(--accent)',color:'var(--bg-base)',fontWeight:700}}>DEFAULT</span>}
                      {a.is_primary && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'var(--bg-card)',color:'var(--text-2)',border:'1px solid var(--border)'}}>primary</span>}
                      {!a.verified && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'rgba(239,68,68,0.15)',color:'var(--red)',border:'1px solid var(--red)'}}>unverified</span>}
                    </div>
                    {isEditing ? (
                      <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                        <input
                          className="form-input"
                          autoFocus
                          value={editingName.value}
                          onChange={e => setEditingName({ ...editingName, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveName(a, editingName.value); }
                            if (e.key === 'Escape') setEditingName(null);
                          }}
                          placeholder="Display name (e.g. Your Name)"
                          style={{padding:'4px 8px',fontSize:'12px',height:'auto'}}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={() => saveName(a, editingName.value)} disabled={busy === a.id} style={{padding:'4px 8px',fontSize:'11px'}}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingName(null)} style={{padding:'4px 8px',fontSize:'11px'}}>×</button>
                      </div>
                    ) : (
                      <div style={{fontSize:'12px',color:'var(--text-3)',display:'flex',alignItems:'center',gap:'6px'}}>
                        <span>{a.display_name || <em style={{opacity:0.6}}>no display name</em>}</span>
                        <button onClick={() => setEditingName({ id: a.id, value: a.display_name || '' })} style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:'11px',padding:0}}>edit</button>
                      </div>
                    )}
                  </div>
                  {!a.is_default && a.verified && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setDefault(a)} disabled={busy === a.id}
                      style={{borderColor:'var(--accent-dim)',color:'var(--accent)',fontSize:'11px'}}>
                      {busy === a.id ? '…' : 'Set as default'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'14px',lineHeight:1.5}}>
          To add or remove an alias, change it in <a href="https://mail.google.com/mail/u/0/#settings/accounts" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>Gmail Settings → Accounts → Send mail as</a>, then click Sync from Gmail above.
        </p>
      </div>
    </div>
  );
}
