import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../dataService';
import { notify } from '../notify';
import { dateNY, timeNY } from '../clock';

// Last night's panel.
//
// Eight specialists review the live system at 1am New York and leave this. The
// screen's job is to be readable in the two minutes Dara has with coffee: the
// briefing first, in prose, then the findings underneath for when one of them
// catches his eye.
//
// Two controls, both his: stop the panel entirely, and — when he is ready — let
// it make fixes. The second stays off until he has watched what it proposes for
// a few weeks, which was the agreement.

const EFFORT = { small: '#86efac', medium: '#EBCB82', large: '#E4674F' };

export default function NightReview() {
  const [proposals, setProposals] = useState([]);
  const [openDiff, setOpenDiff] = useState(null);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: props }] = await Promise.all([
      supabase.from('panel_proposals').select('*')
        .in('status', ['awaiting_review', 'approved', 'merged', 'rejected', 'failed'])
        .order('created_at', { ascending: false }).limit(25),
    ]);
    setProposals(props || []);
    const [{ data: rows, error: e1 }, { data: c }] = await Promise.all([
      supabase.from('night_review_runs').select('*').order('started_at', { ascending: false }).limit(14),
      supabase.from('night_review_config').select('*').eq('id', true).maybeSingle(),
    ]);
    if (e1) { setErr(e1.message); return; }
    setRuns(rows || []);
    setRun((rows || [])[0] || null);
    setCfg(c || null);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Approval is a DATABASE write, not a call to the merge endpoint. The browser
  // never holds the internal token, and the actual merge is performed
  // server-side by the job that watches for approved-and-green proposals. A
  // token shipped in the bundle is a token anyone can read.
  async function decide(id, next) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('panel_proposals').update({
      status: next, decided_by: user ? user.id : null, decided_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { notify('Could not record that: ' + error.message, 'error'); return; }
    setProposals(ps => ps.map(p => p.id === id ? { ...p, status: next } : p));
    notify(next === 'approved'
      ? 'Approved. It merges once the gate is green.'
      : 'Rejected. It will not be raised again.', 'success');
  }

  async function toggle(field, value) {
    setBusy(true);
    const { error } = await supabase.from('night_review_config').update({ [field]: value }).eq('id', true);
    setBusy(false);
    if (error) { notify('Could not change that: ' + error.message, 'error'); return; }
    setCfg(c => ({ ...(c || {}), [field]: value }));
    notify(field === 'enabled'
      ? (value ? 'The panel will run tonight.' : 'The panel is stopped.')
      : (value ? 'The panel may now make fixes.' : 'Fixes are off; it will only advise.'), 'success');
  }

  if (err) return <div style={{ padding: 20, color: 'var(--text-3)' }}>{err}</div>;

  const findings = (run && run.findings) || [];

  return (
    <div style={{ padding: '2px 2px 20px' }}>
      <div className="room-eyebrow" style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase',
        letterSpacing: '.14em', fontSize: 11, fontWeight: 700 }}>Overnight</div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 30, margin: '4px 0 6px', display: 'flex', minWidth: 0 }}>
        <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>What the panel found.</span>
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
        {run
          ? 'Reviewed ' + dateNY(run.started_at) + ' at ' + timeNY(run.started_at)
            + (run.cost_usd ? ' · ' + (run.cost_usd < 0.01 ? 'under a cent' : '$' + Number(run.cost_usd).toFixed(2)) : '')
          : 'The panel has not run yet. It reviews at 1am and leaves its findings here.'}
      </div>
      <hr className="room-rule" />

      {run && run.status === 'failed' && (
        // A failed review is stated, never silent. Dara should never wonder
        // whether the panel found nothing or simply never ran.
        <div style={{ border: '1px solid rgba(201,86,63,.5)', background: 'rgba(201,86,63,.10)',
          borderRadius: 11, padding: '12px 13px', margin: '14px 0', fontSize: 13, color: '#E4674F' }}>
          Last night's review failed and left nothing. {run.error ? String(run.error).slice(0, 200) : ''}
        </div>
      )}

      {/* PROPOSALS — actual changes, waiting on Dara. Above the briefing,
          because a decision outranks a report. */}
      {proposals.filter(p => p.status === 'awaiting_review').length > 0 && (
        <div style={{ margin: '14px 0 6px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--room-accent-85, var(--text-3))', marginBottom: 8 }}>
            Waiting on you
          </div>
          {proposals.filter(p => p.status === 'awaiting_review').map(p => (
            <div key={p.id} style={{ border: '1px solid var(--room-accent-34, var(--border))', borderRadius: 12,
              padding: '13px 14px', marginBottom: 9 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em',
                  color: 'var(--text-3)' }}>{p.kind}</span>
                {/* The gate is the floor. It is stated on the card, because an
                    approval on a red gate is refused server-side anyway and the
                    screen should not imply otherwise. */}
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 100,
                  color: p.gate_status === 'green' ? '#86efac' : p.gate_status === 'red' ? '#E4674F' : 'var(--text-3)',
                  background: p.gate_status === 'green' ? 'rgba(34,197,94,.14)'
                    : p.gate_status === 'red' ? 'rgba(201,86,63,.16)' : 'rgba(246,241,231,.06)' }}>
                  {p.gate_status === 'green' ? 'gate green' : p.gate_status === 'red' ? 'gate RED' : 'gate ' + (p.gate_status || 'not run')}
                </span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', margin: '6px 0 5px', lineHeight: 1.4 }}>
                {p.summary}
              </div>
              {p.rationale && (
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}>{p.rationale}</div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 8 }}>
                {(p.files || []).length} file{(p.files || []).length === 1 ? '' : 's'}
                {(p.files || []).length ? ' · ' + (p.files || []).map(f => f.path).join(', ') : ''}
              </div>
              {p.diff && (
                <button type="button" onClick={() => setOpenDiff(openDiff === p.id ? null : p.id)}
                  style={{ fontSize: 11.5, fontWeight: 700, background: 'none', border: 0, padding: 0, marginBottom: 8,
                    color: 'var(--room-accent, var(--accent))', cursor: 'pointer' }}>
                  {openDiff === p.id ? 'Hide the change' : 'See the change'}
                </button>
              )}
              {openDiff === p.id && p.diff && (
                <pre style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-2)', background: 'var(--bg-base)',
                  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px', overflowX: 'auto',
                  whiteSpace: 'pre', marginBottom: 9 }}>{p.diff}</pre>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={p.gate_status !== 'green'} onClick={() => decide(p.id, 'approved')}
                  style={{ fontSize: 12, fontWeight: 800, padding: '8px 16px', borderRadius: 9, border: 0,
                    cursor: p.gate_status === 'green' ? 'pointer' : 'not-allowed',
                    background: p.gate_status === 'green' ? '#EBCB82' : 'rgba(235,203,130,.25)',
                    color: p.gate_status === 'green' ? '#1a1205' : 'var(--text-3)' }}>
                  Approve
                </button>
                <button type="button" onClick={() => decide(p.id, 'rejected')}
                  style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  Reject
                </button>
                {p.gate_status !== 'green' && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
                    {p.gate_status === 'red' ? 'The gate failed — this cannot be approved.' : 'Waiting for the gate.'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {run && run.briefing && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 15px', margin: '14px 0',
          background: 'linear-gradient(180deg, var(--room-accent-08, transparent), transparent 62%), var(--bg-card)' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--room-accent-85, var(--text-3))', marginBottom: 8 }}>The briefing</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
            {run.briefing}
          </div>
        </div>
      )}

      {findings.length > 0 && (
        <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
          color: 'var(--text-3)', margin: '18px 0 8px' }}>
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </div>
      )}

      {findings.map((f, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--room-accent, var(--accent))' }}>{f.agent}</span>
            {f.effort && (
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em',
                color: EFFORT[f.effort] || 'var(--text-3)' }}>{f.effort}</span>
            )}
            {f.confidence && f.confidence !== 'high' && (
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{f.confidence} confidence</span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '5px 0 6px', lineHeight: 1.4 }}>
            {f.title}
          </div>
          {f.evidence && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5,
              borderLeft: '2px solid var(--room-accent-30, var(--border))', paddingLeft: 9, marginBottom: 6 }}>
              {f.evidence}
            </div>
          )}
          {f.why_it_matters && (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{f.why_it_matters}</div>
          )}
        </div>
      ))}

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', marginTop: 18 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
          color: 'var(--text-3)', marginBottom: 9 }}>Your controls</div>
        {[
          ['enabled', 'Run the panel each night', 'Stops immediately. Nothing is spent while it is off.'],
          ['allow_fixes', 'Let it propose changes overnight', 'It writes the change and runs the gate. Nothing merges without you.'],
        ].map(([field, label, hint]) => (
          <div key={field} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
            <button type="button" disabled={busy || !cfg} onClick={() => toggle(field, !(cfg || {})[field])}
              style={{ width: 42, height: 24, borderRadius: 999, flexShrink: 0, cursor: 'pointer', position: 'relative',
                border: '1px solid ' + ((cfg || {})[field] ? 'var(--room-accent, var(--accent))' : 'var(--border)'),
                background: (cfg || {})[field] ? 'var(--room-accent-30, rgba(203,163,92,.3))' : 'transparent' }}>
              <span style={{ position: 'absolute', top: 2, left: (cfg || {})[field] ? 20 : 2, width: 17, height: 17,
                borderRadius: '50%', background: (cfg || {})[field] ? 'var(--room-accent, var(--accent))' : 'var(--text-3)',
                transition: 'left .15s' }} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.45 }}>{hint}</div>
            </div>
          </div>
        ))}
      </div>

      {/* The dial. Level 1 is real autonomy, so it is separated from the
          switches above and says exactly what it permits. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', marginTop: 10 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
          color: 'var(--text-3)', marginBottom: 7 }}>Autonomy</div>
        <div style={{ display: 'flex', gap: 7 }}>
          {[[0, 'Propose only'], [1, 'Merge small fixes']].map(([lvl, label]) => (
            <button key={lvl} type="button" disabled={busy || !cfg}
              onClick={() => toggle('autonomy_level', lvl)}
              style={{ flex: 1, padding: '9px 6px', borderRadius: 9, fontSize: 12.5, cursor: 'pointer',
                fontWeight: (cfg || {}).autonomy_level === lvl ? 800 : 600,
                border: '1px solid ' + ((cfg || {}).autonomy_level === lvl ? 'var(--room-accent, var(--accent))' : 'var(--border)'),
                background: (cfg || {}).autonomy_level === lvl ? 'var(--room-accent-16, rgba(203,163,92,.16))' : 'transparent',
                color: (cfg || {}).autonomy_level === lvl ? 'var(--room-accent, var(--accent))' : 'var(--text-2)' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          {(cfg || {}).autonomy_level === 1
            ? 'It may merge ' + (((cfg || {}).allowed_kinds) || []).join(', ') + ' on its own — but only with a green gate, only ' + ((cfg || {}).max_autonomous_per_night || 3) + ' a night, and never migrations, permissions or money.'
            : 'Every change waits for you, however small. Nothing merges on its own.'}
        </div>
      </div>

      {runs.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--text-3)', marginBottom: 7 }}>Earlier nights</div>
          {runs.slice(1).map(r => (
            <button key={r.id} type="button" onClick={() => setRun(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer',
                border: 0, borderBottom: '1px solid var(--border)', padding: '9px 2px',
                color: run && run.id === r.id ? 'var(--room-accent, var(--accent))' : 'var(--text-2)', fontSize: 12.5 }}>
              {dateNY(r.started_at)} · {r.status === 'done'
                ? ((r.findings || []).length + ' finding' + ((r.findings || []).length === 1 ? '' : 's'))
                : r.status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
