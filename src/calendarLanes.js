// Events that share the same minutes are drawn SIDE BY SIDE, never on top of one
// another. Until 5 Oct 2026 every block took the full width, so two meetings at
// 11:00 printed their titles over each other — Dara's screenshot read
// "HarshaMPatelhtic / Carolinas". Each run of blocks that touch is split into
// as many lanes as it needs; a block alone keeps the full width.
// boxes: [{ id, top, height }] in pixels → { [id]: { lane, lanes } }
export function layoutLanes(boxes) {
  const out = {};
  const sorted = [...boxes].sort((a, b) => a.top - b.top || b.height - a.height);
  let cluster = [], clusterEnd = -Infinity, laneEnds = [];
  const flush = () => { for (const b of cluster) out[b.id].lanes = laneEnds.length; cluster = []; laneEnds = []; clusterEnd = -Infinity; };
  for (const b of sorted) {
    if (cluster.length && b.top >= clusterEnd - 0.5) flush();
    let lane = laneEnds.findIndex((end) => b.top >= end - 0.5);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = b.top + b.height;
    out[b.id] = { lane, lanes: 1 };
    cluster.push(b); clusterEnd = Math.max(clusterEnd, b.top + b.height);
  }
  flush();
  return out;
}
