// ContactRowActions — call and text without opening the record.
//
// FINDING #24. Working a call list meant tapping the contact, calling, backing
// out, and tapping the next: four taps per person for a one-tap job. The "Reach
// out next" card already had exactly this; the list simply never got it.
//
// Its own file because ContactsView is at its size ceiling, and because a row
// action is a component, not a fragment of a list.
//
// TARGETS ARE 44px and the handlers stopPropagation, because these sit inside a
// row that navigates. An imprecise thumb must open the record, never dial
// somebody by accident — the negative-margin keeps the row height unchanged
// while still giving the full target.
import React from 'react';
import { Icon } from '../icons';

export default function ContactRowActions({ contact, onText }) {
  const phone = contact && contact.phone;
  if (!phone) return null;
  const tel = 'tel:' + String(phone).replace(/[^\d+]/g, '');
  const name = contact.name || 'this contact';
  return (
    <span style={{ display: 'flex', gap: 2 }}>
      <a href={tel} onClick={(e) => e.stopPropagation()} aria-label={'Call ' + name} title="Call"
        style={btn}><Icon name="phone" size={15} /></a>
      <button type="button" onClick={(e) => { e.stopPropagation(); onText(contact, phone); }}
        aria-label={'Text ' + name} title="Text" style={btn}><Icon name="chat" size={15} /></button>
    </span>
  );
}

const btn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 44, height: 44, margin: '-11px 0', border: 'none', background: 'transparent',
  color: 'var(--text-3)', cursor: 'pointer', borderRadius: 10, textDecoration: 'none',
};
