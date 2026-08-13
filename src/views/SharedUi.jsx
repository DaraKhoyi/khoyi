// SharedUi — the small components several feature screens share: the contact
// picker, the header search, the multi-value field, the recruiting KPI tile, plus
// the dictation hook and the email->task helper.
//
// These lived in App.js, which is why sixteen views imported from '../App' and
// created a circular App -> view -> App edge. They belong in a shared module: the
// composition root should be imported by nobody.
// Extracted from App.js (strangle the monolith, step 27).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../dataService';
import { canHover, resolveSendAccount } from '../helpers';
import { Icon } from '../icons';
import { confirmDialog, notify, notifyError, subscribeConfirms, subscribeToasts } from '../notify';
import { TIPS_UNLOCK_AT, Tip, TipFor, effectivePace, setTipsEnabled, setTipsPace, tipCooldownMs, tipsAreEnabled, tipsLastShown, tipsPace, tipsSeenCount, tipsSeenList, tipsUnlocked } from '../tipsUi';

export function ContactPicker({ contacts = [], selectedIds = [], onChange, label = 'Contacts', placeholder = 'Search by name, email, or company…', emptyText = 'No matches.' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const linked = selectedIds.map(id => contacts.find(c => c.id === id)).filter(Boolean);
  const q = query.trim().toLowerCase();
  const options = (() => {
    const base = contacts.filter(c => !selectedIds.includes(c.id));
    if (!q) return base.slice(0, 20);
    return base.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    ).slice(0, 20);
  })();
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'8px'}}>
        {linked.map(c => (
          <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',borderRadius:'12px',fontSize:'12px',color:'var(--text-1)'}}>
            {c.name}
            <button type="button" onClick={() => onChange(selectedIds.filter(id => id !== c.id))}
              style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',padding:'0 0 0 4px',fontSize:'14px',lineHeight:1}}>×</button>
          </span>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} style={{fontSize:'11px',padding:'4px 10px'}}>
          {open ? '× Close' : '+ Add contact'}
        </button>
      </div>
      {open && (
        <div style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'8px',background:'var(--bg-base)',maxHeight:'240px',display:'flex',flexDirection:'column'}}>
          <input className="form-input" autoFocus value={query} onChange={e=>setQuery(e.target.value)}
            placeholder={placeholder} style={{margin:0,marginBottom:'6px',fontSize:'12px'}} />
          <div style={{overflowY:'auto',flex:1}}>
            {options.length === 0 && (
              <div style={{padding:'12px',textAlign:'center',color:'var(--text-3)',fontSize:'11px'}}>
                {query ? emptyText : 'No contacts to add.'}
              </div>
            )}
            {options.map(c => (
              <button key={c.id} type="button"
                onClick={() => { onChange([...selectedIds, c.id]); setQuery(''); }}
                style={{display:'block',width:'100%',textAlign:'left',padding:'6px 8px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',fontSize:'12px',color:'var(--text-1)'}}
                onMouseEnter={e  => { if (!canHover()) return; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <div style={{fontWeight:600}}>{c.name}</div>
                {(c.email || c.company) && (
                  <div style={{fontSize:'10px',color:'var(--text-3)'}}>
                    {c.email}{c.email && c.company ? ' · ' : ''}{c.company}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// TASK MODAL
// ─────────────────────────────────────────

// ── resolveSendAccount ───────────────────────────────────────────────────────
// Which account outbound mail sends from. Every call site used to run its own
// `.order('created_at').limit(1)`, so mail went from the OLDEST-connected
// account regardless of intent — which is why it kept going out as
// dara@brokerdara.com. Precedence: the user's chosen default, then any active
// email-capable account, then oldest as a last resort.

export async function emailAssignTask(taskId, email) {
  if (!taskId || !email || !email.to) return { error: null };
  const acc = await resolveSendAccount('id');
  if (!acc) return { error: 'No connected email account — connect Gmail in Settings.' };
  const { data: sr, error: se } = await supabase.functions.invoke('gmail-send', { body: { account_id: acc.id, to: email.to, subject: email.subject, body_text: email.body } });
  if (se || (sr && sr.error)) return { error: 'Email send failed: ' + ((se && se.message) || (sr && sr.error)) };
  await supabase.from('tasks').update({ assignment_method: 'email', assignee_email: email.to, email_thread_id: sr.provider_thread_id, email_message_id: sr.provider_message_id }).eq('id', taskId);
  return { error: null };
}

// ── Shared auto-schedule controls ──
// Single source of truth so EVERY task editor (personal + project tracker) gets
// identical scheduling fields. Self-contained: manages its own state and bubbles
// the persisted payload up via onChange. `dueDate` gates the hard-deadline option.




// ─────────────────────────────────────────
// TASKS VIEW
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// TASKS VIEW — ONE Tasks-inspired design
// Filter pills (Today default) · view switcher (Sequence/Matrix) ·
// priority-anchored drag (A1/A2/A3 badge IS the handle) ·
// persistent bottom drop zones (Today / Tomorrow / Pick Date).
// Powered by SortableJS for proper touch+delay behavior.
// ─────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// TASKS VIEW — ONE Tasks-inspired design with CUSTOM drag system
// ─────────────────────────────────────────────────────────────────────
// Why custom drag instead of SortableJS/ReactSortable: those libraries
// physically mutate the DOM to handle drag-and-drop, which conflicts
// with React's reconciler and produces ghost elements that persist
// across renders. After three attempts to bridge the gap, switched to
// native PointerEvents:
//   - We never mutate React-managed DOM during drag
//   - The "floating clone" that follows the finger is a single <div>
//     parented to document.body, fully under our control
//   - Drop targets register via React context; we hit-test pointer
//     position against their bounding rects
//   - On release, we update React state via the registered callback
// React owns the entire task-list DOM. No libraries fight with it.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// GLOBAL TOAST SYSTEM
// ─────────────────────────────────────────────────────────────────────
// Lightweight, event-bus based. Call notify('message', 'error') from anywhere.
// Renders a stack in the top-right; auto-dismisses after 5s.
// Pass 1 Batch B addition: surface silent errors from optimistic-rollback
// patterns. Batch C will expand uses across writes throughout the app.

// Toast + confirm registry now lives in ./notify (single shared instance).

export function HeaderSearchIcon({ value, open, onToggle }) {
  const hasValue = (value || '').trim().length > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={hasValue ? `Search: "${value}"` : 'Search'}
      aria-label="Search"
      aria-pressed={open}
      className={`btn-view-toggle${open ? ' active' : ''}`}
      style={{position:'relative'}}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/>
        <line x1="16.6" y1="16.6" x2="21" y2="21"/>
      </svg>
      {hasValue && !open && (
        <span style={{
          position:'absolute', top:'5px', right:'5px',
          width:'8px', height:'8px', borderRadius:'50%',
          background:'var(--accent)', border:'2px solid var(--bg-base)',
          pointerEvents:'none', boxSizing:'content-box',
        }} aria-hidden="true"/>
      )}
    </button>
  );
}

export function HeaderSearchInput({ value, onChange, placeholder, onClose, autoFocus = true, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      // setTimeout so the input is mounted before we focus, and so a parent's
      // mouse-down on the icon doesn't immediately re-blur.
      const t = setTimeout(() => ref.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);
  return (
    <div style={{position:'relative', marginBottom:'10px', ...style}}>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); onClose(); } }}
        placeholder={placeholder}
        style={{
          width:'100%', padding:'9px 38px 9px 12px',
          background:'var(--bg-card)', border:'1px solid var(--accent)',
          borderRadius:'8px', color:'var(--text-1)', fontSize:'13px',
          outline:'none', boxSizing:'border-box',
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}  // don't blur input first
        onClick={() => { onChange(''); onClose(); }}
        title="Close search (Esc)"
        aria-label="Close search"
        style={{
          position:'absolute', right:'6px', top:'50%', transform:'translateY(-50%)',
          background:'none', border:'none', color:'var(--text-3)', fontSize:'18px',
          cursor:'pointer', lineHeight:1, padding:'4px 8px',
        }}>×</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TASKS VIEW — main component
// ─────────────────────────────────────────────────────────────────────




// ─────────────────────────────────────────
// EISENHOWER 2x2 QUADRANT GRID
// Read-only ordering (by rank within quadrant). Click task to edit.
// Shows only Eisenhower tasks; simple-system tasks excluded (they have no quadrant).
// ─────────────────────────────────────────
// Pass 4 Batch D: email triage display metadata.
// One source of truth for icons, colors, and labels used by InboxView.


// ─────────────────────────────────────────
// DASHBOARD — Lead-Gen ROI cards
// Self-contained: fetches its own finance data and uses the SAME true-ROI math
// as the Prospecting ROI scoreboard (cash spend + time value vs income), so the
// numbers always agree. Renders one full-width, gamified card per adopted
// (active, non-overhead) lead-gen system. Hidden entirely when none are adopted.
// ─────────────────────────────────────────

export function MultiValueField({ values, onChange, kind, addLabel }) {
  const standard = kind === 'email' ? EMAIL_LABEL_OPTIONS : PHONE_LABEL_OPTIONS;
  const arr = Array.isArray(values) ? values : [];

  function update(i, patch) {
    onChange(arr.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  }
  function remove(i) {
    const next = arr.filter((_, idx) => idx !== i);
    // If we removed the default, make the first remaining entry the default
    if (arr[i]?.is_default && next.length > 0 && !next.some(x => x.is_default)) {
      next[0] = { ...next[0], is_default: true };
    }
    onChange(next);
  }
  function setDefault(i) {
    onChange(arr.map((v, idx) => ({ ...v, is_default: idx === i })));
  }
  function add() {
    const next = [...arr, { value: '', label: standard[0], is_default: arr.length === 0 }];
    onChange(next);
  }
  function handleLabelChange(i, raw) {
    if (raw === '__custom__') {
      const cur = arr[i]?.label && !standard.includes(arr[i].label) ? arr[i].label : '';
      const custom = window.prompt('Custom label?', cur);
      if (custom && custom.trim()) update(i, { label: custom.trim() });
    } else {
      update(i, { label: raw });
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      {arr.map((v, i) => {
        const isCustom = v.label && !standard.includes(v.label);
        return (
          <div key={i} style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
              <select
                value={isCustom ? '__current_custom__' : (v.label || standard[0])}
                onChange={(e) => handleLabelChange(i, e.target.value === '__current_custom__' ? v.label : e.target.value)}
                style={{
                  width:'104px',flexShrink:0,
                  background:'var(--bg-base)',color:'var(--text-1)',
                  border:'1px solid var(--border)',borderRadius:'6px',
                  padding:'7px 4px',fontSize:'12px',
                }}>
                {isCustom && <option value="__current_custom__">{v.label}</option>}
                {standard.map(l => <option key={l} value={l}>{l}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              <span style={{flex:1}} />
              {(v.value || '').trim() && (() => {
                const actBtn = { display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0, width:'38px', height:'34px', cursor:'pointer', background:'rgba(197,169,94,0.10)', border:'1px solid var(--border)', borderRadius:'6px', color:'var(--accent)', fontSize:'14px', lineHeight:1, textDecoration:'none' };
                if (kind === 'email') {
                  return <a href="#" onClick={(ev)=>{ev.preventDefault(); if(window.__composeEmail) window.__composeEmail(v.value.trim());}} title="Send email" style={actBtn}><Icon name="mail" size={14} /></a>;
                }
                const tel = (v.value || '').replace(/[^\d+]/g, '');
                return (
                  <>
                    <a href={`tel:${tel}`} title="Call" style={actBtn}><Icon name="quo" size={14} /></a>
                    <a href={`sms:${tel}`} title="Text" style={actBtn}><Icon name="message" size={14} /></a>
                  </>
                );
              })()}
              <button type="button" onClick={() => setDefault(i)}
                title={v.is_default ? 'Default — used for quick actions' : 'Make this the default'}
                aria-pressed={v.is_default}
                style={{
                  flexShrink:0,width:'38px',height:'34px',cursor:'pointer',
                  background:'var(--bg-base)',
                  border:`1px solid ${v.is_default ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius:'6px', color: v.is_default ? 'var(--accent)' : 'var(--text-3)',
                  fontSize:'14px',lineHeight:1,
                }}>{v.is_default ? '★' : '☆'}</button>
              <button type="button" onClick={() => remove(i)}
                title="Remove" aria-label="Remove"
                style={{
                  flexShrink:0,width:'34px',height:'34px',cursor:'pointer',
                  background:'var(--bg-base)',
                  border:'1px solid var(--border)',borderRadius:'6px',
                  color:'var(--text-3)',fontSize:'15px',lineHeight:1,
                }}>×</button>
            </div>
            <input
              type={kind === 'email' ? 'email' : 'tel'}
              value={v.value || ''}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={kind === 'email' ? 'name@example.com' : '(555) 555-5555'}
              style={{
                width:'100%',boxSizing:'border-box',
                background:'var(--bg-base)',color:'var(--text-1)',
                border:'1px solid var(--border)',borderRadius:'6px',
                padding:'9px 11px',fontSize:'13px',outline:'none',
              }}/>
          </div>
        );
      })}
      <button type="button" onClick={add}
        style={{
          alignSelf:'flex-start',padding:'5px 11px',
          background:'transparent',border:'1px dashed var(--border)',
          borderRadius:'6px',color:'var(--text-3)',cursor:'pointer',
          fontSize:'11.5px',fontWeight:600,
        }}>{addLabel}</button>
    </div>
  );
}

// ── Teachable moments ──────────────────────────────────────────────
// In-context lessons that teach the "why". Persist per-device; the off-switch
// only unlocks once the agent has learned enough (proficiency gate) — so tips
// aren't offered too early, but once earned they toggle freely.

export const EMAIL_LABEL_OPTIONS = ['Personal', 'Work', 'School', 'Other'];
export const PHONE_LABEL_OPTIONS = ['Mobile', 'Work', 'Home', 'Main', 'Fax', 'Pager', 'Other'];

export function RecruitingKpiTile({ label, value, sub, color }) {
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 12px'}}>
      <div style={{fontSize:'9.5px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'3px'}}>{label}</div>
      <div style={{fontSize:'20px',fontWeight:300,fontFamily:'Fraunces, serif',letterSpacing:'-0.01em',color:color || 'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{value}</div>
      {sub && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>}
    </div>
  );
}

export function useDictation(onFinal) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef(null);
  const wantRef = useRef(false);      // does the user still want to be listening?
  const timerRef = useRef(null);      // pending auto-restart
  const startedAtRef = useRef(0);
  const failsRef = useRef(0);         // consecutive fast failures (runaway guard)
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; });
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const teardown = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const r = recRef.current; recRef.current = null;
    if (r) { try { r.onresult = r.onerror = r.onend = null; } catch (_) {} try { r.abort(); } catch (_) {} }
  }, []);

  const launch = useCallback(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    teardown(); // never leave a previous recognizer holding the mic
    let rec; try { rec = new SR(); } catch (_) { return; }
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev) => {
      let f = '', it = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) f += r[0].transcript; else it += r[0].transcript; }
      if (f) { failsRef.current = 0; if (onFinalRef.current) onFinalRef.current(f); }
      setInterim(it);
    };
    rec.onerror = (e) => {
      const err = e && e.error;
      // Fatal — stop for good. (no-speech / aborted / network are transient; let onend auto-restart.)
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        wantRef.current = false; setRecording(false); setInterim('');
      }
    };
    rec.onend = () => {
      setInterim('');
      if (!wantRef.current) { setRecording(false); return; }
      // Mobile speech engines quietly end after a pause even with continuous=true.
      // Restart so dictation keeps going — but bail out if it's failing rapidly.
      const quick = (Date.now() - startedAtRef.current) < 600;
      failsRef.current = quick ? failsRef.current + 1 : 0;
      if (failsRef.current >= 5) { wantRef.current = false; setRecording(false); return; }
      timerRef.current = setTimeout(() => { if (wantRef.current) launch(); }, 300);
    };
    recRef.current = rec;
    startedAtRef.current = Date.now();
    try { rec.start(); setRecording(true); } catch (_) { /* already starting / busy */ }
  }, [teardown]);

  const start = useCallback(() => { wantRef.current = true; failsRef.current = 0; launch(); }, [launch]);
  const stop = useCallback(() => { wantRef.current = false; teardown(); setRecording(false); setInterim(''); }, [teardown]);
  useEffect(() => () => { wantRef.current = false; teardown(); }, [teardown]);
  return { recording, interim, start, stop, supported };
}

// Textarea that grows with its content (no inner scroll until maxHeight).
