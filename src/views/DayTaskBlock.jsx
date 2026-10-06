// DayTaskBlock — one auto-scheduled task on the Day timeline, and the way it is
// picked up and moved. Its own file since 6 Oct 2026: the gesture rules below
// are a subject of their own, and CalendarView had no room left for them.
import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../icons';
import { pad2 } from '../helpers';

const laneVars = (l) => (l && l.lanes > 1 ? { '--lane': l.lane, '--lanes': l.lanes } : null);

// A single auto-scheduled task block on the day timeline.
// Tap opens it · press and hold, then drag, reschedules (snaps to 15 min) ·
// press and hold alone pins/unpins. A plain drag scrolls the page.

export default function DayTaskBlock({ ev, task, top, height, lane, overdue, HOUR_PX, hourStart, hourEnd, date, timelineRef, onToggleComplete, onMove, onTogglePin, onTap }) {
  const [dragging, setDragging] = useState(false);
  const [dragTop, setDragTop] = useState(top);
  const press = useRef({ startY:0, startX:0, origTop:top, moved:false, strayed:false, lifted:false, pointerId:null, timer:null });
  const pinned = !!task?.pin_at;
  const SNAP_MIN = 15;
  const spanPx = (hourEnd - hourStart) * HOUR_PX;

  function topToDate(px) {
    const clamped = Math.max(0, Math.min(px, spanPx - 8));
    let mins = (clamped / HOUR_PX) * 60;
    mins = Math.round(mins / SNAP_MIN) * SNAP_MIN;
    const total = hourStart * 60 + mins;
    const d = new Date(date);
    d.setHours(Math.floor(total / 60), total % 60, 0, 0);
    return d;
  }
  function liveLabel(px) {
    const d = topToDate(px);
    let h = d.getHours(); const m = d.getMinutes();
    const ap = h < 12 ? 'AM' : 'PM'; let hh = h % 12; if (hh === 0) hh = 12;
    return `${hh}:${pad2(m)} ${ap}`;
  }

  // HOW A TASK BLOCK IS MOVED (Dara, 6 Oct 2026: "Fix them all").
  // A finger that lands on a block and moves is SCROLLING THE DAY — the block
  // must not come with it. Before this, any 6px of travel grabbed the block,
  // rescheduled the task and pinned it; on a busy day there was nowhere to put
  // a finger to scroll. Now:
  //   tap                      -> open the task
  //   move straight away       -> the page scrolls or the day swipes; nothing else
  //   press and hold, then move -> the block lifts (a short buzz) and follows
  //   press and hold, let go   -> pin / unpin, as before
  // A mouse has no scrolling to confuse it with, so it drags at once.
  const HOLD_MS = 380, SLOP = 8;
  const blockRef = useRef(null);
  useEffect(() => {
    // Once lifted, the page must not scroll under the finger. React's touch
    // listeners are passive and cannot stop a scroll, so this one is native.
    const el = blockRef.current; if (!el) return undefined;
    const stop = (e) => { if (press.current.lifted && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => { el.removeEventListener('touchmove', stop); clearTimeout(press.current.timer); };
  }, []);
  function onPointerDown(e) {
    if (e.target.closest('.task-block-check, .task-block-pin')) return; // let those handle themselves
    const p = press.current;
    clearTimeout(p.timer);
    p.startY = e.clientY; p.startX = e.clientX; p.origTop = top; p.moved = false; p.strayed = false; p.lifted = false; p.pointerId = e.pointerId;
    if (e.pointerType === 'mouse') { p.lifted = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ } return; }
    const el = e.currentTarget, id = e.pointerId;
    p.timer = setTimeout(() => {
      if (p.pointerId !== id || p.strayed) return;
      p.lifted = true; setDragTop(p.origTop); setDragging(true); navigator.vibrate?.(15);
      try { el.setPointerCapture(id); } catch { /* noop */ }
    }, HOLD_MS);
  }
  function onPointerMove(e) {
    const p = press.current;
    if (p.pointerId == null) return;
    const dy = e.clientY - p.startY, dx = e.clientX - p.startX;
    if (!p.lifted) {
      // moved before the hold completed: this is a scroll or a swipe, not ours
      if (Math.abs(dy) > SLOP || Math.abs(dx) > SLOP) { p.strayed = true; clearTimeout(p.timer); }
      return;
    }
    if (!p.moved && Math.abs(dy) > 4) { p.moved = true; setDragging(true); }
    if (p.moved) setDragTop(Math.max(0, Math.min(p.origTop + dy, spanPx - 8)));
  }
  function endPress(e) {
    const p = press.current;
    clearTimeout(p.timer);
    try { e.currentTarget.releasePointerCapture?.(p.pointerId); } catch { /* noop */ }
    if (p.pointerId != null) {
      if (p.lifted && p.moved) {
        const newStart = topToDate(dragTop);
        if (newStart.getTime() !== new Date(ev.start_at).getTime()) onMove?.(ev, newStart);
      } else if (p.lifted && e.pointerType !== 'mouse') onTogglePin?.(ev);   // held, not moved
      else if (!p.strayed) onTap?.(ev);                                       // a plain tap
    }
    p.pointerId = null; p.moved = false; p.lifted = false; p.strayed = false;
    setDragging(false);
  }
  // The browser took the gesture over (it became a scroll). Nothing is committed.
  function cancelPress() {
    const p = press.current;
    clearTimeout(p.timer);
    p.pointerId = null; p.moved = false; p.lifted = false; p.strayed = false;
    setDragging(false);
  }

  const curTop = dragging ? dragTop : top;
  return (
    <div className={`day-event-block task-block${overdue?' overdue':''}${pinned?' pinned':''}${dragging?' dragging':''}`}
      ref={blockRef} data-testid="task-block"
      style={{top: `${curTop}px`, height: `${height}px`, ...laneVars(lane)}}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      title={pinned ? 'Pinned · press and hold to unpin, or hold and drag to move' : 'Press and hold to pin, or hold and drag to move'}>
      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
        <span className="task-block-check" onPointerDown={e=>e.stopPropagation()}
          onClick={(e)=>{e.stopPropagation(); onToggleComplete?.();}}>{task?.completed?'☑':'☐'}</span>
        <span className="day-event-title" style={{textDecoration:task?.completed?'line-through':'none'}}>{ev.title}</span>
        {pinned && <span className="task-block-pin" onPointerDown={e=>e.stopPropagation()}
          onClick={(e)=>{e.stopPropagation(); onTogglePin?.(ev);}} title="Unpin"><Icon name="pin" size={12} /></span>}
      </div>
      <div className="day-event-time">
        {dragging ? `→ ${liveLabel(dragTop)}` : `${overdue?'⚠ overdue · ':''}${pad2(new Date(ev.start_at).getHours())}:${pad2(new Date(ev.start_at).getMinutes())}${ev.description && ev.description.includes('part') ? ' · '+ev.description.replace('Auto-scheduled · ','') : ''}`}
      </div>
    </div>
  );
}
