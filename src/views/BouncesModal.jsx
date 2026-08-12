// BouncesModal — shows recent email bounces.
// Extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

export default function BouncesModal({ onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    try {
      const { data } = await supabase.from('email_bounces')
        .select('id, original_subject, failed_recipients, reason_code, reason_text, fix_hint, from_address, bounced_at, handled')
        .eq('handled', false).order('bounced_at', { ascending: false }).limit(25);
      setRows(data || []);
    } catch (_) { setRows([]); }
  };
  useEffect(() => { load(); }, []);
  const markHandled = async (id) => {
    try { await supabase.from('email_bounces').update({ handled: true, handled_at: new Date().toISOString() }).eq('id', id); } catch (_) {}
    setRows(r => (r || []).filter(x => x.id !== id));
    if (onChanged) onChanged();
    if (window.__notify) window.__notify('Marked handled.', 'success');
  };
  return (
    <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header"><h3 style={{ margin: 0 }}>Emails that didn’t arrive</h3><button className="modal-close" onClick={onClose}>×</button></div>
        {rows === null && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Checking…</p>}
        {rows && rows.length === 0 && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Nothing bounced. Everything you’ve sent was accepted for delivery.</p>}
        {(rows || []).map(b => (
          <div key={b.id} style={{ border: '1px solid rgba(203,163,92,.3)', borderRadius: 12, padding: 14, marginBottom: 12, background: 'linear-gradient(180deg,#1B1610,#100D09)' }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: '#F6F1E7', marginBottom: 4 }}>{b.original_subject || '(no subject)'}</div>
            <div style={{ fontSize: 11.5, color: '#E4DCCB', marginBottom: 8 }}>
              sent {b.bounced_at ? new Date(b.bounced_at).toLocaleString() : ''}{b.from_address ? ' · from ' + b.from_address : ''}
            </div>
            <div style={{ fontSize: 12.5, color: '#e0965a', fontWeight: 700, marginBottom: 6 }}>
              Not delivered to {(b.failed_recipients || []).length || 'anyone'}: {(b.failed_recipients || []).join(', ')}
            </div>
            {b.fix_hint && <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{b.fix_hint}</div>}
            {b.reason_text && <details style={{ marginBottom: 8 }}><summary style={{ fontSize: 11.5, color: 'var(--text-3)', cursor: 'pointer' }}>What the mail server said</summary>
              <pre style={{ fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{b.reason_text}</pre></details>}
            <button className="btn btn-ghost btn-sm" onClick={() => markHandled(b.id)}>✓ Handled</button>
          </div>
        ))}
      </div>
    </div>
  );
}
