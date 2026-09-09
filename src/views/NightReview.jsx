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
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
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
          ['allow_fixes', 'Let it make fixes overnight', 'Off by design. Turn this on only once you trust what it proposes.'],
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
