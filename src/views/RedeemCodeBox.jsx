// RedeemCodeBox — settings panel extracted from App.js (strangle).
import React, { useState } from 'react';
import { supabase } from '../dataService';

export default function RedeemCodeBox({ onRedeemed, compact = false }) {
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const redeem = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc('redeem_unlock_code', { p_code: c });
      if (error) { setMsg({ ok: false, text: error.message }); }
      else if (data && data.ok) {
        setMsg({ ok: true, text: data.message || 'Unlocked.' });
        setCode('');
        if (onRedeemed) await onRedeemed();
      } else {
        setMsg({ ok: false, text: (data && data.message) || 'That code could not be redeemed.' });
      }
    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Enter unlock code"
          onKeyDown={e => { if (e.key === 'Enter') redeem(); }}
          style={{ flex: '1 1 180px', minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', padding: '9px 12px', fontSize: 14, letterSpacing: '.04em', fontWeight: 600 }} />
        <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={redeem}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg.ok ? 'var(--green, #7fae8f)' : 'var(--red)' }}>{msg.ok ? '✓ ' : ''}{msg.text}</div>}
    </div>
  );
}
