// reconnect_clears.mjs — a successful Google reconnect clears "needs reconnecting" at once.
//
// Dara, 30 Sep: "I'm having trouble reconnecting dara@brokerdara.com." The
// reconnect had worked; only the 10-minute watcher cleared the flag, so Settings
// kept saying "needs reconnecting" and the watcher sent another warning. Both
// OAuth callbacks now clear reauth_required_at / reauth_notified_at /
// last_sync_error when Google returns a new refresh token, and both start
// flows must keep asking for one (prompt=consent, access_type=offline).
// Static. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
for (const f of ['google-oauth-callback', 'gmail-oauth-callback']) {
  const s = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8');
  if (!/tokens\.refresh_token \? \{ reauth_required_at: null, reauth_notified_at: null, last_sync_error: null \}/.test(s))
    problems.push(`${f}: a successful reconnect no longer clears "needs reconnecting"`);
}
// gmail-oauth-start was retired 8 Oct 2026 (Google verification: one OAuth entry point).
for (const f of ['google-oauth-start']) {
  const s = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8');
  if (!/access_type:\s*"offline"/.test(s) || !/prompt:\s*"consent"/.test(s))
    problems.push(`${f}: no longer asks Google for a fresh refresh token (access_type=offline, prompt=consent) — a reconnect would keep the dead one`);
}
if (!problems.length) { console.log('==== RECONNECT: clean — a successful reconnect clears the warning at once, and always brings a fresh token ===='); process.exit(0); }
console.log(`==== RECONNECT: ${problems.length} problem(s) ====`); for (const p of problems) console.log('  ✗ ' + p); process.exit(1);
