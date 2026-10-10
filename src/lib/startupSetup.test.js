import { describe, it, expect } from 'vitest';
import { googleStatus, connectPurposes, nextStep, parseGoal } from './startupSetup';
const G = 'https://www.googleapis.com/auth/';
const mem = (o = {}) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });
const full = { email_address: 'a@x.com', is_active: true, revoked: false, purposes: ['email', 'calendar', 'contacts'], scopes: [G + 'gmail.modify', G + 'calendar.events', G + 'contacts.readonly'] };

describe('googleStatus', () => {
  it('no accounts = none', () => expect(googleStatus([]).status).toBe('none'));
  it('all three = ok', () => expect(googleStatus([full]).status).toBe('ok'));
  it('pools across accounts', () => {
    expect(googleStatus([{ ...full, scopes: [G + 'gmail.modify'] }, { ...full, scopes: [G + 'calendar', G + 'contacts'] }]).status).toBe('ok');
  });
  it('contacts only (Alex) misses email+calendar', () => {
    const r = googleStatus([{ ...full, scopes: [G + 'contacts.readonly', 'openid'] }]);
    expect(r).toMatchObject({ status: 'missing', missing: ['email', 'calendar'] });
  });
  it('gmail.readonly is not enough', () => expect(googleStatus([{ ...full, scopes: [G + 'gmail.readonly', G + 'calendar', G + 'contacts'] }]).missing).toEqual(['email']));
  it('revoked token = revoked', () => expect(googleStatus([{ ...full, revoked: true }]).status).toBe('revoked'));
  it('revoked but another account covers it = ok', () => expect(googleStatus([{ ...full, revoked: true }, full]).status).toBe('ok'));
  it('disconnected-by-user only = none', () => expect(googleStatus([{ ...full, is_active: false }]).status).toBe('none'));
});

describe('connectPurposes', () => {
  it('asks for all three', () => expect(connectPurposes([])).toEqual(['email', 'calendar', 'contacts']));
  it('keeps drive', () => expect(connectPurposes([{ purposes: ['drive'] }])).toContain('drive'));
});

describe('nextStep', () => {
  const facts = { has_goal: false, google: [] };
  it('goal first', () => expect(nextStep({ facts, uid: 'u', today: 'd', local: mem(), session: mem() })).toBe('goal'));
  it('skipped today -> google', () => expect(nextStep({ facts, uid: 'u', today: 'd', local: mem({ 'prism_goal_skip:u': 'd' }), session: mem() })).toBe('google'));
  it('skip expires next day', () => expect(nextStep({ facts, uid: 'u', today: 'e', local: mem({ 'prism_goal_skip:u': 'd' }), session: mem() })).toBe('goal'));
  it('google later = this launch only', () => expect(nextStep({ facts: { has_goal: true, google: [] }, uid: 'u', today: 'd', local: mem(), session: mem({ 'prism_google_later:u': '1' }) })).toBe(null));
  it('never while acting as', () => expect(nextStep({ facts, uid: 'u', today: 'd', local: mem({ __impersonating: '{"target_id":"u"}' }), session: mem() })).toBe(null));
  it('all set = nothing', () => expect(nextStep({ facts: { has_goal: true, google: [full] }, uid: 'u', today: 'd', local: mem(), session: mem() })).toBe(null));
});

describe('parseGoal', () => {
  it('reads $250,000', () => expect(parseGoal('$250,000')).toBe(250000));
  it('rejects tiny', () => expect(parseGoal('50')).toBe(0));
});
