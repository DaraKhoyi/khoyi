// ── screenNotes.js ───────────────────────────────────────────────────────────
// The one-line "what am I in the middle of" summaries the ALT-TAB switcher shows
// on each card. A tab list tells you what you opened; these tell you what is
// still outstanding, which is the question actually being asked.
//
// They live here rather than inside each screen for two reasons: the phrasing
// stays consistent across screens, and the big view files (ContactsView is 2,000+
// lines, InboxView 3,400) do not absorb more feature code — the file ratchet
// caught exactly that when this was written inline.
//
// NOTE ON `dirty`: it is reserved for work that would be LOST if the screen were
// evicted — an unsent draft. A filter or a half-finished call list is outstanding
// WORK, not unsaved DATA, so those report a note with dirty:false and stay
// evictable. Conflating the two would pin every screen forever and defeat the cap.
import { parkScreen } from './openScreens';

/** Prospecting: "4 of 12 done today". */
export function noteProspecting(userId, tasks) {
  if (!userId) return;
  const total = Array.isArray(tasks) ? tasks.length : 0;
  if (!total) { parkScreen(userId, 'prospecting', null, { dirty: false, note: '' }); return; }
  const done = tasks.filter((t) => (t.todayCount || 0) >= (t.dailyTarget || 1)).length;
  parkScreen(userId, 'prospecting', null, {
    dirty: false,
    note: done >= total ? ('all ' + total + ' done today') : (done + ' of ' + total + ' done today'),
  });
}

/** Contacts: what the list is currently narrowed to. */
export function noteContacts(userId, { search, typeFilter, shown } = {}) {
  if (!userId) return;
  const bits = [];
  const q = String(search || '').trim();
  if (q) bits.push('searching "' + q.slice(0, 24) + '"');
  else if (typeFilter && typeFilter !== 'all') bits.push('filtered to ' + typeFilter);
  if (bits.length) bits.push(shown + ' shown');
  parkScreen(userId, 'contacts', null, { dirty: false, note: bits.join(' · ') });
}
