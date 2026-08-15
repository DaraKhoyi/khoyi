// ── flipGestures.js ──────────────────────────────────────────────────────────
// The gestures that drive the ALT-TAB switcher (openScreens.js).
//
// A. THE FORK — the tuning fork in the top-left is where the thumb already goes.
//    Single tap still opens the menu, so nothing known is taken away. Double-tap
//    flips to the previous screen; long-press opens the switcher.
//
//    The first attempt put these on the "mindset menu" button in the top RIGHT
//    while the fork kept a plain onClick, so double-tapping the fork just opened
//    the menu twice and the feature looked broken. A control is only wired if it
//    is wired to the thing the hand reaches for.
//
// B. TWO-FINGER TAP ANYWHERE — no target to aim at, works on any screen.
//    Deliberately NOT double-tap-anywhere: on iOS a double-tap is zoom outside
//    touch-action:manipulation, and select-a-word inside every note and email
//    field. A two-finger tap collides with nothing.
//
// The pinch guard is what makes B safe: a two-finger gesture counts as a tap only
// if it ends quickly AND barely moved. A pinch moves; a two-finger scroll moves.

const DOUBLE_TAP_MS = 320;
const LONG_PRESS_MS = 480;
const TWO_FINGER_MS = 260;
const TWO_FINGER_SLOP = 14;

export function forkHandlers({ onFlip, onSwitcher, onMenu }) {
  const st = { t: 0, long: false, timer: null };
  const clear = () => { if (st.timer) { clearTimeout(st.timer); st.timer = null; } };
  return {
    onPointerDown: () => {
      st.long = false; clear();
      st.timer = setTimeout(() => { st.long = true; if (onSwitcher) onSwitcher(); }, LONG_PRESS_MS);
    },
    onPointerUp: (e) => {
      clear();
      if (st.long) { if (e && e.preventDefault) e.preventDefault(); return; }
      const now = Date.now();
      if (st.t && now - st.t < DOUBLE_TAP_MS) {
        st.t = 0;
        if (e && e.preventDefault) e.preventDefault();
        if (onFlip) onFlip();
        return;
      }
      st.t = now;
      // hold the menu until the double-tap window closes, or it opens on the way to a flip
      setTimeout(() => { if (st.t === now) { st.t = 0; if (onMenu) onMenu(); } }, DOUBLE_TAP_MS + 10);
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}

export function attachTwoFingerFlip(onFlip) {
  if (typeof document === 'undefined') return () => {};
  let start = 0, x = 0, y = 0, armed = false;
  const editable = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const t = (n.tagName || '').toLowerCase();
      if (t === 'input' || t === 'textarea' || t === 'select' || n.isContentEditable) return true;
    }
    return false;
  };
  const onStart = (e) => {
    if (!e.touches || e.touches.length !== 2) { armed = false; return; }
    if (editable(e.target)) { armed = false; return; }   // never yank the screen while typing
    armed = true; start = Date.now();
    x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  };
  const onMove = (e) => {
    if (!armed || !e.touches || e.touches.length !== 2) return;
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (Math.abs(mx - x) > TWO_FINGER_SLOP || Math.abs(my - y) > TWO_FINGER_SLOP) armed = false;
  };
  const onEnd = () => {
    if (!armed) return;
    armed = false;
    if (Date.now() - start <= TWO_FINGER_MS && onFlip) onFlip();
  };
  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('touchend', onEnd, { passive: true });
  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  };
}
