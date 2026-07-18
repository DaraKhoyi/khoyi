import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import WorkerHealth from './WorkerHealth';

const GOLD = '#C5A95E';
const KIND_LABEL = { boundary: 'View crash', window: 'Uncaught error', promise: 'Promise rejection' };
const KIND_COLOR = { boundary: '#ef4444', window: '#f59e0b', promise: '#3b82f6' };
const STATUS = { new: { t: 'New', c: '#ef4444' }, notified: { t: 'Diagnosed', c: '#f59e0b' }, investigating: { t: 'Investigating', c: '#3b82f6' }, resolved: { t: 'Resolved', c: '#22c55e' } };

function rel(ts) {
  if (!ts) return '';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}

export default function AppHealthView() {
  const [rows, setRows] = useState(null);
  const [win, setWin] = useState('7d');
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr(''); setRows(null);
    const days = win === '24h' ? 1 : win === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase.from('crash_signatures').select('*').gte('last_seen', since).order('last_seen', { ascending: false }).limit(500);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  }, [win]);
  useEffect(() => { load(); }, [load]);

  const resolve = async (id, toResolved) => {
    setRows(rs => (rs || []).map(r => r.id === id ? { ...r, status: toResolved ? 'resolved' : 'notified' } : r));
    await supabase.from('crash_signatures').update({ status: toResolved ? 'resolved' : 'notified', updated_at: new Date().toISOString() }).eq('id', id);
  };

  const visible = useMemo(() => (rows || []).filter(r => showResolved || r.status !== 'resolved'), [rows, showResolved]);
  const openCount = useMemo(() => (rows || []).filter(r => r.status !== 'resolved').length, [rows]);
  const usersAffected = useMemo(() => (rows || []).filter(r => r.status !== 'resolved').reduce((a, r) => a + (r.users_affected || 0), 0), [rows]);

  const seg = (v, l) => <button onClick={() => setWin(v)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: win === v ? GOLD : 'transparent', color: win === v ? '#0d0f14' : 'var(--text-2)' }}>{l}</button>;

  return (
    <div className="ww-prism" style={{ maxWidth: 820, margin: '0 auto' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 24% at 50% -3%, rgba(203,163,92,.08), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>🩺 App health</h2>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={load}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>Crashes your agents hit, captured the instant they happen and diagnosed automatically by the crash-monitor agent — likely cause, where in the code, and a suggested fix. You&rsquo;ll see a problem here (and get a push) before an agent has to tell you.</div>
      {/* Crashes were watched; the 38 jobs that actually run the business were not.
          bounce-scan answered 401 every ten minutes for months and nothing said a
          word — this panel is the alarm that should have existed. */}
      <WorkerHealth />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, width: 'fit-content' }}>
          {seg('24h', '24 hours')}{seg('7d', '7 days')}{seg('30d', '30 days')}
        </div>
        <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> show resolved
        </label>
      </div>

      {err && <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: 8, color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>Couldn't load: {err}</div>}

      {rows === null ? <div style={{ color: 'var(--text-3)', padding: 20 }}>Loading…</div>
        : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', border: '1px dashed var(--border)', borderRadius: 14 }}>
            <div style={{ fontSize: 34 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', marginTop: 6 }}>All clear</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>No open crashes in this window. Anything new will appear here — diagnosed — the instant a user hits it.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, marginBottom: 14, fontSize: 13 }}>
              <span><b style={{ color: openCount ? '#ef4444' : 'var(--text-1)', fontSize: 19 }}>{openCount}</b> <span style={{ color: 'var(--text-3)' }}>open issue{openCount === 1 ? '' : 's'}</span></span>
              <span><b style={{ color: usersAffected ? '#ef4444' : 'var(--text-1)', fontSize: 19 }}>{usersAffected}</b> <span style={{ color: 'var(--text-3)' }}>user-hits</span></span>
            </div>
            {visible.map(g => {
              const open = expanded[g.id];
              const st = STATUS[g.status] || STATUS.notified;
              const resolved = g.status === 'resolved';
              return (
                <div key={g.id} style={{ border: `1px solid ${resolved ? 'var(--border)' : (KIND_COLOR[g.kind] || '#6b7280') + '44'}`, borderRadius: 12, padding: 12, marginBottom: 10, background: 'var(--bg-card)', opacity: resolved ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', background: KIND_COLOR[g.kind] || '#6b7280', borderRadius: 5, padding: '2px 7px' }}>{KIND_LABEL[g.kind] || g.kind}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: GOLD }}>{g.view || 'unknown view'}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', color: '#fff', background: st.c, borderRadius: 5, padding: '2px 7px' }}>{st.t}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{rel(g.last_seen)}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, wordBreak: 'break-word', marginBottom: 8 }}>{g.message || '(no message)'}</div>

                  {g.ai_diagnosis && (
                    <div style={{ background: 'rgba(197,169,94,.07)', border: `1px solid ${GOLD}33`, borderRadius: 9, padding: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: GOLD, marginBottom: 4 }}>&#10024; AI diagnosis</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>{g.ai_diagnosis}</div>
                      {g.ai_area && <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 5 }}><b style={{ color: 'var(--text-3)' }}>Where:</b> {g.ai_area}</div>}
                      {g.ai_suggested_fix && <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}><b style={{ color: 'var(--text-3)' }}>Suggested fix:</b> {g.ai_suggested_fix}</div>}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span><b style={{ color: 'var(--text-2)' }}>{g.hit_count}&times;</b></span>
                    <span>{g.users_affected} user{g.users_affected === 1 ? '' : 's'}</span>
                    <span>v{(g.app_versions || []).join(', ')}</span>
                    <button onClick={() => setExpanded(s => ({ ...s, [g.id]: !s[g.id] }))} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>{open ? 'Hide' : 'Details'}</button>
                    <button onClick={() => resolve(g.id, !resolved)} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${resolved ? 'var(--border)' : '#22c55e'}`, color: resolved ? 'var(--text-3)' : '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 700, borderRadius: 7, padding: '3px 9px' }}>{resolved ? 'Reopen' : '\u2713 Mark resolved'}</button>
                  </div>
                  {open && (
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
                      First seen {rel(g.first_seen)} &middot; <code style={{ fontSize: 10 }}>{g.signature}</code>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
    </div>
  );
}
