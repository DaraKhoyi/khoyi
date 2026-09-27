// session_guard.mjs — ONE answer to "is this page still signed in?", shared by
// every browser suite (smoke, functional, largefont).
//
// Why it exists (26 Sep): the functional suite failed on one device per run —
// desktop one time, android the next, never the same twice. Recording what the
// page actually showed at the failure found it on the SIGN-IN SCREEN: the test
// account had been signed out seconds after logging in.
//
// That exposed the worse problem. Most checks ask "no error boundary, some
// text on screen" — and the sign-in page satisfies both. So on a signed-out
// page, 22 functional room checks, all 64 smoke views and all 37 large-font
// views could PASS while testing nothing. A check that passes for the wrong
// reason is worse than one that fails. Every view probe now asks this first.
//
// The login step had the same flaw: every suite waited for window.__setView,
// which App.js registers on EVERY screen including sign-in, so "logged in"
// returned instantly whether or not the sign-in worked. All six suites now wait
// for the sign-in and loading screens to be GONE.
//
// Root cause of the sign-outs (fixed in index.html, v1.08.73): on a first visit
// the service worker's clients.claim() fired 'controllerchange' and the page
// reloaded itself — wiping a half-typed sign-in form. Every fresh test browser
// is a first visit, and install time grows under load, hence "random device".
//
// The marker is the sign-in screen's own wrapper (App.js, className
// "auth-screen"), not "a password field exists" — Settings has password fields.

export const SIGNED_OUT_PROBE = () => !!document.querySelector('.auth-screen');

export async function isSignedOut(page) {
  try { return await page.evaluate(SIGNED_OUT_PROBE); } catch (_) { return false; }
}

export const SIGNED_OUT_NOTE = 'SIGNED OUT — the page is on the sign-in screen, so this view was never tested';
