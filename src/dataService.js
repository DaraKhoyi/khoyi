import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Explicit rather than relying on defaults. persistSession keeps the login
    // across reloads; autoRefreshToken renews the 1-hour access token in the
    // background. Both default to true, but stating them means a future edit
    // cannot quietly turn them off.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Freshen the session before an authenticated call. supabase-js normally
// refreshes on a timer, but a backgrounded mobile tab can miss the timer and
// wake with an EXPIRED access token — at which point functions.invoke() sends a
// stale bearer and the edge function returns 401 before the request is even
// logged on its own path. This makes the token good at the moment of use.
export async function ensureFreshSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const expMs = (session.expires_at || 0) * 1000;
    // Refresh if it expires within two minutes (or already has).
    if (expMs - Date.now() < 120000) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}


// Every functions.invoke() refreshes the session first. Wrapping the client's
// own method means all call sites are covered without touching any of them, and
// a new call site added later is covered automatically. This is the one place
// the guard belongs.
const _invoke = supabase.functions.invoke.bind(supabase.functions);
supabase.functions.invoke = async (name, options) => {
  await ensureFreshSession();
  try {
    const res = await _invoke(name, options);
    return res;
  } catch (err) {
    // A transient network failure on an edge call is a signal the backend may be
    // unreachable — nudge the connection-health layer so the app can show a calm
    // "reconnecting" state instead of a raw error. Loaded lazily to avoid a cycle.
    try {
      const msg = (err && (err.message || String(err))) || '';
      if (/Failed to fetch|NetworkError|timeout|timed out|Load failed|aborted/i.test(msg)) {
        import('./connection').then((m) => m.reportBackendTrouble()).catch(() => {});
      }
    } catch (_) {}
    throw err;
  }
};

// Same guard for supabase.rpc(). RPCs like contact_production read auth.uid()
// server-side; a stale iOS token makes auth.uid() null, so a broker silently
// looks like a nobody (e.g. the production card returns linked:false and renders
// blank). Freshening the token first fixes it everywhere rpc() is called without
// touching a single call site. Mirrors the functions.invoke wrapper above.
const _rpc = supabase.rpc.bind(supabase);
supabase.rpc = (fn, params, opts) => {
  // rpc() returns a thenable PostgrestBuilder (not a plain promise), so we can't
  // simply await inside. Refresh first, then delegate and forward the builder's
  // result. Callers still `await supabase.rpc(...)` exactly as before.
  const p = ensureFreshSession().catch(() => false).then(() => _rpc(fn, params, opts));
  return p;
};
