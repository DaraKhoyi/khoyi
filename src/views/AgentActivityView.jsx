import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

const AGENT_LABEL = { new_lead: 'New-lead plan', post_close: 'Post-close plan' };
const STATUS = {
  prepared: { c: 'var(--accent)', t: 'Prepared' },
  approved: { c: '#3b82f6', t: 'Approved · running' },
  engaged: { c: '#22c55e', t: 'Replied · handed off' },
  converted: { c: '#22c55e', t: 'Converted' },
  nurture: { c: '#14b8a6', t: 'In nurture' },
  dismissed: { c: 'var(--text-3)', t: 'Dismissed' },
  closed: { c: 'var(--text-3)', t: 'Closed' },
};
function fmt(iso) { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }

export default function AgentActivityView({ userId }) {
  const [rows, setRows] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    try {
      const [{ data: act }, { data: ctrl }] = await Promise.all([
        supabase.rpc('my_agent_activity', { p_limit: 80 }),
        supabase.from('agent_controls').select('paused').eq('user_id', userId).maybeSingle(),
      ]);
      setRows(Array.isArray(act) ? act : []);
      setPaused(!!(ctrl && ctrl.paused));
    } catch (_) { setRows([]); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function togglePause() {
    setPauseBusy(true);
    const next = !paused;
    try { await supabase.from('agent_controls').upsert({ user_id: userId, paused: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); setPaused(next); } catch (_) {}
    setPauseBusy(false);
  }

  const counts = (rows || []).reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const stat = (k) => counts[k] || 0;

  return (
    <div className="ww-prism" style={{ maxWidth: '760px', margin: '0 auto' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 24% at 50% -3%, rgba(203,163,92,.08), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div style={{ marginBottom: '4px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><span>🛡️</span> Agent activity</h2>
        <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '2px' }}>A record of everything your AI agents have done — what they touched, and how it turned out. Read-only.</div>
      </div>

      {/* Kill switch */}
      <div className="panel" style={{ marginTop: '12px', borderColor: paused ? 'var(--red)' : 'var(--border)' }}>
        <div className="panel-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>{paused ? 'Autonomous agents are paused' : 'Autonomous agents are active'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '3px', lineHeight: 1.45 }}>
              {paused
                ? 'Scheduled agents (new-lead, post-close, lifecycle, Chief of Staff) will not run on their own. You can still trigger any of them by hand.'
                : 'Scheduled agents prepare plans and follow up on their own. Nothing is ever sent without your approval.'}
            </div>
          </div>
          <button className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-ghost'}`} disabled={pauseBusy} onClick={togglePause} style={{ whiteSpace: 'nowrap' }}>
            {pauseBusy ? '…' : paused ? 'Resume' : 'Pause agents'}
          </button>
        </div>
      </div>

      {/* Summary */}
      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '14px 0 4px' }}>
          {[['prepared', 'prepared'], ['approved', 'running'], ['engaged', 'replied'], ['converted', 'converted'], ['nurture', 'nurturing']].map(([k, label]) => (
            <div key={k} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px 12px', minWidth: '72px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: STATUS[k].c }}>{stat(k)}</div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {rows === null && <div style={{ color: 'var(--text-3)', fontSize: '13px', padding: '18px 2px' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="panel" style={{ marginTop: '14px' }}><div className="panel-body" style={{ textAlign: 'center', padding: '26px 16px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-1)' }}>No agent activity yet.</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '6px' }}>As new leads arrive and deals close, your agents will prepare plans and their work will show up here.</div>
        </div></div>
      )}

      {/* Feed */}
      {rows && rows.map(r => {
        const s = STATUS[r.status] || { c: 'var(--text-3)', t: r.status };
        const when = r.decided_at || r.created_at;
        const open = expanded[r.id];
        const steps = Array.isArray(r.steps) ? r.steps : [];
        return (
          <div key={r.id} className="panel" style={{ marginTop: '10px', borderLeft: `3px solid ${s.c}` }}>
            <div className="panel-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{AGENT_LABEL[r.agent] || r.agent}</span>
                <span style={{ fontSize: '10px', color: '#fff', background: s.c, borderRadius: '6px', padding: '1px 7px', fontWeight: 700 }}>{s.t}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-3)', marginLeft: 'auto' }}>{fmt(when)}</span>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-1)', marginTop: '4px' }}>{r.target_name || 'Contact'}</div>
              {r.summary && <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '3px', lineHeight: 1.45 }}>{r.summary}</div>}
              {steps.length > 0 && (
                <button onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', padding: '8px 0 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {open ? '▾ Hide steps' : `▸ What it did (${steps.length} steps)`}
                </button>
              )}
              {open && (
                <div style={{ marginTop: '8px', borderLeft: '2px solid var(--border)', paddingLeft: '12px' }}>
                  {steps.map((st, i) => (
                    <div key={i} style={{ marginBottom: '6px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'capitalize' }}>{(st.step || 'step').replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.4 }}>{st.detail || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
