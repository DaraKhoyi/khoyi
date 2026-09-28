import React from 'react';
import SignPortal from './views/SignPortal';
import OAuthConsent from './views/OAuthConsent';
import TalkToPrism from './views/TalkToPrism';

// Screens that stand on their own, outside the main app shell:
//   /sign/{token}      — a client signing a document (no PrismOS account needed)
//   /oauth/consent     — "Claude wants to connect to your PrismOS"
//   /talk or ?talk=1   — Talk to Prism, the voice screen (home-screen shortcut)
export function specialScreen() {
  if (typeof window === 'undefined') return null;
  const { pathname, search } = window.location;
  const m = pathname.match(/^\/sign\/([A-Za-z0-9_-]+)/);
  if (m) return <SignPortal token={m[1]} />;
  if (pathname.startsWith('/oauth/consent')) return <OAuthConsent />;
  if (pathname.startsWith('/talk') || new URLSearchParams(search).has('talk')) return <TalkToPrism />;
  return null;
}
