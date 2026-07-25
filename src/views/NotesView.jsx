import React, { useState, useRef } from 'react';
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

  return (
    <div style={{ display: 'flex', gap: '18px', height: 'calc(100dvh - 64px)' }}>

      {/* ── LEFT: note list ── */}
      <div style={{ width: '260px', minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap:'8px' }}>
          <div style={{minWidth:0, flex:1}}>
            <h2 style={{ fontSize: '22px', fontWeight: 700, display:'flex', alignItems:'center', gap:'10px' }}><Icon name="notes" size={26} style={{color:'var(--accent)',flexShrink:0}} />Notes</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' }}>{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
            <HeaderSearchIcon
              value={search}
              open={searchOpen}
              onToggle={() => setSearchOpen(o => !o)}
            />
            <button className="btn-add-circle btn-add-circle-sm" onClick={createNote} title="New Note" aria-label="New Note">+</button>
          </div>
        </div>

        {/* Search input — only renders when the header magnifier is toggled open.
            Icon gets an accent dot when a query is active but the bar is closed. */}
        {searchOpen && (
          <HeaderSearchInput
            value={search}
            onChange={setSearch}
            placeholder="🔍 Search notes…"
            onClose={() => setSearchOpen(false)}
            style={{marginBottom:0}}
          />
        )}

        {/* Kind filter — the one library, sliced. Journal and call transcripts
            live here too now, searchable alongside hand-written notes. */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '4px' }}>
          {[['all','All'],['note','Notes'],['journal','Journal'],['recording','Calls']].map(([k,label]) => (
            <button key={k} onClick={() => setKindFilter(k)}
              style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '100px', cursor: 'pointer',
                border: '1px solid ' + (kindFilter === k ? 'var(--accent)' : 'var(--border)'),
                background: kindFilter === k ? 'var(--accent-glow)' : 'transparent',
                color: kindFilter === k ? 'var(--accent)' : 'var(--text-3)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sorted.length === 0 && (
            <div className="empty-state"><div className="empty-icon"><Icon name="notes" size={28} /></div><p>No notes yet.<br/>Hit + New to start.</p></div>
          )}
          {sorted.map(note => (
            <div
              key={note.id}
              onClick={() => openNote(note)}
              style={{
                background: selected?.id === note.id ? 'var(--accent-glow)' : 'var(--bg-card)',
                border: `1px solid ${selected?.id === note.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '10px', padding: '12px 14px', cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {note.pinned && <span style={{ color: 'var(--accent)', marginRight: '4px' }}><Icon name="pin" size={12} /></span>}
                    {note.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {note.body?.slice(0, 50) || 'Empty note'}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {(note.kind && note.kind !== 'note') && (
                      <span style={{ fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: '9px', color: (KIND_META[note.kind] || [,'var(--text-3)'])[1] }}>{(KIND_META[note.kind] || ['',''])[0]}</span>
                    )}
                    {timeAgo(note.updated_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                  <button
                    onClick={e => togglePin(note, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', opacity: note.pinned ? 1 : 0.3, padding: '1px' }}
                    title={note.pinned ? 'Unpin' : 'Pin'}
                  ><Icon name="pin" size={14} /></button>
                  {!readOnlyKind(note.kind) && (
                    <button
                      onClick={e => deleteNote(note, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-3)', padding: '1px' }}
                      title="Delete"
                    ><Icon name="trash" size={14} /></button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: editor ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', minWidth: 0 }}>
        {!selected ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty-icon"><Icon name="notes" size={28} /></div>
            <p>Select a note or create a new one</p>
            <button className="btn-add-circle btn-add-circle-lg" style={{ marginTop: '14px' }} onClick={createNote} title="New Note" aria-label="New Note">+</button>
          </div>
        ) : (
          <>
            {/* Editor header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <input
                className="form-input"
                value={editTitle}
                onChange={handleTitleChange}
                readOnly={readOnlyKind(selected.kind)}
                placeholder="Note title…"
                style={{ fontSize: '16px', fontWeight: 700, background: 'transparent', border: '1px solid transparent', padding: '6px 8px', flex: 1 }}
                onFocus={e => { if (!readOnlyKind(selected.kind)) e.target.style.borderColor = 'var(--accent)'; }}
                onBlur={e => e.target.style.borderColor = 'transparent'}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {readOnlyKind(selected.kind)
                  ? (selected.kind === 'journal' ? 'Journal · read-only' : 'Call transcript · read-only')
                  : (saving ? <><Icon name="save" size={12} /> Saving…</> : '✓ Saved')}
              </span>
            </div>

            {/* Body */}
            <textarea
              ref={bodyRef}
              value={editBody}
              onChange={handleBodyChange}
              readOnly={readOnlyKind(selected.kind)}
              placeholder="Start writing…&#10;&#10;Use this space for project notes, build ideas, meeting notes — anything you want to save."
              style={{
                flex: 1, resize: 'none', background: 'transparent', border: 'none',
                outline: 'none', padding: '20px', fontSize: '14px', lineHeight: '1.75',
                color: readOnlyKind(selected.kind) ? 'var(--text-2)' : 'var(--text-1)', fontFamily: 'inherit',
                overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              }}
            />

            {/* Footer */}
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                {editBody.split(/\s+/).filter(Boolean).length} words · {editBody.length} chars
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                Last updated {timeAgo(selected?.updated_at)}
              </span>
            </div>
          </>
        )}
      </div>
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
