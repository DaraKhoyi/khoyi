import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// The channel that cannot fail for permission reasons.
//
// Push needs an OS grant that can be revoked without telling anyone, SMS needs a
// carrier, email needs the very thing that may be broken. This needs none of
// them: if the connection is down and Dara opens PrismOS, he sees it. Today is
// the first screen, so this is the first thing on it — deliberately ABOVE the
// hero, because an alert below the fold is not an alert.
//
// It is not dismissible. "Remind me later" on an outage is how the outage lasts
// a week. Acknowledging is possible (it silences the re-notifications) but the
// bar stays until the connection actually works again, and only the watcher
// clears it — by confirming the connection is live, never by someone tapping.

const KIND_LABEL = {
  google_email: 'Email',
  google_calendar: 'Calendar',
  google_drive: 'Files',
  google_contacts: 'Contacts',
  quo: 'Phone line',
  quo_credits: 'Texting',
};

function actionFor(kind) {
  if (kind === 'quo' || kind === 'quo_credits') return { label: 'Open Phone & Text', view: 'quo' };
  return { label: 'Reconnect now', view: 'settings' };
}

export default function ConnectionAlertBanner({ setView }) {
  const [alerts, setAlerts] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('connection_alerts')
        .select('id, kind, target_id, label, detail, opened_at, acknowledged_at')
        .is('resolved_at', null)
        .order('opened_at', { ascending: true });
      if (error) return;             // a failed read must not hide the app
      setAlerts(data || []);
    } catch (_) { /* never let the banner break Today */ }
  }, []);

  useEffect(() => {
    load();
    // Re-check on wake. A phone that slept through the outage should show it the
    // moment it comes back, not at the next poll.
    const onWake = () => load();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      clearInterval(t);
    };
  }, [load]);

  if (!alerts.length) return null;

  const ack = async (id) => {
    setBusy(true);
    // Optimistic, but the row is the truth — reload either way.
    const { error } = await supabase.from('connection_alerts')
      .update({ acknowledged_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (error) { try { window.__notify && window.__notify('Could not silence that — ' + error.message, 'error'); } catch (_) {} return; }
    load();
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {alerts.map(a => {
        const act = actionFor(a.kind);
        const what = KIND_LABEL[a.kind] || 'A connection';
        const since = a.opened_at ? new Date(a.opened_at) : null;
        const hours = since ? Math.max(0, Math.round((Date.now() - since.getTime()) / 36e5)) : 0;
        const howLong = hours < 1 ? 'just now' : (hours < 24 ? hours + 'h ago' : Math.round(hours / 24) + 'd ago');
        return (
          <div key={a.id} style={{
            background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.55)',
            borderRadius: 14, padding: '12px 14px', marginBottom: 8,
          }}>
            <div style={{
              fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase',
              letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#F87171',
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span>{'\u26A0 ' + what + ' is disconnected'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-3)', letterSpacing: '.06em' }}>{howLong}</span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-1)', marginTop: 5, lineHeight: 1.45, wordBreak: 'break-word' }}>
              {a.label}
              <span style={{ color: 'var(--text-3)' }}>
                {a.kind === 'quo_credits'
                  ? ' \u2014 Quo is out of prepaid credits, so texts sent from PrismOS are refused. Texts sent inside the Quo app still work. Add credits in Quo to restore it.'
                  : a.kind === 'quo' ? ' \u2014 calls and texts have stopped.'
                  : ' \u2014 nothing is syncing until you reconnect.'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { try { setView && setView(act.view); } catch (_) {} }}
                style={{ background: '#EBCB82', color: '#1a1205', fontWeight: 700, fontSize: 12.5, border: 'none', borderRadius: 9, padding: '7px 13px', cursor: 'pointer' }}>
                {act.label}
              </button>
              {!a.acknowledged_at ? (
                <button type="button" disabled={busy} onClick={() => ack(a.id)}
                  title="Stops the repeat texts. The bar stays until it actually works again."
                  style={{ background: 'transparent', color: 'var(--text-3)', fontSize: 12, border: '1px solid var(--border)', borderRadius: 9, padding: '7px 11px', cursor: 'pointer' }}>
                  Stop reminding me
                </button>
              ) : (
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', alignSelf: 'center' }}>{'Reminders silenced \u2014 still broken.'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
