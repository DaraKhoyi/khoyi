import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';

// HOW PRISMOS SHOWS THINGS TO ME — the PRISM Edge, first part (4 Oct 2026).
//
// Dara: "Can you design the amount of stuff you show each user to be finetuned
// to their behavioral style?" Decision 9: it is A STARTING GUESS THE PERSON CAN
// SEE AND CHANGE, with no scientific claim. So these are ordinary settings; a
// guess (from the person's own style results) fills in only what they have not
// set by hand; the screen says where each value came from; and no score, label
// or reason about the person appears anywhere.
// my_presentation() / set_presentation() — supabase/sql/2026-10-04g_prism_edge_foundation.sql.
export default function PresentationPanel() {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_presentation');
    if (error || !data) { setMsg('Could not load these settings. Nothing has changed.'); return; }
    setP(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (key, value) => {
    if (busy) return; setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_presentation', { p_key: key, p_value: String(value) });
    setBusy(false);
    if (error || !data || data.ok === false) { setMsg('Could not save: ' + (error?.message || data?.error || 'try again') + '. Nothing has changed.'); return; }
    setP(data); setMsg('Saved. This one is yours now; PrismOS will not change it.');
    try { window.dispatchEvent(new Event('prism:presentation-changed')); } catch (_) {}
  };
  if (!p) return msg ? <div className="panel" style={{ marginBottom: 18 }}><div className="panel-body" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{msg}</div></div> : null;
  const mine = (k) => (p.hand_set || []).includes(k);
  const from = (k) => <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{mine(k) ? 'Your choice' : p.basis === 'style' ? 'A starting guess from your style results' : 'The standard setting'}</span>;
  const pill = (on) => ({ minWidth: 44, minHeight: 40, padding: '0 14px', borderRadius: 999, cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent)' : 'transparent', color: on ? '#1b180f' : 'var(--text-1)' });
  const row = { marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' };
  const title = { fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 };
  return (
    <div className="panel" data-testid="presentation-panel" style={{ marginBottom: 18 }}>
      <div className="panel-header"><h3>How PrismOS shows things to me</h3></div>
      <div className="panel-body">
        <p data-testid="presentation-basis" style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
          {p.basis === 'style'
            ? 'I started some of these from your style results. It is a guess about what you might find comfortable, not a finding. Change anything; your choice always wins.'
            : 'These are the standard settings. Change anything. If you take the optional style assessment, I will use it as a starting guess for the ones you have not set yourself.'}
        </p>

        <div style={row}>
          <div style={title}>Under “Needs you today”</div>
          {from('today_items')}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" data-testid="present-items-1" aria-pressed={p.today_items === 1} disabled={busy} style={pill(p.today_items === 1)} onClick={() => save('today_items', 1)}>One at a time</button>
            <button type="button" data-testid="present-items-3" aria-pressed={p.today_items === 3} disabled={busy} style={pill(p.today_items === 3)} onClick={() => save('today_items', 3)}>Three</button>
          </div>
        </div>

        <div style={row}>
          <div style={title}>Goals a day</div>
          {from('daily_goal_count')}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {[1, 2, 3, 4, 5].map(k => <button key={k} type="button" aria-pressed={p.daily_goal_count === k} aria-label={k + ' a day'} disabled={busy} style={pill(p.daily_goal_count === k)} onClick={() => save('daily_goal_count', k)}>{k}</button>)}
          </div>
        </div>

        <div style={row}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={title}>Offer to pick tomorrow’s goals in the afternoon</div>
              {from('evening_prompt')}
            </div>
            <button onClick={() => save('evening_prompt', !p.evening_prompt)} role="switch" aria-checked={!!p.evening_prompt} aria-label="Offer to pick tomorrow's goals in the afternoon" data-testid="present-evening" disabled={busy}
              style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: busy ? 'wait' : 'pointer', background: p.evening_prompt ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 3, left: p.evening_prompt ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
        </div>

        <div style={{ ...row, fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
          How often PrismOS explains things as you work is under “Learning pace”. When to notify you and how much it does on its own are in the two panels above.
        </div>
        {msg && <div data-testid="presentation-msg" style={{ marginTop: 12, fontSize: 12, color: msg.startsWith('Saved') ? 'var(--text-2)' : 'var(--red)' }}>{msg}</div>}
      </div>
    </div>
  );
}
