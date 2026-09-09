import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { notify } from '../notify';

// Who else can see this contact.
//
// Sharing is the OWNER'S act and nobody else's. A broker admin cannot expose an
// agent's client, a team leader cannot widen a member's, and someone a contact
// was shared with cannot re-share it. That is enforced in the database — a
// trigger refuses the change and the update policy limits edits to the owner —
// so this control is the polite face of a rule that holds whether or not the UI
// is honest.
//
// What a share does and does not carry:
//   - the record becomes visible to the chosen scope
//   - notes can be added by anyone who can see it, attributed to them
//   - the FIELDS stay the owner's. Two people editing one phone number is how
//     you end up with a phone number nobody trusts
//   - only the owner can delete it
//
// Everyone who sees a shared contact sees whose it is. A shared record with no
// owner on it is how a database stops being believable.

// Four scopes, and the last two are different acts. 'Broker admins' is "between
// us" — the office sharing something among themselves. 'Everyone' is pushing a
// record DOWN to all 96 agents: the lender, the title company, the inspector,
// the photographer. Both are restricted to brokerage staff in the database, so
// one agent cannot put a contact in front of the whole roster.
const SCOPES = [
  { id: 'none', label: 'Private', hint: 'Only you', staffOnly: false },
  { id: 'team', label: 'My team', hint: 'Everyone on your team', staffOnly: false },
  { id: 'brokerage', label: 'Broker admins', hint: 'You and the other broker admins', staffOnly: true },
  // Read-only on purpose. Ninety-six agents annotating the same title company
  // turns a clean record into a noticeboard nobody can be told to stop using.
  { id: 'everyone', label: 'Everyone', hint: 'Every agent — read-only reference', staffOnly: true },
];

export default function ContactShareControl({ contact, userId, onChanged }) {
  const [busy, setBusy] = useState(false);
  // Ask the database whether this viewer is brokerage staff rather than passing a
  // role down through the tree. The same function guards the write, so the
  // buttons on screen and the rule in the database can never disagree — and if
  // this call fails, the staff-only options simply do not appear, which is the
  // safe direction to fail in.
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    let dead = false;
    supabase.rpc('is_brokerage_staff').then(({ data }) => { if (!dead) setIsStaff(data === true); });
    return () => { dead = true; };
  }, []);
  const scope = contact.shared_scope || 'none';
  const isMine = contact.user_id === userId;

  // Not yours: you get told whose it is, and nothing to press.
  if (!isMine) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 3 }}>
          Shared with you
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {contact.owner_name ? contact.owner_name + ' owns this contact.' : 'Another agent owns this contact.'}
          {' '}
          {contact.shared_scope === 'everyone'
            ? 'It is shared with the whole brokerage for reference — read-only, so notes and edits stay with the owner.'
            : 'You can read it and add notes. Only the owner can change or delete it.'}
        </div>
      </div>
    );
  }

  async function setScope(next) {
    if (next === scope || busy) return;
    setBusy(true);
    const { error } = await supabase.from('contacts')
      .update({ shared_scope: next })
      .eq('id', contact.id);
    setBusy(false);
    if (error) { notify('Could not change sharing: ' + (error.message || 'unknown error'), 'error'); return; }
    notify(next === 'none' ? 'Now private to you.'
      : next === 'team' ? 'Shared with your team.'
      : next === 'brokerage' ? 'Shared with the broker admins.'
      : 'Shared with every agent in the brokerage.', 'success');
    onChanged && onChanged(next);
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 7 }}>
        Who can see this
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SCOPES.filter(s => !s.staffOnly || isStaff).map(s => (
          <button key={s.id} type="button" disabled={busy} onClick={() => setScope(s.id)}
            style={{ flex: '1 1 30%', minWidth: 0, padding: '8px 4px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
              fontSize: 12, fontWeight: scope === s.id ? 800 : 600,
              border: '1px solid ' + (scope === s.id ? 'var(--room-accent, var(--accent))' : 'var(--border)'),
              background: scope === s.id ? 'var(--room-accent-16, rgba(203,163,92,.16))' : 'transparent',
              color: scope === s.id ? 'var(--room-accent, var(--accent))' : 'var(--text-2)' }}>
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.45 }}>
        {scope === 'none'
          ? 'Only you can see this contact.'
          : scope === 'everyone'
            ? 'Every agent can see this for reference. Nobody but you can edit it or add notes to it.'
            : (SCOPES.find(s => s.id === scope) || {}).hint + ' can see it and add notes. Only you can edit or delete it.'}
      </div>
    </div>
  );
}
