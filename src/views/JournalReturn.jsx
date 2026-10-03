import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { todayNY } from '../clock';

// BACK TO MY NOTE (3 Oct 2026).
//
// Dara: "Maybe you should have a button somewhere that floats on the screen that
// takes me back to the journal so I can continue journaling during the day and be
// able to turn that feature on and off in settings."
//
// One small round button, on every screen except the Journal itself. It appears
// only once TODAY'S NOTE HAS BEEN STARTED — someone who does not journal never
// sees it — and Settings → "Journal button" turns it off (user_settings.
// journal_button). One tap opens today's note, full screen, where it was left.
export default function JournalReturn({ userId, view, enabled, onOpen }) {
  const [has, setHas] = useState(false);
  const check = useCallback(async () => {
    if (!userId || !enabled) { setHas(false); return; }
    const { data, error } = await supabase.from('journal_entries').select('id').eq('user_id', userId).eq('day', todayNY()).eq('kind', 'running').limit(1);
    if (!error) setHas(!!(data && data.length));
  }, [userId, enabled]);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const again = () => check();
    const vis = () => { if (document.visibilityState === 'visible') check(); };   // a new day, or a note started on another device
    window.addEventListener('journal-entry-added', again); window.addEventListener('journal-writer-closed', again);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('journal-entry-added', again); window.removeEventListener('journal-writer-closed', again); document.removeEventListener('visibilitychange', vis); };
  }, [check]);

  if (!enabled || !has || view === 'journal') return null;
  return (
    <button type="button" data-testid="journal-return" aria-label="Back to today’s journal note" title="Back to today’s note"
      onClick={() => { try { window.__openJournalWriter = true; } catch (_) {} onOpen && onOpen(); }}
      style={{ position: 'fixed', right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)', zIndex: 45,   // right side, above the Update pill: text and primary buttons sit on the left
        width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(197,169,94,.55)', background: 'rgba(22,25,33,.92)',
        color: '#EBCB82', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(0,0,0,.4)' }}>
      <Icon name="journal" size={20} />
    </button>
  );
}
