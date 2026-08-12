// PrepLeadButton — kicks off AI lead prep for a contact.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';

export default function PrepLeadButton({ contactId }) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  async function run() {
    setBusy(true);
    try { await supabase.functions.invoke('orchestrate-new-lead', { body: { contact_id: contactId } }); setDone(true); if (window.__notify) window.__notify('First-contact plan prepared — see "Prepared by AI"', 'success'); }
    catch (_) { if (window.__notify) window.__notify('Could not prepare a plan right now', 'error'); }
    setBusy(false);
  }
  return <button className="btn btn-ghost btn-sm" disabled={busy || done} onClick={run} style={{ marginBottom: '10px' }}>{busy ? 'Preparing plan…' : done ? '✓ Plan prepared' : '\uD83E\uDD16 Prep new-lead plan'}</button>;
}
