import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { uploadDocuments } from './DocumentsView';

// ── LinkedDocuments ──────────────────────────────────────────────────────────
// Documents attached to ANY entity — a project, a property, a deal — reading
// through public.entity_links rather than a per-container table.
//
// Why one panel and not a Documents tab per screen: a warehouse lease belongs to
// the property AND the project AND the tenant AND eventually the deal. Filed
// into any one of them it is invisible from the other three. So nothing is
// filed; everything is linked, and each screen asks the same library "what is
// attached to me?".
//
// The expensive machinery — OCR, summarisation, embeddings, full-text search —
// already exists once on `documents`. Per-container storage would either
// fragment that or force it to be rebuilt for every new container.

const GOLD = '#CBA35C';

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function StatusDot({ status }) {
  const map = {
    ready: ['#22c55e', 'ready'],
    error: ['#ef4444', 'could not read'],
  };
  const [c, t] = map[status] || [GOLD, 'reading…'];
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, flex: 'none' }}>● {t}</span>;
}

export default function LinkedDocuments({ userId, targetType, targetId, title = 'Documents' }) {
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!userId || !targetId) { setDocs([]); return; }
    const { data: links, error: lErr } = await supabase.from('entity_links')
      .select('item_id')
      .eq('user_id', userId).eq('item_type', 'document')
      .eq('target_type', targetType).eq('target_id', targetId);
    if (lErr) { setErr(lErr.message); setDocs([]); return; }
    const ids = (links || []).map(l => l.item_id);
    if (!ids.length) { setDocs([]); return; }
    const { data, error } = await supabase.from('documents')
      .select('id,title,mime_type,size_bytes,status,summary,doc_type,created_at')
      .in('id', ids).order('created_at', { ascending: false });
    if (error) { setErr(error.message); setDocs([]); return; }
    setDocs(data || []);
  }, [userId, targetType, targetId]);

  useEffect(() => { load(); }, [load]);

  // Extraction is async — poll only while something is still being read, and
  // stop as soon as everything settles rather than polling forever.
  useEffect(() => {
    if (!docs || !docs.some(d => d.status !== 'ready' && d.status !== 'error')) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [docs, load]);

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr(null);
    const made = await uploadDocuments(files, userId, [], [{ target_type: targetType, target_id: targetId }]);
    const failed = made.filter(m => m && m.error);
    if (failed.length) setErr(failed.map(f => `${f.title}: ${f.error}`).join(' · '));
    setBusy(false);
    await load();
  }

  async function unlink(doc) {
    // Detach from THIS entity only — the document stays in the library and on
    // anything else it is attached to. Deleting it outright from a project page
    // would be a destructive act disguised as tidying.
    const { error } = await supabase.from('entity_links').delete()
      .eq('user_id', userId).eq('item_type', 'document').eq('item_id', doc.id)
      .eq('target_type', targetType).eq('target_id', targetId);
    if (error) { if (window.__notify) window.__notify('Could not detach: ' + error.message, 'error'); return; }
    setDocs(d => d.filter(x => x.id !== doc.id));
    if (window.__notify) window.__notify('Detached — still in your library.', 'success');
  }

  async function open(doc) {
    const { data: full } = await supabase.from('documents').select('storage_path').eq('id', doc.id).maybeSingle();
    if (!full) return;
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(full.storage_path, 3600);
    if (error || !data) { if (window.__notify) window.__notify('Could not open: ' + ((error && error.message) || 'no link'), 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ flex: '1 1 auto', minWidth: 0, margin: 0 }}>{title}</h3>
        <span className="nav-badge" style={{ flex: 'none' }}>{docs ? docs.length : '…'}</span>
        <button className="btn btn-primary btn-sm" style={{ flex: 'none' }}
          disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? 'Uploading…' : '+ Add'}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles}
          accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.heic" />
      </div>

      {err && <div style={{ padding: '10px 14px', color: 'var(--red)', fontSize: 12 }}>{err}</div>}

      {docs === null && <div style={{ padding: '14px', color: 'var(--text-3)', fontSize: 12.5 }}>Loading…</div>}

      {docs && docs.length === 0 && (
        <div style={{ padding: '14px', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.55 }}>
          No documents yet. Anything you add here is read, summarised and made searchable —
          and stays findable from your whole library, not just this page.
        </div>
      )}

      {docs && docs.map(d => (
        <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '11px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <button type="button" onClick={() => open(d)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>
              {d.title}
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
              <StatusDot status={d.status} />
              {d.doc_type && <span style={{ fontSize: 10.5, color: GOLD, fontWeight: 700 }}>{d.doc_type}</span>}
              <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{fmtSize(d.size_bytes)}</span>
            </div>
            {d.summary && (
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.5 }}>{d.summary}</div>
            )}
          </div>
          <button type="button" onClick={() => unlink(d)} title="Detach from here — keeps it in your library"
            style={{ flex: 'none', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 100,
              color: 'var(--text-3)', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
            Detach
          </button>
        </div>
      ))}
    </div>
  );
}
