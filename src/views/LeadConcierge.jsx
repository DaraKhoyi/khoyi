import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { SenderLink, EmailThreadPanel, ThreadDisclosure, EmailActionBar, EmailIdRow, emailGist, runEmailAction } from './EmailShared';
import EmailTaskModal from './EmailTaskModal';

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
function LeadEmailTools({ it, contacts, onActed, collapsed, onNotALead, onDelegate }) {
  const [unsubBusy, setUnsubBusy] = useState(false);
  const toolBtn = { fontSize: 11.5, fontWeight: 700, padding: '5px 9px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' };
  const unsubscribe = async () => {
    setUnsubBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-unsubscribe', {
        body: { account_id: it.account_id, provider_message_id: it.provider_message_id, sender: it.lead_email },
      });
      if (error) { if (window.__notify) window.__notify('Unsubscribe failed: ' + error.message, 'error'); return; }
      if (data && data.ok) {
        if (window.__notify) window.__notify('Unsubscribed. They should stop arriving.', 'success');
        onNotALead && onNotALead(it, 'unsubscribed');
        return;
      }
      // Honest about the ones that need a human click.
      if (data && data.url) {
        try { window.open(data.url, '_blank', 'noopener'); } catch (_) {}
        if (window.__notify) window.__notify('Opened their unsubscribe page \u2014 finish it there.', 'success');
      } else if (window.__notify) {
        window.__notify((data && data.message) || 'No unsubscribe link on this one.', 'error');
      }
    } finally { setUnsubBusy(false); }
  };
  // Reply / archive / delete only cover the mail you can finish now. Task it and
  // Snooze cover the rest, which on Dara's queue is most of it.
  const [modal, setModal] = useState(null);   // 'task' | 'snooze'
  // The ids come from the row the list already has. The previous version looked
  // them up per card with useEmailIdentity, which meant 43 cards firing 43
  // async queries on open — whichever ones lost the race rendered no Archive and
  // no Delete at all, silently. That is why McCrink had no buttons and Marge
  // did. Nothing here waits on anything now.
  const accountId = it.account_id || null;
  const pThread = it.provider_thread_id || null;
  const pMsg = it.provider_message_id || null;
  // Belt and braces. The RPC is owner-scoped now, so nothing here should ever
  // be someone else's — but Archive and Delete reach into a real mailbox, and a
  // wall worth having is worth having twice.
  const mine = it.is_mine !== false;
  if (!accountId || (!pThread && !pMsg)) return null;
  return (
    <div style={{ margin: '8px 0 4px' }}>
      {modal ? (
        <EmailTaskModal mode={modal}
          subject={it.draft_subject || it.subject || ''}
          body={fullest(it)}
          fromName={(it.contact_name || it.lead_name || '').split(' ')[0] || ''}
          contactId={it.contact_id || null}
          threadId={it.thread_id || null}
          accountId={accountId}
          providerThreadId={pThread}
          providerMessageId={pMsg}
          onClose={() => setModal(null)}
          onDone={() => onActed && onActed('archive')} />
      ) : null}
      {mine ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <EmailActionBar accountId={accountId} providerThreadId={pThread}
            providerMessageId={pMsg} onDone={onActed} compact />
          <button type="button" onClick={() => setModal('task')}
            title="Make an A/B/C/D task carrying the whole email, and have the email return on the due date"
            style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 9px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
            {'\u2713 Task it'}
          </button>
          <button type="button" onClick={() => setModal('snooze')}
            title="Not now — it leaves your inbox and comes back when you say"
            style={toolBtn}>
            {'\u23F0 Snooze'}
          </button>
          <button type="button" disabled={unsubBusy} onClick={unsubscribe}
            title="Use the sender's own unsubscribe, so they stop arriving at all"
            style={toolBtn}>
            {unsubBusy ? 'Unsubscribing\u2026' : '\u2298 Unsubscribe'}
          </button>
          <button type="button" onClick={() => onNotALead && onNotALead(it)}
            title="Teach the queue: this sender is not a lead, and neither is the next one from them"
            style={toolBtn}>
            {'\u2716 Not a lead'}
          </button>
          <button type="button" onClick={() => onDelegate && onDelegate(it)}
            title="Hand this to the agent who should own it"
            style={toolBtn}>
            {'\u21AA Delegate'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
          {'This sits in another agent\u2019s inbox \u2014 use Dismiss to clear it from your list.'}
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
  // Nine cards from the same sender should die in one gesture, not nine.
  const [sel, setSel] = useState({});
  const [bulkBusy, setBulkBusy] = useState('');
  const [agents, setAgents] = useState([]);
  const [delegateFor, setDelegateFor] = useState(null);
  // Archiving is meant to CLEAR the screen. The card collapses to a single
  // 'Archived. Undo' line rather than vanishing outright, because unmounting it
  // would take the undo with it — and it is gone entirely on the next load.
  // Sixteen of these, each with a summary, a draft and six buttons, is most of a
  // phone screen apiece — enough to push everything below them out of sight,
  // which is exactly what happened to the call commitments. Show a handful and
  // offer the rest; a deck you can finish beats a wall you scroll past.
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [cleared, setCleared] = useState({});
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [flash, setFlash] = useState(null);

  // Roster for delegation. Only names — no agent data crosses the wall.
  useEffect(() => { (async () => {
    try {
      const { data } = await supabase.from('agents')
        .select('auth_user_id, name, active').not('auth_user_id','is',null).eq('active', true).order('name');
      setAgents(data || []);
    } catch (_) {}
  })(); }, []);

  // Desktop shortcuts. Dara processes email at a laptop and tapping is the slow
  // path. Deliberately inert while typing, and inert on phones.
  useEffect(() => {
    const onKey = async (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (typeof window !== 'undefined' && window.innerWidth < 900) return;
      const ids = Object.keys(selRef.current || {}).filter(k => selRef.current[k]);
      if (!ids.length) return;
      const k = e.key;
      if (k === 'e') { e.preventDefault(); bulkRef.current && bulkRef.current('archive'); }
      else if (k === '#') { e.preventDefault(); bulkRef.current && bulkRef.current('trash'); }
      else if (k === 'u') { e.preventDefault(); bulkRef.current && bulkRef.current('not_a_lead'); }
      else if (k === 'Escape') { e.preventDefault(); setSel({}); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selRef = React.useRef(sel); selRef.current = sel;
  const bulkRef = React.useRef(null);

  const selIds = React.useMemo(() => Object.keys(sel).filter(k => sel[k]), [sel]);
  const toggleSel = (id) => setSel(m => ({ ...m, [id]: !m[id] }));
  const clearSel = () => setSel({});

  // One judgement about a sender, applied to every open lead from them.
  const markSender = React.useCallback(async (email, kind) => {
    if (!email) { if (window.__notify) window.__notify('This lead has no email address to judge.', 'error'); return; }
    const { data, error } = await supabase.rpc('lead_sender_rule', { p_sender: email, p_kind: kind });
    if (error || !data || !data.ok) {
      if (window.__notify) window.__notify('Could not save that: ' + ((error && error.message) || (data && data.error) || ''), 'error');
      return false;
    }
    setItems(list => list.filter(x => String(x.lead_email || '').toLowerCase() !== String(email).toLowerCase()));
    if (window.__notify) window.__notify(
      (kind === 'not_a_lead' ? 'Marked not a lead' : 'Sender blocked') +
      (data.cleared > 1 ? ' \u2014 cleared ' + data.cleared + ' from this sender.' : '.'), 'success');
    return true;
  }, []);

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

  // Bulk actions run one at a time and report what actually happened. Nine
  // archives that half-fail silently would be worse than nine taps.
  const runBulk = async (kind) => {
    const chosen = items.filter(x => sel[x.id]);
    if (!chosen.length) return;
    setBulkBusy(kind);
    let done = 0, failed = 0;
    for (const it of chosen) {
      try {
        if (kind === 'dismiss') { await supabase.rpc('lead_concierge_dismiss', { p_id: it.id }); done++; }
        else if (kind === 'not_a_lead') { (await markSender(it.lead_email, 'not_a_lead')) ? done++ : failed++; }
        else if (kind === 'archive' || kind === 'trash') {
          const r = await runEmailAction({ action: kind, accountId: it.account_id,
            providerThreadId: it.provider_thread_id, providerMessageId: it.provider_message_id });
          if (r.ok) { await supabase.rpc('lead_concierge_dismiss', { p_id: it.id }); done++; } else failed++;
        }
      } catch (_) { failed++; }
    }
    setBulkBusy('');
    clearSel();
    await load();
    if (window.__notify) window.__notify(
      done + ' done' + (failed ? ', ' + failed + " couldn't be" : '') + '.', failed ? 'error' : 'success');
  };

  bulkRef.current = runBulk;

  if (!items.length) return null;
  const LEAD_PREVIEW = 5;
  const visible = showAllLeads ? items : items.slice(0, LEAD_PREVIEW);
  const hiddenCount = items.length - visible.length;
  const bulkBtn = { fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' };
  return (
    <div className="fade-up" style={{ marginBottom: 14 }}>
      {delegateFor ? (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDelegateFor(null)} style={{ zIndex: 1400 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '92%' }}>
            <div className="modal-header"><h3 style={{ margin: 0 }}>Hand this to</h3></div>
            <div style={{ padding: 14, maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
                {'They get an A-priority task with the message. The email stays in your mailbox \u2014 nothing of yours moves to them.'}
              </div>
              {agents.length ? agents.map(a => (
                <button key={a.auth_user_id} type="button"
                  onClick={async () => {
                    const { data, error } = await supabase.rpc('delegate_lead', { p_lead: delegateFor.id, p_to_auth: a.auth_user_id });
                    setDelegateFor(null);
                    if (error || !data || !data.ok) { if (window.__notify) window.__notify('Could not delegate: ' + ((error && error.message) || (data && data.error) || ''), 'error'); return; }
                    setItems(list => list.filter(x => x.id !== delegateFor.id));
                    if (window.__notify) window.__notify('Sent to ' + (data.agent || 'them') + '.', 'success');
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 7, color: 'var(--text-1)', fontSize: 13.5, cursor: 'pointer' }}>
                  {a.name}
                </button>
              )) : <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No agents with logins yet.</div>}
            </div>
            <div style={{ padding: '0 14px 14px', textAlign: 'right' }}>
              <button className="btn btn-ghost" onClick={() => setDelegateFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
      {selIds.length ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          background: 'rgba(16,13,9,.96)', border: '1px solid rgba(197,169,94,.5)', borderRadius: 12, padding: '9px 11px', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#EBCB82' }}>{selIds.length + ' selected'}</span>
          <button style={bulkBtn} disabled={!!bulkBusy} onClick={() => runBulk('archive')}>{bulkBusy === 'archive' ? 'Archiving\u2026' : 'Archive'}</button>
          <button style={bulkBtn} disabled={!!bulkBusy} onClick={() => runBulk('trash')}>{bulkBusy === 'trash' ? 'Deleting\u2026' : 'Delete'}</button>
          <button style={bulkBtn} disabled={!!bulkBusy} onClick={() => runBulk('not_a_lead')}>{bulkBusy === 'not_a_lead' ? 'Marking\u2026' : 'Not a lead'}</button>
          <button style={bulkBtn} disabled={!!bulkBusy} onClick={() => runBulk('dismiss')}>Dismiss</button>
          <button style={{ ...bulkBtn, marginLeft: 'auto', border: 'none', color: 'var(--text-3)' }} onClick={clearSel}>Clear</button>
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
              <input type="checkbox" checked={!!sel[it.id]} onChange={() => toggleSel(it.id)}
                title="Select for a bulk action" style={{ marginRight: 2, cursor: 'pointer' }} />
              <span className={cleared[it.id] ? '' : 'live-dot'} style={cleared[it.id] ? { width: 7, height: 7, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' } : undefined} />
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: cleared[it.id] ? 'var(--text-3)' : '#EBCB82' }}>{cleared[it.id] ? (cleared[it.id] === 'trash' ? 'Deleted' : 'Archived') : 'New lead \u00B7 reply ready'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{(isEmail ? 'emailed' : (it.channel === 'missed_call' ? 'missed call' : 'texted')) + ' \u00B7 ' + timeAgo(it.first_seen_at)}</span>
            </div>
            {/* The name is the way into the person, not decoration. */}
            <div style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <SenderLink contact={contact} name={label} address={it.lead_email} size={15} />
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
                onNotALead={(row, kind) => markSender(row.lead_email, kind || 'not_a_lead')}
                onDelegate={(row) => setDelegateFor(row)}
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
                  {busy === it.id ? 'Sending\u2026' : (editing ? 'Send this' : (isEmail ? 'Send email' : 'Send reply'))}
                </button>
                {!editing && <button onClick={() => { setEditId(it.id); setEditText(it.draft); }} style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>Edit</button>}
                <button disabled={busy === it.id} onClick={() => dismiss(it)} style={{ marginLeft: 'auto', background: 'transparent', color: 'var(--text-3)', border: 'none', fontSize: 12.5, cursor: 'pointer' }}>Dismiss</button>
              </div>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 ? (
        <button type="button" onClick={() => setShowAllLeads(true)}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', borderRadius: 12,
            padding: '10px 12px', color: 'var(--accent)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          {'Show ' + hiddenCount + ' more lead' + (hiddenCount === 1 ? '' : 's')}
        </button>
      ) : null}
      {showAllLeads && items.length > LEAD_PREVIEW ? (
        <button type="button" onClick={() => setShowAllLeads(false)}
          style={{ width: '100%', background: 'transparent', border: 'none', padding: '8px 0',
            color: 'var(--text-3)', fontSize: 12, cursor: 'pointer' }}>
          Show fewer
        </button>
      ) : null}
    </div>
  );
}

function timeAgo(ts) {
  if (!ts) return ''; const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return s + 's ago'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); return h + 'h ago';
}
