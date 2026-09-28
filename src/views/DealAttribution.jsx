import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

// WHERE CLOSINGS CAME FROM — the broker's card (28 Sep 2026).
//
// Panel: "Zero of 24 closings are attributable — the Gold Report has no client
// column." Dara added CLIENT NAME / CLIENT Email that morning, and said: the
// brokerage does not run its own lead generation; every agent generates their
// own. So this card does not ask "did PrismOS make the sale". It asks, for every
// closing: who was the client, where did they come from (the agent's sphere, an
// open house, a portal, a company lead…) and how fast were they answered — so
// the brokerage can see which lead sources are worth building.
//
// Numbers come from lead_attribution() / closing_attribution(): the Gold
// Report's own "Lead Source" when present, else the earliest record PrismOS
// holds of the client. Nothing is guessed; unknown is shown as unknown.

const GOLD = '#C5A95E';
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const mins = (m) => m == null ? null : (m < 120 ? Math.round(m) + ' min' : Math.round(m / 60) + ' h');
const head = { fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: '.16em',
  textTransform: 'uppercase', color: GOLD, marginBottom: 6 };

export default function DealAttribution({ days = 90 }) {
  const [d, setD] = useState(null);
  const [showAgents, setShowAgents] = useState(false);

  useEffect(() => {
    let live = true;
    supabase.rpc('lead_attribution', { p_days: days })
      .then(({ data }) => { if (live && data && data.closings != null) setD(data); })
      .catch(() => {});
    return () => { live = false; };
  }, [days]);

  if (!d || !d.closings) return null;
  const known = (d.by_source || []).filter((s) => s.source !== 'Not recorded yet');
  const unknown = (d.by_source || []).find((s) => s.source === 'Not recorded yet');
  const top = Math.max(1, ...known.map((s) => Number(s.gci) || 0));
  const missing = d.missing_client_since_columns_added || [];

  return (
    <div data-testid="deal-attribution" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px' }}>
      <div style={head}>Where closings came from · last {days} days</div>
      <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
        {d.closings + ' closings · ' + money(d.gci) + ' GCI · ' + d.with_client + ' with the client named · ' + d.with_source + ' with a known source'}
      </div>

      {known.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {known.map((s) => (
            <div key={s.source} style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 0', minWidth: 0, fontSize: 13, color: 'var(--text-1)' }}>{s.source}</span>
                <span style={{ fontSize: 13, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{money(s.gci)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {s.closings + (s.closings === 1 ? ' closing' : ' closings')
                    + (s.median_minutes_to_first_reply != null ? ' · answered in ' + mins(s.median_minutes_to_first_reply) : '')}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', marginTop: 4, overflow: 'hidden' }}>
                <div style={{ width: ((Number(s.gci) || 0) / top * 100) + '%', height: '100%', background: GOLD }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.55 }}>
        {unknown ? unknown.closings + ' closing' + (unknown.closings === 1 ? '' : 's') + ' (' + money(unknown.gci) + ') with no source yet. ' : ''}
        Sources come from the Gold Report&rsquo;s client columns, filled in from 28 Sep 2026 — earlier closings have no client, by design.
        {!d.sheet_has_lead_source_column && ' Adding a “Lead Source” column to the Gold Report lets every closing carry its source, including leads that never passed through PrismOS.'}
      </div>

      {missing.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
          <b style={{ color: 'var(--text-1)' }}>Client missing in the Gold Report since 28 Sep:</b>{' '}
          {missing.slice(0, 8).map((m) => (m.agent || '?') + ' — ' + (m.address || 'Trans ' + m.trans_id)).join(' · ')}
          {missing.length > 8 ? ' · and ' + (missing.length - 8) + ' more' : ''}
        </div>
      )}

      {(d.by_agent || []).length > 0 && (
        <>
          <button type="button" onClick={() => setShowAgents((v) => !v)}
            style={{ marginTop: 6, minHeight: 44, padding: '0 2px', background: 'none', border: 'none', color: GOLD, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {showAgents ? 'Hide agents' : 'By agent ›'}
          </button>
          {showAgents && (d.by_agent || []).map((a) => (
            <div key={a.agent} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 0', minWidth: 0, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.agent}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {a.closings + (a.closings === 1 ? ' closing · ' : ' closings · ') + money(a.gci) + ' · source known on ' + a.with_source}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
