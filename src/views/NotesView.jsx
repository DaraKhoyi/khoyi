import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../dataService';
import { HeaderSearchIcon, HeaderSearchInput, Icon, confirmDialog, notify } from '../App';

function NotesView({ notes, setNotes, userId }) {
  const [selected, setSelected] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');   // all | note | journal | recording
  // Search input collapses into a header icon; open it on demand.
  const [searchOpen, setSearchOpen] = useState(false);
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);
  // On a phone the screen shows ONE thing at a time — the list, or the reader —
  // never a squeezed two-pane. The old layout forced a 260px list + editor onto
  // a 390px screen, which starved the editor to ~40px and wrapped titles one
  // letter per line. Single column below 820px; two-pane above it.
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 820);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Open a note
  function openNote(note) {
    setSelected(note);
    setEditTitle(note.title);
    setEditBody(note.body || '');
    setTimeout(() => bodyRef.current?.focus(), 80);
  }

  // New blank note
  async function createNote() {
    const { data } = await supabase.from('notes')
      .insert({ user_id: userId, title: 'Untitled', body: '', pinned: false })
      .select().single();
    if (data) {
      setNotes(prev => [data, ...prev]);
      openNote(data);
    }
  }

  // Auto-save with debounce
  function scheduleAutoSave(newTitle, newBody) {
    if (!selected) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const { data: updated } = await supabase.from('notes')
        .update({ title: newTitle || 'Untitled', body: newBody })
        .eq('id', selected.id).select().single();
      if (updated) {
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
        setSelected(updated);
      }
      setSaving(false);
    }, 600);
  }

  function handleTitleChange(e) {
    setEditTitle(e.target.value);
    scheduleAutoSave(e.target.value, editBody);
  }
  function handleBodyChange(e) {
    setEditBody(e.target.value);
    scheduleAutoSave(editTitle, e.target.value);
  }

  async function togglePin(note, e) {
    e.stopPropagation();
    const { data: updated, error } = await supabase.from('notes')
      .update({ pinned: !note.pinned }).eq('id', note.id).select().single();
    if (error) { notify("Couldn't update pin state.", 'error'); return; }
    if (updated) setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  async function deleteNote(note, e) {
    e.stopPropagation();
    if (!await confirmDialog(`Delete "${note.title}"?`)) return;
    const snapshot = note;
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (selected?.id === note.id) { setSelected(null); setEditTitle(''); setEditBody(''); }
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) {
      setNotes(prev => [snapshot, ...prev.filter(n => n.id !== note.id)]);
      notify("Couldn't delete note. Reverted.", 'error');
    }
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    if (diff < 10080) return `${Math.floor(diff / 1440)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  const filtered = notes.filter(n => {
    if (kindFilter !== 'all' && (n.kind || 'note') !== kindFilter) return false;
    const q = search.toLowerCase();
    return n.title.toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q);
  });
  const KIND_META = { note: ['Note', 'var(--text-3)'], journal: ['Journal', '#8b9dc3'], recording: ['Call', '#c39a6b'] };
  const readOnlyKind = (k) => k === 'journal' || k === 'recording';
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);
  const sorted = [...pinned, ...unpinned];

  // ── LIST (shared by phone + desktop) ────────────────────────────────────────
  const listPane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0,
      width: narrow ? '100%' : '320px', flex: narrow ? '1 1 auto' : '0 0 320px' }}>
      {/* Title row — Fraunces headline over a count, the house pattern. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ minWidth: 0, flex: '1 1 0' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--accent)', fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase' }}>Library</div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: '2px 0 0', overflowWrap: 'anywhere' }}>Notes &amp; more</h1>
          <p style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }}>{filtered.length} of {notes.length} item{notes.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, paddingTop: 2 }}>
          <HeaderSearchIcon value={search} open={searchOpen} onToggle={() => setSearchOpen(o => !o)} />
          <button className="btn-add-circle btn-add-circle-sm" onClick={createNote} title="New note" aria-label="New note">+</button>
        </div>
      </div>

      {searchOpen && (
        <HeaderSearchInput value={search} onChange={setSearch} placeholder="Search everything…" onClose={() => setSearchOpen(false)} style={{ marginBottom: 0 }} />
      )}

      {/* Filter chips — one row, scrollable rather than wrapping, so they never
          reflow the header at large type. */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
        {[['all', 'All'], ['note', 'Notes'], ['journal', 'Journal'], ['recording', 'Calls']].map(([k, label]) => (
          <button key={k} onClick={() => setKindFilter(k)}
            style={{ flex: 'none', fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '100px', cursor: 'pointer',
              border: '1px solid ' + (kindFilter === k ? 'var(--accent)' : 'var(--border)'),
              background: kindFilter === k ? 'var(--accent-glow)' : 'transparent',
              color: kindFilter === k ? 'var(--accent)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sorted.length === 0 && (
          <div className="empty-state"><div className="empty-icon"><Icon name="notes" size={28} /></div><p>Nothing here yet.</p></div>
        )}
        {sorted.map(note => {
          const meta = KIND_META[note.kind] || KIND_META.note;
          const active = !narrow && selected?.id === note.id;
          return (
            <div key={note.id} onClick={() => openNote(note)}
              style={{
                background: active ? 'var(--accent-glow)' : 'var(--bg-card)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '12px', padding: '13px 15px', cursor: 'pointer', transition: 'border-color .12s',
                display: 'flex', alignItems: 'flex-start', gap: '12px',
              }}>
              {/* colour tick keyed to kind — a calm way to tell notes / journal /
                  calls apart at a glance without a loud badge on every row. */}
              <span style={{ flex: 'none', width: '3px', alignSelf: 'stretch', borderRadius: '2px', background: meta[1], opacity: note.kind && note.kind !== 'note' ? 0.9 : 0.25 }} />
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ flex: '1 1 0', minWidth: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {note.pinned && <span style={{ color: 'var(--accent)', marginRight: '5px' }}><Icon name="pin" size={11} /></span>}
                    {note.title || 'Untitled'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(note.body || '').replace(/[•\n]/g, ' ').trim().slice(0, 64) || 'Empty'}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {note.kind && note.kind !== 'note' && (
                    <span style={{ fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: '9px', color: meta[1] }}>{meta[0]}</span>
                  )}
                  <span>{timeAgo(note.updated_at)}</span>
                </div>
              </div>
              {/* pin only in the list; delete lives in the reader so the row is a
                  clean tap target and a mis-tap cannot destroy anything. */}
              {!readOnlyKind(note.kind) && (
                <button onClick={e => togglePin(note, e)} title={note.pinned ? 'Unpin' : 'Pin'}
                  style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', opacity: note.pinned ? 1 : 0.35, padding: '2px' }}>
                  <Icon name="pin" size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── READER / EDITOR ─────────────────────────────────────────────────────────
  const ro = selected && readOnlyKind(selected.kind);
  const readerPane = selected ? (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', border: narrow ? 'none' : '1px solid var(--border)',
      borderRadius: narrow ? 0 : '14px', overflow: 'hidden', height: '100%' }}>
      {/* Header: on phone a real back button returns to the list; the title is
          Fraunces and allowed to WRAP to two lines, never truncated to a stripe. */}
      <div style={{ padding: narrow ? '12px 4px 12px 0' : '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: '10px', flexShrink: 0 }}>
        {narrow && (
          <button onClick={() => setSelected(null)} aria-label="Back to list"
            style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '15px', fontWeight: 700, padding: '4px 10px' }}>
            ‹ Back
          </button>
        )}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          {ro ? (
            <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: '19px', lineHeight: 1.25, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{selected.title || 'Untitled'}</div>
          ) : (
            <input className="form-input" value={editTitle} onChange={handleTitleChange} placeholder="Title…"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'Fraunces, serif', fontSize: '19px', fontWeight: 400, background: 'transparent', border: '1px solid transparent', padding: '4px 6px' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'} onBlur={e => e.target.style.borderColor = 'transparent'} />
          )}
          <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {selected.kind && selected.kind !== 'note' && (
              <span style={{ fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: '9px', color: (KIND_META[selected.kind] || KIND_META.note)[1] }}>
                {(KIND_META[selected.kind] || KIND_META.note)[0]}{ro ? ' · read-only' : ''}
              </span>
            )}
            <span>{ro ? 'Updated ' + timeAgo(selected.updated_at) : (saving ? 'Saving…' : 'Saved')}</span>
          </div>
        </div>
        {!ro && (
          <button onClick={e => deleteNote(selected, e)} title="Delete" aria-label="Delete note"
            style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px' }}>
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>

      {ro ? (
        // A record: rendered, not editable. Preserve line breaks and bullets.
        <div style={{ flex: '1 1 0', overflowY: 'auto', padding: narrow ? '18px 4px' : '22px 24px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text-1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', WebkitOverflowScrolling: 'touch' }}>
          {selected.body || ''}
        </div>
      ) : (
        <textarea ref={bodyRef} value={editBody} onChange={handleBodyChange} placeholder="Start writing…"
          style={{ flex: '1 1 0', resize: 'none', background: 'transparent', border: 'none', outline: 'none',
            padding: narrow ? '18px 4px' : '22px 24px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text-1)', fontFamily: 'inherit', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }} />
      )}

      {!ro && (
        <div style={{ padding: '9px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '10.5px', color: 'var(--text-3)' }}>{editBody.split(/\s+/).filter(Boolean).length} words · {editBody.length} chars</span>
        </div>
      )}
    </div>
  ) : (
    <div className="empty-state" style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="empty-icon"><Icon name="notes" size={28} /></div>
      <p>Select something to read</p>
    </div>
  );

  // ── LAYOUT ──────────────────────────────────────────────────────────────────
  // Phone: ONE pane at a time — the reader replaces the list when open.
  // Desktop: list + reader side by side.
  if (narrow) {
    return (
      <div style={{ height: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selected ? readerPane : listPane}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100dvh - 64px)', minHeight: 0 }}>
      {listPane}
      {readerPane}
    </div>
  );

}

// ─────────────────────────────────────────
// PRISM VIEW — DISC profiles + voice cards (Phase Zero foundation)
// ═════════════════════════════════════════════════════════════════════
// FINANCE MODULE — Phase 1.6 (time-cost ROI + ops report + modes)
// ═════════════════════════════════════════════════════════════════════
// Per Dara's follow-up (Jun 1, 2026):
//   - ROI for lead gen now includes TIME COST (hours × hourly_rate).
//     This is an operations report — used to evaluate what's working,
//     never enters the tax report.
//   - Gamification on the ROI report: progress bars, color thresholds.
//   - Blueprint now lists the 10 tax categories as a Chart of Accounts
//     with per-category monthly budgets the agent fills in. Advertising
//     auto-rolls from system budgets.
//   - 4 quick-start lead-gen systems offered to new agents.
//   - 5-system soft cap. Coach mode raises it.
//   - Three user modes: Agent / Partner (accountability, read-only) /
//     Coach (unlocks limits + extra reports).

export default NotesView;
