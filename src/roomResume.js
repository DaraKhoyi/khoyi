// ── roomResume.js ────────────────────────────────────────────────────────────
// "Take me back to where I was."
//
// Entering a room should feel like walking back into a room you left, not being
// teleported to the front door. So each room remembers the last screen you were
// on — but only for the current day. Tomorrow morning it opens on the room's
// home screen again, because the first thing you want at 7am is the start of
// the loop, not whatever you happened to be staring at when you put the phone
// down last night.
//
// Stored per USER, never globally: two agents sharing a device (or Dara acting
// as an agent) must not inherit each other's place. Stored in localStorage
// rather than the database on purpose — it is a device-level convenience, and a
// round trip to Postgres to answer "which tab was I on" would make entering a
// room slower than it is today.

const KEY = (userId, modeId) => `prism.room.spot.${userId || 'anon'}.${modeId}`;

// Remember where the user is right now. `sub` is the deep-linked sub-tab, if any
// (e.g. Prospect > ROI), so resuming lands on the exact section, not just the
// screen that owns it.
export function rememberRoomSpot(userId, modeId, view, sub, day) {
  if (!modeId || !view || !day) return;
  try {
    localStorage.setItem(KEY(userId, modeId), JSON.stringify({ d: day, v: view, s: sub || null }));
  } catch (_) {
    // Private mode / quota / disabled storage. Losing the bookmark is harmless —
    // the room just opens on its home screen, which is the correct fallback.
  }
}

// Where should we land? Returns null when there is nothing to resume — no
// record, a record from a previous day, or a screen that no longer belongs to
// this room (the config changed under an old bookmark). Callers fall back to
// the room's `home`.
export function roomResumeSpot(userId, modeId, day, allowedViews) {
  if (!modeId || !day) return null;
  try {
    const raw = localStorage.getItem(KEY(userId, modeId));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.d !== day || !s.v) return null;
    if (Array.isArray(allowedViews) && !allowedViews.includes(s.v)) return null;
    return { view: s.v, sub: s.s || null };
  } catch (_) {
    return null;
  }
}

export function clearRoomSpot(userId, modeId) {
  try { localStorage.removeItem(KEY(userId, modeId)); } catch (_) {}
}
