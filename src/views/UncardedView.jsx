import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// People you already know, who PrismOS has never met.
//
// Dara has emailed 588 different addresses. 102 have a contact card. The other
// 486 exist only inside a mailbox: they cannot be called, tracked, tagged,
// profiled or surfaced by anything the app does. That is not a data problem, it
// is a book of business sitting outside the system.
//
// Bulk-creating all 486 would be worse than leaving it, because the vendors and
// blast senders would bury the real relationships. So this ranks them and adds
// them one tap at a time.
//
// Ranking favours YOUR outbound over their inbound: writing to someone twice is
// a stronger signal of a relationship than receiving forty newsletters. Anyone
// you have written to fewer than twice is left out entirely.

function since(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return days + 'd ago';
  if (days < 365) return Math.round(days / 30) + 'mo ago';
  return (days / 365).toFixed(1) + 'y ago';
}

function guessName(row) {
  const n = String(row.name || '').replace(/^['"]|['"]$/g, '').trim();
  if (n && !/^[\w.+-]+@/.test(n)) return n;
  // Fall back to the address: "brooke.dacosta" -> "Brooke Dacosta".
  const local = String(row.email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim();
  return local.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || row.email;
}

export default function UncardedView({ setView }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [added, setAdded] = useState({});
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('uncarded_correspondents', { p_limit: 300 });
      if (error) { setRows([]); return; }
      setRows(Array.isArray(data) ? data : []);
    } catch (_) { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (row) => {
    setBusy(row.email);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u && u.user && u.user.id;
      if (!uid) { setBusy(''); return; }
      // INSERT first, then set phone/email separately — the contacts trigger
      // rewrites the scalar fields from the jsonb arrays on insert.
      const { data: made, error } = await supabase.from('contacts')
        .insert({ user_id: uid, name: guessName(row), email: String(row.email).toLowerCase(),
                  source: 'correspondence' })
        .select('id').maybeSingle();
      if (error) {
        try { window.__notify && window.__notify('Could not add: ' + error.message, 'error'); } catch (_) {}
        setBusy(''); return;
      }
      setAdded(a => ({ ...a, [row.email]: made && made.id }));
      // Their whole email history appears on the card immediately — the timeline
      // matches on address, so nothing needs importing. DISC is queued by a
      // trigger when there is enough history to read.
      try { window.__notify && window.__notify(guessName(row) + ' added — their email history is already on the card.', 'success'); } catch (_) {}
    } finally { setBusy(''); }
  };

  const hide = async (row) => {
    setBusy(row.email);
    try {
      await supabase.rpc('lead_sender_rule', { p_sender: row.email, p_kind: 'not_a_lead', p_note: 'not a contact' });
      setRows(list => (list || []).filter(r => r.email !== row.email));
    } finally { setBusy(''); }
  };

  const list = (rows || []).filter(r => {
    if (!q.trim()) return true;
    const s = (r.email + ' ' + (r.name || '')).toLowerCase();
    return s.includes(q.trim().toLowerCase());
  });

  return (
    <div style={{ padding: '0 2px' }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: '#EBCB82' }}>
        People you know
      </div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 30, margin: '4px 0 6px', display: 'flex', minWidth: 0 }}>
        <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>Not in your contacts.</span>
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 12 }}>
        You have written to each of these people at least twice, and none of them has a contact record.
        Ranked by how much of the conversation was yours, then by how recent it is.
      </div>
      <div style={{ height: 1, background: 'linear-gradient(90deg,#C5A95E,transparent)', marginBottom: 14 }} />

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or address"
        style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text-1)', fontSize: 13.5, marginBottom: 12, boxSizing: 'border-box' }} />

      {rows === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Reading your mail…</div>
      ) : !list.length ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {q.trim() ? 'Nobody matches that.' : 'Everyone you correspond with has a contact record.'}
        </div>
      ) : list.map(r => {
        const isAdded = !!added[r.email];
        return (
          <div key={r.email} style={{
            border: '1px solid ' + (isAdded ? 'rgba(197,169,94,.45)' : 'var(--border)'),
            borderRadius: 12, padding: '11px 13px', marginBottom: 8,
            opacity: isAdded ? 0.65 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {guessName(r)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{since(r.last_at)}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', wordBreak: 'break-all', marginTop: 1 }}>{r.email}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 5 }}>
              {r.sent + ' from you \u00B7 ' + r.received + ' from them'}
              {r.first_at ? <span>{' \u00B7 since ' + new Date(r.first_at).getFullYear()}</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
              {isAdded ? (
                <button type="button" onClick={() => { try { window.__openContact && window.__openContact(added[r.email]); } catch (_) {} }}
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)' }}>
                  Open their record
                </button>
              ) : (
                <>
                  <button type="button" disabled={busy === r.email} onClick={() => add(r)}
                    style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: '#EBCB82', border: 'none', color: '#1a1205' }}>
                    {busy === r.email ? 'Adding…' : '+ Add contact'}
                  </button>
                  <button type="button" disabled={busy === r.email} onClick={() => hide(r)}
                    title="Not a person I need a record for — hides them from this list for good"
                    style={{ fontSize: 12, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                    Not a contact
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
