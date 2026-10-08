// googleReconnect.js — what a Google reconnect must ask for.
//
// When Google ends a connection it drops EVERY scope the mailbox had. The old
// "Reconnect now" asked for one purpose — calendar if the mailbox had calendar,
// otherwise email — so an email+calendar mailbox came back with calendar only
// and its email stayed broken under a badge that still said "email", and a
// contacts-only mailbox (Alex's personal Gmail) came back with Gmail access it
// never had and no contacts. A reconnect asks for the whole set, read from both
// the purposes PrismOS recorded and the scopes Google last granted.

const ORDER = ['email', 'calendar', 'contacts', 'drive'];

export function reconnectPurposes(account) {
  const set = new Set(Array.isArray(account?.purposes) ? account.purposes : []);
  for (const s of Array.isArray(account?.scopes) ? account.scopes : []) {
    const scope = String(s || '');
    if (scope.includes('gmail')) set.add('email');
    else if (scope.includes('auth/calendar')) set.add('calendar');
    else if (scope.includes('auth/drive')) set.add('drive');
    else if (scope.includes('auth/contacts')) set.add('contacts');
  }
  const out = ORDER.filter((p) => set.has(p));
  return out.length ? out : ['email'];
}

// The single `purpose` an older google-oauth-start understands, sent alongside
// `purposes` so a reconnect still does the most it can if the app ships before
// the function does. 'both' = email + calendar.
export function legacyPurpose(list) {
  const l = Array.isArray(list) ? list : [];
  if (l.includes('email') && l.includes('calendar')) return 'both';
  return l[0] || 'email';
}
