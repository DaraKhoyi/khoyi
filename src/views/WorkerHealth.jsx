import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../dataService';

// ── WorkerHealth ─────────────────────────────────────────────────────────────
// 38 cron jobs run this business and not one of them was watched.
//
// pg_cron logged 147,465 runs and reported ZERO failures — because net.http_post
// returns the instant it queues the call, so the job "succeeds" whether the thing
// it fired answered 200, 401, or never answered at all. bounce-scan had been
// returning 401 every ten minutes, 144 times a day, since the day it was written:
// email bounce detection, entirely off, in perfect silence. It was found by
// replaying calls by hand, not by any alarm. The minute it was fixed it found 8
// bounces that had been sitting there unnoticed.
//
// This is the panel that would have caught it on day one.

const OK = '#22c55e', WARN = '#f59e0b', BAD = '#C9563F', UNKNOWN = '#8C8475';

const rel = (ts) => {
  if (!ts) return 'never';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
};

export default function WorkerHealth() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('worker_health');
    if (error) { setErr(error.message); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div style={{ color: BAD, fontSize: 12, padding: 12 }}>Couldn’t read worker health: {err}</div>;
  if (!rows) return <div style={{ color: 'var(--text-3)', fontSize: 12, padding: 12 }}>Checking the workers…</div>;

  const broken = rows.filter(r => r.verdict === 'broken');
  const degraded = rows.filter(r => r.verdict === 'degraded');
  const shown = showAll ? rows : [...broken, ...degraded];

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 9 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.2em', textTransform: 'uppercase', color: '#C5A95E', fontWeight: 800 }}>
          Background workers
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {rows.length} watched · last 24h
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAll(v => !v)}
          style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}>
          {showAll ? 'only problems' : 'show all'}
        </button>
      </div>

      {broken.length === 0 && degraded.length === 0 && !showAll && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 14, fontSize: 12.5, color: 'var(--text-2)' }}>
          <b style={{ color: OK }}>All {rows.length} workers are answering.</b>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Each cron now records the id of the call it fires, so a failure can be blamed on a name.
            Before this, a job that never worked at all still reported success.
          </div>
        </div>
      )}

      {shown.map(r => {
        const c = r.verdict === 'broken' ? BAD : r.verdict === 'degraded' ? WARN : r.verdict === 'unknown' ? UNKNOWN : OK;
        return (
          <div key={r.job_name} style={{ background: 'var(--bg-card)', border: `1px solid ${r.verdict === 'ok' || r.verdict === 'unknown' ? 'var(--border)' : c + '66'}`,
            borderRadius: 10, padding: '10px 12px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: c, flex: 'none' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{r.job_name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 1 }}>
                {r.schedule} · ran {r.runs_24h}× · last {rel(r.last_run)}
                {r.verdict !== 'ok' && r.verdict !== 'unknown' && r.failures_24h > 0 &&
                  <span style={{ color: c, fontWeight: 700 }}> · {r.failures_24h} failed ({r.fail_pct}%)</span>}
              </div>
              {(r.verdict === 'broken' || r.verdict === 'degraded') && (
                <div style={{ fontSize: 11, color: c, marginTop: 3 }}>{r.detail}</div>
              )}
            </div>
            {r.verdict === 'broken' && (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: BAD,
                border: `1px solid ${BAD}55`, borderRadius: 100, padding: '3px 8px' }}>DOING NOTHING</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
