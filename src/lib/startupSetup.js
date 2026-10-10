// startupSetup.js — what the app asks for on launch (Dara, 10 Oct 2026).
//
// "For every user that does not have a GCI Goal, upon startup, prompt for a GCI
// Goal. For every user that has not connected their Google account, take them
// to the set up for their mail, calendar, and contacts. If they become
// disconnected from any of these, when they restart the app, take them to the
// appropriate place to reconnect them."
//
// Pure decisions only; the screen is views/StartupSetup.jsx and the facts come
// from the my_startup_setup() RPC (booleans and scope names, never tokens).

export const NEEDED = ['email', 'calendar', 'contacts'];
const TEST = {
  email: (s) => s.includes('auth/gmail.modify'),
  calendar: (s) => s.includes('auth/calendar'), // calendar or calendar.events
  contacts: (s) => s.includes('auth/contacts'), // contacts or contacts.readonly
};

// { status: 'ok' | 'none' | 'revoked' | 'missing', missing: [...], hint }
// Scopes are pooled across the user's live Google accounts: mail on one and
// calendar on another is still connected.
export function googleStatus(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.is_active !== false);
  if (!list.length) return { status: 'none', missing: [...NEEDED], hint: '' };
  const live = list.filter((a) => !a.revoked);
  const scopes = live.flatMap((a) => (Array.isArray(a.scopes) ? a.scopes : []).map((s) => String(s || '')));
  const missing = NEEDED.filter((p) => !scopes.some(TEST[p]));
  const dead = list.find((a) => a.revoked);
  if (dead && missing.length) return { status: 'revoked', missing, hint: dead.email_address || '' };
  if (missing.length) {
    const best = live.find((a) => (a.scopes || []).some((s) => String(s).includes('gmail'))) || live[0] || list[0];
    return { status: 'missing', missing, hint: (best && best.email_address) || '' };
  }
  return { status: 'ok', missing: [], hint: '' };
}

// What a connect asks Google for: all three, plus drive if any account had it.
export function connectPurposes(accounts) {
  const hadDrive = (Array.isArray(accounts) ? accounts : []).some((a) =>
    (a.purposes || []).includes('drive') || (a.scopes || []).some((s) => String(s).includes('auth/drive')));
  return hadDrive ? [...NEEDED, 'drive'] : [...NEEDED];
}

const goalKey = (uid) => `prism_goal_skip:${uid}`;
const googleKey = (uid) => `prism_google_later:${uid}`;

// Skip for now hides the goal prompt for the rest of the day (NY date).
export function goalSkippedToday(uid, today, store = safeLocal()) {
  try { return !!store && store.getItem(goalKey(uid)) === today; } catch (_) { return false; }
}
export function skipGoalToday(uid, today, store = safeLocal()) {
  try { store && store.setItem(goalKey(uid), today); } catch (_) {}
}
// "Later" on Google lasts this launch only; it comes back next time.
export function googleDismissed(uid, store = safeSession()) {
  try { return !!store && store.getItem(googleKey(uid)) === '1'; } catch (_) { return false; }
}
export function dismissGoogle(uid, store = safeSession()) {
  try { store && store.setItem(googleKey(uid), '1'); } catch (_) {}
}

// Never during act-as / support: the prompts belong to the real user.
export function isActingAs(store = safeLocal()) {
  try { return !!(store && store.getItem('__impersonating')); } catch (_) { return false; }
}

export function parseGoal(text) {
  const n = Math.round(Number(String(text || '').replace(/[^0-9.]/g, '')) || 0);
  return n >= 1000 && n <= 100000000 ? n : 0;
}

// Which step to show first, or null.
export function nextStep({ facts, uid, today, local, session }) {
  if (!facts || !uid) return null;
  if (isActingAs(local)) return null;
  if (!facts.has_goal && !goalSkippedToday(uid, today, local)) return 'goal';
  const g = googleStatus(facts.google);
  if (g.status !== 'ok' && !googleDismissed(uid, session)) return 'google';
  return null;
}

function safeLocal() { try { return window.localStorage; } catch (_) { return null; } }
function safeSession() { try { return window.sessionStorage; } catch (_) { return null; } }
