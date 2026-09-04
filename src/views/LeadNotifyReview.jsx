import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// What would have gone out.
//
// The whole point of the 72-hour shadow run is that Dara sees the false
// positives before an agent does. A count would not do it — he has to read the
// actual senders and the actual words, because "Zatos VPN" only looks wrong when
// you see the name.
//
// Every decision is listed, sent and suppressed alike. The suppressed ones
// matter as much: if a real enquiry is sitting in that list, the filter is too
// tight and a lead is being missed silently.

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function LeadNotifyReview() {
  const [rows, setRows] = useState(null);
  const [rt, setRt] = useState(null);
  const [tab, setTab] = useState('would_send');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: r }, { data: s }] = await Promise.all([
        supabase.from('lead_notifications').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('notification_runtime').select('*').eq('id', true).maybeSingle(),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setRt(s || null);
    } catch (_) { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const goLive = async () => {
    const ok = window.confirm('Start sending these to agents for real?\n\nOnly do this once the "Would send" list has no false positives in it.');
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('notification_runtime')
      .update({ shadow_mode: false, updated_at: new Date().toISOString() }).eq('id', true);
    setBusy(false);
    if (error) { try { window.__notify && window.__notify('Could not switch: ' + error.message, 'error'); } catch (_) {} return; }
    load();
    try { window.__notify && window.__notify('Live. Agents will now receive new-lead emails.', 'success'); } catch (_) {}
  };

  const list = (rows || []).filter(r =>
    tab === 'would_send' ? (r.decision === 'would_send' || r.decision === 'sent')
      : tab === 'suppressed' ? r.decision === 'suppressed'
      : true);

  const counts = {
    would_send: (rows || []).filter(r => r.decision === 'would_send' || r.decision === 'sent').length,
    suppressed: (rows || []).filter(r => r.decision === 'suppressed').length,
    all: (rows || []).length,
  };

  const chip = (k, label) => (
    <button key={k} type="button" onClick={() => setTab(k)}
      style={{ padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
        border: '1px solid ' + (tab === k ? '#EBCB82' : 'var(--border)'),
        background: tab === k ? 'rgba(235,203,130,.16)' : 'transparent',
        color: tab === k ? '#EBCB82' : 'var(--text-3)' }}>
      {label}
    </button>
  );

  const hoursLeft = rt?.shadow_until
    ? Math.max(0, Math.round((new Date(rt.shadow_until).getTime() - Date.now()) / 36e5))
    : null;

  return (
    <div style={{ padding: '0 2px' }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#EBCB82' }}>
        Lead notifications
      </div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 30, margin: '4px 0 6px', display: 'flex', minWidth: 0 }}>
        <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>What would have gone out.</span>
      </h2>

      <div style={{
        fontSize: 13, lineHeight: 1.55, marginBottom: 12, padding: '10px 12px', borderRadius: 12,
        border: '1px solid ' + (rt?.shadow_mode === false ? 'rgba(34,197,94,.5)' : 'rgba(235,203,130,.45)'),
        background: rt?.shadow_mode === false ? 'rgba(34,197,94,.08)' : 'rgba(235,203,130,.08)',
        color: 'var(--text-2)',
      }}>
        {rt?.shadow_mode === false ? (
          <span><strong style={{ color: '#4ade80' }}>Live.</strong> Agents are receiving these emails.</span>
        ) : (
          <>
            <strong style={{ color: '#EBCB82' }}>Shadow mode — nothing is being sent.</strong>
            {hoursLeft !== null ? <span>{' Test window has about ' + hoursLeft + ' hours left.'}</span> : null}
            <div style={{ marginTop: 6, color: 'var(--text-3)' }}>
              Read the <strong>Would send</strong> list. If everything in it is a real person asking a real
              question, it is safe to go live. If one advert is in there, tell me and I will tighten the filter.
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
        {chip('would_send', 'Would send (' + counts.would_send + ')')}
        {chip('suppressed', 'Suppressed (' + counts.suppressed + ')')}
        {chip('all', 'Everything (' + counts.all + ')')}
        <button type="button" onClick={load}
          style={{ marginLeft: 'auto', padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)' }}>
          Refresh
        </button>
      </div>

      {rows === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading…</div>
      ) : !list.length ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
          {tab === 'would_send'
            ? 'Nothing has qualified as a lead yet. That is the expected state most of the time — the filter is built to stay quiet.'
            : 'Nothing here yet.'}
        </div>
      ) : list.map(r => {
        const good = r.decision === 'would_send' || r.decision === 'sent';
        return (
          <div key={r.id} style={{
            border: '1px solid ' + (good ? 'rgba(235,203,130,.45)' : 'var(--border)'),
            borderRadius: 12, padding: '10px 12px', marginBottom: 8,
            opacity: good ? 1 : 0.72,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.lead_name || r.lead_email || r.channel || 'Unknown sender'}
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
                color: good ? '#EBCB82' : 'var(--text-3)' }}>
                {r.decision === 'sent' ? 'sent' : good ? 'would send' : 'suppressed'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{when(r.created_at)}</span>
            </div>
            {r.lead_email ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', wordBreak: 'break-all' }}>{r.lead_email}</div>
            ) : null}
            {r.preview ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.45 }}>{r.preview}</div>
            ) : null}
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {r.reason}{typeof r.score === 'number' ? '' : ''}
            </div>
          </div>
        );
      })}

      {rt?.shadow_mode !== false && counts.would_send > 0 ? (
        <button type="button" disabled={busy} onClick={goLive}
          style={{ width: '100%', marginTop: 10, padding: '11px 12px', borderRadius: 12, cursor: 'pointer',
            fontSize: 13, fontWeight: 700, border: 'none', background: '#EBCB82', color: '#1a1205' }}>
          {busy ? 'Switching…' : 'These all look right — start sending'}
        </button>
      ) : null}
    </div>
  );
}
