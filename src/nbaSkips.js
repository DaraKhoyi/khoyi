import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './dataService';

// ── Skipping a "Do this next" item ───────────────────────────────────────────
// Lives in one place because it has now been got wrong twice for the same
// reason. Skip was originally a CURSOR — setIdx(i => i + 1) — so marking the
// next item done reset the index and the skipped item came straight back. That
// was fixed in v1.04.56 in NextBestAction... which the Today screen does not
// render. Today has its own hero with its own copy of the same cursor bug, so
// the fix landed in a component the user never saw.
//
// Two lessons are baked in here:
//   1. Shared behaviour goes in a shared module. Two heroes, one rule.
//   2. supabase-js does NOT throw on a failed write — it RESOLVES with { error }.
//      The first version wrapped the call in try/catch and checked nothing, so
//      an RLS or schema failure was invisible: the card vanished optimistically
//      and silently came back on reload with zero rows written. Errors are
//      checked and surfaced now.


// ── Snooze options ───────────────────────────────────────────────────────────
// Two kinds, because they mean different things and both are needed:
//   SHORT RELATIVE ("in an hour") is for interruption — I am mid-something.
//   DAY ANCHORS ("tomorrow morning") are for scheduling — not today, put it
//   where it belongs.
//
// Longer snoozes land on a TIME OF DAY, never "+24 hours". A 9pm snooze that
// resurfaces at 9pm tomorrow is useless; every mail client learned this.
//
// Contextual: an option that cannot mean anything right now is not shown.
// "This evening" at 8pm is nonsense, and "Monday morning" on a Monday is worse
// than nonsense because it looks like it will do something and does not.
//
// Monday earns its place for a broker specifically: weekends are showing days,
// weekdays are admin days. "Not until the week starts again" is a real intent
// that no fixed hour-count can express.
const MORNING = 8, EVENING = 18;

export function snoozeOptions(now = new Date()) {
  const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const out = [];

  out.push({ key: 'hour', label: 'In an hour', when: new Date(now.getTime() + 3600000) });

  // Only offer the evening if there is still an evening to wait for.
  const evening = at(now, EVENING);
  if (evening.getTime() - now.getTime() > 45 * 60000) {
    out.push({ key: 'evening', label: 'This evening', when: evening });
  }

  const tomorrow = at(new Date(now.getTime() + 86400000), MORNING);
  out.push({ key: 'tomorrow', label: 'Tomorrow morning', when: tomorrow });

  // Next Monday — skipped when today is Sunday or Monday, where "Monday
  // morning" is either tomorrow (already offered) or today.
  const dow = now.getDay();                      // 0 Sun … 6 Sat
  if (dow !== 0 && dow !== 1) {
    const days = (8 - dow) % 7 || 7;
    out.push({ key: 'monday', label: 'Monday morning', when: at(new Date(now.getTime() + days * 86400000), MORNING) });
  }

  out.push({ key: 'week', label: 'Next week', when: at(new Date(now.getTime() + 7 * 86400000), MORNING) });
  return out;
}

// "Tomorrow, 8:00 AM" — showing the resolved time is what makes a snooze
// trustworthy instead of a guess. Every good implementation does this.
export function describeWhen(when, now = new Date()) {
  const sameDay = when.toDateString() === now.toDateString();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const days = Math.round((when - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return `Tomorrow, ${time}`;
  if (days < 7) return `${when.toLocaleDateString([], { weekday: 'short' })}, ${time}`;
  return `${when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

export function useNbaSkips(userId) {
  const [skipped, setSkipped] = useState({});   // action_key -> ISO until

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) return;
      const { data, error } = await supabase.from('nba_dismissals')
        .select('action_key,snoozed_until')
        .eq('user_id', userId)
        .gt('snoozed_until', new Date().toISOString());
      if (!alive || error) return;
      const m = {};
      (data || []).forEach(r => { m[r.action_key] = r.snoozed_until; });
      setSkipped(m);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Drop anything currently skipped. Time-compared, so an expired skip returns
  // on its own without needing a cleanup job.
  const filterSkipped = useCallback((list) => {
    const nowMs = Date.now();
    return (list || []).filter(a => {
      const until = a && skipped[a.key];
      return !(until && new Date(until).getTime() > nowMs);
    });
  }, [skipped]);

  const unskipAction = useCallback(async (key) => {
    setSkipped(m => { const n = { ...m }; delete n[key]; return n; });
    if (!userId) return;
    await supabase.from('nba_dismissals').delete().eq('user_id', userId).eq('action_key', key);
  }, [userId]);

  // "Not now", not "never" — held until next local midnight so something
  // genuinely important comes back tomorrow instead of disappearing.
  const skipAction = useCallback(async (a, until) => {
    if (!a || !a.key) return;
    // Default stays "tomorrow morning" so a plain Skip behaves as it always has.
    const target = until instanceof Date ? until
      : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(MORNING, 0, 0, 0); return d; })();
    const iso = target.toISOString();

    setSkipped(m => ({ ...m, [a.key]: iso }));   // card drops instantly

    if (!userId) {
      // No user means no row can be written, and the hide would silently die on
      // reload. Say so rather than pretending it stuck.
      if (window.__notify) window.__notify('Hidden for now — sign-in needed to remember this.', 'info');
      return;
    }

    const { error } = await supabase.from('nba_dismissals')
      .upsert({ user_id: userId, action_key: a.key, snoozed_until: iso }, { onConflict: 'user_id,action_key' });

    if (error) {
      // Roll the optimistic hide back. A card that disappears and returns later
      // with no explanation is worse than one that never disappeared.
      setSkipped(m => { const n = { ...m }; delete n[a.key]; return n; });
      if (window.__notify) window.__notify('Could not skip: ' + (error.message || error), 'error');
      return;
    }
    if (window.__notify) {
      window.__notify(`Back ${describeWhen(target).toLowerCase()}.`, 'success', { label: 'Undo', onClick: () => unskipAction(a.key) });
    }
  }, [userId, unskipAction]);

  return { skipped, skipAction, unskipAction, filterSkipped };
}

// ── SnoozeMenu ───────────────────────────────────────────────────────────────
// One component for every hero card, because the same handler living in two
// places is how this codebase's bugs are usually shaped.
//
// Tap opens the menu rather than snoozing immediately. One extra tap, but a
// mis-tap on the top card cannot bury something for a day — and the resolved
// time is visible before you commit, which is the whole point.
export function SnoozeMenu({ onPick, label = 'Skip', className = 'btn btn-ghost btn-sm' }) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const now = new Date();
  const opts = open ? snoozeOptions(now) : [];
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className={className} onClick={() => setOpen(v => !v)}
        title="Not now — choose when it should come back">
        {label} ▾
      </button>
      {open && (
        <>
          {/* tap-away layer — there is no Escape key on a phone */}
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70,
            background: narrow ? 'rgba(0,0,0,.45)' : 'transparent' }} />
          {/* On a phone this is a BOTTOM SHEET, not a popover. A 248px popover
              anchored to a button sitting mid-row cannot fit on a 390px screen —
              it ran off the right edge, which the layout check caught before
              this shipped. A sheet also gives far bigger tap targets, which is
              what this control needs on a thumb. */}
          <div style={narrow ? {
            position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 71,
            background: 'var(--bg-card)', border: '1px solid var(--accent-dim)',
            borderRadius: 14, padding: 8, boxShadow: '0 -8px 40px rgba(0,0,0,.6)',
          } : {
            position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 71,
            width: 248, background: 'var(--bg-card)',
            border: '1px solid var(--accent-dim)', borderRadius: 11, padding: 6,
            boxShadow: '0 12px 30px rgba(0,0,0,.55)',
          }}>
            <div style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase',
              color: 'var(--text-3)', fontWeight: 800, padding: '4px 8px 6px' }}>Bring it back</div>
            {opts.map(o => (
              <button key={o.key} type="button"
                onClick={() => { setOpen(false); onPick && onPick(o.when, o); }}
                style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: 8,
                  textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  borderRadius: 8, padding: narrow ? '13px 11px' : '8px 9px' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flex: 1, minWidth: 0 }}>{o.label}</span>
                {/* the resolved time is what makes a snooze trustworthy */}
                <span style={{ fontSize: 10.5, color: 'var(--text-3)', flex: 'none' }}>{describeWhen(o.when, now)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
