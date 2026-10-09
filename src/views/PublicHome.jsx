// PublicHome.jsx — the signed-out front door.
//
// GOOGLE VERIFICATION (8 Oct 2026). Google's reviewers require darasapp.com to
// describe the app, not only show a login form, and to say plainly what it does
// with Google data. That page is static HTML in index.html (#prism-home), so it
// can be read with JavaScript off and is the same words every time. This
// component only places the sign-in card into that page's #prism-signin slot.
//
// It shows the public home only on the site root. Anywhere else (a deep link,
// a /sign/ page handed back by 404.html) the plain sign-in screen renders as
// before. When someone signs in, this unmounts and the page is hidden again;
// when they sign out on the root, it comes back.
import React from 'react';
import { createPortal } from 'react-dom';

function onSiteRoot() {
  try { return window.location.pathname === '/' || window.location.pathname === '/index.html'; } catch (_) { return false; }
}

export default function SignInGate({ render }) {
  const slot = typeof document !== 'undefined' ? document.getElementById('prism-signin') : null;
  const home = !!slot && onSiteRoot();

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    if (home) {
      root.classList.remove('ph-hide');
      const fb = slot.querySelector('.ph-signin-fallback');
      if (fb) fb.style.display = 'none';
    }
    return () => {
      root.classList.add('ph-hide');
      const fb = slot && slot.querySelector('.ph-signin-fallback');
      if (fb) fb.style.display = '';
    };
  }, [home, slot]);

  if (home) return createPortal(render(true), slot);
  return render(false);
}
