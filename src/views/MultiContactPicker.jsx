// MultiContactPicker — searchable multi-contact selector.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { canHover, pickerInitials } from '../helpers';

export default function MultiContactPicker({ value, onChange, contacts, setContacts, currentContactId, userId, placeholder, defaultNewContactType = 'other' }) {
  const [inputText, setInputText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selectedIds = useMemo(() => Array.isArray(value) ? value : [], [value]);
  const selectedContacts = selectedIds
    .map(id => contacts.find(c => c.id === id) || { id, name: '(deleted contact)', missing: true });

  const q = inputText.trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!q) return [];
    return contacts
      .filter(c => c.id !== currentContactId && !selectedIds.includes(c.id))
      .filter(c => {
        const name = (c.name || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .sort((a, b) => {
        const aN = (a.name || '').toLowerCase();
        const bN = (b.name || '').toLowerCase();
        // starts-with beats contains
        const aStart = aN.startsWith(q) ? 0 : 1;
        const bStart = bN.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return aN.localeCompare(bN);
      })
      .slice(0, 6);
  }, [q, contacts, currentContactId, selectedIds]);

  // Show the "create new" affordance unless we have an exact name match
  const exactMatch = q && contacts.some(c => (c.name || '').toLowerCase() === q && !selectedIds.includes(c.id));
  const showCreateOption = q.length >= 2 && !exactMatch;

  function addContact(id) {
    onChange([...selectedIds, id]);
    setInputText('');
    setShowDropdown(false);
    setHighlightIdx(0);
  }

  function removeContact(id) {
    onChange(selectedIds.filter(x => x !== id));
  }

  async function createAndAdd() {
    const name = inputText.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .insert({ user_id: userId, name, type: defaultNewContactType, status: 'active' })
        .select().single();
      if (error) throw error;
      if (setContacts) {
        setContacts(prev => [...prev, data].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      }
      onChange([...selectedIds, data.id]);
      setInputText('');
      setShowDropdown(false);
      setHighlightIdx(0);
      if (window.__notify) window.__notify(`Created contact: ${name}`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Could not create: ' + err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e) {
    // Range includes create-option as last "item" if shown
    const total = suggestions.length + (showCreateOption ? 1 : 0);
    if (e.key === 'ArrowDown' && total > 0) {
      e.preventDefault();
      setShowDropdown(true);
      setHighlightIdx(i => Math.min(total - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx < suggestions.length) {
        if (suggestions[highlightIdx]) addContact(suggestions[highlightIdx].id);
      } else if (showCreateOption) {
        createAndAdd();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    } else if (e.key === 'Backspace' && !inputText && selectedIds.length > 0) {
      removeContact(selectedIds[selectedIds.length - 1]);
    }
  }

  // Click-outside closes dropdown
  useEffect(() => {
    function onPointer(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, []);

  return (
    <div ref={containerRef} style={{position:'relative'}}>
      <div onClick={() => inputRef.current?.focus()}
        style={{
          display:'flex', flexWrap:'wrap', alignItems:'center', gap:'4px',
          minHeight:'36px', padding:'5px 7px', cursor:'text',
          background:'var(--bg-base)', color:'var(--text-1)',
          border:'1px solid var(--border)', borderRadius:'6px',
        }}>
        {selectedContacts.map(c => (
          <span key={c.id} title={c.email || ''}
            style={{
              display:'inline-flex', alignItems:'center', gap:'4px',
              padding:'2px 4px 2px 9px', background:'var(--bg-hover)',
              border:'1px solid var(--border)', borderRadius:'12px',
              fontSize:'11.5px', color: c.missing ? 'var(--text-3)' : 'var(--text-1)',
              fontStyle: c.missing ? 'italic' : 'normal',
            }}>
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'160px'}}>
              {c.name || '(unnamed)'}
            </span>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); removeContact(c.id); }}
              aria-label={`Remove ${c.name}`}
              style={{
                background:'none', border:'none', color:'var(--text-3)',
                cursor:'pointer', padding:'2px 4px', fontSize:'13px', lineHeight:1,
              }}>×</button>
          </span>
        ))}
        <input ref={inputRef} type="text" value={inputText}
          onChange={(e) => { setInputText(e.target.value); setShowDropdown(true); setHighlightIdx(0); }}
          onFocus={() => { if (inputText) setShowDropdown(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          placeholder={selectedContacts.length === 0 ? (placeholder || 'Type a name…') : ''}
          style={{
            flex:1, minWidth:'120px',
            border:'none', outline:'none',
            background:'transparent', color:'var(--text-1)',
            fontSize:'12.5px', padding:'3px',
          }}/>
      </div>

      {showDropdown && (suggestions.length > 0 || showCreateOption) && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:0, marginTop:'3px',
          background:'var(--bg-card)', border:'1px solid var(--border)',
          borderRadius:'8px', boxShadow:'0 10px 24px rgba(0,0,0,0.4)',
          maxHeight:'260px', overflowY:'auto', zIndex:200,
        }}>
          {suggestions.map((c, idx) => (
            <button key={c.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); addContact(c.id); }}
              onMouseEnter={() => { if (!canHover()) return; setHighlightIdx(idx); }}
              style={{
                width:'100%', padding:'8px 11px',
                background: idx === highlightIdx ? 'var(--bg-hover)' : 'transparent',
                border:'none', cursor:'pointer', color:'var(--text-1)',
                display:'flex', alignItems:'center', gap:'10px', textAlign:'left',
                borderBottom:'1px solid var(--border)',
              }}>
              <span style={{
                width:'26px', height:'26px', borderRadius:'50%',
                background:'var(--bg-hover)', display:'flex',
                alignItems:'center', justifyContent:'center',
                fontSize:'10px', fontWeight:700, color:'var(--text-2)', flexShrink:0,
              }}>{pickerInitials(c.name, c.email)}</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:'12.5px',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {c.name || '(unnamed)'}
                </div>
                {(c.email || c.type) && (
                  <div style={{fontSize:'10.5px',color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {c.email || ''}{c.email && c.type ? ' · ' : ''}{c.type || ''}
                  </div>
                )}
              </div>
            </button>
          ))}
          {showCreateOption && (
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); createAndAdd(); }}
              onMouseEnter={() => { if (!canHover()) return; setHighlightIdx(suggestions.length); }}
              disabled={creating}
              style={{
                width:'100%', padding:'9px 11px',
                background: highlightIdx === suggestions.length ? 'var(--bg-hover)' : 'transparent',
                border:'none', cursor: creating ? 'wait' : 'pointer', color:'var(--accent)',
                display:'flex', alignItems:'center', gap:'8px', textAlign:'left',
                fontSize:'12.5px', fontWeight:600,
              }}>
              <span style={{
                width:'26px', height:'26px', borderRadius:'50%',
                background:'rgba(197,169,94,0.15)', display:'flex',
                alignItems:'center', justifyContent:'center',
                fontSize:'14px', color:'var(--accent)', flexShrink:0,
              }}>+</span>
              <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {creating ? 'Creating…' : <>Create new contact: <span style={{color:'var(--text-1)'}}>"{inputText.trim()}"</span></>}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
