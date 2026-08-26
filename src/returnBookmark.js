import { useRef, useEffect } from 'react';

// Going somewhere and coming back.
//
// Changing view starts you at the top, which is right — except when you are
// returning from somewhere the app sent you. Open a contact from the call list
// and come back to the top of Today, and you are hunting for your place in a
// list you were deliberately working down.
//
// Two things get remembered on the way out:
//   WHERE you were   — view + scroll offset, restored on return
//   WHEN you left    — so the screen you return to can ask "did anything
//                      happen while I was gone?" and tick the item off if so
//
// Lives outside App.js on purpose: this is feature code, and App.js is on a
// line budget that exists to stop exactly this kind of accretion.

// `navigate` is declared far below the render position where this hook is
// called, so taking it as an argument put App.js in a temporal dead zone and the
// whole app rendered white — before the login form, which is exactly how the
// fresh-account walk caught it. The navigation is resolved at CALL time instead.
export function useReturnBookmark(view, mainScrollRef, viewRef) {
  const markRef = useRef(null);   // { view, top }

  // A pending bookmark wins over the top-of-page reset.
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const r = markRef.current;
    if (r && r.view === view) {
      markRef.current = null;
      // Two frames: one for the view to mount, one for its content to lay out.
      // Restoring before layout lands you at the bottom of a shorter page.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { el.scrollTo({ top: r.top, left: 0 }); } catch (_) {}
      }));
      return;
    }
    el.scrollTo({ top: 0, left: 0 });
  }, [view, mainScrollRef]);

  useEffect(() => {
    window.__openContactAndReturn = (contactId) => {
      try {
        if (!contactId) return;
        const el = mainScrollRef.current;
        markRef.current = { view: viewRef.current, top: el ? el.scrollTop : 0 };
        window.__returnedFrom = { contactId: contactId, at: new Date().toISOString(), from: viewRef.current };
        window.__pendingOpenContact = contactId;
        if (window.__setView) window.__setView('contacts');
      } catch (_) {}
    };
  });
}
