import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon, confirmDialog, notify, TipFor, notifyError} from '../App';
import { UploadButton, DocCard, ViewerModal, useDocPolling, uploadDocuments } from './DocumentsView';

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

function NotesView({ notes, setNotes, userId, initialSub, subNonce }) {
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

  const searchInputRef = useRef(null);
  const [addOpen, setAddOpen] = useState(false);
  // Deep-links from the Library bottom bar: Search jumps to the field, Upload
  // opens the add menu, All resets the feed. subNonce lets the same sub re-fire.
  useEffect(() => {
    if (initialSub === 'search') { setSection('all'); setTimeout(() => searchInputRef.current?.focus(), 120); }
    else if (initialSub === 'upload') { setAddOpen(true); }
    else if (initialSub === 'all') { setSection('all'); setSelected(null); setOpenDoc(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSub, subNonce]);

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

  // Draft-first: opening "New note" does NOT write a row. The note lives only in
  // local state until it has real content — the first autosave with a non-empty
  // title or body is what creates it. Leaving it empty (Back/close) discards the
  // draft, so blank "Untitled" rows never accumulate in the library.
  function createNote() {
    setOpenDoc(null);
    setSelected({ id: null, draft: true, title: '', body: '', kind: 'note', pinned: false });
    setEditTitle('');
    setEditBody('');
    setTimeout(() => bodyRef.current?.focus(), 80);
  }

  const isBlank = (t, b) => !(t || '').trim() && !(b || '').trim();

  // Discard-or-keep when leaving the editor. Called by Back and by close.
  function leaveNote() {
    // A blank draft is simply forgotten; a blank *existing* note is deleted so
    // we don't leave the very rows this fixes. Non-blank notes are already saved.
    if (selected && selected.draft && isBlank(editTitle, editBody)) {
      // never persisted — nothing to clean up
    } else if (selected && !selected.draft && isBlank(editTitle, editBody)) {
      const id = selected.id;
      setNotes(prev => prev.filter(n => n.id !== id));
      supabase.from('notes').delete().eq('id', id).then(({ error }) => {
        if (error) {
          // delete didn't take — put it back rather than have it reappear on reload
          setNotes(prev => prev.some(n => n.id === id) ? prev : [selected, ...prev]);
          if (window.__notify) window.__notify('Could not remove the emptied note.', 'error');
          return;
        }
        supabase.from('entity_links').delete().eq('item_type', 'note').eq('item_id', id);
      });
    }
    setSelected(null);
  }


  function scheduleAutoSave(newTitle, newBody) {
    if (!selected) return;
    // Don't create or write a row for an entirely blank note.
    if (isBlank(newTitle, newBody)) {
      clearTimeout(saveTimer.current);
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      if (selected.draft || !selected.id) {
        // First real content — create the row now.
        const { data, error } = await supabase.from('notes')
          .insert({ user_id: userId, title: newTitle || 'Untitled', body: newBody, pinned: false, kind: 'note' })
          .select().single();
        if (!error && data) {
          setNotes(prev => [data, ...prev]);
          setSelected(data);
        }
      } else {
        const { data: updated, error } = await supabase.from('notes')
          .update({ title: newTitle || 'Untitled', body: newBody }).eq('id', selected.id).select().single();
        if (!error && updated) {
          setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
          setSelected(updated);
        }
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
          <AddMenu onNewNote={createNote} onUploaded={loadDocs} userId={userId} open={addOpen} setOpen={setAddOpen} />
        </div>
      </div>

      <TipFor screen="notes" />

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
        <input ref={searchInputRef} value={q} onChange={e => { setQ(e.target.value); if (deepResults) setDeepResults(null); }}
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
          ? <DocRow key={'d' + item.id} item={item} active={!narrow && openDoc?.id === item.id} onOpen={() => { if (selected && !readOnlyKind(selected.kind)) leaveNote(); else setSelected(null); setOpenDoc(item.raw); }} />
          : <NoteRow key={'n' + item.id} item={item} active={!narrow && selected?.id === item.id} onOpen={() => { if (selected && selected.id !== item.id && !readOnlyKind(selected.kind)) leaveNote(); openNote(item.raw); }} onPin={togglePin} />
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
          {narrow && <BackBtn onClick={() => (ro ? setSelected(null) : leaveNote())} />}
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
      <div style={{ height: 'calc(100dvh - 64px - var(--modebar-h, 76px))', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {showingReader ? readerPane : listPane}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100dvh - 64px - var(--modebar-h, 76px))', minHeight: 0 }}>
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

// AddMenu — every way something enters the library, in one place. Each item is
// wired to REAL capture + indexing, not a label:
//   New note        → a living note
//   Take a picture  → camera → uploadDocuments (image OCR'd, summarised, linked)
//   Record a voice memo → live mic → transcribed recording in the library
//   Add a photo     → gallery image → same OCR/index path
//   Add a document  → PDF / Word → OCR/index path
//   Add files       → anything → index path
//   Add a recording → existing audio file → recording pipeline
//   Share…          → team & brokerage sharing (below)
//
// `links` carries the current entity context (a project/contact/property the
// Library is scoped to) so everything captured is connected, not orphaned.
function AddMenu({ onNewNote, onUploaded, userId, links = [], open: openProp, setOpen: setOpenProp }) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp !== undefined ? openProp : openLocal;
  const setOpen = setOpenProp || setOpenLocal;
  const [sheet, setSheet] = useState(typeof window !== 'undefined' && window.innerWidth < 820);
  const [recOpen, setRecOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    const onResize = () => setSheet(window.innerWidth < 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const docRef = useRef(null);
  const filesRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handlePicked(fileList, kind) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setBusy(true); setOpen(false);
    const created = await uploadDocuments(files, userId, [], links);
    setBusy(false);
    const failed = created.filter(c => c && c.error);
    if (failed.length) notifyError(`Some ${kind} failed: ` + failed.map(f => f.title).join(', '));
    else notify(`${files.length} ${kind}${files.length > 1 ? 's' : ''} added — reading now, searchable shortly.`, 'success');
    onUploaded && onUploaded();
  }

  const items = (
    <>
      <MenuItem icon="📝" label="New note" sheet={sheet} onClick={() => { setOpen(false); onNewNote(); }} />
      <MenuItem icon="📸" label="Take a picture" sheet={sheet} onClick={() => cameraRef.current && cameraRef.current.click()} />
      <MenuItem icon="🎤" label="Record a voice memo" sheet={sheet} onClick={() => { setOpen(false); setRecOpen(true); }} />
      <MenuItem icon="🖼️" label="Add a photo" sheet={sheet} onClick={() => photoRef.current && photoRef.current.click()} />
      <MenuItem icon="📄" label="Add a document" sheet={sheet} onClick={() => docRef.current && docRef.current.click()} />
      <MenuItem icon="📁" label="Add files" sheet={sheet} onClick={() => filesRef.current && filesRef.current.click()} />
      <MenuItem icon="🎙️" label="Add a recording" sheet={sheet} onClick={() => { setOpen(false); try { window.__attachRecording && window.__attachRecording(); } catch (_) {} }} />
      <div style={{ height: 1, background: 'var(--border)', margin: '6px 8px' }} />
      <MenuItem icon="🤝" label="Share with the team" sheet={sheet} onClick={() => { setOpen(false); setShareOpen(true); }} />

      {/* hidden capture inputs — camera opens the rear camera; the rest are pickers */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { handlePicked(e.target.files, 'photo'); e.target.value = ''; }} />
      <input ref={photoRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { handlePicked(e.target.files, 'photo'); e.target.value = ''; }} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.pages,application/pdf" multiple style={{ display: 'none' }} onChange={e => { handlePicked(e.target.files, 'document'); e.target.value = ''; }} />
      <input ref={filesRef} type="file" multiple style={{ display: 'none' }} onChange={e => { handlePicked(e.target.files, 'file'); e.target.value = ''; }} />
    </>
  );

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn-add-circle btn-add-circle-sm" onClick={() => setOpen(o => !o)} title="Add to library" aria-label="Add to library">+</button>
      {busy && <span style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 100, padding: '6px 14px', fontSize: 12, color: 'var(--text-1)' }}>Uploading…</span>}
      {open && sheet && (
        // On a phone this rises from the BOTTOM as a sheet — anchored to the thumb,
        // not to whichever button (header + or bottom-bar Upload) opened it.
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.5)' }} />
          <div style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(var(--modebar-h, 76px) + 12px)', zIndex: 91, maxHeight: '70vh', overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 16, padding: 8, boxShadow: '0 -10px 40px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 800, padding: '6px 10px 8px' }}>Add to library</div>
            {items}
          </div>
        </>
      )}
      {open && !sheet && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 71, width: 244, background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 12, padding: 6, boxShadow: '0 12px 30px rgba(0,0,0,.5)' }}>
            {items}
          </div>
        </>
      )}
      {recOpen && <VoiceMemoRecorder userId={userId} links={links} onClose={() => setRecOpen(false)} onSaved={() => { setRecOpen(false); onUploaded && onUploaded(); }} />}
      {shareOpen && <ShareToTeam userId={userId} onClose={() => setShareOpen(false)} />}
    </span>
  );
}
function MenuItem({ icon, label, onClick, sheet }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 11, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 10, padding: sheet ? '14px 12px' : '10px 10px', fontSize: sheet ? 15 : 13.5, fontWeight: 600, color: 'var(--text-1)' }}>
      <span style={{ fontSize: sheet ? 18 : 15 }}>{icon}</span>{label}
    </button>
  );
}

// ── Voice memo — live microphone → transcribed recording in the library ───────
function VoiceMemoRecorder({ userId, links = [], onClose, onSaved }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => { start(); return () => { try { mediaRef.current && mediaRef.current.stop(); } catch (_) {} clearInterval(timerRef.current); }; }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch (_) {}
        const mime = mr.mimeType || 'audio/webm';
        await save(new Blob(chunksRef.current, { type: mime }), mime);
      };
      mediaRef.current = mr; mr.start(); setRecording(true);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } catch (e) { notifyError('Microphone unavailable or permission denied.'); onClose(); }
  }
  function stop() { clearInterval(timerRef.current); try { mediaRef.current && mediaRef.current.stop(); } catch (_) {} setRecording(false); }

  async function save(blob, mime) {
    setBusy(true);
    try {
      // Ingest through the real recordings pipeline: create the row, upload the
      // audio, fire transcription. The recording→notes mirror trigger then makes
      // it searchable in the library like any call, and entity_links connects it
      // to whatever the Library was scoped to.
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
      const id = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
      const title = 'Voice memo — ' + new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const { error: insErr } = await supabase.from('recordings').insert({
        id, user_id: userId, title, recorded_at: new Date().toISOString(),
        transcription_status: 'pending', first_speaker: 'me',
      });
      if (insErr) throw insErr;
      const path = `${userId}/${id}/voice-memo.${ext}`;
      const { error: upErr } = await supabase.storage.from('recordings').upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) { await supabase.from('recordings').delete().eq('id', id); throw upErr; }
      const { error: updErr } = await supabase.from('recordings').update({ storage_path: path }).eq('id', id);
      if (updErr) throw updErr;
      // connect it to the current context (project/contact/property), if any
      if (links.length) {
        await supabase.from('entity_links').insert(links.map(l => ({ user_id: userId, item_type: 'recording', item_id: id, target_type: l.target_type, target_id: l.target_id })));
      }
      supabase.functions.invoke('recording-transcribe', { body: { recording_id: id, user_id: userId } }).catch(() => {});
      notify('Voice memo saved — transcribing now.', 'success');
      onSaved && onSaved();
    } catch (e) { notifyError('Could not save the memo: ' + (e?.message || e)); }
    setBusy(false); onClose();
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(340px, 92vw)', background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: 20, color: 'var(--text-1)' }}>Voice memo</div>
        <div style={{ fontSize: 46, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-2)', margin: '18px 0', letterSpacing: '.02em' }}>{mmss}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: recording ? '#ef4444' : 'var(--text-3)', fontSize: 12, fontWeight: 700 }}>
          {recording && <span style={{ width: 9, height: 9, borderRadius: 9, background: '#ef4444', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />}
          {busy ? 'Saving…' : recording ? 'Recording' : 'Stopped'}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !recording} onClick={stop}>Stop &amp; save</button>
        </div>
      </div>
    </div>
  );
}


// ── Share with the team / brokerage ───────────────────────────────────────────
// Real sharing: sets share_scope on your most recent library items so a team or
// the whole brokerage can see them. Uses the same scope model as knowledge.
function ShareToTeam({ userId, onClose }) {
  const [teams, setTeams] = useState([]);
  const [recent, setRecent] = useState(null);
  const [picked, setPicked] = useState({});   // id -> {kind}
  const [scope, setScope] = useState('team');
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { const { data } = await supabase.rpc('my_teams'); const t = Array.isArray(data) ? data : []; setTeams(t); if (t.length) setTeamId(t[0].team_id); } catch (_) {}
      // recent private items the user could share (notes + documents)
      const [{ data: n }, { data: d }] = await Promise.all([
        supabase.from('notes').select('id,title,kind,updated_at,share_scope').eq('user_id', userId).order('updated_at', { ascending: false }).limit(15),
        supabase.from('documents').select('id,title,created_at,share_scope').eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
      ]);
      const rows = [
        ...((n || []).map(x => ({ id: x.id, kind: 'note', title: x.title || 'Untitled', shared: x.share_scope && x.share_scope !== 'private', ts: x.updated_at }))),
        ...((d || []).map(x => ({ id: x.id, kind: 'document', title: x.title || 'Document', shared: x.share_scope && x.share_scope !== 'private', ts: x.created_at }))),
      ].sort((a, b) => new Date(b.ts) - new Date(a.ts));
      setRecent(rows);
    })();
  }, [userId]);

  const toggle = (r) => setPicked(p => { const n = { ...p }; if (n[r.id]) delete n[r.id]; else n[r.id] = r.kind; return n; });

  async function share() {
    const ids = Object.entries(picked);
    if (!ids.length) { notifyError('Pick at least one item to share.'); return; }
    if (scope === 'team' && !teamId) { notifyError('Choose a team.'); return; }
    setBusy(true);
    const patch = { share_scope: scope, shared_team_id: scope === 'team' ? teamId : null, shared_at: new Date().toISOString() };
    let ok = 0, fail = 0;
    for (const [id, kind] of ids) {
      const table = kind === 'note' ? 'notes' : 'documents';
      const { error } = await supabase.from(table).update(patch).eq('id', id).eq('user_id', userId);
      if (error) fail++; else ok++;
    }
    setBusy(false);
    if (fail) notifyError(`Shared ${ok}, ${fail} failed.`);
    else notify(`Shared ${ok} item${ok !== 1 ? 's' : ''} with ${scope === 'brokerage' ? 'the whole brokerage' : 'your team'}.`, 'success');
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(420px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: 20, color: 'var(--text-1)' }}>Share with the team</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Pick items, choose who sees them.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', flexWrap: 'wrap' }}>
          <button className={'btn btn-sm ' + (scope === 'team' ? 'btn-primary' : 'btn-ghost')} onClick={() => setScope('team')}>My team</button>
          <button className={'btn btn-sm ' + (scope === 'brokerage' ? 'btn-primary' : 'btn-ghost')} onClick={() => setScope('brokerage')}>Whole brokerage</button>
          {scope === 'team' && teams.length > 0 && (
            <select className="form-input" value={teamId} onChange={e => setTeamId(e.target.value)} style={{ flex: '1 1 140px', padding: '6px 8px', fontSize: 13 }}>
              {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
            </select>
          )}
        </div>
        <div style={{ flex: '1 1 0', overflowY: 'auto', padding: '0 12px 8px' }}>
          {recent === null ? <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>Loading…</div>
            : recent.length === 0 ? <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>Nothing to share yet.</div>
            : recent.map(r => (
              <button key={r.id} onClick={() => toggle(r)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, textAlign: 'left', background: picked[r.id] ? 'var(--accent-glow)' : 'none', border: '1px solid ' + (picked[r.id] ? 'var(--accent)' : 'transparent'), borderRadius: 10, padding: '10px 12px', cursor: 'pointer', marginBottom: 4 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, border: '2px solid ' + (picked[r.id] ? 'var(--accent)' : 'var(--text-3)'), background: picked[r.id] ? 'var(--accent)' : 'transparent', flex: 'none' }} />
                <span style={{ flex: '1 1 0', minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', flex: 'none' }}>{r.kind}{r.shared ? ' · shared' : ''}</span>
              </button>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={share}>{busy ? 'Sharing…' : 'Share ' + (Object.keys(picked).length || '')}</button>
        </div>
      </div>
    </div>
  );
}

export default NotesView;
