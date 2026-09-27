import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { notify } from '../notify';

// Today's calls: the five people most due a call, chosen once a day
// (who_to_call_today), counting down as they are worked. Moved out of
// TodayView.jsx on 27 Sep when "Later…" (postpone + replace) was added.

// ── Who Should I Call Today ───────────────────────────────────────────────────
// 80% of deals need 5+ touches; persistence is the differentiator. This turns
// "I don't know who to call" into a 10-minute morning habit: the 5 highest-value
// people to reach, each with a DISC-matched opener, one tap to call, auto-logged.
export default function CallList() {
  const [people, setPeople] = useState(null);
  const [open, setOpen] = useState(null);   // contact_id whose opener is expanded
  const [collapsed, setCollapsed] = useState(false);
  // Progress, and a way to ask for more. The list counts DOWN as he works — an
  // automatic top-up meant finishing a call silently produced another, so the
  // work never visibly ended. Refilling is his choice.
  const [doneToday, setDoneToday] = useState(0);
  const [refilling, setRefilling] = useState(false);
  // LATER. Dara: "postpone these calls for a given number of days because of
  // something I know, and replace the contact with another call" — without
  // teaching the app anything he did not mean. snooze_call holds the person off
  // the list until the date, brings his note back with them, and puts the next
  // person due in the slot. Nothing about the person's priority changes.
  const [laterFor, setLaterFor] = useState(null);     // contact id with the picker open
  const [laterDays, setLaterDays] = useState(3);
  const [laterNote, setLaterNote] = useState('');
  const [laterBusy, setLaterBusy] = useState(false);

  const load = React.useCallback(async () => {
    try { const { data } = await supabase.rpc('who_to_call_today', { p_limit: 5 }); setPeople(Array.isArray(data) ? data : []); }
    catch (_) { setPeople([]); }
    try {
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const { count } = await supabase.from('daily_call_list')
        .select('contact_id', { count: 'exact', head: true })
        .eq('day', day).not('done_at', 'is', null).neq('outcome', 'postponed');
      setDoneToday(count || 0);
    } catch (_) { /* the list still works without the tally */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Coming back from a contact record. If a call, text or email actually went
  // out while you were in there, the person is done for today — you should not
  // have to tell the app something it can already see. outreach_since checks the
  // phone line, the texts and the mailbox, so it counts real outreach rather
  // than merely having opened the record.
  useEffect(() => {
    let alive = true;
    const r = (typeof window !== 'undefined') ? window.__returnedFrom : null;
    if (!r || !r.contactId || !r.at) return;
    try { window.__returnedFrom = null; } catch (_) {}
    (async () => {
      try {
        const { data } = await supabase.rpc('outreach_since', { p_contact: r.contactId, p_since: r.at });
        if (!alive || !data || !data.ok) return;
        const { error } = await supabase.rpc('log_call_list', { p_contact: r.contactId, p_outcome: 'called' });
        if (error) return;                       // leave it on the list rather than lie
        setPeople(list => (list || []).filter(x => x.id !== r.contactId));
        const kind = data.kind === 'call' ? 'Call' : data.kind === 'text' ? 'Text' : data.kind === 'email' ? 'Email' : 'Outreach';
        try { window.__notify && window.__notify(kind + ' logged \u2014 ticked off today\u2019s list.', 'success'); } catch (_) {}
      } catch (_) { /* never break Today over a bookkeeping nicety */ }
    })();
    return () => { alive = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (p) => {
    try { await supabase.rpc('log_call_list', { p_contact: p.id, p_outcome: 'called' }); } catch (_) {}
    try { window.location.href = 'tel:' + String(p.phone).replace(/[^\d+]/g, ''); } catch (_) {}
    setPeople(list => (list || []).filter(x => x.id !== p.id));   // move it off today's list
    setDoneToday(n => n + 1);
  };
  const skip = async (p) => {
    try { await supabase.rpc('log_call_list', { p_contact: p.id, p_outcome: 'skipped' }); } catch (_) {}
    setPeople(list => (list || []).filter(x => x.id !== p.id));
    setDoneToday(n => n + 1);
  };
  const postpone = async (p) => {
    const days = Math.max(1, Math.min(365, parseInt(laterDays, 10) || 0));
    setLaterBusy(true);
    const { data, error } = await supabase.rpc('snooze_call', { p_contact: p.id, p_days: days, p_note: laterNote || null });
    setLaterBusy(false);
    if (error) { if (window.__notify) window.__notify("Couldn't postpone: " + error.message, 'error'); return; }
    setLaterFor(null); setLaterNote('');
    await load();
    const until = data && data.until ? new Date(data.until + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    const first = (p.name || '').trim().split(/\s+/)[0] || 'them';
    const msg = 'Postponed ' + first + ' until ' + until
      + (data && data.replacement_name ? ' \u2014 ' + data.replacement_name + ' is in their place.' : ' \u2014 nobody else is due right now.');
    notify(msg, 'success', { label: 'Undo', onClick: async () => {
      await supabase.rpc('unsnooze_call', { p_contact: p.id, p_replacement: (data && data.replacement_id) || null });
      await load();
    } });
  };
  const refill = async () => {
    setRefilling(true);
    const { data, error } = await supabase.rpc('refill_call_list', { p_limit: 5 });
    if (error) { if (window.__notify) window.__notify("Couldn't add more: " + error.message, 'error'); }
    else if (data && data.added === 0 && window.__notify) window.__notify('Nobody else is due a call right now.', 'info');
    await load();
    setRefilling(false);
  };

  if (!people) return null;
  if (people.length === 0 && doneToday === 0) return null;
  const DISC = { D: '#ef4444', I: '#EBCB82', S: '#22c55e', C: '#5aa9e6' };
  return (
    <div className="fade-up" style={{ marginBottom: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 12 }}>
        <span style={{ fontSize: 15 }}>📞</span>
        <span className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase' }}>{people.length === 0 ? 'Calls done for today'
            : people.length === 1 ? 'One person to call today'
            : 'Your ' + people.length + ' to call today'}</span>
        {doneToday > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{doneToday + ' done'}</span>
        )}
        <button onClick={() => setCollapsed(v => !v)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer' }}>{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {!collapsed && people.map(p => {
        const first = (p.name || '').trim().split(/\s+/)[0];
        const isOpen = open === p.id;
        return (
          <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {p.disc ? <span title={'DISC ' + p.disc} style={{ width: 20, height: 20, borderRadius: 6, flex: 'none', background: (DISC[p.disc] || 'var(--text-3)') + '22', border: '1px solid ' + (DISC[p.disc] || 'var(--text-3)'), color: DISC[p.disc] || 'var(--text-2)', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.disc}</span>
                : <span style={{ width: 20, height: 20, flex: 'none' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <button type="button"
                  onClick={() => { try { window.__openContactAndReturn && window.__openContactAndReturn(p.id); } catch (_) {} }}
                  title={'Open ' + (p.name || 'contact') + '\u2019s record'}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecorationLine: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' }}>
                  {p.name}
                </button>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.reason}</div>
              </div>
              <button onClick={() => call(p)} style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 9, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flex: 'none' }}>Call</button>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6, marginLeft: 29 }}>
              <button onClick={() => setOpen(isOpen ? null : p.id)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}>{isOpen ? 'Hide opener' : 'What to say'}</button>
              <button onClick={() => { setLaterFor(laterFor === p.id ? null : p.id); setLaterDays(3); setLaterNote(''); }}
                title="Hold this call for a few days and get another name in its place"
                style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}>Later…</button>
              <button onClick={() => skip(p)} title="Off today's list only — they can come back tomorrow. Teaches the app nothing."
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', padding: 0 }}>Not today</button>
            </div>
            {laterFor === p.id && (
              <div style={{ marginTop: 8, marginLeft: 29, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid rgba(197,169,94,.5)', borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 7 }}>
                  {'Call ' + ((p.name || '').trim().split(/\s+/)[0] || 'them') + ' again in'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {[[1, 'Tomorrow'], [3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']].map(([d, label]) => (
                    <button key={d} type="button" onClick={() => setLaterDays(d)}
                      style={{ minHeight: 36, padding: '0 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: '1px solid ' + (Number(laterDays) === d ? '#C5A95E' : 'var(--border)'),
                        background: Number(laterDays) === d ? 'rgba(197,169,94,.18)' : 'transparent',
                        color: Number(laterDays) === d ? '#EBCB82' : 'var(--text-2)' }}>{label}</button>
                  ))}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
                    <input type="number" min={1} max={365} inputMode="numeric" value={laterDays}
                      onChange={(e) => setLaterDays(e.target.value)}
                      style={{ width: 56, minHeight: 36, borderRadius: 8, padding: '0 8px', background: 'var(--bg-card)',
                        border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 13 }} />
                    days
                  </label>
                </div>
                <input type="text" value={laterNote} onChange={(e) => setLaterNote(e.target.value)} maxLength={140}
                  placeholder="Why? (optional — only you see it)"
                  style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, minHeight: 38, borderRadius: 8, padding: '0 10px',
                    background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 12.5 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" disabled={laterBusy} onClick={() => postpone(p)}
                    style={{ minHeight: 40, padding: '0 16px', borderRadius: 9, border: 'none', background: '#EBCB82', color: '#100D09', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                    {laterBusy ? 'Postponing\u2026' : 'Postpone & add someone else'}
                  </button>
                  <button type="button" onClick={() => setLaterFor(null)}
                    style={{ minHeight: 40, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {isOpen && (
              <div style={{ marginTop: 8, marginLeft: 29, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, fontStyle: 'italic' }}>
                “{p.opener}”
                {p.disc && <div style={{ fontStyle: 'normal', fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Tuned to a {p.disc}-style personality — {p.disc === 'D' ? 'direct and brief' : p.disc === 'I' ? 'warm and upbeat' : p.disc === 'S' ? 'personal and unhurried' : 'specific and factual'}.</div>}
              </div>
            )}
          </div>
        );
      })}
      {/* HIS CHOICE, NOT THE APP'S. The list counts down to nothing so finishing
          feels like finishing; if there is time left, he asks for more. */}
      {!collapsed && people.length < 5 && (
        <button type="button" disabled={refilling} onClick={refill}
          style={{ width: '100%', marginTop: people.length ? 10 : 2, minHeight: 44, borderRadius: 10, cursor: 'pointer',
            background: 'transparent', border: '1px solid rgba(197,169,94,.5)', color: '#C5A95E', fontSize: 13, fontWeight: 800 }}>
          {refilling ? 'Finding more\u2026' : people.length === 0 ? 'Add 5 more calls' : 'Fill back to 5'}
        </button>
      )}
      {!collapsed && people.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 8, textAlign: 'center' }}>
          That is everyone you set out to call today.
        </div>
      )}
    </div>
  );
}

