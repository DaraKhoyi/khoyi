// PrismOS service worker
// Minimal but real: must exist + have a fetch handler for Chrome to count this
// as an installable PWA (not just a home-screen shortcut). Without it, Chrome
// only offers "Add to Home Screen" which keeps the browser chrome.
//
// Strategy:
//   - Cache the app shell (index.html, manifest, icons) on install
//   - Serve index.html from cache as a navigation fallback when offline
//   - All other requests pass through (Supabase API + auth need to be live)
//   - A new SW does NOT skip-waiting automatically. Instead the running app
//     detects the waiting worker, shows a "New version — Refresh" prompt, and
//     activates it on demand. This guarantees deploys are picked up promptly
//     (even on a resumed/backgrounded PWA) without yanking the bundle mid-task.

const VERSION = 'prismos-v1.02.17'
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {
        // If any shell URL 404s, we still install — Chrome just needs the SW to exist
      }))
  );
  // Take control as soon as installed. The running page has a 'controllerchange'
  // listener that reloads once, so a freshly deployed version applies automatically
  // on the next app open — no manual "Refresh" tap needed. This is deliberate for
  // an actively-iterated beta: users kept getting stranded on stale bundles because
  // the update prompt was easy to miss on a resumed mobile PWA. The app autosaves,
  // so the reload is safe. (The "New version" prompt below still works as a backup.)
  self.skipWaiting();
});

// The app posts this when the user taps "Refresh" on the update prompt.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET — never cache auth/POST/PATCH calls
  if (req.method !== 'GET') return;

  // Navigations (page loads) — network-first, fall back to cached index.html
  // when offline so the PWA still opens to a usable shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets bundled with the app — try cache first, then network.
  // Identified by hashed filenames in /static/ which CRA stamps for cache-busting.
  if (req.url.includes('/static/')) {
    event.respondWith(
      caches.match(req).then(
        (cached) => cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Everything else (Supabase, Gmail API, fonts.googleapis.com, etc.) passes
  // straight through to the network so we never serve stale data.
});

// ── Web Push ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Ari Daily Briefing';
  const options = {
    body: data.body || 'Your morning briefing is ready.',
    icon: '/logo192.png',
    badge: '/logo192.png',
    tag: 'ari-briefing',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { try { c.navigate(url); } catch (e) {} return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
