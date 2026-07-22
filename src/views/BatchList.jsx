import React, { useState } from 'react';

// ── BatchList ────────────────────────────────────────────────────────────────
// The house rule, made structural: NO LIST IN PRISM EVER RENDERS AS A WALL.
//
// Four separate components each shipped their own "render everything" bug before
// this existed (tasks, commitments, call follow-ups, stale decisions). Wrapping a
// list in <BatchList> makes the calm behaviour the default instead of something
// each author has to remember.
//
// Everything is already in memory, so revealing more is INSTANT — the limit is
// purely visual. The user is never waiting on anything to generate.
//
//   <BatchList items={rows} batch={3} noun="calls">
//     {(row) => <MyCard key={row.id} row={row} />}
//   </BatchList>
//
// Props:
//   items    – the full array
//   batch    – how many to reveal at a time (default 3; use 5 for short rows)
//   noun     – plural noun for the button copy ("tasks", "calls")
//   restable – show a "That's enough for now" stopping point (default false)
//   footNote – optional line under the button
export default function BatchList({
  items = [], batch = 3, noun = 'items', children,
  restable = false, footNote = null, emptyState = null,
}) {
  const [shown, setShown] = useState(batch);
  const [rested, setRested] = useState(false);

  if (!items.length) return emptyState;

  if (rested) {
    return (
      <div style={{ textAlign: 'center', padding: '26px 18px', borderRadius: 16, border: '1px dashed var(--border)' }}>
        <div style={{ fontSize: 26, marginBottom: 6 }}>✦</div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 300, color: 'var(--text-1)' }}>Enough for now.</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          {items.length} {noun} still here — nothing is lost.
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setRested(false)}>Keep going</button>
      </div>
    );
  }

  const visible = items.slice(0, shown);
  const left = Math.max(0, items.length - visible.length);

  return (
    <>
      {visible.map((item, i) => children(item, i))}
      {(left > 0 || restable) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {left > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + batch)}>
                Show {Math.min(batch, left)} more ({left} left)
              </button>
            )}
            {restable && (
              <button className="btn btn-ghost btn-sm" onClick={() => setRested(true)}>That's enough for now</button>
            )}
          </div>
          {footNote && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{footNote}</div>}
        </div>
      )}
    </>
  );
}
