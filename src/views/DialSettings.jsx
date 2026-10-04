import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';

// THE DIAL (4 Oct 2026) — how much PrismOS does on its own.
//
// Dara: "I do want to be able to throttle what is being done for me."
// The rule this screen is built on: a level is only offered where a job obeys
// it. my_dial() / set_dial() / set_dial_paused() and the jobs that ask
// dial_level() are in supabase/sql/2026-10-04c_the_dial.sql. The old picker
// promised four levels and controlled nothing; it was removed the same day.
const CATS = {
  call_followups: { title: 'Follow-ups heard on my calls',
    levels: { off: ['Off', 'Do not look for them.'], suggest: ['Suggest', 'Show me each one, to keep or skip.'] },
    note: 'Calls made while this is off are not gone back over later.' },
  tidy_followups: { title: 'Suggestions I have not answered',
    levels: { off: ['Off', 'Leave them until I decide.'], tell: ['Do and tell', 'Ask me the day before, then set them aside.'], quiet: ['Do quietly', 'Set them aside without asking.'] },
    note: 'Whatever is set aside is listed under Done for you, and can be picked back up.' },
  lead_drafts: { title: 'Replies to new leads',
    levels: { off: ['Off', 'Show me the lead. I will write the reply.'], suggest: ['Suggest', 'Draft a reply in my voice and wait for me to send it.'] } },
  calendar: { title: 'My tasks on my calendar',
    levels: { off: ['Off', 'Leave my calendar alone.'], tell: ['Do and tell', 'Place timed tasks in open time, where I can see and move them.'] } },
  calls_personal: { title: 'Personal plans heard on calls',
    levels: { off: ['Off', 'Work only. Family and personal plans stay private conversation.'], suggest: ['Suggest', 'Include family and personal plans.'] },
    note: 'Anything you add to your list yourself is always welcome, whatever it is about.' },
};
// The master control moves only the two things PrismOS does without asking.
const PRESETS = [
  { key: 'hands_on', label: 'Hands-on', why: 'Nothing is set aside or scheduled for me.', set: { tidy_followups: 'off', calendar: 'off' } },
  { key: 'balanced', label: 'Balanced', why: 'Tidy up after asking me. Leave my calendar alone.', set: { tidy_followups: 'tell', calendar: 'off' } },
  { key: 'hands_off', label: 'Hands-off', why: 'Tidy up quietly and place tasks on my calendar.', set: { tidy_followups: 'quiet', calendar: 'tell' } },
];
const LOCKED = [
  'Nothing written by AI is sent until you tap Send.',
  'Mail from people you know always reaches This week in your Inbox.',
  'Contract deadlines are always shown.',
];

export default function DialSettings({ userId, setUserSettings }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_dial');
    if (error || !data) { setMsg('Could not load these settings. Nothing has changed.'); return; }
    setD(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const after = async (data, error) => {
    setBusy(false);
    if (error || !data || data.ok === false) { setMsg('Could not save: ' + (error?.message || data?.error || 'try again') + '. Nothing has changed.'); return false; }
    setD(data); setMsg('Saved.');
    // The rest of the app reads user_settings; keep its copy in step.
    try { const { data: us } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(); if (us) setUserSettings?.(us); } catch (_) {}
    return true;
  };
  const choose = async (cat, level) => {
    if (busy) return; setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_dial', { p_cat: cat, p_level: level });
    const ok = await after(data, error);
    if (ok && cat === 'calendar') { try { await supabase.functions.invoke('task-autoschedule', { body: {} }); } catch (_) {} }
  };
  const preset = async (p) => {
    if (busy) return; setBusy(true); setMsg('');
    let last = null;
    for (const [cat, level] of Object.entries(p.set)) {
      const { data, error } = await supabase.rpc('set_dial', { p_cat: cat, p_level: level });
      if (error || !data || data.ok === false) { await after(data, error); return; }
      last = data;
    }
    await after(last, null);
    try { await supabase.functions.invoke('task-autoschedule', { body: {} }); } catch (_) {}
  };
  const pause = async () => {
    if (busy) return; setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_dial_paused', { p_paused: !d.paused });
    await after(data, error);
  };
  if (!d) return msg ? <div className="panel" style={{ marginBottom: 18 }}><div className="panel-body" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{msg}</div></div> : null;
  const levelOf = Object.fromEntries((d.items || []).map(i => [i.cat, i.level]));
  const activePreset = PRESETS.find(p => Object.entries(p.set).every(([c, l]) => levelOf[c] === l));
  const pill = (on) => ({ minHeight: 40, padding: '0 14px', borderRadius: 999, cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent)' : 'transparent', color: on ? '#1b180f' : 'var(--text-1)' });
  return (
    <div className="panel" data-testid="the-dial" style={{ marginBottom: 18 }}>
      <div className="panel-header"><h3>How much PrismOS does for me</h3></div>
      <div className="panel-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
            <strong style={{ color: 'var(--text-1)' }}>Pause everything.</strong> PrismOS does nothing on its own until you turn this off. Your mail, calls and leads still arrive.
          </p>
          <button onClick={pause} role="switch" aria-checked={!!d.paused} aria-label="Pause everything" data-testid="dial-pause" disabled={busy}
            style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: busy ? 'wait' : 'pointer', background: d.paused ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background .15s' }}>
            <span style={{ position: 'absolute', top: 3, left: d.paused ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </button>
        </div>
        {d.paused && <div data-testid="dial-paused-note" style={{ marginTop: 10, fontSize: 12.5, color: 'var(--accent)' }}>Paused. Your choices below are kept and come back when you turn this off.</div>}

        <div style={{ marginTop: 18, opacity: d.paused ? 0.55 : 1 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}>One choice for the two things PrismOS does without asking: tidying suggestions you have not answered, and placing tasks on your calendar.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRESETS.map(p => <button key={p.key} type="button" data-testid={'dial-preset-' + p.key} disabled={busy} onClick={() => preset(p)} style={pill(activePreset?.key === p.key)}>{p.label}</button>)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{activePreset ? activePreset.why : 'Your own mix, set below.'}</div>

          {(d.items || []).map(it => {
            const c = CATS[it.cat]; if (!c) return null;
            return (
              <div key={it.cat} data-testid={'dial-' + it.cat} style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>{c.title}</div>
                {(it.allowed || []).map(l => {
                  const [name, what] = c.levels[l] || [l, ''];
                  const on = it.level === l;
                  return (
                    <button key={l} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => !on && choose(it.cat, l)}
                      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 0', minHeight: 44, cursor: busy ? 'wait' : 'pointer' }}>
                      <span style={{ flexShrink: 0, width: 18, height: 18, marginTop: 1, borderRadius: '50%', border: '2px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent)' : 'transparent' }} />
                      <span style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}><strong>{name}.</strong> <span style={{ color: 'var(--text-2)' }}>{what}</span></span>
                    </button>
                  );
                })}
                {c.note && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{c.note}</div>}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6 }}>Always, at every setting</div>
          {LOCKED.map(t => <div key={t} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{t}</div>)}
        </div>
        {msg && <div data-testid="dial-msg" style={{ marginTop: 12, fontSize: 12, color: msg.startsWith('Saved') ? 'var(--text-2)' : 'var(--red)' }}>{msg}</div>}
      </div>
    </div>
  );
}
