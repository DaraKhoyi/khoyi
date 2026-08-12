// PlanTimeline — the day's plan as a vertical timeline of steps + events.
// Extracted from App.js (strangle).
import React from 'react';
import { Icon } from '../icons';

export default function PlanTimeline({ steps = [], events = [], onTapStep, isDone, saved }) {
  const toMin = (t) => { const a = String(t || '').split(':'); return (Number(a[0]) || 0) * 60 + (Number(a[1]) || 0); };
  const evs = (events || []).filter(e => e.start).map(e => ({ title: e.title, s: toMin(e.start), e: e.end ? toMin(e.end) : toMin(e.start) + 30 }));
  const blk = steps.map(x => ({ ...x, s: toMin(x.p.start), e: x.p.end ? toMin(x.p.end) : toMin(x.p.start) + 30 }));
  const starts = [...evs.map(x => x.s), ...blk.map(x => x.s)];
  const ends = [...evs.map(x => x.e), ...blk.map(x => x.e)];
  if (!starts.length) return null;
  let winS = Math.min(...starts, 8 * 60), winE = Math.max(...ends, 18 * 60);
  winS = Math.floor(winS / 60) * 60; winE = Math.ceil(winE / 60) * 60;
  const PXM = 1.05, H = (winE - winS) * PXM;
  const hours = []; for (let h = winS; h <= winE; h += 60) hours.push(h);
  const fmtH = (m) => { const h = Math.floor(m / 60); const ap = h < 12 ? 'AM' : 'PM'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh} ${ap}`; };
  const fmt = (m) => { const h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p', hh = h % 12 === 0 ? 12 : h % 12; return mm ? `${hh}:${String(mm).padStart(2, '0')}${ap}` : `${hh}${ap}`; };
  const kindC = { reachout: 'var(--accent)', email: '#6aa9ff', focus: '#4ade80', task: 'var(--text-2)' };
  return (
    <div style={{ position: 'relative', marginLeft: 46, height: H }}>
      {hours.map(h => (
        <div key={h} style={{ position: 'absolute', top: (h - winS) * PXM, left: -46, right: 0, borderTop: '1px dashed var(--border)' }}>
          <span style={{ position: 'absolute', top: -7, left: 0, width: 40, textAlign: 'right', fontSize: 9.5, color: 'var(--text-3)' }}>{fmtH(h)}</span>
        </div>
      ))}
      {evs.map((e, k) => (
        <div key={'e' + k} style={{ position: 'absolute', top: (e.s - winS) * PXM + 1, height: Math.max(24, (e.e - e.s) * PXM - 3), left: 0, right: 0, background: 'var(--bg-hover)', border: '1px solid var(--border-strong)', borderLeft: '3px solid var(--text-3)', borderRadius: 8, padding: '4px 9px', overflow: 'hidden' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><Icon name="calendar" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />{e.title}</div>
          {(e.e - e.s) * PXM > 34 && <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 1 }}>{fmt(e.s)}–{fmt(e.e)}</div>}
        </div>
      ))}
      {blk.map((b) => {
        const done = saved && isDone(b.p); const c = kindC[b.p.kind] || 'var(--accent)'; const tall = (b.e - b.s) * PXM > 36;
        return (
          <div key={'b' + b.i} onClick={() => onTapStep(b.i)} style={{ position: 'absolute', top: (b.s - winS) * PXM + 1, height: Math.max(26, (b.e - b.s) * PXM - 3), left: 0, right: 0, background: 'linear-gradient(135deg, rgba(197,169,94,0.18), rgba(197,169,94,0.06))', border: `1px solid ${c}`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', overflow: 'hidden', opacity: done ? 0.55 : 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{done ? '✓ ' : ''}{b.p.title}</div>
            {tall && <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 1 }}>{fmt(b.s)}–{fmt(b.e)}</div>}
          </div>
        );
      })}
    </div>
  );
}
