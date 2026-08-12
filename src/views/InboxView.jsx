import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { HeaderSearchIcon, HeaderSearchInput, PriorityField, RecruitingView } from '../App';
import { decodeEntities } from '../helpers';
import AriRewriteButton from './AriRewriteButton';
import ForkTuningOverlay from './ForkTuningOverlay';
import { Tip } from '../tipsUi';
import { confirmDialog, notify, notifyError } from '../notify';
import { modal, pickerInitials } from '../helpers';

const TRIAGE_CATEGORIES = {
  urgent:            { icon: <Icon name="alert" size={13} />, label: 'Urgent',            color: '#ef4444' },
  requires_response: { icon: <Icon name="mail" size={13} />, label: 'Needs reply',       color: '#f59e0b' },
  fyi:               { icon: <Icon name="info" size={13} />, label: 'FYI',               color: '#6c63ff' },
  can_wait:          { icon: <Icon name="clock" size={13} />, label: 'Can wait',           color: '#9499b0' },
  promotional:       { icon: <Icon name="megaphone" size={13} />, label: 'Promotional',       color: '#9499b0' },
  spam:              { icon: <Icon name="trash" size={13} />, label: 'Spam',              color: '#555e7a' },
};

const TRIAGE_ACTIONS = {
  reply_now:        { label: 'Reply now' },
  reply_today:      { label: 'Reply today' },
  schedule_reply:   { label: 'Schedule a reply' },
  archive:          { label: 'Archive it' },
  ignore:           { label: 'Ignore' },
  snooze:           { label: 'Snooze' },
};

// ─── SwipeableEmailRow ───────────────────────────────────────────────
// Mobile-style swipe gestures for inbox rows:
//   - Swipe LEFT→RIGHT  → delete (trash)        🗑️  red panel reveals from the left
//   - Swipe RIGHT→LEFT  → archive               📥  green panel reveals from the right
// Visual feedback during drag: action icon and color intensify as the
// swipe approaches the commit threshold (100px). Below threshold on
// release, the row snaps back. Above threshold, it animates off-screen
// and the action fires. Vertical drags (scroll) are not captured —
// direction is locked after the first ~6px of movement.

function SwipeableEmailRow({ onArchive, onDelete, onClick, enabled = true, children }) {
  const fgRef = useRef(null);
  const deleteBgRef = useRef(null);
  const archiveBgRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const movedRef = useRef(false);
  const directionRef = useRef(null);  // 'h' | 'v' | null
  const committedRef = useRef(false);
  const THRESHOLD = 100;

  function snap() {
    if (fgRef.current) {
      fgRef.current.style.transition = 'transform .22s ease';
      fgRef.current.style.transform = 'translateX(0)';
    }
    if (deleteBgRef.current) deleteBgRef.current.style.opacity = '0';
    if (archiveBgRef.current) archiveBgRef.current.style.opacity = '0';
  }

  function flyOff(direction) {
    // direction: 1 (right, delete) or -1 (left, archive)
    if (fgRef.current) {
      const w = fgRef.current.offsetWidth || 400;
      fgRef.current.style.transition = 'transform .22s ease, opacity .22s ease';
      fgRef.current.style.transform = `translateX(${direction * (w + 80)}px)`;
      fgRef.current.style.opacity = '0';
    }
  }

  function onStart(clientX, clientY) {
    if (!enabled) return;
    startXRef.current = clientX;
    startYRef.current = clientY;
    isDraggingRef.current = true;
    movedRef.current = false;
    directionRef.current = null;
    committedRef.current = false;
    if (fgRef.current) fgRef.current.style.transition = 'none';
  }

  function onMove(clientX, clientY) {
    if (!isDraggingRef.current) return;
    const dx = clientX - startXRef.current;
    const dy = clientY - startYRef.current;
    // Direction lock after a small move — keeps vertical scroll free
    if (!directionRef.current && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      directionRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (directionRef.current !== 'h') return;
    movedRef.current = true;
    if (fgRef.current) fgRef.current.style.transform = `translateX(${dx}px)`;
    const intensity = Math.min(1, Math.abs(dx) / THRESHOLD);
    if (dx > 0) {
      if (deleteBgRef.current) deleteBgRef.current.style.opacity = String(intensity);
      if (archiveBgRef.current) archiveBgRef.current.style.opacity = '0';
    } else if (dx < 0) {
      if (archiveBgRef.current) archiveBgRef.current.style.opacity = String(intensity);
      if (deleteBgRef.current) deleteBgRef.current.style.opacity = '0';
    } else {
      if (deleteBgRef.current) deleteBgRef.current.style.opacity = '0';
      if (archiveBgRef.current) archiveBgRef.current.style.opacity = '0';
    }
  }

  function onEnd(clientX) {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const dx = clientX - startXRef.current;
    if (directionRef.current !== 'h' || !movedRef.current) {
      snap();
      return;
    }
    if (dx > THRESHOLD) {
      committedRef.current = true;
      flyOff(1);
      setTimeout(() => onDelete && onDelete(), 220);
      return;
    }
    if (dx < -THRESHOLD) {
      committedRef.current = true;
      flyOff(-1);
      setTimeout(() => onArchive && onArchive(), 220);
      return;
    }
    snap();
  }

  const wasSwipe = () => movedRef.current && directionRef.current === 'h';

  return (
    <div style={{position:'relative', overflow:'hidden'}}
      onTouchStart={(e) => { const t = e.touches[0]; onStart(t.clientX, t.clientY); }}
      onTouchMove={(e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }}
      onTouchEnd={(e) => { const t = e.changedTouches[0]; onEnd(t.clientX); }}
      onTouchCancel={() => { isDraggingRef.current = false; snap(); }}
      onMouseDown={(e) => onStart(e.clientX, e.clientY)}
      onMouseMove={(e) => { if (isDraggingRef.current) onMove(e.clientX, e.clientY); }}
      onMouseUp={(e) => onEnd(e.clientX)}
      onMouseLeave={() => { if (isDraggingRef.current) { isDraggingRef.current = false; snap(); } }}
      onClickCapture={(e) => {
        // If a horizontal swipe happened (committed or not), suppress the click.
        if (wasSwipe()) { e.stopPropagation(); e.preventDefault(); }
      }}
    >
      {/* Delete background (revealed when swiping right) */}
      <div ref={deleteBgRef} style={{
        position:'absolute', inset:0,
        background:'#ef4444',
        display:'flex', alignItems:'center', justifyContent:'flex-start',
        padding:'0 22px', gap:'8px',
        opacity:0, pointerEvents:'none',
      }}>
        <span style={{fontSize:'22px'}}><Icon name="trash" size={20} /></span>
        <span style={{fontSize:'12px', color:'#fff', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em'}}>Delete</span>
      </div>
      {/* Archive background (revealed when swiping left) */}
      <div ref={archiveBgRef} style={{
        position:'absolute', inset:0,
        background:'#10b981',
        display:'flex', alignItems:'center', justifyContent:'flex-end',
        padding:'0 22px', gap:'8px',
        opacity:0, pointerEvents:'none',
      }}>
        <span style={{fontSize:'12px', color:'#fff', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em'}}>Archive</span>
        <span style={{fontSize:'22px'}}><Icon name="archive" size={20} /></span>
      </div>
      {/* Foreground — the actual row, slides during drag */}
      <div ref={fgRef} style={{position:'relative', background:'var(--bg-base)', willChange:'transform'}}
        onClick={(e) => { if (!wasSwipe()) onClick && onClick(e); }}>
        {children}
      </div>
    </div>
  );
}

// ─── RecipientPicker ────────────────────────────────────────────────
// State-of-the-art "To" field for the email composer:
//   - Chip-based UI (each recipient becomes a removable token)
//   - Autocomplete dropdown ranked by name/email/company match + recency
//   - Keyboard nav (Arrow Up/Down, Enter/Tab/comma to commit, Esc to close,
//     Backspace at empty input removes last chip)
//   - Paste of comma-separated emails splits and commits each
//   - Tap a suggestion (mouse or touch) to commit
//   - DISC profile pill shown inline when known (matches Prism Mirror)
//   - Shape-compatible with the existing `composeTo` string state:
//     value is a comma-separated email string, onChange emits the same.
//     This means no changes to the send/reply handlers — they keep parsing
//     composeTo.split(',') and everything just works.

const RECIPIENT_DISC_COLORS = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function highlightMatch(text, q) {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{background:'rgba(197,169,94,0.30)',color:'var(--text-1)',fontWeight:700}}>
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}


function RecipientPicker({ value, onChange, contacts = [], profiles = [], placeholder, autoFocus, pendingRef }) {
  const [inputText, setInputText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  // Pending contact awaiting an email. When a user taps a no-email
  // suggestion we don't immediately commit (you can't send to a contact
  // without an email). Instead we open an inline form to capture one.
  const [pendingNoEmail, setPendingNoEmail] = useState(null);  // { contact, draftEmail }
  // Whether to render the dropdown above the input instead of below it.
  // Flipped when there isn't enough vertical space below (e.g. mobile
  // soft keyboard is open and would cover the dropdown).
  const [dropdownAbove, setDropdownAbove] = useState(false);
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(320);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  // Mirror the live, uncommitted text upward. Tapping Send must be able to flush
  // an address the user typed but never committed with Enter/Tab/comma.
  useEffect(() => { if (pendingRef) pendingRef.current = inputText; }, [inputText, pendingRef]);

  // Parse the comma-separated string into displayable chips. Each chip
  // gets a name (if a contact exists at that email) and a contactId for
  // looking up the DISC profile.
  const recipients = useMemo(() => {
    return (value || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean)
      .map(email => {
        const c = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());
        return { email, name: c?.name || '', contactId: c?.id || null };
      });
  }, [value, contacts]);

  // Suggestion ranking. Higher score = better match. We score per field:
  //   name starts-with    = 100
  //   name word-boundary  =  60
  //   name contains       =  40
  //   email starts-with   =  50
  //   email contains      =  25
  //   company starts-with =  30
  //   company contains    =  15
  // Then add +20 if there's recent communication (inbound/outbound in last
  // 30 days) — surfaces the people the user actually talks to.
  //
  // Contacts WITHOUT an email are also included (with a -30 penalty so
  // they rank below contacts that can be emailed directly). Tapping a
  // no-email suggestion opens an inline editor to add the email rather
  // than committing — the picker stays useful even when contact data is
  // incomplete, instead of looking broken.
  const suggestions = useMemo(() => {
    const q = inputText.trim().toLowerCase();
    if (!q) return [];
    const existing = new Set(recipients.map(r => r.email.toLowerCase()));
    const now = Date.now();
    const RECENCY_WINDOW = 30 * 86400000;
    const scored = [];
    for (const c of contacts) {
      if (c.email && existing.has(c.email.toLowerCase())) continue;
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const company = (c.company || '').toLowerCase();
      let score = 0;
      if (name.startsWith(q)) score += 100;
      else if (name.includes(q)) score += 40;
      // word-boundary match (typing the surname or middle word)
      const words = name.split(/\s+/);
      for (const w of words) {
        if (w !== words[0] && w.startsWith(q)) { score += 60; break; }
      }
      if (email) {
        if (email.startsWith(q)) score += 50;
        else if (email.includes(q)) score += 25;
      }
      if (company.startsWith(q)) score += 30;
      else if (company.includes(q)) score += 15;
      // Recency boost (only meaningful when we have an email anyway)
      const recent = c.last_inbound_at || c.last_outbound_at;
      if (recent && now - new Date(recent).getTime() < RECENCY_WINDOW) score += 20;
      // No-email penalty so missing-data contacts sit below those we can send to
      if (!c.email) score -= 30;
      if (score > 0) scored.push({ contact: c, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.contact.name || '').localeCompare(b.contact.name || ''));
    return scored.slice(0, 8).map(s => s.contact);
  }, [inputText, contacts, recipients]);

  // Commit a recipient (from suggestion click, keyboard, or free-form email)
  function commitRecipient(email, name, contactId) {
    if (!email) return false;
    const trimmed = String(email).trim();
    if (!EMAIL_RE.test(trimmed)) return false;
    if (recipients.some(r => r.email.toLowerCase() === trimmed.toLowerCase())) {
      // Already there — clear the input and reset
      setInputText('');
      setShowDropdown(false);
      setHighlightIdx(0);
      return true;
    }
    const next = [...recipients, { email: trimmed, name: name || '', contactId: contactId || null }];
    onChange(next.map(r => r.email).join(', '));
    setInputText('');
    setShowDropdown(false);
    setHighlightIdx(0);
    return true;
  }

  function removeRecipient(email) {
    const next = recipients.filter(r => r.email.toLowerCase() !== email.toLowerCase());
    onChange(next.map(r => r.email).join(', '));
  }

  // Persist a new email back to the contact record AND commit as a chip.
  // Called from the inline "add email" editor when the user taps a
  // contact-without-email suggestion. Updates the contact in Supabase so
  // future compose sessions find them on the first keystroke.
  async function saveAndCommitPendingEmail() {
    if (!pendingNoEmail) return;
    const email = pendingNoEmail.draftEmail.trim();
    const c = pendingNoEmail.contact;
    if (!EMAIL_RE.test(email)) return;
    // Optimistic commit so the chip lands immediately even if the DB write is slow.
    commitRecipient(email, c.name, c.id);
    setPendingNoEmail(null);
    // Best-effort write-back; non-blocking
    try {
      const { error } = await supabase.from('contacts').update({ email }).eq('id', c.id);
      if (error) throw error;
      if (window.__notify) window.__notify(`Added ${email} to ${c.name}'s contact record.`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Email saved for this message but could not be written back to the contact.', 'error');
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        setShowDropdown(true);
        setHighlightIdx(i => Math.min(suggestions.length - 1, i + 1));
        e.preventDefault();
      }
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        setShowDropdown(true);
        setHighlightIdx(i => Math.max(0, i - 1));
        e.preventDefault();
      }
    } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      // Commit. Prefer highlighted suggestion; else free-form email.
      const txt = inputText.trim();
      if (showDropdown && suggestions[highlightIdx]) {
        const c = suggestions[highlightIdx];
        commitRecipient(c.email, c.name, c.id);
        e.preventDefault();
      } else if (txt && EMAIL_RE.test(txt)) {
        commitRecipient(txt, null, null);
        e.preventDefault();
      } else if (e.key === ',') {
        // Comma with no valid email yet — just absorb it
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    } else if (e.key === 'Backspace' && inputText === '' && recipients.length > 0) {
      removeRecipient(recipients[recipients.length - 1].email);
    }
  }

  function onInputChange(e) {
    const txt = e.target.value;
    // Paste-or-type containing commas: split, commit each valid email, keep tail
    if (txt.includes(',')) {
      const parts = txt.split(',');
      const tail = parts.pop();
      let committedAny = false;
      for (const p of parts.map(s => s.trim()).filter(Boolean)) {
        if (EMAIL_RE.test(p)) {
          const c = contacts.find(c => c.email && c.email.toLowerCase() === p.toLowerCase());
          commitRecipient(p, c?.name || null, c?.id || null);
          committedAny = true;
        }
      }
      if (committedAny) {
        setInputText(tail.trim());
        setShowDropdown(Boolean(tail.trim()));
        setHighlightIdx(0);
        return;
      }
    }
    setInputText(txt);
    setShowDropdown(Boolean(txt));
    setHighlightIdx(0);
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function onDocPointer(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
        setPendingNoEmail(null);
      }
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, []);

  // Smart dropdown positioning. When the soft keyboard is open on mobile,
  // a fixed-top-100% dropdown gets covered and looks broken. Measure
  // available vertical space and flip above when needed. Recomputes on
  // visualViewport resize so it adapts as the keyboard opens/closes.
  useEffect(() => {
    if (!showDropdown) return;
    function recompute() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // visualViewport is the trustworthy "what's actually visible" value on
      // mobile when the keyboard is open. innerHeight stays at the full layout
      // viewport size and would lie about available space.
      const vv = window.visualViewport;
      const viewBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
      const viewTop = vv ? vv.offsetTop : 0;
      const below = viewBottom - rect.bottom - 8;
      const above = rect.top - viewTop - 8;
      const ideal = 320;
      const flip = below < 160 && above > below;
      setDropdownAbove(flip);
      setDropdownMaxHeight(Math.max(120, Math.min(ideal, flip ? above : below)));
    }
    recompute();
    const vv = window.visualViewport;
    window.addEventListener('resize', recompute);
    vv?.addEventListener?.('resize', recompute);
    vv?.addEventListener?.('scroll', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
      vv?.removeEventListener?.('resize', recompute);
      vv?.removeEventListener?.('scroll', recompute);
    };
  }, [showDropdown, suggestions.length, pendingNoEmail]);

  return (
    <div ref={containerRef} style={{position:'relative'}}>
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display:'flex',flexWrap:'wrap',alignItems:'center',gap:'4px',
          minHeight:'40px',padding:'5px 8px',cursor:'text',
          background:'var(--bg-base)',color:'var(--text-1)',
          border:'1px solid var(--border)',borderRadius:'8px',
          fontSize:'13px',
        }}>
        {recipients.map(r => {
          const profile = r.contactId ? profiles.find(p => p.contact_id === r.contactId) : null;
          return (
            <span key={r.email}
              style={{
                display:'inline-flex',alignItems:'center',gap:'4px',
                padding:'3px 4px 3px 9px',background:'var(--bg-hover)',
                border:'1px solid var(--border)',borderRadius:'14px',
                fontSize:'12px',color:'var(--text-1)',maxWidth:'100%',
              }}
              title={r.email}>
              <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'200px'}}>
                {r.name || r.email}
                {r.name && (
                  <span style={{color:'var(--text-3)',marginLeft:'4px',fontSize:'10.5px'}}>
                    &lt;{r.email}&gt;
                  </span>
                )}
              </span>
              {profile?.primary_letter && RECIPIENT_DISC_COLORS[profile.primary_letter] && (
                <span style={{
                  fontSize:'9px',padding:'1px 4px',borderRadius:'3px',
                  background: RECIPIENT_DISC_COLORS[profile.primary_letter],
                  color:'#fff',fontWeight:700,flexShrink:0,letterSpacing:'0.04em',
                }}>{profile.primary_letter}</span>
              )}
              <button type="button"
                onClick={(e) => { e.stopPropagation(); removeRecipient(r.email); }}
                aria-label={`Remove ${r.name || r.email}`}
                style={{
                  background:'none',border:'none',color:'var(--text-3)',
                  cursor:'pointer',padding:'2px 4px',fontSize:'14px',
                  lineHeight:1,flexShrink:0,
                }}>×</button>
            </span>
          );
        })}
        <input ref={inputRef} type="text" value={inputText}
          onChange={onInputChange} onKeyDown={onKeyDown}
          onFocus={() => { if (inputText) setShowDropdown(true); }}
          onBlur={() => { const t = inputText.trim(); if (t && EMAIL_RE.test(t)) commitRecipient(t, null, null); }}
          autoFocus={autoFocus}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          style={{
            flex:1, minWidth:'140px',
            border:'none', outline:'none',
            background:'transparent', color:'var(--text-1)',
            fontSize:'13px', padding:'4px',
          }}
          placeholder={recipients.length === 0 ? (placeholder || 'Type a name or email…') : ''}/>
      </div>

      {showDropdown && (pendingNoEmail || suggestions.length > 0 || inputText.trim().length >= 2) && (
        <div style={{
          position:'absolute',
          ...(dropdownAbove
            ? { bottom: '100%', marginBottom: '4px' }
            : { top: '100%', marginTop: '4px' }),
          left:0, right:0,
          background:'var(--bg-card)', border:'1px solid var(--border)',
          borderRadius:'8px', boxShadow:'0 10px 28px rgba(0,0,0,0.45)',
          maxHeight: `${dropdownMaxHeight}px`, overflowY:'auto', zIndex:200,
        }}>
          {pendingNoEmail ? (
            // Inline "add email" editor — shown after tapping a no-email contact.
            <div style={{padding:'12px'}}>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>
                No email on file for {pendingNoEmail.contact.name}
              </div>
              <div style={{fontSize:'12px',color:'var(--text-1)',marginBottom:'10px',lineHeight:1.5}}>
                Add one now to send and save it back to {pendingNoEmail.contact.name}'s contact record.
              </div>
              <input
                type="email" autoFocus
                value={pendingNoEmail.draftEmail}
                onChange={(e) => setPendingNoEmail({ ...pendingNoEmail, draftEmail: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveAndCommitPendingEmail();
                  } else if (e.key === 'Escape') {
                    setPendingNoEmail(null);
                  }
                }}
                placeholder="name@example.com"
                style={{
                  width:'100%', padding:'8px 10px', fontSize:'13px',
                  background:'var(--bg-base)', color:'var(--text-1)',
                  border:'1px solid var(--border)', borderRadius:'6px', outline:'none',
                }}
              />
              <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',marginTop:'10px'}}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setPendingNoEmail(null); }}
                  style={{padding:'6px 10px',fontSize:'11px',background:'transparent',color:'var(--text-3)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer'}}>
                  Cancel
                </button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); saveAndCommitPendingEmail(); }}
                  disabled={!EMAIL_RE.test(pendingNoEmail.draftEmail.trim())}
                  style={{
                    padding:'6px 12px',fontSize:'11px',fontWeight:600,
                    background: EMAIL_RE.test(pendingNoEmail.draftEmail.trim()) ? 'var(--accent)' : 'var(--bg-hover)',
                    color: EMAIL_RE.test(pendingNoEmail.draftEmail.trim()) ? 'var(--bg-base)' : 'var(--text-3)',
                    border:'none',borderRadius:'6px',
                    cursor: EMAIL_RE.test(pendingNoEmail.draftEmail.trim()) ? 'pointer' : 'not-allowed',
                  }}>
                  Save & add
                </button>
              </div>
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((c, idx) => {
              const profile = profiles.find(p => p.contact_id === c.id);
              const isHi = idx === highlightIdx;
              const noEmail = !c.email;
              return (
                <button key={c.id} type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (noEmail) {
                      setPendingNoEmail({ contact: c, draftEmail: '' });
                    } else {
                      commitRecipient(c.email, c.name, c.id);
                    }
                  }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    width:'100%', padding:'9px 11px',
                    background: isHi ? 'var(--bg-hover)' : 'transparent',
                    border:'none', cursor:'pointer', color:'var(--text-1)',
                    display:'flex', alignItems:'center', gap:'10px', textAlign:'left',
                    borderBottom: idx < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                    opacity: noEmail ? 0.85 : 1,
                  }}>
                  <span style={{
                    flexShrink:0, width:'30px', height:'30px', borderRadius:'50%',
                    background:'var(--bg-hover)', display:'flex',
                    alignItems:'center', justifyContent:'center',
                    fontSize:'10.5px', fontWeight:700, color:'var(--text-2)',
                  }}>{pickerInitials(c.name, c.email)}</span>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{
                      fontSize:'13px', fontWeight:600,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      display:'flex', alignItems:'center', gap:'6px',
                    }}>
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {highlightMatch(c.name || c.email || '(unnamed)', inputText)}
                      </span>
                      {noEmail && (
                        <span style={{
                          fontSize:'9px', padding:'1px 5px', borderRadius:'3px',
                          background:'var(--bg-base)', color:'var(--text-3)',
                          border:'1px dashed var(--border)', flexShrink:0,
                          textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:700,
                        }}>+ add email</span>
                      )}
                    </div>
                    <div style={{
                      fontSize:'11px', color:'var(--text-3)',
                      display:'flex', gap:'6px', alignItems:'center',
                      overflow:'hidden',
                    }}>
                      {c.email ? (
                        <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                          {highlightMatch(c.email, inputText)}
                        </span>
                      ) : (
                        <span style={{fontStyle:'italic'}}>tap to add an email</span>
                      )}
                      {c.company && (
                        <span style={{
                          flexShrink:0,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                          maxWidth:'160px',
                        }}>· {c.company}</span>
                      )}
                    </div>
                  </div>
                  {profile?.primary_letter && RECIPIENT_DISC_COLORS[profile.primary_letter] && (
                    <span style={{
                      fontSize:'9px', padding:'2px 5px', borderRadius:'3px',
                      background: RECIPIENT_DISC_COLORS[profile.primary_letter],
                      color:'#fff', fontWeight:700, flexShrink:0, letterSpacing:'0.04em',
                    }}>{profile.primary_letter}</span>
                  )}
                </button>
              );
            })
          ) : (
            // Empty state — query has 2+ chars but matches nothing. Better
            // than silently rendering nothing (which looks broken).
            <div style={{padding:'14px',fontSize:'12px',color:'var(--text-3)',lineHeight:1.5}}>
              <div style={{fontWeight:600,color:'var(--text-2)',marginBottom:'4px'}}>No match for "{inputText.trim()}"</div>
              {EMAIL_RE.test(inputText.trim()) ? (
                <>Press <kbd style={{padding:'1px 5px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'3px',fontSize:'10px'}}>Enter</kbd> to send to this address anyway.</>
              ) : (
                <>Keep typing the full email, or add this person in Contacts first.</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// INBOX VIEW — Gmail-aware
// Reads from email_threads/email_messages when an account is connected.
// No account? Show a connect screen. (Pass 1 Batch D removed the legacy
// fake-email LegacyInboxView and the underlying `emails` table.)
// ─────────────────────────────────────────

function InboxView({ emailAccounts, setEmailAccounts, emailAliases, setEmailAliases, profiles, contacts, userId, setView, reloadData, defaultSystem }) {

  // All connected email-capable Google accounts (locked-in once OAuth'd for email).
  const mailAccounts = emailAccounts.filter(a =>
    ((a.purposes || []).includes('email') || (a.scopes || []).some(s => s.includes('gmail'))) && a.refresh_token
  );
  const [selectedId, setSelectedId] = useState(null);
  const [pendingOpenThreadId, setPendingOpenThreadId] = useState(null);
  const account = mailAccounts.find(a => a.id === selectedId) || mailAccounts.find(a => a.is_default) || mailAccounts[0] || null;

  // Dashboard "Reply to…" deep-link. The person's thread can be on EITHER
  // connected account and thousands deep, so we resolve it against the whole
  // mailbox here (the wrapper controls which account is active), switch to the
  // owning account, and hand the exact thread id to the inbox to open.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.__inboxOpenEmail) return;
    const email = String(window.__inboxOpenEmail).toLowerCase();
    window.__inboxOpenEmail = null;
    let alive = true;
    (async () => {
      let row = null;
      try {
        const { data } = await supabase.from('email_threads').select('id, account_id, last_message_at')
          .contains('participants', [{ email }])
          .order('last_message_at', { ascending: false }).limit(1);
        if (data && data.length) row = data[0];
      } catch (_) {}
      if (!row) {
        try {
          const { data } = await supabase.from('email_messages').select('thread_id, internal_date')
            .ilike('from_address', `%${email}%`).order('internal_date', { ascending: false }).limit(1);
          if (data && data.length && data[0].thread_id) {
            const { data: tr } = await supabase.from('email_threads').select('id, account_id').eq('id', data[0].thread_id).limit(1);
            if (tr && tr.length) row = tr[0];
          }
        } catch (_) {}
      }
      if (!alive) return;
      if (row) {
        if (row.account_id) setSelectedId(row.account_id);
        setPendingOpenThreadId(row.id);
      } else {
        try { if (window.__notify) window.__notify("Couldn't find that email conversation.", 'info'); } catch (_) {}
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // Open a specific conversation by internal thread id (used by the Email Review "Open" button)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.__inboxOpenThreadId) return;
    const tid = window.__inboxOpenThreadId;
    window.__inboxOpenThreadId = null;
    let alive = true;
    (async () => {
      let row = null;
      try { const { data } = await supabase.from('email_threads').select('id, account_id').eq('id', tid).limit(1); if (data && data.length) row = data[0]; } catch (_) {}
      if (!alive) return;
      if (row) { if (row.account_id) setSelectedId(row.account_id); setPendingOpenThreadId(row.id); }
      else { try { if (window.__notify) window.__notify("Couldn't find that email conversation.", 'info'); } catch (_) {} }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  if (!account) return <InboxConnectScreen setView={setView} reloadData={reloadData} />;

  // The account switcher is built here (this component owns account selection) but is
  // RENDERED by the child, underneath the page title — so Inbox opens with its title
  // like every other screen instead of being pushed down by chrome.
  const accountSwitcher = mailAccounts.length > 1 ? (
    <div style={{ display: 'flex', gap: '8px', margin: '0 0 14px', flexWrap: 'nowrap', width: '100%' }}>
      {mailAccounts.map(a => {
        const active = a.id === account.id;
        return (
          <button key={a.id} onClick={() => setSelectedId(a.id)}
            title={a.email_address}
            style={{
              // flex:1 + minWidth:0 + ellipsis keeps both pills on ONE line at any font
              // scale. The old flexWrap:'wrap' silently stacked them instead.
              flex: '1 1 0', minWidth: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '7px 10px', borderRadius: '999px', cursor: 'pointer', fontSize: '12.5px',
              fontWeight: active ? 700 : 500,
              background: active ? 'rgba(197,169,94,0.14)' : 'var(--bg-card)',
              color: active ? '#C5A95E' : 'var(--text-2)',
              border: `1px solid ${active ? '#C5A95E' : 'var(--border)'}`,
            }}>
            <Icon name="mail" size={13} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email_address}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div>
      <GmailInboxView key={account.id} account={account} openThreadId={pendingOpenThreadId} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} profiles={profiles} contacts={contacts} userId={userId} reloadData={reloadData} defaultSystem={defaultSystem} accountSwitcher={accountSwitcher} />
    </div>
  );
}

// Shown in the Inbox tab when no Gmail account is connected.

function InboxConnectScreen({ setView, reloadData }) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  async function startOAuth() {
    try {
      setConnecting(true);
      setConnectError(null);
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { purpose: 'email' },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else throw new Error('No OAuth URL returned');
    } catch (err) {
      setConnectError(err?.message || String(err));
      setConnecting(false);
    }
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Inbox</h2></div>
      <div className="empty-state" style={{padding:'40px 20px', textAlign:'center', maxWidth:'520px', margin:'0 auto'}}>
        <h3 style={{marginBottom:'10px'}}>Connect Gmail to use your Inbox</h3>
        <p style={{color:'var(--text-2)', marginBottom:'20px'}}>
          Hook up a Gmail account and your inbox will sync here automatically.
          You can connect more than one — set each one's purpose in Settings.
        </p>
        <button className="btn btn-primary" onClick={startOAuth} disabled={connecting}>
          {connecting ? 'Opening Google…' : 'Connect Gmail'}
        </button>
        {connectError && (
          <p style={{color:'var(--red)', marginTop:'12px', fontSize:'13px'}}>{connectError}</p>
        )}
      </div>
    </div>
  );
}

// ─── Gmail inbox ─────────────────────────────────────────────────
// Renders email HTML in a sandboxed iframe. Sandbox blocks scripts/popups
// so even malicious email HTML can't escape into the app. Auto-sizes height.
// Renders a message's attachments as chips. Bytes are fetched on demand via the
// gmail-attachment edge function (keeps large files out of the DB/initial load).
// Viewable types (PDF, images) open in a new tab; everything else downloads.

function MessageAttachments({ message, account }) {
  const [atts, setAtts] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filing, setFiling] = useState(false);
  const [txnPick, setTxnPick] = useState(null); // null | { candidates, all }

  // Suggest which deal these attachments belong to (address + party match), then
  // let the person confirm — we never silently file money documents. Falls back
  // to a full picker when nothing matches.
  async function openTxnPicker() {
    setFiling(true);
    try {
      const to = Array.isArray(message.to_addresses) ? message.to_addresses : (message.to_addresses ? [message.to_addresses] : []);
      const { data: matches } = await supabase.rpc('match_email_to_txn', {
        p_subject: message.subject || '', p_body: message.body_text || message.snippet || '',
        p_from: message.from_address || '', p_to: to,
      });
      const { data: all } = await supabase.rpc('txn_pipeline');
      setTxnPick({ candidates: Array.isArray(matches) ? matches : [], all: Array.isArray(all) ? all : [] });
    } catch (e) {
      notifyError('Could not look up deals: ' + (e?.message || e));
    } finally { setFiling(false); }
  }

  async function fileToTxn(txnId) {
    setFiling(true); setTxnPick(null);
    try {
      const { data, error } = await supabase.functions.invoke('email-file-to-library', {
        body: { account_id: account.id, message_id: message.id, links: [{ target_type: 'transaction', target_id: txnId }] },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not file');
      if (data.filed === 0) notify(data.note || 'Nothing fileable on this message.', 'info');
      else notify(`Filed ${data.filed} to the transaction file.`, 'success');
    } catch (e) {
      notifyError('Could not file to the deal: ' + (e?.message || e));
    } finally { setFiling(false); }
  }

  // File the message's PDF/image/doc attachments into the shared library — one
  // tap, server-side, OCR'd and searchable, and auto-linked to the sender. This
  // is how reference material actually arrives: as an email attachment.
  async function fileToLibrary() {
    setFiling(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-file-to-library', {
        body: { account_id: account.id, message_id: message.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not file');
      if (data.filed === 0) notify(data.note || 'Nothing fileable on this message.', 'info');
      else notify(`Filed ${data.filed} to your library${data.linked_to_sender ? ' — linked to the sender' : ''}. Searchable once read.`, 'success');
    } catch (e) {
      notifyError('Could not file to library: ' + (e?.message || e));
    } finally { setFiling(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('email_attachments')
        .select('id, filename, mime_type, size_bytes, provider_attachment_id')
        .eq('message_id', message.id);
      if (!cancelled) setAtts(data || []);
    })();
    return () => { cancelled = true; };
  }, [message.id]);

  if (!atts || atts.length === 0) return null;

  const fmtSize = (n) => !n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
  const iconFor = (mt) => (mt || '').startsWith('image/') ? '🖼' : (mt || '') === 'application/pdf' ? '📄' : (mt || '').includes('sheet') || (mt || '').includes('excel') ? '📊' : (mt || '').includes('word') ? '📝' : '📎';

  async function open(att) {
    setBusy(att.id);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-attachment', {
        body: { account_id: account.id, provider_message_id: message.provider_message_id, provider_attachment_id: att.provider_attachment_id },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Could not fetch attachment');
      const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: att.mime_type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const viewable = /^(image\/|application\/pdf)/.test(att.mime_type || '');
      const a = document.createElement('a');
      a.href = url;
      if (viewable) a.target = '_blank'; else a.download = att.filename || 'attachment';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      notifyError('Could not open attachment: ' + (e?.message || e));
    } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', flex: '1 1 auto' }}>
          <Icon name="paperclip" size={12} /> {atts.length} attachment{atts.length !== 1 ? 's' : ''}
        </span>
        {atts.some(a => /^(application\/pdf|image\/|application\/(msword|vnd)|text\/plain)/.test(a.mime_type || '') && (a.size_bytes || 0) >= 3000) && (<>
          <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} disabled={filing} onClick={fileToLibrary}
            title="Save these to your searchable library, linked to the sender">
            {filing ? 'Filing…' : '＋ File to library'}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} disabled={filing} onClick={openTxnPicker}
            title="File these to the matching transaction">
            ＋ File to a deal
          </button>
        </>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {atts.map(att => (
          <button key={att.id} onClick={() => open(att)} disabled={busy === att.id}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', maxWidth: '100%' }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>{iconFor(att.mime_type)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
              <span style={{ fontSize: '12.5px', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '210px' }}>{att.filename || 'attachment'}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>{busy === att.id ? 'Opening…' : fmtSize(att.size_bytes)}</span>
            </span>
            <span style={{ fontSize: '14px', color: 'var(--accent)', flexShrink: 0 }}>↓</span>
          </button>
        ))}
      </div>
      {txnPick && <TxnFilePicker pick={txnPick} onClose={() => setTxnPick(null)} onChoose={fileToTxn} />}
    </div>
  );
}

// Suggest-first transaction picker: matched deals up top with the reason, then a
// searchable list of every active deal as a fallback. The person always confirms.
function TxnFilePicker({ pick, onClose, onChoose }) {
  const [qy, setQy] = useState('');
  const matchedIds = new Set((pick.candidates || []).map(c => c.id));
  const others = (pick.all || []).filter(d => !matchedIds.has(d.id) && (!qy || (d.address || '').toLowerCase().includes(qy.toLowerCase())));
  const Row = ({ d, reason }) => (
    <button onClick={() => onChoose(d.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--bg-card,#1B1610)', border: '1px solid ' + (reason ? 'rgba(197,169,94,.5)' : 'var(--border,#2a2016)'), borderRadius: 10, padding: '11px 13px', marginBottom: 8, cursor: 'pointer' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{d.address || 'Untitled deal'}</div>
      <div style={{ fontSize: 11.5, color: reason ? '#EBCB82' : 'var(--text-3)', marginTop: 2 }}>
        {reason ? '✓ ' + reason : `${d.agent_name || d.agent_name_raw || '—'} · ${(d.stage || '').replace(/_/g, ' ')}`}
      </div>
    </button>
  );
  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base,#0f0b07)', border: '1px solid #2a2016', borderRadius: 8, color: 'var(--text-1)', padding: '10px 12px', fontSize: 14, marginBottom: 12 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 240, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-base,#100D09)', width: '100%', maxWidth: 500, maxHeight: '80vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', border: '1px solid #2a2016', padding: '18px 18px 34px' }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 21, color: 'var(--text-1)', marginBottom: 3 }}>File to a deal.</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>These attachments will be filed into the transaction you pick.</div>
        {pick.candidates && pick.candidates.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#C5A95E', marginBottom: 8 }}>Best match</div>
            {pick.candidates.map(c => <Row key={c.id} d={c} reason={c.addr_reason || c.party_reason} />)}
          </div>
        )}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 8 }}>{pick.candidates && pick.candidates.length ? 'Or another deal' : 'Pick a deal'}</div>
        <input value={qy} onChange={e => setQy(e.target.value)} placeholder="Search by address…" style={inp} />
        {others.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No other active deals.</div> : others.slice(0, 30).map(d => <Row key={d.id} d={d} />)}
      </div>
    </div>
  );
}


function EmailHtmlFrame({ html }) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Wrap in a basic style so dark-mode email content stays readable.
    // <base target="_blank"> ensures every link opens in a new tab instead of
    // trying to navigate the (sandboxed) iframe itself.
    const wrapped = `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light only">
      <base target="_blank" rel="noopener noreferrer">
      <style>
        /* Force LIGHT rendering: many emails (e.g. Google Calendar invites) ship
           a prefers-color-scheme:dark stylesheet that turns text near-white. On a
           phone in dark mode that produced white-on-white. Pinning light mode keeps
           those dark-mode overrides from firing so the email shows as authored. */
        :root, html { color-scheme: light only; }
        /* Emails are authored for a white canvas — render them that way so the
           sender's own text colors stay readable (dark-on-dark was the bug). */
        html, body { margin: 0; padding: 0; background: #ffffff; }
        body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; background: #ffffff; word-wrap: break-word; overflow-wrap: anywhere; -webkit-text-size-adjust: 100%; }
        a { color: #1a56db; word-break: break-word; }
        a:visited { color: #6b3fa0; }
        img { max-width: 100%; height: auto; display: inline-block; }
        table { max-width: 100% !important; }
        td, th { max-width: 100%; word-wrap: break-word; }
        blockquote { border-left: 3px solid #d0d5dd; padding-left: 12px; color: #555; margin: 8px 0; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        * { max-width: 100%; box-sizing: border-box; }
      </style></head><body>${html}</body></html>`;
    iframe.srcdoc = wrapped;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          // Belt and suspenders: also patch any explicit target on links
          // (some emails set target="_self" which would override <base>)
          doc.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          });
          const h = Math.min(1200, Math.max(100, doc.body.scrollHeight + 24));
          setHeight(h);
        }
      } catch (_) { /* cross-origin shouldn't happen with srcdoc */ }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [html]);
  return (
    <iframe
      ref={iframeRef}
      title="email-body"
      // allow-popups + allow-popups-to-escape-sandbox so target="_blank" links open;
      // allow-same-origin so we can read scrollHeight from the iframe document
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height: `${height}px`, border: 'none', borderRadius: '8px', background: '#ffffff', colorScheme: 'light' }}
    />
  );
}

// Render plain-text email bodies with auto-linked URLs, markdown-style [text](url),
// and angle-bracket <https://...> URLs. Each detected URL becomes a clickable link.

function PlainTextBody({ text }) {
  if (!text) return null;
  // Parse the text into segments: plain text and links
  // Three patterns to detect, in priority order:
  //   1. [text](url)           — markdown link
  //   2. <https://url>         — angle-bracketed URL
  //   3. https://url           — bare URL
  const segments = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"')\]]+)/g;
  let lastIdx = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: text.substring(lastIdx, match.index) });
    }
    if (match[1]) {
      // Markdown link [label](url)
      segments.push({ type: 'link', label: match[2], url: match[3] });
    } else if (match[4]) {
      // <https://...>
      segments.push({ type: 'link', label: match[4], url: match[4] });
    } else if (match[5]) {
      // Bare URL
      segments.push({ type: 'link', label: match[5], url: match[5] });
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'text', value: text.substring(lastIdx) });
  }
  return (
    <div style={{fontSize:'14px',lineHeight:'1.7',color:'var(--text-1)',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
      {segments.map((s, i) => s.type === 'text'
        ? <span key={i}>{s.value}</span>
        : <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
            style={{color:'var(--accent)',wordBreak:'break-all'}}>{s.label}</a>
      )}
    </div>
  );
}


function GmailInboxView({ account, openThreadId, setEmailAccounts, emailAliases, setEmailAliases, profiles, contacts, userId, reloadData, defaultSystem = 'eisenhower', accountSwitcher = null }) {
  // A name in an email header is only useful if it gets you to the record. Built
  // once from the contact list rather than scanned per render — a long thread
  // renders this for every sender and every recipient.
  const contactByEmail = React.useMemo(() => {
    const m = new Map();
    for (const c of (contacts || [])) {
      if (c && c.email) m.set(String(c.email).trim().toLowerCase(), c);
      // People have more than one address; the jsonb array is the real source.
      if (Array.isArray(c?.emails)) {
        for (const e of c.emails) {
          const v = typeof e === 'string' ? e : (e && e.value);
          if (v) m.set(String(v).trim().toLowerCase(), c);
        }
      }
    }
    return m;
  }, [contacts]);
  const findContact = React.useCallback(
    (email) => (email ? contactByEmail.get(String(email).trim().toLowerCase()) || null : null),
    [contactByEmail]);
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [tab, setTab] = useState('inbox');
  const [selectedThread, setSelectedThread] = useState(null);
  // Open-tracking status for the currently open thread (shown as a "Likely seen" chip).
  const [threadTracking, setThreadTracking] = useState(null);
  useEffect(() => {
    setThreadTracking(null);
    if (!selectedThread) return;
    const emails = (selectedThread.participants || []).map(p => String((p && (p.email || p.address)) || '').toLowerCase()).filter(Boolean);
    if (!emails.length) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('email_tracking')
          .select('status,confident_open_at,last_open_at,open_count,apple_mpp,sent_at')
          .in('to_address', emails).order('sent_at', { ascending: false }).limit(1);
        if (alive && data && data.length) setThreadTracking(data[0]);
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [selectedThread]);
  const [selectedMessages, setSelectedMessages] = useState([]);
  // Rapid delete/archive: after acting we advance to the next email and show a
  // brief Undo affordance instead of bouncing back to the list.
  const [undoState, setUndoState] = useState(null); // { kind:'trash'|'archive', thread }
  const undoTimer = useRef(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  // Email → Task: create a task from the open email (AI-summarized title,
  // email body as notes, optional due date, linked to the sender's contact).
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);   // AI summarizing the title
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskContact, setTaskContact] = useState(null);
  const [taskSrc, setTaskSrc] = useState({});

  // Client-side search across visible threads — collapses into a header icon.
  // Matches subject, snippet, sender name, and sender address (lowercased).
  // Filtering is local; we don't refetch from the server when typing.
  const [inboxSearch, setInboxSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Pass 4 Batch D: email triage (per Q2 = auto on sync + persist + full output)
  // triageCache is a map { thread_id → triage_row } populated lazily as we
  // open threads or as background auto-triage finishes. Mirrors what's in the
  // email_triage table; lets the UI render synchronously without DB round-trips.
  const [triageCache, setTriageCache] = useState({});
  const [triageLoading, setTriageLoading] = useState({});  // { thread_id → true }
  const [autoTriageProgress, setAutoTriageProgress] = useState(null);  // { done, total } | null
  // Pass 5 Batch A: abort + concurrency control for auto-triage.
  // autoTriageAbortRef.current.aborted is checked between iterations so we
  // can bail on unmount or account change (Finding #7, Q3=B).
  // autoTriageRunningRef stops a second concurrent run kicking off (Finding #3).
  const autoTriageAbortRef = useRef({ aborted: false });
  const autoTriageRunningRef = useRef(false);
  // Pass 5 Finding #8: track the runBackfill cleanup timer so we can cancel
  // it on unmount/account change rather than firing setState on dead component.
  const backfillCleanupTimerRef = useRef(null);
  // Bail any in-flight triage loop when this InboxView unmounts OR when the
  // active account.id changes (Q3=B). Reset abort flag so a fresh mount works.
  useEffect(() => {
    autoTriageAbortRef.current = { aborted: false };
    return () => {
      autoTriageAbortRef.current.aborted = true;
      if (backfillCleanupTimerRef.current) {
        clearTimeout(backfillCleanupTimerRef.current);
        backfillCleanupTimerRef.current = null;
      }
    };
  }, [account.id]);

  // Responsive: on mobile (<900px), tapping a thread fully replaces the list
  // view with the reading pane. On desktop, both panels show side-by-side.
  const [isMobileWidth, setIsMobileWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 900 : false
  );
  useEffect(() => {
    function onResize() { setIsMobileWidth(window.innerWidth < 900); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Single-pane reading: below ~1200px (incl. a windowed laptop) opening a
  // thread replaces the list with a FULL-WIDTH reader so HTML emails aren't
  // crammed into a sliver. Above that, a roomy two-pane layout.
  const [singlePane, setSinglePane] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1200 : false
  );
  useEffect(() => {
    function onR() { setSinglePane(window.innerWidth < 1200); }
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  // Full-width reader toggle (wide screens only): hide the list and let the
  // reader fill the window. Ignored on singlePane, which is already full width.
  const [readerExpanded, setReaderExpanded] = useState(false);
  const readingPaneRef = useRef(null);

  // More menu — rendered in a portal to escape the toolbar's overflow clipping
  const moreButtonRef = useRef(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, right: 0 });
  // Re-measure position when menu opens (and when window resizes/scrolls while open)
  useEffect(() => {
    function measure() {
      if (!moreButtonRef.current) return;
      const r = moreButtonRef.current.getBoundingClientRect();
      setMoreMenuPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    measure();
  }, []);

  // Pickers and dropdowns
  const [showSnoozePicker, setShowSnoozePicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [customSnoozeDate, setCustomSnoozeDate] = useState('');

  // User's Gmail labels (custom, type='user')
  const [userLabels, setUserLabels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('gmail_labels')
        .select('*').eq('account_id', account.id).eq('type', 'user').order('name');
      if (!cancelled && data) setUserLabels(data);
    })();
    return () => { cancelled = true; };
  }, [account.id]);

  // Close popovers on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setShowSnoozePicker(false);
        setShowMoreMenu(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function refreshLabels() {
    try {
      await supabase.functions.invoke('gmail-labels-sync', { body: { account_id: account.id } });
      const { data } = await supabase.from('gmail_labels')
        .select('*').eq('account_id', account.id).eq('type', 'user').order('name');
      if (data) setUserLabels(data);
    } catch (_) { /* non-fatal */ }
  }
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const composeBodyRef = useRef(null);   // lets Ari rewrite just a highlighted passage
  const [composeAttachments, setComposeAttachments] = useState([]); // [{filename, mime_type, content_base64, size}]
  const [composeTrack, setComposeTrack] = useState(false); // opt-in open tracking, OFF by default
  const composeAttachRef = useRef(null);
  const COMPOSE_MAX_ATTACH_BYTES = 20 * 1024 * 1024; // ~20MB Gmail-safe budget
  useEffect(() => { if (!showCompose) { setComposeAttachments([]); setComposeTrack(false); } }, [showCompose]); // clear on close so next open is clean
  async function onPickComposeAttachments(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let total = composeAttachments.reduce((n, a) => n + (a.size || 0), 0);
    for (const f of files) {
      if (total + f.size > COMPOSE_MAX_ATTACH_BYTES) { notifyError(`"${f.name}" skipped — attachments over ~20MB won't send by email.`); continue; }
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(f); });
        if (!b64) { notifyError(`Couldn't read "${f.name}".`); continue; }
        total += f.size;
        setComposeAttachments(prev => [...prev, { filename: f.name, mime_type: f.type || 'application/octet-stream', content_base64: b64, size: f.size }]);
      } catch (_) { notifyError(`Couldn't read "${f.name}".`); }
    }
  }
  const removeComposeAttachment = (i) => setComposeAttachments(prev => prev.filter((_, idx) => idx !== i));
  const fmtAttachBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const [composeFrom, setComposeFrom] = useState('');  // resolved sender address
  const [composeReplyMeta, setComposeReplyMeta] = useState(null);  // { message_id, thread_id } when replying
  const [replyCtx, setReplyCtx] = useState(null);   // original email context for the AI reply drafter
  const [aiDrafting, setAiDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  // Live (uncommitted) text inside each RecipientPicker — flushed on Send.
  const composeToPendingRef = useRef('');
  const composeCcPendingRef = useRef('');
  const composeBccPendingRef = useRef('');
  const [syncingAliases, setSyncingAliases] = useState(false);
  // Backfill state: { running, round, totalNew, remaining, error, message }
  const [backfill, setBackfill] = useState(null);

  // Verified aliases the user can send from. Fall back to the account address.
  const verifiedAliases = (emailAliases || []).filter(a => a.verified);
  const defaultAlias = verifiedAliases.find(a => a.is_default)
    || verifiedAliases.find(a => a.is_primary)
    || (verifiedAliases.length > 0 ? verifiedAliases[0] : null);

  // Auto-sync aliases the first time we render with zero rows
  useEffect(() => {
    if (verifiedAliases.length === 0 && !syncingAliases) {
      runAliasesSync(true);  // silent first run
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open a fresh compose pre-addressed to a contact when another part of the app
  // requests it (window.__inboxComposeTo) — so "Email" affordances across the app
  // land in the in-app composer instead of the OS / Gmail app.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.__inboxComposeTo || !account) return;
    const to = String(window.__inboxComposeTo).trim();
    window.__inboxComposeTo = null;
    setComposeTo(to); setComposeSubject(''); setComposeBody('');
    setComposeCc(''); setComposeBcc(''); setShowCcBcc(false);
    setComposeFrom(defaultAlias?.email_address || account.email_address || '');
    setComposeReplyMeta(null); setSendMsg('');
    setShowCompose(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, defaultAlias]);

  async function runAliasesSync(silent = false) {
    setSyncingAliases(true);
    try {
      const { data } = await supabase.functions.invoke('gmail-aliases-sync', {
        body: { user_id: userId, account_id: account.id }
      });
      if (data?.ok) {
        const { data: fresh } = await supabase.from('email_aliases').select('*').order('email_address', { ascending: true });
        if (fresh) setEmailAliases(fresh);
        if (!silent) setSendMsg(`Synced ${data.synced} sender ${data.synced === 1 ? 'address' : 'addresses'}.`);
      }
    } catch (e) {
      if (!silent) setSendMsg('Alias sync failed: ' + (e.message || e));
    } finally {
      setSyncingAliases(false);
    }
  }

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    // tab can be 'inbox', 'sent', or 'snoozed'
    let q = supabase.from('email_threads').select('*').eq('account_id', account.id);
    if (tab === 'sent') {
      q = q.contains('labels', ['SENT']);
    } else if (tab === 'snoozed') {
      // Snoozed: has snoozed_until in the future
      q = q.not('snoozed_until', 'is', null).gt('snoozed_until', new Date().toISOString());
    } else {
      // inbox: must have INBOX label, and not be snoozed
      q = q.contains('labels', ['INBOX']).or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    }
    const { data } = await q.order('last_message_at', { ascending: false }).limit(50);
    setThreads(data || []);
    setLoadingThreads(false);
  }, [account.id, tab]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Sync on open: when you arrive at this account's inbox, pull fresh mail then
  // refresh the list, so opening the app shows the latest without a manual click.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await supabase.functions.invoke('gmail-sync', { body: { account_id: account.id } });
        if (!cancelled) await loadThreads();
      } catch (_) { /* non-fatal — the manual Sync button still works */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  // ── Per-thread actions for swipe gestures ─────────────────────────
  // These do the same work as trashCurrentThread / modifyThread('archive')
  // but target a specific row (not selectedThread). Used by the swipe
  // wrappers in the inbox list — left→right swipe = delete (trash),
  // right→left swipe = archive.
  async function swipeArchiveThread(thread) {
    if (!thread || !account) return;
    try {
      // Drop from local list immediately (the swipe animation already showed intent).
      // We refetch on error to put it back if the action failed.
      setThreads(prev => prev.filter(t => t.id !== thread.id));
      if (selectedThread?.id === thread.id) { setSelectedThread(null); setSelectedMessages([]); }
      const { data, error } = await supabase.functions.invoke('gmail-modify', {
        body: { account_id: account.id, thread_id: thread.provider_thread_id, action: 'archive' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (window.__notify) window.__notify(`Archived "${(thread.subject || '(no subject)').slice(0, 40)}"`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Could not archive: ' + (err.message || err), 'error');
      // Restore the row by refetching the inbox list (simplest, safest).
      setThreads(prev => [thread, ...prev]);
    }
  }

  async function swipeDeleteThread(thread) {
    if (!thread || !account) return;
    try {
      setThreads(prev => prev.filter(t => t.id !== thread.id));
      if (selectedThread?.id === thread.id) { setSelectedThread(null); setSelectedMessages([]); }
      const { data, error } = await supabase.functions.invoke('gmail-trash', {
        body: { account_id: account.id, thread_id: thread.provider_thread_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (window.__notify) window.__notify(`Moved to Trash: "${(thread.subject || '(no subject)').slice(0, 40)}"`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Could not delete: ' + (err.message || err), 'error');
      setThreads(prev => [thread, ...prev]);
    }
  }

  async function openThread(thread) {
    setSelectedThread(thread);
    // Pass 5 Finding #6: clear stale messages from the previous thread so
    // they don't briefly render under the new thread's subject.
    setSelectedMessages([]);
    setLoadingMessages(true);
    const { data } = await supabase
      .from('email_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('internal_date', { ascending: true });
    setSelectedMessages(data || []);
    // Mark unread messages as read
    const unread = (data || []).filter(m => !m.is_read);
    if (unread.length > 0) {
      await supabase
        .from('email_messages')
        .update({ is_read: true })
        .in('id', unread.map(m => m.id));
      // Also clear thread unread flag if everything's now read
      await supabase.from('email_threads').update({ has_unread: false }).eq('id', thread.id);
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, has_unread: false } : t));
    }
    setLoadingMessages(false);
    // On mobile, scroll the reading pane into view since the list collapses.
    // Use setTimeout so the DOM has time to re-render with the new pane visible.
    setTimeout(() => {
      if (readingPaneRef.current) {
        readingPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Belt-and-suspenders: also scroll the page to top, since the pane should fill the view
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  }

  // Deep-link: the wrapper has already switched to the correct account and
  // handed us the exact thread id. Open it by id (from the loaded list if
  // present, otherwise fetch it directly) — reliable regardless of how deep
  // the thread is. autoOpenedRef guards against reopening on re-render.
  const autoOpenedRef = useRef(null);
  useEffect(() => {
    if (!openThreadId || autoOpenedRef.current === openThreadId) return;
    autoOpenedRef.current = openThreadId;
    let alive = true;
    (async () => {
      let th = (threads || []).find(t => t.id === openThreadId);
      if (!th) {
        try {
          const { data } = await supabase.from('email_threads').select('*').eq('id', openThreadId).limit(1);
          if (data && data.length) th = data[0];
        } catch (_) {}
      }
      if (alive && th) openThread(th);
    })();
    return () => { alive = false; };
  }, [openThreadId, threads]); // eslint-disable-line

  // Pass 4 Batch D: load any cached triage rows for current threads so the
  // inbox list can show category dots immediately. Re-runs when threads change.
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = threads.map(t => t.id);
      const { data } = await supabase
        .from('email_triage')
        .select('*')
        .in('thread_id', ids);
      if (cancelled || !data) return;
      const map = {};
      for (const row of data) map[row.thread_id] = row;
      setTriageCache(prev => ({ ...prev, ...map }));
    })();
    return () => { cancelled = true; };
  }, [threads]);

  // Triage a single thread. force=true bypasses the edge-function's cache check.
  // The function itself UPSERTs to email_triage, so we just take its return value.
  async function triageThread(threadId, { force = false } = {}) {
    setTriageLoading(prev => ({ ...prev, [threadId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('email-intelligence', {
        body: { thread_id: threadId, force },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Pass 5 Finding #12: surface a persist_error if the model succeeded but
      // the DB write failed — user-visible so they know the cache won't warm
      // and they'll re-pay for triage next time.
      if (data?.persist_error) {
        if (window.__notify) window.__notify('Triage ran but cache write failed: ' + data.persist_error, 'error');
      }
      // Cache shape matches the email_triage row enough for UI to consume.
      setTriageCache(prev => ({
        ...prev,
        [threadId]: {
          thread_id: threadId,
          category: data.category,
          action: data.action,
          summary: data.summary,
          reasoning: data.reasoning,
          confidence: data.confidence,
          created_at: data.created_at,
          cached: data.cached,
        },
      }));
      return data;
    } catch (err) {
      if (window.__notify) window.__notify('Triage failed: ' + (err.message || err), 'error');
      return null;
    } finally {
      setTriageLoading(prev => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    }
  }

  // Auto-triage: after a sync, find threads with no triage row and run them
  // serially (one at a time, to avoid spiking API costs/rate limits). Per
  // Q2a = "Auto-triage every new thread in background as soon as it syncs."
  // Per Q2c = persist (the edge function writes to email_triage on success).
  //
  // Pass 5 Batch A fixes:
  //   #2 — query email_triage DB directly instead of trusting local triageCache,
  //        which may be stale right after sync (cache useEffect hasn't fired yet)
  //   #3 — guard against concurrent runs (double-Sync click) via running ref
  //   #5 — dropped the dead try/catch around triageThread (it never throws)
  //   #7 — check abort flag between iterations; bail cleanly on unmount/account change
  async function autoTriageUntriaged(allThreads) {
    if (autoTriageRunningRef.current) return;  // #3 concurrency guard
    if (!allThreads || allThreads.length === 0) return;

    // #2 source of truth: query email_triage rather than local cache.
    // The local cache useEffect is async and may not have populated by now.
    const allIds = allThreads.map(t => t.id);
    const { data: existing } = await supabase
      .from('email_triage')
      .select('thread_id')
      .in('thread_id', allIds);
    const cachedIds = new Set((existing || []).map(r => r.thread_id));
    const candidates = allThreads.filter(t => !cachedIds.has(t.id));
    if (candidates.length === 0) return;

    autoTriageRunningRef.current = true;
    setAutoTriageProgress({ done: 0, total: candidates.length });
    try {
      for (let i = 0; i < candidates.length; i++) {
        // #7 abort check before each (potentially slow) network call
        if (autoTriageAbortRef.current.aborted) return;
        await triageThread(candidates[i].id);  // triageThread catches its own errors
        if (autoTriageAbortRef.current.aborted) return;
        setAutoTriageProgress({ done: i + 1, total: candidates.length });
        // Throttle: 250ms between calls to be polite to the API
        if (i < candidates.length - 1) await new Promise(r => setTimeout(r, 250));
      }
    } finally {
      autoTriageRunningRef.current = false;
      // Clear progress after a moment (unless we're already aborted/unmounted)
      if (!autoTriageAbortRef.current.aborted) {
        setTimeout(() => {
          if (!autoTriageAbortRef.current.aborted) setAutoTriageProgress(null);
        }, 2500);
      }
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('gmail-sync', {
        body: { account_id: account.id },
      });
      if (error) throw error;
      const r = (data && data.synced && data.synced[0]) || {};
      if (r.error) {
        setSyncMsg('Error: ' + r.error);
      } else {
        setSyncMsg(`Synced — ${r.new_messages || 0} new`);
        await loadThreads();
        // Refresh account row
        const { data: acct } = await supabase.from('email_accounts').select('*').eq('id', account.id).single();
        if (acct) setEmailAccounts(prev => prev.map(a => a.id === acct.id ? acct : a));
        // Pass 4 Batch D: kick off auto-triage in background for any new threads.
        // Refetch threads first so we have the latest list including new ones.
        try {
          const { data: latest } = await supabase
            .from('email_threads')
            .select('id')
            .eq('account_id', account.id)
            .contains('labels', ['INBOX'])
            .order('last_message_at', { ascending: false })
            .limit(50);
          if (latest && latest.length > 0) {
            // Fire-and-forget — don't await, so the sync UI clears immediately.
            autoTriageUntriaged(latest);
          }
        } catch (_) { /* non-fatal */ }
      }
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (err) {
      setSyncMsg('Error: ' + (err.message || err));
    } finally {
      setSyncing(false);
    }
  }

  // 365-day backfill: walks backward through Gmail in batches.
  // Each round pulls ~300 messages older than what we already have.
  // Stops when 2 consecutive rounds find no new messages.
  async function runBackfill() {
    setBackfill({ running: true, round: 0, totalNew: 0, remaining: null, error: null, message: 'Starting 365-day backfill…' });
    let totalNew = 0;
    let zeroRoundsInARow = 0;
    const MAX_ROUNDS = 100;
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      setBackfill(b => ({ ...b, round: i, message: `Round ${i}: fetching older messages…` }));
      try {
        const { data, error } = await supabase.functions.invoke('gmail-sync', {
          body: {
            account_id: account.id,
            force_backfill: true,
            lookback_days: 365,
            exclude_categories: true,
            max_initial: 2000,
            per_run_cap: 300,
          },
        });
        if (error) throw error;
        const r = (data && data.synced && data.synced[0]) || {};
        if (r.error) throw new Error(r.error);
        const newCount = r.new_messages || 0;
        const remaining = r.remaining_to_fetch || 0;
        totalNew += newCount;
        // Capture in a per-iteration const so the closures below don't bind
        // to the loop-mutated outer variable (eslint no-loop-func).
        const total = totalNew;
        setBackfill(b => ({ ...b, round: i, totalNew: total, remaining,
          message: `Round ${i}: +${newCount} messages · total pulled so far: ${total}${remaining > 0 ? ` · ~${remaining} more in queue` : ''}` }));
        if (newCount === 0) {
          zeroRoundsInARow++;
          if (zeroRoundsInARow >= 2) {
            setBackfill({ running: false, round: i, totalNew: total, remaining: 0, error: null,
              message: `✓ Backfill complete. Pulled ${total} messages from the last 365 days (excluding promotions/updates/social).` });
            break;
          }
        } else {
          zeroRoundsInARow = 0;
        }
      } catch (err) {
        setBackfill(b => ({ ...b, running: false, error: err.message || String(err) }));
        return;
      }
    }
    await loadThreads();
    const { data: acct } = await supabase.from('email_accounts').select('*').eq('id', account.id).single();
    if (acct) setEmailAccounts(prev => prev.map(a => a.id === acct.id ? acct : a));
    // Pass 5 Finding #8: store the cleanup-timer handle so the unmount/account
    // change effect can clear it. Previously this fired setState on dead components.
    if (backfillCleanupTimerRef.current) clearTimeout(backfillCleanupTimerRef.current);
    backfillCleanupTimerRef.current = setTimeout(() => {
      setBackfill(b => (b && !b.running ? null : b));
      backfillCleanupTimerRef.current = null;
    }, 30000);
  }

  // Reply-from picker: prefer whatever address the inbound mail was sent TO
  // (if it matches one of our verified aliases), else fall back to the default.
  function chooseReplyFrom(msg) {
    if (!msg) return defaultAlias?.email_address || account.email_address;
    const toEmail = (r) => {
      if (!r) return null;
      if (typeof r === 'string') return r.trim().toLowerCase();
      if (typeof r === 'object') return r.email ? String(r.email).trim().toLowerCase() : null;
      return null;
    };
    const candidates = [
      ...(Array.isArray(msg.to_addresses) ? msg.to_addresses : []),
      ...(Array.isArray(msg.cc_addresses) ? msg.cc_addresses : []),
    ].map(toEmail).filter(Boolean);
    const verifiedSet = new Set(verifiedAliases.map(a => a.email_address.toLowerCase()));
    for (const cand of candidates) {
      // Strip angle brackets if present (some legacy strings might be "Name <email@x>")
      const m = cand.match(/<([^>]+)>/);
      const bare = (m ? m[1] : cand).toLowerCase().trim();
      if (verifiedSet.has(bare)) return bare;
    }
    return defaultAlias?.email_address || account.email_address;
  }

  function openCompose() {
    setComposeTo(''); setComposeSubject(''); setComposeBody('');
    setComposeCc(''); setComposeBcc(''); setShowCcBcc(false);
    setComposeFrom(defaultAlias?.email_address || account.email_address);
    setComposeReplyMeta(null);
    setSendMsg('');
    setShowCompose(true);
  }

  // Forward a message: empty recipients, prefilled with "Forwarded message" preamble
  async function addEmailToKnowledge(msg) {
    const subject = msg.subject || selectedThread?.subject || 'Email';
    const body = msg.body_text || msg.snippet || '';
    const from = msg.from_name || msg.from_address || '';
    const text = `Email${from ? ' from ' + from : ''}\nSubject: ${subject}\n\n${body}`;
    try {
      const { error } = await supabase.functions.invoke('knowledge-ingest', { body: { kind: 'text', title: subject, text, scope: 'private', tags: ['email'] } });
      if (window.__notify) window.__notify(error ? 'Could not add to Knowledge' : 'Added to your Knowledge \u2014 transcribing & filing now', error ? 'error' : 'success');
    } catch (e) { if (window.__notify) window.__notify('Could not add to Knowledge', 'error'); }
  }

  function openForward(msg) {
    if (!msg) return;
    const subj = (msg.subject || '').match(/^fwd?:/i) ? msg.subject : `Fwd: ${msg.subject || ''}`;
    const when = msg.internal_date ? new Date(msg.internal_date).toLocaleString() : '';
    const sentToFmt = (Array.isArray(msg.to_addresses) ? msg.to_addresses : []).map(r => {
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object') return r.name ? `${r.name} <${r.email}>` : r.email;
      return '';
    }).filter(Boolean).join(', ');
    const quoted = msg.body_text || msg.snippet || '';
    setComposeTo('');
    setComposeSubject(subj);
    setComposeBody(
      `\n\n---------- Forwarded message ----------\n` +
      `From: ${msg.from_name ? `${msg.from_name} <${msg.from_address}>` : msg.from_address}\n` +
      `Date: ${when}\n` +
      `Subject: ${msg.subject || ''}\n` +
      (sentToFmt ? `To: ${sentToFmt}\n` : '') +
      `\n${quoted}`
    );
    setComposeFrom(defaultAlias?.email_address || account.email_address);
    setComposeCc(''); setComposeBcc(''); setShowCcBcc(false);
    // Forward doesn't preserve thread — start a new conversation
    setComposeReplyMeta(null);
    setSendMsg('');
    setShowCompose(true);
  }

  // Move a thread (and its messages) to Trash via Gmail API
  function clearUndoTimer() { if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; } }

  // Delete (trash) or archive the open email, then immediately show the next one
  // and surface an Undo button — so you can blow through your inbox without
  // bouncing back to the list each time. Optimistic: the UI advances first, the
  // backend call follows, and we roll back if it fails.
  async function actAndAdvance(kind) {
    const victim = selectedThread;
    if (!victim) return;
    const list = filteredThreads;
    const idx = list.findIndex(t => t.id === victim.id);
    const nextThread = (idx >= 0 ? (list[idx + 1] || list[idx - 1]) : null) || null;
    // Advance immediately
    setThreads(prev => prev.filter(t => t.id !== victim.id));
    if (nextThread) { openThread(nextThread); }
    else { setSelectedThread(null); setSelectedMessages([]); }
    // Backend
    try {
      if (kind === 'trash') {
        const { data, error } = await supabase.functions.invoke('gmail-trash', {
          body: { account_id: account.id, thread_id: victim.provider_thread_id },
        });
        if (error) throw error; if (data?.error) throw new Error(data.error);
      } else {
        const { data, error } = await supabase.functions.invoke('gmail-modify', {
          body: { account_id: account.id, thread_id: victim.provider_thread_id, action: 'archive' },
        });
        if (error) throw error; if (data?.error) throw new Error(data.error);
      }
    } catch (err) {
      // Roll back: put it back and reselect it
      setThreads(prev => [victim, ...prev.filter(t => t.id !== victim.id)]);
      openThread(victim);
      notifyError((kind === 'trash' ? 'Could not move to Trash: ' : 'Could not archive: ') + (err.message || err));
      return;
    }
    // Offer undo for a few seconds
    clearUndoTimer();
    setUndoState({ kind, thread: victim });
    undoTimer.current = setTimeout(() => { setUndoState(null); undoTimer.current = null; }, 10000);
  }

  async function undoLast() {
    const u = undoState;
    if (!u) return;
    clearUndoTimer();
    setUndoState(null);
    const v = u.thread;
    try {
      const body = u.kind === 'trash'
        ? { account_id: account.id, thread_id: v.provider_thread_id, add: ['INBOX'], remove: ['TRASH'] }
        : { account_id: account.id, thread_id: v.provider_thread_id, add: ['INBOX'] };
      const { data, error } = await supabase.functions.invoke('gmail-modify', { body });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      const { data: updated } = await supabase.from('email_threads').select('*').eq('id', v.id).single();
      const restored = updated || v;
      setThreads(prev => [restored, ...prev.filter(t => t.id !== restored.id)]);
      openThread(restored);
      if (window.__notify) window.__notify(u.kind === 'trash' ? 'Restored to Inbox' : 'Archive undone', 'success');
    } catch (err) {
      notifyError('Undo failed: ' + (err.message || err) + ' — you can still recover it from Trash/All Mail.');
    }
  }

  // Open the "new task from email" sheet, prefilled from a message, then ask
  // Claude for a crisp action-oriented title in the background.
  function openCreateTask(msg) {
    if (!msg) return;
    const subject = msg.subject || selectedThread?.subject || '';
    let body = msg.body_text || '';
    if (!body && msg.body_html) {
      body = decodeEntities(
        msg.body_html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
      ).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (!body) body = msg.snippet || '';
    const from = (msg.from_address || '').trim();
    const match = contacts.find(c => c.email && from && c.email.toLowerCase() === from.toLowerCase()) || null;
    setTaskTitle(subject || 'Follow up on email');
    setTaskNotes(body);
    setTaskDue('');
    setTaskPriority('medium');
    setTaskContact(match);
    setTaskSrc({
      thread_id: msg.provider_thread_id || selectedThread?.provider_thread_id || null,
      message_id: msg.provider_message_id || null,
      from, from_name: msg.from_name || '', subject,
    });
    setTaskOpen(true);
    setTaskBusy(true);
    supabase.functions.invoke('email-to-task', { body: { subject, from_name: msg.from_name || '', body } })
      .then(({ data }) => { if (data && data.title) setTaskTitle(data.title); })
      .catch(() => {})
      .finally(() => setTaskBusy(false));
  }

  async function saveEmailTask() {
    const title = taskTitle.trim();
    if (!title || taskSaving) return;
    setTaskSaving(true);
    try {
      const row = {
        user_id: userId, title,
        notes: taskNotes.trim() || null,
        due_date: taskDue || null,
        priority: taskPriority, list: 'inbox', status: 'todo',
        priority_system: defaultSystem, eisenhower_quadrant: defaultSystem === 'eisenhower' ? ({ high: 'A', medium: 'B', low: 'C' }[taskPriority] || 'B') : null, eisenhower_rank: defaultSystem === 'eisenhower' ? 1 : null,
        contact_id: taskContact?.id || null,
        email_thread_id: taskSrc.thread_id || null,
        email_message_id: taskSrc.message_id || null,
        source_url: taskSrc.thread_id ? `https://mail.google.com/mail/u/0/#all/${taskSrc.thread_id}` : null,
      };
      const { data, error } = await supabase.from('tasks').insert(row).select().single();
      if (error) throw error;
      if (taskContact?.id && data?.id) {
        await supabase.from('task_contacts').insert({ task_id: data.id, contact_id: taskContact.id, user_id: userId });
      }
      if (window.__notify) window.__notify(`Task created${taskContact ? ` · linked to ${taskContact.name}` : ''}`, 'success');
      setTaskOpen(false);
    } catch (e) {
      if (window.__notify) window.__notify('Could not create task: ' + (e.message || e), 'error');
    } finally {
      setTaskSaving(false);
    }
  }

  async function trashCurrentThread() {
    if (!selectedThread) return;
    if (!await confirmDialog('Move this conversation to Trash?')) return;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-trash', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Remove from local list, close the reading pane
      setThreads(prev => prev.filter(t => t.id !== selectedThread.id));
      setSelectedThread(null);
      setSelectedMessages([]);
    } catch (err) {
      notifyError('Could not move to Trash: ' + (err.message || err));
    }
  }

  // ===== Email actions: archive / star / unread / spam / labels / snooze =====
  // All route through the gmail-modify edge function with action or add/remove arrays.

  // Compute whether the current thread is starred / unread from its labels
  const currentLabels = (selectedThread?.labels || []);
  const isStarred = currentLabels.includes('STARRED');
  const isUnread = selectedThread?.has_unread || currentLabels.includes('UNREAD');

  async function modifyThread(action, opts = {}) {
    if (!selectedThread) return;
    const { silent = false, removeFromList = false } = opts;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-modify', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Update local: re-fetch the thread to get the new labels
      const { data: updated } = await supabase.from('email_threads').select('*').eq('id', selectedThread.id).single();
      if (updated) {
        setSelectedThread(updated);
        if (removeFromList) {
          setThreads(prev => prev.filter(t => t.id !== updated.id));
          if (action === 'archive' || action === 'spam') {
            // Close the reading pane on archive/spam
            setSelectedThread(null);
            setSelectedMessages([]);
          }
        } else {
          setThreads(prev => prev.map(t => t.id === updated.id ? updated : t));
        }
      }
    } catch (err) {
      if (!silent) notifyError('Action failed: ' + (err.message || err));
    }
  }

  // Snooze: hide from inbox until a target time, then restore via cron
  async function snoozeThread(untilDate) {
    if (!selectedThread || !untilDate) return;
    try {
      // Remove from inbox view via Gmail (mirrors what Gmail does), and set snoozed_until locally
      await supabase.functions.invoke('gmail-modify', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id, action: 'archive' },
      });
      // Pass 5 Finding #9: capture DB error so a silent failure doesn't leave
      // the user thinking the thread is snoozed when nothing was persisted.
      const { error: snoozeErr } = await supabase.from('email_threads')
        .update({ snoozed_until: untilDate.toISOString() }).eq('id', selectedThread.id);
      if (snoozeErr) throw snoozeErr;
      setThreads(prev => prev.filter(t => t.id !== selectedThread.id));
      setSelectedThread(null);
      setSelectedMessages([]);
      setShowSnoozePicker(false);
      if (window.__notify) window.__notify(`Snoozed until ${untilDate.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`, 'success');
    } catch (err) {
      if (window.__notify) window.__notify('Snooze failed: ' + (err.message || err), 'error');
    }
  }

  // Apply labels to the thread (add some, remove others)
  async function applyLabels(addIds, removeIds) {
    if (!selectedThread) return;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-modify', {
        body: {
          account_id: account.id,
          thread_id: selectedThread.provider_thread_id,
          add: addIds,
          remove: removeIds,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { data: updated } = await supabase.from('email_threads').select('*').eq('id', selectedThread.id).single();
      if (updated) {
        setSelectedThread(updated);
        setThreads(prev => prev.map(t => t.id === updated.id ? updated : t));
      }
      setShowLabelPicker(false);
    } catch (err) {
      notifyError('Label change failed: ' + (err.message || err));
    }
  }

  // Snooze time options
  function snoozeOptions() {
    const now = new Date();
    const opts = [];
    // Later today: 4 hours from now, but if past 7pm, skip
    const laterToday = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    if (laterToday.getHours() <= 21) {
      opts.push({ key: 'later', label: 'Later today', sub: laterToday.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), date: laterToday });
    }
    // Tomorrow at 9am
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    opts.push({ key: 'tomorrow', label: 'Tomorrow', sub: 'Tomorrow at 9:00 AM', date: tomorrow });
    // This weekend: Saturday at 9am (if today is Sat/Sun, next Saturday)
    const weekend = new Date(now);
    const dayOfWeek = weekend.getDay();
    const daysUntilSat = dayOfWeek === 6 ? 7 : (dayOfWeek === 0 ? 6 : 6 - dayOfWeek);
    weekend.setDate(weekend.getDate() + daysUntilSat);
    weekend.setHours(9, 0, 0, 0);
    opts.push({ key: 'weekend', label: 'This weekend', sub: weekend.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at 9:00 AM', date: weekend });
    // Next week: next Monday at 9am
    const nextWeek = new Date(now);
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
    nextWeek.setHours(9, 0, 0, 0);
    opts.push({ key: 'nextweek', label: 'Next week', sub: nextWeek.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at 9:00 AM', date: nextWeek });
    return opts;
  }

  // Best-effort extraction of a phone number from an email body / signature.
  // Returns a formatted US number or null. Prefers numbers next to a label
  // (cell/mobile/phone/tel/direct/office/p:/c:/m:/o:/d:) over bare matches.
  function extractPhoneFromEmail(msg) {
    let text = msg.body_text || '';
    if (!text && msg.body_html) {
      // crude tag strip
      text = decodeEntities(
        msg.body_html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      );
    }
    if (!text) text = msg.snippet || '';
    if (!text) return null;

    const phoneRe = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
    const labelRe = /(cell|mobile|phone|tel|direct|office|\bp\b|\bc\b|\bm\b|\bo\b|\bd\b)\s*[:.]?\s*$/i;

    const normalize = (raw) => {
      const digits = raw.replace(/\D/g, '');
      let d = digits;
      if (d.length === 11 && d[0] === '1') d = d.slice(1);
      if (d.length !== 10) return null;                 // reject non-10-digit junk
      return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    };

    // Pass 1 — prefer a phone preceded by a phone-label on the same line
    const lines = text.split(/\n+/);
    for (const line of lines) {
      const m = line.match(phoneRe);
      if (!m) continue;
      for (const candidate of m) {
        const idx = line.indexOf(candidate);
        const before = line.slice(Math.max(0, idx - 14), idx);
        if (labelRe.test(before)) {
          const f = normalize(candidate);
          if (f) return f;
        }
      }
    }
    // Pass 2 — first valid phone-shaped match anywhere
    const all = text.match(phoneRe) || [];
    for (const candidate of all) {
      const f = normalize(candidate);
      if (f) return f;
    }
    return null;
  }

  // Create a new contact from the sender of the currently-open email.
  // Uses from_name + from_address, and tries to pull a phone from the signature.
  async function createContactFromSender(msg) {
    setShowMoreMenu(false);
    if (!msg) return;
    const email = (msg.from_address || '').trim().toLowerCase();
    if (!email) {
      if (window.__notify) window.__notify('No sender email address found on this message', 'error');
      return;
    }
    // Duplicate guard — match on email (case-insensitive)
    const existing = (contacts || []).find(c => (c.email || '').trim().toLowerCase() === email);
    if (existing) {
      if (window.__notify) window.__notify(`${existing.name || email} is already in your contacts`, 'error');
      return;
    }
    const senderName = (msg.from_name || '').trim() || email;
    const foundPhone = extractPhoneFromEmail(msg);
    try {
      // Step 1: insert WITHOUT phone (a DB trigger blanks phone on INSERT)
      const { data: created, error } = await supabase.from('contacts').insert({
        user_id: userId,
        name: senderName,
        email,
        type: 'lead',
        priority: 'normal',
        status: 'active',
        last_contact_at: msg.received_at || msg.internal_date || null,
        notes: `Created from inbound email${msg.subject ? ` — "${msg.subject}"` : ''}.`,
      }).select().single();
      if (error) throw error;

      // Step 2: set phone separately so it survives the trigger
      if (foundPhone) {
        await supabase.from('contacts').update({ phone: foundPhone }).eq('id', created.id);
      }

      if (window.__notify) {
        window.__notify(
          foundPhone ? `Added ${created.name} — phone ${foundPhone}` : `Added ${created.name} to contacts`,
          'success'
        );
      }
      if (reloadData) reloadData();
    } catch (e) {
      if (window.__notify) window.__notify("Couldn't create contact: " + (e.message || e), 'error');
    }
  }

  function openReply(msg, replyAll = false) {
    if (!msg) return;
    // Normalize anything we might get for an address — string, {name,email},
    // or a JSONB array of {name,email} — into a flat list of plain emails.
    // reply_to in particular comes back from Gmail as an array; the old code
    // dropped it into the To field unflattened, which stringified to
    // "[object Object]" and broke send.
    const extractEmails = (r) => {
      if (!r) return [];
      if (Array.isArray(r)) return r.flatMap(extractEmails);
      if (typeof r === 'string') return r.trim() ? [r.trim()] : [];
      if (typeof r === 'object' && r.email) return [String(r.email).trim()];
      return [];
    };
    // Prefer Reply-To header (sender's preferred reply path, e.g. through Google
    // Docs share notification → real human), fall back to From.
    const primary = extractEmails(msg.reply_to);
    let toList = primary.length ? primary : extractEmails(msg.from_address);
    let ccList = [];
    if (replyAll) {
      const myAddrs = new Set([
        account.email_address.toLowerCase(),
        ...verifiedAliases.map(a => a.email_address.toLowerCase()),
      ]);
      const senderSet = new Set(toList.map(a => a.toLowerCase()));
      // Reply All: everyone else (original To + Cc) goes to Cc, not To — keeps the
      // primary recipient clear and matches how Gmail/Outlook behave.
      ccList = Array.from(new Set([...extractEmails(msg.to_addresses), ...extractEmails(msg.cc_addresses)]
        .filter(a => !myAddrs.has(a.toLowerCase()) && !senderSet.has(a.toLowerCase()))));
    }
    const subj = (msg.subject || '').match(/^re:/i) ? msg.subject : `Re: ${msg.subject || ''}`;
    const when = msg.internal_date ? new Date(msg.internal_date).toLocaleString() : '';
    const quoted = (msg.body_text || msg.snippet || '').split('\n').map(l => '> ' + l).join('\n');
    setComposeTo(toList.join(', '));
    setComposeCc(ccList.join(', '));
    setComposeBcc('');
    setShowCcBcc(ccList.length > 0);
    setComposeSubject(subj);
    setComposeBody(`\n\nOn ${when}, ${msg.from_name || msg.from_address} wrote:\n${quoted}`);
    setComposeFrom(chooseReplyFrom(msg));
    setComposeReplyMeta({ message_id: msg.provider_message_id, thread_id: msg.provider_thread_id });
    setReplyCtx({
      subject: msg.subject || '',
      body: (msg.body_text || msg.snippet || '').slice(0, 8000),
      from_name: msg.from_name || msg.from_address || '',
      to_email: (toList[0] || ''),
    });
    setSendMsg('');
    setShowCompose(true);
  }

  // Merge committed chips with any address still sitting uncommitted in the
  // picker's input. Without this, typing an address and tapping Send straight
  // away sends nothing — the text never became a chip.
  function mergeRecipients(committed, ref) {
    const out = []; const seen = new Set();
    const add = (raw) => {
      const t = String(raw || '').trim();
      if (!t || !EMAIL_RE.test(t)) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k); out.push(t);
    };
    String(committed || '').split(',').forEach(add);
    String((ref && ref.current) || '').split(',').forEach(add);
    return out;
  }

  async function handleSend(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const toArr = mergeRecipients(composeTo, composeToPendingRef);
    if (!toArr.length) {
      const typed = (composeToPendingRef.current || '').trim();
      setSendMsg(typed ? `“${typed}” doesn’t look like a valid email address.` : 'Add a recipient before sending.');
      return;
    }
    setSending(true);
    setSendMsg('');
    try {
      const payload = {
        account_id: account.id,
        to: toArr,
        subject: composeSubject,
        body_text: composeBody,
      };
      if (composeAttachments.length) payload.attachments = composeAttachments.map(a => ({ filename: a.filename, mime_type: a.mime_type, content_base64: a.content_base64 }));
      if (composeTrack) {
        payload.track = true;
        const firstTo = (toArr[0] || '').trim().toLowerCase();
        const cm = (contacts || []).find(c => (c.email || '').toLowerCase() === firstTo);
        if (cm) payload.contact_id = cm.id;
      }
      const ccArr = mergeRecipients(composeCc, composeCcPendingRef);
      const bccArr = mergeRecipients(composeBcc, composeBccPendingRef);
      if (ccArr.length) payload.cc = ccArr;
      if (bccArr.length) payload.bcc = bccArr;
      if (composeFrom && composeFrom !== account.email_address) {
        payload.from_address = composeFrom;
      }
      if (composeReplyMeta?.message_id) payload.reply_to_message_id = composeReplyMeta.message_id;
      if (composeReplyMeta?.thread_id) payload.in_reply_to_thread_id = composeReplyMeta.thread_id;
      const { data, error } = await supabase.functions.invoke('gmail-send', {
        body: payload,
      });
      if (error) {
        const msg = String(error.message || error);
        if (/401|not authenticated|jwt|token/i.test(msg)) throw new Error('Your session expired mid-send. Refresh the page and try again.');
        throw error;
      }
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      setSendMsg('Sent.');

      // Instantly clear "owe a reply" for any recipient that maps to a contact.
      // We write the denormalized last_outbound_at the dashboard reads, so the
      // Next Best Action advances on send instead of waiting for the Gmail sync
      // to round-trip the SENT message. The non-regressing recompute later
      // reconciles this to the exact synced timestamp.
      try {
        const nowIso = new Date().toISOString();
        const recipientEmails = new Set(
          [...payload.to, ...(payload.cc || [])].map(e => String(e).toLowerCase().trim())
        );
        const hit = contacts.filter(c => c.email && recipientEmails.has(c.email.toLowerCase().trim()));
        for (const c of hit) {
          const moreRecentInbound = c.last_inbound_at && new Date(c.last_inbound_at) > new Date(nowIso);
          await supabase.from('contacts').update({
            last_outbound_at: nowIso,
            last_contact_at: nowIso,
            last_communication_channel: 'email',
            last_communication_direction: moreRecentInbound ? 'inbound' : 'outbound',
          }).eq('id', c.id);
        }
        // Refresh shared app state so the Dashboard NBA reflects it right away.
        if (hit.length && typeof reloadData === 'function') reloadData();
      } catch (_) { /* non-fatal — sync recompute will reconcile */ }

      setShowCompose(false);
      setComposeTo(''); setComposeCc(''); setComposeBcc(''); setShowCcBcc(false); setComposeSubject(''); setComposeBody(''); setComposeFrom(''); setComposeReplyMeta(null);
      composeToPendingRef.current = ''; composeCcPendingRef.current = ''; composeBccPendingRef.current = '';
      // Trigger a sync so the sent message shows up
      runSync();
    } catch (err) {
      setSendMsg('Error: ' + (err.message || err));
    } finally {
      setSending(false);
    }
  }

  // Draft a reply with Claude, adapted to the recipient's DISC style, and drop
  // it in above the quoted original. Best-effort: works with or without a DISC profile.
  async function aiReplyDraft() {
    if (aiDrafting) return;
    const firstEmail = (composeTo.split(',')[0] || '').trim();
    const prof = profileForEmail(firstEmail);
    const contact = contacts.find(c => c.email && firstEmail && c.email.toLowerCase() === firstEmail.toLowerCase());
    setAiDrafting(true);
    setSendMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('email-reply-draft', {
        body: {
          original_subject: replyCtx?.subject || composeSubject || '',
          original_body: (replyCtx?.body || '').slice(0, 6000),
          from_name: replyCtx?.from_name || contact?.name || firstEmail,
          recipient_name: contact?.name || replyCtx?.from_name || firstEmail,
          disc_primary: prof?.primary_letter || null,
          disc_secondary: prof?.secondary_letter || null,
          disc_rationale: prof?.rationale || prof?.research_summary || '',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const draft = (data?.draft || '').trim();
      if (!draft) throw new Error('No draft returned');
      // Place the draft at the top, keep the quoted original below it.
      setComposeBody(draft + '\n' + (composeBody || ''));
    } catch (e) {
      setSendMsg('AI draft failed: ' + (e.message || e));
    } finally {
      setAiDrafting(false);
    }
  }

  // Look up the sender's DISC profile via contact_id linkage (best-effort)
  function profileForEmail(email) {
    if (!email) return null;
    const contact = contacts.find(c => (c.email && c.email.toLowerCase() === email.toLowerCase()));
    if (!contact) return null;
    return profiles.find(p => p.contact_id === contact.id) || null;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return new Date(ts).toLocaleDateString();
  }

  function initials(name, email) {
    const s = name || email || '?';
    return s.replace(/[<>"]/g, '').slice(0, 2).toUpperCase();
  }

  function senderFromThread(thread) {
    // For inbox, show the most recent non-owner participant; for sent, show recipient.
    const myEmail = (account.email_address || '').toLowerCase();
    const myAliases = new Set([myEmail, ...verifiedAliases.map(a => a.email_address.toLowerCase())]);
    const parts = Array.isArray(thread.participants) ? thread.participants : [];
    // Normalize — some legacy rows may have strings instead of objects
    const normalized = parts.map(p => {
      if (typeof p === 'string') {
        const m = p.match(/^"?([^"<]+?)"?\s*<([^>]+)>/);
        if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
        return { name: null, email: p.toLowerCase() };
      }
      return { name: p?.name || null, email: (p?.email || '').toLowerCase() };
    }).filter(p => p.email);
    if (normalized.length === 0) return { name: null, email: null };
    // Find non-owner first
    const other = normalized.find(p => !myAliases.has(p.email));
    return other || normalized[0];
  }

  const unreadCount = threads.filter(t => t.has_unread).length;

  // Client-side filter for the header search icon. Lowercased substring match
  // across subject, snippet, and every participant's name/email. useMemo so
  // we don't re-walk the participants array on every unrelated render.
  const filteredThreads = useMemo(() => {
    const q = (inboxSearch || '').trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t => {
      if ((t.subject || '').toLowerCase().includes(q)) return true;
      if ((t.snippet || '').toLowerCase().includes(q)) return true;
      const parts = Array.isArray(t.participants) ? t.participants : [];
      return parts.some(p => {
        if (typeof p === 'string') return p.toLowerCase().includes(q);
        return (p?.name || '').toLowerCase().includes(q)
            || (p?.email || '').toLowerCase().includes(q);
      });
    });
  }, [threads, inboxSearch]);

  // ---- Reader navigation (prev/next through the visible list) ----
  const selIndex = selectedThread ? filteredThreads.findIndex(t => t.id === selectedThread.id) : -1;
  const hasNewer = selIndex > 0;                                  // up the list = newer
  const hasOlder = selIndex >= 0 && selIndex < filteredThreads.length - 1; // down = older
  function goAdjacent(delta) {
    if (selIndex === -1) return;
    const nx = filteredThreads[selIndex + delta];
    if (nx) openThread(nx);
  }
  useEffect(() => {
    if (!selectedThread) return;
    function onNavKey(e) {
      if (showCompose) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goAdjacent(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goAdjacent(-1); }
      else if (e.key === 'Escape') { setSelectedThread(null); }
    }
    window.addEventListener('keydown', onNavKey);
    return () => window.removeEventListener('keydown', onNavKey);
  }, [selectedThread, filteredThreads, showCompose, selIndex]); // eslint-disable-line

  return (
    <div>
      {/* Floating Undo snackbar — rendered above everything so it's never
          clipped by the toolbar or scrolled out of view. Appears after a
          delete/archive and lets you take it back while you keep reading. */}
      {undoState && createPortal(
        <div style={{
          position:'fixed', left:'50%', transform:'translateX(-50%)',
          bottom:'calc(env(safe-area-inset-bottom, 0px) + 24px)', zIndex:10000,
          display:'flex', alignItems:'center', gap:'14px',
          background:'var(--bg-card)', border:'1px solid var(--accent)',
          borderRadius:'12px', padding:'10px 12px 10px 16px',
          boxShadow:'0 10px 30px rgba(0,0,0,0.5)', maxWidth:'min(92vw, 460px)',
          animation:'qmRise 0.18s ease both'
        }}>
          <span style={{fontSize:'13px',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {undoState.kind === 'trash' ? 'Moved to Trash' : 'Archived'}
            {undoState.thread?.subject ? ` · ${undoState.thread.subject.slice(0,34)}${undoState.thread.subject.length>34?'…':''}` : ''}
          </span>
          <button onClick={undoLast}
            style={{flexShrink:0,padding:'7px 16px',display:'inline-flex',alignItems:'center',gap:'6px',
              border:'none',color:'var(--bg-base)',background:'var(--accent)',
              borderRadius:'999px',fontSize:'13px',fontWeight:800,cursor:'pointer'}}>
            <Icon name="reply" size={14} /> Undo
          </button>
          <button onClick={() => { clearUndoTimer(); setUndoState(null); }} aria-label="Dismiss"
            style={{flexShrink:0,background:'none',border:'none',color:'var(--text-3)',fontSize:'18px',lineHeight:1,cursor:'pointer',padding:'2px 4px'}}>×</button>
        </div>,
        document.body
      )}

      {/* New task from email — AI-summarized title, email body as notes,
          optional due date, linked to the sender's contact. */}
      {taskOpen && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget && !taskSaving) setTaskOpen(false); }}
          style={{position:'fixed',inset:0,zIndex:10001,background:'rgba(0,0,0,0.55)',backdropFilter:'blur(2px)',
            display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'5vh 14px 14px',overflowY:'auto'}}>
          <div style={{width:'min(560px,100%)',background:'var(--bg-card)',border:'1px solid var(--border)',
            borderRadius:'16px',boxShadow:'0 24px 60px rgba(0,0,0,0.6)',overflow:'hidden',
            animation:'qmRise 0.18s ease both'}}>
            {/* header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',
              padding:'16px 18px',borderBottom:'1px solid var(--border)',
              background:'linear-gradient(180deg, rgba(197,169,94,0.10), transparent)'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0}}>
                <span style={{width:'34px',height:'34px',borderRadius:'10px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                  background:'rgba(197,169,94,0.14)',border:'1px solid var(--accent)',color:'var(--accent)'}}>
                  <Icon name="tasks" size={18} />
                </span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'15px',fontWeight:800,color:'var(--text-1)'}}>New task from email</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {taskSrc.subject || '(no subject)'}
                  </div>
                </div>
              </div>
              <button onClick={() => !taskSaving && setTaskOpen(false)} aria-label="Close"
                style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'24px',lineHeight:1,cursor:'pointer',padding:'0 2px'}}>×</button>
            </div>

            {/* body */}
            <div style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:'16px',maxHeight:'68vh',overflowY:'auto'}}>
              {/* title */}
              <div>
                <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'11px',fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'6px'}}>
                  <span>Task title</span>
                  {taskBusy && <span style={{display:'inline-flex',alignItems:'center',gap:'5px',color:'var(--accent)',textTransform:'none',letterSpacing:0,fontWeight:600}}><Icon name="sparkles" size={11} /> summarizing…</span>}
                </label>
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} autoFocus
                  placeholder="What needs to get done?"
                  style={{width:'100%',boxSizing:'border-box',padding:'12px 14px',fontSize:'16px',fontWeight:600,
                    background:'var(--bg-base)',border:'1px solid var(--border-strong, var(--border))',borderRadius:'10px',color:'var(--text-1)'}} />
              </div>

              {/* linked contact */}
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'6px'}}>Linked contact</label>
                {taskContact ? (
                  <span style={{display:'inline-flex',alignItems:'center',gap:'7px',padding:'7px 12px',borderRadius:'999px',
                    background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',color:'var(--text-1)',fontSize:'13px'}}>
                    <Icon name="contacts" size={13} style={{color:'var(--accent)'}} />
                    {taskContact.name}
                    <button onClick={() => setTaskContact(null)} title="Unlink"
                      style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'15px',lineHeight:1,padding:'0 0 0 2px'}}>×</button>
                  </span>
                ) : (
                  <div style={{fontSize:'12px',color:'var(--text-3)'}}>
                    Sender {taskSrc.from ? <span style={{color:'var(--text-2)'}}>{taskSrc.from}</span> : ''} isn’t a saved contact — the task will be created unlinked.
                  </div>
                )}
              </div>

              {/* due date */}
              <div>
                <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'11px',fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'8px'}}>
                  <span>Due date</span>
                  {taskDue && <button onClick={() => setTaskDue('')} style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'10px',cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.03em'}}>× Clear</button>}
                </label>
                <div style={{display:'flex',flexWrap:'wrap',gap:'7px',marginBottom:'9px'}}>
                  {(() => {
                    const iso = (d) => d.toISOString().slice(0,10);
                    const off = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return iso(d); };
                    const dow = (t) => { const d = new Date(); const diff = ((t - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate()+diff); return iso(d); };
                    const chips = [
                      ['Today', off(0)], ['Tomorrow', off(1)], ['This weekend', dow(6)], ['Next week', dow(1)],
                    ];
                    return chips.map(([lbl, val]) => {
                      const active = taskDue === val;
                      return (
                        <button key={lbl} onClick={() => setTaskDue(val)}
                          style={{padding:'7px 12px',borderRadius:'999px',fontSize:'12px',fontWeight:600,cursor:'pointer',
                            border:`1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                            background: active ? 'rgba(197,169,94,0.14)' : 'transparent',
                            color: active ? 'var(--accent)' : 'var(--text-2)'}}>{lbl}</button>
                      );
                    });
                  })()}
                </div>
                <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)}
                  style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',fontSize:'14px',
                    background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',color:'var(--text-1)',colorScheme:'dark'}} />
              </div>

              {/* priority */}
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'8px'}}>Priority</label>
                <PriorityField system={defaultSystem} priority={taskPriority} onChange={setTaskPriority} className=""
                  style={{width:'100%',boxSizing:'border-box',padding:'10px 12px',fontSize:'14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',color:'var(--text-1)',colorScheme:'dark'}} />
              </div>

              {/* notes (email contents) */}
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:'6px'}}>
                  Description <span style={{textTransform:'none',letterSpacing:0,fontWeight:400,color:'var(--text-3)'}}>· email contents (editable)</span>
                </label>
                <textarea value={taskNotes} onChange={e => setTaskNotes(e.target.value)} rows={7}
                  style={{width:'100%',boxSizing:'border-box',padding:'12px 14px',fontSize:'13px',lineHeight:1.5,
                    background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',color:'var(--text-1)',
                    resize:'vertical',fontFamily:'inherit'}} />
              </div>
            </div>

            {/* footer */}
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',padding:'14px 18px',borderTop:'1px solid var(--border)',background:'var(--bg-base)'}}>
              <button onClick={() => !taskSaving && setTaskOpen(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={saveEmailTask} disabled={taskSaving || !taskTitle.trim()}
                style={{padding:'10px 22px',background:'var(--accent)',color:'var(--bg-base)',border:'none',borderRadius:'999px',
                  fontWeight:800,fontSize:'14px',cursor:'pointer',opacity:(taskSaving||!taskTitle.trim())?0.55:1,
                  display:'inline-flex',alignItems:'center',gap:'7px'}}>
                <Icon name="tasks" size={14} /> {taskSaving ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <div className="page-header fade-up" style={{marginBottom:'2px'}}>
        <div style={{display:'flex',gap:'8px',alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap',minHeight:'40px',marginBottom:'4px'}}>
          {syncMsg && <span style={{fontSize:'12px',color: syncMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{syncMsg}</span>}
          {autoTriageProgress && (
            <span style={{fontSize:'11px',color:'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'4px'}}>
              <Icon name="settings" size={12} /> Triaging {autoTriageProgress.done}/{autoTriageProgress.total}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => runAliasesSync(false)} disabled={syncingAliases} title="Re-sync your Send-mail-as aliases from Gmail">
            {syncingAliases ? '↻ Syncing senders…' : `↻ Senders (${verifiedAliases.length})`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={runBackfill} disabled={backfill?.running || syncing}
            title="Pull last 365 days of emails (excludes Promotions / Updates / Social). Safe to leave running in the background — it batches.">
            {backfill?.running ? `↻ Backfill (round ${backfill.round})` : '⤓ Pull 365d'}
          </button>
          <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>{syncing ? 'Syncing…' : '↻ Sync'}</button>
          <HeaderSearchIcon
            value={inboxSearch}
            open={searchOpen}
            onToggle={() => setSearchOpen(o => !o)}
          />
          <button className="btn btn-primary" onClick={openCompose} style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="edit" size={14} /> Compose</button>
        </div>
        <span className="gold-move" style={{fontFamily:"'Barlow Condensed',sans-serif",textTransform:'uppercase',letterSpacing:'.22em',fontSize:'11px',fontWeight:700,display:'inline-block',marginBottom:'2px'}}>Inbox</span>
        <h2 style={{display:'flex',alignItems:'center',gap:'10px',margin:'0',minWidth:0,fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'30px',letterSpacing:'-0.02em'}}><Icon name="inbox" size={24} style={{color:'var(--accent)',flexShrink:0}} /><span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>My Correspondence.</span></h2>
        <p style={{fontSize:'13px',margin:'6px 0 0'}}>
          {!accountSwitcher && <><strong style={{color:'var(--text-1)'}}>{account.email_address}</strong>{' · '}</>}
          {unreadCount > 0 ? `${unreadCount} unread` : 'all caught up'}
          {account.last_sync_at && <> · last sync: {timeAgo(account.last_sync_at)}</>}
          {account.last_sync_error && <> · <span style={{color:'var(--red)'}}>sync error</span></>}
        </p>
        <hr className="gold-hairline" style={{margin:'12px 0 0'}} />
      </div>

      {accountSwitcher}

      <Tip id="speed" label="Speed wins"><b>Speed-to-lead</b> is the highest-ROI habit in real estate: the first agent to respond usually wins the client. Prism surfaces who's waiting on you, so a fast reply becomes automatic — not accidental.</Tip>
      {/* Search input — collapsible. Filters threads client-side by subject,
          snippet, and sender name/email. Doesn't refetch from server. */}
      {searchOpen && (
        <HeaderSearchInput
          value={inboxSearch}
          onChange={setInboxSearch}
          placeholder="🔍 Search this inbox (subject, sender, body)…"
          onClose={() => setSearchOpen(false)}
        />
      )}

      {backfill && (
        <div style={{padding:'10px 14px',marginBottom:'14px',borderRadius:'8px',
          background: backfill.error ? 'rgba(239,68,68,0.10)' : (backfill.running ? 'rgba(197,169,94,0.08)' : 'rgba(34,197,94,0.10)'),
          border: `1px solid ${backfill.error ? '#ef4444' : (backfill.running ? 'var(--accent)' : '#22c55e')}`,
          color: backfill.error ? '#ef4444' : (backfill.running ? 'var(--text-1)' : '#22c55e'),
          fontSize:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px'}}>
          <span>{backfill.error ? `Backfill failed: ${backfill.error}` : backfill.message}</span>
          {!backfill.running && (
            <button onClick={() => setBackfill(null)} style={{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:'14px'}}>×</button>
          )}
        </div>
      )}

      {!account.initial_sync_done && (
        <div className="panel" style={{marginBottom:'14px',background:'rgba(197, 169, 94, 0.08)',borderColor:'var(--accent)'}}>
          <div className="panel-body" style={{padding:'14px'}}>
            <p style={{margin:0,fontSize:'14px',color:'var(--text-1)'}}>
              <strong>First sync hasn't run yet.</strong> Tap <strong>Sync</strong> to pull your most recent messages.
            </p>
          </div>
        </div>
      )}

      <div style={{
        display: (singlePane || (readerExpanded && selectedThread)) ? 'block' : 'grid',
        gridTemplateColumns: selectedThread ? 'minmax(320px, 360px) minmax(0, 1fr)' : '1fr',
        gap: '18px'
      }}>
        <div style={{display: ((singlePane || readerExpanded) && selectedThread) ? 'none' : 'block'}}>
          <div className="panel">
            <div className="panel-header">
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                {['inbox','snoozed','sent'].map(t => (
                  <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-ghost'}`} onClick={()=>{setTab(t); setSelectedThread(null);}}>
                    {t === 'inbox' ? 'Inbox' : t === 'snoozed' ? <><Icon name="clock" size={12} /> Snoozed</> : 'Sent'}
                    {t==='inbox' && unreadCount>0 && <span className="nav-badge" style={{marginLeft:'6px'}}>{unreadCount}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-body">
              {loadingThreads
                ? <div className="loading-screen" style={{minHeight:'200px'}}><div className="spinner"/></div>
                : filteredThreads.length === 0
                  ? <div className="empty-state">
                      <div className="empty-icon">{inboxSearch ? <Icon name="search" size={30} /> : <Icon name="inbox" size={30} />}</div>
                      <p>
                        {inboxSearch
                          ? <>No threads match <strong>"{inboxSearch}"</strong>.</>
                          : (tab==='sent' ? 'No sent messages yet.' : 'Inbox is empty.')}
                      </p>
                      {inboxSearch && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setInboxSearch(''); setSearchOpen(false); }} style={{marginTop:'8px'}}>
                          Clear search
                        </button>
                      )}
                    </div>
                  : <div className="email-list">
                      {filteredThreads.map(thread => {
                        const sender = senderFromThread(thread);
                        const senderProfile = profileForEmail(sender.email);
                        // Pass 4 Batch D: triage indicator in thread list — colored dot
                        // hover tip with category name. Subtle so it doesn't shout.
                        const threadTriage = triageCache[thread.id];
                        const triageCat = threadTriage ? TRIAGE_CATEGORIES[threadTriage.category] : null;
                        // Swipe gestures enabled only on the Inbox tab (Sent/Snoozed
                        // don't have a meaningful archive/delete action from a list row).
                        const swipeEnabled = tab === 'inbox';
                        return (
                          <SwipeableEmailRow key={thread.id}
                            enabled={swipeEnabled}
                            onDelete={() => swipeDeleteThread(thread)}
                            onArchive={() => swipeArchiveThread(thread)}
                            onClick={() => openThread(thread)}>
                            <div className={`email-item ${thread.has_unread?'email-unread':''}`} style={{cursor:'pointer'}}>
                              {thread.has_unread && <div className="unread-dot"/>}
                              <div className="email-avatar">{initials(sender.name, sender.email)}</div>
                              <div className="email-content" style={{minWidth:0}}>
                                <div className="email-from" style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                                  {triageCat && (
                                    <span
                                      title={`AI triage: ${triageCat.label} → ${TRIAGE_ACTIONS[threadTriage.action]?.label || threadTriage.action}`}
                                      style={{width:'7px',height:'7px',borderRadius:'50%',background:triageCat.color,flexShrink:0,display:'inline-block'}} />
                                  )}
                                  {(thread.labels || []).includes('STARRED') && (
                                    <span style={{color:'#f59e0b',fontSize:'12px',flexShrink:0}} title="Starred">★</span>
                                  )}
                                  <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{sender.name || sender.email || '(unknown)'}</span>
                                  {senderProfile && (
                                    <span className="pill pill-purple" style={{fontSize:'10px',padding:'2px 6px'}}>
                                      {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                                    </span>
                                  )}
                                  {thread.message_count > 1 && <span style={{color:'var(--text-3)',fontSize:'12px'}}>({thread.message_count})</span>}
                                  {thread.snoozed_until && new Date(thread.snoozed_until) > new Date() && (
                                    <span style={{fontSize:'10px',color:'var(--accent)',padding:'2px 6px',background:'rgba(197,169,94,0.10)',borderRadius:'4px'}}>
                                      <Icon name="clock" size={11} /> until {new Date(thread.snoozed_until).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
                                    </span>
                                  )}
                                </div>
                                <div className="email-subject" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{thread.subject || '(no subject)'}</div>
                                <div className="email-preview" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{thread.snippet || ''}</div>
                              </div>
                              <span className="email-time" style={{flexShrink:0}}>{timeAgo(thread.last_message_at)}</span>
                            </div>
                          </SwipeableEmailRow>
                        );
                      })}
                    </div>
              }
            </div>
          </div>
        </div>
        {selectedThread && (
          <div className="panel" ref={readingPaneRef} style={{display:'flex',flexDirection:'column'}}>
            {/* Sticky action bar at the top */}
            {/* Action bar — two rows: context/nav on top, actions below.
                Wrapping (not clipping) keeps every button reachable on a phone. */}
            <div style={{
              position:'sticky', top:0, zIndex:5,
              background:'var(--bg-card)',
              borderBottom:'1px solid var(--border)',
              padding:'8px 12px',
              display:'flex', flexDirection:'column', gap:'8px'
            }}>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                {/* Row 1 — where am I + navigation */}
              <button className="btn btn-ghost" onClick={()=>setSelectedThread(null)}
                title={singlePane ? 'Back to inbox' : 'Close'}
                style={{flexShrink:0,padding:'8px 12px',fontSize:'13px',minHeight:'38px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                <span style={{fontSize:'17px',lineHeight:1}}>‹</span> {singlePane ? 'Inbox' : 'Close'}
              </button>

              {/* Prev / next navigation through the visible list */}
              <div style={{display:'flex',alignItems:'center',gap:'4px',flexShrink:0}}>
                <button className="btn btn-ghost" onClick={()=>goAdjacent(-1)} disabled={!hasNewer}
                  title="Newer (↑ or k)" aria-label="Newer email"
                  style={{width:'36px',height:'36px',padding:0,fontSize:'20px',lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',opacity:hasNewer?1:0.3,cursor:hasNewer?'pointer':'default'}}>‹</button>
                <button className="btn btn-ghost" onClick={()=>goAdjacent(1)} disabled={!hasOlder}
                  title="Older (↓ or j)" aria-label="Older email"
                  style={{width:'36px',height:'36px',padding:0,fontSize:'20px',lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',opacity:hasOlder?1:0.3,cursor:hasOlder?'pointer':'default'}}>›</button>
                {selIndex >= 0 && (
                  <span style={{fontSize:'12px',fontWeight:600,color:'var(--text-2)',whiteSpace:'nowrap',marginLeft:'4px',padding:'5px 11px',borderRadius:'999px',background:'var(--bg-base)',border:'1px solid var(--border)'}}>
                    {selIndex+1} <span style={{color:'var(--text-3)',fontWeight:400}}>of</span> {filteredThreads.length}
                  </span>
                )}
              </div>

              {/* Expand / collapse the reader to full width (wide screens only) */}
              {!singlePane && (
                <button className="btn btn-ghost" onClick={()=>setReaderExpanded(v=>!v)}
                  title={readerExpanded ? 'Show inbox list' : 'Expand to full width'} aria-label="Toggle full-width reader"
                  style={{flexShrink:0,marginLeft:'auto',padding:'8px 10px',minHeight:'36px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                  {readerExpanded ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="10" y1="14" x2="3" y2="21"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                  )}
                  <span style={{fontSize:'12px'}}>{readerExpanded ? 'Show list' : 'Expand'}</span>
                </button>
              )}

              </div>

              {/* Row 2 — actions (wrap instead of clip; big tap targets) */}
              {selectedMessages.length > 0 && (() => {
                const latest = selectedMessages[selectedMessages.length - 1];
                return (
                  <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                    {/* Star */}
                    <button className="btn btn-ghost"
                      onClick={() => modifyThread(isStarred ? 'unstar' : 'star')}
                      title={isStarred ? 'Unstar' : 'Star'} aria-label="Star"
                      style={{flexShrink:0,width:'40px',height:'40px',padding:0,fontSize:'20px',display:'inline-flex',alignItems:'center',justifyContent:'center',color: isStarred ? '#f59e0b' : 'var(--text-2)'}}>
                      {isStarred ? '★' : '☆'}
                    </button>

                    {/* Reply — primary action, grows to fill the row */}
                    <button className="btn btn-primary" onClick={() => openReply(latest, false)}
                      style={{flex:'1 1 auto',minWidth:'104px',minHeight:'40px',padding:'9px 14px',fontSize:'13px',fontWeight:700,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'6px'}}>
                      <Icon name="reply" size={15} /> Reply
                    </button>

                    {/* Reply all */}
                    <button className="btn btn-ghost" onClick={() => openReply(latest, true)}
                      title="Reply all"
                      style={{flexShrink:0,minHeight:'40px',padding:'9px 12px',fontSize:'13px',fontWeight:600,display:'inline-flex',alignItems:'center',gap:'6px'}}>
                      <Icon name="replyAll" size={15} /> <span style={{whiteSpace:'nowrap'}}>Reply all</span>
                    </button>

                    {/* Add to tasks — turns this email into a task */}
                    <button className="btn btn-ghost" onClick={() => openCreateTask(latest)}
                      title="Add to tasks" aria-label="Add to tasks"
                      style={{flexShrink:0,minHeight:'40px',padding:'9px 12px',fontSize:'13px',fontWeight:600,display:'inline-flex',alignItems:'center',gap:'6px'}}>
                      <Icon name="tasks" size={15} /> Task
                    </button>

                    {/* Archive — only when not already archived */}
                    {tab !== 'sent' && (
                      <button className="btn btn-ghost"
                        onClick={() => actAndAdvance('archive')}
                        title="Archive — keeps reading the next email"
                        style={{flexShrink:0,minHeight:'40px',padding:'9px 12px',fontSize:'13px',fontWeight:600,display:'inline-flex',alignItems:'center',gap:'6px'}}>
                        <Icon name="archive" size={15} /> Archive
                      </button>
                    )}

                    {/* Delete — moves to Trash, advances to next, no confirm */}
                    <button className="btn btn-ghost" onClick={() => actAndAdvance('trash')}
                      title="Delete (move to Trash) — keeps reading the next email"
                      style={{flexShrink:0,minHeight:'40px',padding:'9px 12px',fontSize:'13px',fontWeight:600,color:'var(--red)',display:'inline-flex',alignItems:'center',gap:'6px'}}>
                      <Icon name="trash" size={15} /> Delete
                    </button>

                    {/* More menu — everything else (Gmail-style).
                        Rendered in a portal so it can't be clipped by the toolbar's
                        overflow:hidden (which is needed to prevent button overflow). */}
                    <div style={{position:'relative',marginLeft:'auto',flexShrink:0}}>
                      <button ref={moreButtonRef} className="btn btn-ghost"
                        onClick={(e) => {
                          // Measure button position so the portal-rendered dropdown
                          // anchors below+right of it
                          const r = e.currentTarget.getBoundingClientRect();
                          setMoreMenuPos({
                            top: r.bottom + 4,
                            right: Math.max(8, window.innerWidth - r.right),
                          });
                          setShowMoreMenu(m => !m);
                          setShowSnoozePicker(false);
                        }}
                        title="More actions" aria-label="More actions"
                        style={{minHeight:'40px',padding:'9px 12px',fontSize:'18px',lineHeight:1}}>
                        ⋮
                      </button>
                    </div>
                    {showMoreMenu && createPortal(
                      <>
                        {/* Invisible backdrop captures clicks-outside to close */}
                        <div onClick={() => { setShowMoreMenu(false); setShowSnoozePicker(false); }}
                          style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}}/>
                        <div style={{
                          position:'fixed',
                          top: moreMenuPos.top,
                          right: moreMenuPos.right,
                          zIndex:9999,
                          background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',
                          boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
                          minWidth:'220px',padding:'4px'
                        }}>
                          {/* Reply all — always shown for menu consistency.
                              On solo-recipient threads this behaves identically to Reply. */}
                          <button
                            onClick={() => { openReply(latest, true); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="replyAll" size={14} /> Reply all
                          </button>

                          {/* Add to task */}
                          <button
                            onClick={() => { openCreateTask(latest); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="tasks" size={14} /> Add to task
                          </button>

                          {/* Forward */}
                          <button
                            onClick={() => { openForward(latest); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="forward" size={14} /> Forward
                          </button>

                          {/* Add to Knowledge */}
                          <button
                            onClick={() => { addEmailToKnowledge(latest); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <span style={{fontSize:'14px'}}>📚</span> Add to Knowledge
                          </button>

                          {/* Add sender to contacts */}
                          <button
                            onClick={() => createContactFromSender(latest)}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="contacts" size={14} /> Add sender to contacts
                          </button>

                          <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}/>

                          {/* Snooze — opens sub-popover */}
                          <div>
                            <button
                              onClick={() => setShowSnoozePicker(s => !s)}
                              style={{display:'flex',justifyContent:'space-between',alignItems:'center',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                              <span style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="clock" size={14} /> Snooze</span>
                              <span style={{color:'var(--text-3)',fontSize:'11px'}}>{showSnoozePicker ? '▾' : '▸'}</span>
                            </button>
                            {showSnoozePicker && (
                              <div style={{paddingLeft:'12px'}}>
                                {snoozeOptions().map(opt => (
                                  <button key={opt.key}
                                    onClick={() => { snoozeThread(opt.date); setShowMoreMenu(false); }}
                                    style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'12px'}}>
                                    <div>{opt.label}</div>
                                    <div style={{fontSize:'10px',color:'var(--text-3)'}}>{opt.sub}</div>
                                  </button>
                                ))}
                                <div style={{padding:'6px 12px'}}>
                                  <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Pick date</div>
                                  <div style={{display:'flex',gap:'4px'}}>
                                    <input type="datetime-local" className="form-input"
                                      value={customSnoozeDate}
                                      onChange={e => setCustomSnoozeDate(e.target.value)}
                                      style={{padding:'4px 6px',fontSize:'11px',margin:0,flex:1}} />
                                    <button className="btn btn-primary btn-sm"
                                      disabled={!customSnoozeDate}
                                      onClick={() => { snoozeThread(new Date(customSnoozeDate)); setShowMoreMenu(false); }}
                                      style={{padding:'4px 8px',fontSize:'11px'}}>Go</button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Mark unread/read */}
                          <button
                            onClick={() => { modifyThread(isUnread ? 'mark_read' : 'mark_unread'); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                            {isUnread ? '✓ Mark as read' : '○ Mark as unread'}
                          </button>

                          {/* Labels */}
                          <button
                            onClick={() => { setShowLabelPicker(true); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="tag" size={14} /> Apply labels…
                          </button>

                          <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}/>

                          {/* Mark as spam (destructive) */}
                          <button
                            onClick={() => { modifyThread('spam', { removeFromList: true }); setShowMoreMenu(false); }}
                            style={{width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--red)',fontSize:'13px',display:'flex',alignItems:'center',gap:'8px'}}>
                            <Icon name="alert" size={14} /> Mark as spam
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Subject line */}
            <div style={{padding:'14px 16px 6px',borderBottom:'1px solid var(--border)'}}>
              <h3 style={{margin:0,fontSize:'17px',fontWeight:600,color:'var(--text-1)',lineHeight:1.35,wordBreak:'break-word'}}>
                {selectedThread.subject || '(no subject)'}
              </h3>
              {threadTracking && (() => {
                const seen = threadTracking.status === 'likely_seen';
                const machine = threadTracking.status === 'opened_machine';
                const when = seen ? threadTracking.confident_open_at : threadTracking.last_open_at;
                const est = when ? new Date(when).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
                if (!seen && !machine) return <div style={{marginTop:7,fontSize:'11px',color:'var(--text-3)',fontWeight:600}}>✓ Delivered · not yet loaded</div>;
                return (
                  <div title={seen ? 'A genuine open (scanners & Apple auto-loads filtered out).' : 'Image was auto-loaded (Apple Mail or a scanner) — likely not a confirmed human open.'}
                    style={{marginTop:8,display:'inline-flex',alignItems:'center',gap:6,background:seen?'rgba(197,169,94,0.12)':'var(--bg-base)',border:'1px solid '+(seen?'rgba(197,169,94,0.45)':'var(--border)'),color:seen?'var(--accent)':'var(--text-2)',fontSize:'11px',fontWeight:700,borderRadius:8,padding:'5px 9px'}}>
                    {seen ? '👁 Likely seen · ' : '◐ Loaded (unconfirmed) · '}{est} EST{threadTracking.open_count>1 ? ' · '+threadTracking.open_count+'×' : ''}
                  </div>
                );
              })()}
            </div>

            {/* Pass 4 Batch D: AI triage card */}
            {(() => {
              const triage = triageCache[selectedThread.id];
              const isLoading = !!triageLoading[selectedThread.id];
              if (!triage && !isLoading) {
                // No cached row and not currently running — offer to run on demand.
                // This is the path for older threads from before auto-triage existed.
                return (
                  <div style={{padding:'10px 16px',background:'var(--bg-base)',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px'}}>
                    <span style={{fontSize:'11px',color:'var(--text-3)'}}>No AI triage yet for this thread.</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => triageThread(selectedThread.id)} style={{fontSize:'11px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                      <Icon name="settings" size={12} /> Triage
                    </button>
                  </div>
                );
              }
              if (isLoading && !triage) {
                return (
                  <div style={{padding:'10px 16px',background:'var(--bg-base)',borderBottom:'1px solid var(--border)',fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
                    ↻ Analyzing thread…
                  </div>
                );
              }
              // We have a triage row (possibly stale; the action button can re-run)
              const cat = TRIAGE_CATEGORIES[triage.category] || TRIAGE_CATEGORIES.fyi;
              const act = TRIAGE_ACTIONS[triage.action] || { label: triage.action };
              const confidencePct = Math.round((Number(triage.confidence) || 0) * 100);
              return (
                <div style={{padding:'10px 16px',background:'var(--bg-base)',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
                        <span className="pill" style={{fontSize:'11px',padding:'3px 8px',background:`${cat.color}1a`,border:`1px solid ${cat.color}`,color:cat.color,fontWeight:600}}>
                          {cat.icon} {cat.label}
                        </span>
                        <span style={{fontSize:'11px',color:'var(--text-2)'}}>→ <strong>{act.label}</strong></span>
                        <span style={{fontSize:'10px',color:'var(--text-2)'}}>· {confidencePct}% confident</span>
                      </div>
                      {triage.summary && (
                        <div style={{fontSize:'12px',color:'var(--text-1)',lineHeight:1.4,marginBottom:'4px'}}>
                          {triage.summary}
                        </div>
                      )}
                      {triage.reasoning && (
                        <div style={{fontSize:'12.5px',color:'var(--text-2)',fontStyle:'italic',lineHeight:1.5}}>
                          {triage.reasoning}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => triageThread(selectedThread.id, { force: true })}
                      disabled={isLoading}
                      title="Re-run AI triage on this thread"
                      style={{fontSize:'11px',flexShrink:0}}>
                      {isLoading ? '↻ …' : '↻ Re-run'}
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="panel-body" style={{padding:'0'}}>
              {loadingMessages
                ? <div className="loading-screen" style={{minHeight:'200px'}}><div className="spinner"/></div>
                : selectedMessages.length === 0
                  ? <p style={{color:'var(--text-2)',padding:'20px'}}>No messages found in this thread.</p>
                  : selectedMessages.map((msg, idx) => {
                      const senderProfile = profileForEmail(msg.from_address);
                      const sentTo = Array.isArray(msg.to_addresses) ? msg.to_addresses : [];
                      const fmtRecipient = (r) => {
                        if (typeof r === 'string') return r;
                        if (r && typeof r === 'object') return r.name ? `${r.name} <${r.email}>` : r.email;
                        return String(r);
                      };
                      const isLast = idx === selectedMessages.length - 1;
                      const canReplyAll = sentTo.length > 1 || (msg.cc_addresses || []).length > 0;
                      return (
                        <div key={msg.id} style={{borderBottom: isLast ? 'none' : '1px solid var(--border)'}}>
                          {/* Metadata card */}
                          <div style={{
                            padding:'12px 16px',
                            background:'var(--bg-base)',
                            borderBottom:'1px solid var(--border)'
                          }}>
                            <div style={{display:'flex',gap:'10px',alignItems:'flex-start',flexWrap:'wrap'}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                                  {(() => {
                                    const sc = findContact(msg.from_address);
                                    const label = msg.from_name || msg.from_address;
                                    if (!sc) return <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{label}</span>;
                                    return (
                                      <button type="button" title={`Open ${sc.name}'s record`}
                                        onClick={() => window.__openContact && window.__openContact(sc.id)}
                                        style={{fontWeight:600,color:'var(--accent)',fontSize:'14px',background:'none',border:'none',padding:0,cursor:'pointer',textAlign:'left',textDecorationLine:'underline',textDecorationStyle:'dotted',textUnderlineOffset:'3px'}}>
                                        {label}
                                      </button>
                                    );
                                  })()}
                                  {senderProfile && (
                                    <span className="pill" style={{background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',color:'var(--accent)',fontSize:'10px',padding:'2px 6px'}}>
                                      {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                                    </span>
                                  )}
                                </div>
                                {msg.from_name && (
                                  <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'4px',wordBreak:'break-word'}}>
                                    {msg.from_address}
                                  </div>
                                )}
                                {sentTo.length > 0 && (
                                  <div style={{fontSize:'11px',color:'var(--text-3)',wordBreak:'break-word',lineHeight:1.5}}>
                                    <span style={{color:'var(--text-3)'}}>to </span>
                                    {sentTo.map((r, ri) => {
                                      const em = typeof r === 'string' ? r : (r && r.email) || '';
                                      const rc = findContact(em);
                                      const label = fmtRecipient(r);
                                      return (
                                        <React.Fragment key={ri}>
                                          {ri > 0 && ', '}
                                          {rc ? (
                                            <button type="button" title={`Open ${rc.name}'s record`}
                                              onClick={() => window.__openContact && window.__openContact(rc.id)}
                                              style={{color:'var(--accent)',fontSize:'11px',background:'none',border:'none',padding:0,cursor:'pointer',textDecorationLine:'underline',textDecorationStyle:'dotted',textUnderlineOffset:'2px'}}>
                                              {label}
                                            </button>
                                          ) : label}
                                        </React.Fragment>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <div style={{fontSize:'11px',color:'var(--text-3)',whiteSpace:'nowrap',flexShrink:0}}>
                                {msg.internal_date ? new Date(msg.internal_date).toLocaleString(undefined, {
                                  month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'
                                }) : ''}
                              </div>
                            </div>
                          </div>

                          {/* Message body — prefer HTML (richer, clickable links, formatting).
                              Fall back to text with auto-linked URLs. Final fallback: snippet. */}
                          <div style={{padding:'14px 16px'}}>
                            {msg.body_html ? (
                              <EmailHtmlFrame html={msg.body_html} />
                            ) : msg.body_text ? (
                              <PlainTextBody text={msg.body_text} />
                            ) : (
                              <div style={{fontSize:'13.5px',lineHeight:'1.7',color:'var(--text-3)',fontStyle:'italic'}}>
                                {msg.snippet || '(no content)'}
                              </div>
                            )}
                          </div>

                          {msg.has_attachments && <MessageAttachments message={msg} account={account} />}

                          {/* Per-message reply buttons (Gmail-style: at bottom of each message in a thread) */}
                          {isLast && (
                            <div style={{display:'flex',gap:'6px',padding:'0 16px 16px',flexWrap:'wrap'}}>
                              <button className="btn btn-ghost btn-sm" onClick={() => openReply(msg, false)} style={{fontSize:'12px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="reply" size={12} /> Reply</button>
                              {canReplyAll && (
                                <button className="btn btn-ghost btn-sm" onClick={() => openReply(msg, true)} style={{fontSize:'12px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="replyAll" size={12} /> Reply all</button>
                              )}
                              <button className="btn btn-ghost btn-sm" onClick={() => openForward(msg)} style={{fontSize:'12px',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="forward" size={12} /> Forward</button>
                            </div>
                          )}
                        </div>
                      );
                    })
              }
            </div>
          </div>
        )}
      </div>

      {showLabelPicker && selectedThread && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowLabelPicker(false)} style={{zIndex: 1100}}>
          <div className="modal" style={{maxWidth:'460px',width:'92%'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0,display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="tag" size={15} /> Apply labels</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLabelPicker(false)}>✕</button>
            </div>
            <LabelPickerBody
              currentLabels={currentLabels}
              userLabels={userLabels}
              onApply={applyLabels}
              onRefresh={refreshLabels}
              onCancel={() => setShowLabelPicker(false)}
            />
          </div>
        </div>
      )}

      {showCompose && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget && setShowCompose(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>{composeReplyMeta ? 'Reply' : 'New message'}</h3>
              <button className="modal-close" onClick={()=>setShowCompose(false)}>×</button>
            </div>
            <form onSubmit={handleSend}>
              <div className="form-group">
                <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>From</span>
                  {verifiedAliases.length === 0 && (
                    <button type="button" onClick={() => runAliasesSync(false)} disabled={syncingAliases} className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)'}}>
                      {syncingAliases ? 'syncing…' : 'sync senders'}
                    </button>
                  )}
                </label>
                {verifiedAliases.length === 0 ? (
                  <div style={{padding:'8px 12px',background:'var(--bg-base)',borderRadius:'6px',fontSize:'12px',color:'var(--text-3)'}}>
                    Sending as <strong style={{color:'var(--text-1)'}}>{account.email_address}</strong> · click <strong>sync senders</strong> to load your Gmail aliases
                  </div>
                ) : (
                  <select
                    className="form-select"
                    value={composeFrom || (defaultAlias?.email_address || account.email_address)}
                    onChange={e => setComposeFrom(e.target.value)}
                  >
                    {verifiedAliases.map(a => (
                      <option key={a.email_address} value={a.email_address}>
                        {a.display_name ? `${a.display_name} <${a.email_address}>` : a.email_address}
                        {a.is_default ? ' · default' : ''}
                        {a.is_primary ? ' · primary' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>To</span>
                  {!showCcBcc && <button type="button" onClick={()=>setShowCcBcc(true)} className="btn btn-ghost btn-sm" style={{padding:'4px 12px',fontSize:'12px',fontWeight:700,color:'var(--accent)',border:'1px solid var(--accent-dim, rgba(203,163,92,.4))',borderRadius:'999px'}}>+ Add Cc / Bcc</button>}
                </label>
                <RecipientPicker
                  value={composeTo}
                  onChange={setComposeTo}
                  pendingRef={composeToPendingRef}
                  contacts={contacts}
                  profiles={profiles}
                  placeholder="Type a name or email…"
                  autoFocus={!composeReplyMeta}
                />
              </div>
              {showCcBcc && (
                <>
                  <div className="form-group">
                    <label className="form-label">Cc</label>
                    <RecipientPicker value={composeCc} onChange={setComposeCc} pendingRef={composeCcPendingRef} contacts={contacts} profiles={profiles} placeholder="Carbon copy — they'll see each other" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span>Bcc</span>
                      <span style={{fontSize:'10px',color:'var(--text-3)',fontWeight:400}}>hidden from all recipients</span>
                    </label>
                    <RecipientPicker value={composeBcc} onChange={setComposeBcc} pendingRef={composeBccPendingRef} contacts={contacts} profiles={profiles} placeholder="Blind copy — others won't see these" />
                  </div>
                </>
              )}
              <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject" required /></div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'6px'}}>
                  {aiDrafting && <ForkTuningOverlay contactName={replyCtx?.from_name || null} />}
                  {composeReplyMeta && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={aiDrafting} onClick={aiReplyDraft}
                      title="Draft a reply adapted to the recipient's DISC communication style"
                      style={{color:'var(--accent)',border:'1px solid var(--accent-dim)',display:'inline-flex',alignItems:'center',gap:'6px',padding:'5px 11px',fontWeight:600}}>
                      <Icon name="sparkles" size={13} /> {aiDrafting ? 'Drafting…' : 'AI reply'}
                    </button>
                  )}
                  {composeReplyMeta && (() => {
                    const fe = (composeTo.split(',')[0] || '').trim();
                    const p = profileForEmail(fe);
                    return p?.primary_letter
                      ? <span style={{fontSize:'11px',color:'var(--text-3)'}}>adapted to <strong style={{color:'var(--accent)'}}>{p.primary_letter}{p.secondary_letter ? '/' + p.secondary_letter : ''}</strong> style</span>
                      : <span style={{fontSize:'11px',color:'var(--text-3)'}}>no DISC profile yet · neutral tone</span>;
                  })()}
                  <span style={{marginLeft:'auto'}}><AriRewriteButton text={composeBody} onRewrite={setComposeBody} contactName={composeTo} textareaRef={composeBodyRef} /></span>
                </div>
                <textarea ref={composeBodyRef} className="form-textarea" value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Write your message…" style={{minHeight:'200px'}} required />
              </div>
              <div style={{ marginTop: '8px' }}>
                <input ref={composeAttachRef} type="file" multiple onChange={onPickComposeAttachments} style={{ display: 'none' }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => composeAttachRef.current && composeAttachRef.current.click()} style={{ fontSize: '11px' }}>📎 Attach file</button>
                <button type="button" onClick={() => setComposeTrack(v => !v)} title="Get a 'Likely seen' read signal. Off by default." style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: composeTrack ? 'var(--accent)' : 'var(--text-3)' }}>
                  <span style={{ width: '15px', height: '15px', borderRadius: '4px', border: `2px solid ${composeTrack ? 'var(--accent)' : 'var(--text-3)'}`, background: composeTrack ? 'var(--accent)' : 'transparent', color: '#1a1300', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: '11px' }}>{composeTrack ? '✓' : ''}</span>
                  Track opens
                </button>
                {composeAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {composeAttachments.map((a, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', padding: '5px 8px', borderRadius: '8px', border: '1px solid rgba(197,169,94,0.45)', background: 'rgba(197,169,94,0.10)', fontSize: '11px', color: 'var(--text-1)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>📄 {a.filename}</span>
                        <span style={{ color: 'var(--text-3)' }}>{fmtAttachBytes(a.size)}</span>
                        <button type="button" onClick={() => removeComposeAttachment(i)} title="Remove attachment" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {sendMsg && <p style={{fontSize:'13px',color: sendMsg === 'Sent.' ? 'var(--green)' : '#e0965a',margin:'4px 0'}}>{sendMsg}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={()=>setShowCompose(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>{sending?'Sending…':'Send'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────
// Global "Needs Attention" command center — rolls up replies owed, follow-ups
// due, and contacts overdue for outreach into one daily action queue.

function LabelPickerBody({ currentLabels, userLabels, onApply, onRefresh, onCancel }) {
  const [selected, setSelected] = useState(new Set(currentLabels.filter(l => !['INBOX','SENT','TRASH','SPAM','STARRED','UNREAD','IMPORTANT','DRAFT','CATEGORY_PERSONAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','CATEGORY_SOCIAL','CATEGORY_FORUMS'].includes(l))));
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = query
    ? userLabels.filter(l => l.name.toLowerCase().includes(query.toLowerCase()))
    : userLabels;

  function toggle(labelId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); }
    finally { setRefreshing(false); }
  }

  function handleApply() {
    const initial = new Set(currentLabels.filter(l => userLabels.some(ul => ul.label_id === l)));
    const toAdd = Array.from(selected).filter(id => !initial.has(id));
    const toRemove = Array.from(initial).filter(id => !selected.has(id));
    onApply(toAdd, toRemove);
  }

  return (
    <div style={{padding:'14px',display:'flex',flexDirection:'column',gap:'10px'}}>
      <div style={{display:'flex',gap:'6px'}}>
        <input className="form-input" placeholder="Search labels…"
          value={query} onChange={e => setQuery(e.target.value)}
          style={{flex:1,fontSize:'12px',padding:'6px 10px',margin:0}} />
        <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={refreshing} title="Re-sync labels from Gmail">
          {refreshing ? '↻' : '↻ Sync'}
        </button>
      </div>
      <div style={{maxHeight:'320px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'6px'}}>
        {filtered.length === 0 && (
          <div style={{padding:'20px',textAlign:'center',color:'var(--text-3)',fontSize:'12px'}}>
            {userLabels.length === 0 ? 'No custom labels found. Click ↻ Sync to fetch from Gmail.' : 'No matches.'}
          </div>
        )}
        {filtered.map(l => {
          const isChecked = selected.has(l.label_id);
          return (
            <label key={l.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid var(--border)'}}>
              <input type="checkbox" checked={isChecked} onChange={() => toggle(l.label_id)} />
              <span style={{fontSize:'13px',color:'var(--text-1)',flex:1}}>{l.name}</span>
              {l.color?.backgroundColor && (
                <span style={{width:'12px',height:'12px',borderRadius:'2px',background:l.color.backgroundColor,flexShrink:0}}/>
              )}
            </label>
          );
        })}
      </div>
      <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleApply}>Apply</button>
      </div>
    </div>
  );
}

// ─── RecruitingView ──────────────────────────────────────────────────
// Brokerage agent-recruiting pipeline. Distinct from agent lead-gen —
// different math (cost per signed agent, retention, LTV vs cost per
// closed file). Recruits are contacts with type='recruit' and a
// recruiting_stage. Spend is tracked via recruiting_systems (parallel
// to lead_gen_systems) so the two reports never mix.


export default InboxView;
