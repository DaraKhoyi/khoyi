// ViewLoadingFallback — what a screen shows before it is ready.
//
// Extracted from App.js: this is a SCREEN STATE, not app-shell logic, and the
// composition root should not carry it.
//
// Three things it refuses to do, each of which makes a working app look broken:
//   1. SPIN SILENTLY. A bare spinner reads as "broken" long before it times out.
//      It speaks at 3s and says more at 8s, so the app always looks alive.
//   2. SPIN WHILE OFFLINE. That is a lie — the screen is never going to load.
//      It says so immediately rather than making someone wait fourteen seconds
//      to find out, and it reassures them that captured work is safe.
//   3. SPIN FOREVER. A hung import() promise never rejects, so lazyWithReload's
//      catch and the error boundary cannot help — only a timeout can. At 14s it
//      offers a hard refresh that clears caches and unregisters the service
//      worker, which is the real fix for a stale PWA after a deploy.
import React from 'react';

// (see header) If a lazy view chunk hasn't
// resolved in ~14s (a hung import, usually a stale/partial cache after a deploy
// on an installed PWA — the exact "app opens to a spinner and never loads"
// failure), we surface a Refresh action instead of an endless spinner. A hung
// import() promise never rejects, so lazyWithReload's catch and the error
// boundary can't help here — only a timeout can.
export default function ViewLoadingFallback() {
  const [stuck, setStuck] = React.useState(false);
  // A bare spinner reads as "broken" long before 14 seconds. On a slow connection
  // the app is working perfectly and looks dead, which is the same thing to the
  // person holding the phone. Say something at 3s, say more at 8s.
  const [phase, setPhase] = React.useState(0);
  const [offline, setOffline] = React.useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  React.useEffect(() => {
    const t = setTimeout(() => setStuck(true), 14000);
    const p1 = setTimeout(() => setPhase(1), 3000);
    const p2 = setTimeout(() => setPhase(2), 8000);
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { clearTimeout(t); clearTimeout(p1); clearTimeout(p2);
      window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Spinning while offline is a lie — this screen is never going to load. Say so
  // immediately instead of making someone wait fourteen seconds to find out.
  if (offline) return (
    <div className="loading-screen" style={{ height: '60vh', flexDirection: 'column', gap: 10, textAlign: 'center', padding: '0 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>You're offline</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 340, lineHeight: 1.5 }}>
        This screen needs a connection. Anything you record or type is still saved on your phone and will send itself when you're back.
      </div>
    </div>
  );

  if (!stuck) return (
    <div className="loading-screen" style={{ height: '60vh', flexDirection: 'column', gap: 12 }}>
      <div className="spinner" />
      {phase >= 1 && (
        <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
          {phase >= 2 ? 'Still loading — the connection looks slow right now.' : 'Loading…'}
        </div>
      )}
    </div>
  );
  const hardReload = () => {
    try { sessionStorage.removeItem('__chunkReloadAt'); } catch (_) {}
    // Clear caches + unregister SW so the next load is a clean fetch of the
    // current build, then reload. Best-effort; reload regardless.
    const done = () => window.location.reload();
    try {
      const jobs = [];
      if (window.caches && caches.keys) jobs.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))));
      Promise.all(jobs).then(done, done);
      setTimeout(done, 2500);
    } catch (_) { done(); }
  };
  return (
    <div className="loading-screen" style={{ height: '60vh', flexDirection: 'column', gap: 14, textAlign: 'center', padding: '0 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>This screen is taking longer than usual</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 340, lineHeight: 1.5 }}>A new version may have just been deployed. Refresh to load the latest build.</div>
      <button className="btn btn-primary" onClick={hardReload}>Refresh to update</button>
    </div>
  );
}
