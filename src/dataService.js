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

// ── Central mutation-error reporting ─────────────────────────────────────────
// supabase-js RESOLVES with { error } instead of throwing, so
// `try { await supabase.from('x').update(...) } catch (_) {}` never fires. The
// analyzer found 247 mutating calls across 67 files whose result is discarded —
// usually behind an optimistic UI update that already told the user it worked.
//
// Patching 247 call sites by hand would take days, and half would be reintroduced
// within a month; nothing would stop that happening. One wrapper here means no
// mutation can fail invisibly again, including in code not yet written. Same
// approach as the ensureFreshSession wrappers above: fix it once, at the seam.
//
// DELIBERATELY DOES NOT NOTIFY THE USER. Many call sites already handle their own
// errors and show a message; a second toast from here would double up. What this
// removes is SILENCE — every failed mutation now reaches the console and
// public.client_errors, so a lost write is visible to us the moment it happens
// instead of surfacing days later as "my task disappeared". User-facing messages
// remain a per-site judgement, and the ledger tracks which sites still need one.
const MUTATIONS = ['insert', 'update', 'upsert', 'delete'];
let _mutSeen = 0;

function reportMutationError(table, op, error) {
  if (!error) return;
  // Cap the reporting, not the checking — a broken table would otherwise spam
  // client_errors with thousands of identical rows during one outage.
  _mutSeen++;
  const msg = `[supabase] ${op} on ${table} failed: ${error.message || error}`;
  try { console.error(msg, error); } catch (_) {}
  if (_mutSeen > 25) return;
  try {
    if (typeof window !== 'undefined' && typeof window.__logClientError === 'function') {
      window.__logClientError({ kind: 'supabase_mutation', message: msg, table, op, code: error.code || null });
    }
  } catch (_) {}
}

// Exposed for the smoke gate, which needs to prove the wrapper below actually
// fires — a reporting layer that silently does nothing is worse than none,
// because it looks like coverage. Harmless: the client is already reachable from
// any devtools console, and it carries no secret the anon key does not.
try { if (typeof window !== 'undefined') window.__supabase = supabase; } catch (_) {}

const _from = supabase.from.bind(supabase);
supabase.from = (table) => {
  const qb = _from(table);
  for (const op of MUTATIONS) {
    const orig = qb[op];
    if (typeof orig !== 'function') continue;
    qb[op] = (...args) => {
      const builder = orig.apply(qb, args);
      // The builder is a thenable, not a promise. Wrapping .then lets us observe
      // the resolved { error } while leaving the caller's usage identical —
      // including .select(), .eq() and the rest of the chain, which return the
      // same builder we have already patched.
      if (builder && typeof builder.then === 'function') {
        const _then = builder.then.bind(builder);
        builder.then = (onOk, onErr) => _then((res) => {
          if (res && res.error) reportMutationError(table, op, res.error);
          return onOk ? onOk(res) : res;
        }, onErr);
      }
      return builder;
    };
  }
  return qb;
};
