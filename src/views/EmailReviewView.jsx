import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../dataService';

// SENDERS TO UNSUBSCRIBE FROM (was "Email review").
//
// 1 Oct 2026 — the panel asked whether the overnight email read reaches a screen
// anyone acts on. It did not: its "needs review" list lived here, 3,460 items
// open and 9 ever acted on. A second inbox is a second pile. What the overnight
// read flags now appears in the Inbox's "This week" with the reason on the row
// (supabase/sql/2026-10-01e_flagged_mail_reaches_the_inbox.sql), and this screen
// keeps the one thing that is not mail to read: bulk senders worth leaving.
// Reached from Inbox → ⋯.
const notify = (m, t = 'success') => { try { window.__notify && window.__notify(m, t); } catch (_) {} };

// ── main view ────────────────────────────────────────────────────────
export default function EmailReviewView({ emailAccounts = [], setView }) {
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});   // id -> true while an action runs

  const acctEmail = useMemo(() => {
    const m = {}; (emailAccounts || []).forEach(a => { m[a.id] = a.email_address; }); return m;
  }, [emailAccounts]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('email_sender_stats').select('*')
      .eq('unsubscribe_recommended', true).eq('status', 'active')
      .order('msg_count_30d', { ascending: false }).limit(300);
    if (error) notify('Could not load the list: ' + (error.message || error), 'error');
    setSenders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── actions ──
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
  // ── styles ──
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', marginBottom: 10 };
  const chip = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: `1px solid ${c}55`, background: `${c}18`, color: c });
  const btn = (primary) => ({ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--accent)' : 'var(--border)'}`, background: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--bg-base)' : 'var(--text-2)' });
  return (
    <div className="ww-prism" style={{ maxWidth: 780, margin: '0 auto', padding: '4px 2px 40px' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontFamily:'Fraunces, serif', fontSize: 30, fontWeight: 300, letterSpacing:'-0.02em', margin: 0, color: '#F6F1E7' }}>Senders to unsubscribe from</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '4px 0 14px' }}>
          Mail you get often and never open. Leaving these keeps your inbox quiet.
          {setView && <> <button type="button" onClick={() => setView('inbox')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Back to Inbox ›</button></>}
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
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
