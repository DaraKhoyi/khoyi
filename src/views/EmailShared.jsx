import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';

// ── EmailShared — ONE implementation of "this card is about an email" ────────
//
// Before this module, three surfaces showed you an email and each was missing
// something different: Today's hero showed a one-line "why" and no message at
// all, the review cards showed an AI summary but not the words the person
// actually wrote, and only the Inbox could turn a sender's name into their
// contact record. Copying the Inbox's version into the other two would have
// been the third copy of a rule that already drifts (ONE RULE, ONE PLACE), and
// importing InboxView (3.4k lines) into TodayView would have dragged the whole
// monolith into the Today chunk. So the pieces live here and everyone imports
// them.
//
// What a card gets from this module:
//   EmailThreadPanel   the FULL back-and-forth, newest last, quoted text folded
//   SenderLink         a name that opens the contact record when we know them
//   EmailActionBar     Archive / Delete, both reversible, with a real Undo
//   useEmailIdentity   resolves "which email is this card about" from whatever
//                      identifiers the surface happens to hold
//
// Nothing here trusts the caller to have a complete email. Every surface holds
// a DIFFERENT subset of identifiers — the review row has provider ids, Today
// has only a contact — so each entry point degrades to a useful state instead
// of rendering an error.

// ─────────────────────────────────────────────────────────────────────────────
// Body renderers (moved verbatim from InboxView so all three surfaces render
// email exactly the same way; InboxView now imports them from here).
// ─────────────────────────────────────────────────────────────────────────────

// Renders email HTML in a sandboxed iframe. Sandbox blocks scripts/popups
// so even malicious email HTML can't escape into the app. Auto-sizes height.
export function EmailHtmlFrame({ html }) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Wrap in a basic style so dark-mode email content stays readable.
    // <base target="_blank"> ensures every link opens in a new tab instead of
    // trying to navigate the (sandboxed) iframe itself.
    const wrapped = `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light only">
      <base target="_blank" rel="noopener noreferrer">
      <style>
        /* Force LIGHT rendering: many emails (e.g. Google Calendar invites) ship
           a prefers-color-scheme:dark stylesheet that turns text near-white. On a
           phone in dark mode that produced white-on-white. Pinning light mode keeps
           those dark-mode overrides from firing so the email shows as authored. */
        :root, html { color-scheme: light only; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; background: #ffffff; word-wrap: break-word; overflow-wrap: anywhere; -webkit-text-size-adjust: 100%; }
        a { color: #1a56db; word-break: break-word; }
        a:visited { color: #6b3fa0; }
        img { max-width: 100%; height: auto; display: inline-block; }
        table { max-width: 100% !important; }
        td, th { max-width: 100%; word-wrap: break-word; }
        blockquote { border-left: 3px solid #d0d5dd; padding-left: 12px; color: #555; margin: 8px 0; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        * { max-width: 100%; box-sizing: border-box; }
      </style></head><body>${html}</body></html>`;
    iframe.srcdoc = wrapped;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          doc.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          });
          const h = Math.min(1200, Math.max(100, doc.body.scrollHeight + 24));
          setHeight(h);
        }
      } catch (_) { /* cross-origin shouldn't happen with srcdoc */ }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [html]);
  return (
    <iframe
      ref={iframeRef}
      title="email-body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height: height + 'px', border: 'none', borderRadius: '8px', background: '#ffffff', colorScheme: 'light' }}
    />
  );
}

// Render plain-text email bodies with auto-linked URLs, markdown-style [text](url),
// and angle-bracket <https://...> URLs. Each detected URL becomes a clickable link.
export function PlainTextBody({ text }) {
  if (!text) return null;
  const segments = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"')\]]+)/g;
  let lastIdx = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) segments.push({ type: 'text', value: text.substring(lastIdx, match.index) });
    if (match[1]) segments.push({ type: 'link', label: match[2], url: match[3] });
    else if (match[4]) segments.push({ type: 'link', label: match[4], url: match[4] });
    else if (match[5]) segments.push({ type: 'link', label: match[5], url: match[5] });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) segments.push({ type: 'text', value: text.substring(lastIdx) });
  return (
    <div style={{ fontSize: '14px', lineHeight: '1.7', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {segments.map((s, i) => s.type === 'text'
        ? <span key={i}>{s.value}</span>
        : <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{s.label}</a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sender → contact
// ─────────────────────────────────────────────────────────────────────────────

// A person has more than one address; contacts.email is only the default one,
// and the jsonb `emails` array is the real source. Matching on the scalar alone
// is why a known sender sometimes rendered as a stranger.
export function buildContactByEmail(contacts) {
  const m = new Map();
  for (const c of (contacts || [])) {
    if (c && c.email) m.set(String(c.email).trim().toLowerCase(), c);
    if (Array.isArray(c && c.emails)) {
      for (const e of c.emails) {
        const v = typeof e === 'string' ? e : (e && e.value);
        if (v) m.set(String(v).trim().toLowerCase(), c);
      }
    }
  }
  return m;
}

export function useContactByEmail(contacts) {
  const map = useMemo(() => buildContactByEmail(contacts), [contacts]);
  return useCallback(
    (email) => (email ? map.get(String(email).trim().toLowerCase()) || null : null),
    [map]);
}

// A name in an email header is only useful if it gets you to the record. When
// we DON'T know them, the honest move is to offer to create the contact rather
// than render a dead-looking name that begs to be tapped.
export function SenderLink({ contact, name, address, size = 14, showAdd = true }) {
  const label = name || address || 'Unknown sender';
  if (contact) {
    return (
      <button type="button" title={'Open ' + (contact.name || label) + '\u2019s record'}
        onClick={() => { try { window.__openContact && window.__openContact(contact.id); } catch (_) {} }}
        style={{ fontWeight: 600, color: 'var(--accent)', fontSize: size + 'px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', textDecorationLine: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px', wordBreak: 'break-word' }}>
        {label}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: size + 'px', wordBreak: 'break-word' }}>{label}</span>
      {showAdd && address ? (
        <button type="button" title={'Add ' + address + ' to your contacts'}
          onClick={() => { try { window.__openContactResearch && window.__openContactResearch(null, { email: address, name: name || '' }); } catch (_) {} }}
          style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px', cursor: 'pointer' }}>
          + Add
        </button>
      ) : null}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions — archive and delete, both reversible
// ─────────────────────────────────────────────────────────────────────────────

// Gmail's own semantics, named the way a person thinks about them:
//   archive  removes INBOX. The mail still exists and is still searchable.
//   trash    moves to Trash. Recoverable for 30 days, then Gmail purges it.
// Permanent delete is deliberately NOT offered — there is no undo for it and
// nobody has ever been glad they had it on a phone.
export const EMAIL_ACTIONS = {
  archive: { verb: 'Archive', done: 'Archived', undo: 'unarchive', icon: '\u2913', hint: 'Removes it from your inbox. Still searchable in All Mail.' },
  trash: { verb: 'Delete', done: 'Deleted', undo: 'untrash', icon: '\u{1F5D1}', hint: 'Moves it to Trash. Recoverable for 30 days.' },
};

// One call site for every archive/trash/undo in the app. Returns
// { ok, error } and NEVER throws — supabase-js resolves with { error } rather
// than throwing, and an un-checked result is how "it looked deleted but came
// back tomorrow" happens.
export async function runEmailAction({ action, accountId, providerThreadId, providerMessageId, scope = 'thread' }) {
  if (!accountId) return { ok: false, error: 'No email account on this message.' };
  const wantThread = scope === 'thread' && providerThreadId;
  if (!wantThread && !providerMessageId && !providerThreadId) return { ok: false, error: 'This card has no email attached.' };
  try {
    if (action === 'trash' || action === 'untrash') {
      const body = { account_id: accountId, mode: action === 'untrash' ? 'untrash' : 'trash' };
      if (wantThread) body.thread_id = providerThreadId;
      else if (providerMessageId) body.message_id = providerMessageId;
      else body.thread_id = providerThreadId;
      const { data, error } = await supabase.functions.invoke('gmail-trash', { body });
      if (error || !(data && data.ok)) return { ok: false, error: (error && error.message) || (data && data.error) || 'Gmail rejected the change.' };
      return { ok: true };
    }
    // archive / unarchive act on the thread — Gmail has no per-message inbox label
    if (!providerThreadId) return { ok: false, error: 'Archiving needs the whole thread, and this card has no thread id.' };
    const { data, error } = await supabase.functions.invoke('gmail-modify', {
      body: { account_id: accountId, thread_id: providerThreadId, action: action === 'unarchive' ? 'unarchive' : 'archive' },
    });
    if (error || !(data && data.ok)) return { ok: false, error: (error && error.message) || (data && data.error) || 'Gmail rejected the change.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function notify(msg, kind) { try { window.__notify && window.__notify(msg, kind); } catch (_) {} }

// Archive + Delete with a real Undo strip. The undo is not cosmetic: it calls
// Gmail back and puts the label where it was. It stays until dismissed rather
// than vanishing on a timer, because a timed undo on a phone is a promise you
// break for anyone who looks away.
export function EmailActionBar({ accountId, providerThreadId, providerMessageId, scope = 'thread', onDone, compact = false, disabled = false }) {
  const [busy, setBusy] = useState(null);
  const [undoable, setUndoable] = useState(null); // { action, label }
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const canAct = !!accountId && (!!providerThreadId || !!providerMessageId);
  if (!canAct) return null;

  const act = async (action) => {
    setBusy(action);
    const r = await runEmailAction({ action, accountId, providerThreadId, providerMessageId, scope });
    if (!alive.current) return;
    setBusy(null);
    if (!r.ok) { notify('Couldn\u2019t ' + EMAIL_ACTIONS[action].verb.toLowerCase() + ' \u2014 ' + r.error, 'error'); return; }
    setUndoable({ action, label: EMAIL_ACTIONS[action].done });
    notify(EMAIL_ACTIONS[action].done + ' \u2014 tap Undo if that wasn\u2019t right.', 'success');
    onDone && onDone(action);
  };

  const undo = async () => {
    if (!undoable) return;
    const back = EMAIL_ACTIONS[undoable.action].undo;
    setBusy('undo');
    const r = await runEmailAction({ action: back, accountId, providerThreadId, providerMessageId, scope });
    if (!alive.current) return;
    setBusy(null);
    if (!r.ok) { notify('Couldn\u2019t undo \u2014 ' + r.error, 'error'); return; }
    setUndoable(null);
    notify('Put back.', 'success');
    onDone && onDone(back);
  };

  if (undoable) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-3)' }}>
        <span>{undoable.label}.</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'undo'} onClick={undo}>
          {busy === 'undo' ? 'Undoing\u2026' : 'Undo'}
        </button>
      </div>
    );
  }

  const btnStyle = (danger) => ({
    fontSize: compact ? '11.5px' : '12px', fontWeight: 700, padding: compact ? '5px 9px' : '6px 11px',
    borderRadius: 8, cursor: 'pointer', background: 'transparent',
    border: '1px solid ' + (danger ? 'rgba(239,68,68,0.5)' : 'var(--border)'),
    color: danger ? '#ef4444' : 'var(--text-2)',
  });

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" style={btnStyle(false)} disabled={disabled || !!busy} title={EMAIL_ACTIONS.archive.hint} onClick={() => act('archive')}>
        {busy === 'archive' ? 'Archiving\u2026' : EMAIL_ACTIONS.archive.icon + ' Archive'}
      </button>
      <button type="button" style={btnStyle(true)} disabled={disabled || !!busy} title={EMAIL_ACTIONS.trash.hint} onClick={() => act('trash')}>
        {busy === 'trash' ? 'Deleting\u2026' : EMAIL_ACTIONS.trash.icon + ' Delete'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread itself
// ─────────────────────────────────────────────────────────────────────────────

const MSG_COLS = 'id, account_id, thread_id, provider_message_id, provider_thread_id, from_name, from_address, to_addresses, subject, snippet, body_text, body_html, internal_date, direction, has_attachments';

function fmtWhen(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) { return ''; }
}

// Fold the quoted history off the bottom of a plain-text reply. Every mail
// client staples the previous message onto the new one; showing it inline makes
// a two-line reply look like an essay.
function splitQuoted(text) {
  if (!text) return { body: '', quoted: '' };
  const lines = String(text).split('\n');
  const markers = [
    /^\s*On .+ wrote:\s*$/i,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*From:\s.+/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    if (markers.some(re => re.test(lines[i]))) {
      const body = lines.slice(0, i).join('\n').replace(/\s+$/, '');
      const quoted = lines.slice(i).join('\n');
      if (body.trim()) return { body, quoted };
    }
  }
  const gt = lines.findIndex(l => /^\s*>/.test(l));
  if (gt > 0) {
    const body = lines.slice(0, gt).join('\n').replace(/\s+$/, '');
    if (body.trim()) return { body, quoted: lines.slice(gt).join('\n') };
  }
  return { body: text, quoted: '' };
}

function ThreadMessage({ msg, findContact, isLast, total, index }) {
  // Long threads open collapsed except the newest — that's the one you're
  // being asked about. Older messages are one tap away.
  const [open, setOpen] = useState(isLast || total <= 2);
  const contact = findContact ? findContact(msg.from_address) : null;
  const outbound = String(msg.direction || '').toLowerCase() === 'outbound';
  const parts = splitQuoted(msg.body_text || '');
  const [showQuoted, setShowQuoted] = useState(false);

  return (
    <div style={{ borderTop: index === 0 ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <SenderLink contact={contact} name={msg.from_name} address={msg.from_address} size={13} showAdd={false} />
          {outbound ? <span style={{ marginLeft: 6, fontSize: '10px', color: 'var(--text-3)', fontWeight: 700 }}>YOU</span> : null}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-3)', flexShrink: 0 }}>{fmtWhen(msg.internal_date)}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-3)', flexShrink: 0 }}>{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {!open ? (
        <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {msg.snippet || ''}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {msg.from_address ? (
            <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: 6, wordBreak: 'break-word' }}>{msg.from_address}</div>
          ) : null}
          {msg.body_html
            ? <EmailHtmlFrame html={msg.body_html} />
            : <PlainTextBody text={parts.body || msg.snippet || '(no message body)'} />}
          {!msg.body_html && parts.quoted ? (
            <>
              <button type="button" onClick={() => setShowQuoted(v => !v)}
                style={{ marginTop: 8, fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px', cursor: 'pointer' }}>
                {showQuoted ? 'Hide quoted text' : '\u2026 Show quoted text'}
              </button>
              {showQuoted ? <div style={{ marginTop: 8, opacity: 0.75 }}><PlainTextBody text={parts.quoted} /></div> : null}
            </>
          ) : null}
          {msg.has_attachments ? (
            <div style={{ marginTop: 8, fontSize: '11px', color: 'var(--text-3)' }}>
              {'\u{1F4CE} Has attachments \u2014 open in Inbox to download or file them.'}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Loads and renders the FULL thread. Accepts whatever identifiers the calling
// surface happens to have:
//   threadId           (uuid, local)      — most precise
//   providerThreadId   (Gmail thread id)  — what review rows carry
//   providerMessageId  (Gmail message id) — resolves to its thread
//   contactEmail       — last resort: the newest thread involving that address
// Resolution order runs most-precise first and stops at the first hit.
export function EmailThreadPanel({ threadId, providerThreadId, providerMessageId, contactEmail, accountId, contacts, onResolved, maxMessages = 25 }) {
  const [state, setState] = useState({ phase: 'loading', msgs: [], err: '' });
  const findContact = useContactByEmail(contacts);
  const resolvedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    resolvedRef.current = false;
    setState({ phase: 'loading', msgs: [], err: '' });
    (async () => {
      try {
        let tid = threadId || null;

        if (!tid && providerThreadId) {
          const { data } = await supabase.from('email_messages')
            .select('thread_id').eq('provider_thread_id', providerThreadId).limit(1);
          tid = (data && data[0] && data[0].thread_id) || null;
        }
        if (!tid && providerMessageId) {
          const { data } = await supabase.from('email_messages')
            .select('thread_id').eq('provider_message_id', providerMessageId).limit(1);
          tid = (data && data[0] && data[0].thread_id) || null;
        }
        if (!tid && contactEmail) {
          // The newest message from this person, then its whole thread. This is
          // the Today-card path: a contact owes us a reply and we want to see
          // what they actually said.
          const { data } = await supabase.from('email_messages')
            .select('thread_id, internal_date')
            .eq('from_address', String(contactEmail).trim().toLowerCase())
            .order('internal_date', { ascending: false }).limit(1);
          tid = (data && data[0] && data[0].thread_id) || null;
        }

        if (!tid) {
          if (alive) setState({ phase: 'empty', msgs: [], err: '' });
          return;
        }

        const { data: msgs, error } = await supabase.from('email_messages')
          .select(MSG_COLS).eq('thread_id', tid)
          .order('internal_date', { ascending: true }).limit(maxMessages);
        if (!alive) return;
        if (error) { setState({ phase: 'error', msgs: [], err: error.message || 'Could not load the message.' }); return; }
        if (!msgs || !msgs.length) { setState({ phase: 'empty', msgs: [], err: '' }); return; }
        setState({ phase: 'ready', msgs, err: '' });

        // Hand the resolved identifiers back so the card's action bar can act
        // on a thread it only knew by contact. Guarded so a parent setState
        // can't loop us.
        if (!resolvedRef.current && onResolved) {
          resolvedRef.current = true;
          const newest = msgs[msgs.length - 1];
          onResolved({
            threadId: tid,
            accountId: accountId || newest.account_id || null,
            providerThreadId: newest.provider_thread_id || providerThreadId || null,
            providerMessageId: newest.provider_message_id || null,
            subject: newest.subject || '',
          });
        }
      } catch (e) {
        if (alive) setState({ phase: 'error', msgs: [], err: (e && e.message) || String(e) });
      }
    })();
    return () => { alive = false; };
  }, [threadId, providerThreadId, providerMessageId, contactEmail, accountId, maxMessages, onResolved]);

  if (state.phase === 'loading') {
    return <div style={{ fontSize: '12px', color: 'var(--text-3)', padding: '10px 0' }}>Loading the conversation\u2026</div>;
  }
  if (state.phase === 'error') {
    return <div style={{ fontSize: '12px', color: '#ef4444', padding: '10px 0' }}>{state.err}</div>;
  }
  if (state.phase === 'empty') {
    // Honest, not a dead end. The mail may simply not be synced locally yet.
    return (
      <div style={{ fontSize: '12px', color: 'var(--text-3)', padding: '10px 0' }}>
        {'The full message isn\u2019t synced to Prism yet. '}
        <button type="button" onClick={() => { try { window.__setView && window.__setView('inbox'); } catch (_) {} }}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>
          Open Inbox
        </button>
      </div>
    );
  }

  const subject = (state.msgs[state.msgs.length - 1] || {}).subject || '';
  return (
    <div>
      {subject ? (
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-2)', paddingBottom: 4 }}>{subject}</div>
      ) : null}
      {state.msgs.length > 1 ? (
        <div style={{ fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, paddingBottom: 2 }}>
          {state.msgs.length} messages in this thread
        </div>
      ) : null}
      {state.msgs.map((m, i) => (
        <ThreadMessage key={m.id} msg={m} findContact={findContact}
          index={i} total={state.msgs.length} isLast={i === state.msgs.length - 1} />
      ))}
    </div>
  );
}

// The disclosure a card wraps around the thread. Kept separate so a surface can
// choose its own trigger wording ("Read full thread" on Today, "Full message"
// on a review row) without re-implementing the open/close + lazy-load.
export function ThreadDisclosure({ label = 'Read full thread', children, defaultOpen = false, onOpenChange }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button"
        onClick={() => { const n = !open; setOpen(n); onOpenChange && onOpenChange(n); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
        <span>{open ? 'Hide message' : label}</span>
        <span aria-hidden="true">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open ? (
        <div style={{ marginTop: 8, padding: '4px 12px 6px', borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// The message's real Gmail identifiers, on demand. This is what you need when an
// email has to be found OUTSIDE Prism — pasted into a Gmail search, quoted in a
// support thread, or handed to someone else. Copyable, because nobody should
// retype a 16-character hex id off a phone screen.
export function EmailIdRow({ messageId, threadId }) {
  const [copied, setCopied] = useState('');
  const ids = [
    { k: 'Message ID', v: messageId },
    { k: 'Thread ID', v: threadId },
  ].filter(x => x.v);
  if (!ids.length) return null;
  const copy = async (k, v) => {
    try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 1500); }
    catch (_) { notify('Couldn\u2019t copy \u2014 long-press to select instead.', 'error'); }
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
      {ids.map(x => (
        <div key={x.k} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '10.5px', color: 'var(--text-3)', marginBottom: 3 }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>{x.k}</span>
          <code style={{ flex: 1, minWidth: 0, fontSize: '10.5px', wordBreak: 'break-all', color: 'var(--text-2)' }}>{x.v}</code>
          <button type="button" onClick={() => copy(x.k, x.v)}
            style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: 'var(--accent)', background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px', cursor: 'pointer' }}>
            {copied === x.k ? 'Copied' : 'Copy'}
          </button>
        </div>
      ))}
    </div>
  );
}

// The Today hero used to describe an email without ever showing it: "They
// messaged you 3 days ago and are waiting to hear back" — but not what they
// SAID. You had to leave Today, open the Inbox and find it, which is exactly
// the context switch this screen exists to prevent.
//
// The hero's cards are contact-derived (they come from who owes a reply, not
// from a mailbox row), so they carry no email id at all. This resolves the
// newest thread from that person's address, then hands the identifiers back so
// Archive/Delete can act on a real Gmail thread.
// The whole "this card is about an email" affordance in one place: read the full
// thread, then archive or delete it, then the ids if you need them elsewhere.
// Both the Today hero and the lead cards mount this, so the behaviour cannot
// drift between them.
//
// Identifiers come in however the calling surface has them — a local thread uuid
// (lead cards) or just the sender's address (hero cards). Whichever it is, the
// panel resolves the rest and only then offers the actions, because Archive and
// Delete need a real Gmail thread id and offering buttons that cannot work is
// worse than not offering them.
export function EmailDetailPanel({ threadId, contactEmail, contacts, onActed, label = 'Read full thread' }) {
  const [ident, setIdent] = useState(null);
  const onResolved = useCallback((r) => setIdent(r), []);
  if (!threadId && !contactEmail) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <ThreadDisclosure label={label}>
        <EmailThreadPanel threadId={threadId} contactEmail={contactEmail} contacts={contacts} onResolved={onResolved} />
        {ident && ident.accountId ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <EmailActionBar accountId={ident.accountId} providerThreadId={ident.providerThreadId}
              providerMessageId={ident.providerMessageId} onDone={onActed} />
            <EmailIdRow messageId={ident.providerMessageId} threadId={ident.providerThreadId} />
          </div>
        ) : null}
      </ThreadDisclosure>
    </div>
  );
}

// The Today hero's entry point. Only email-shaped cards have a thread behind
// them; an overdue task or a closing deal does not, and offering "Read full
// thread" there would be a lie.
export function HeroEmailPanel({ action, contacts, onActed }) {
  const emailish = action && (action.tag === 'reply' || action.tag === 'opened');
  const person = emailish && action.contactId ? (contacts || []).find(c => c.id === action.contactId) : null;
  const email = emailish ? ((action.cta && action.cta.email) || (person && person.email) || null) : null;
  if (!email) return null;
  return <EmailDetailPanel contactEmail={email} contacts={contacts} onActed={onActed} />;
}
