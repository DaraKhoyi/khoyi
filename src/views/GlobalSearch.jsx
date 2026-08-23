// GlobalSearch — one field that searches everything.
//
// FINDING #11. With 63 screens, search is the fallback when navigation fails —
// and there wasn't one. 28 of 138 views had their own search box, each scoped to
// that screen, so an agent who remembered a client's name but not whether the
// thing they needed was a note, an email, a task or a contact had to search four
// screens in turn.
//
// WHAT IT SEARCHES, and why these four:
//   Contacts       498 rows — the thing most often looked for
//   Notes          123 rows, full-text indexed and previously never queried
//   Tasks          891 rows
//   Transactions   620 rows, by address
// Email is deliberately EXCLUDED for now: 50,976 messages with no trigram index
// would make every keystroke slow, and the Inbox has its own search. Better to
// omit it honestly than to make the whole field feel broken.
//
// Results are GROUPED BY TYPE rather than blended into one relevance list. A
// blended list forces the reader to work out what each row is; grouping answers
// "is it a person or a note?" before they read a word.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';

export default function GlobalSearch({ open, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (open && inputRef.current) setTimeout(() => inputRef.current.focus(), 60); }, [open]);
  useEffect(() => { if (!open) { setQ(''); setRes(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  const run = useCallback(async (term) => {
    const t = term.trim();
    if (t.length < 2) { setRes(null); return; }
    setBusy(true);
    const like = `%${t}%`;
    try {
      // Four small queries in parallel rather than one clever union: each is
      // independently RLS-scoped, and a slow one cannot block the others.
      const [c, n, k, x] = await Promise.all([
        supabase.from('contacts').select('id,name,email,phone,company').or(`name.ilike.${like},email.ilike.${like},company.ilike.${like}`).limit(8),
        supabase.from('notes').select('id,title,body,kind').textSearch('fts', t, { type: 'websearch', config: 'english' }).limit(6),
        supabase.from('tasks').select('id,title,completed').ilike('title', like).order('completed').limit(6),
        supabase.from('brokerage_transactions').select('id,address,city,deal_status').ilike('address', like).limit(6),
      ]);
      setRes({
        contacts: c.data || [], notes: n.data || [], tasks: k.data || [], txns: x.data || [],
      });
    } catch (_) { setRes({ contacts: [], notes: [], tasks: [], txns: [] }); }
    setBusy(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  if (!open) return null;
  const total = res ? res.contacts.length + res.notes.length + res.tasks.length + res.txns.length : 0;

  const group = (title, rows, render) => rows.length ? (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.2em',
        fontSize: 10.5, fontWeight: 700, color: GOLD, marginBottom: 6 }}>{title}</div>
      {rows.map(render)}
    </div>
  ) : null;

  const row = (key, main, sub, onClick) => (
    <button key={key} onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '10px 12px', marginBottom: 6,
    }}>
      <div style={{ fontSize: 14.5, color: 'var(--text-1)', fontWeight: 600 }}>{main}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
    </button>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(8,6,4,.72)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start',
      justifyContent: 'center', padding: '60px 14px 20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#100D09',
        border: '1px solid rgba(203,163,92,.35)', borderRadius: 16, padding: 14, maxHeight: '80vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="search" size={18} style={{ color: GOLD, flexShrink: 0 }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, notes, tasks, transactions…"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-1)', fontSize: 16, fontFamily: 'inherit' }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)',
            fontSize: 20, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {q.trim().length < 2 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 2px', lineHeight: 1.55 }}>
            Type at least two letters. Searches your contacts, library notes, tasks and transactions.
            Email has its own search in the Inbox.
          </div>
        )}
        {busy && q.trim().length >= 2 && !res && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 2px' }}>Searching…</div>
        )}
        {res && total === 0 && !busy && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 2px', lineHeight: 1.55 }}>
            Nothing matched “{q.trim()}”. Try part of a name, a street, or a word from a note.
          </div>
        )}

        {res && group('People', res.contacts, (c) =>
          row('c' + c.id, c.name || '(no name)', [c.company, c.email, c.phone].filter(Boolean).join(' · '),
            () => onPick({ view: 'contacts', contactId: c.id })))}
        {res && group('Library', res.notes, (n) =>
          row('n' + n.id, n.title || '(untitled note)', String(n.body || '').slice(0, 90),
            () => onPick({ view: 'notes', noteId: n.id })))}
        {res && group('Tasks', res.tasks, (t) =>
          row('t' + t.id, t.title, t.completed ? 'done' : 'open',
            () => onPick({ view: 'tasks' })))}
        {res && group('Transactions', res.txns, (x) =>
          row('x' + x.id, x.address || '(no address)', [x.city, x.deal_status].filter(Boolean).join(' · '),
            () => onPick({ view: 'tracker' })))}
      </div>
    </div>
  );
}
