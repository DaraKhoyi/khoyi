import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

const GOLD = '#CBA35C', CHAMP = '#EBCB82';

function fmtWhen(iso, days) {
  if (!iso) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days != null && days < 30) return days + 'd ago';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (_) { return '—'; }
}

export default function AdoptionView({ userId }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('attention');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await supabase.rpc('broker_adoption'); setData(data || { is_broker: false }); } catch (_) { setData({ is_broker: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const nudge = async (mode) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('broker-adoption-nudge', { body: { mode } });
      if (error || (data && data.error)) throw new Error((data && data.error) || error.message);
      const n = (data && data.sent) || 0;
      alert(n > 0 ? ('Reinstall + notifications steps emailed to ' + n + ' agent' + (n === 1 ? '' : 's') + '.') : (data && data.note) || 'Nobody needed the nudge.');
    }
    catch (e) { alert('Could not send: ' + (e.message || e)); }
    setBusy(false);
  };

  if (data === null) return <div className="ww-prism" style={{ padding: 24, color: '#8C8475' }}>Loading…</div>;
  if (!data.is_broker) return <div className="ww-prism" style={{ padding: 24, color: '#8C8475' }}>This view is for brokerage admins.</div>;

  const s = data.summary || {};
  const agents = data.agents || [];
  const attention = agents.filter(a => a.has_login && !a.push_on);
  const noLogin = agents.filter(a => !a.has_login);
  const healthy = agents.filter(a => a.has_login && a.push_on);
  const shown = filter === 'attention' ? attention : filter === 'nologin' ? noLogin : filter === 'healthy' ? healthy : agents;

  const pct = (n) => s.total ? Math.round((n / s.total) * 100) : 0;
  const stat = (v, l, sub, accent) => (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 13px' }}>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 24, color: accent || 'var(--text-1)', lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 3 }}>{l}</div>
      {sub ? <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 1 }}>{sub}</div> : null}
    </div>
  );
  const chip = (k, l, n) => (
    <button onClick={() => setFilter(k)} style={{ background: filter === k ? 'rgba(203,163,92,.16)' : 'transparent', border: '1px solid ' + (filter === k ? GOLD : 'var(--border)'), color: filter === k ? CHAMP : 'var(--text-2)', borderRadius: 20, padding: '6px 12px', fontSize: 12.5, fontWeight: filter === k ? 700 : 500, cursor: 'pointer', marginRight: 6 }}>{l}{n != null ? ' ' + n : ''}</button>
  );

  return (
    <div className="ww-prism" style={{ minHeight: '100%', padding: '18px 16px 90px' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Adoption</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>Who's actually reachable.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 14 }}>Everything we ship only helps agents who've logged in and turned notifications on. Here's where each agent stands.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {stat(s.with_login || 0, 'Logged in', 'of ' + (s.total || 0) + ' · ' + pct(s.with_login) + '%')}
        {stat(s.active_30d || 0, 'Active 30d', pct(s.active_30d) + '%')}
        {stat(s.push_on || 0, 'Notifications', pct(s.push_on) + '%', (s.push_on || 0) < (s.with_login || 0) ? '#e0794f' : CHAMP)}
      </div>

      {/* The one-tap fix: remind reachable agents to reinstall/enable */}
      <div style={{ background: 'rgba(203,163,92,.06)', border: '1px solid rgba(203,163,92,.25)', borderRadius: 14, padding: '13px 15px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 700, marginBottom: 3 }}>Most agents can't get a single push yet.</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 10 }}>The fastest lift is getting the {attention.length} logged-in agent{attention.length === 1 ? '' : 's'} who haven't enabled notifications to reinstall and turn them on. Send them the steps by email.</div>
        <button onClick={() => nudge('reinstall')} disabled={busy} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>{busy ? 'Sending…' : '✉️ Email the reinstall + notifications steps'}</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        {chip('attention', '⚠ Needs a nudge', attention.length)}
        {chip('nologin', 'Never logged in', noLogin.length)}
        {chip('healthy', '✓ Reachable', healthy.length)}
        {chip('all', 'All', agents.length)}
      </div>

      {shown.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '10px 2px' }}>Nobody in this group.</div>
        : shown.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px', marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.email || 'Unnamed'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {a.has_login ? 'last in ' + fmtWhen(a.last_sign_in, a.days_since) : 'never logged in'}
                {a.device ? ' · ' + a.device : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: a.has_login ? 'rgba(34,197,94,.14)' : 'rgba(140,132,117,.14)', color: a.has_login ? '#7fae8f' : 'var(--text-3)' }}>{a.has_login ? 'login' : 'no login'}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: a.push_on ? 'rgba(203,163,92,.18)' : 'rgba(224,121,79,.14)', color: a.push_on ? CHAMP : '#e0794f' }}>{a.push_on ? '🔔 on' : 'no push'}</span>
            </div>
          </div>
        ))}
    </div>
  );
}
