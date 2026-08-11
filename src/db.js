// ── Checked data layer ───────────────────────────────────────────────────────
// Report finding #2: ~1,000 database calls, most not checked for failure — so when
// a write silently fails the app carries on as if it worked. For a "source of truth"
// that is the enemy. These wrappers make failure loud: every call is checked, errors
// are logged to the client-error stream (same place crashes go), and callers get a
// predictable shape. Migrate call sites onto these incrementally; behavior for the
// happy path is unchanged.

import { supabase } from './dataService';
import { BUILD_VERSION } from './version';

const _appVersion = BUILD_VERSION || '';

// Log a data-layer error to the same telemetry table crashes use, best-effort.
async function logDbError(where, error, ctx) {
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('client_errors').insert({
      user_id: u?.user?.id || null,
      email: u?.user?.email || null,
      view: where,
      message: (error && (error.message || String(error))) || 'db error',
      kind: 'db',
      app_version: _appVersion || null,
      url: (typeof window !== 'undefined' && window.location) ? window.location.href : null,
      stack: ctx ? JSON.stringify(ctx).slice(0, 500) : null,
    });
  } catch (_) { /* never let logging throw */ }
}

// Call an RPC and get back { data, error, ok }. On error it's logged, and if
// `opts.throwOnError` is set it rethrows (for callers that prefer try/catch).
export async function rpc(fn, args = {}, opts = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logDbError('rpc:' + fn, error, args);
    if (opts.throwOnError) throw error;
    return { data: opts.fallback ?? null, error, ok: false };
  }
  return { data, error: null, ok: true };
}

// A thin, checked wrapper over a builder result. Usage:
//   const { data, ok } = await run('save contact', supabase.from('contacts').insert(row));
export async function run(where, builder, opts = {}) {
  const { data, error } = await builder;
  if (error) {
    logDbError(where, error);
    if (opts.throwOnError) throw error;
    return { data: opts.fallback ?? null, error, ok: false };
  }
  return { data, error: null, ok: true };
}

// Convenience: a checked SELECT that always returns an array.
export async function selectRows(where, builder) {
  const { data, ok } = await run(where, builder);
  return ok && Array.isArray(data) ? data : [];
}

// Convenience: a checked RPC that always returns an array (common for our list RPCs).
export async function rpcRows(fn, args = {}) {
  const { data, ok } = await rpc(fn, args);
  return ok && Array.isArray(data) ? data : [];
}

export default { rpc, run, selectRows, rpcRows };
