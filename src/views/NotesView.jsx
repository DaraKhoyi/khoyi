import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon, confirmDialog, notify } from '../App';
import { UploadButton, DocCard, ViewerModal, useDocPolling } from './DocumentsView';

// ═══════════════════════════════════════════════════════════════════════════
// THE LIBRARY — one store, five sections, one search.
//
// Everything written, uploaded, forwarded or said on a call lives in ONE place.
// Notes, journal, calls and documents are not four apps bolted together — they
// are SECTIONS, each a view of the same store, and a single search reaches
// across all of them at once.
//
// This replaces two scattered menu doorways ("Notes & Library" + an "Add to
// Library" group whose Documents view was the only home of semantic search).
// One entrance now.
//
// Landing = the All feed, newest first: show me my stuff the instant I arrive,
// narrow with one tap, search when I actually want to. A search-first blank box
// is a dead end; a feed is a beginning.
//
// notes.kind governs behaviour, deliberately NOT flattened: note (editable),
// journal + recording (records, read-only). documents live in their own store
// with OCR / embeddings / semantic search, surfaced here as the Documents
// section.
// ═══════════════════════════════════════════════════════════════════════════

const SECTIONS = [
  { key: 'all',       label: 'All',       tint: 'var(--accent)' },
  { key: 'note',      label: 'Notes',     tint: '#CBA35C' },
  { key: 'journal',   label: 'Journal',   tint: '#8b9dc3' },
  { key: 'recording', label: 'Calls',     tint: '#c39a6b' },
  { key: 'document',  label: 'Documents', tint: '#7fae8f' },
];
const TINT = Object.fromEntries(SECTIONS.map(s => [s.key, s.tint]));
const readOnlyKind = (k) => k === 'journal' || k === 'recording';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  if (diff < 10080) return `${Math.floor(diff / 1440)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function NotesView({ notes, setNotes, userId }) {
  const [selected, setSelected] = useState(null);
  const [openDoc, setOpenDoc] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState('all');
  const [q, setQ] = useState('');
  const [deepResults, setDeepResults] = useState(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);

  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 820);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [docs, setDocs] = useState(null);
  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    setDocs(data || []);
  }, [userId]);
  useEffect(() => { loadDocs(); }, [loadDocs]);
  useDocPolling(deepResults ? null : docs, setDocs, userId, null);

  function openNote(note) {
    setOpenDoc(null);
    setSelected(note);
    setEditTitle(note.title || '');
    setEditBody(note.body || '');
    if (!readOnlyKind(note.kind)) setTimeout(() => bodyRef.current?.focus(), 80);
  }

  async function createNote() {
    const { data, error } = await supabase.from('notes')
      .insert({ user_id: userId, title: 'Untitled', body: '', pinned: false, kind: 'note' }).select().single();
    if (error) { notify("Couldn't create the note.", 'error'); return; }
    setNotes(prev => [data, ...prev]);
    openNote(data);
  }

  function scheduleAutoSave(newTitle, newBody) {
    if (!selected) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const { data: updated, error } = await supabase.from('notes')
        .update({ title: newTitle || 'Untitled', body: newBody }).eq('id', selected.id).select().single();
      if (!error && updated) {
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
        setSelected(updated);
      }
      setSaving(false);
    }, 600);
  }
  const handleTitleChange = (e) => { setEditTitle(e.target.value); scheduleAutoSave(e.target.value, editBody); };
  const handleBodyChange  = (e) => { setEditBody(e.target.value);  scheduleAutoSave(editTitle, e.target.value); };

  async function togglePin(note, e) {
    e.stopPropagation();
    const { data: updated, error } = await supabase.from('notes').update({ pinned: !note.pinned }).eq('id', note.id).select().single();
    if (error) { notify("Couldn't update pin.", 'error'); return; }
    if (updated) setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  async function deleteNote(note, e) {
    if (e) e.stopPropagation();
    if (!await confirmDialog(`Delete "${note.title || 'this note'}"? It will be removed everywhere it appears.`)) return;
    const snapshot = note;
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (selected?.id === note.id) setSelected(null);
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) { setNotes(prev => [snapshot, ...prev.filter(n => n.id !== note.id)]); notify("Couldn't delete. Reverted.", 'error'); return; }
    await supabase.from('entity_links').delete().eq('item_type', 'note').eq('item_id', note.id);
  }

  const query = q.trim().toLowerCase();
  const matchNote = (n) => !query || (n.title || '').toLowerCase().includes(query) || (n.body || '').toLowerCase().includes(query);
  const matchDoc  = (d) => !query || (d.title || '').toLowerCase().includes(query) || (d.summary || '').toLowerCase().includes(query);

  async function runDeepSearch() {
    if (!q.trim()) { setDeepResults(null); return; }
    setDeepBusy(true);
    try {
      const { data } = await supabase.functions.invoke('document-search', { body: { query: q.trim() } });
      setDeepResults((data && data.results) || []);
    } catch (_) { setDeepResults([]); }
    setDeepBusy(false);
  }
  const clearDeep = () => setDeepResults(null);

  const noteItems = (notes || []).filter(n => (section === 'all' || (n.kind || 'note') === section) && matchNote(n))
    .map(n => ({ _t: 'note', id: n.id, kind: n.kind || 'note', title: n.title, body: n.body, pinned: n.pinned, ts: n.updated_at || n.created_at, raw: n }));
  const docItems = (docs || []).filter(() => section === 'all' || section === 'document').filter(matchDoc)
    .map(d => ({ _t: 'doc', id: d.id, kind: 'document', title: d.title, body: d.summary, status: d.status, ts: d.created_at, raw: d }));

  const feed = [...noteItems, ...docItems].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.ts) - new Date(a.ts);
  });

  const totalCount = (notes?.length || 0) + (docs?.length || 0);

  const listPane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0,
      width: narrow ? '100%' : '340px', flex: narrow ? '1 1 auto' : '0 0 340px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ minWidth: 0, flex: '1 1 0' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--accent)', fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase' }}>Everything, one place</div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: '2px 0 0' }}>Library</h1>
          <p style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }}>
            {feed.length}{query || section !== 'all' ? ' shown' : ''} · {totalCount} total
          </p>
        </div>
        <div style={{ flexShrink: 0, paddingTop: 2 }}>
          <AddMenu onNewNote={createNote} onUploaded={loadDocs} userId={userId} />
        </div>
      </div>

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
        <input value={q} onChange={e => { setQ(e.target.value); if (deepResults) setDeepResults(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && section === 'document') runDeepSearch(); }}
          placeholder="Search your whole library…"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 100, color: 'var(--text-1)', padding: '10px 14px 10px 32px', fontSize: 13.5 }} />
        {q && (
          <button onClick={() => { setQ(''); setDeepResults(null); }} aria-label="Clear search"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 16, cursor: 'pointer', padding: 4 }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
        {SECTIONS.map(sec => {
          const on = section === sec.key;
          return (
            <button key={sec.key} onClick={() => { setSection(sec.key); setDeepResults(null); }}
              style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 700,
                padding: '6px 13px', borderRadius: '100px', cursor: 'pointer',
                border: '1px solid ' + (on ? sec.tint : 'var(--border)'),
                background: on ? 'var(--accent-glow)' : 'transparent',
                color: on ? 'var(--text-1)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: 6, background: sec.tint, flex: 'none', opacity: on ? 1 : 0.6 }} />
              {sec.label}
            </button>
          );
        })}
      </div>

      {section === 'document' && q.trim() && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {deepResults !== null ? (
            <>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1 }}>{deepResults.length} by meaning for “{q.trim()}”</span>
              <button onClick={clearDeep} className="btn btn-ghost btn-sm">Clear</button>
            </>
          ) : (
            <button onClick={runDeepSearch} disabled={deepBusy} className="btn btn-primary btn-sm" style={{ width: '100%' }}>
              {deepBusy ? 'Searching by meaning…' : '⌕ Search documents by meaning'}
            </button>
          )}
        </div>
      )}

      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {section === 'document' && deepResults !== null ? (
          deepResults.length === 0
            ? <Empty icon="🔍" title="Nothing matched" sub="Try different wording." />
            : deepResults.map(d => <DocCard key={d.id} doc={d} snippet={d.snippet} onOpen={setOpenDoc} />)
        ) : feed.length === 0 ? (
          <Empty icon="✦" title={query ? 'Nothing matched' : 'Nothing here yet'} sub={query ? 'Try different wording or another section.' : 'Add a note, upload a document, or file an email.'} />
        ) : feed.map(item => item._t === 'doc'
          ? <DocRow key={'d' + item.id} item={item} active={!narrow && openDoc?.id === item.id} onOpen={() => { setSelected(null); setOpenDoc(item.raw); }} />
          : <NoteRow key={'n' + item.id} item={item} active={!narrow && selected?.id === item.id} onOpen={() => openNote(item.raw)} onPin={togglePin} />
        )}
      </div>
    </div>
  );

  const ro = selected && readOnlyKind(selected.kind);
  let readerPane;
  if (openDoc) {
    readerPane = (
      <div style={{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {narrow && <BackBar onBack={() => setOpenDoc(null)} />}
        <ViewerModal doc={openDoc} userId={userId} onClose={() => setOpenDoc(null)} onDeleted={() => { setOpenDoc(null); loadDocs(); }} />
      </div>
    );
  } else if (selected) {
    readerPane = (
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)', border: narrow ? 'none' : '1px solid var(--border)',
        borderRadius: narrow ? 0 : '14px', overflow: 'hidden', height: '100%' }}>
        <div style={{ padding: narrow ? '12px 4px 12px 0' : '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: '10px', flexShrink: 0 }}>
          {narrow && <BackBtn onClick={() => setSelected(null)} />}
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            {ro ? (
              <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: '19px', lineHeight: 1.25, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{selected.title || 'Untitled'}</div>
            ) : (
              <input className="form-input" value={editTitle} onChange={handleTitleChange} placeholder="Title…"
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'Fraunces, serif', fontSize: '19px', fontWeight: 400, background: 'transparent', border: '1px solid transparent', padding: '4px 6px' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'} onBlur={e => e.target.style.borderColor = 'transparent'} />
            )}
            <KindLine kind={selected.kind} ro={ro} saving={saving} ts={selected.updated_at} />
          </div>
          {!ro && <button onClick={e => deleteNote(selected, e)} title="Delete" style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}><Icon name="trash" size={16} /></button>}
        </div>
        {ro ? (
          <div style={{ flex: '1 1 0', overflowY: 'auto', padding: narrow ? '18px 4px' : '22px 24px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text-1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', WebkitOverflowScrolling: 'touch' }}>{selected.body || ''}</div>
        ) : (
          <textarea ref={bodyRef} value={editBody} onChange={handleBodyChange} placeholder="Start writing…"
            style={{ flex: '1 1 0', resize: 'none', background: 'transparent', border: 'none', outline: 'none', padding: narrow ? '18px 4px' : '22px 24px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text-1)', fontFamily: 'inherit', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }} />
        )}
        {!ro && <div style={{ padding: '9px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}><span style={{ fontSize: '10.5px', color: 'var(--text-3)' }}>{editBody.split(/\s+/).filter(Boolean).length} words · {editBody.length} chars</span></div>}
      </div>
    );
  } else {
    readerPane = (
      <div className="empty-state" style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty-icon"><Icon name="notes" size={28} /></div>
        <p>Select something to read</p>
      </div>
    );
  }

  if (narrow) {
    const showingReader = !!selected || !!openDoc;
    return (
      <div style={{ height: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {showingReader ? readerPane : listPane}
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

function NoteRow({ item, active, onOpen, onPin }) {
  const tint = TINT[item.kind] || TINT.note;
  const isRecord = item.kind !== 'note';
  return (
    <div onClick={onOpen} style={{
      background: active ? 'var(--accent-glow)' : 'var(--bg-card)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: '12px', padding: '13px 15px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <span style={{ flex: 'none', width: 3, alignSelf: 'stretch', borderRadius: 2, background: tint, opacity: isRecord ? 0.9 : 0.25 }} />
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.pinned && <span style={{ color: 'var(--accent)', marginRight: 5 }}><Icon name="pin" size={11} /></span>}
          {item.title || 'Untitled'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(item.body || '').replace(/[•\n]/g, ' ').trim().slice(0, 64) || 'Empty'}
        </div>
        <Meta kind={item.kind} ts={item.ts} />
      </div>
      {!isRecord && (
        <button onClick={e => onPin(item.raw, e)} title={item.pinned ? 'Unpin' : 'Pin'}
          style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', opacity: item.pinned ? 1 : 0.35, padding: 2 }}><Icon name="pin" size={15} /></button>
      )}
    </div>
  );
}

function DocRow({ item, active, onOpen }) {
  const reading = item.status && item.status !== 'ready' && item.status !== 'error';
  return (
    <div onClick={onOpen} style={{
      background: active ? 'var(--accent-glow)' : 'var(--bg-card)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: '12px', padding: '13px 15px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <span style={{ flex: 'none', width: 3, alignSelf: 'stretch', borderRadius: 2, background: TINT.document, opacity: 0.9 }} />
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ marginRight: 6 }}>📄</span>{item.title || 'Document'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {reading ? 'Reading…' : ((item.body || '').slice(0, 64) || 'No summary yet')}
        </div>
        <Meta kind="document" ts={item.ts} />
      </div>
    </div>
  );
}

function Meta({ kind, ts }) {
  const label = { journal: 'Journal', recording: 'Call', document: 'Document' }[kind];
  return (
    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
      {label && <span style={{ fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 9, color: TINT[kind] }}>{label}</span>}
      <span>{timeAgo(ts)}</span>
    </div>
  );
}

function KindLine({ kind, ro, saving, ts }) {
  const label = { journal: 'Journal', recording: 'Call', document: 'Document' }[kind];
  return (
    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {label && <span style={{ fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 9, color: TINT[kind] }}>{label}{ro ? ' · read-only' : ''}</span>}
      <span>{ro ? 'Updated ' + timeAgo(ts) : (saving ? 'Saving…' : 'Saved')}</span>
    </div>
  );
}

function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', border: '1px dashed var(--border)', borderRadius: 14 }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', marginTop: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function BackBtn({ onClick }) {
  return <button onClick={onClick} aria-label="Back to list" style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 15, fontWeight: 700, padding: '4px 10px' }}>‹ Back</button>;
}
function BackBar({ onBack }) {
  return <div style={{ padding: '10px 0', flexShrink: 0 }}><BackBtn onClick={onBack} /></div>;
}

function AddMenu({ onNewNote, onUploaded, userId }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn-add-circle btn-add-circle-sm" onClick={() => setOpen(o => !o)} title="Add to library" aria-label="Add to library">+</button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 71, width: 220, background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 12, padding: 6, boxShadow: '0 12px 30px rgba(0,0,0,.5)' }}>
            <MenuItem icon="📝" label="New note" onClick={() => { setOpen(false); onNewNote(); }} />
            <div style={{ padding: '2px 4px' }}>
              <UploadButton userId={userId} onUploaded={() => { setOpen(false); onUploaded(); }} label="📄 Upload a document" />
            </div>
            <MenuItem icon="🎙️" label="Upload a recording" onClick={() => { setOpen(false); try { window.__attachRecording && window.__attachRecording(); } catch (_) {} }} />
          </div>
        </>
      )}
    </span>
  );
}
function MenuItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 9, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '10px 10px', fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>
      <span style={{ fontSize: 15 }}>{icon}</span>{label}
    </button>
  );
}

export default NotesView;
