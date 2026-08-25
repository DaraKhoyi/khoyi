import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { SenderLink, EmailThreadPanel, ThreadDisclosure, EmailActionBar, EmailIdRow, emailGist, useEmailIdentity } from './EmailShared';

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
// The card is handed two versions of what they wrote: inbound_text (what the
// lead pipeline stored, capped ~700 chars) and full_body (the real message off
// email_messages). Neither is reliably the longer one — a short email has no
// full_body worth using, a long one is truncated in inbound_text — so take
// whichever actually has more of the sentence in it.
function fullest(it) {
  const a = (it && it.inbound_text) || '';
  const b = (it && it.full_body) || '';
  return b.length > a.length ? b : a;
}

// What they said, in the space it deserves.
//
// The old version printed the raw body with pre-wrap: quoted history, signature,
// legal footer and every blank line between them. On a phone that is a screen
// and a half to find one sentence. Now the gist leads — stripped and collapsed —
// and the untouched original is one tap away for anyone who wants it.
function InboundMessage({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const gist = emailGist(text, 240);
  const trimmed = String(text).trim();
  // Only offer "original" when it actually differs from what is already shown.
  const hasMore = trimmed.length > gist.length + 8;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {gist || trimmed.slice(0, 240)}
      </div>
      {hasMore ? (
        <>
          <button type="button" onClick={() => setOpen(v => !v)}
            style={{ marginTop: 5, background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            {open ? 'Hide original message' : 'Show original message'}
          </button>
          {open ? (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto' }}>
              {trimmed}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// Archive and Delete belong ON the card, not hidden inside "Read full thread".
// They were only reachable after expanding the thread because that is where the
// identifiers happened to resolve — so the two things Dara asked for looked
// missing. Identity is resolved up front now; the thread stays optional.
function LeadEmailTools({ threadId, contacts, onActed }) {
  const ident = useEmailIdentity({ threadId });
  if (!threadId) return null;
  return (
    <div style={{ margin: '8px 0 4px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {ident && ident.accountId ? (
          <EmailActionBar accountId={ident.accountId} providerThreadId={ident.providerThreadId}
            providerMessageId={ident.providerMessageId} onDone={onActed} compact />
        ) : null}
      </div>
      <div style={{ marginTop: 6 }}>
        <ThreadDisclosure label="Read full thread">
          <EmailThreadPanel threadId={threadId} contacts={contacts} />
          {ident ? <EmailIdRow messageId={ident.providerMessageId} threadId={ident.providerThreadId} /> : null}
        </ThreadDisclosure>
      </div>
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
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#EBCB82' }}>{'New lead \u00B7 reply ready'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{(isEmail ? 'emailed' : (it.channel === 'missed_call' ? 'missed call' : 'texted')) + ' \u00B7 ' + timeAgo(it.first_seen_at)}</span>
            </div>
            {/* The name is the way into the person, not decoration. */}
            <div style={{ marginBottom: 2 }}>
              <SenderLink contact={contact} name={label} address={it.lead_email} size={15} />
            </div>
            {/* inbound_text is capped around 700 characters at ingest — 72 of
                Dara's rows sit at 695-705 with the tail cut mid-sentence. The RPC
                also hands back full_body (the real message, up to 118k chars) and
                nothing used it, so "Show the whole message" was showing the whole
                STORED text, not the whole message. Prefer whichever is longer. */}
            {isEmail && it.draft_subject ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '2px 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.draft_subject}
              </div>
            ) : null}
            <InboundMessage text={fullest(it)} />
            {/* The email itself: whole thread, and the way to clear it out of the
                inbox once handled. Dismiss only clears the CARD — it always left
                the mail sitting there. */}
            {isEmail && it.thread_id ? (
              <LeadEmailTools threadId={it.thread_id} contacts={contacts}
                onActed={() => { /* deliberately NOT auto-dismissing: the action bar shows
                    "Deleted \u2014 Undo" inline, and unmounting the card here would
                    take the only undo away with it. */ }} />
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
