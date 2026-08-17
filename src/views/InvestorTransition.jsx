// InvestorTransition — the office manager's review desk.
//
// Dara's rule: the BROKERAGE tells the investor, never the departing agent and
// never the incoming one. So this screen is brokerage-staff only, and the letters
// go out under the company's name.
//
// BULK SEND, BUT ONLY OF LETTERS MARKED READY — Dara's call, and the compromise
// that matters: sending twenty one at a time guarantees the twentieth gets no
// attention, but a "send all" that includes drafts nobody opened is exactly the
// failure this whole design is against. A letter is only sendable once a human has
// opened it and pressed Approve, and the send button counts them so it is obvious
// how many are actually going.
//
// THIN HISTORY IS SORTED FIRST AND CANNOT BE BULK-SENT. If we have never actually
// put a property in front of someone, asking them to re-opt-in on the strength of
// nothing invites a no. Those get a phone call, and the screen says so.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 11 };
const btn = { background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const ghost = { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 13px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };

const money = (v) => (v || v === 0) ? '$' + Number(v).toLocaleString('en-US') : '';

export default function InvestorTransition({ userId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});      // id -> expanded
  const [edit, setEdit] = useState({});      // id -> { subject, body }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('investor_transition_queue');
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (m, k = 'info') => { if (window.__notify) window.__notify(m, k); };

  const draft = async (ids) => {
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/investor-transition-draft', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice_ids: ids, user_id: userId }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) say(d.error || 'Could not write the drafts.', 'error');
      else say(`Wrote ${d.drafted} letter${d.drafted === 1 ? '' : 's'}.`);
      await load();
    } catch (e) { say('Could not write the drafts: ' + (e.message || e), 'error'); }
    setBusy(false);
  };

  const approve = async (r) => {
    const e = edit[r.id] || { subject: r.draft_subject, body: r.draft_body };
    if (!e.body || !e.body.trim()) { say('There is no letter to approve yet.', 'error'); return; }
    const { data, error } = await supabase.rpc('investor_transition_save', { p_id: r.id, p_subject: e.subject || '', p_body: e.body });
    if (error || (data && data.ok === false)) { say((data && data.error) || error.message, 'error'); return; }
    say('Approved — it will go with the next send.');
    load();
  };

  const skip = async (r) => {
    const reason = window.prompt(`Don't email ${r.buyer?.name}. Why? (kept on the record)`, r.thin_history ? 'Calling instead' : '');
    if (reason === null) return;
    await supabase.rpc('investor_transition_skip', { p_id: r.id, p_reason: reason || 'skipped' });
    load();
  };

  const ready = rows.filter(r => r.status === 'ready' && !r.thin_history);
  const drafts = rows.filter(r => r.status === 'draft');
  const thin = rows.filter(r => r.thin_history && r.status !== 'sent');
  const sent = rows.filter(r => r.status === 'sent');

  const sendReady = async () => {
    if (!ready.length) return;
    if (!window.confirm(`Send ${ready.length} letter${ready.length === 1 ? '' : 's'} now, from the brokerage?\n\nOnly letters you have approved are included.`)) return;
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/investor-transition-send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice_ids: ready.map(r => r.id) }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) say(d.error || 'Send failed.', 'error');
      else say(`Sent ${d.sent} of ${ready.length}.`);
      await load();
    } catch (e) { say('Send failed: ' + (e.message || e), 'error'); }
    setBusy(false);
  };

  const stat = (r) => {
    const s = r.stats || {};
    const bits = [];
    if (Number(s.presented) > 0) bits.push(`${s.presented} shown`);
    if (Number(s.interested) > 0) bits.push(`${s.interested} interested`);
    if (Number(s.matched) > 0) bits.push(`${s.matched} matched`);
    if (Number(s.days_on_list) >= 30) bits.push(`${Math.round(s.days_on_list / 30)} mo on list`);
    return bits.length ? bits.join(' · ') : 'no activity on record';
  };

  const box = (r) => {
    const e = edit[r.id] || { subject: r.draft_subject || '', body: r.draft_body || '' };
    const isOpen = !!open[r.id];
    return (
      <div key={r.id} style={{ ...card, borderColor: r.thin_history ? 'rgba(203,163,92,.45)' : 'var(--border)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-1)', flex: '1 1 auto', minWidth: 0 }}>
            {r.buyer?.name || '(no name)'}
          </span>
          {r.status === 'ready' && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#7fbf8f' }}>APPROVED</span>}
          {r.status === 'sent' && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)' }}>SENT</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
          {r.buyer?.email || 'no email on file'} · {stat(r)}
        </div>
        {r.thin_history && (
          <div style={{ fontSize: 12.5, color: CHAMP, marginTop: 7, lineHeight: 1.5 }}>
            We have never actually shown this investor a property. Asking them to re-confirm on the strength of nothing invites a no — call them instead.
          </div>
        )}

        {isOpen && (
          <div style={{ marginTop: 11 }}>
            {!r.draft_body ? (
              <button onClick={() => draft([r.id])} disabled={busy} style={btn}>Write the letter</button>
            ) : (
              <>
                <input value={e.subject} onChange={ev => setEdit({ ...edit, [r.id]: { ...e, subject: ev.target.value } })}
                  placeholder="Subject"
                  style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9,
                    color: 'var(--text-1)', padding: '9px 11px', fontSize: 14, fontFamily: 'inherit', marginBottom: 8 }} />
                <textarea value={e.body} onChange={ev => setEdit({ ...edit, [r.id]: { ...e, body: ev.target.value } })}
                  rows={12}
                  style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9,
                    color: 'var(--text-1)', padding: '10px 11px', fontSize: 13.5, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' }} />
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '6px 0 10px', lineHeight: 1.5 }}>
                  The greeting, the two answer buttons and the brokerage sign-off are added when it sends — don't write them here.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => approve(r)} disabled={busy} style={btn}>Approve</button>
                  <button onClick={() => draft([r.id])} disabled={busy} style={ghost}>Rewrite</button>
                  <button onClick={() => skip(r)} style={ghost}>Don't email</button>
                </div>
              </>
            )}
          </div>
        )}

        <button onClick={() => setOpen({ ...open, [r.id]: !isOpen })}
          style={{ ...ghost, marginTop: 10 }}>{isOpen ? 'Close' : (r.draft_body ? 'Read the letter' : 'Open')}</button>
      </div>
    );
  };

  return (
    <div className="ww-itn" style={{ padding: '18px 16px 90px' }}>
      <style>{`.ww-itn{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%),#100D09;min-height:100%}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Agent departure</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>Tell their investors.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.55 }}>
        One letter per investor, from the brokerage — not from the agent who left and not from the one taking over. Read each one before it goes; the investor answers with a tap.
      </div>

      {loading && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>}

      {!loading && !rows.length && (
        <div style={card}>
          <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 700 }}>Nothing waiting.</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.55 }}>
            When an agent is released, every investor they brought in shows up here with a letter ready to review.
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div style={secHead}>Needs a letter ({drafts.length})</div>
          <button onClick={() => draft(drafts.map(r => r.id))} disabled={busy} style={{ ...btn, marginBottom: 11 }}>
            Write all {drafts.length}
          </button>
          {drafts.map(box)}
        </>
      )}

      {ready.length > 0 && (
        <>
          <div style={secHead}>Approved and ready ({ready.length})</div>
          <button onClick={sendReady} disabled={busy} style={{ ...btn, marginBottom: 11 }}>
            Send {ready.length} letter{ready.length === 1 ? '' : 's'} from the brokerage
          </button>
          {ready.map(box)}
        </>
      )}

      {thin.length > 0 && (
        <>
          <div style={secHead}>Call these, don't email ({thin.length})</div>
          {thin.map(box)}
        </>
      )}

      {sent.length > 0 && (
        <>
          <div style={secHead}>Sent, waiting on an answer ({sent.length})</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 9, lineHeight: 1.5 }}>
            No answer isn't a no — they stay on the list. Worth a call if a week goes by.
          </div>
          {sent.map(box)}
        </>
      )}
    </div>
  );
}

const secHead = { fontSize: 12.5, color: '#8C8475', margin: '20px 0 7px', textTransform: 'uppercase', letterSpacing: '.08em' };
