import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, todayISO } from '../helpers';
import ContactsView from './ContactsView';
import NotesView from './NotesView';
import { HeaderSearchIcon, HeaderSearchInput, emailAssignTask } from './SharedUi';
import DatePickerModal from './DatePickerModal';
import TaskModal from './TaskModal';
import { Tip, TipFor } from '../tipsUi';
import { confirmDialog, notify } from '../notify';

const QUADS = ['A', 'B', 'C', 'D'];
// Sort key for Eisenhower: A1 < A2 < B1 < ... Simple-system tasks sort after
// using high(0)/medium(1)/low(2) and their simple_rank. Tasks with no priority info sort last.

function addDaysISO(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

const DragContext = React.createContext(null);

// Drag controller — provides startDrag, registerDropZone, and listens to
// global pointermove/pointerup. Wraps any subtree where drag should work.

function DragProvider({ onDragStart, onDragEnd, children }) {
  // activeDrag is set on drag-start and cleared on drag-end. It does NOT change
  // on every pointermove — that's the bug fix from Finding #7 (listener thrash).
  // Pointer coordinates live in a ref and update the floating-clone DOM directly.
  const [activeDrag, setActiveDrag] = useState(null);
  const cloneElRef = useRef(null);            // the floating clone <div> in document.body
  const pointerRef = useRef({ x: 0, y: 0 });  // live pointer position
  const dropZonesRef = useRef([]);            // [{ id, type, getRect, getElement, onDrop }]
  const hoveredZoneRef = useRef(null);

  const register = useCallback((spec) => {
    dropZonesRef.current.push(spec);
    return () => {
      dropZonesRef.current = dropZonesRef.current.filter(z => z.id !== spec.id);
    };
  }, []);

  // Begin a drag — called by a task row's anchor on first move past threshold
  const startDrag = useCallback((opts) => {
    pointerRef.current = { x: opts.clientX, y: opts.clientY };
    setActiveDrag(opts);
    if (onDragStart) onDragStart();
  }, [onDragStart]);

  // Floating clone — rendered ONCE per drag (activeDrag changes only on start/end).
  // Position updates happen via direct DOM manipulation in onMove → no re-renders.
  const floatingClone = activeDrag && createPortal(
    <div ref={(el) => { cloneElRef.current = el; if (el) {
      // Position immediately on mount so first frame is correct
      el.style.left = `${pointerRef.current.x - 40}px`;
      el.style.top  = `${pointerRef.current.y - 16}px`;
    }}}
      style={{
        position:'fixed',
        top: 0, left: 0,                        // overridden by direct DOM updates
        pointerEvents:'none',
        zIndex:99999,
        opacity:0.92,
        transform:'rotate(-1deg)',
        boxShadow:'0 8px 24px rgba(0,0,0,0.5)',
        willChange:'transform',
      }}>
      <div style={{
        display:'inline-flex', alignItems:'center', gap:'6px',
        padding:'6px 10px',
        background:'var(--bg-card)',
        border:`1px solid ${activeDrag.color || 'var(--accent)'}`,
        borderRadius:'6px',
        fontSize:'13px',
        color:'var(--text-1)',
        maxWidth:'70vw',
        whiteSpace:'nowrap',
        overflow:'hidden',
        textOverflow:'ellipsis',
      }}>
        <span style={{
          flexShrink:0,
          padding:'2px 7px',
          background: activeDrag.color || 'var(--accent)',
          color:'#fff',
          fontSize:'10px',
          fontWeight:900,
          borderRadius:'4px',
        }}>{activeDrag.label}</span>
        <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{activeDrag.title}</span>
      </div>
    </div>,
    document.body
  );

  // Global pointermove + pointerup. Listeners attach ONCE when a drag starts
  // (activeDrag flips null → object) and detach ONCE when it ends — not on every
  // pointer move. Coordinates flow through pointerRef so React doesn't re-render
  // on every move.
  useEffect(() => {
    if (!activeDrag) return;
    // Helper: clear all gap indicators across the document
    function clearGapIndicators() {
      document.querySelectorAll('[data-drop-above="true"]').forEach(el => {
        el.removeAttribute('data-drop-above');
      });
    }
    function onMove(e) {
      const pt = e.touches ? e.touches[0] : e;
      pointerRef.current = { x: pt.clientX, y: pt.clientY };
      // Update the floating clone's position via direct DOM (no React re-render)
      const el = cloneElRef.current;
      if (el) {
        el.style.left = `${pt.clientX - 40}px`;
        el.style.top  = `${pt.clientY - 16}px`;
      }
      // Hit-test
      let hovered = null;
      for (const z of dropZonesRef.current) {
        const r = z.getRect();
        if (!r) continue;
        if (pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom) {
          hovered = z;
          // Zones win over quadrants if overlapping
          if (z.type === 'zone') break;
        }
      }
      hoveredZoneRef.current = hovered;
      // Highlight zones: write to DOM directly to avoid re-render storms
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (!zEl) return;
        if (hovered && hovered.id === z.id) zEl.classList.add('drop-hover');
        else zEl.classList.remove('drop-hover');
      });
      // Gap indicator: only inside a quadrant. Find the row whose midpoint
      // the pointer is above and mark it with data-drop-above="true". CSS
      // turns that into a visible spacer + line. Skip when hovering a
      // bottom drop zone (date-change) — that doesn't need a gap preview.
      clearGapIndicators();
      if (hovered && hovered.type === 'quadrant') {
        const zEl = hovered.getElement?.();
        if (zEl) {
          const rows = zEl.querySelectorAll('[data-task-row]');
          // Don't highlight if the dragged task is the only row, or if
          // pointer is below all rows (then the task drops at the end —
          // no gap indicator needed).
          for (const row of rows) {
            const taskId = row.getAttribute('data-task-row');
            if (taskId === activeDrag.taskId) continue;  // skip self
            const r = row.getBoundingClientRect();
            if (pt.clientY < r.top + r.height / 2) {
              row.setAttribute('data-drop-above', 'true');
              break;
            }
          }
        }
      }
    }
    function onUp(e) {
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      // Final hit-test
      let target = null;
      for (const z of dropZonesRef.current) {
        const r = z.getRect();
        if (!r) continue;
        if (pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom) {
          target = z;
          if (z.type === 'zone') break;
        }
      }
      // Clear highlights + gap indicators
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (zEl) zEl.classList.remove('drop-hover');
      });
      clearGapIndicators();
      if (target && target.onDrop) {
        try {
          target.onDrop(activeDrag, { clientX: pt.clientX, clientY: pt.clientY });
        } catch (err) {
          console.error('Drop handler failed:', err);
        }
      }
      setActiveDrag(null);
      if (onDragEnd) onDragEnd();
    }
    function onCancel() {
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (zEl) zEl.classList.remove('drop-hover');
      });
      clearGapIndicators();
      setActiveDrag(null);
      if (onDragEnd) onDragEnd();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // Deps: activeDrag (the object) IS the gate — it flips on/off per drag.
    // We deliberately don't depend on its mutating fields (it doesn't have any
    // anymore — clientX/Y were removed from the object's React identity).
    // onDragEnd should be stable (passed from parent as a callback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrag, onDragEnd]);

  const ctxValue = useMemo(() => ({
    register,
    startDrag,
    isDragging: !!activeDrag,
  }), [register, startDrag, activeDrag]);

  return (
    <DragContext.Provider value={ctxValue}>
      {children}
      {floatingClone}
    </DragContext.Provider>
  );
}

// Hook for a draggable badge.
//
// Behavior (per Q9 decision): drag starts almost instantly. The priority badge
// is a dedicated drag handle — user agrees not to touch it for scrolling.
// We require a tiny pointer movement (3px) to start drag, which prevents
// pure clicks from triggering drag but lets intentional drags begin immediately.
//
// Stability: the returned handlers are STABLE across renders (callbacks read
// the latest task/label/color via refs). Avoids the "re-register every render"
// churn that Finding #13 flagged.
//
// Cleanup: any pending press timer is cleared on unmount (Finding #15).

function useDraggable({ task, label, color, sourceQuadrant }) {
  const drag = useContext(DragContext);

  // Latest values live in a ref so onPointerDown stays stable across renders.
  const latestRef = useRef({ task, label, color, sourceQuadrant });
  useEffect(() => {
    latestRef.current = { task, label, color, sourceQuadrant };
  });

  const startedRef = useRef(false);     // has drag actually started for this gesture
  const originRef = useRef(null);       // { x, y } where pointerdown happened
  const cleanupRef = useRef(null);      // function to remove window listeners

  // Cleanup window listeners + any pending state on unmount
  useEffect(() => () => {
    if (cleanupRef.current) {
      try { cleanupRef.current(); } catch (_) {}
      cleanupRef.current = null;
    }
    originRef.current = null;
    startedRef.current = false;
  }, []);

  const onPointerDown = useCallback((e) => {
    // Only primary pointer
    if (e.button !== undefined && e.button !== 0) return;
    originRef.current = { x: e.clientX, y: e.clientY };
    startedRef.current = false;

    // Listen at the window level for the next pointermove. As soon as the
    // pointer moves > 3px from the origin, start the drag. This gives near-zero
    // latency (typically <16ms = a single frame), while still distinguishing a
    // tap (no movement) from an intentional drag.
    function maybeStart(ev) {
      if (!originRef.current || startedRef.current) return;
      const dx = ev.clientX - originRef.current.x;
      const dy = ev.clientY - originRef.current.y;
      if (dx * dx + dy * dy < 9) return;  // 3px threshold
      startedRef.current = true;
      const cur = latestRef.current;
      drag.startDrag({
        taskId: cur.task.id,
        title: cur.task.title,
        label: cur.label,
        color: cur.color,
        sourceQuadrant: cur.sourceQuadrant,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
      // Once drag has started, the DragProvider takes over. We can detach.
      cleanup();
    }
    function onUpEarly() {
      // Released before reaching threshold = it was a tap, not a drag.
      cleanup();
      originRef.current = null;
    }
    function cleanup() {
      window.removeEventListener('pointermove', maybeStart);
      window.removeEventListener('pointerup', onUpEarly);
      window.removeEventListener('pointercancel', onUpEarly);
      cleanupRef.current = null;
    }
    window.addEventListener('pointermove', maybeStart);
    window.addEventListener('pointerup', onUpEarly);
    window.addEventListener('pointercancel', onUpEarly);
    cleanupRef.current = cleanup;
  }, [drag]);

  return { onPointerDown };
}

// Hook for a drop target — registers with the controller, returns ref to assign.
//
// Stability (Fix #8 + #14): the registration runs ONCE per mount instead of on
// every parent re-render. Consumers can pass freshly-created onDrop callbacks
// without causing register/unregister churn, because we route onDrop through
// a ref that we update synchronously each render. Uses React.useId for a
// stable, deterministic id (not Math.random).

function useDropTarget({ type, onDrop }) {
  const drag = useContext(DragContext);
  const elRef = useRef(null);
  const id = React.useId();
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });

  useEffect(() => {
    const spec = {
      id,
      type,
      getRect: () => elRef.current?.getBoundingClientRect(),
      getElement: () => elRef.current,
      onDrop: (drag, point) => {
        const fn = onDropRef.current;
        if (fn) fn(drag, point);
      },
    };
    const unreg = drag.register(spec);
    return unreg;
  }, [drag, type, id]);

  return elRef;
}

// ─────────────────────────────────────────────────────────────────────
// HEADER SEARCH — reusable icon-button + expanding input pair
// ─────────────────────────────────────────────────────────────────────
// Used by views that previously had a permanent search input bar
// (TasksView, ContactsView, NotesView). The icon-button lives in the
// header alongside other action buttons (.btn-view-toggle styling).
// Clicking opens the input below the header; clicking again (or Esc,
// or the × button on the input) collapses it and clears the query.
// When closed but a query is active, a small accent dot appears on
// the icon as a "you have an active filter" cue.

function TasksView({ tasks, setTasks, userId, defaultSystem, taskFilter, setTaskFilter, taskViewMode, setTaskViewMode, brain, contacts, properties, events = [], focusTaskId, setFocusTaskId }) {
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  // Focus is the calm default — five at a time instead of a wall. 'sequence'
  // (full Eisenhower list) and 'matrix' remain one tap away.
  const viewMode = (taskViewMode === 'sequence' || taskViewMode === 'matrix' || taskViewMode === 'focus') ? taskViewMode : 'focus';
  const setViewMode = (m) => { try { setTaskViewMode && setTaskViewMode(m); } catch (_) {} };
  const filter = taskFilter || 'today';
  const [isDragging, setIsDragging] = useState(false);
  const [datePickerTask, setDatePickerTask] = useState(null);
  // ── Multi-select bulk edit ──────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSel, setBulkSel] = useState(() => new Set());
  const [bulkDatePick, setBulkDatePick] = useState(false);
  const toggleBulk = (id) => setBulkSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exitBulk = () => { setBulkMode(false); setBulkSel(new Set()); };
  async function bulkSetDate(iso) {
    const ids = Array.from(bulkSel); if (!ids.length) return;
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, due_date: iso } : t));
    const { error } = await supabase.from('tasks').update({ due_date: iso }).in('id', ids);
    if (error) notify("Couldn't update due dates. Try again.", 'error');
    else notify(`${ids.length} task${ids.length === 1 ? '' : 's'} ${iso ? 'due ' + formatDueShort(iso) : 'due date cleared'}.`, 'success');
  }
  async function bulkSetQuadrant(letter) {
    const ids = Array.from(bulkSel); if (!ids.length) return;
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, eisenhower_quadrant: letter, priority_system: 'eisenhower' } : t));
    const { error } = await supabase.from('tasks').update({ eisenhower_quadrant: letter, priority_system: 'eisenhower' }).in('id', ids);
    if (error) notify("Couldn't update priority. Try again.", 'error');
    else notify(`${ids.length} task${ids.length === 1 ? '' : 's'} set to priority ${letter}.`, 'success');
  }
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  // Search bar collapses into a header icon. Open it on demand.
  // Independent of taskSearch — closing the input also clears the value (via × button).
  const [searchOpen, setSearchOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, left: 0 });

  // Latest tasks in a ref so memoized callbacks below can read fresh data
  // without depending on `tasks` (which changes every state update). Combined
  // with useDropTarget's onDrop-via-ref pattern, this keeps drop-zone
  // registration stable across the lifetime of a TasksView mount (Fix #8).
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; });

  // Filtered task set
  const [showWaiting, setShowWaiting] = useState(false);

  const visibleTasks = useMemo(() => {
    const today = todayISO();
    const tomorrow = addDaysISO(1);
    const sevenDays = addDaysISO(7);
    const q = (taskSearch || '').trim().toLowerCase();
    return tasks.filter(t => {
      // Date-bucket filter
      if (filter === 'completed') { if (!t.completed) return false; }
      else if (t.completed) return false;
      else {
        const d = t.due_date;
        if (filter === 'past' && !(d && d < today)) return false;
        else if (filter === 'today' && !(d && d <= today)) return false;
        else if (filter === 'tomorrow' && d !== tomorrow) return false;
        else if (filter === '7days' && !(d && d >= today && d <= sevenDays)) return false;
        else if (filter === 'future' && !(d && d > today)) return false;
        else if (filter === 'undated' && d) return false;
        // 'all' — no extra constraint
      }
      // Text search (title or notes)
      if (q) {
        const hay = `${t.title||''} ${t.notes||''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Somebody ELSE's job does not belong in your list. 36 of Dara's 199 open
      // tasks carry waiting_on — Ed's documents, Javier's quotes, Natasha's
      // plumber — and they sat here looking exactly like his own work, so the
      // list read as 199 things he was failing to do. He can't do any of them.
      // They live below, in their own section, and only come back when late.
      if (!showWaiting && t.waiting_on && filter !== 'completed') return false;
      // Decided against. Not done — and never counted as done.
      if (t.dropped_at && filter !== 'completed') return false;
      return true;
    });
  }, [tasks, filter, taskSearch, showWaiting]);

  // Other people's promises, kept apart. Late ones first — that's the only moment
  // one of these becomes your problem, and then the job is to chase, not to do.
  const waitingTasks = useMemo(() => {
    const today = todayISO();
    return tasks.filter(t => !t.completed && !t.dropped_at && t.waiting_on)
      .sort((a, b) => {
        const al = a.due_date && a.due_date < today ? 0 : 1;
        const bl = b.due_date && b.due_date < today ? 0 : 1;
        if (al !== bl) return al - bl;
        return (a.due_date || '9999').localeCompare(b.due_date || '9999');
      });
  }, [tasks]);

  const sequenceGroups = useMemo(() => {
    const buckets = {}; QUADS.forEach(q => buckets[q] = []);
    const unranked = [];
    visibleTasks.forEach(t => {
      const q = t.eisenhower_quadrant;
      if (QUADS.includes(q)) buckets[q].push(t);
      else unranked.push(t);
    });
    QUADS.forEach(q => {
      buckets[q].sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
    });
    unranked.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    return { buckets, unranked };
  }, [visibleTasks]);

  function openEdit(task) { setEditTask(task); setShowModal(true); }
  function openNew() { setEditTask(null); setShowModal(true); }
  useEffect(() => { if (focusTaskId && tasks && tasks.length) { const t = tasks.find(x => x.id === focusTaskId); if (t) { openEdit(t); setFocusTaskId && setFocusTaskId(null); } } }, [focusTaskId, tasks]); // eslint-disable-line

  async function handleSave(data) {
    const { _contact_ids, _email, ...taskData } = data;
    let savedTaskId = null;
    if (editTask) {
      const { data: updated, error } = await supabase.from('tasks').update(taskData).eq('id', editTask.id).select().single();
      if (error) {
        notify("Couldn't save changes. Try again.", 'error');
        return;
      }
      if (updated) {
        setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
        savedTaskId = updated.id;
      }
    } else {
      const peers = tasks.filter(t => !t.completed && t.eisenhower_quadrant === taskData.eisenhower_quadrant);
      const maxRank = peers.reduce((m, t) => Math.max(m, t.eisenhower_rank || 0), 0);
      const insert = { ...taskData, eisenhower_rank: taskData.eisenhower_rank || (maxRank + 1), user_id: userId, completed: !!taskData.completed };
      const { data: created, error } = await supabase.from('tasks').insert(insert).select().single();
      if (error) {
        notify("Couldn't create task. Try again.", 'error');
        return;
      }
      if (created) {
        setTasks(prev => [created, ...prev]);
        savedTaskId = created.id;
      }
    }
    // Replace task-contact links atomically (Pass 1 Finding #4).
    // The set_task_contacts RPC inserts new rows + deletes stale ones in a single
    // transaction. Old code did delete-then-insert which could silently lose all
    // links if the insert failed after the delete succeeded.
    if (savedTaskId && Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_task_contacts', {
        p_task_id: savedTaskId,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) {
        notify("Task saved — but contact links didn't update.", 'error');
        // Task itself saved; don't trap the user with an open modal. They can reopen to retry contacts.
      }
    }
    if (savedTaskId && _email) {
      const { error: emErr } = await emailAssignTask(savedTaskId, _email);
      if (emErr) { notify(emErr, 'error'); return; }
      notify('Task emailed to ' + _email.to, 'success');
    }
    // Auto-schedule: ask the scheduler to (re)place blocks; calendar will pick them up on next event refresh.
    if (taskData.auto_schedule) {
      supabase.functions.invoke('task-autoschedule', { body: {} }).catch(() => {});
      notify('Scheduling onto your calendar…', 'success');
    }
    setShowModal(false); setEditTask(null);
  }

  const toggleComplete = useCallback(async (task, e) => {
    if (e) e.stopPropagation();
    const newCompleted = !task.completed;
    const { data: updated, error } = await supabase.from('tasks')
      .update({ completed: newCompleted, updated_at: new Date().toISOString() })
      .eq('id', task.id).select().single();
    if (error) {
      notify("Couldn't update task. Try again.", 'error');
      return;
    }
    if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    if (updated && updated.auto_schedule && newCompleted) {
      supabase.functions.invoke('task-autoschedule', { body: {} }).catch(() => {});
    }
  }, [setTasks]);

  // Move task to quadrant at position. The drop handler in QuadrantGroup passes
  // the position where the user released (above which row, or end of list).
  //
  // Safety (Pass 1 Findings #5 + #11):
  //  - Snapshot pre-update tasks state so we can rollback on failure
  //  - Persist updates in parallel using allSettled to detect ANY failure
  //  - If any update failed, rollback local state to the snapshot + toast error
  //  - User sees the move stick or hears about it failing — never silent
  const moveTaskToQuadrant = useCallback(async (taskId, destQuadrant, dropAboveTaskId) => {
    const tasks = tasksRef.current;
    const moved = tasks.find(t => t.id === taskId);
    if (!moved) return;
    // Compute new ordering of dest quadrant: take current sorted list, remove moved if it's there,
    // insert before the dropAboveTaskId (or at end if null)
    const destTasks = tasks.filter(t => !t.completed && t.eisenhower_quadrant === destQuadrant && t.id !== taskId)
      .sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
    let insertIdx = destTasks.length; // default: end
    if (dropAboveTaskId) {
      const idx = destTasks.findIndex(t => t.id === dropAboveTaskId);
      if (idx >= 0) insertIdx = idx;
    }
    const newDestOrder = [...destTasks.slice(0, insertIdx), { ...moved, eisenhower_quadrant: destQuadrant }, ...destTasks.slice(insertIdx)];
    // Updates for destination
    const updates = newDestOrder.map((t, i) => ({
      id: t.id,
      eisenhower_rank: i + 1,
      eisenhower_quadrant: destQuadrant,
    }));
    // If quadrant changed, also renumber the source
    const sourceQuadrant = moved.eisenhower_quadrant;
    if (sourceQuadrant && sourceQuadrant !== destQuadrant) {
      const sourceTasks = tasks.filter(t => !t.completed && t.eisenhower_quadrant === sourceQuadrant && t.id !== taskId)
        .sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
      sourceTasks.forEach((t, i) => {
        updates.push({ id: t.id, eisenhower_rank: i + 1, eisenhower_quadrant: sourceQuadrant });
      });
    }

    // Snapshot pre-update task fields so we can rollback exactly the rows we touch
    const affectedIds = new Set(updates.map(u => u.id));
    const snapshot = tasks
      .filter(t => affectedIds.has(t.id))
      .map(t => ({ id: t.id, eisenhower_rank: t.eisenhower_rank, eisenhower_quadrant: t.eisenhower_quadrant, priority_system: t.priority_system }));

    // Optimistic local update
    const byId = Object.fromEntries(updates.map(u => [u.id, u]));
    setTasks(prev => prev.map(t => {
      const u = byId[t.id];
      if (!u) return t;
      return { ...t, eisenhower_rank: u.eisenhower_rank, eisenhower_quadrant: u.eisenhower_quadrant, priority_system: 'eisenhower' };
    }));

    // Persist in parallel; use allSettled so one failure doesn't mask others.
    const results = await Promise.allSettled(updates.map(u =>
      supabase.from('tasks').update({
        eisenhower_rank: u.eisenhower_rank,
        eisenhower_quadrant: u.eisenhower_quadrant,
        priority_system: 'eisenhower',
      }).eq('id', u.id).select('id')
    ));

    // Treat a Supabase rejection OR a result with non-null .error as a failure
    const failed = results.filter((r, i) => {
      if (r.status === 'rejected') return true;
      const val = r.value;
      if (val && val.error) return true;
      return false;
    });

    if (failed.length > 0) {
      // Rollback local state for affected rows
      const snapById = Object.fromEntries(snapshot.map(s => [s.id, s]));
      setTasks(prev => prev.map(t => {
        const s = snapById[t.id];
        return s ? { ...t, eisenhower_rank: s.eisenhower_rank, eisenhower_quadrant: s.eisenhower_quadrant, priority_system: s.priority_system } : t;
      }));
      notify(
        failed.length === updates.length
          ? "Couldn't save the move. Reverted."
          : `Partial save (${updates.length - failed.length} of ${updates.length}). Reverted.`,
        'error'
      );
    }
  }, [setTasks]);

  // Reschedule a task's due date (called by drop zones). Optimistic with rollback.
  const setTaskDate = useCallback(async (taskId, newDateISO) => {
    const prevDate = tasksRef.current.find(t => t.id === taskId)?.due_date;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: newDateISO } : t));
    const { error } = await supabase.from('tasks').update({ due_date: newDateISO }).eq('id', taskId);
    if (error) {
      // Rollback
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: prevDate } : t));
      notify("Couldn't update due date. Reverted.", 'error');
    }
  }, [setTasks]);

  return (
    <DragProvider onDragStart={async () => setIsDragging(true)} onDragEnd={() => setIsDragging(false)}>
      <div className="view">
        <TipFor screen="tasks" />
        {/* Calls turn into work HERE, in one batch — not as six notifications
            through the day. Yours become tasks; theirs stay on the radar until
            they're late. Renders nothing when there's nothing to decide. */}

        {/* The bill for "not today". Carry-forward made deferring free and silent;
            this is where it stops being free. */}

        {/* Other people's work, counted but not mixed in. A number you can see is
            a number you can act on; 36 of these hiding inside 199 is just weight. */}

        {/* Header: title + subtitle on left  ·  view-mode icons + add button on right
            The icons replace the old standalone Sequence/Matrix text-button row
            that used to live below the search. Layout is flex with flex-start
            alignment so the icons line up with the title baseline, not the
            "32 active" subtitle. */}
        <div className="view-header fade-up" style={{ marginBottom:'2px' }}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'8px', minHeight:'40px', marginBottom:'4px'}}>
            <HeaderSearchIcon
              value={taskSearch}
              open={searchOpen}
              onToggle={() => setSearchOpen(o => !o)}
            />
            <button
              type="button"
              onClick={() => setTaskViewMode('focus')}
              title="Focus — five at a time"
              aria-label="Focus view"
              aria-pressed={viewMode === 'focus'}
              className={`btn-view-toggle${viewMode === 'focus' ? ' active' : ''}`}>
              <span style={{fontSize:'13px',fontWeight:800}}>✦</span>
            </button>
            <button
              type="button"
              onClick={() => setTaskViewMode('sequence')}
              title="Sequence view — flat ranked list"
              aria-label="Sequence view"
              aria-pressed={viewMode === 'sequence'}
              className={`btn-view-toggle${viewMode === 'sequence' ? ' active' : ''}`}>
              {/* Sequence icon: ordered list (dot + line, x3) */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="9" y1="6"  x2="20" y2="6" />
                <line x1="9" y1="12" x2="20" y2="12" />
                <line x1="9" y1="18" x2="20" y2="18" />
                <circle cx="4.5" cy="6"  r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="4.5" cy="18" r="1.5" fill="currentColor" stroke="none"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setTaskViewMode('matrix')}
              title="Matrix view — Eisenhower quadrants"
              aria-label="Matrix view"
              aria-pressed={viewMode === 'matrix'}
              className={`btn-view-toggle${viewMode === 'matrix' ? ' active' : ''}`}>
              {/* Matrix icon: 2×2 grid */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3"  y="3"  width="8" height="8" rx="1.5"/>
                <rect x="13" y="3"  width="8" height="8" rx="1.5"/>
                <rect x="3"  y="13" width="8" height="8" rx="1.5"/>
                <rect x="13" y="13" width="8" height="8" rx="1.5"/>
              </svg>
            </button>
            <button className="btn-add-circle" onClick={openNew} title="New Task" aria-label="New Task">+</button>
          </div>
          <div style={{marginBottom:'2px'}}><span className="gold-move" style={{fontFamily:"'Barlow Condensed',sans-serif",textTransform:'uppercase',letterSpacing:'.22em',fontSize:'11px',fontWeight:700}}>Task List</span></div>
          <h2 style={{margin:'0',display:'flex',alignItems:'center',gap:'10px',minWidth:0,fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'30px',letterSpacing:'-0.02em'}}><Icon name="tasks" size={24} style={{color:'var(--room-accent, var(--accent))',flexShrink:0}} /><span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>My Focus.</span></h2>
          <p style={{fontSize:'13px',color:'var(--text-3)',margin:'6px 0 0'}}>{visibleTasks.filter(t => !t.completed).length} active</p>
        </div>
        <hr className="room-rule" />

        <Tip id="eisenhower" label="Urgent vs. important">Prism ranks by <b>importance × urgency</b> (the Eisenhower idea). Do important-and-urgent now; <b>schedule</b> important-but-not-urgent; let the rest wait. Working the matrix keeps you proactive, not just busy.</Tip>

        {/* Filter pills */}
        <div style={{display:'flex',gap:'6px',padding:'4px 0 12px',alignItems:'center',flexWrap:'wrap'}}>
          {(() => {
            const primary = [
              { id: 'today',     label: 'Today' },
              { id: 'tomorrow',  label: 'Tomorrow' },
              { id: 'all',       label: 'All' },
            ];
            const secondary = [
              { id: 'past',      label: 'Past Due' },
              { id: '7days',     label: '7 Days' },
              { id: 'future',    label: 'Future' },
              { id: 'undated',   label: 'Undated' },
              { id: 'completed', label: 'Completed' },
            ];
            const activeSecondary = secondary.find(s => s.id === filter);
            const moreLabel = activeSecondary ? activeSecondary.label : 'More';
            const moreActive = !!activeSecondary;
            const pillStyle = (active) => ({
              flexShrink:0, padding:'6px 12px', borderRadius:'999px',
              fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.03em',
              border:'1px solid',
              background: active ? 'var(--accent)' : 'transparent',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              color: active ? '#000' : 'var(--text-2)',
              cursor:'pointer', transition:'.15s',
              display:'inline-flex', alignItems:'center', gap:'4px',
            });
            return (
              <>
                {primary.map(p => (
                  <button key={p.id} onClick={() => setTaskFilter(p.id)} style={pillStyle(filter === p.id)}>{p.label}</button>
                ))}
                <button ref={moreButtonRef}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMoreMenuPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 180) });
                    setMoreFiltersOpen(o => !o);
                  }}
                  style={pillStyle(moreActive)}>
                  {moreLabel} <span style={{fontSize:'9px',opacity:0.7}}>▾</span>
                </button>
                <button onClick={() => { if (bulkMode) exitBulk(); else { setBulkMode(true); setBulkSel(new Set()); } }}
                  style={pillStyle(bulkMode)} title="Select multiple tasks to set due date or priority">
                  {bulkMode ? '✕ Exit select' : '☑ Select'}
                </button>
              </>
            );
          })()}
        </div>

        {moreFiltersOpen && createPortal(
          <>
            <div onClick={() => setMoreFiltersOpen(false)}
              style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}}/>
            <div style={{
              position:'fixed', top:moreMenuPos.top, left:moreMenuPos.left, zIndex:9999,
              background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'8px',
              boxShadow:'0 8px 24px rgba(0,0,0,0.4)', minWidth:'170px', padding:'4px'
            }}>
              {[
                { id: 'past',      label: 'Past Due' },
                { id: '7days',     label: '7 Days' },
                { id: 'future',    label: 'Future' },
                { id: 'undated',   label: 'Undated' },
                { id: 'completed', label: 'Completed' },
              ].map(p => (
                <button key={p.id}
                  onClick={() => { setTaskFilter(p.id); setMoreFiltersOpen(false); }}
                  style={{
                    display:'block', width:'100%', textAlign:'left',
                    padding:'10px 14px', background: filter === p.id ? 'var(--bg-hover)' : 'none',
                    border:'none', cursor:'pointer', borderRadius:'4px',
                    color: filter === p.id ? 'var(--accent)' : 'var(--text-1)',
                    fontSize:'13px', fontWeight: filter === p.id ? 700 : 400,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

        {/* Search input — only renders when the header search icon is toggled open.
            Header icon shows an accent dot when a query is active but the input is closed. */}
        {searchOpen && (
          <HeaderSearchInput
            value={taskSearch}
            onChange={setTaskSearch}
            placeholder="🔍 Search tasks (title or notes)…"
            onClose={() => setSearchOpen(false)}
          />
        )}

        {/* View switcher (SEQUENCE / MATRIX) lives in the header now —
            see the icon buttons next to the + at the top right. */}

        {/* "Move past due to Today" button */}
        {filter === 'today' && (() => {
          const today = todayISO();
          const pastDue = tasks.filter(t => !t.completed && t.due_date && t.due_date < today);
          if (pastDue.length === 0) return null;
          return (
            <button
              onClick={async () => {
                if (!await confirmDialog(`Move ${pastDue.length} past-due task${pastDue.length === 1 ? '' : 's'} to today?`)) return;
                const ids = pastDue.map(t => t.id);
                await supabase.from('tasks').update({ due_date: today }).in('id', ids);
                setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, due_date: today } : t));
              }}
              style={{
                width:'100%', marginBottom:'12px',
                padding:'10px 14px',
                background:'rgba(239,68,68,0.10)',
                border:'1px solid #ef4444',
                borderRadius:'6px',
                color:'#ef4444',
                fontSize:'12px', fontWeight:700,
                cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
              }}>
              ↻ Move {pastDue.length} past-due task{pastDue.length === 1 ? '' : 's'} to Today
            </button>
          );
        })()}

        {bulkMode ? (
          <div style={{ paddingBottom: bulkSel.size > 0 ? '96px' : '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0 10px' }}>
              <button onClick={() => setBulkSel(new Set(visibleTasks.map(t => t.id)))}
                style={{ padding: '6px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
                Select all ({visibleTasks.length})
              </button>
              <button onClick={() => setBulkSel(new Set())}
                style={{ padding: '6px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>
                Clear
              </button>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-3)' }}>{bulkSel.size} selected</span>
            </div>
            {visibleTasks.length === 0 && <p style={{ color: 'var(--text-3)', fontSize: '13px', padding: '12px 2px' }}>No tasks in this filter.</p>}
            {visibleTasks.map(t => {
              const sel = bulkSel.has(t.id);
              const q = t.eisenhower_quadrant;
              return (
                <button key={t.id} onClick={() => toggleBulk(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
                    padding: '10px 12px', marginBottom: '6px', borderRadius: '8px', cursor: 'pointer',
                    border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                    background: sel ? 'rgba(197,169,94,0.12)' : 'var(--bg-card)' }}>
                  <span style={{ fontSize: '16px', color: sel ? 'var(--accent)' : 'var(--text-3)', lineHeight: 1 }}>{sel ? '☑' : '☐'}</span>
                  <span style={{ flexShrink: 0, width: '20px', height: '20px', borderRadius: '5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#000', background: QUAD_COLORS[q] || 'var(--text-3)' }}>{q || '–'}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '13.5px', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span style={{ flexShrink: 0, fontSize: '11px', color: t.due_date && t.due_date < todayISO() ? 'var(--red)' : 'var(--text-3)' }}>{formatDueShort(t.due_date)}</span>
                </button>
              );
            })}
          </div>
        ) : viewMode === 'focus' ? (
          <FocusDeck
            tasks={[...(QUADS.flatMap(q => sequenceGroups.buckets[q] || [])), ...sequenceGroups.unranked]}
            onEdit={openEdit}
            onToggleComplete={toggleComplete}
            showRanking={false} hideTodayDue={filter === 'today'}
            onShowAll={() => setViewMode('sequence')}
          />
        ) : viewMode === 'sequence' ? (
          <SequenceView
            buckets={sequenceGroups.buckets}
            unranked={sequenceGroups.unranked}
            quads={QUADS}
            onEdit={openEdit}
            onToggleComplete={toggleComplete}
            onMoveTask={moveTaskToQuadrant}
            showRanking={filter === 'today'} hideTodayDue={filter === 'today'}
          />
        ) : (
          <MatrixView
            groups={sequenceGroups.buckets}
            quads={QUADS}
            onEdit={openEdit}
            onToggleComplete={toggleComplete}
            onMoveTask={moveTaskToQuadrant}
            showRanking={filter === 'today'} hideTodayDue={filter === 'today'}
          />
        )}

        {waitingTasks.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <button onClick={() => setShowWaiting(v => !v)}
              style={{ width: '100%', textAlign: 'left', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px',
                color: 'var(--text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                Waiting on other people — {waitingTasks.length}
              </span>
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const late = waitingTasks.filter(t => t.due_date && t.due_date < today).length;
                return late > 0 ? <span style={{ fontSize: 11, fontWeight: 800, color: '#C9563F' }}>{late} late</span> : null;
              })()}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{showWaiting ? 'hide' : 'these aren’t yours to do'}</span>
            </button>
            {showWaiting && (
              <div style={{ marginTop: 6 }}>
                {waitingTasks.map(t => {
                  const today = new Date().toISOString().slice(0, 10);
                  const late = t.due_date && t.due_date < today;
                  return (
                    <div key={t.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '8px 12px',
                      borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                      <span style={{ color: late ? '#C9563F' : 'var(--accent)', fontWeight: 800, fontSize: 10,
                        minWidth: 96, letterSpacing: '.04em' }}>{t.waiting_on}</span>
                      <span style={{ flex: 1, color: 'var(--text-2)', minWidth: 0, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      {late && <span style={{ fontSize: 10, color: '#C9563F', fontWeight: 700 }}>late</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DropZoneStrip
          visible={isDragging}
          onDropToday={(taskId) => setTaskDate(taskId, todayISO())}
          onDropTomorrow={(taskId) => setTaskDate(taskId, addDaysISO(1))}
          onDropPickDate={(taskId) => {
            const task = tasks.find(t => t.id === taskId);
            if (task) setDatePickerTask(task);
          }}
          onDropNextWeek={(taskId) => setTaskDate(taskId, addDaysISO(7))}
          onDropDelete={async (taskId) => {
            // This corner used to clear the due date. Deleting is what Dara
            // actually wants there, but a drag is far easier to do by accident
            // than a tap on a delete button — so it asks first, names the task
            // so you know which one you caught, and rolls the row back if the
            // write fails instead of leaving the list looking emptier than the
            // database is.
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            if (!await confirmDialog(`Delete "${task.title}"?`)) return;
            const snapshot = tasks;
            setTasks(prev => prev.filter(x => x.id !== taskId));
            const { error } = await supabase.from('tasks').delete().eq('id', taskId);
            if (error) {
              setTasks(snapshot);
              notify('Could not delete: ' + (error.message || error.code || 'unknown error'), 'error');
              return;
            }
            notify('Deleted.', 'success');
            try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
          }}
          onDropSomeday={async (taskId) => {
            // Park it: kept, but off the active list and out of every count/NBA.
            try {
              const { data } = await supabase.rpc('tasks_park_someday', { p_task_ids: [taskId], p_note: null });
              if (data?.ok) {
                setTasks && setTasks(pr => pr.filter(t => t.id !== taskId));
                if (window.__notify) window.__notify('Moved to Someday / Maybe.', 'success');
              }
            } catch (e) { if (window.__notify) window.__notify('Could not move: ' + (e.message || e), 'error'); }
          }}
        />

        {bulkMode && bulkSel.size > 0 && createPortal(
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9997,
            background: 'var(--bg-card)', borderTop: '1px solid var(--border)', padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
            display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center', boxShadow: '0 -6px 20px rgba(0,0,0,0.35)' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-1)' }}>{bulkSel.size} selected</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Due</span>
              {[{ l: 'Today', v: todayISO() }, { l: 'Tomorrow', v: addDaysISO(1) }].map(o => (
                <button key={o.l} onClick={() => bulkSetDate(o.v)} style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer' }}>{o.l}</button>
              ))}
              <button onClick={() => setBulkDatePick(true)} style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer' }}>Pick…</button>
              <button onClick={() => bulkSetDate(null)} style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>Clear</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Priority</span>
              {['A', 'B', 'C', 'D'].map(L => (
                <button key={L} onClick={() => bulkSetQuadrant(L)} title={QUAD_LABELS[L]}
                  style={{ width: '30px', height: '30px', borderRadius: '7px', fontSize: '13px', fontWeight: 800, color: '#000', background: QUAD_COLORS[L], border: 'none', cursor: 'pointer' }}>{L}</button>
              ))}
            </div>
            <button onClick={exitBulk} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ Exit select</button>
          </div>, document.body
        )}

        {bulkDatePick && (
          <DatePickerModal
            initial={todayISO()}
            onCancel={() => setBulkDatePick(false)}
            onPick={async (iso) => { await bulkSetDate(iso); setBulkDatePick(false); }}
          />
        )}

        {datePickerTask && (
          <DatePickerModal
            initial={datePickerTask.due_date || todayISO()}
            onCancel={() => setDatePickerTask(null)}
            onPick={async (iso) => {
              await setTaskDate(datePickerTask.id, iso);
              setDatePickerTask(null);
            }}
          />
        )}

        {showModal && <TaskModal onClose={()=>{setShowModal(false);setEditTask(null);}} onSave={handleSave} onDelete={async (t)=>{ if(!await confirmDialog(`Delete "${t.title}"?`)) return; await supabase.from('tasks').delete().eq('id', t.id); setTasks(prev=>prev.filter(x=>x.id!==t.id)); setShowModal(false); setEditTask(null); }} initial={editTask} defaultSystem={defaultSystem} brain={brain} contacts={contacts || []} properties={properties || []} events={events} userId={userId} />}
      </div>
    </DragProvider>
  );
}


const QUAD_LABELS = {
  A: 'Q1 · Important / Urgent',
  B: 'Q2 · Important / Not Urgent',
  C: 'Q3 · Not Important / Urgent',
  D: 'Q4 · Not Important / Not Urgent',
};

const QUAD_COLORS = {
  A: '#ef4444',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#94a3b8',
};


// ── FocusDeck ────────────────────────────────────────────────────────────────
// Calm by default. You see FIVE things, never a wall. Everything is already
// loaded, so "showing more" is instant — you are never waiting on generation.
// Clear one and the next slides up. Clear the batch and you get a real stopping
// point ("that's enough today") — permission to stop is what keeps a task list
// from becoming a treadmill.
function FocusDeck({ tasks, onEdit, onToggleComplete, showRanking, hideTodayDue, onShowAll }) {
  const BATCH = 5;
  const [shown, setShown] = useState(BATCH);
  const [rested, setRested] = useState(false);
  const visible = tasks.slice(0, shown);
  const remaining = Math.max(0, tasks.length - visible.length);
  const clearedBatch = visible.length === 0 && tasks.length > 0;

  useEffect(() => { if (tasks.length && shown > tasks.length) setShown(Math.max(BATCH, tasks.length)); }, [tasks.length, shown]);

  if (rested) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', borderRadius: 20, border: '1px dashed var(--border)' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>✦</div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 300, color: 'var(--text-1)' }}>Enough for today.</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
          {tasks.length} still waiting — they'll be here tomorrow, and nothing is lost.
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setRested(false)}>Actually, keep going</button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', borderRadius: 20, border: '1px dashed var(--border)' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 300, color: 'var(--text-1)' }}>Nothing left here.</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>You cleared this list.</div>
      </div>
    );
  }

  return (
    <div>
      {/* quiet shape of the day — you know the size without staring at it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.4, color: 'var(--text-3)', fontWeight: 700 }}>
          {visible.length} of {tasks.length}
        </div>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, (visible.length / Math.max(1, tasks.length)) * 100)}%`, height: '100%', background: 'var(--accent)', opacity: .55 }} />
        </div>
        <button onClick={onShowAll} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}>See all →</button>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {visible.map((t, i) => (
          <TaskProRow key={t.id} task={t} rankNumber={i + 1} quadrant={t.quadrant || null}
            onEdit={onEdit} onToggleComplete={onToggleComplete}
            showRanking={showRanking} hideTodayDue={hideTodayDue} />
        ))}
      </div>

      {/* the stopping point — the most important part of the whole screen */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        {remaining > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShown(s => s + BATCH)}>
            Show {Math.min(BATCH, remaining)} more
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setRested(true)}>That's enough today</button>
      </div>
      {remaining > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 8 }}>
          {remaining} more waiting — no rush.
        </div>
      )}
    </div>
  );
}

function SequenceView({ buckets, unranked, quads, onEdit, onToggleComplete, onMoveTask, showRanking, hideTodayDue }) {
  const allEmpty = quads.every(q => (buckets[q] || []).length === 0) && unranked.length === 0;
  return (
    <div>
      {quads.map(q => (
        <QuadrantGroup key={q}
          quadrant={q}
          label={QUAD_LABELS[q]}
          tasks={buckets[q] || []}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking} hideTodayDue={hideTodayDue}
        />
      ))}
      {unranked.length > 0 && (
        <QuadrantGroup
          quadrant={null}
          label="Unranked"
          tasks={unranked}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking} hideTodayDue={hideTodayDue}
        />
      )}
      {allEmpty && (
        <div style={{padding:'40px 0',textAlign:'center'}}>
          <div style={{fontSize:'42px',marginBottom:'10px'}}>✓</div>
          <p style={{color:'var(--text-2)'}}>All clear. Nothing matches this filter.</p>
        </div>
      )}
    </div>
  );
}


function QuadrantGroup({ quadrant, label, tasks, onEdit, onToggleComplete, onMoveTask, showRanking, hideTodayDue }) {
  const onDrop = useCallback((drag, point) => {
    if (!quadrant) return; // can't drop into unranked
    // Hit-test which row the pointer is over to find insertion index
    const container = elRef.current;
    if (!container) {
      onMoveTask(drag.taskId, quadrant, null);
      return;
    }
    let dropAboveTaskId = null;
    const rows = Array.from(container.querySelectorAll('[data-task-row]'));
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (point.clientY < mid) {
        dropAboveTaskId = row.getAttribute('data-task-row');
        break;
      }
    }
    onMoveTask(drag.taskId, quadrant, dropAboveTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadrant, onMoveTask]);
  const elRef = useDropTarget({ type: 'quadrant', onDrop });
  const headerColor = quadrant ? QUAD_COLORS[quadrant] : 'var(--text-3)';

  return (
    <div style={{marginBottom:'18px'}}>
      <div style={{
        padding:'6px 10px',
        background:'var(--bg-hover)',
        borderLeft:`3px solid ${headerColor}`,
        borderRadius:'4px 4px 0 0',
        fontSize:'10px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em',
        color:'var(--text-2)',
        display:'flex', justifyContent:'space-between', alignItems:'center'
      }}>
        <span>{label}</span>
        <span style={{color:'var(--text-3)',fontWeight:600}}>{tasks.length}</span>
      </div>
      <div ref={elRef} className="tasks-pro-drop-target"
        style={{
          background:'var(--bg-card)',
          border:'1px solid var(--border)',
          borderTop:'none',
          borderRadius:'0 0 4px 4px',
          minHeight: tasks.length === 0 ? '40px' : 'auto',
          transition:'background .15s',
        }}>
        {tasks.map((t, i) => (
          <TaskProRow key={t.id}
            task={t}
            rankNumber={i + 1}
            quadrant={quadrant}
            onEdit={onEdit}
            onToggleComplete={onToggleComplete}
            showRanking={showRanking} hideTodayDue={hideTodayDue}
          />
        ))}
        {tasks.length === 0 && (
          <div style={{padding:'10px 14px',fontSize:'11px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center'}}>
            Drop a task here
          </div>
        )}
      </div>
    </div>
  );
}


function TaskProRow({ task, rankNumber, quadrant, onEdit, onToggleComplete, showRanking, hideTodayDue }) {
  const q = quadrant || task.eisenhower_quadrant;
  const badgeLabel = q
    ? (showRanking ? `${q}${rankNumber}` : q)
    : (showRanking ? `${rankNumber}` : '·');
  const badgeColor = q ? QUAD_COLORS[q] : 'var(--text-3)';
  const isDone = !!task.completed;

  const dragHandlers = useDraggable({
    task,
    label: badgeLabel,
    color: badgeColor,
    sourceQuadrant: q,
  });

  return (
    <div data-task-row={task.id}
      onClick={(e) => {
        if (e.target.closest('.tasks-pro-anchor') || e.target.closest('.tasks-pro-check')) return;
        onEdit(task);
      }}
      style={{
        display:'flex', alignItems:'center', gap:'6px',
        padding:'8.8px 10px',
        borderBottom:'1px solid var(--border)',
        cursor:'pointer',
        background: isDone ? 'var(--bg-base)' : 'transparent',
        opacity: isDone ? 0.55 : 1,
      }}>
      <input type="checkbox" checked={isDone} className="tasks-pro-check"
        onChange={(e) => onToggleComplete(task, e)}
        onClick={e => e.stopPropagation()}
        style={{flexShrink:0,width:'17px',height:'17px',accentColor:'var(--accent)',cursor:'pointer'}}/>
      <div className="tasks-pro-anchor"
        onPointerDown={dragHandlers.onPointerDown}
        style={{
          flexShrink:0,
          padding:'3px 8px',
          background: badgeColor,
          color:'#fff',
          fontSize:'10.5px', fontWeight:900,
          borderRadius:'4px',
          cursor:'grab',
          touchAction:'none',
          userSelect:'none',
          minWidth:'30px', textAlign:'center',
          letterSpacing:'0.02em',
        }}
        title="Long-press and drag to reorder, or to a drop zone to reschedule">
        {badgeLabel}
      </div>
      <span style={{
        flex:1, minWidth:0,
        fontSize:'13.7px',
        color: isDone ? 'var(--text-3)' : 'var(--text-1)',
        textDecoration: isDone ? 'line-through' : 'none',
        fontStyle: task.recurring ? 'italic' : 'normal',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
      }}>
        {task.title}
      </span>
      {task.due_date && !(hideTodayDue && task.due_date === todayISO()) && (
        <span style={{
          flexShrink:0,
          fontSize:'10px', fontWeight:600,
          color:'var(--text-3)',
        }}>
          {formatDueShort(task.due_date)}
        </span>
      )}
    </div>
  );
}


function formatDueShort(iso) {
  if (!iso) return '';
  const today = todayISO();
  const tomorrow = addDaysISO(1);
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  if (iso < today) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


function MatrixView({ groups, quads, onEdit, onToggleComplete, onMoveTask, showRanking, hideTodayDue }) {
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'1fr 1fr',
      gridTemplateRows:'auto auto',
      alignItems:'start',
      gap:'8px',
    }}>
      {quads.map(q => (
        <MatrixQuadrant key={q}
          quadrant={q}
          label={QUAD_LABELS[q]}
          tasks={groups[q] || []}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking} hideTodayDue={hideTodayDue}
        />
      ))}
    </div>
  );
}


function MatrixQuadrant({ quadrant, label, tasks, onEdit, onToggleComplete, onMoveTask, showRanking, hideTodayDue }) {
  const onDrop = useCallback((drag, point) => {
    const container = elRef.current;
    if (!container) {
      onMoveTask(drag.taskId, quadrant, null);
      return;
    }
    let dropAboveTaskId = null;
    const rows = Array.from(container.querySelectorAll('[data-task-row]'));
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (point.clientY < mid) {
        dropAboveTaskId = row.getAttribute('data-task-row');
        break;
      }
    }
    onMoveTask(drag.taskId, quadrant, dropAboveTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadrant, onMoveTask]);
  const elRef = useDropTarget({ type: 'quadrant', onDrop });
  const headerColor = QUAD_COLORS[quadrant];

  return (
    <div style={{
      background:'var(--bg-card)',
      border:'1px solid var(--border)',
      borderTop:`3px solid ${headerColor}`,
      borderRadius:'6px',
      display:'flex', flexDirection:'column',
      overflow:'hidden',
    }}>
      <div style={{
        padding:'5px 8px',
        background:'var(--bg-hover)',
        fontSize:'9px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.05em',
        color:'var(--text-2)',
        borderBottom:'1px solid var(--border)',
      }}>
        {label}
      </div>
      <div ref={elRef} className="tasks-pro-drop-target"
        style={{flex:1, overflowY:'auto', minHeight:'80px', padding:'2px 0'}}>
        {tasks.map((t, i) => (
          <MatrixTaskRow key={t.id}
            task={t}
            rankNumber={i + 1}
            quadrant={quadrant}
            headerColor={headerColor}
            onEdit={onEdit}
            onToggleComplete={onToggleComplete}
            showRanking={showRanking} hideTodayDue={hideTodayDue}
          />
        ))}
        {tasks.length === 0 && (
          <div style={{padding:'10px',fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center'}}>
            Empty
          </div>
        )}
      </div>
    </div>
  );
}


function MatrixTaskRow({ task, rankNumber, quadrant, headerColor, onEdit, onToggleComplete, showRanking }) {
  const badgeLabel = showRanking ? `${quadrant}${rankNumber}` : quadrant;
  const dragHandlers = useDraggable({
    task,
    label: badgeLabel,
    color: headerColor,
    sourceQuadrant: quadrant,
  });
  return (
    <div data-task-row={task.id}
      onClick={(e) => {
        if (e.target.closest('.tasks-pro-anchor') || e.target.closest('.tasks-pro-check')) return;
        onEdit(task);
      }}
      style={{
        display:'flex', alignItems:'center', gap:'4px',
        padding:'5px 7px',
        borderBottom:'1px solid var(--border)',
        cursor:'pointer',
        opacity: task.completed ? 0.5 : 1,
      }}>
      <input type="checkbox" checked={!!task.completed} className="tasks-pro-check"
        onChange={(e) => onToggleComplete(task, e)}
        onClick={e => e.stopPropagation()}
        style={{flexShrink:0,width:'13px',height:'13px',accentColor:'var(--accent)'}}/>
      <div className="tasks-pro-anchor"
        onPointerDown={dragHandlers.onPointerDown}
        style={{
          flexShrink:0,
          padding:'1px 5px',
          background: headerColor,
          color:'#fff',
          fontSize:'9px', fontWeight:900,
          borderRadius:'3px',
          cursor:'grab',
          touchAction:'none',
          userSelect:'none',
        }}>
        {badgeLabel}
      </div>
      <span style={{
        flex:1, minWidth:0,
        fontSize:'12px',
        color: task.completed ? 'var(--text-3)' : 'var(--text-1)',
        textDecoration: task.completed ? 'line-through' : 'none',
        fontStyle: task.recurring ? 'italic' : 'normal',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
      }}>
        {task.title}
      </span>
    </div>
  );
}


function DropZoneStrip({ visible, onDropToday, onDropTomorrow, onDropPickDate, onDropNextWeek, onDropSomeday, onDropDelete }) {
  return (
    <div style={{
      position:'fixed',
      bottom: visible ? '12px' : '-160px',
      left:'12px', right:'12px',
      display:'flex', flexDirection:'column', gap:'8px',
      zIndex:200,
      transition:'bottom .25s ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      {/* Row 1 — schedule it now */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
        <DropZoneCell label="Today" action="today" onDrop={onDropToday} />
        <DropZoneCell label="Tomorrow" action="tomorrow" onDrop={onDropTomorrow} />
        <DropZoneCell label="Pick Date" action="pick" onDrop={onDropPickDate} />
      </div>
      {/* Row 2 — push it out or park it */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
        <DropZoneCell label="Next Week" action="nextweek" onDrop={onDropNextWeek} />
        <DropZoneCell label="✦ Someday" action="someday" onDrop={onDropSomeday} />
        {/* The destructive corner, and it should not look like the other five.
            Ember is the app's "this is serious" colour and it is reserved — the
            one place it belongs is the cell that ends a task. */}
        <DropZoneCell label="Delete" action="delete" onDrop={onDropDelete} />
      </div>
    </div>
  );
}


function DropZoneCell({ label, action, onDrop }) {
  const handleDrop = useCallback((drag) => {
    onDrop(drag.taskId);
  }, [onDrop]);
  const elRef = useDropTarget({ type: 'zone', onDrop: handleDrop });
  return (
    <div ref={elRef} className="tasks-pro-drop-target"
      data-drop-action={action}
      style={{
        background:'var(--bg-card)',
        borderRadius:'8px',
        padding:'14px 8px',
        textAlign:'center',
        fontSize:'10px', fontWeight:900, textTransform:'uppercase', letterSpacing:'0.05em',
        minHeight:'48px',
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
        // border, color, transform are controlled by CSS (see index.css)
        // — base color per action, scale(1.15) on .drop-hover
      }}>
      {label}
    </div>
  );
}


export default TasksView;
