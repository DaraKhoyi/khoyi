// NotYourView — "this is a broker view", not a blank screen or the wrong one.
//
// FINDING #33. A non-admin who reached view 'agents' fell straight through the
// route chain to Mileage — a different screen entirely, with nothing to say why.
// Silently landing somewhere else is worse than a refusal: the agent believes
// they navigated wrong, tries again, and gets Mileage again.
//
// RLS already fails closed server-side and that is correct. This is the UI half:
// an explanation instead of a blank, and a way back. It never says WHAT the data
// is, only that a permission applies.
import React from 'react';

export default function NotYourView({ setView, what = 'This' }) {
  return (
    <div style={{ maxWidth: 460, margin: '48px auto 0', textAlign: 'center', padding: '0 20px' }}>
      <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 24, color: 'var(--text-1)', marginBottom: 8 }}>
        {what} is a brokerage view.
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 18 }}>
        Your broker can see it. If you think you should too, ask them — it is a role
        setting, not something that went wrong.
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => setView('today')}>Back to Today</button>
    </div>
  );
}
