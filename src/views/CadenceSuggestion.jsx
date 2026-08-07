import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── CadenceSuggestion ───────────────────────────────────────────────────────
// One row on a contact's record: "DISC suggests every 37 days · Apply / Keep".
//
// It appears ONLY when the DISC-derived rhythm disagrees with a cadence a human
// deliberately set. That restraint is the whole point — the automation fills an
// empty cadence silently, and only asks when it would be overruling a person.
// A prompt that fires when nothing is at stake teaches people to dismiss prompts.

const G = '#CBA35C', CHAMP = '#EBCB82', INK = '#100D09';

export default function CadenceSuggestion({ contactId, onChanged }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    if (!contactId) return;
    const { data } = await supabase.from('contacts')
      .select('cadence_days, cadence_source, cadence_suggested, cadence_suggested_reason')
      .eq('id', contactId).maybeSingle();
    setRow(data || null);
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  if (!row || !row.cadence_suggested) {
    // Nothing pending. If the system set the rhythm itself, say so quietly —
    // an unexplained number on a record is a number nobody trusts.
    if (row && row.cadence_days && row.cadence_source === 'disc_auto' && !done) {
      return (
        <div style={{ fontSize:11.5, color:'var(--text-3)', margin:'8px 0 0', lineHeight:1.5 }}>
          Touch rhythm set from their DISC read: every <b style={{ color:'var(--text-2)' }}>{row.cadence_days} days</b>.
        </div>
      );
    }
    if (done) return <div style={{ fontSize:11.5, color:'#7fae8f', margin:'8px 0 0', fontWeight:600 }}>{done}</div>;
    return null;
  }

  const act = async (accept) => {
    setBusy(true);
    const fn = accept ? 'accept_cadence_suggestion' : 'dismiss_cadence_suggestion';
    const { error } = await supabase.rpc(fn, { p_contact_id: contactId });
    setBusy(false);
    if (error) { window.__notify?.('Could not update cadence: ' + error.message, 'error'); return; }
    setDone(accept ? `Touch rhythm now every ${row.cadence_suggested} days.` : `Keeping every ${row.cadence_days} days.`);
    setRow(r => ({ ...r, cadence_suggested: null }));
    onChanged?.();
  };

  return (
    <div style={{ marginTop:10, background:'rgba(203,163,92,.07)', border:'1px solid rgba(203,163,92,.28)', borderRadius:10, padding:'11px 12px' }}>
      <div style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', color:G, fontWeight:700, marginBottom:5 }}>Cadence suggestion</div>
      <div style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.5 }}>
        You reach out every <b style={{ color:'var(--text-1)' }}>{row.cadence_days} days</b>.{' '}
        {row.cadence_suggested_reason || `Their DISC read suggests every ${row.cadence_suggested} days`}.
      </div>
      <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
        <button onClick={() => act(true)} disabled={busy}
          style={{ background:CHAMP, color:INK, border:'none', borderRadius:8, padding:'8px 15px', fontSize:13, fontWeight:800, cursor:'pointer', opacity:busy?.6:1 }}>
          Use {row.cadence_suggested} days
        </button>
        <button onClick={() => act(false)} disabled={busy}
          style={{ background:'transparent', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
          Keep {row.cadence_days}
        </button>
      </div>
    </div>
  );
}
