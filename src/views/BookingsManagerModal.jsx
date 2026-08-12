// BookingsManagerModal — settings panel extracted from App.js (strangle).
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

export default function BookingsManagerModal({ userId, slug, onClose }) {
  const [rows, setRows] = React.useState(null);
  const [busy, setBusy] = React.useState({});
  const MT = { phone:'Phone call', zoom:'Zoom', google_meet:'Google Meet', office:'Office meeting', property:'Property showing', other:'Other location' };
  const load = React.useCallback(async () => {
    try {
      const { data } = await supabase.from('bookings').select('*').eq('user_id', userId).eq('status', 'confirmed')
        .gte('start_at', new Date().toISOString()).order('start_at').limit(100);
      setRows(data || []);
    } catch (_) { setRows([]); }
  }, [userId]);
  React.useEffect(() => { load(); }, [load]);
  const cancelOne = async (bk) => {
    setBusy(b => ({ ...b, [bk.id]: true }));
    try { await supabase.functions.invoke('booking-cancel', { body: { cancel_token: bk.cancel_token } }); } catch (_) {}
    setBusy(b => { const n = { ...b }; delete n[bk.id]; return n; });
    if (window.__notify) window.__notify('Booking cancelled', 'success');
    load();
  };
  const copyResched = (bk) => { try { navigator.clipboard.writeText(`https://darasapp.com/book/${bk.slug || slug}?cancel=${bk.cancel_token}`); if (window.__notify) window.__notify('Reschedule link copied — send it to the client', 'success'); } catch (_) {} };
  const fmt = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-1)' }}>Upcoming bookings</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '12px 18px 24px' }}>
          {rows === null ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '18px 0' }}>Loading…</div>
            : rows.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '18px 0' }}>No upcoming bookings.</div>
            : rows.map(bk => (
              <div key={bk.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 13px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{bk.client_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>{fmt(bk.start_at)}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>{MT[bk.meeting_type] || bk.meeting_type} · {bk.duration_minutes} min{bk.location ? ` · ${bk.location}` : ''}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{bk.client_email} · {bk.client_phone}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                  <button onClick={() => copyResched(bk)} className="btn btn-ghost btn-sm" style={{ fontSize: 11.5 }}>Copy reschedule link</button>
                  <button onClick={() => cancelOne(bk)} disabled={busy[bk.id]} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 8, padding: '6px 12px', border: '1px solid rgba(239,68,68,0.5)', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>{busy[bk.id] ? 'Cancelling…' : 'Cancel'}</button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
