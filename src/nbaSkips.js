import { useState, useEffect, useCallback } from 'react';
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
  const skipAction = useCallback(async (a) => {
    if (!a || !a.key) return;
    const until = new Date(); until.setHours(24, 0, 0, 0);
    const iso = until.toISOString();

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
      window.__notify('Skipped until tomorrow.', 'success', { label: 'Undo', onClick: () => unskipAction(a.key) });
    }
  }, [userId, unskipAction]);

  return { skipped, skipAction, unskipAction, filterSkipped };
}
