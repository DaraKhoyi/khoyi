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
  return _invoke(name, options);
};
