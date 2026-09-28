import React, { useEffect, useRef, useState } from 'react';
import { confirmDialog } from './notify';

// "New version available" — and nothing happens until YOU tap Update.
//
// Dara, 28 Sep 2026: "I was just working on saving a note … when PrismOS decided
// to update the app and I lost my work. Do not automatically implement updates.
// Show me there's an update available, but allow me to continue working and
// save my work before I click on the update button."
//
// So:
//   * The service worker never takes over by itself (public/sw.js) and the page
//     never reloads by itself for a new version (index.html only reloads after
//     window.__prismUpdateRequested is set, here).
//   * This banner says a new version is ready. "Later" tucks it into a small
//     "Update" pill that stays in the corner — always visible, never in the way.
//   * Update checks first: if you were typing in the last few minutes, or a text
//     box on screen still holds words, it asks before going ahead.
//   * Opening the app fresh still gets the newest version (nothing is open then).
//
// Detection: the running bundle's hash vs the one in /index.html (polled every
// minute and on return to the app), plus the service worker's own signal.

const TYPED_RECENTLY_MS = 3 * 60 * 1000;

let lastTypedAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('input', () => { lastTypedAt = Date.now(); }, true);
}

// Is there work on screen that might not be saved yet?
function workInProgress() {
  if (Date.now() - lastTypedAt < TYPED_RECENTLY_MS) return true;
  try {
    const boxes = document.querySelectorAll('textarea, [contenteditable="true"]');
    for (const el of boxes) {
      const text = el.value != null ? el.value : el.textContent;
      if (text && text.trim() && el.offsetParent !== null) return true;
    }
  } catch (_) { /* no DOM access — treat as clean */ }
  return false;
}

function currentBundleHash() {
  try {
    const el = document.querySelector('script[src*="/static/js/main."]');
    const m = el && el.src.match(/main\.([A-Za-z0-9_-]+)\.js/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

export default function UpdateBanner() {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.__prismUpdateReady);
  const [tucked, setTucked] = useState(false);
  const [busy, setBusy] = useState(false);
  const hashRef = useRef(null);

  useEffect(() => {
    hashRef.current = currentBundleHash();
    let stop = false;
    async function check() {
      if (stop || !hashRef.current) return;
      try {
        const res = await fetch('/index.html?cb=' + Date.now(), { cache: 'no-store' });
        const m = (await res.text()).match(/main\.([A-Za-z0-9_-]+)\.js/);
        if (m && m[1] !== hashRef.current) setReady(true);
      } catch (_) { /* offline — try again later */ }
    }
    const onSw = () => setReady(true);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('prism-update-ready', onSw);
    document.addEventListener('visibilitychange', onVis);
    const t = setTimeout(check, 3000);
    const iv = setInterval(check, 60000);
    return () => { stop = true; clearTimeout(t); clearInterval(iv); window.removeEventListener('prism-update-ready', onSw); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  async function update() {
    if (workInProgress()) {
      const go = await confirmDialog(
        'It looks like you are in the middle of something. Save it first — updating reloads the app. Update now anyway?',
        { confirmLabel: 'Update now', cancelLabel: 'Not yet', danger: false });
      if (!go) return;
    }
    setBusy(true);
    window.__prismUpdateRequested = true;
    const reload = () => window.location.reload();
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.update(); } catch (_) {}
          if (r.waiting) r.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k !== 'prismos-shared').map((k) => caches.delete(k))); }
    } catch (_) { /* reload regardless */ }
    // index.html reloads on controllerchange; this is the fallback.
    setTimeout(reload, 1500);
  }

  if (!ready) return null;

  if (tucked) return (
    <button type="button" onClick={update} disabled={busy} data-testid="update-pill" aria-label="A new version is ready. Tap to update."
      style={{ position: 'fixed', right: 10, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', zIndex: 5000,
        minHeight: 44, padding: '0 14px', borderRadius: 999, border: '1px solid #C5A95E', background: 'rgba(22,25,33,.92)',
        color: '#EBCB82', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,.4)' }}>
      {busy ? 'Updating…' : 'Update'}
    </button>
  );

  return (
    <div role="status" data-testid="update-banner" style={{ position: 'fixed', left: 12, right: 12, margin: '0 auto', maxWidth: 520,
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', zIndex: 5000, background: '#161921', border: '1px solid #C5A95E',
      color: '#E9E1D0', borderRadius: 14, padding: '8px 8px 8px 14px', display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)', fontSize: 13, boxSizing: 'border-box' }}>
      <span style={{ flex: '1 1 auto', minWidth: 0, lineHeight: 1.35 }}>
        <b style={{ color: '#EBCB82' }}>New version ready.</b> Finish and save what you're doing, then update.
      </span>
      <button type="button" onClick={() => setTucked(true)}
        style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: 'none', background: 'transparent', color: '#9C927F', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Later</button>
      <button type="button" onClick={update} disabled={busy}
        style={{ minHeight: 44, padding: '0 14px', borderRadius: 10, border: 'none', background: '#EBCB82', color: '#100D09', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>{busy ? 'Updating…' : 'Update'}</button>
    </div>
  );
}
