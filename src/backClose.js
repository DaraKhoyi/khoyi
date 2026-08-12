// ── Modal back-close stack + hook — extracted from App.js (strangle) ──────────
// A modal calls useBackClose(onClose) to register its close handler in a shared
// LIFO stack while mounted. The single back/popstate handler in App.js reads
// __prismModalCloseStack to close the top modal on Android back, and only asks to
// exit the app when no modals are open. The hook does NOT touch history itself —
// that avoids the old double-handler conflict where closing a modal via the UI
// spuriously triggered the "Exit Prism?" prompt.

import { useRef, useEffect } from 'react';

export const __prismModalCloseStack = [];

export function useBackClose(onClose) {
  const __cb = useRef(onClose); __cb.current = onClose;
  useEffect(() => {
    const entry = { close: () => { try { __cb.current && __cb.current(); } catch (_e) {} } };
    __prismModalCloseStack.push(entry);
    return () => { const i = __prismModalCloseStack.lastIndexOf(entry); if (i !== -1) __prismModalCloseStack.splice(i, 1); };
  }, []);
}

export default useBackClose;
