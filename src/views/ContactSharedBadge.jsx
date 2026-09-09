import React from 'react';
import { Icon } from '../icons';

// "Shared with me" — the chip above the list and the badge on each row.
//
// A contact someone else owns behaves differently: you can read it and add
// notes, but you cannot edit or delete it. That is worth saying in the LIST, not
// only on the record, so nobody opens one and discovers the rule by having a
// delete fail.
//
// Ownership is the whole test — c.user_id !== userId. Whether it reached you via
// your team, the broker admins, or a push to the entire brokerage does not change
// what you may do with it, so the list does not belabour the distinction.

export const isSharedWithMe = (c, userId) =>
  !!(c && c.user_id && userId && c.user_id !== userId);

export function SharedWithMeChip({ count, active, onToggle }) {
  if (!count) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={onToggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          border: '1px solid ' + (active ? 'var(--room-accent, var(--accent))' : 'var(--border)'),
          background: active ? 'var(--room-accent-16, rgba(203,163,92,.14))' : 'transparent',
          color: active ? 'var(--room-accent, var(--accent))' : 'var(--text-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="users" size={12} /> Shared with me ({count})
        </span>
        {active ? ' · showing' : ''}
      </button>
    </div>
  );
}

export function SharedRowBadge({ contact, userId }) {
  if (!isSharedWithMe(contact, userId)) return null;
  return (
    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2,
      display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon name="users" size={10} /> Shared with you
    </div>
  );
}

export default SharedWithMeChip;
