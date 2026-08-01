// connection.js — durability layer.
//
// Today's outage taught us two things the app handled badly:
//   1. When the backend was unreachable, users saw raw scary errors
//      ("Failed to fetch", "Database error granting user") with no context.
//   2. There was no notion of "we're offline, we'll recover" — every failure
//      looked permanent.
//
// This module adds a small, disciplined durability layer:
//   • a connection-health signal (online / reconnecting / offline)
//   • a calm, self-dismissing banner instead of scary errors
//   • a BOUNDED retry helper (exponential backoff, hard cap) for transient
//     failures — deliberately conservative so it can NEVER become a retry-storm
//     that piles load onto a struggling database (the exact failure mode that
//     helped take the database down today).
//
// Design rule: when the backend is down, do LESS, not more. We ping rarely,
// back off aggressively, and never fan out concurrent retries.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, SUPABASE_URL } from './dataService';

// ── Bounded retry ───────────────────────────────────────────────────────────
// Retry a transient async operation a few times with exponential backoff.
// Hard-capped at `tries` attempts; only retries errors that look transient
// (network / timeout / 5xx), never real logic/permission errors. This is the
// opposite of a retry-storm: at most a handful of attempts, spaced out, one at
// a time.
const TRANSIENT = /Failed to fetch|NetworkError|timeout|timed out|ECONNREFUSED|502|503|504|Load failed|The operation was aborted|AbortError/i;

export function isTransientError(err) {
  if (!err) return false;
  const m = (err.message || err.msg || String(err)) + ' ' + (err.code || '') + ' ' + (err.status || '');
  return TRANSIENT.test(m);
}

export async function withRetry(fn, { tries = 3, baseMs = 600, maxMs = 4000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Only retry transient failures, and never after the last attempt.
      if (attempt === tries - 1 || !isTransientError(err)) throw err;
      const wait = Math.min(maxMs, baseMs * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
      if (onRetry) { try { onRetry(attempt + 1, wait); } catch (_) {} }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// A supabase-query variant: supabase-js resolves with { data, error } instead of
// throwing, so we treat a transient `error` as a throw for retry purposes.
export async function withRetryQuery(queryFn, opts) {
  return withRetry(async () => {
    const res = await queryFn();
    if (res && res.error && isTransientError(res.error)) throw res.error;
    return res;
  }, opts);
}

// ── Connection health ────────────────────────────────────────────────────────
// A single lightweight health ping. We hit Supabase's auth health endpoint
// (cheap, unauthenticated, no database load) with a short timeout. We only call
// this when we already suspect trouble — never on a constant timer during
// normal operation — so it adds no meaningful load.
async function pingBackend(timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: supabase.supabaseKey || '' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok || res.status === 401 || res.status === 400; // any real HTTP answer = backend reachable
  } catch (_) {
    return false;
  }
}

// Hook: returns { status, retryNow }.
//   status: 'online' | 'reconnecting' | 'offline'
//   retryNow(): force an immediate health check (used by the banner's "Retry").
//
// Behaviour:
//   • Starts optimistic ('online').
//   • Listens to the browser's own online/offline events (instant, free).
//   • When something reports trouble (via reportBackendTrouble()), flips to
//     'reconnecting' and begins polling pingBackend with backoff until it
//     recovers — then flips back to 'online'. Polling STOPS once healthy, so
//     there's no steady background load.
let _troubleSignal = 0;           // bumped by reportBackendTrouble()
const _troubleListeners = new Set();
export function reportBackendTrouble() {
  _troubleSignal++;
  _troubleListeners.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function useConnectionHealth() {
  const [status, setStatus] = useState('online');
  const pollRef = useRef(null);
  const backoffRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    backoffRef.current = 0;
  }, []);

  const check = useCallback(async () => {
    // If the browser itself says we're offline, don't even ping.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      scheduleNext();
      return;
    }
    const ok = await pingBackend();
    if (ok) {
      setStatus('online');
      stopPolling();
    } else {
      setStatus((s) => (s === 'online' ? 'reconnecting' : s));
      scheduleNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPolling]);

  // Schedule the next health check with capped exponential backoff (2s → 30s).
  const scheduleNext = useCallback(() => {
    const delay = Math.min(30000, 2000 * Math.pow(1.6, backoffRef.current));
    backoffRef.current = Math.min(backoffRef.current + 1, 8);
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => { check(); }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const retryNow = useCallback(() => { backoffRef.current = 0; check(); }, [check]);

  useEffect(() => {
    const onOnline = () => { backoffRef.current = 0; check(); };
    const onOffline = () => setStatus('offline');
    const onTrouble = () => { if (!pollRef.current) { backoffRef.current = 0; check(); } };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    _troubleListeners.add(onTrouble);

    // If we mount already offline (per the browser), reflect it.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setStatus('offline');

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      _troubleListeners.delete(onTrouble);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, retryNow };
}
