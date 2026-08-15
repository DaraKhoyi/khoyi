// ── openScreens.js ───────────────────────────────────────────────────────────
// ALT-TAB for PrismOS.
//
// Dara's actual loop: email → contacts → email → journal → prospecting → inbox →
// prospecting → finance → prospecting → email. He crosses ROOM boundaries three
// times without caring, which is the tell: rooms are where a screen lives, but
// what he wants is a list of what is currently OPEN. Those are different things.
//
// FAILURE CONDITION for this module — it has failed if:
//   · you return to a parked screen and something you typed is gone,
//   · you have to think about which screen the double-tap goes to, or
//   · four parked screens make the phone noticeably slower.
// Every rule below exists to satisfy one of those.
//
// THE RULES
//
// 1. FOUR SLOTS. A fifth switch evicts the least-recently-used CLEAN screen; on
//    return it falls back to roomResume's faithful restore, which is good enough
//    for a screen you had not touched in a while. Four live screens is what an
//    iPhone tolerates — InboxView is a 99KB chunk and AccountingViews 206KB, and
//    the loaded DATA weighs more than the code.
//
// 2. DIRTY SCREENS ARE NEVER EVICTED. Pure LRU would silently destroy a
//    half-written reply on the fifth switch. One occurrence and the feature is
//    never trusted again, so unsaved work outranks recency, always. If every slot
//    is dirty we exceed the cap rather than lose work — being slightly heavy beats
//    being lossy.
//
// 3. PERSISTS ACROSS AN APP CLOSE. Not a nicety: iOS discards backgrounded PWAs
//    aggressively, so for an iPhone agent a "restart" is the NORMAL path back in,
//    not an edge case. Across a restart nothing is mounted, so "exact" has to be
//    REBUILT from a snapshot: scroll, open record, filters, tab, and above all
//    draft text. Genuinely ephemeral state (an open dropdown) does not survive,
//    and no amount of engineering makes it.
//
// 4. PARKED SCREENS STOP POLLING. Four screens all polling Supabase is four times
//    the queries and four times the battery drain on a long call. Suspended on
//    park, refreshed on return.
//
// Storage is per USER — two agents on one device, or Dara acting as an agent,
// must never inherit each other's parked work.

const CAP = 4;
const KEY = (userId) => `prism.openscreens.${userId || 'anon'}`;
const now = () => Date.now();

const read = (userId) => {
  try {
    const raw = localStorage.getItem(KEY(userId));
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
};

const write = (userId, list) => {
  try { localStorage.setItem(KEY(userId), JSON.stringify(list)); } catch (_) { /* quota — non-fatal */ }
  return list;
};

// A screen's identity. Sub-tabs are part of it: Prospecting>Today and
// Prospecting>ROI are different places to come back to.
export const screenKey = (view, sub) => (sub ? `${view}:${sub}` : String(view || ''));

/** Mark a screen as the current one, creating or promoting its slot. */
export function touchScreen(userId, view, sub, meta = {}) {
  const key = screenKey(view, sub);
  const list = read(userId);
  const found = list.find((s) => s.key === key);
  if (found) {
    found.at = now();
    if (meta.label) found.label = meta.label;
    if (meta.mode) found.mode = meta.mode;
  } else {
    list.push({ key, view, sub: sub || null, at: now(), dirty: false, note: '', label: meta.label || view, mode: meta.mode || null, snap: null });
  }
  return write(userId, evict(list));
}

/** Record what a screen is in the middle of. `note` is what the switcher SHOWS. */
export function parkScreen(userId, view, sub, { dirty = false, note = '', snap = null } = {}) {
  const key = screenKey(view, sub);
  const list = read(userId);
  const s = list.find((x) => x.key === key);
  if (!s) return list;
  s.dirty = !!dirty;
  s.note = note || '';
  if (snap !== null) s.snap = snap;
  s.at = s.at || now();
  return write(userId, evict(list));
}

/** Clean screens go first, oldest first. A dirty screen is never dropped. */
function evict(list) {
  if (list.length <= CAP) return list;
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const out = [...list];
  for (const cand of sorted) {
    if (out.length <= CAP) break;
    if (cand.dirty) continue;                 // rule 2
    const i = out.findIndex((x) => x.key === cand.key);
    if (i > -1) out.splice(i, 1);
  }
  return out;                                  // may exceed CAP if everything is dirty
}

/** Most-recent first, excluding the screen you are on. What the switcher lists. */
export function openScreens(userId, currentView, currentSub) {
  const cur = screenKey(currentView, currentSub);
  return read(userId).filter((s) => s.key !== cur).sort((a, b) => b.at - a.at);
}

/** The ALT-TAB target: the most recent screen that is not this one. */
export function previousScreen(userId, currentView, currentSub) {
  return openScreens(userId, currentView, currentSub)[0] || null;
}

/** Anything parked with unsaved work — drives the dot on the tuning fork. */
export function hasParkedWork(userId, currentView, currentSub) {
  return openScreens(userId, currentView, currentSub).some((s) => s.dirty);
}

export function getSnapshot(userId, view, sub) {
  const key = screenKey(view, sub);
  return (read(userId).find((s) => s.key === key) || {}).snap || null;
}

/** Explicitly close a screen — the switcher's dismiss action. */
export function closeScreen(userId, view, sub) {
  const key = screenKey(view, sub);
  return write(userId, read(userId).filter((s) => s.key !== key));
}

export function clearAll(userId) { return write(userId, []); }

export const OPEN_SCREEN_CAP = CAP;

/**
 * Scroll is the cheapest half of "exact". Every screen has it, no screen has to
 * opt in, and it survives an app close because it rides in the same snapshot as
 * everything else.
 *
 * The rule is NOT "always restore". Returning to a screen you parked should land
 * where you left it; opening a screen fresh from the menu should land at the top.
 * Those are different intents and conflating them is why scroll restoration
 * usually feels broken.
 */
export function saveScroll(userId, view, sub, top) {
  const key = screenKey(view, sub);
  const list = read(userId);
  const row = list.find((s) => s.key === key);
  if (!row) return list;
  row.snap = Object.assign({}, row.snap, { scrollTop: Math.max(0, Number(top) || 0) });
  return write(userId, list);
}

/** Scroll offset to restore, or 0 when this screen was not parked. */
export function scrollFor(userId, view, sub) {
  const snap = getSnapshot(userId, view, sub);
  return (snap && Number(snap.scrollTop)) || 0;
}

/**
 * Mark a screen as holding unsaved work. THE rule that makes the feature
 * trustworthy: a dirty screen is never evicted, so a half-written reply cannot be
 * destroyed by a fifth switch. `note` is what the switcher shows the user — the
 * switcher answers "what am I in the middle of", not "what did I open".
 */
export function markDirty(userId, view, sub, note) {
  return parkScreen(userId, view, sub, { dirty: true, note: note || 'unsaved work' });
}

/** Work was saved or discarded — the screen becomes evictable again. */
export function markClean(userId, view, sub) {
  const key = screenKey(view, sub);
  const list = read(userId);
  const row = list.find((s) => s.key === key);
  if (row) { row.dirty = false; row.note = ''; }
  return write(userId, list);
}

