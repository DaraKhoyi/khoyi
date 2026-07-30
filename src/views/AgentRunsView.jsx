import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../App';

const DISC = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6', '?': 'var(--text-3)' };
const PLAN_LABEL = { new_lead: 'New-lead plan', post_close: 'Post-close plan', new_listing: 'New-listing plan', listing_presentation: 'Listing presentation' };
const TOUCH_LABEL = { new_lead: 'First touch', post_close: 'Thank-you', new_listing: 'Just-listed announcement', listing_presentation: 'Pre-appointment note' };
function estDate(offset) { const d = new Date(Date.now() + (offset || 0) * 86400000); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }

export default function AgentRunsView({ userId, setView }) {
  const [runs, setRuns] = useState(null);
  const [done, setDone] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ data: prepared }, { data: recent }] = await Promise.all([
        supabase.rpc('my_agent_runs', { p_status: 'prepared' }),
        supabase.rpc('my_agent_runs', { p_status: null }),
      ]);
      setRuns(Array.isArray(prepared) ? prepared : []);
      setDone((Array.isArray(recent) ? recent : []).filter(r => r.status !== 'prepared').slice(0, 8));
    } catch (_) { setRuns([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function approve(run) {
    setBusyId(run.id);
    try {
      const o = run.output || {};
      const cid = run.target_id;
      for (const step of (o.cadence || [])) {
        const isFirst = (step.day_offset || 0) === 0;
        let notes = `[${step.channel || 'touch'}]`;
        if (isFirst && o.first_touch) notes += `\n\n${o.first_touch.subject ? 'Subject: ' + o.first_touch.subject + '\n\n' : ''}${o.first_touch.body || ''}`;
        else if (step.body) notes += `\n\n${step.body}`;
        const { error: tErr } = await supabase.from('tasks').insert({ user_id: userId, title: step.action || 'Follow up', due_date: estDate(step.day_offset), priority: 'medium', completed: false, list: 'inbox', contact_id: cid || null, source_url: 'cadence:' + run.id, notes });
        if (tErr) { if (window.__notify) window.__notify('Could not create the task: ' + (tErr.message || tErr), 'error'); return; }
      }
      await supabase.from('agent_runs').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', run.id);
    } catch (_) {}
    setBusyId(null); load();
  }
  async function dismiss(run) { setBusyId(run.id); const { error } = await supabase.from('agent_runs').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', run.id); if (error && window.__notify) window.__notify('Could not dismiss: ' + (error.message || error), 'error'); setBusyId(null); load(); }

  return (
    <div className="ww-prism" style={{ maxWidth: '720px', margin: '0 auto' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 24% at 50% -3%, rgba(203,163,92,.08), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div style={{ marginBottom: '4px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><span>🤖</span> Prepared by your agents</h2>
        <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '2px' }}>Plans your agents put together for you. Review, then approve to put them into motion.</div>
      </div>

      {runs === null && <div style={{ color: 'var(--text-3)', fontSize: '13px', padding: '18px 2px' }}>Loading…</div>}
      {runs && runs.length === 0 && (
        <div className="panel" style={{ marginTop: '14px' }}><div className="panel-body" style={{ textAlign: 'center', padding: '26px 16px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-1)' }}>Nothing waiting on you. ✨</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '6px' }}>When a new lead comes in or a deal closes, your agents will prepare a plan here — ready for one tap.</div>
        </div></div>
      )}

      {runs && runs.map(run => {
        const o = run.output || {};
        const ft = o.first_touch || {};
        const disc = (o.disc_hint || {}).letter;
        const who = (run.agent === 'new_listing' || run.agent === 'listing_presentation') ? (o.address || (run.agent === 'listing_presentation' ? 'Listing opportunity' : 'New listing')) : (run.target_name || o.client_name || (run.agent === 'post_close' ? 'Recent client' : 'New lead'));
        return (
          <div key={run.id} className="panel" style={{ marginTop: '12px' }}>
            <div className="panel-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{PLAN_LABEL[run.agent] || 'Plan'}</span>
                {disc && <span style={{ fontSize: '10px', color: '#fff', background: DISC[disc] || DISC['?'], borderRadius: '6px', padding: '1px 7px', fontWeight: 700 }}>DISC {disc}</span>}
                {run.agent === 'post_close' && o.address && <span style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-hover)', borderRadius: '6px', padding: '1px 7px' }}>{o.address}</span>}
              </div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-1)' }}>{who}</div>
              {run.summary && <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '4px', lineHeight: 1.5 }}>{run.summary}</div>}

              {(ft.body) && (
                <div style={{ marginTop: '10px', background: 'var(--bg-hover)', borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>{TOUCH_LABEL[run.agent] || 'First touch'} · {ft.channel || 'message'}</div>
                  {ft.subject && <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '4px' }}>{ft.subject}</div>}
                  <div style={{ fontSize: '12.5px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{ft.body}</div>
                </div>
              )}

              {run.agent === 'new_listing' && o.listing_description && (
                <div style={{ marginTop: '10px', background: 'var(--bg-hover)', borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>MLS description</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{o.listing_description}</div>
                  {o.pricing_note && <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: 1.45 }}><strong style={{ color: 'var(--text-2)' }}>Pricing:</strong> {o.pricing_note}</div>}
                </div>
              )}

              {run.agent === 'listing_presentation' && o.marketing_plan && (
                <div style={{ marginTop: '10px', background: 'var(--bg-hover)', borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>Marketing plan to present</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{o.marketing_plan}</div>
                  {o.why_me && <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: 1.45 }}><strong style={{ color: 'var(--text-2)' }}>Why me:</strong> {o.why_me}</div>}
                  {o.pricing_note && <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px', lineHeight: 1.45 }}><strong style={{ color: 'var(--text-2)' }}>Pricing:</strong> {o.pricing_note}</div>}
                </div>
              )}

              {Array.isArray(o.cadence) && o.cadence.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>{run.agent === 'new_listing' ? 'Launch checklist' : run.agent === 'listing_presentation' ? 'Presentation checklist' : 'Follow-up cadence'} ({o.cadence.length} {(run.agent === 'new_listing' || run.agent === 'listing_presentation') ? 'steps' : 'touches'})</div>
                  {o.cadence.map((s, i) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '2px' }}><span style={{ color: 'var(--accent)', fontWeight: 600 }}>Day {s.day_offset}</span> · {s.action} <span style={{ color: 'var(--text-3)' }}>[{s.channel}]</span></div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-primary btn-sm" disabled={busyId === run.id} onClick={() => approve(run)}>{busyId === run.id ? 'Setting up…' : 'Approve & schedule'}</button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === run.id} onClick={() => dismiss(run)} style={{ color: 'var(--text-3)' }}>Dismiss</button>
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '6px' }}>Approving creates {(o.cadence || []).length} scheduled tasks (the first touch draft is saved on the Day 0 task). Nothing is sent automatically.</div>
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Recent</div>
          {done.map(r => {
            const L = { approved: '✓ Approved · cadence running', engaged: '↩ Replied · handed off to pipeline', converted: '★ Converted', nurture: '🌱 No response · in quarterly nurture', dismissed: '— Dismissed', closed: '— Closed' };
            return <div key={r.id} style={{ fontSize: '12.5px', color: 'var(--text-3)', padding: '4px 2px' }}>{L[r.status] || r.status} · {r.target_name || 'lead'}</div>;
          })}
        </div>
      )}
    </div>
  );
}
