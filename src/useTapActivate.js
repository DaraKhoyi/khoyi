import { useRef } from 'react';

// Make a tap fire on the first touch, on iOS, inside a scrolling list.
//
// iOS does not reliably turn a touch into a click when the element sits in a
// scroll container that is still settling: the tap is spent stopping the scroll
// instead of activating the thing under the finger. In the tuning-fork menu —
// 57 items, so you scroll before nearly every tap — that reads as "everything
// needs a double tap", which is what Josh hit on his iPhone.
//
// The stylesheet fix (dropping the legacy -webkit-overflow-scrolling layer)
// removes the cause. This removes the dependence on it: one CSS regression
// should not put the whole menu back to double-tapping.
//
// A tap is not a drag. The handler only fires if the finger moved less than
// 10px and lifted within 600ms, so scrolling the list never activates the row it
// happens to stop on. The synthetic click that follows is then suppressed, so
// nothing runs twice. Mouse and keyboard are untouched — they go through
// onClick exactly as before, which keeps focus and Enter working.

const MOVE_TOLERANCE = 10;   // px — a finger is never perfectly still
const TAP_TIMEOUT = 600;     // ms — longer than this is a press, not a tap

export function useTapActivate(handler) {
  const tap = useRef(null);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    tap.current = { x: e.clientX, y: e.clientY, t: Date.now(), fired: false };
  };

  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse') return;
    const d = tap.current;
    if (!d) return;
    const moved = Math.abs(e.clientX - d.x) > MOVE_TOLERANCE ||
                  Math.abs(e.clientY - d.y) > MOVE_TOLERANCE;
    if (moved || Date.now() - d.t > TAP_TIMEOUT) { tap.current = null; return; }
    d.fired = true;
    handler();
  };

  const onClick = () => {
    if (tap.current && tap.current.fired) { tap.current = null; return; }
    handler();
  };

  return { onPointerDown, onPointerUp, onClick };
}

export default useTapActivate;
