import { describe, it, expect } from 'vitest';
import { reconnectPurposes, legacyPurpose } from './googleReconnect';
import { launchTarget } from '../modes';

const G = 'https://www.googleapis.com/auth/';

describe('reconnectPurposes', () => {
  it('email + calendar mailbox asks for both (alex@brokeralex.com, roga.lutz@gmail.com)', () => {
    const a = { purposes: ['email', 'calendar'], scopes: [G + 'gmail.readonly', G + 'calendar', 'openid'] };
    expect(reconnectPurposes(a)).toEqual(['email', 'calendar']);
    expect(legacyPurpose(reconnectPurposes(a))).toBe('both');
  });
  it('contacts-only mailbox asks for contacts, never Gmail (alexbkhoyi@gmail.com)', () => {
    const a = { purposes: ['contacts'], scopes: [G + 'contacts', 'openid', G + 'userinfo.email'] };
    expect(reconnectPurposes(a)).toEqual(['contacts']);
    expect(legacyPurpose(reconnectPurposes(a))).toBe('contacts');
  });
  it('unions recorded purposes with granted scopes', () => {
    const a = { purposes: ['email', 'calendar', 'drive', 'contacts'], scopes: [G + 'calendar', G + 'drive.readonly'] };
    expect(reconnectPurposes(a)).toEqual(['email', 'calendar', 'contacts', 'drive']);
  });
  it('a calendar-only mailbox stays calendar-only', () => {
    expect(reconnectPurposes({ purposes: ['calendar'], scopes: [G + 'calendar.events'] })).toEqual(['calendar']);
  });
  // 8 Oct 2026: the six verification scopes. A mailbox connected with ONLY the
  // narrowed set must read exactly like one connected with the old wide set, or
  // the 9 live accounts (old scopes) and every new one (narrow scopes) would be
  // treated differently by Settings, the Inbox and the health checks.
  it('the narrowed verification scopes still read as email + calendar + contacts', () => {
    const narrow = { purposes: [], scopes: ['openid', G + 'userinfo.email', G + 'userinfo.profile', G + 'gmail.modify', G + 'calendar.events', G + 'contacts.readonly'] };
    expect(reconnectPurposes(narrow)).toEqual(['email', 'calendar', 'contacts']);
    const wide = { purposes: [], scopes: ['openid', G + 'gmail.readonly', G + 'gmail.send', G + 'gmail.modify', G + 'calendar', G + 'calendar.events', G + 'contacts'] };
    expect(reconnectPurposes(wide)).toEqual(reconnectPurposes(narrow));
  });
  it('falls back to email when nothing is known', () => {
    expect(reconnectPurposes({})).toEqual(['email']);
    expect(reconnectPurposes(null)).toEqual(['email']);
  });
});

describe('launchTarget — settings deep link', () => {
  it('opens Settings on App Setup', () => {
    expect(launchTarget('?view=settings&tab=setup')).toEqual({ view: 'settings', sub: null, tab: 'setup' });
  });
  it('ignores an unknown settings tab', () => {
    expect(launchTarget('?view=settings&tab=<script>')).toEqual({ view: 'settings', sub: null, tab: null });
  });
  it('still rejects views that are not on the list', () => {
    expect(launchTarget('?view=agentruns')).toBeNull();
  });
  it('leaves the existing launchers alone', () => {
    expect(launchTarget('?view=finance&sub=ledger')).toEqual({ view: 'finance', sub: 'ledger', tab: null });
  });
});

import { missingPurposes } from './googleReconnect';
describe('missingPurposes', () => {
  it('flags email + calendar when only contacts was granted (Alex, 9 Oct)', () => {
    const a = { purposes: ['email', 'calendar', 'contacts'], scopes: [G + 'contacts.readonly', 'openid'] };
    expect(missingPurposes(a)).toEqual(['email', 'calendar']);
    expect(reconnectPurposes(a)).toEqual(['email', 'calendar', 'contacts']);
  });
  it('nothing missing when the grant covers every purpose', () => {
    expect(missingPurposes({ purposes: ['email', 'calendar'], scopes: [G + 'gmail.modify', G + 'calendar.events'] })).toEqual([]);
  });
  it('never flags a row with no recorded scopes or an inactive row', () => {
    expect(missingPurposes({ purposes: ['email'], scopes: [] })).toEqual([]);
    expect(missingPurposes({ purposes: ['email'], scopes: ['openid'], is_active: false })).toEqual([]);
  });
});
