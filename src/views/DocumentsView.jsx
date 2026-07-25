import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { PrismThinking } from '../App';

const GOLD = '#C5A95E';
const TYPE_COLOR = { contract: '#ef4444', disclosure: '#f59e0b', lease: '#8b5cf6', agreement: '#3b82f6', id: '#ec4899', invoice: '#10b981', statement: '#10b981', letter: '#6b7280', report: '#0ea5e9', flyer: '#f97316', note: '#9A8038', other: '#6b7280' };
const ICON = { pdf: '📄', image: '🖼️', doc: '📝', txt: '📃' };

function kindOf(mime = '', name = '') {
  const m = (mime || '').toLowerCase(), n = (name || '').toLowerCase();
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/.test(n)) return 'image';
  if (m.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return 'doc';
  return 'txt';
}
function rel(ts) {
  if (!ts) return '';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 604800) return Math.floor(d / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// links: [{ target_type, target_id }] — a document can land on a project, a
// contact, a property and a deal at once. contactIds stays for the existing
// call sites; both funnel into the same entity_links table.
export async function uploadDocuments(files, userId, contactIds = [], links = []) {
  const created = [];
  for (const file of files) {
    try {
      const docId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${userId}/${docId}/${safe}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;
      const { data: doc, error: insErr } = await supabase.from('documents').insert({ id: docId, user_id: userId, title: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size, status: 'pending' }).select().single();
      if (insErr) throw insErr;
      if (contactIds.length) {
        const { error: dcErr } = await supabase.from('document_contacts').insert(contactIds.map(cid => ({ document_id: docId, contact_id: cid, user_id: userId })));
        if (dcErr) throw dcErr;
      }
      // Universal links. A failure here means the file uploaded but is attached
      // to nothing — findable in the library, invisible where it was dropped —
      // so it is surfaced rather than swallowed.
      const allLinks = [
        ...contactIds.map(cid => ({ target_type: 'contact', target_id: cid })),
        ...links,
      ];
      if (allLinks.length) {
        const { error: elErr } = await supabase.from('entity_links').insert(
          allLinks.map(l => ({ user_id: userId, item_type: 'document', item_id: docId, target_type: l.target_type, target_id: l.target_id }))
        );
        if (elErr) throw elErr;
      }
      supabase.functions.invoke('document-extract', { body: { document_id: docId } }); // fire; poll for status
      created.push(doc);
    } catch (e) { /* surface via caller */ created.push({ error: String(e.message || e), title: file.name }); }
  }
  return created;
}

function StatusPill({ status }) {
  if (status === 'ready') return <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>● ready</span>;
  if (status === 'error') return <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>⚠ error</span>;
  return <span style={{ fontSize: 10, fontWeight: 700, color: GOLD }}>◌ reading…</span>;
}

export function DocCard({ doc, onOpen, snippet }) {
  const k = kindOf(doc.mime_type, doc.title);
  return (
    <button onClick={() => onOpen(doc)} style={{ textAlign: 'left', width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, cursor: 'pointer', display: 'block', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
        <span style={{ fontSize: 16 }}>{ICON[k]}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', flex: 1, wordBreak: 'break-word' }}>{doc.title || 'Untitled'}</span>
        {doc.doc_type && <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em', color: '#fff', background: TYPE_COLOR[doc.doc_type] || '#6b7280', borderRadius: 5, padding: '2px 6px' }}>{doc.doc_type}</span>}
        {doc.action_needed && <span title="needs action" style={{ fontSize: 11, color: '#ef4444' }}>⚑</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45, marginBottom: 6 }}>{snippet || doc.summary || (doc.status === 'ready' ? '' : <PrismThinking label="Extracting text" />)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--text-3)' }}>
        <StatusPill status={doc.status} />
        <span>{rel(doc.created_at)}</span>
        {doc.size_bytes ? <span>{(doc.size_bytes / 1024 / 1024).toFixed(1)} MB</span> : null}
      </div>
    </button>
  );
}

export function ViewerModal({ doc, userId, onClose, onDeleted }) {
  const [full, setFull] = useState(doc);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.from('documents').select('*').eq('id', doc.id).maybeSingle().then(({ data }) => { if (alive && data) setFull(data); });
    return () => { alive = false; };
  }, [doc.id]);
  const openOriginal = async () => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(full.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };
  const del = async () => {
    if (!window.confirm('Delete this document? This removes the file and its text.')) return;
    setBusy(true);
    try { await supabase.storage.from('documents').remove([full.storage_path]); } catch (_) {}
    await supabase.from('documents').delete().eq('id', full.id);
    setBusy(false); onDeleted && onDeleted(full.id); onClose();
  };
  const markHandled = async () => { setFull(f => ({ ...f, action_needed: false })); try { await supabase.from('documents').update({ action_needed: false }).eq('id', full.id); } catch (_) {} };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base)', borderTop: `2px solid ${GOLD}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 680, maxHeight: '88vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>{ICON[kindOf(full.mime_type, full.title)]}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', wordBreak: 'break-word' }}>{full.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{full.doc_type ? full.doc_type + ' · ' : ''}{rel(full.created_at)}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>
        {full.summary && (
          <div style={{ background: 'rgba(197,169,94,.07)', border: `1px solid ${GOLD}33`, borderRadius: 9, padding: 11, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: GOLD, marginBottom: 4 }}>✨ Summary</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>{full.summary}</div>
          </div>
        )}
        {full.action_needed && (
          <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid #ef444455', borderRadius: 9, padding: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#ef4444', marginBottom: 4 }}>⚑ Needs action</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 8 }}>{full.action_label || 'This document needs a next step.'}</div>
            <button onClick={markHandled} className="btn btn-ghost btn-sm">✓ Mark handled</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={openOriginal} className="btn btn-primary btn-sm">Open original</button>
          <button onClick={del} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
        {full.status === 'error' && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>Couldn't read this file: {full.extraction_error}</div>}
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)', marginBottom: 6 }}>Extracted text</div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, margin: 0, fontFamily: 'inherit' }}>{full.extracted_text || (full.status === 'ready' ? '(no text found)' : 'Reading the document…')}</pre>
      </div>
    </div>
  );
}

export function UploadButton({ userId, contactIds, onUploaded, label = '+ Upload' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setBusy(true);
    const created = await uploadDocuments(files, userId, contactIds || []);
    setBusy(false); e.target.value = '';
    onUploaded && onUploaded(created.filter(c => !c.error));
    const failed = created.filter(c => c.error);
    if (failed.length) alert('Some files failed: ' + failed.map(f => f.title).join(', '));
  };
  return (
    <>
      <input ref={ref} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.doc,.docx,image/*,application/pdf" onChange={pick} style={{ display: 'none' }} />
      <button onClick={() => ref.current && ref.current.click()} disabled={busy} className="btn btn-primary btn-sm">{busy ? 'Uploading…' : label}</button>
    </>
  );
}

export function useDocPolling(rows, setRows, userId, contactId) {
  const pending = (rows || []).some(d => d.status === 'pending' || d.status === 'extracting');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      let query = supabase.from('documents').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
      if (contactId) query = supabase.from('documents').select('*, document_contacts!inner(contact_id)').eq('document_contacts.contact_id', contactId).order('created_at', { ascending: false });
      const { data } = await query;
      if (data) setRows(data);
    }, 4000);
    return () => clearInterval(t);
  }, [pending, userId, contactId, setRows]);
}

// ── Per-contact section (embed in contact detail) ──────────────────────────
export function ContactDocuments({ contactId, userId }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*, document_contacts!inner(contact_id)').eq('document_contacts.contact_id', contactId).order('created_at', { ascending: false });
    setRows(data || []);
  }, [contactId]);
  useEffect(() => { load(); }, [load]);
  useDocPolling(rows, setRows, userId, contactId);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)' }}>📎 Documents{rows ? ` (${rows.length})` : ''}</span>
        <div style={{ marginLeft: 'auto' }}><UploadButton userId={userId} contactIds={[contactId]} onUploaded={() => load()} /></div>
      </div>
      {rows === null ? <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Loading…</div>
        : rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No documents yet. Upload contracts, disclosures, or scans — they'll be read and searchable.</div>
          : rows.map(d => <DocCard key={d.id} doc={d} onOpen={setOpen} />)}
      {open && <ViewerModal doc={open} userId={userId} onClose={() => setOpen(null)} onDeleted={() => load()} />}
    </div>
  );
}

// ── Global hub ─────────────────────────────────────────────────────────────
export default function DocumentsView({ userId }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    setRows(data || []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  // Shared-into-app (Web Share Target): a document/photo shared from another app.
  useEffect(() => {
    const f = window.__pendingSharedDoc;
    if (!f) return;
    window.__pendingSharedDoc = null;
    (async () => { try { await uploadDocuments([f], userId, []); await load(); } catch (_) {} })();
  }, [userId, load]);
  useDocPolling(results ? null : rows, setRows, userId, null);

  const runSearch = async () => {
    if (!q.trim()) { setResults(null); return; }
    setSearching(true);
    try {
      const { data } = await supabase.functions.invoke('document-search', { body: { query: q.trim() } });
      setResults((data && data.results) || []);
    } catch (_) { setResults([]); }
    setSearching(false);
  };
  const clearSearch = () => { setQ(''); setResults(null); };

  const list = results !== null ? results : (rows || []);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'Fraunces, serif', fontWeight: 300, letterSpacing: '-0.02em' }}>Documents</h2>
        <div style={{ marginLeft: 'auto' }}><UploadButton userId={userId} onUploaded={() => load()} label="+ Upload document" /></div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>Drop in PDFs, Word docs, text files, or photos/scans. Each one is read (scans included), summarized, and made searchable — by keyword or by meaning.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} placeholder="Search your documents (e.g. “which lease mentions a pet deposit?”)" className="form-input" style={{ flex: 1, margin: 0 }} />
        {results !== null ? <button onClick={clearSearch} className="btn btn-ghost btn-sm">Clear</button> : <button onClick={runSearch} disabled={searching} className="btn btn-primary btn-sm">{searching ? '…' : 'Search'}</button>}
      </div>

      {results !== null && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 10 }}>{list.length} result{list.length === 1 ? '' : 's'} for “{q}”</div>}

      {rows === null ? <div style={{ color: 'var(--text-3)', padding: 20 }}>Loading…</div>
        : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--border)', borderRadius: 14 }}>
            <div style={{ fontSize: 30 }}>{results !== null ? '🔍' : '📁'}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', marginTop: 6 }}>{results !== null ? 'Nothing matched' : 'No documents yet'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{results !== null ? 'Try different wording.' : 'Upload a scan, contract, or PDF to get started.'}</div>
          </div>
        ) : list.map(d => <DocCard key={d.id} doc={d} snippet={d.snippet} onOpen={setOpen} />)}

      {open && <ViewerModal doc={open} userId={userId} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); if (results) runSearch(); }} />}
    </div>
  );
}
