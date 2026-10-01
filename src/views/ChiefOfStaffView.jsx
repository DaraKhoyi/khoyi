import React from 'react';
import ChiefQueue from './ChiefQueue';
import { DoneForYouList } from './DoneForYou';
import { calm } from '../calm';

// DONE FOR YOU — what PrismOS did, what waits for your OK, and everything that
// can wait (1 Oct 2026). This was "Chief of Staff": the same single queue that
// leads Today, with the whole list open. Josh asked for the other half — a
// place where the AI says what it already handled — and it belongs here, on
// the page Today's "See what I did" opens, so there is still one queue.
export default function ChiefOfStaffView({ userId, setView, onOpenPlan }) {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div style={calm.page}>
      <h1 style={calm.greeting}>Done for you.</h1>
      <div style={calm.date}>{today}</div>
      <DoneForYouList setView={setView} />
      <div style={calm.section}>Everything that can wait</div>
      <div style={calm.sectionNote}>The same list Today draws its three from, in order. Nothing here is urgent.</div>
      <ChiefQueue userId={userId} setView={setView} all
        onChanged={() => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} }} />
      {onOpenPlan && (
        <div style={{ marginTop: 18 }}>
          <button type="button" style={calm.link} onClick={onOpenPlan}>Plan my day — put these in an order</button>
        </div>
      )}
    </div>
  );
}
