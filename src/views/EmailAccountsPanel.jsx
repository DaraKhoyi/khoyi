// EmailAccountsPanel — settings panel extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { confirmDialog } from '../notify';
import { Icon } from '../icons';

export default function EmailAccountsPanel({ emailAccounts, setEmailAccounts }) {
  const [connecting, setConnecting] = useState(false);
  const [connectingPurpose, setConnectingPurpose] = useState(null);
  const [err, setErr] = useState('');
  const [icsLink, setIcsLink] = useState('');
  const [icsBusy, setIcsBusy] = useState(false);
  const [icsCopied, setIcsCopied] = useState(false);
  const [icConn, setIcConn] = useState(null);
  const [icAppleId, setIcAppleId] = useState('');
  const [icPw, setIcPw] = useState('');
  const [icBusy, setIcBusy] = useState('');
  const [icMsg, setIcMsg] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from('icloud_connections').select('apple_id, enabled, status, last_synced_at').eq('user_id', session.user.id).maybeSingle();
        if (data) { setIcConn(data); setIcAppleId(data.apple_id || ''); }
      } catch (_) {}
    })();
  }, []);
  async function connectICloud() {
    setIcBusy('connect'); setIcMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('icloud-connect', { body: { apple_id: icAppleId.trim(), app_password: icPw.toLowerCase().replace(/\s+/g, '') } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setIcConn({ apple_id: data.apple_id, enabled: true, status: 'connected', last_synced_at: null });
      setIcPw(''); setIcMsg('Connected — running first sync…');
      await syncICloud();
    } catch (e) { setIcMsg('Error: ' + (e.message || String(e))); }
    setIcBusy('');
  }
  async function syncICloud() {
    setIcBusy('sync'); setIcMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('icloud-sync', { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const r = (data?.results || [])[0] || {};
      setIcMsg(`Synced — ${r.pulled || 0} personal events pulled in${r.updated ? `, ${r.updated} updated` : ''}${r.deleted ? `, ${r.deleted} removed` : ''}.`);
      setIcConn(c => c ? { ...c, last_synced_at: new Date().toISOString() } : c);
    } catch (e) { setIcMsg('Error: ' + (e.message || String(e))); }
    setIcBusy('');
  }
  async function disconnectICloud() {
    if (!(await confirmDialog('Disconnect iCloud calendar sync? Your PrismOS calendar in iCloud stays, but it will stop updating.'))) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.from('icloud_connections').delete().eq('user_id', session.user.id);
      setIcConn(null); setIcMsg('');
    } catch (_) {}
  }
  const ICS_FEED_BASE = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/calendar-ics-feed';

  async function getIcsLink() {
    setIcsBusy(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in.');
      const uid = session.user.id;
      const { data: row } = await supabase.from('user_settings').select('ics_token').eq('user_id', uid).maybeSingle();
      let tok = row?.ics_token;
      if (!tok) {
        tok = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2)) + Math.random().toString(36).slice(2);
        const { error } = await supabase.from('user_settings').upsert({ user_id: uid, ics_token: tok }, { onConflict: 'user_id' });
        if (error) throw error;
      }
      setIcsLink(ICS_FEED_BASE + '?token=' + tok);
    } catch (e) { setErr(e.message || String(e)); }
    setIcsBusy(false);
  }

  async function startConnect(purpose = 'email', loginHint = '') {
    setConnecting(true);
    setConnectingPurpose(purpose);
    setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in.');
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose, login_hint: loginHint },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      if (!data?.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message || String(e));
      setConnecting(false);
      setConnectingPurpose(null);
    }
  }

  async function disconnect(id) {
    if (!await confirmDialog('Disconnect this Google account? Synced messages and events will remain in the database, but future sync will stop.')) return;
    await supabase.from('email_accounts').update({ is_active: false }).eq('id', id);
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: false } : a));
  }

  // One place decides how a purpose looks. Adding a fifth purpose should mean
  // adding a row here, not hunting for three colour ternaries.
  const PURPOSE_STYLE = {
    calendar: { icon: 'calendar', label: 'calendar', fg: 'var(--accent)',  bg: 'rgba(197,169,94,0.15)', bd: 'var(--accent-dim)' },
    email:    { icon: 'mail',     label: 'email',    fg: 'var(--green)',   bg: 'rgba(34,197,94,0.12)',  bd: '#22c55e' },
    drive:    { icon: 'folder',   label: 'drive',    fg: 'var(--text-2)',  bg: 'rgba(255,255,255,0.06)', bd: 'var(--border)' },
    contacts: { icon: 'contacts', label: 'contacts', fg: '#8FB8A8',        bg: 'rgba(143,184,168,0.14)', bd: '#8FB8A8' },
  };
  function purposeBadges(purposes) {
    const list = purposes || [];
    return list.map(p => {
      const st = PURPOSE_STYLE[p] || PURPOSE_STYLE.email;
      return (
        <span key={p} className="pill" style={{
          fontSize:'10px', padding:'2px 6px',
          background: st.bg, color: st.fg, border: `1px solid ${st.bd}`,
        }}><Icon name={st.icon} size={12} /> {st.label}</span>
      );
    });
  }

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header"><h3><span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="link" size={15} /> Connected Google Accounts</span></h3></div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
          Connect Google for email (Gmail) and/or calendar. You can connect different accounts for different purposes — for example, a work account for email and a personal account for calendar.
        </p>
        {emailAccounts.length === 0
          ? <p style={{fontSize:'13px',color:'var(--text-3)',marginBottom:'14px'}}>No accounts connected yet.</p>
          : (
            <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}>
              {emailAccounts.map(a => (
                <div key={a.id} style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'18px'}}>{(a.purposes||[]).includes('calendar') ? <Icon name="calendar" size={16} /> : <Icon name="mail" size={16} />}</span>
                  <div style={{flex:1,minWidth:'160px'}}>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px',display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                      {a.email_address}
                      {purposeBadges(a.purposes)}
                    </div>
                    <div style={{fontSize:'12px',color:'var(--text-2)'}}>
                      {a.provider} · {a.is_active ? 'active' : 'inactive'}
                      {a.last_sync_at && <> · synced {new Date(a.last_sync_at).toLocaleString()}</>}
                    </div>
                    {a.last_sync_error === 'REAUTH_REQUIRED' ? (
                      <div style={{marginTop:'6px',padding:'8px 10px',background:'rgba(245,158,11,0.12)',border:'1px solid var(--yellow)',borderRadius:'8px'}}>
                        <div style={{fontSize:'12px',color:'var(--yellow)',fontWeight:600,marginBottom:'6px'}}>⚠ Google ended this connection — reconnect to resume sync.</div>
                        <button className="btn btn-sm" style={{background:'var(--yellow)',color:'#1a1205',fontWeight:600}} disabled={connecting}
                          onClick={()=>startConnect((a.purposes||[]).includes('calendar') ? 'calendar' : 'email')}>
                          {connecting ? 'Opening Google…' : 'Reconnect now'}
                        </button>
                      </div>
                    ) : a.last_sync_error && (
                      <div style={{fontSize:'12px',color:'var(--red)',marginTop:'2px'}}>Last error: {a.last_sync_error.slice(0, 200)}</div>
                    )}
                  </div>
                  {a.is_active && (
                    <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                      {!(a.purposes||[]).includes('calendar') && (a.scopes||[]).every(s=>!s.includes('calendar')) && (
                        <button className="btn btn-sm" disabled={connecting}
                          style={{background:'var(--accent)',color:'#1a1205',fontWeight:600}}
                          onClick={()=>startConnect('calendar', a.email_address)}
                          title={`Grant calendar access to ${a.email_address}`}>
                          {connecting && connectingPurpose === 'calendar' ? 'Opening Google…' : <><Icon name="calendar" size={13} /> Add Calendar</>}
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={()=>disconnect(a.id)}>Disconnect</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        }
        {err && (
          <div style={{padding:'10px 12px',background:'rgba(239, 68, 68, 0.1)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'13px',marginBottom:'12px'}}>
            {err}
          </div>
        )}
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={() => startConnect('email')} disabled={connecting}>
            {connecting && connectingPurpose === 'email' ? 'Opening Google…' : '+ Connect Gmail'}
          </button>
          <button className="btn btn-ghost" onClick={() => startConnect('calendar')} disabled={connecting} style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
            {connecting && connectingPurpose === 'calendar' ? 'Opening Google…' : '+ Connect Calendar'}
          </button>
          <button className="btn btn-ghost" onClick={() => startConnect('contacts')} disabled={connecting} style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
            {connecting && connectingPurpose === 'contacts' ? 'Opening Google…' : '+ Connect Contacts'}
          </button>
        </div>
        {/* Said plainly at the point of decision, not buried in a policy page.
            Contacts is the connection people are most wary of granting. */}
        <p style={{fontSize:'11.5px',color:'var(--text-3)',lineHeight:1.5,margin:'10px 0 0'}}>
          <b style={{color:'var(--text-2)'}}>Contacts is read-and-write, and nothing is ever deleted.</b> PrismOS reads your
          Google Contacts so it can suggest who is worth bringing in, and writes back only a small marker
          on people you have already imported. Google stays your address book.
        </p>

        <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)',marginBottom:'4px',display:'flex',alignItems:'center',gap:'6px'}}><Icon name="calendar" size={14} style={{color:'var(--accent)'}} /> Sync to iPhone / Apple Calendar</div>
          <p style={{fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,margin:'0 0 10px'}}>Get a private link that shows your PrismOS schedule in the iPhone Calendar app. It refreshes automatically — no password needed. (Read-only for now; two-way sync is coming.)</p>
          {!icsLink ? (
            <button className="btn btn-ghost" onClick={getIcsLink} disabled={icsBusy} style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>{icsBusy ? 'Generating…' : 'Get my iPhone calendar link'}</button>
          ) : (
            <div>
              <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
                <a href={icsLink.replace(/^https?:/, 'webcal:')} style={{flex:'1 1 220px',minWidth:0,fontSize:'12px',color:'var(--accent)',wordBreak:'break-all',padding:'9px 11px',border:'1px solid var(--accent-dim)',borderRadius:'8px',background:'var(--accent-glow)',textDecoration:'none'}}>{icsLink.replace(/^https?:\/\//, '')}</a>
                <button className="btn btn-primary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(icsLink.replace(/^https?:/, 'webcal:')); setIcsCopied(true); setTimeout(() => setIcsCopied(false), 1500); } catch (_) {} }}>{icsCopied ? 'Copied ✓' : 'Copy link'}</button>
              </div>
              <p style={{fontSize:'11px',color:'var(--text-3)',lineHeight:1.5,margin:'8px 0 0'}}>On the iPhone: tap the link above to subscribe in Calendar. Or paste it under <b>Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar</b>.</p>
            </div>
          )}
        </div>

        <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-1)',marginBottom:'4px',display:'flex',alignItems:'center',gap:'6px'}}><Icon name="calendar" size={14} style={{color:'var(--accent)'}} /> iCloud Calendar → PrismOS</div>
          {!icConn ? (
            <div>
              <p style={{fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,margin:'0 0 10px'}}>Bring your iCloud calendars (Family, Home, etc.) into PrismOS as <b>read-only personal time</b>, so PrismOS sees your whole day and never books over your personal commitments. You need an <b>app-specific password</b> (not your Apple password): create one at <span style={{color:'var(--accent)'}}>appleid.apple.com → Sign-In &amp; Security → App-Specific Passwords</span>.</p>
              <input className="form-input" placeholder="Apple ID (you@icloud.com)" value={icAppleId} onChange={e => setIcAppleId(e.target.value)} style={{marginBottom:'8px'}} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <input className="form-input" placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)" value={icPw} onChange={e => setIcPw(e.target.value.toLowerCase())} style={{marginBottom:'10px'}} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <button className="btn btn-primary" onClick={connectICloud} disabled={icBusy === 'connect' || !icAppleId || !icPw}>{icBusy === 'connect' ? 'Connecting…' : 'Connect iCloud'}</button>
            </div>
          ) : (
            <div>
              <p style={{fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,margin:'0 0 8px'}}>Connected as <b>{icConn.apple_id}</b>{icConn.last_synced_at ? ' · last synced ' + new Date(icConn.last_synced_at).toLocaleString() : ''}.</p>
              <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                <button className="btn btn-primary btn-sm" onClick={syncICloud} disabled={icBusy === 'sync'}>{icBusy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
                <button className="btn btn-ghost btn-sm" onClick={disconnectICloud}>Disconnect</button>
              </div>
            </div>
          )}
          {icMsg && <p style={{fontSize:'11px',color: icMsg.startsWith('Error') ? 'var(--red)' : 'var(--text-3)',margin:'8px 0 0'}}>{icMsg}</p>}
        </div>
      </div>
    </div>
  );
}
