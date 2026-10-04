import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';

// WHEN PRISMOS MAY NOTIFY ME (4 Oct 2026).
//
// One rule decides whether a notification may reach a phone now —
// public.push_gate(), asked by push-send for every system notification
// (supabase/sql/2026-10-04e_training_and_triage.sql). These are its settings.
// Before today quiet hours were fixed in the code and differed by sender, and
// the reply reminder's hourly limit did not hold for an account with no
// notification_prefs row: the broker received up to 319 in a day.
const hourLabel = (h) => (h === 0 ? '12 am' : h < 12 ? h + ' am' : h === 12 ? '12 pm' : (h - 12) + ' pm');
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function NotifySettings() {
  const [n, setN] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_notify');
    if (error || !data) { setMsg('Could not load these settings. Nothing has changed.'); return; }
    setN(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (args) => {
    if (busy) return; setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_notify', { p_mode: null, p_digest_hours: null, p_quiet_start: null, p_quiet_end: null, p_urgent_breaks_quiet: null, ...args });
    setBusy(false);
    if (error || !data || data.ok === false) { setMsg('Could not save: ' + (error?.message || data?.error || 'try again') + '. Nothing has changed.'); return; }
    setN(data); setMsg('Saved.');
  };
  const morning = async (args) => {
    if (busy) return; setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_morning_note', { p_on: null, p_hour: null, ...args });
    setBusy(false);
    if (error || !data || data.ok === false) { setMsg('Could not save: ' + (error?.message || data?.error || 'try again') + '. Nothing has changed.'); return; }
    setN(v => ({ ...v, morning_note: data.on, morning_note_hour: data.hour })); setMsg('Saved.');
  };
  if (!n) return msg ? <div className="panel" style={{ marginBottom: 18 }}><div className="panel-body" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{msg}</div></div> : null;
  const sel = { minHeight: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontSize: 14 };
  const radio = (on, name, what, onClick, tid) => (
    <button type="button" role="radio" aria-checked={on} data-testid={tid} disabled={busy} onClick={() => !on && onClick()}
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 0', minHeight: 44, cursor: busy ? 'wait' : 'pointer' }}>
      <span style={{ flexShrink: 0, width: 18, height: 18, marginTop: 1, borderRadius: '50%', border: '2px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent)' : 'transparent' }} />
      <span style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}><strong>{name}.</strong> <span style={{ color: 'var(--text-2)' }}>{what}</span></span>
    </button>
  );
  const hours = n.digest_hours || [9, 13, 17];
  const setHour = (i, h) => { const next = hours.slice(); next[i] = h; save({ p_digest_hours: next }); };
  return (
    <div className="panel" data-testid="notify-settings" style={{ marginBottom: 18 }}>
      <div className="panel-header"><h3>When PrismOS may notify me</h3></div>
      <div className="panel-body">
        {n.devices === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 }}>No phone or computer is set up to receive notifications for you yet, so nothing below reaches you until one is.</div>}
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Reply reminders and “still worth doing?”</div>
        {radio(n.mode === 'live', 'As they happen', 'At most one reply reminder an hour.', () => save({ p_mode: 'live' }), 'notify-live')}
        {radio(n.mode === 'digest', 'A few times a day', 'Kept and sent together, at the times you pick. Skipped when there is nothing.', () => save({ p_mode: 'digest' }), 'notify-digest')}
        {n.mode === 'digest' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 6px 28px' }}>
            {hours.map((h, i) => (
              <select key={i} aria-label={'Update ' + (i + 1)} disabled={busy} value={h} onChange={e => setHour(i, Number(e.target.value))} style={sel}>
                {HOURS.map(x => <option key={x} value={x}>{hourLabel(x)}</option>)}
              </select>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Quiet hours</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--text-2)' }}>
            <span>From</span>
            <select aria-label="Quiet hours start" data-testid="quiet-start" disabled={busy} value={n.quiet_start} onChange={e => save({ p_quiet_start: Number(e.target.value) })} style={sel}>{HOURS.map(x => <option key={x} value={x}>{hourLabel(x)}</option>)}</select>
            <span>until</span>
            <select aria-label="Quiet hours end" data-testid="quiet-end" disabled={busy} value={n.quiet_end} onChange={e => save({ p_quiet_end: Number(e.target.value) })} style={sel}>{HOURS.map(x => <option key={x} value={x}>{hourLabel(x)}</option>)}</select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>Anything that arrives in quiet hours is kept and sent as one notification when they end. Nothing is dropped.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>A new lead or a contract date may notify me during quiet hours.</p>
            <button onClick={() => save({ p_urgent_breaks_quiet: !n.urgent_breaks_quiet })} role="switch" aria-checked={!!n.urgent_breaks_quiet} aria-label="A new lead or a contract date may notify me during quiet hours" data-testid="notify-urgent" disabled={busy}
              style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: busy ? 'wait' : 'pointer', background: n.urgent_breaks_quiet ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 3, left: n.urgent_breaks_quiet ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
              <strong style={{ color: 'var(--text-1)' }}>Morning note.</strong> One short notification: the first thing on your calendar, any contract date in the next three days, and the goals you chose. No counts.
            </p>
            <button onClick={() => morning({ p_on: !n.morning_note })} role="switch" aria-checked={!!n.morning_note} aria-label="Morning note" data-testid="morning-note" disabled={busy}
              style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: busy ? 'wait' : 'pointer', background: n.morning_note ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 3, left: n.morning_note ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
          {n.morning_note && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13, color: 'var(--text-2)' }}>
              <span>At</span>
              <select aria-label="Morning note time" data-testid="morning-note-hour" disabled={busy} value={n.morning_note_hour} onChange={e => morning({ p_hour: Number(e.target.value) })} style={sel}>
                {HOURS.filter(x => x >= 4 && x <= 12).map(x => <option key={x} value={x}>{hourLabel(x)}</option>)}
              </select>
            </div>
          )}
        </div>
        {msg && <div data-testid="notify-msg" style={{ marginTop: 12, fontSize: 12, color: msg.startsWith('Saved') ? 'var(--text-2)' : 'var(--red)' }}>{msg}</div>}
      </div>
    </div>
  );
}
