import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';

const GOLD = '#C5A95E';
const KIND_LABEL = { boundary: 'View crash', window: 'Uncaught error', promise: 'Promise rejection' };
const KIND_COLOR = { boundary: '#ef4444', window: '#f59e0b', promise: '#3b82f6' };

function rel(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}

export default function AppHealthView() {
  const [rows, setRows] = useState(null);
  const [win, setWin] = useState('7d');
  const [expanded, setExpanded] = useState({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr(''); setRows(null);
    const days = win === '24h' ? 1 : win === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase.from('client_errors').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  }, [win]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const m = new Map();
    (rows || []).forEach(r => {
      const key = `${r.view || '?'}|${(r.message || '').slice(0, 160)}`;
      if (!m.has(key)) m.set(key, { key, view: r.view, message: r.message, kind: r.kind, count: 0, last: r.created_at, users: new Set(), versions: new Set(), sample: r });
      const g = m.get(key);
      g.count++;
      if (new Date(r.created_at) > new Date(g.last)) g.last = r.created_at;
      if (r.email) g.users.add(r.email);
      if (r.app_version) g.versions.add(r.app_version);
    });
    return Array.from(m.values()).sort((a, b) => new Date(b.last) - new Date(a.last));
  }, [rows]);

  const totalUsers = useMemo(() => { const s = new Set(); (rows || []).forEach(r => r.email && s.add(r.email)); return s.size; }, [rows]);

  const seg = (v, l) => <button onClick={() => setWin(v)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: win === v ? GOLD : 'transparent', color: win === v ? '#0d0f14' : 'var(--text-2)' }}>{l}</button>;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>🩺 App health</h2>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={load}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>Crashes and errors your agents hit, captured automatically the instant they happen — with the user, view, app version and stack. See problems before your agents have to tell you.</div>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, width: 'fit-content' }}>
        {seg('24h', '24 hours')}{seg('7d', '7 days')}{seg('30d', '30 days')}
      </div>

      {err && <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: 8, color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>Couldn't load errors: {err}</div>}

      {rows === null ? <div style={{ color: 'var(--text-3)', padding: 20 }}>Loading…</div>
        : groups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', border: '1px dashed var(--border)', borderRadius: 14 }}>
            <div style={{ fontSize: 34 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', marginTop: 6 }}>No errors in this window</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>Everything's running clean. Anything that breaks will appear here the instant a user hits it.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, marginBottom: 14, fontSize: 13 }}>
              <span><b style={{ color: 'var(--text-1)', fontSize: 19 }}>{groups.length}</b> <span style={{ color: 'var(--text-3)' }}>issue{groups.length === 1 ? '' : 's'}</span></span>
              <span><b style={{ color: 'var(--text-1)', fontSize: 19 }}>{rows.length}</b> <span style={{ color: 'var(--text-3)' }}>total hits</span></span>
              <span><b style={{ color: totalUsers ? '#ef4444' : 'var(--text-1)', fontSize: 19 }}>{totalUsers}</b> <span style={{ color: 'var(--text-3)' }}>user{totalUsers === 1 ? '' : 's'} affected</span></span>
            </div>
            {groups.map(g => {
              const open = expanded[g.key];
              return (
                <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10, background: 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', background: KIND_COLOR[g.kind] || '#6b7280', borderRadius: 5, padding: '2px 7px' }}>{KIND_LABEL[g.kind] || g.kind}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: GOLD }}>{g.view || 'unknown view'}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{rel(g.last)}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, wordBreak: 'break-word', marginBottom: 8 }}>{g.message || '(no message)'}</div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span><b style={{ color: 'var(--text-2)' }}>{g.count}×</b></span>
                    <span>{g.users.size} user{g.users.size === 1 ? '' : 's'}{g.users.size ? ': ' + Array.from(g.users).slice(0, 3).join(', ') + (g.users.size > 3 ? '…' : '') : ''}</span>
                    <span>v{Array.from(g.versions).join(', ')}</span>
                    <button onClick={() => setExpanded(s => ({ ...s, [g.key]: !s[g.key] }))} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>{open ? 'Hide details' : 'Show stack'}</button>
                  </div>
                  {open && (
                    <pre style={{ marginTop: 10, padding: 10, background: 'var(--bg-hover)', borderRadius: 8, fontSize: 10.5, color: 'var(--text-2)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280, overflowY: 'auto', margin: '10px 0 0' }}>
{(g.sample.stack || '(no stack)')}{g.sample.component_stack ? '\n\n— Component stack —\n' + g.sample.component_stack : ''}{'\n\n— Device —\n' + (g.sample.user_agent || '')}
                    </pre>
                  )}
                </div>
              );
            })}
          </>
        )}
    </div>
  );
}
