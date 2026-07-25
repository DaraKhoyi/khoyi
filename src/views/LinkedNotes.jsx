import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── LinkedNotes ──────────────────────────────────────────────────────────────
// Notes attached to ANY entity, read from the single `notes` store through
// public.entity_links — replacing contact_notes and property_notes, which were
// separate tables holding the same thing with different foreign keys.
//
// Why it mattered: a thought about the warehouse landed in a different TABLE
// depending on which screen you happened to be looking at when you typed it,
// and no single search could see all of them. Now there is one store, one
// full-text index, and a note can hang off a contact AND a property AND a
// project at once.
//
// `kind` is preserved and deliberately not flattened:
//   note    — a living document you edit
//   journal — a record of a moment, append-only
// Same storage, same search, same links; different behaviour. An editable
// journal stops being a reliable record of what you thought.

export default function LinkedNotes({ userId, targetType, targetId, title = 'Notes' }) {
  const [notes, setNotes] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);   // id
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!userId || !targetId) { setNotes([]); return; }
    const { data: links, error: lErr } = await supabase.from('entity_links')
      .select('item_id')
      .eq('user_id', userId).eq('item_type', 'note')
      .eq('target_type', targetType).eq('target_id', targetId);
    if (lErr) { setErr(lErr.message); setNotes([]); return; }
    const ids = (links || []).map(l => l.item_id);
    if (!ids.length) { setNotes([]); return; }
    const { data, error } = await supabase.from('notes')
      .select('id,title,body,kind,pinned,created_at,updated_at')
      .in('id', ids).order('updated_at', { ascending: false });
    if (error) { setErr(error.message); setNotes([]); return; }
    setNotes(data || []);
  }, [userId, targetType, targetId]);

  useEffect(() => { load(); }, [load]);

  // A title is derived from the first line so the global Notes list stays
  // scannable — seven rows called "(untitled)" is worse than a truncated
  // first sentence.
  const deriveTitle = (body) => {
    const first = String(body || '').replace(/\r/g, '').split('\n')[0].trim();
    return first.slice(0, 70) || 'Note';
  };

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true); setErr(null);
    const { data: note, error } = await supabase.from('notes')
      .insert({ user_id: userId, title: deriveTitle(body), body, kind: 'note', type: 'general' })
      .select().single();
    if (error) { setErr(error.message); setBusy(false); return; }
    // A note that saves but never links is findable in the library and invisible
    // where it was written — worse than failing outright, so it is checked.
    const { error: lErr } = await supabase.from('entity_links')
      .insert({ user_id: userId, item_type: 'note', item_id: note.id, target_type: targetType, target_id: targetId });
    if (lErr) {
      await supabase.from('notes').delete().eq('id', note.id);   // don't leave an orphan
      setErr('Could not attach the note: ' + lErr.message);
      setBusy(false); return;
    }
    setDraft(''); setBusy(false);
    setNotes(n => [note, ...(n || [])]);
  }

  async function save(id) {
    const body = editBody.trim();
    if (!body) return;
    const { error } = await supabase.from('notes')
      .update({ body, title: deriveTitle(body), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setErr(error.message); return; }
    setNotes(n => n.map(x => x.id === id ? { ...x, body, title: deriveTitle(body) } : x));
    setEditing(null);
  }

  async function remove(note) {
    if (!(await (window.__confirmDialog
      ? window.__confirmDialog(`Delete this note? It will be removed everywhere it appears.`, { confirmLabel: 'Delete', danger: true })
      : Promise.resolve(window.confirm('Delete this note?'))))) return;
    // Notes are removed outright rather than detached — unlike a document, a
    // note has no life of its own away from what it is about.
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) { setErr(error.message); return; }
    await supabase.from('entity_links').delete().eq('item_type', 'note').eq('item_id', note.id);
    setNotes(n => n.filter(x => x.id !== note.id));
  }

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ flex: '1 1 auto', minWidth: 0, margin: 0 }}>{title}</h3>
        <span className="nav-badge" style={{ flex: 'none' }}>{notes ? notes.length : '…'}</span>
      </div>

      {err && <div style={{ padding: '10px 14px', color: 'var(--red)', fontSize: 12 }}>{err}</div>}

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          placeholder="Write a note — it becomes searchable everywhere"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
            border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
            padding: '9px 11px', fontSize: 13, resize: 'vertical' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} onClick={add}>
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {notes && notes.length === 0 && (
        <div style={{ padding: '0 14px 14px', color: 'var(--text-3)', fontSize: 12.5 }}>
          Nothing yet.
        </div>
      )}

      {notes && notes.map(n => (
        <div key={n.id} style={{ padding: '11px 14px', borderTop: '1px solid var(--border)' }}>
          {editing === n.id ? (
            <>
              <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                  border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
                  padding: '9px 11px', fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
                <button className="btn btn-primary btn-sm" onClick={() => save(n.id)}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-3)', flex: '1 1 auto' }}>
                  {new Date(n.updated_at || n.created_at).toLocaleDateString()}
                  {n.kind === 'journal' ? ' · journal' : n.kind === 'recording' ? ' · call transcript' : ''}
                </span>
                {n.kind !== 'journal' && n.kind !== 'recording' && (
                  <button onClick={() => { setEditing(n.id); setEditBody(n.body || ''); }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Edit</button>
                )}
                {n.kind !== 'recording' && (
                  <button onClick={() => remove(n)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Delete</button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
