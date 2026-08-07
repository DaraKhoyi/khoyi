import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── CadenceReviewView ───────────────────────────────────────────────────────
// Clear the whole pile of cadence suggestions in one sitting.
//
// These exist because the DISC automation refuses to overwrite a rhythm a human
// chose. That restraint is right, but it creates a backlog, and a backlog with
// no screen is just data nobody sees. Reviewing 76 of these one contact at a
// time is a chore; doing it in one pass is a decision.
//
// Both answers are one tap and equally weighted. If declining is harder than
// accepting, the screen stops being a review and becomes a nag.

const G = '#CBA35C', CHAMP = '#EBCB82', GREEN = '#7fae8f', INK = '#100D09';

const eyebrow = { fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:13 };
const DISC_NOTE = {
  I: 'outgoing — reads silence as disinterest',
  S: 'steady — values consistent, unhurried contact',
  D: 'direct and busy — infrequent but substantive',
  C: 'analytical — resents noise, wants a reason to talk',
};

export default function CadenceReviewView({ userId }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('contacts')
      .select('id, name, type, cadence_days, cadence_suggested, cadence_suggested_reason')
      .eq('user_id', userId).not('cadence_suggested', 'is', null)
      .order('name', { ascending: true });
    if (error) { setMsg({ ok:false, t:'Could not load: ' + error.message }); setRows([]); return; }
    setRows(data || []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, accept) => {
    setRows(rs => rs.filter(r => r.id !== id));   // optimistic; a queue must feel fast
    const { error } = await supabase.rpc(
      accept ? 'accept_cadence_suggestion' : 'dismiss_cadence_suggestion', { p_contact_id: id });
    if (error) { setMsg({ ok:false, t:'Could not update: ' + error.message }); load(); }
  };

  const acceptAll = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('accept_all_cadence_suggestions');
    setBusy(false); setConfirmAll(false);
    if (error) { setMsg({ ok:false, t:'Could not apply: ' + error.message }); return; }
    setMsg({ ok:true, t:`${data?.applied ?? 0} cadence${(data?.applied ?? 0) === 1 ? '' : 's'} updated.` });
    load();
  };

  const letter = (r) => {
    const m = /DISC\s+([DISC])/i.exec(r.cadence_suggested_reason || '');
    return m ? m[1].toUpperCase() : null;
  };

  return (
    <div style={{ maxWidth:820, margin:'0 auto', padding:'0 4px 40px' }}>
      <div style={{ marginBottom:6 }}><span style={eyebrow}>Touch rhythm</span></div>
      <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:32, color:'var(--text-1)', margin:'0 0 6px' }}>Cadence Review</h1>
      <p style={{ color:'var(--text-2)', fontSize:14.5, margin:'0 0 18px', maxWidth:'62ch', lineHeight:1.5 }}>
        These contacts have a rhythm you set yourself, and a DISC read that suggests a different one.
        PrismOS never changes a number you chose {'\u2014'} so it asks instead. Keeping yours is a perfectly
        good answer.
      </p>

      {msg && (
        <div style={{ marginBottom:14, fontSize:13, padding:'10px 12px', borderRadius:9,
          background: msg.ok ? 'rgba(127,174,143,.10)' : 'rgba(224,121,79,.10)',
          border:`1px solid ${msg.ok ? '#7fae8f' : '#e0794f'}`, color:'var(--text-1)' }}>{msg.t}</div>
      )}

      {rows === null ? <div style={{ color:'var(--text-3)' }}>Loading{'\u2026'}</div>
        : rows.length === 0 ? (
          <div style={{ border:'1px dashed var(--border)', borderRadius:12, padding:28, textAlign:'center', color:'var(--text-3)', fontSize:14, lineHeight:1.6 }}>
            Nothing to review. Every contact either has the rhythm you chose, or one set from their DISC read.
          </div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:14 }}>
              <span style={{ fontSize:13.5, color:'var(--text-2)' }}>
                <b style={{ color:'var(--text-1)' }}>{rows.length}</b> waiting
              </span>
              <span style={{ flex:1 }} />
              {confirmAll ? (
                <>
                  <span style={{ fontSize:12.5, color:'var(--text-2)' }}>Replace all {rows.length} with the DISC rhythm?</span>
                  <button onClick={acceptAll} disabled={busy}
                    style={{ background:CHAMP, color:INK, border:'none', borderRadius:8, padding:'8px 15px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                    {busy ? 'Applying\u2026' : 'Yes, apply all'}
                  </button>
                  <button onClick={() => setConfirmAll(false)}
                    style={{ background:'transparent', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 12px', fontSize:13, cursor:'pointer' }}>Cancel</button>
                </>
              ) : (
                // Deliberately two taps: this rewrites numbers the user chose by
                // hand, and a single misfire would undo a lot of judgement.
                <button onClick={() => setConfirmAll(true)}
                  style={{ background:'transparent', border:`1px solid ${G}`, color:G, borderRadius:8, padding:'8px 15px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                  Apply all
                </button>
              )}
            </div>

            {rows.map(r => {
              const L = letter(r);
              const faster = r.cadence_suggested < r.cadence_days;
              return (
                <div key={r.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 13px', marginBottom:9 }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, fontSize:15, color:'var(--text-1)' }}>{r.name}</span>
                    {L && <span style={{ fontSize:10, fontWeight:800, color:G, border:`1px solid ${G}`, borderRadius:999, padding:'1px 7px' }}>{L}</span>}
                    {r.type && <span style={{ fontSize:11, color:'var(--text-3)' }}>{r.type}</span>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, margin:'9px 0 4px', flexWrap:'wrap' }}>
                    <span style={{ fontFamily:'Fraunces,serif', fontSize:20, color:'var(--text-3)' }}>{r.cadence_days}d</span>
                    <span style={{ color:'var(--text-3)', fontSize:15 }}>{'\u2192'}</span>
                    <span style={{ fontFamily:'Fraunces,serif', fontSize:22, color:CHAMP }}>{r.cadence_suggested}d</span>
                    <span style={{ fontSize:11.5, color: faster ? GREEN : 'var(--text-3)' }}>
                      {faster ? 'more often' : 'less often'}
                    </span>
                  </div>
                  <div style={{ fontSize:11.5, color:'var(--text-3)', lineHeight:1.5 }}>
                    {L && DISC_NOTE[L] ? DISC_NOTE[L] : (r.cadence_suggested_reason || '')}
                  </div>
                  <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                    <button onClick={() => act(r.id, true)}
                      style={{ flex:'1 1 130px', background:'rgba(203,163,92,.14)', border:`1px solid ${G}`, color:G, borderRadius:8, padding:'9px 12px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                      Use {r.cadence_suggested} days
                    </button>
                    <button onClick={() => act(r.id, false)}
                      style={{ flex:'1 1 110px', background:'transparent', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'9px 12px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                      Keep {r.cadence_days}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
    </div>
  );
}
