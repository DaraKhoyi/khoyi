import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { SenderLink, EmailThreadPanel, ThreadDisclosure, EmailActionBar, EmailIdRow, emailGist } from './EmailShared';

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
function InboundMessage({ text, summary }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  // A real one-line read from the triage pass beats anything derived. Only some
  // threads have one; the rest fall back to the cleaned opening.
  const gist = (summary && String(summary).trim()) || emailGist(text, 240);
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
function LeadEmailTools({ it, contacts, onActed, collapsed }) {
  // The ids come from the row the list already has. The previous version looked
  // them up per card with useEmailIdentity, which meant 43 cards firing 43
  // async queries on open — whichever ones lost the race rendered no Archive and
  // no Delete at all, silently. That is why McCrink had no buttons and Marge
  // did. Nothing here waits on anything now.
  const accountId = it.account_id || null;
  const pThread = it.provider_thread_id || null;
  const pMsg = it.provider_message_id || null;
  // Archive and Delete act on a real Gmail mailbox. On a colleague's lead that
  // mailbox is THEIRS — gmail-modify rightly refused with 403, and it was right
  // to: clearing this card off Dara's screen must not reach into Ola's inbox.
  // Dismiss is the correct tool there, so the mailbox actions simply are not
  // offered.
  const mine = it.is_mine !== false;
  if (!accountId || (!pThread && !pMsg)) return null;
  return (
    <div style={{ margin: '8px 0 4px' }}>
      {mine ? (
        <EmailActionBar accountId={accountId} providerThreadId={pThread}
          providerMessageId={pMsg} onDone={onActed} compact />
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
          {'This sits in ' + (it.owner_name ? it.owner_name.split(' ')[0] + '\u2019s' : 'their') + ' inbox, not yours \u2014 use Dismiss to clear it from your list.'}
        </div>
      )}
      {it.thread_id && !collapsed ? (
        <div style={{ marginTop: 6 }}>
          <ThreadDisclosure label="Read full thread">
            <EmailThreadPanel threadId={it.thread_id} contacts={contacts} />
            <EmailIdRow messageId={pMsg} threadId={pThread} />
          </ThreadDisclosure>
        </div>
      ) : null}
    </div>
  );
}

export default function LeadConcierge({ myUserId, setView, contacts = [] }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  // Archiving is meant to CLEAR the screen. The card collapses to a single
  // 'Archived. Undo' line rather than vanishing outright, because unmounting it
  // would take the undo with it — and it is gone entirely on the next load.
  // 43 of the open leads are Dara's. 998 belong to seven other agents, and all
  // 1,041 were rendering on his home screen as though they were his. A list you
  // cannot finish is not a to-do list, so it defaults to your own; the rest is
  // one tap away for a broker who wants the brokerage view.
  const [showAll, setShowAll] = useState(false);
  const [cleared, setCleared] = useState({});
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
  const others = items.filter(x => x.is_mine === false).length;
  const visible = showAll ? items : items.filter(x => x.is_mine !== false);
  if (!visible.length && !others) return null;
  return (
    <div className="fade-up" style={{ marginBottom: 14 }}>
      {others ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, fontSize: 11.5, color: 'var(--text-3)' }}>
          <span>{showAll ? 'Showing the whole brokerage.' : (others + ' more across the brokerage.')}</span>
          <button type="button" onClick={() => setShowAll(v => !v)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 10px', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {showAll ? 'Just mine' : 'Show all'}
          </button>
        </div>
      ) : null}
      {!visible.length ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '2px 0 6px' }}>
          Nothing waiting on you right now.
        </div>
      ) : null}
      {visible.map(it => {
        const first = (it.lead_name || '').trim().split(/\s+/)[0];
        const editing = editId === it.id;
        const isEmail = it.channel === 'email';
        // The RPC resolves the contact for us when it can. When it cannot, this
        // is a stranger — which for a NEW LEAD is the normal case, so the card
        // offers to create the record rather than showing a dead name.
        const contact = it.contact_id ? { id: it.contact_id, name: it.contact_name || first } : null;
        const label = it.contact_name || first || it.lead_email || it.lead_phone;
        return (
          <div key={it.id} style={cleared[it.id]
            // Handled: it recedes instead of shouting. Still visible enough to
            // undo, quiet enough to stop counting as work.
            ? { background: 'transparent', border: '1px solid var(--border)', borderRadius: 16, padding: '10px 14px', marginBottom: 8, opacity: 0.6 }
            : { background: 'linear-gradient(150deg,rgba(197,169,94,.16),rgba(197,169,94,.04))', border: '1px solid rgba(197,169,94,.5)', borderRadius: 16, padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className={cleared[it.id] ? '' : 'live-dot'} style={cleared[it.id] ? { width: 7, height: 7, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' } : undefined} />
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: cleared[it.id] ? 'var(--text-3)' : '#EBCB82' }}>{cleared[it.id] ? (cleared[it.id] === 'trash' ? 'Deleted' : 'Archived') : 'New lead \u00B7 reply ready'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{(isEmail ? 'emailed' : (it.channel === 'missed_call' ? 'missed call' : 'texted')) + ' \u00B7 ' + timeAgo(it.first_seen_at)}</span>
            </div>
            {/* The name is the way into the person, not decoration. */}
            <div style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <SenderLink contact={contact} name={label} address={it.lead_email} size={15} />
              {/* Without this, a colleague's client correspondence reads as your
                  own. Dara was one tap from replying to another agent's closing. */}
              {it.is_mine === false && it.owner_name ? (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#EBCB82', border: '1px solid rgba(235,203,130,.45)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                  {it.owner_name.split(' ')[0] + '\u2019s lead'}
                </span>
              ) : null}
            </div>
            {/* inbound_text is capped around 700 characters at ingest — 72 of
                Dara's rows sit at 695-705 with the tail cut mid-sentence. The RPC
                also hands back full_body (the real message, up to 118k chars) and
                nothing used it, so "Show the whole message" was showing the whole
                STORED text, not the whole message. Prefer whichever is longer. */}
            {!cleared[it.id] && isEmail && it.draft_subject ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '2px 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.draft_subject}
              </div>
            ) : null}
            {!cleared[it.id] ? <InboundMessage text={fullest(it)} summary={it.triage_summary} /> : null}
            {/* The email itself: whole thread, and the way to clear it out of the
                inbox once handled. Dismiss only clears the CARD — it always left
                the mail sitting there. */}
            {isEmail ? (
              <LeadEmailTools it={it} contacts={contacts} collapsed={!!cleared[it.id]}
                onActed={async (action) => {
                  const undone = action === 'untrash' || action === 'unarchive';
                  setCleared(c => ({ ...c, [it.id]: undone ? undefined : action }));
                  // Handling the mail handles the lead. Undo puts it back.
                  try {
                    if (undone) await supabase.from('lead_concierge').update({ status: 'pending' }).eq('id', it.id);
                    else await supabase.rpc('lead_concierge_dismiss', { p_id: it.id });
                  } catch (_) { /* the card state is what Dara sees; never block on this */ }
                }} />
            ) : null}
            {cleared[it.id] ? null : editing ? (
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, margin: '10px 0' }} />
            ) : (
              <div onClick={() => { setEditId(it.id); setEditText(it.draft); }} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.5, margin: '10px 0', cursor: 'text' }}>
                {it.draft}
              </div>
            )}
            {cleared[it.id] ? null : flash && flash.id === it.id ? (
              <div style={{ fontSize: 13, color: flash.msg.indexOf('\u2713') >= 0 ? '#22c55e' : '#fca5a5', fontWeight: 600 }}>{flash.msg}</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy === it.id} onClick={() => send(it)}
                  style={{ background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  {busy === it.id ? 'Sending\u2026' : (editing ? 'Send this' : (it.is_mine === false ? 'Send as ' + ((it.owner_name || 'agent').split(' ')[0]) : (isEmail ? 'Send email' : 'Send reply')))}
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
