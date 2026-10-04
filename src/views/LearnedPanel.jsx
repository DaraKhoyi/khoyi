import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { confirmDialog } from '../notify';

// WHAT PRISMOS HAS LEARNED ABOUT HOW I WORK (4 Oct 2026).
//
// Dara: "be able to train our AIs to behave the way we want them to behave so we
// feel the control." Control over a learning system means being able to READ
// what it learned, FORGET one line, and START OVER. Until today the lessons
// were real (they are fed to the model that reads this person's calls) and
// invisible. my_learned() / forget_learned() / reset_learned() —
// supabase/sql/2026-10-04e_training_and_triage.sql.
const when = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }) : '';
const WHY = { wrong_time: 'wrong time', wrong_person: 'wrong person', not_mine: 'not mine to do', too_small: 'too small to track' };
const SECTIONS = [
  ['not_things', 'Things I should not have raised', 'You marked these “Not a thing”. I leave out things like them when I read your calls.', (r) => r.what],
  ['brought_back', 'Things you brought back', 'I had left these out or set them aside, and you said they mattered. I raise things like them.', (r) => r.what],
  ['callers', 'Callers I take no suggestions from', 'You asked me to stop suggesting follow-ups from calls with these people.', (r) => r.what],
  ['put_off', 'Why you put things off', 'A reason you gave with “Not today”. “Not mine” and “too small” make me slower to raise things like them.', (r) => `${r.what} — ${WHY[r.reason] || r.reason}`],
  ['senders', 'Email senders', 'Whose messages count as a new lead, and whose do not.', (r) => `${r.what} — ${r.kind === 'lead_ok' ? 'a real source of leads' : 'not a lead'}`],
];

export default function LearnedPanel() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(6);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_learned');
    if (error || !data) { setMsg('Could not load this just now. Nothing has changed.'); setD({}); return; }
    setD(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const forget = async (r) => {
    const { data, error } = await supabase.rpc('forget_learned', { p_src: r.src, p_id: r.id });
    if (error || data === false) { setMsg('Could not forget that: ' + (error?.message || 'try again')); return; }
    setMsg('Forgotten.'); load();
  };
  const reset = async (key, title) => {
    if (!await confirmDialog(key === 'all' ? 'Forget everything PrismOS has learned about how you work? This cannot be undone.' : `Forget everything under “${title}”? This cannot be undone.`)) return;
    const { data, error } = await supabase.rpc('reset_learned', { p_section: key });
    if (error || data === false) { setMsg('Could not start over: ' + (error?.message || 'try again')); return; }
    setMsg('Done. Starting fresh.'); load();
  };
  if (!d) return null;
  const any = SECTIONS.some(([k]) => (d[k] || []).length);
  const link = { background: 'none', border: 'none', padding: 0, minHeight: 44, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' };
  return (
    <div className="panel" data-testid="learned-panel" style={{ marginBottom: 18 }}>
      <div className="panel-header"><h3>What PrismOS has learned about how I work</h3></div>
      <div className="panel-body">
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: '0 0 6px' }}>Everything here came from something you did. Forget any line and I stop using it; the item itself is not changed.</p>
        {!any && <div data-testid="learned-empty" style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>Nothing yet. It fills in as you correct me.</div>}
        {SECTIONS.map(([key, title, why, line]) => {
          const rows = d[key] || [];
          if (!rows.length) return null;
          const isOpen = open === key;
          return (
            <div key={key} data-testid={'learned-' + key} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
              <button type="button" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : key); setShown(6); }} style={{ ...link, color: 'var(--text-1)', fontSize: 14, fontWeight: 700, width: '100%' }}>{title} {isOpen ? '▴' : '▾'}</button>
              {isOpen && <>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 6 }}>{why}</div>
                {rows.slice(0, shown).map((r) => (
                  <div key={r.src + r.id} data-testid="learned-line" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{line(r)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{when(r.at)}</div>
                    </div>
                    <button type="button" data-testid="learned-forget" onClick={() => forget(r)} style={{ ...link, flexShrink: 0 }}>Forget</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  {rows.length > shown && <button type="button" onClick={() => setShown(n => n + 12)} style={link}>Show more</button>}
                  <button type="button" onClick={() => reset(key, title)} style={{ ...link, color: 'var(--text-3)' }}>Forget all of these</button>
                </div>
              </>}
            </div>
          );
        })}
        {(d.brokerage_senders || []).length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
            <button type="button" aria-expanded={open === 'brokerage'} onClick={() => setOpen(open === 'brokerage' ? null : 'brokerage')} style={{ ...link, color: 'var(--text-1)', fontSize: 14, fontWeight: 700, width: '100%' }}>Set for the whole brokerage {open === 'brokerage' ? '▴' : '▾'}</button>
            {open === 'brokerage' && <>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 6 }}>Messages from these senders are not treated as leads for anyone at the brokerage. Only the broker can change this list.</div>
              {(d.brokerage_senders || []).map((s) => <div key={s} style={{ fontSize: 13.5, color: 'var(--text-1)', padding: '4px 0', overflowWrap: 'anywhere' }}>{s}</div>)}
            </>}
          </div>
        )}
        {any && <div style={{ marginTop: 14 }}><button type="button" data-testid="learned-reset" onClick={() => reset('all')} style={{ ...link, color: 'var(--text-3)' }}>Start over: forget everything above</button></div>}
        {msg && <div data-testid="learned-msg" style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>{msg}</div>}
      </div>
    </div>
  );
}
