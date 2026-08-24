import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { SenderLink, EmailDetailPanel } from './EmailShared';

// ── 5-Minute Lead Concierge ──────────────────────────────────────────────────
// A new lead texted, called or emailed; PrismOS already drafted the first reply
// in the agent's voice. This banner is the send-it-now moment: edit if you want,
// then one tap fires a real SMS or email. Speed to lead is the biggest lever
// there is.
//
// The card used to show a 160-character slice of what they wrote, a name that
// was plain text, and no way to clear the original out of the inbox. All three
// were fixable from data the RPC was ALREADY returning — lead_concierge_pending
// hands back contact_id, thread_id, full_body and subject, and nothing rendered
// them. Built-but-invisible, the same failure mode as property_notes.

// Long inbound messages get folded rather than truncated. A 2,700-character
// email cut at 160 characters is not a preview, it is a guess — and deciding
// whether to reply is exactly when you need the rest of the sentence.
function InboundMessage({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 220;
  const shown = open || !long ? text : text.slice(0, 220).replace(/\s+\S*$/, '') + '\u2026';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {'\u201C' + shown + '\u201D'}
      </div>
      {long ? (
        <button type="button" onClick={() => setOpen(v => !v)}
          style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
          {open ? 'Show less' : 'Show the whole message'}
        </button>
      ) : null}
    </div>
  );
}

export default function LeadConcierge({ myUserId, setView, contacts = [] }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [flash, setFlash] = useState(null);

  const load = React.useCallback(async () => {
    try { const { data } = await supabase.rpc('lead_concierge_pending'); setItems(Array.isArray(data) ? data : []); } catch (_) { setItems([]); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);           // refresh so new leads appear fast
    return () => clearInterval(t);
  }, [load]);

  const send = async (it) => {
    setBusy(it.id);
    try {
      const text = (editId === it.id ? editText : it.draft);
      const { data, error } = await supabase.functions.invoke('lead-concierge-send', { body: { id: it.id, text } });
      if (error || (data && data.error)) throw new Error((data && data.error) || 'Send failed');
      setFlash({ id: it.id, msg: 'Sent \u2713' });
      setItems(list => list.filter(x => x.id !== it.id));
      setEditId(null);
    } catch (e) { setFlash({ id: it.id, msg: (e.message || 'Send failed') }); }
    setBusy(null);
  };
  const dismiss = async (it) => {
    setBusy(it.id);
    try { await supabase.rpc('lead_concierge_dismiss', { p_id: it.id }); setItems(list => list.filter(x => x.id !== it.id)); } catch (_) {}
    setBusy(null);
  };

  if (!items.length) return null;
  return (
    <div className="fade-up" style={{ marginBottom: 14 }}>
      {items.map(it => {
        const first = (it.lead_name || '').trim().split(/\s+/)[0];
        const editing = editId === it.id;
        const isEmail = it.channel === 'email';
        // The RPC resolves the contact for us when it can. When it cannot, this
        // is a stranger — which for a NEW LEAD is the normal case, so the card
        // offers to create the record rather than showing a dead name.
        const contact = it.contact_id ? { id: it.contact_id, name: it.contact_name || first } : null;
        const label = it.contact_name || first || it.lead_email || it.lead_phone;
        return (
          <div key={it.id} style={{ background: 'linear-gradient(150deg,rgba(197,169,94,.16),rgba(197,169,94,.04))', border: '1px solid rgba(197,169,94,.5)', borderRadius: 16, padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="live-dot" />
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#EBCB82' }}>New lead \u00B7 reply ready</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{isEmail ? 'emailed' : (it.channel === 'missed_call' ? 'missed call' : 'texted')} \u00B7 {timeAgo(it.first_seen_at)}</span>
            </div>
            {/* The name is the way into the person, not decoration. */}
            <div style={{ marginBottom: 2 }}>
              <SenderLink contact={contact} name={label} address={it.lead_email} size={15} />
            </div>
            <InboundMessage text={it.inbound_text} />
            {isEmail && it.draft_subject && !editing && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 6 }}><span style={{ color: 'var(--text-2)' }}>Subject:</span> {it.draft_subject}</div>}
            {/* The email itself: whole thread, and the way to clear it out of the
                inbox once handled. Dismiss only clears the CARD — it always left
                the mail sitting there. */}
            {isEmail && it.thread_id ? (
              <EmailDetailPanel threadId={it.thread_id} contacts={contacts} />
            ) : null}
            {editing ? (
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, margin: '10px 0' }} />
            ) : (
              <div onClick={() => { setEditId(it.id); setEditText(it.draft); }} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.5, margin: '10px 0', cursor: 'text' }}>
                {it.draft}
              </div>
            )}
            {flash && flash.id === it.id ? (
              <div style={{ fontSize: 13, color: flash.msg.indexOf('\u2713') >= 0 ? '#22c55e' : '#fca5a5', fontWeight: 600 }}>{flash.msg}</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy === it.id} onClick={() => send(it)}
                  style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  {busy === it.id ? 'Sending\u2026' : (editing ? 'Send this' : (isEmail ? 'Send email' : 'Send reply'))}
                </button>
                {!editing && <button onClick={() => { setEditId(it.id); setEditText(it.draft); }} style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>Edit</button>}
                <button disabled={busy === it.id} onClick={() => dismiss(it)} style={{ marginLeft: 'auto', background: 'transparent', color: 'var(--text-3)', border: 'none', fontSize: 12.5, cursor: 'pointer' }}>Dismiss</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function timeAgo(ts) {
  if (!ts) return ''; const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return s + 's ago'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); return h + 'h ago';
}
