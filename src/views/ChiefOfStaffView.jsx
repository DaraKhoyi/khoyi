import React from 'react';
import ChiefQueue from './ChiefQueue';
import { Icon } from '../icons';

// Chief of Staff — the same single queue that leads Today (ChiefQueue.jsx),
// on its own page with the whole list open. Until 29 Sep this was a separate
// system: an AI job rebuilt a list here every morning (4,661 items, last acted
// on 29 Jul). Now there is one queue, computed live, and this is a window on it.
export default function ChiefOfStaffView({ userId, setView, onOpenPlan }) {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><span>💼</span> Chief of Staff</h2>
      <div style={{ fontSize: '12.5px', color: 'var(--text-3)', margin: '2px 0 14px' }}>{today}</div>
      <ChiefQueue userId={userId} setView={setView} startOpen
        onChanged={() => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} }} />
      {onOpenPlan && (
        <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'center' }}>
          <button className="btn btn-ghost" onClick={onOpenPlan}><Icon name="briefing" size={14} /> &nbsp;Plan my day — arrange this into an order</button>
        </div>
      )}
    </div>
  );
}
