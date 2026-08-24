import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../dataService';
import { SenderLink, EmailThreadPanel, ThreadDisclosure, EmailActionBar, EmailIdRow, useContactByEmail } from './EmailShared';

// ── palette / helpers ────────────────────────────────────────────────
const CAT = {
  urgent:            { label: 'Urgent',    color: '#ef4444' },
  requires_response: { label: 'Reply',     color: '#C5A95E' },
  can_wait:          { label: 'Can wait',  color: '#f59e0b' },
  fyi:               { label: 'FYI',        color: '#8a8f9c' },
  promotional:       { label: 'Promo',     color: '#8b5cf6' },
  spam:              { label: 'Spam',       color: '#6b7280' },
};
const notify = (m, t = 'success') => { try { window.__notify && window.__notify(m, t); } catch (_) {} };

function relTime(ts) {
  if (!ts) return '';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 3600) return Math.max(1, Math.floor(d / 60)) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 86400 * 7) return Math.floor(d / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function reasonChips(reasons = {}) {
  const out = [];
  if (reasons.money) out.push({ k: 'money', icon: '💵', text: 'money' });
  if (reasons.deadline) out.push({ k: 'deadline', icon: '⏰', text: typeof reasons.deadline === 'string' ? reasons.deadline : 'deadline' });
  if (reasons.legal) out.push({ k: 'legal', icon: '⚖️', text: 'legal / contract' });
  if (reasons.known_contact) out.push({ k: 'kc', icon: '⭐', text: 'known contact' });
  if (reasons.first_time) out.push({ k: 'ft', icon: '🆕', text: 'first-time sender' });
  return out;
}

// ── main view ────────────────────────────────────────────────────────
export default function EmailReviewView({ userId, emailAccounts = [], contacts = [], setView, onCount }) {
  const findContact = useContactByEmail(contacts);
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});   // id -> true while an action runs

  const acctEmail = useMemo(() => {
    const m = {}; (emailAccounts || []).forEach(a => { m[a.id] = a.email_address; }); return m;
  }, [emailAccounts]);

  const load = useCallback(async () => {
    setLoading(true);
    const [ri, ss] = await Promise.all([
      supabase.from('email_review_items').select('*')
        .eq('status', 'open').order('priority', { ascending: false }).order('received_at', { ascending: false }).limit(250),
      supabase.from('email_sender_stats').select('*')
        .eq('unsubscribe_recommended', true).eq('status', 'active')
        .order('msg_count_30d', { ascending: false }).limit(300),
    ]);
    const reviewRows = ri.data || [];
    setItems(reviewRows);
    setSenders(ss.data || []);
    setLoading(false);
    if (onCount) onCount(reviewRows.filter(r => r.needs_review).length);
  }, [onCount]);

  useEffect(() => { load(); }, [load]);

  // ── actions ──
  const setItemStatus = async (row, status) => {
    setBusy(b => ({ ...b, [row.id]: true }));
    const prev = items;
    setItems(list => list.filter(r => r.id !== row.id));
    const { error } = await supabase.from('email_review_items').update({ status }).eq('id', row.id);
    setBusy(b => { const n = { ...b }; delete n[row.id]; return n; });
    if (error) { setItems(prev); notify("Couldn't update — try again.", 'error'); return; }
    if (onCount) onCount(prev.filter(r => r.id !== row.id && r.needs_review).length);
    notify(status === 'done' ? 'Marked done' : 'Dismissed');
  };
  // Archive/Delete are now handled by the shared EmailActionBar (one
  // implementation, and both reversible). All this has to do is clear the row
  // from the review queue once Gmail has confirmed the change — and put it BACK
  // if the person hits Undo, otherwise the undo would restore the email but
  // leave the review card gone.
  const onEmailActed = (row) => async (action) => {
    // Record the outcome but LEAVE THE CARD ON SCREEN. Filtering it out here
    // unmounts the action bar, and the Undo button lives inside it — the row
    // would vanish while the email sat in Trash with no way back. The card
    // clears on the next load, by which point the undo window is over.
    const undone = action === 'untrash' || action === 'unarchive';
    const status = undone ? 'open' : (action === 'trash' ? 'deleted' : 'done');
    const { error } = await supabase.from('email_review_items').update({ status }).eq('id', row.id);
    if (error) { notify("Couldn't update the review list — try again.", 'error'); return; }
    if (onCount) onCount(items.filter(r => r.id !== row.id && r.needs_review).length);
  };

  const setSenderStatus = async (row, status, openUrl) => {
    setBusy(b => ({ ...b, [row.id]: true }));
    if (openUrl && row.list_unsubscribe) { try { window.open(row.list_unsubscribe, '_blank', 'noopener'); } catch (_) {} }
    else if (openUrl) {
      const em = acctEmail[row.account_id] || '';
      const url = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(em)}#search/from%3A${encodeURIComponent(row.sender_address)}`;
      try { window.open(url, '_blank', 'noopener'); } catch (_) {}
    }
    const prev = senders;
    setSenders(list => list.filter(r => r.id !== row.id));
    const { error } = await supabase.from('email_sender_stats').update({ status }).eq('id', row.id);
    setBusy(b => { const n = { ...b }; delete n[row.id]; return n; });
    if (error) { setSenders(prev); notify("Couldn't update — try again.", 'error'); return; }
    notify(status === 'unsubscribed' ? 'Opened unsubscribe · marked done' : status === 'kept' ? 'Kept' : 'Ignored');
  };
  const openEmail = (row) => {
    // Prefer opening the exact conversation inside PrismOS (reliable; no Gmail link-routing quirks).
    if (row.thread_id) {
      try { window.__inboxOpenThreadId = row.thread_id; } catch (_) {}
      if (setView) setView('inbox');
      return;
    }
    // Fallback: deep-link Gmail straight to the exact thread/message (not a sender search).
    const em = acctEmail[row.account_id] || '';
    const anchor = row.provider_thread_id ? `#all/${row.provider_thread_id}`
      : row.provider_message_id ? `#all/${row.provider_message_id}`
      : `#search/from%3A${encodeURIComponent(row.from_address || '')}`;
    const url = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(em)}${anchor}`;
    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
  };

  const flagged = items.filter(r => r.needs_review);
  const fyiItems = items.filter(r => !r.needs_review);

  // ── styles ──
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', marginBottom: 10 };
  const chip = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: `1px solid ${c}55`, background: `${c}18`, color: c });
  const btn = (primary) => ({ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--accent)' : 'var(--border)'}`, background: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--bg-base)' : 'var(--text-2)' });
  const tabBtn = (on) => ({ padding: '9px 16px', borderRadius: 999, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', border: 'none',
    background: on ? 'var(--accent)' : 'var(--bg-hover)', color: on ? 'var(--bg-base)' : 'var(--text-2)' });

  return (
    <div className="ww-prism" style={{ maxWidth: 780, margin: '0 auto', padding: '4px 2px 40px' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontFamily:'Fraunces, serif', fontSize: 30, fontWeight: 300, letterSpacing:'-0.02em', margin: 0, color: '#F6F1E7' }}>Email review</h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '3px 0 0' }}>
          Scanned overnight. Marketing is filtered out for free — only real mail is triaged.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0 16px' }}>
        <button style={tabBtn(tab === 'review')} onClick={() => setTab('review')}>Needs review{flagged.length ? ` · ${flagged.length}` : ''}</button>
        <button style={tabBtn(tab === 'unsub')} onClick={() => setTab('unsub')}>Unsubscribe{senders.length ? ` · ${senders.length}` : ''}</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : tab === 'review' ? (
        <>
          {flagged.length === 0 && fyiItems.length === 0 && (
            <div style={{ ...card, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>
              🎉 Nothing needs your review right now. The overnight scan will refill this.
            </div>
          )}

          {flagged.map(row => {
            const c = CAT[row.category] || CAT.fyi;
            return (
              <div key={row.id} style={{ ...card, borderLeft: `3px solid ${c.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={chip(c.color)}>{c.label}</span>
                  {reasonChips(row.reasons).map(r => <span key={r.k} style={chip('#9A8038')}>{r.icon} {r.text}</span>)}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{relTime(row.received_at)}</span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.3 }}>{row.subject || '(no subject)'}</div>
                {/* The sender's NAME, not a string of text about them: if we know
                    them it opens their record. */}
                <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '3px 0 6px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <SenderLink contact={findContact(row.from_address)} name={row.from_name} address={row.from_address} size={12} />
                  {acctEmail[row.account_id] ? <span>{'\u2192 ' + acctEmail[row.account_id]}</span> : null}
                </div>
                {row.summary && <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.45, marginBottom: 8 }}>{row.summary}</div>}
                {/* The summary is Prism's read of the email. This is the email. */}
                <div style={{ marginBottom: 10 }}>
                  <ThreadDisclosure label="Read full thread">
                    <EmailThreadPanel threadId={row.thread_id} providerThreadId={row.provider_thread_id}
                      providerMessageId={row.provider_message_id} accountId={row.account_id} contacts={contacts} />
                    <EmailIdRow messageId={row.provider_message_id} threadId={row.provider_thread_id} />
                  </ThreadDisclosure>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button style={btn(true)} disabled={busy[row.id]} onClick={() => openEmail(row)}>Open</button>
                  <button style={btn(false)} disabled={busy[row.id]} onClick={() => setItemStatus(row, 'done')}>✓ Done</button>
                  <button style={btn(false)} disabled={busy[row.id]} onClick={() => setItemStatus(row, 'dismissed')}>Dismiss</button>
                  <EmailActionBar accountId={row.account_id} providerThreadId={row.provider_thread_id}
                    providerMessageId={row.provider_message_id} disabled={!!busy[row.id]}
                    onDone={onEmailActed(row)} />
                </div>
              </div>
            );
          })}

          {fyiItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 700, margin: '18px 0 8px' }}>
                Also scanned · no action needed
              </div>
              {fyiItems.map(row => {
                const c = CAT[row.category] || CAT.fyi;
                return (
                  <div key={row.id} style={{ ...card, opacity: 0.9, padding: '10px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={chip(c.color)}>{c.label}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.subject || '(no subject)'}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{relTime(row.received_at)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <SenderLink contact={findContact(row.from_address)} name={row.from_name} address={row.from_address} size={11.5} showAdd={false} />
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <ThreadDisclosure label="Read full thread">
                        <EmailThreadPanel threadId={row.thread_id} providerThreadId={row.provider_thread_id}
                          providerMessageId={row.provider_message_id} accountId={row.account_id} contacts={contacts} />
                        <EmailIdRow messageId={row.provider_message_id} threadId={row.provider_thread_id} />
                      </ThreadDisclosure>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button style={btn(false)} disabled={busy[row.id]} onClick={() => openEmail(row)}>Open</button>
                      <button style={btn(false)} disabled={busy[row.id]} onClick={() => setItemStatus(row, 'done')}>✓ Done</button>
                      <button style={btn(false)} disabled={busy[row.id]} onClick={() => setItemStatus(row, 'dismissed')}>Dismiss</button>
                      <EmailActionBar accountId={row.account_id} providerThreadId={row.provider_thread_id}
                        providerMessageId={row.provider_message_id} disabled={!!busy[row.id]}
                        onDone={onEmailActed(row)} compact />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ ...card, background: 'var(--bg-hover)', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Bulk senders you receive often but <b>never open and never reply to</b>. Unsubscribe opens the sender's own
            one-click link when we captured it, otherwise it opens them in Gmail so you can manage it there.
          </div>
          {senders.length === 0 && (
            <div style={{ ...card, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>No unsubscribe suggestions right now.</div>
          )}
          {senders.map(row => (
            <div key={row.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{row.display_name || row.sender_domain || row.sender_address}</span>
                {row.list_unsubscribe && <span style={chip('#22c55e')}>1-click available</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 8px' }}>{row.sender_address}</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
                <span><b style={{ color: 'var(--text-1)' }}>{row.msg_count_30d}</b> in 30 days</span>
                <span><b style={{ color: 'var(--text-1)' }}>{row.msg_count_total ? Math.round((row.opened_count / row.msg_count_total) * 100) : 0}%</b> opened</span>
                <span>never replied</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btn(true)} disabled={busy[row.id]} onClick={() => setSenderStatus(row, 'unsubscribed', true)}>Unsubscribe</button>
                <button style={btn(false)} disabled={busy[row.id]} onClick={() => setSenderStatus(row, 'kept', false)}>Keep</button>
                <button style={btn(false)} disabled={busy[row.id]} onClick={() => setSenderStatus(row, 'ignored', false)}>Ignore</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
