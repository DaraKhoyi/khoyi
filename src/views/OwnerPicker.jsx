import React, { useState, useMemo, useRef, useEffect } from 'react';

// ── OwnerPicker ──────────────────────────────────────────────────────────────
// Who is actually on the hook for this?
//
// Extraction gets attribution wrong often enough that the human correction has
// to be a first-class control, not a bug to be fixed later. Measured on real
// data: items auto-tagged "them" were dismissed 75% of the time vs 49% for
// "me" — the queue was full of work that was never the user's to do, and the
// only available answer was to throw the item away. Throwing it away loses the
// fact that someone else owes you something.
//
// Three states, one row:
//   You            -> owner 'me',   owner_contact_id null   (it's your task)
//   <Counterparty> -> owner 'them', owner_contact_id null   (the person on the call)
//   Someone else   -> owner 'them', owner_contact_id <id>   (never on the call)
//
// The third state is the one that doesn't exist anywhere else in the app: on a
// call with a client you often agree that YOUR LENDER or YOUR TC will do the
// thing. Neither of them was on the call, so no extractor could ever attribute
// it correctly. Only the human knows.
//
// NOTE ON DELEGATION (deliberate boundary): assigning to a third party marks
// who you're WAITING ON. It does NOT push a task into that person's PrismOS
// account, even when they're an agent in the brokerage. Silently inserting work
// into someone else's list is a different feature with consent implications —
// see the Delegation note in the handoff.

const chip = (active, tone) => ({
  padding: '4px 10px',
  borderRadius: 100,
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  maxWidth: 150,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  border: '1px solid ' + (active ? (tone === 'them' ? '#f59e0b' : 'var(--accent-2)') : 'var(--border)'),
  background: active ? (tone === 'them' ? 'rgba(245,158,11,0.16)' : 'rgba(197,169,94,0.16)') : 'transparent',
  color: active ? (tone === 'them' ? '#f59e0b' : 'var(--accent-2)') : 'var(--text-3)',
});

export default function OwnerPicker({
  owner,                 // 'me' | 'them'
  ownerContactId,        // uuid | null
  counterpartyName,      // name of the person on the call (may be null)
  contacts,              // [{id,name}]
  onChange,              // ({ owner, owner_contact_id }) => void
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const boxRef = useRef(null);

  // Close on outside tap — on mobile there is no Escape key.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);

  const list = useMemo(() => {
    const all = contacts || [];
    const t = term.trim().toLowerCase();
    const hit = t ? all.filter(c => (c.name || '').toLowerCase().includes(t)) : all;
    return hit.slice(0, 40);
  }, [contacts, term]);

  const third = owner === 'them' && ownerContactId
    ? (contacts || []).find(c => c.id === ownerContactId)
    : null;

  const isMe = owner === 'me';
  const isCounterparty = owner === 'them' && !ownerContactId;

  const pick = (patch) => { onChange(patch); setOpen(false); setTerm(''); };

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
      {!compact && (
        <span style={{ fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--text-3)', fontWeight: 800, marginRight: 1 }}>Owner</span>
      )}

      <button type="button" style={chip(isMe, 'me')}
        onClick={() => pick({ owner: 'me', owner_contact_id: null })}>You</button>

      {counterpartyName && (
        <button type="button" style={chip(isCounterparty, 'them')}
          onClick={() => pick({ owner: 'them', owner_contact_id: null })}>{counterpartyName}</button>
      )}

      {third && (
        <button type="button" style={chip(true, 'them')} onClick={() => setOpen(o => !o)}>
          {third.name} ▾
        </button>
      )}

      {!third && (
        <button type="button" style={{ ...chip(false, 'me'), borderStyle: 'dashed' }}
          onClick={() => setOpen(o => !o)}>+ Someone else</button>
      )}

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 5,
          width: 'min(280px, 78vw)', maxHeight: 260, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--accent-dim)',
          borderRadius: 10, padding: 8, boxShadow: '0 10px 28px rgba(0,0,0,.5)',
        }}>
          <input autoFocus value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Search anyone…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
              border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-1)',
              padding: '6px 8px', fontSize: 12, marginBottom: 6 }} />
          {third && (
            <button type="button" onClick={() => pick({ owner: 'them', owner_contact_id: null })}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                color: 'var(--text-3)', fontSize: 11.5, padding: '6px 7px', cursor: 'pointer' }}>
              ← Back to {counterpartyName || 'the other party'}
            </button>
          )}
          {list.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '7px' }}>No one matches.</div>
          )}
          {list.map(c => (
            <button key={c.id} type="button"
              onClick={() => pick({ owner: 'them', owner_contact_id: c.id })}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
                border: 'none', color: 'var(--text-1)', fontSize: 12.5, padding: '7px',
                borderRadius: 6, cursor: 'pointer' }}>{c.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
