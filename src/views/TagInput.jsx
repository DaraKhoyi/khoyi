// TagInput — chips + typeahead. The thing you actually touch when tagging.
//
// FAILURE CONDITION this is written against: it has failed if tagging takes more
// than a couple of seconds, if the same idea ends up spelled three ways, or if a
// tag someone relies on disappears without them knowing.
//
// What follows from that:
//
//   TYPEAHEAD FIRST, CREATE SECOND. The suggestion list is the whole defence
//   against "vip" / "VIP" / "v.i.p." — you have to actively skip past an existing
//   tag to make a near-duplicate. "Create" only ever appears when nothing matches.
//
//   COMMIT ON TAB, COMMA OR ENTER. Three habits, all of them right. Comma is what
//   people type naturally, Tab is what they press when a suggestion is highlighted,
//   Enter is what they press when they mean it.
//
//   BACKSPACE ON AN EMPTY BOX REMOVES THE LAST CHIP. Standard, expected, and it
//   saves reaching for a mouse mid-flow.
//
//   COMPANY TAGS LOOK DIFFERENT. Gold, with a small mark. You can apply them
//   freely; you just cannot rename or delete them, and seeing which is which
//   before you click is kinder than telling you afterwards.
//
// Records store the SLUG. The label is display only, so renaming a tag never
// detaches it from anything.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { canHover } from '../helpers';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';

export const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Shared loader so several pickers on one screen don't each hit the database. */
export function useTagVocabulary() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = React.useCallback(async () => {
    try {
      const { data } = await supabase.rpc('tags_available');
      setTags(Array.isArray(data) ? data : []);
    } catch (_) { setTags([]); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { tags, loading, reload };
}

export default function TagInput({ value = [], onChange, vocabulary = [], onVocabularyChange, placeholder }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const bySlug = useMemo(() => {
    const m = {};
    for (const t of vocabulary) if (!m[t.slug] || t.company) m[t.slug] = t;   // company wins a clash
    return m;
  }, [vocabulary]);

  const q = slugify(text);
  const matches = useMemo(() => {
    if (!text.trim()) {
      // Nothing typed: offer what is already used most, so the common case is one tap.
      return vocabulary.filter(t => !value.includes(t.slug))
        .sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 8);
    }
    const needle = text.toLowerCase().trim();
    return vocabulary
      .filter(t => !value.includes(t.slug) && (t.label.toLowerCase().includes(needle) || t.slug.includes(q)))
      .sort((a, b) => {
        const as = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
        const bs = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
        return as - bs || (b.uses || 0) - (a.uses || 0);
      }).slice(0, 8);
  }, [text, vocabulary, value, q]);

  const exact = !!q && vocabulary.some(t => t.slug === q);
  const canCreate = !!q && !exact && !value.includes(q);

  useEffect(() => { setHi(0); }, [text]);
  useEffect(() => {
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const addSlug = (slug) => {
    if (!slug || value.includes(slug)) { setText(''); return; }
    onChange([...value, slug]);
    setText('');
    setOpen(false);
  };

  const createAndAdd = async (label) => {
    const slug = slugify(label);
    if (!slug) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('tag_save', { p: { label: label.trim(), company: false } });
      if (error || (data && data.ok === false)) {
        if (window.__notify) window.__notify((data && data.error) || 'Could not create that tag.', 'error');
      } else if (onVocabularyChange) { onVocabularyChange(); }
    } catch (_) { /* the chip still applies; the vocabulary entry can catch up */ }
    setBusy(false);
    addSlug(slug);
  };

  const commit = () => {
    if (matches.length && hi < matches.length && text.trim()) return addSlug(matches[hi].slug);
    if (canCreate) return createAndAdd(text);
    if (matches.length && !text.trim()) return addSlug(matches[hi].slug);
  };

  const onKeyDown = (e) => {
    if (e.key === ',' ) { e.preventDefault(); commit(); return; }
    if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
    if (e.key === 'Tab') {
      // Only swallow Tab when there is something to commit, so tabbing between
      // fields still works when the box is empty.
      if (text.trim() || (open && matches.length)) { e.preventDefault(); commit(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, Math.max(matches.length - 1, 0))); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); return; }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Backspace' && !text && value.length) { onChange(value.slice(0, -1)); return; }
  };

  const chip = (slug) => {
    const t = bySlug[slug];
    const company = !!(t && t.company);
    return (
      <span key={slug} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999,
        padding: '3px 8px 3px 10px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
        background: company ? 'rgba(203,163,92,.16)' : 'var(--bg-base)',
        color: company ? CHAMP : 'var(--text-1)',
        border: '1px solid ' + (company ? 'rgba(203,163,92,.45)' : 'var(--border)'),
      }}>
        {company && <span title="Company tag" style={{ fontSize: 9, opacity: .85 }}>◆</span>}
        {t ? t.label : slug}
        <button type="button" aria-label={'Remove ' + (t ? t.label : slug)}
          onClick={() => onChange(value.filter(s => s !== slug))}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1, opacity: .65, padding: 0 }}>×</button>
      </span>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div onClick={() => inputRef.current && inputRef.current.focus()}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', cursor: 'text',
          background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 9px', minHeight: 42 }}>
        {value.map(chip)}
        <input ref={inputRef} value={text} disabled={busy}
          onChange={e => { const v = e.target.value; if (v.includes(',')) { setText(v.replace(/,/g, '')); setTimeout(commit, 0); } else setText(v); }}
          onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          placeholder={value.length ? '' : (placeholder || 'Type a tag, then Tab or comma…')}
          style={{ flex: '1 1 90px', minWidth: 90, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-1)', fontSize: 14, fontFamily: 'inherit', padding: '3px 2px' }} />
      </div>

      {open && (matches.length > 0 || canCreate) && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', marginTop: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 10px 28px rgba(0,0,0,.45)', overflow: 'hidden', maxHeight: 250, overflowY: 'auto' }}>
          {matches.map((t, i) => (
            <button key={t.slug} type="button" onMouseEnter={() => { if (!canHover()) return; setHi(i); }} onClick={() => addSlug(t.slug)}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, textAlign: 'left',
                background: i === hi ? 'rgba(203,163,92,.12)' : 'transparent', border: 'none', cursor: 'pointer',
                padding: '9px 12px', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--text-1)' }}>
              {t.company && <span style={{ color: GOLD, fontSize: 9 }}>◆</span>}
              <span style={{ flex: 1 }}>{t.label}</span>
              {t.uses > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.uses}</span>}
            </button>
          ))}
          {canCreate && (
            <button type="button" onClick={() => createAndAdd(text)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                border: 'none', borderTop: matches.length ? '1px solid var(--border)' : 'none', cursor: 'pointer',
                padding: '9px 12px', fontFamily: 'inherit', fontSize: 13.5, color: CHAMP }}>
              Create “{text.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
