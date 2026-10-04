import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../dataService';

// HOW FAR SHOULD THAT GO? (4 Oct 2026)
//
// Dara, 2 Oct: "I want to train my AI to give me relevant items." A correction
// with no scope teaches the wrong thing: a learning system that cannot be told
// "just this once" memorises a one-off as a rule. So after "Not a thing" there
// is ONE optional question, and after "Not today" one optional reason. Ignore
// either and nothing changes from how it worked before.
//
// Opened by a window event so any screen can ask without owning the sheet:
//   prism:scope-ask { kind: 'not_a_thing', commitmentId, contactId, name }
//   prism:scope-ask { kind: 'not_today', ref }
// Every button says what will happen; the line after says what did.
const REASONS = [['wrong_time', 'Wrong time'], ['wrong_person', 'Wrong person'], ['not_mine', 'Not mine to do'], ['too_small', 'Too small to track']];

export default function ScopeAsk({ userId }) {
  const [ask, setAsk] = useState(null);
  const [said, setSaid] = useState('');
  const timer = useRef(null);
  useEffect(() => {
    const on = (e) => { clearTimeout(timer.current); setSaid(''); setAsk(e.detail || null); timer.current = setTimeout(() => setAsk(null), 14000); };
    window.addEventListener('prism:scope-ask', on);
    return () => { window.removeEventListener('prism:scope-ask', on); clearTimeout(timer.current); };
  }, []);
  if (!ask || !userId) return null;
  const done = (msg) => { clearTimeout(timer.current); setSaid(msg); timer.current = setTimeout(() => { setAsk(null); setSaid(''); }, 5000); };
  const fail = (error) => { if (window.__notify) window.__notify('Could not save that: ' + (error.message || error), 'error'); };
  const first = String(ask.name || '').trim().split(/\s+/)[0];

  const justThis = async () => {
    const { error } = await supabase.from('commitments').update({ not_a_thing_at: null }).eq('id', ask.commitmentId);
    if (error) return fail(error);
    done('Kept to this one. Nothing was learned from it.');
  };
  const thisCaller = async () => {
    const { error } = await supabase.from('call_reader_mutes').upsert({ user_id: userId, contact_id: ask.contactId }, { onConflict: 'user_id,contact_id' });
    if (error) return fail(error);
    const { error: e2 } = await supabase.from('commitments').update({ not_a_thing_at: null }).eq('id', ask.commitmentId);
    if (e2) return fail(e2);
    done(`I will stop suggesting follow-ups from calls with ${ask.name || 'this person'}. You can undo this in Settings, under What PrismOS has learned.`);
  };
  const reason = async (r) => {
    const { error } = await supabase.from('chief_snoozes').update({ reason: r }).eq('user_id', userId).eq('source_ref', ask.ref);
    if (error) return fail(error);
    done(r === 'not_mine' || r === 'too_small' ? 'Noted. I will weigh that before raising things like it.' : 'Noted.');
  };
  const btn = { minHeight: 44, padding: '0 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
  return (
    <div data-testid="scope-ask" role="dialog" aria-label="How far should that go?"
      style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', zIndex: 60, maxWidth: 560, margin: '0 auto',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
      {said ? <div data-testid="scope-said" style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5 }}>{said}</div> : ask.kind === 'not_today' ? (
        <>
          <div style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 10 }}>Set aside until tomorrow. Want to say why? <span style={{ color: 'var(--text-3)' }}>It is optional.</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REASONS.map(([k, label]) => <button key={k} type="button" data-testid={'reason-' + k} style={btn} onClick={() => reason(k)}>{label}</button>)}
            <button type="button" style={{ ...btn, border: 'none', color: 'var(--text-3)' }} onClick={() => setAsk(null)}>Skip</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 10 }}>Not a thing. How far should that go?</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="scope-just" style={btn} onClick={justThis}>Just this one</button>
            {ask.contactId && <button type="button" data-testid="scope-caller" style={btn} onClick={thisCaller}>Stop suggesting from calls with {first || 'them'}</button>}
            <button type="button" data-testid="scope-like" style={{ ...btn, borderColor: 'var(--accent)' }} onClick={() => done('Learned. I will leave out things like this.')}>Everything like this</button>
          </div>
        </>
      )}
    </div>
  );
}
