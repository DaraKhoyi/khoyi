// SingleContactPicker — searchable single-contact selector.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { canHover, pickerInitials } from '../helpers';

export default function SingleContactPicker({ value, onChange, contacts, setContacts, currentContactId, userId, refFilter, placeholder, defaultNewContactType = 'other' }) {
  const [inputText, setInputText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const [serverResults, setServerResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [extra, setExtra] = useState({}); // id -> full contact fetched from the server (for display beyond the loaded set)

  const selected = value ? (contacts.find(c => c.id === value) || extra[value] || null) : null;
  const refMissing = value && !selected;

  // Apply ref_filter (e.g. lender field only shows vendor/partner contacts)
  // and exclude the current contact (no self-links).
  const pool = useMemo(() => {
    let p = contacts || [];
    if (refFilter && Array.isArray(refFilter.contact_type_in) && refFilter.contact_type_in.length) {
      p = p.filter(c => refFilter.contact_type_in.includes(c.type));
    }
    if (currentContactId) p = p.filter(c => c.id !== currentContactId);
    return p;
  }, [contacts, refFilter, currentContactId]);

  const q = inputText.trim().toLowerCase();
  const refKey = refFilter && Array.isArray(refFilter.contact_type_in) ? refFilter.contact_type_in.join(',') : '';

  // Server-side search: query the database as you type so EVERY contact is
  // findable, even ones not among the rows loaded into memory (future-proof
  // past the client load cap). Debounced; merged with instant in-memory hits.
  useEffect(() => {
    const safeQ = q.replace(/[,()%*\\]/g, ' ').trim();
    if (!userId || safeQ.length < 2) { setServerResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        let query = supabase.from('contacts')
          .select('*')
          .or(`name.ilike.*${safeQ}*,email.ilike.*${safeQ}*,company.ilike.*${safeQ}*`)
          .order('name')
          .limit(12);
        if (refKey) query = query.in('type', refKey.split(','));
        const { data } = await query;
        if (cancelled) return;
        const rows = data || [];
        if (rows.length) setExtra(prev => { const next = { ...prev }; rows.forEach(r => { next[r.id] = r; }); return next; });
        setServerResults(rows);
      } catch {
        if (!cancelled) setServerResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, userId, refKey]);

  const suggestions = useMemo(() => {
    if (!q) return [];
    const matchFn = c => {
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const company = (c.company || '').toLowerCase();
      return name.includes(q) || email.includes(q) || company.includes(q);
    };
    const sortFn = (a, b) => {
      const aN = (a.name || '').toLowerCase();
      const bN = (b.name || '').toLowerCase();
      const aStart = aN.startsWith(q) ? 0 : 1;
      const bStart = bN.startsWith(q) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return aN.localeCompare(bN);
    };
    const inMem = pool.filter(matchFn).sort(sortFn);
    const seen = new Set(inMem.map(c => c.id));
    if (currentContactId) seen.add(currentContactId);
    // Server-only hits (not already loaded in memory), respecting the same filters
    const serverExtra = serverResults.filter(c => {
      if (seen.has(c.id)) return false;
      if (refKey && !refKey.split(',').includes(c.type)) return false;
      return true;
    });
    return [...inMem, ...serverExtra].slice(0, 8);
  }, [q, pool, serverResults, currentContactId, refKey]);

  const exactMatch = q && pool.some(c => (c.name || '').toLowerCase() === q);
  const showCreateOption = q.length >= 2 && !exactMatch;

  function pick(id) {
    if (setContacts && !contacts.some(c => c.id === id)) {
      const full = extra[id] || serverResults.find(c => c.id === id);
      if (full) setContacts(prev => prev.some(c => c.id === id) ? prev : [...prev, full].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }
    onChange(id);
    setInputText('');
    setShowDropdown(false);
    setHighlightIdx(0);
    setServerResults([]);
  }
  function clearSelection() {
    onChange(null);
    setInputText('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function createAndPick() {
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
      pick(data.id);
      if (window.__notify) window.__notify(`Created contact: ${name}`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Could not create: ' + err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e) {
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
      if (highlightIdx < suggestions.length && suggestions[highlightIdx]) {
        pick(suggestions[highlightIdx].id);
      } else if (showCreateOption) {
        createAndPick();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

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

  // VIEW: selected → chip with avatar + remove
  if (selected) {
    return (
      <div style={{
        display:'flex',alignItems:'center',gap:'8px',
        padding:'7px 10px',background:'var(--bg-base)',
        border:'1px solid var(--border)',borderRadius:'6px',
      }}>
        <span style={{
          width:'28px',height:'28px',borderRadius:'50%',
          background:'var(--bg-hover)',display:'flex',
          alignItems:'center',justifyContent:'center',
          fontSize:'10.5px',fontWeight:700,color:'var(--text-2)',flexShrink:0,
        }}>{pickerInitials(selected.name, selected.email)}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:'12.5px',fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {selected.name || '(unnamed)'}
          </div>
          {(selected.email || selected.company) && (
            <div style={{fontSize:'10.5px',color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {selected.email || ''}{selected.email && selected.company ? ' · ' : ''}{selected.company || ''}
            </div>
          )}
        </div>
        <button type="button" onClick={clearSelection}
          title="Remove" aria-label="Remove linked contact"
          style={{
            background:'none',border:'none',color:'var(--text-3)',
            cursor:'pointer',fontSize:'15px',padding:'2px 6px',
            borderRadius:'4px',lineHeight:1,
          }}>×</button>
      </div>
    );
  }

  // VIEW: missing-ref (value points to a deleted contact)
  if (refMissing) {
    return (
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'7px 10px',background:'var(--bg-base)',
        border:'1px dashed var(--red)',borderRadius:'6px',
        fontSize:'11.5px',color:'var(--red)',
      }}>
        <span style={{fontStyle:'italic'}}>Linked contact was deleted</span>
        <button type="button" onClick={clearSelection}
          style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:'15px',padding:'2px 6px'}}>×</button>
      </div>
    );
  }

  // VIEW: nothing selected → search input + dropdown
  return (
    <div ref={containerRef} style={{position:'relative'}}>
      <input ref={inputRef} type="text" value={inputText}
        onChange={(e) => { setInputText(e.target.value); setShowDropdown(true); setHighlightIdx(0); }}
        onFocus={() => { if (inputText) setShowDropdown(true); }}
        onKeyDown={onKeyDown}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        placeholder={placeholder || 'Search contacts…'}
        style={{
          width:'100%',
          background:'var(--bg-base)',color:'var(--text-1)',
          border:'1px solid var(--border)',borderRadius:'6px',
          padding:'7px 9px',fontSize:'12.5px',outline:'none',
        }}/>

      {showDropdown && (suggestions.length > 0 || showCreateOption || searching) && (
        <div style={{
          position:'absolute',top:'100%',left:0,right:0,marginTop:'3px',
          background:'var(--bg-card)',border:'1px solid var(--border)',
          borderRadius:'8px',boxShadow:'0 10px 24px rgba(0,0,0,0.4)',
          maxHeight:'260px',overflowY:'auto',zIndex:200,
        }}>
          {searching && suggestions.length === 0 && (
            <div style={{padding:'9px 11px',fontSize:'11.5px',color:'var(--text-3)',fontStyle:'italic'}}>↻ Searching all contacts…</div>
          )}
          {suggestions.map((c, idx) => (
            <button key={c.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(c.id); }}
              onMouseEnter={() => { if (!canHover()) return; setHighlightIdx(idx); }}
              style={{
                width:'100%',padding:'8px 11px',
                background: idx === highlightIdx ? 'var(--bg-hover)' : 'transparent',
                border:'none',cursor:'pointer',color:'var(--text-1)',
                display:'flex',alignItems:'center',gap:'10px',textAlign:'left',
                borderBottom:'1px solid var(--border)',
              }}>
              <span style={{
                width:'26px',height:'26px',borderRadius:'50%',
                background:'var(--bg-hover)',display:'flex',
                alignItems:'center',justifyContent:'center',
                fontSize:'10px',fontWeight:700,color:'var(--text-2)',flexShrink:0,
              }}>{pickerInitials(c.name, c.email)}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'12.5px',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {c.name || '(unnamed)'}
                </div>
                {(c.email || c.company || c.type) && (
                  <div style={{fontSize:'10.5px',color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {c.email || c.company || ''}
                    {c.email && c.company ? ` · ${c.company}` : ''}
                    {!c.email && !c.company && c.type ? c.type : ''}
                  </div>
                )}
              </div>
            </button>
          ))}
          {showCreateOption && (
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); createAndPick(); }}
              onMouseEnter={() => { if (!canHover()) return; setHighlightIdx(suggestions.length); }}
              disabled={creating}
              style={{
                width:'100%',padding:'9px 11px',
                background: highlightIdx === suggestions.length ? 'var(--bg-hover)' : 'transparent',
                border:'none',cursor: creating ? 'wait' : 'pointer',color:'var(--accent)',
                display:'flex',alignItems:'center',gap:'8px',textAlign:'left',
                fontSize:'12.5px',fontWeight:600,
              }}>
              <span style={{
                width:'26px',height:'26px',borderRadius:'50%',
                background:'rgba(197,169,94,0.15)',display:'flex',
                alignItems:'center',justifyContent:'center',
                fontSize:'14px',color:'var(--accent)',flexShrink:0,
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
