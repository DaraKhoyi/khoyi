// DatePickerModal — branded date picker modal.
// Extracted from App.js (strangle).
import React, { useState } from 'react';
import { todayISO } from '../helpers';
import { useBackClose } from '../backClose';

export default function DatePickerModal({ initial, onCancel, onPick }) {
  useBackClose(onCancel);
  const [year, setYear] = useState(() => {
    const [y] = (initial || todayISO()).split('-').map(Number);
    return y;
  });
  const [month, setMonth] = useState(() => {
    const [, m] = (initial || todayISO()).split('-').map(Number);
    return m - 1;
  });
  const today = todayISO();

  function pick(y, m, day) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onPick(iso);
  }
  function shiftMonth(n) {
    let m = month + n; let y = year;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    setMonth(m); setYear(y);
  }

  function renderMonth(y, m) {
    const label = new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return (
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', marginBottom: '8px', color: 'var(--text-1)' }}>{label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', fontSize: '10px', color: 'var(--text-3)', fontWeight: 700, textAlign: 'center', marginBottom: '4px' }}>
          <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {cells.map((c, i) => {
            if (c === null) return <div key={i} />;
            const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
            const isToday = iso === today;
            return (
              <button type="button" key={i} onClick={() => pick(y, m, c)}
                style={{
                  padding: '7px 0', fontSize: '12px',
                  background: isToday ? 'var(--accent)' : 'var(--bg-base)',
                  color: isToday ? '#000' : 'var(--text-1)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px', cursor: 'pointer',
                  fontWeight: isToday ? 800 : 500,
                }}>
                {c}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const nextM = month === 11 ? 0 : month + 1;
  const nextY = month === 11 ? year + 1 : year;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()} style={{ zIndex: 1300 }}>
      <div className="modal" style={{ maxWidth: '340px', width: '92%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '14px' }}>Pick a date</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding: '14px 16px', maxHeight: '72vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>This month &amp; next</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>
          {renderMonth(year, month)}
          <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
          {renderMonth(nextY, nextM)}
        </div>
      </div>
    </div>
  );
}
