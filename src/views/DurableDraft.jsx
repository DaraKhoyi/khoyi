// ── DurableDraft — a text field that cannot lose what you typed ──────────────
//
// Wrap any input or textarea and it survives a failed save, a reload, a crash, a
// backgrounded iOS tab, and a phone dying mid-sentence.
//
// THE RULE: restoration is SILENT, never a prompt. "Restore your draft?" is a
// question asked of someone who has already had the sinking feeling. By the time
// you ask, you have lost them. The text is simply there.
//
// It writes on a 400ms trailing debounce rather than every keystroke: IndexedDB is
// async and cheap, but a write per character on a mid-range Android is how you make
// typing feel laggy, and a laggy text box is its own reason to stop using an app.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { saveDraft, loadDraft, clearDraft, draftKey, listQueue, onOutboxChange } from '../outbox';

/**
 *   const draft = useDurableDraft('note', 'body', noteId, body, setBody);
 *   ...on a successful save:  draft.done()
 *
 * Returns { restored, done }. `restored` is true when text came back from a
 * previous session, so a screen can say so quietly if it wants to.
 */
export function useDurableDraft(screen, field, id, value, setValue) {
  const key = draftKey(screen, field, id);
  const [restored, setRestored] = useState(false);
  const timer = useRef(null);
  const loadedFor = useRef(null);

  // Restore once per key, and ONLY into an empty field — never clobber text the
  // user is already looking at.
  useEffect(() => {
    let alive = true;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    (async () => {
      const d = await loadDraft(key);
      if (!alive || !d) return;
      if (!String(value || '').trim() && d.text) { setValue(d.text); setRestored(true); }
    })();
    return () => { alive = false; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { saveDraft(key, value); }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, value]);

  // A phone can be locked or the tab killed between keystrokes, so flush
  // immediately when the page is hidden rather than waiting out the debounce.
  useEffect(() => {
    const flush = () => { if (document.hidden) saveDraft(key, value); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); };
  }, [key, value]);

  const done = useCallback(() => { setRestored(false); clearDraft(key); }, [key]);
  return { restored, done };
}

/**
 * The queue, made visible. Shown only when something is actually waiting, so it is
 * never chrome — but when it appears it must be believable, which means naming the
 * items rather than showing a count.
 */
export function OutboxStrip({ userId }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    listQueue(userId).then((i) => { if (alive) setItems(i); });
    const off = onOutboxChange((i) => { if (alive) setItems(i.filter((x) => !userId || x.userId === userId)); });
    return () => { alive = false; off(); };
  }, [userId]);

  if (!items.length) return null;
  const stuck = items.filter((i) => (i.attempts || 0) >= 8);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: stuck.length ? 'rgba(201,139,139,.10)' : 'rgba(203,163,92,.10)',
      border: '1px solid ' + (stuck.length ? 'rgba(201,139,139,.4)' : 'rgba(203,163,92,.35)'),
      borderRadius: 12, padding: '9px 13px', margin: '0 0 12px',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-2)', flex: '1 1 auto', minWidth: 0, lineHeight: 1.5 }}>
        {stuck.length
          ? `${stuck.length} item${stuck.length === 1 ? '' : 's'} couldn't be sent — still saved on this phone, nothing is lost.`
          : `${items.length} item${items.length === 1 ? '' : 's'} saved on this phone, waiting for signal: ${items.slice(0, 3).map((i) => i.label).join(', ')}${items.length > 3 ? '…' : ''}`}
      </span>
    </div>
  );
}
