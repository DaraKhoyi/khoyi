import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { Tip, useBackClose, Icon, TaskModal, confirmDialog, emailAssignTask, modal, notify, pad2, ymd } from '../App';

function startOfMonthGrid(year, month) {
  // month: 0-indexed. Returns the Sunday on/before the 1st.
  const first = new Date(year, month, 1);
  const d = new Date(first);
  d.setDate(1 - first.getDay());
  return d;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// Ordinal suffix for a day-of-month number: 1->st, 2->nd, 3->rd, 14->th, 21->st...

function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Searchable contact combo-box — type to filter instead of scrolling a long select.

function ContactSearchSelect({ contacts = [], value, onChange, placeholder = 'Search contacts…' }) {
  const nameOf = (c) => (c && (c.name || c.full_name || c.email)) || 'Contact';
  const selected = contacts.find(c => c.id === value);
  const [query, setQuery] = useState(selected ? nameOf(selected) : '');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => { const s = contacts.find(c => c.id === value); setQuery(s ? nameOf(s) : ''); /* eslint-disable-next-line */ }, [value]);
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const q = query.trim().toLowerCase();
  const showAll = !q || (selected && q === nameOf(selected).toLowerCase());
  const matches = (showAll ? contacts : contacts.filter(c => `${c.name || ''} ${c.full_name || ''} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(q))).slice(0, 60);
  const inputStyle = { width: '100%', padding: '11px 12px', paddingRight: value ? '34px' : '12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-1)', fontSize: '14px', boxSizing: 'border-box' };
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }} style={inputStyle} />
        {value ? (
          <button type="button" onClick={() => { onChange(''); setQuery(''); setOpen(false); }} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        ) : (
          <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none', fontSize: '13px' }}><Icon name="search" size={14} /></span>
        )}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 10px 28px rgba(0,0,0,0.5)' }}>
          <button type="button" onClick={() => { onChange(''); setQuery(''); setOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', fontSize: '13px' }}>— None —</button>
          {matches.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>No matches for “{query}”</div>
          ) : matches.map(c => (
            <button type="button" key={c.id} onClick={() => { onChange(c.id); setQuery(nameOf(c)); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 12px', background: c.id === value ? 'var(--bg-hover)' : 'none', border: 'none', color: 'var(--text-1)', cursor: 'pointer', fontSize: '14px' }}>
              {nameOf(c)}{c.company ? <span style={{ color: 'var(--text-3)' }}> · {c.company}</span> : ''}
            </button>
          ))}
          {!showAll && matches.length === 60 && <div style={{ padding: '8px 12px', fontSize: '10px', color: 'var(--text-3)' }}>Showing first 60 — keep typing to narrow.</div>}
        </div>
      )}
    </div>
  );
}


function TimePicker({ value, onChange }) {
  // value is "HH:MM" (24-hour). Renders 12-hour hour/minute selects + a gold AM/PM toggle.
  const parse = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
    let H = m ? parseInt(m[1], 10) : 9;
    let M = m ? parseInt(m[2], 10) : 0;
    const ap = H >= 12 ? 'PM' : 'AM';
    let h12 = H % 12; if (h12 === 0) h12 = 12;
    return { h12, M, ap };
  };
  const { h12, M, ap } = parse(value);
  const emit = (nh, nm, nap) => {
    let H = nh % 12; if (nap === 'PM') H += 12;
    onChange(`${pad2(H)}:${pad2(nm)}`);
  };
  const sel = { padding: '8px 6px', width: 'auto', textAlign: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
      <select className="form-input" style={sel} value={h12} onChange={e => emit(parseInt(e.target.value, 10), M, ap)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{ fontWeight: 800, color: 'var(--text-2)' }}>:</span>
      <select className="form-input" style={sel} value={M} onChange={e => emit(h12, parseInt(e.target.value, 10), ap)}>
        {(() => { const base = Array.from({ length: 12 }, (_, i) => i * 5); const opts = base.includes(M) ? base : [...base, M].sort((a, b) => a - b); return opts.map(mm => <option key={mm} value={mm}>{pad2(mm)}</option>); })()}
      </select>
      <div style={{ display: 'inline-flex', gap: '4px', marginLeft: '2px' }}>
        {['AM', 'PM'].map(x => (
          <button key={x} type="button" onClick={() => emit(h12, M, x)}
            style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${ap === x ? 'var(--accent)' : 'var(--border)'}`,
              background: ap === x ? 'var(--accent)' : 'transparent',
              color: ap === x ? 'var(--bg-base)' : 'var(--text-2)', transition: 'all 0.15s' }}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventModal({ onClose, onSave, onDelete, initial, defaultDate, brain, contacts, properties = [] }) {


  useBackClose(onClose);
  const init = initial || {};
  const startInit = init.start_at ? new Date(init.start_at) : (defaultDate ? new Date(defaultDate + 'T09:00:00') : new Date());
  const endInit = init.end_at ? new Date(init.end_at) : new Date(startInit.getTime() + 60*60*1000);
  const [title, setTitle] = useState(init.title || '');
  const [allDay, setAllDay] = useState(init.all_day || false);
  const [startDate, setStartDate] = useState(ymd(startInit));
  const [startTime, setStartTime] = useState(`${pad2(startInit.getHours())}:${pad2(startInit.getMinutes())}`);
  const [endDate, setEndDate] = useState(ymd(endInit));
  const [endTime, setEndTime] = useState(`${pad2(endInit.getHours())}:${pad2(endInit.getMinutes())}`);
  const [location, setLocation] = useState(init.location || '');
  const [description, setDescription] = useState(init.description || '');
  const [contactId, setContactId] = useState(init.contact_id || '');
  const [isAppt, setIsAppt] = useState(init.is_appointment);
  const [brainEntryId, setBrainEntryId] = useState(init.brain_entry_id || '');
  const [propertyId, setPropertyId] = useState(init.property_id || '');
  // Recurrence
  const [recurFreq, setRecurFreq] = useState(init.recur_freq || 'none');
  const [recurInterval, setRecurInterval] = useState(init.recur_interval || 1);
  const [recurUntil, setRecurUntil] = useState(init.recur_until || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const start_at = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
    const end_at = allDay ? `${endDate}T00:00:00` : `${endDate}T${endTime}:00`;
    const repeats = recurFreq !== 'none';
    onSave({
      title: title.trim(),
      all_day: allDay,
      start_at: new Date(start_at).toISOString(),
      end_at: new Date(end_at).toISOString(),
      location: location.trim() || null,
      description: description.trim() || null,
      contact_id: contactId || null,
      // NULL = never asked (counted if it otherwise looks like one), true/false =
      // the user's decision. Only meaningful once a contact is attached.
      is_appointment: contactId ? (isAppt === undefined ? null : isAppt) : null,
      brain_entry_id: brainEntryId || null,
      property_id: propertyId || null,
      recur_freq: repeats ? recurFreq : null,
      recur_interval: repeats ? Math.max(1, Number(recurInterval) || 1) : 1,
      recur_until: repeats && recurUntil ? recurUntil : null,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Event' : 'New Event'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What's happening?" autoFocus required /></div>
          <div className="form-group">
            <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All-day
            </label>
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}><label className="form-label">Start date</label><input className="form-input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} required /></div>
            {!allDay && <div className="form-group" style={{flex:1}}><label className="form-label">Start time</label><TimePicker value={startTime} onChange={setStartTime} /></div>}
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}><label className="form-label">End date</label><input className="form-input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} /></div>
            {!allDay && <div className="form-group" style={{flex:1}}><label className="form-label">End time</label><TimePicker value={endTime} onChange={setEndTime} /></div>}
          </div>
          <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={location} onChange={e=>setLocation(e.target.value)} placeholder="Optional" /></div>

          {/* Recurrence */}
          <div className="form-group">
            <label className="form-label">Repeat</label>
            <select className="form-select" value={recurFreq} onChange={e=>setRecurFreq(e.target.value)}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          {recurFreq !== 'none' && (
            <div className="form-row">
              <div className="form-group" style={{flex:1}}>
                <label className="form-label">Every</label>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <input className="form-input" type="number" min="1" max="99" value={recurInterval}
                    onChange={e=>setRecurInterval(e.target.value)} style={{width:'70px'}} />
                  <span style={{color:'var(--text-2)',fontSize:'13px'}}>
                    {recurFreq === 'daily' ? (recurInterval==1?'day':'days')
                      : recurFreq === 'weekly' ? (recurInterval==1?'week':'weeks')
                      : recurFreq === 'monthly' ? (recurInterval==1?'month':'months')
                      : (recurInterval==1?'year':'years')}
                  </span>
                </div>
              </div>
              <div className="form-group" style={{flex:1}}>
                <label className="form-label">Until (optional)</label>
                <input className="form-input" type="date" value={recurUntil} onChange={e=>setRecurUntil(e.target.value)} />
              </div>
            </div>
          )}
          {recurFreq !== 'none' && initial && (
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'-6px',marginBottom:'10px',fontStyle:'italic'}}>
              Edits and deletes apply to the whole series.
            </div>
          )}
          {contacts && contacts.length > 0 && (
            <div className="form-group">
              <label className="form-label">Linked contact</label>
              <ContactSearchSelect contacts={contacts} value={contactId} onChange={setContactId} />
              {/* Your calendar deliberately mixes personal and business, so a
                  linked person does not mean a client appointment — "Anvar" and
                  "Dinner party at Ali's" are both linked and neither counts.
                  This is the override that keeps goal tracking honest. */}
              {contactId && (
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8 }}>
                  <span style={{ fontSize:11, color:'var(--text-3)', flex:'1 1 150px', minWidth:0 }}>
                    Count this toward your goal as a client appointment?
                  </span>
                  {[['Yes', true], ['No', false]].map(([lbl, val]) => (
                    <button key={lbl} type="button" onClick={() => setIsAppt(isAppt === val ? undefined : val)}
                      style={{ padding:'4px 12px', borderRadius:100, fontSize:11.5, fontWeight:700, cursor:'pointer', flex:'none',
                        border:'1px solid ' + (isAppt === val ? 'var(--accent)' : 'var(--border-strong)'),
                        background: isAppt === val ? 'rgba(197,169,94,.16)' : 'transparent',
                        color: isAppt === val ? 'var(--accent)' : 'var(--text-2)' }}>{lbl}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {brain && brain.length > 0 && (
            <div className="form-group">
              <label className="form-label">Brain context</label>
              <select className="form-select" value={brainEntryId} onChange={e=>setBrainEntryId(e.target.value)}>
                <option value="">— None —</option>
                {['playbook','decision','memory'].map(type => {
                  const entries = brain.filter(b => b.type === type);
                  if (!entries.length) return null;
                  return <optgroup key={type} label={type.toUpperCase()}>
                    {entries.map(b => <option key={b.id} value={b.id}>{b.title.slice(0,60)}</option>)}
                  </optgroup>;
                })}
              </select>
            </div>
          )}
          {properties && properties.length > 0 && (
            <div className="form-group">
              <label className="form-label">Property</label>
              <select className="form-select" value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional details…" /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Event</button>
          </div>
        </form>
      </div>
    </div>
  );
}


function CalendarView({ events, setEvents, userId, brain, contacts, emailAccounts, properties = [], tasks = [], setTasks, focusEventId, setFocusEventId }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [modalDate, setModalDate] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState(null);
  // View mode — sticky in localStorage. 'month' | 'week' | 'day' | 'year'
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('calendar_view_mode');
      return ['month','week','day','year'].includes(saved) ? saved : 'month';
    } catch(_) { return 'month'; }
  });
  function changeViewMode(m) {
    if (m === viewMode) return;
    setViewMode(m);
    try { localStorage.setItem('calendar_view_mode', m); } catch(_) {}
    // Switching to Day or Week always snaps to today (per UX spec)
    if (m==='day' || m==='week') {
      setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    }
  }

  // ─── Navigation helpers — adapt prev/next to viewMode ───
  const VIEW_HOUR_START = 6;   // 6 AM
  const VIEW_HOUR_END   = 23;  // 11 PM (exclusive)
  function shiftCursor(delta) {
    const d = new Date(cursor);
    if (viewMode === 'month') d.setMonth(d.getMonth() + delta);
    else if (viewMode === 'week') d.setDate(d.getDate() + 7*delta);
    else if (viewMode === 'day') d.setDate(d.getDate() + delta);
    else if (viewMode === 'year') d.setMonth(d.getMonth() + 6*delta); // ±6 months
    setCursor(d);
  }

  // ─── Touch swipe — change day/week by ±1 with a horizontal swipe ───
  // Active only on day/week views so we don't fight month-grid taps. Rejects
  // vertical drift so the inner time timelines can still scroll normally.
  const touchRef = useRef(null);
  const [swipeAnim, setSwipeAnim] = useState(null);  // 'left' | 'right' | null
  function onSwipeTouchStart(e) {
    if (viewMode !== 'day' && viewMode !== 'week') return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onSwipeTouchEnd(e) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    if (viewMode !== 'day' && viewMode !== 'week') return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    // Thresholds: must travel ≥50px horizontally, dominated by horizontal (|dx|>2·|dy|),
    // and complete within ~700ms so a slow drag while reading doesn't trigger nav.
    if (Math.abs(dx) < 50 || Math.abs(dx) < 2 * Math.abs(dy) || dt > 700) return;
    const delta = dx < 0 ? 1 : -1;   // swipe left → next, swipe right → prev
    setSwipeAnim(delta > 0 ? 'left' : 'right');
    shiftCursor(delta);
    // Clear the slide animation class after it plays
    setTimeout(() => setSwipeAnim(null), 220);
  }
  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  }
  function startOfWeek(d) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() - r.getDay()); // Sunday
    return r;
  }
  function addDaysLocal(d, n) {
    const r = new Date(d); r.setDate(r.getDate()+n); return r;
  }
  // ─── Recurrence expansion ───────────────────────────────
  // Events with recur_freq are stored once (the master). For display we expand
  // them into virtual occurrences within a window around the cursor. Virtual
  // instances carry _masterId so edits/clicks resolve back to the real row.
  function advanceDate(d, freq, interval) {
    const n = new Date(d);
    if (freq === 'daily') n.setDate(n.getDate() + interval);
    else if (freq === 'weekly') n.setDate(n.getDate() + 7 * interval);
    else if (freq === 'monthly') n.setMonth(n.getMonth() + interval);
    else if (freq === 'yearly') n.setFullYear(n.getFullYear() + interval);
    return n;
  }
  const displayEvents = React.useMemo(() => {
    // Window: 13 months back to 14 months forward of the cursor — covers
    // month/week/day and the ±6-month year view comfortably.
    const winStart = new Date(cursor.getFullYear(), cursor.getMonth() - 13, 1);
    const winEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 14, 0, 23, 59, 59);
    const out = [];
    for (const ev of (events || [])) {
      if (!ev.recur_freq) { out.push(ev); continue; }
      const start = new Date(ev.start_at);
      const dur = (ev.end_at ? new Date(ev.end_at) : new Date(start.getTime() + 3600000)) - start;
      const interval = Math.max(1, ev.recur_interval || 1);
      const until = ev.recur_until ? new Date(ev.recur_until + 'T23:59:59') : null;
      const maxCount = ev.recur_count || 100000;
      let occ = new Date(start), i = 0, guard = 0;
      while (i < maxCount && guard < 6000) {
        guard++;
        if (occ > winEnd) break;
        if (until && occ > until) break;
        if (occ >= winStart) {
          const oStart = new Date(occ);
          out.push({
            ...ev,
            id: i === 0 ? ev.id : `${ev.id}__r${i}`,
            start_at: oStart.toISOString(),
            end_at: new Date(oStart.getTime() + dur).toISOString(),
            _masterId: ev.id,
            _recurInstance: i > 0,
          });
        }
        occ = advanceDate(occ, ev.recur_freq, interval);
        i++;
      }
    }
    return out;
  }, [events, cursor]);

  // Resolve a (possibly virtual) event to its real master row before editing.
  useEffect(() => { if (focusEventId && events && events.length) { const ev = events.find(x => x.id === focusEventId); if (ev) { openEditEvent(ev); setFocusEventId && setFocusEventId(null); } } }, [focusEventId, events]); // eslint-disable-line
  function openEditEvent(ev) {
    const realId = ev._masterId || ev.id;
    const master = (events || []).find(e => e.id === realId) || ev;
    if (master.event_kind === 'icloud_personal') {
      notify('Personal time from iCloud: “' + (master.title || 'Busy') + '”. Edit it in your iPhone Calendar — PrismOS keeps it here so it won\u2019t book over your personal time.');
      return;
    }
    setEditEvent(master);
    setModalDate(null);
    setShowModal(true);
  }

  function eventsForDay(d) {
    const key = ymd(d);
    return displayEvents.filter(ev => {
      const s = new Date(ev.start_at);
      return ymd(s) === key;
    }).sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
  }

  const googleAccounts = (emailAccounts || []).filter(a => a.provider === 'google' && a.is_active);
  // The calendar account: one tagged with 'calendar' purpose, or any with calendar scope
  const calendarAccount = googleAccounts.find(a => (a.purposes || []).includes('calendar'))
    || googleAccounts.find(a => (a.scopes || []).some(s => s.includes('calendar')));
  const hasCalendarScope = !!calendarAccount;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const gridStart = startOfMonthGrid(year, month);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  async function handleSave(data) {
    const payload = { ...data, user_id: userId, sync_status: hasCalendarScope ? 'pending_push' : 'local' };
    if (editEvent) {
      const { data: u, error } = await supabase.from('events').update({ ...data, sync_status: editEvent.google_event_id ? 'pending_push' : (hasCalendarScope ? 'pending_push' : 'local') }).eq('id', editEvent.id).select().single();
      if (error) { notify("Couldn't save event. Try again.", 'error'); return; }
      if (u) setEvents(prev => prev.map(e => e.id === u.id ? u : e));
    } else {
      const { data: c, error } = await supabase.from('events').insert(payload).select().single();
      if (error) { notify("Couldn't create event. Try again.", 'error'); return; }
      if (c) setEvents(prev => [...prev, c]);
    }
    setShowModal(false); setEditEvent(null);
    // Auto-push to Google if connected
    if (hasCalendarScope) syncCalendar('push', true);
  }

  async function handleDelete(ev) {
    if (!await confirmDialog('Delete this event?')) return;
    // If synced to Google, delete there too (fire-and-forget; we'll surface DB errors below)
    if (ev.google_event_id && hasCalendarScope) {
      try {
        await supabase.functions.invoke('calendar-delete', { body: { event_id: ev.id } }).catch(()=>{});
      } catch(_) {}
    }
    // Snapshot for rollback
    const snapshot = ev;
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) {
      setEvents(prev => [snapshot, ...prev.filter(e => e.id !== ev.id)]);
      notify("Couldn't delete event. Reverted.", 'error');
      return;
    }
    setShowModal(false); setEditEvent(null);
  }

  async function syncCalendar(direction = 'both', silent = false) {
    if (!hasCalendarScope) {
      setFlash({ type:'error', text:'Connect Google Calendar first (Settings or the button above).' });
      setTimeout(()=>setFlash(null), 4000);
      return;
    }
    if (!silent) setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, direction }
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      // Reload events
      const { data: fresh } = await supabase.from('events').select('*').order('start_at', { ascending: true });
      if (fresh) setEvents(fresh);
      if (!silent) {
        setFlash({ type:'ok', text:`Synced · ${data.pulled} in, ${data.pushed} out${data.deleted?`, ${data.deleted} removed`:''}` });
        setTimeout(()=>setFlash(null), 4000);
      }
    } catch (e) {
      if (!silent) {
        setFlash({ type:'error', text:`Sync failed: ${e.message}` });
        setTimeout(()=>setFlash(null), 5000);
      }
    } finally {
      if (!silent) setSyncing(false);
    }
  }

  async function connectGoogle() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setFlash({type:'error',text:'Not signed in.'}); return; }
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose: 'calendar' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      if (!data?.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setFlash({ type:'error', text: e.message });
      setTimeout(()=>setFlash(null), 5000);
    }
  }

  const monthEvents = events.filter(ev => {
    const s = new Date(ev.start_at);
    return s.getFullYear() === year && s.getMonth() === month;
  });

  const [scheduling, setScheduling] = useState(false);
  const [showFlex, setShowFlex] = useState(false);
  async function refreshSchedule() {
    setScheduling(true);
    try {
      const { error } = await supabase.functions.invoke('task-autoschedule', { body: {} });
      if (error) throw error;
      // refetch events so new task blocks appear
      const { data: fresh } = await supabase.from('events').select('*').order('start_at', { ascending: true });
      if (fresh) setEvents(fresh);
      setFlash({ type:'success', text:'Schedule refreshed.' });
    } catch (e) {
      setFlash({ type:'error', text:`Schedule failed: ${e.message}` });
    } finally {
      setScheduling(false);
      setTimeout(()=>setFlash(null), 3500);
    }
  }

  const taskBlockCount = events.filter(e => e.event_kind === 'task_block').length;

  // Drag a task block to a new time → move the event, pin the task there, reflow the rest.
  async function moveTaskBlock(ev, newStart) {
    if (!ev.task_id) return;
    const durMs = (ev.end_at ? new Date(ev.end_at) : new Date(new Date(ev.start_at).getTime()+3600000)) - new Date(ev.start_at);
    const newStartISO = newStart.toISOString();
    const newEndISO = new Date(newStart.getTime() + durMs).toISOString();
    // optimistic UI
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, start_at:newStartISO, end_at:newEndISO } : e));
    if (setTasks) setTasks(prev => prev.map(t => t.id === ev.task_id ? { ...t, pin_at:newStartISO } : t));
    try {
      await supabase.from('events').update({ start_at:newStartISO, end_at:newEndISO }).eq('id', ev.id);
      await supabase.from('tasks').update({ pin_at:newStartISO }).eq('id', ev.task_id);
      setFlash({ type:'success', text:'Pinned to new time — reflowing the rest…' });
      await refreshSchedule();
    } catch (e) {
      setFlash({ type:'error', text:`Move failed: ${e.message}` });
      setTimeout(()=>setFlash(null), 3500);
    }
  }

  // Long-press a task block → toggle pinned (locked at its current time).
  async function toggleBlockPin(ev) {
    if (!ev.task_id) return;
    const t = (tasks || []).find(x => x.id === ev.task_id);
    const newPin = t?.pin_at ? null : ev.start_at;
    if (setTasks) setTasks(prev => prev.map(x => x.id === ev.task_id ? { ...x, pin_at:newPin } : x));
    try {
      await supabase.from('tasks').update({ pin_at:newPin }).eq('id', ev.task_id);
      setFlash({ type:'success', text: newPin ? '📌 Pinned in place.' : 'Unpinned — free to reschedule.' });
      setTimeout(()=>setFlash(null), 2500);
    } catch (e) {
      setFlash({ type:'error', text:`Pin failed: ${e.message}` });
      setTimeout(()=>setFlash(null), 3500);
    }
  }

  // Tap a task block → open the underlying task in the editor
  const [editingTask, setEditingTask] = useState(null);
  function openTaskFromBlock(ev) {
    if (!ev.task_id) return;
    const t = (tasks || []).find(x => x.id === ev.task_id);
    if (t) setEditingTask(t);
    else { setFlash({ type:'error', text:'Task not found.' }); setTimeout(()=>setFlash(null), 2500); }
  }
  async function handleTaskSave(data) {
    const { _contact_ids, _email, ...taskData } = data;
    if (!editingTask) return;
    try {
      const { data: updated, error } = await supabase.from('tasks').update(taskData).eq('id', editingTask.id).select().single();
      if (error) {
        setFlash({ type:'error', text:`Couldn't save: ${error.message || error.code || 'unknown error'}` });
        setTimeout(()=>setFlash(null), 5000);
        return; // keep modal open so the edit isn't lost
      }
      if (updated && setTasks) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
      // Contact links — surface failures instead of swallowing them.
      if (Array.isArray(_contact_ids)) {
        const { error: cErr } = await supabase.rpc('set_task_contacts', { p_task_id: editingTask.id, p_contact_ids: _contact_ids });
        if (cErr) {
          setFlash({ type:'error', text:`Task saved, but contacts didn't link: ${cErr.message || cErr.code}` });
          setTimeout(()=>setFlash(null), 5000);
        }
      }
      if (_email) { await emailAssignTask(editingTask.id, _email).catch(()=>{}); }
      setEditingTask(null); // success → close
      setFlash(prev => prev && prev.type === 'error' ? prev : { type:'success', text:'✓ Saved' });
      setTimeout(()=>setFlash(null), 2500);
      try { await refreshSchedule(); } catch { /* non-fatal: row already saved */ }
    } catch (e) {
      setFlash({ type:'error', text:`Save failed: ${e.message || String(e)}` });
      setTimeout(()=>setFlash(null), 5000);
    }
  }
  async function handleTaskDelete(t) {
    if (!await confirmDialog(`Delete "${t.title}"?`)) return;
    await supabase.from('events').delete().eq('task_id', t.id).eq('event_kind', 'task_block');
    await supabase.from('tasks').delete().eq('id', t.id);
    if (setTasks) setTasks(prev => prev.filter(x => x.id !== t.id));
    setEditingTask(null);
    const { data: fresh } = await supabase.from('events').select('*').order('start_at', { ascending: true });
    if (fresh) setEvents(fresh);
  }

  return (
    <div className="ww-cal">
      <style>{`
        .ww-cal{
          --bg-base:#100D09; --bg-card:#1B1610; --bg-hover:#221B10;
          --border:rgba(203,163,92,.20); --border-strong:rgba(203,163,92,.40);
          --accent:#CBA35C; --accent-2:#EBCB82; --accent-dim:rgba(203,163,92,.45); --accent-glow:rgba(203,163,92,.14); --event-bg:rgba(203,163,92,.34); --text-on-accent:#E4DCCB;
          --text-1:#F6F1E7; --text-2:#C8BFAE; --text-3:#8C8475;
          font-family:Manrope,sans-serif;
          background:radial-gradient(120% 34% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;
          min-height:100%;
        }
        .ww-cal .ww-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.24em; text-transform:uppercase; color:#CBA35C; }
        .ww-cal .page-header h2{ font-family:'Fraunces',serif; font-weight:300; letter-spacing:-.02em; font-size:30px; }
        .ww-cal .page-header p{ font-size:13px; color:#8C8475; }
        .ww-cal .panel{ background:linear-gradient(180deg,#18130D,#100D09); border:1px solid rgba(203,163,92,.20); border-radius:16px; }
        .ww-cal .panel-header h3{ font-family:'Fraunces',serif; font-weight:400; letter-spacing:-.01em; color:#F6F1E7; }
        .ww-cal .btn-ghost{ border:1px solid rgba(203,163,92,.30); color:#C8BFAE; }
        .ww-cal .btn-ghost:hover{ border-color:#CBA35C; color:#EBCB82; }
        .ww-cal .btn-primary{ background:#EBCB82; color:#1a1409; border:none; }
        .ww-cal .btn-add-circle{ background:#EBCB82; color:#1a1409; }
        .ww-cal .cal-view-toggle{ border:1px solid rgba(203,163,92,.22); }
        .ww-cal .cal-view-toggle button{ color:#C8BFAE; }
        .ww-cal .cal-view-toggle button.active{ background:rgba(203,163,92,.16); color:#EBCB82; }
        .ww-cal .cal-icon-btn{ border-color:rgba(203,163,92,.30) !important; color:#CBA35C !important; }
        .ww-cal .task-item{ border-color:rgba(203,163,92,.14); }
        .ww-cal .task-text{ color:#F6F1E7; }
        .ww-cal .task-due{ color:#8C8475; }
        .ww-cal .empty-state{ color:#8C8475; }
        .ww-cal .empty-icon{ color:#CBA35C; }
      `}</style>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'10px'}}>
        <div style={{flex:1,minWidth:0}}>
          <h2 style={{display:'flex',alignItems:'center',gap:'10px',margin:'6px 0 4px'}}><Icon name="calendar" size={24} style={{color:'var(--accent)',flexShrink:0}} />Calendar</h2>
          <p>{monthEvents.length} events in {MONTH_NAMES[month]} · {events.length} total{taskBlockCount>0?` · ${taskBlockCount} scheduled task block${taskBlockCount===1?'':'s'}`:''}</p>
        </div>
        <div style={{display:'flex',gap:'6px',alignItems:'center',flexShrink:0}}>
          {viewMode==='day' && (
            <button className="btn btn-ghost btn-sm cal-icon-btn" onClick={()=>setShowFlex(true)}
              title="Flexible hours for this day — block time, start late, day off" aria-label="Flexible hours"
              style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
              <Icon name="clock" size={16} />
            </button>
          )}
          <button className="btn btn-ghost btn-sm cal-icon-btn" onClick={refreshSchedule} disabled={scheduling}
            title="Auto-schedule tasks onto the calendar" aria-label="Refresh schedule"
            style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
            <span className={scheduling?'spinning':''} style={{display:'inline-flex'}}><Icon name="calendar" size={16} /></span>
          </button>
          {hasCalendarScope ? (
            <button className="btn btn-ghost btn-sm cal-icon-btn" onClick={()=>syncCalendar('both')} disabled={syncing}
              title={`Refresh — ${calendarAccount.email_address}`} aria-label="Refresh calendar">
              <span className={syncing?'spinning':''} style={{fontSize:'16px',display:'inline-block'}}>↻</span>
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm cal-icon-btn" onClick={connectGoogle}
              style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}
              title="Connect Google Calendar to enable refresh" aria-label="Connect calendar">
              <Icon name="link" size={16} />
            </button>
          )}
          <button className="btn-add-circle btn-add-circle-sm" onClick={()=>{setEditEvent(null);setModalDate(ymd(today));setShowModal(true);}} title="New Event" aria-label="New Event">+</button>
        </div>
      </div>

      <Tip id="blocking" label="Protect the money hours">Block time for prospecting <b>before</b> the day fills with everyone else's priorities. Top producers defend the one activity that grows income — put it on the calendar and it actually happens.</Tip>
      {/* View toggle — right under the title */}
      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
        <div className="cal-view-toggle">
          {[
            {id:'day',label:'Day'},
            {id:'week',label:'Week'},
            {id:'month',label:'Month'},
            {id:'year',label:'Year'},
          ].map(v => (
            <button key={v.id} className={viewMode===v.id?'active':''} onClick={()=>changeViewMode(v.id)}>{v.label}</button>
          ))}
        </div>
      </div>

      {flash && (
        <div style={{padding:'10px 14px',marginBottom:'14px',borderRadius:'8px',
          background: flash.type==='ok'?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)',
          border:`1px solid ${flash.type==='ok'?'#22c55e':'#ef4444'}`,
          color: flash.type==='ok'?'#22c55e':'#ef4444', fontSize:'13px'}}>{flash.text}</div>
      )}

      {!hasCalendarScope && (
        <div style={{padding:'12px 14px',marginBottom:'14px',borderRadius:'8px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',color:'var(--text-2)',fontSize:'12px',lineHeight:1.6}}>
          <strong style={{color:'var(--accent)'}}>Connect your calendar account.</strong> Click <strong>Connect Calendar Account</strong> above and sign in with the Google account you want to use for your calendar. This can be the same account you use for email, or a separate one. Once connected, your Google Calendar syncs both ways automatically.
          {googleAccounts.length > 0 && (
            <div style={{marginTop:'6px',color:'var(--text-3)'}}>
              Currently connected Google {googleAccounts.length === 1 ? 'account' : 'accounts'}: {googleAccounts.map(a => `${a.email_address} (${(a.purposes||['email']).join('+')})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Navigation header — adapts to viewMode */}
      <div className="panel">
        <div className="panel-header" style={{justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>shiftCursor(-1)}>‹</button>
            <h3 style={{minWidth:'200px',textAlign:'center',fontSize:'15px'}}>
              {viewMode==='month' && `${MONTH_NAMES[month]} ${year}`}
              {viewMode==='week' && (() => {
                const ws = startOfWeek(cursor); const we = addDaysLocal(ws, 6);
                const sameMonth = ws.getMonth()===we.getMonth();
                return sameMonth
                  ? `${MONTH_NAMES[ws.getMonth()].slice(0,3)} ${ws.getDate()} – ${we.getDate()}, ${we.getFullYear()}`
                  : `${MONTH_NAMES[ws.getMonth()].slice(0,3)} ${ws.getDate()} – ${MONTH_NAMES[we.getMonth()].slice(0,3)} ${we.getDate()}, ${we.getFullYear()}`;
              })()}
              {viewMode==='day' && `${DOW[cursor.getDay()]}, ${MONTH_NAMES[cursor.getMonth()]} ${cursor.getDate()}, ${cursor.getFullYear()}`}
              {viewMode==='year' && (() => {
                const endM = new Date(year, month+5, 1);
                return `${MONTH_NAMES[month].slice(0,3)} ${year} – ${MONTH_NAMES[endM.getMonth()].slice(0,3)} ${endM.getFullYear()}`;
              })()}
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={()=>shiftCursor(1)}>›</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={goToday}>Today</button>
        </div>
        <div
          className={`panel-body${swipeAnim ? ' cal-swipe-' + swipeAnim : ''}`}
          style={{padding:viewMode==='month'?'10px':'0'}}
          onTouchStart={onSwipeTouchStart}
          onTouchEnd={onSwipeTouchEnd}
        >
          {viewMode==='month' && <MonthGrid
            cells={cells} month={month} today={today}
            eventsForDay={eventsForDay}
            onDayClick={(d)=>{setEditEvent(null);setModalDate(ymd(d));setShowModal(true);}}
            onEventClick={openEditEvent}
          />}
          {viewMode==='week' && <WeekTimeline
            startDate={startOfWeek(cursor)}
            today={today}
            hourStart={VIEW_HOUR_START} hourEnd={VIEW_HOUR_END}
            events={displayEvents}
            onCellClick={(d)=>{setEditEvent(null);setModalDate(ymd(d));setShowModal(true);}}
            onEventClick={openEditEvent}
            onEditTask={openTaskFromBlock}
          />}
          {viewMode==='day' && <DayTimelineWithTasks
            date={cursor} today={today}
            hourStart={VIEW_HOUR_START} hourEnd={VIEW_HOUR_END}
            events={eventsForDay(cursor)}
            tasks={tasks} setTasks={setTasks}
            onCellClick={(d)=>{setEditEvent(null);setModalDate(ymd(d));setShowModal(true);}}
            onEventClick={openEditEvent}
            onBlockMove={moveTaskBlock}
            onTogglePin={toggleBlockPin}
            onEditTask={openTaskFromBlock}
          />}
          {viewMode==='year' && <YearGrid
            startMonth={new Date(year, month, 1)}
            today={today}
            events={displayEvents}
            onMonthClick={(d)=>{setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); changeViewMode('month');}}
            onDayClick={(d)=>{setCursor(d); changeViewMode('day');}}
          />}
        </div>
      </div>

      {/* Upcoming list — only in month/year overviews; the day/week timelines
          already show events inline, so the panel just steals vertical space there. */}
      {(viewMode === 'month' || viewMode === 'year') && (
      <div className="panel">
        <div className="panel-header"><h3>Upcoming</h3></div>
        <div className="panel-body">
          {(() => {
            const upcoming = displayEvents
              .filter(ev => new Date(ev.end_at || ev.start_at) >= new Date(today.getFullYear(),today.getMonth(),today.getDate()))
              .sort((a,b)=>new Date(a.start_at)-new Date(b.start_at))
              .slice(0,10);
            if (upcoming.length === 0) return <div className="empty-state"><div className="empty-icon"><Icon name="calendar" size={28} /></div><p>No upcoming events. Click a day to add one.</p></div>;
            return <div className="task-list">
              {upcoming.map(ev => {
                const s = new Date(ev.start_at);
                return (
                  <div key={ev.id} className={`task-item${ev.event_kind==='icloud_personal'?' icloud-personal':''}`} style={{cursor:'pointer'}} onClick={()=>openEditEvent(ev)}>
                    <div style={{minWidth:'52px',textAlign:'center'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase'}}>{MONTH_NAMES[s.getMonth()].slice(0,3)}</div>
                      <div style={{fontSize:'18px',fontWeight:700,color:'var(--text-1)',lineHeight:1}}>{s.getDate()}</div>
                    </div>
                    <span className="task-text">
                      {ev.title}
                      {ev.recur_freq && <span title="Repeats" style={{marginLeft:'6px',fontSize:'11px',color:'var(--text-3)'}}>↻</span>}
                      {ev.google_event_id && <span title="Synced with Google" style={{marginLeft:'6px',fontSize:'10px',color:'var(--accent)'}}>●</span>}
                      {ev.location && <span style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'var(--text-3)'}}><Icon name="pin" size={11} style={{flexShrink:0}} /> {ev.location}</span>}
                    </span>
                    <div className="task-meta">
                      <span className="task-due">{ev.all_day ? 'All day' : `${pad2(s.getHours())}:${pad2(s.getMinutes())}`}</span>
                    </div>
                  </div>
                );
              })}
            </div>;
          })()}
        </div>
      </div>
      )}

      {showModal && <EventModal
        onClose={()=>{setShowModal(false);setEditEvent(null);}}
        onSave={handleSave}
        onDelete={handleDelete}
        initial={editEvent}
        defaultDate={modalDate}
        brain={brain}
        contacts={contacts}
        properties={properties}
      />}
      {showFlex && <FlexibleHoursModal
        date={cursor}
        userId={userId}
        onClose={()=>setShowFlex(false)}
        onApplied={async ()=>{
          setShowFlex(false);
          await refreshSchedule();
        }}
      />}
      {editingTask && <TaskModal
        onClose={()=>setEditingTask(null)}
        onSave={handleTaskSave}
        onDelete={handleTaskDelete}
        initial={editingTask}
        defaultSystem={editingTask.priority_system || 'eisenhower'}
        brain={brain}
        contacts={contacts || []}
        properties={properties || []}
        events={events}
        userId={userId}
      />}
    </div>
  );
}

// ─────────────────────────────────────────
// CALENDAR VIEW HELPERS — Month / Week / Day / Year sub-components
// ─────────────────────────────────────────

// Flexible Hours — one-day exceptions to the working-hours schedule.
// Writes a flexible_hours row whose `rules` the scheduler reads.

function FlexibleHoursModal({ date, userId, onClose, onApplied }) {

  useBackClose(onClose);
  const dateKey = ymd(date);
  const niceDate = date.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
  const [blockDay, setBlockDay] = useState(false);
  const [startLater, setStartLater] = useState('');
  const [stopEarly, setStopEarly] = useState('');
  const [blocks, setBlocks] = useState([]); // [{start,end}]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('flexible_hours').select('*').eq('user_id', userId).eq('date', dateKey);
      const row = data && data[0];
      if (!cancelled && row && Array.isArray(row.rules)) {
        for (const r of row.rules) {
          if (r.type === 'block_day') setBlockDay(true);
          else if (r.type === 'start_later') setStartLater(r.time || '');
          else if (r.type === 'stop_early') setStopEarly(r.time || '');
          else if (r.type === 'block') setBlocks(prev => [...prev, { start: r.start, end: r.end }]);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, dateKey]);

  function addBlock() { setBlocks(prev => [...prev, { start: '12:00', end: '13:00' }]); }
  function setBlock(i, patch) { setBlocks(prev => prev.map((b, idx) => idx === i ? { ...b, ...patch } : b)); }
  function removeBlock(i) { setBlocks(prev => prev.filter((_, idx) => idx !== i)); }

  function buildRules() {
    if (blockDay) return [{ type: 'block_day' }];
    const rules = [];
    if (startLater) rules.push({ type: 'start_later', time: startLater });
    if (stopEarly) rules.push({ type: 'stop_early', time: stopEarly });
    for (const b of blocks) if (b.start && b.end && b.end > b.start) rules.push({ type: 'block', start: b.start, end: b.end });
    return rules;
  }

  async function apply() {
    setSaving(true);
    const rules = buildRules();
    // one row per date: clear then insert
    await supabase.from('flexible_hours').delete().eq('user_id', userId).eq('date', dateKey);
    if (rules.length) await supabase.from('flexible_hours').insert({ user_id: userId, date: dateKey, rules });
    setSaving(false);
    onApplied();
  }

  async function clearAll() {
    setSaving(true);
    await supabase.from('flexible_hours').delete().eq('user_id', userId).eq('date', dateKey);
    setSaving(false);
    onApplied();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'440px'}}>
        <div className="modal-header">
          <h3 style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="clock" size={15} /> Flexible Hours · {niceDate}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{padding:'4px 2px'}}>
          {loading ? <p style={{color:'var(--text-3)',padding:'12px'}}>Loading…</p> : (
            <>
              <p style={{fontSize:'12px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
                Adjust just this day. The scheduler reshuffles your auto-scheduled tasks around these rules.
              </p>

              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',padding:'10px 12px',border:'1px solid var(--border)',borderRadius:'8px',marginBottom:'10px',background:'var(--bg-base)'}}>
                <input type="checkbox" checked={blockDay} onChange={e=>setBlockDay(e.target.checked)}/>
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="ban" size={13} /> Block the whole day — schedule no tasks</span>
              </label>

              {!blockDay && (
                <>
                  <div className="form-row" style={{marginBottom:'10px'}}>
                    <div className="form-group" style={{flex:1,marginBottom:0}}>
                      <label className="form-label">Start tasks later</label>
                      <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                        <input type="time" className="form-input" value={startLater} onChange={e=>setStartLater(e.target.value)} style={{flex:1}}/>
                        {startLater && <button type="button" onClick={()=>setStartLater('')} style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'16px'}}>×</button>}
                      </div>
                    </div>
                    <div className="form-group" style={{flex:1,marginBottom:0}}>
                      <label className="form-label">Stop tasks early</label>
                      <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                        <input type="time" className="form-input" value={stopEarly} onChange={e=>setStopEarly(e.target.value)} style={{flex:1}}/>
                        {stopEarly && <button type="button" onClick={()=>setStopEarly('')} style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'16px'}}>×</button>}
                      </div>
                    </div>
                  </div>

                  <div className="form-group" style={{marginBottom:'4px'}}>
                    <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span>Block out specific hours</span>
                      <button type="button" onClick={addBlock} className="btn btn-sm btn-ghost" style={{padding:'2px 8px',fontSize:'11px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>+ Add block</button>
                    </label>
                    {blocks.length === 0 && <p style={{fontSize:'11px',color:'var(--text-3)',margin:'4px 0 0'}}>e.g. lunch, school pickup, an appointment.</p>}
                    {blocks.map((b, i) => (
                      <div key={i} style={{display:'flex',gap:'6px',alignItems:'center',marginTop:'8px'}}>
                        <input type="time" className="form-input" value={b.start} onChange={e=>setBlock(i,{start:e.target.value})} style={{flex:1}}/>
                        <span style={{color:'var(--text-3)'}}>to</span>
                        <input type="time" className="form-input" value={b.end} onChange={e=>setBlock(i,{end:e.target.value})} style={{flex:1}}/>
                        <button type="button" onClick={()=>removeBlock(i)} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:'16px'}}><Icon name="trash" size={14} /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{display:'flex',gap:'8px',marginTop:'18px'}}>
                <button className="btn btn-primary" style={{flex:1}} onClick={apply} disabled={saving}>{saving?'Applying…':'Apply & reschedule'}</button>
                <button className="btn btn-ghost" onClick={clearAll} disabled={saving} title="Remove all flexible-hours rules for this day">Clear day</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// MONTH — 6-row grid of 7 days

function MonthGrid({ cells, month, today, eventsForDay, onDayClick, onEventClick }) {
  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px',marginBottom:'4px'}}>
        {DOW.map(d => <div key={d} style={{textAlign:'center',fontSize:'10px',fontWeight:600,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',padding:'4px'}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px'}}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = ymd(d) === ymd(today);
          const dayEvents = eventsForDay(d);
          return (
            <div key={i} onClick={()=>onDayClick(d)}
              style={{
                minHeight:'84px', padding:'4px 6px', borderRadius:'8px', cursor:'pointer',
                background: isToday ? 'var(--accent-glow)' : (inMonth ? 'var(--bg-base)' : 'transparent'),
                border: isToday ? '1px solid var(--accent)' : '1px solid var(--border)',
                opacity: inMonth ? 1 : 0.4,
                display:'flex', flexDirection:'column', gap:'2px', overflow:'hidden'
              }}>
              <div style={{fontSize:'11px',fontWeight:isToday?700:500,color:isToday?'var(--accent)':'var(--text-2)',textAlign:'right'}}>{d.getDate()}</div>
              {dayEvents.slice(0,3).map(ev => (
                <div key={ev.id} onClick={(e)=>{e.stopPropagation();onEventClick(ev);}} title={ev.title}
                  style={{
                    fontSize:'10px', padding:'1px 4px', borderRadius:'3px',
                    background: ev.google_event_id ? 'var(--accent-dim)' : 'var(--bg-hover)',
                    color:'var(--text-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    borderLeft: `2px solid ${ev.google_event_id ? 'var(--accent)' : 'var(--text-3)'}`
                  }}>
                  {!ev.all_day && <span style={{color:'var(--text-3)',marginRight:'3px'}}>{pad2(new Date(ev.start_at).getHours())}:{pad2(new Date(ev.start_at).getMinutes())}</span>}
                  {ev.title}
                </div>
              ))}
              {dayEvents.length > 3 && <div style={{fontSize:'9px',color:'var(--text-3)',paddingLeft:'4px'}}>+{dayEvents.length-3} more</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// WEEK — 7 day columns × hourly rows. Events absolutely positioned by start/end.

function WeekTimeline({ startDate, today, hourStart, hourEnd, events, onCellClick, onEventClick, onEditTask }) {
  const HOUR_PX = 44;
  const hours = []; for (let h = hourStart; h < hourEnd; h++) hours.push(h);
  const days = []; for (let i = 0; i < 7; i++) { const d = new Date(startDate); d.setDate(d.getDate()+i); days.push(d); }
  function evForDay(d) {
    const key = ymd(d);
    return events.filter(ev => ymd(new Date(ev.start_at)) === key && !ev.all_day);
  }
  function allDayForDay(d) {
    const key = ymd(d);
    return events.filter(ev => ymd(new Date(ev.start_at)) === key && ev.all_day);
  }
  function evPosition(ev) {
    const s = new Date(ev.start_at);
    const e = ev.end_at ? new Date(ev.end_at) : new Date(s.getTime()+60*60000);
    const startMin = Math.max(0, (s.getHours() - hourStart)*60 + s.getMinutes());
    const endMin = Math.min((hourEnd - hourStart)*60, (e.getHours() - hourStart)*60 + e.getMinutes());
    const top = (startMin/60)*HOUR_PX;
    const height = Math.max(18, ((endMin - startMin)/60)*HOUR_PX);
    return { top, height };
  }
  return (
    <div className="week-timeline">
      {/* Day headers */}
      <div className="week-day-headers">
        <div className="week-time-gutter" />
        {days.map((d,i) => {
          const isToday = ymd(d) === ymd(today);
          return (
            <div key={i} className={`week-day-header ${isToday?'today':''}`}>
              <div className="week-dow">{DOW[d.getDay()]}</div>
              <div className="week-date">{d.getDate()}</div>
              {/* All-day chips */}
              {allDayForDay(d).map(ev => (
                <div key={ev.id} className="week-allday-chip" onClick={(e)=>{e.stopPropagation();onEventClick(ev);}} title={ev.title}>
                  {ev.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {/* Hour grid */}
      <div className="week-grid-scroll">
        <div className="week-grid" style={{height: `${hours.length*HOUR_PX}px`}}>
          {/* Time gutter */}
          <div className="week-time-gutter-col">
            {hours.map(h => (
              <div key={h} className="week-time-cell" style={{height: `${HOUR_PX}px`}}>
                <span>{h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`}</span>
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((d,di) => {
            const dayEv = evForDay(d);
            const isToday = ymd(d) === ymd(today);
            return (
              <div key={di} className={`week-day-col ${isToday?'today':''}`}>
                {hours.map(h => (
                  <div key={h} className="week-hour-cell" style={{height: `${HOUR_PX}px`}}
                    onClick={()=>{ const nd = new Date(d); nd.setHours(h,0,0,0); onCellClick(nd); }} />
                ))}
                {dayEv.map(ev => {
                  const {top, height} = evPosition(ev);
                  const isBlock = ev.event_kind === 'task_block';
                  const isPersonal = ev.event_kind === 'icloud_personal';
                  const overdue = isBlock && (ev.category === 'task_overdue' || (ev.end_at && new Date(ev.end_at) < today));
                  return (
                    <div key={ev.id} className={`week-event-block${isBlock?' task-block':''}${isPersonal?' icloud-personal':''}${overdue?' overdue':''}`}
                      style={{top: `${top}px`, height: `${height}px`}}
                      onClick={(e)=>{e.stopPropagation(); if(isBlock && onEditTask) onEditTask(ev); else onEventClick(ev);}}
                      title={ev.title}>
                      <div className="week-event-time">{isBlock?'🗓 ':''}{pad2(new Date(ev.start_at).getHours())}:{pad2(new Date(ev.start_at).getMinutes())}</div>
                      <div className="week-event-title">{ev.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// DAY — Hour timeline + tasks panel (tasks panel 60% / events 40%, per request)
// A single auto-scheduled task block on the day timeline.
// Long-press → pin/unpin · drag vertically → reschedule (snaps to 15 min).

function DayTaskBlock({ ev, task, top, height, overdue, HOUR_PX, hourStart, hourEnd, date, timelineRef, onToggleComplete, onMove, onTogglePin, onTap }) {
  const [dragging, setDragging] = useState(false);
  const [dragTop, setDragTop] = useState(top);
  const press = useRef({ startY:0, origTop:top, moved:false, longPressed:false, pointerId:null, timer:null });
  const pinned = !!task?.pin_at;
  const SNAP_MIN = 15;
  const spanPx = (hourEnd - hourStart) * HOUR_PX;

  function topToDate(px) {
    const clamped = Math.max(0, Math.min(px, spanPx - 8));
    let mins = (clamped / HOUR_PX) * 60;
    mins = Math.round(mins / SNAP_MIN) * SNAP_MIN;
    const total = hourStart * 60 + mins;
    const d = new Date(date);
    d.setHours(Math.floor(total / 60), total % 60, 0, 0);
    return d;
  }
  function liveLabel(px) {
    const d = topToDate(px);
    let h = d.getHours(); const m = d.getMinutes();
    const ap = h < 12 ? 'AM' : 'PM'; let hh = h % 12; if (hh === 0) hh = 12;
    return `${hh}:${pad2(m)} ${ap}`;
  }

  function onPointerDown(e) {
    if (e.target.closest('.task-block-check, .task-block-pin')) return; // let those handle themselves
    const p = press.current;
    p.startY = e.clientY; p.origTop = top; p.moved = false; p.longPressed = false; p.pointerId = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    p.timer = setTimeout(() => {
      if (!p.moved) { p.longPressed = true; navigator.vibrate?.(15); onTogglePin?.(ev); }
    }, 480);
  }
  function onPointerMove(e) {
    const p = press.current;
    if (p.pointerId == null) return;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.abs(dy) > 6) {
      p.moved = true; clearTimeout(p.timer); setDragging(true);
    }
    if (p.moved) {
      e.preventDefault();
      setDragTop(Math.max(0, Math.min(p.origTop + dy, spanPx - 8)));
    }
  }
  function endPress(e) {
    const p = press.current;
    clearTimeout(p.timer);
    try { e.currentTarget.releasePointerCapture?.(p.pointerId); } catch { /* noop */ }
    if (p.moved) {
      const newStart = topToDate(dragTop);
      const cur = new Date(ev.start_at);
      if (newStart.getTime() !== cur.getTime()) onMove?.(ev, newStart);
    } else if (!p.longPressed && p.pointerId != null) {
      // a plain tap (no drag, no long-press) → open the task editor
      onTap?.(ev);
    }
    p.pointerId = null; p.moved = false;
    setDragging(false);
  }

  const curTop = dragging ? dragTop : top;
  return (
    <div className={`day-event-block task-block${overdue?' overdue':''}${pinned?' pinned':''}${dragging?' dragging':''}`}
      style={{top: `${curTop}px`, height: `${height}px`, touchAction:'pan-x'}}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={endPress}
      title={pinned ? 'Pinned · long-press to unpin · drag to move' : 'Long-press to pin · drag to reschedule'}>
      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
        <span className="task-block-check" onPointerDown={e=>e.stopPropagation()}
          onClick={(e)=>{e.stopPropagation(); onToggleComplete?.();}}>{task?.completed?'☑':'☐'}</span>
        <span className="day-event-title" style={{textDecoration:task?.completed?'line-through':'none'}}>{ev.title}</span>
        {pinned && <span className="task-block-pin" onPointerDown={e=>e.stopPropagation()}
          onClick={(e)=>{e.stopPropagation(); onTogglePin?.(ev);}} title="Unpin"><Icon name="pin" size={12} /></span>}
      </div>
      <div className="day-event-time">
        {dragging ? `→ ${liveLabel(dragTop)}` : `${overdue?'⚠ overdue · ':''}${pad2(new Date(ev.start_at).getHours())}:${pad2(new Date(ev.start_at).getMinutes())}${ev.description && ev.description.includes('part') ? ' · '+ev.description.replace('Auto-scheduled · ','') : ''}`}
      </div>
    </div>
  );
}


function DayTimelineWithTasks({ date, today, hourStart, hourEnd, events, tasks, setTasks, onCellClick, onEventClick, onBlockMove, onTogglePin, onEditTask }) {
  const HOUR_PX = 52;
  const hours = []; for (let h = hourStart; h < hourEnd; h++) hours.push(h);
  const isToday = ymd(date) === ymd(today);
  const timelineRef = useRef(null);

  const nonAllDay = events.filter(e => !e.all_day);
  const allDay = events.filter(e => e.all_day);

  function evPosition(ev) {
    const s = new Date(ev.start_at);
    const e = ev.end_at ? new Date(ev.end_at) : new Date(s.getTime()+60*60000);
    const startMin = Math.max(0, (s.getHours() - hourStart)*60 + s.getMinutes());
    const endMin = Math.min((hourEnd - hourStart)*60, (e.getHours() - hourStart)*60 + e.getMinutes());
    return { top: (startMin/60)*HOUR_PX, height: Math.max(22, ((endMin - startMin)/60)*HOUR_PX) };
  }

  async function toggleTask(task) {
    if (!setTasks) return;
    const { data: u } = await supabase.from('tasks').update({ completed: !task.completed, completed_at: !task.completed ? new Date().toISOString() : null }).eq('id', task.id).select().single();
    if (u) setTasks(prev => prev.map(t => t.id === u.id ? u : t));
  }

  return (
    <div className="day-view">
      <div className="day-events-col">
        <div className="day-col-header">
          <span>{isToday ? `Today · ${DOW_FULL[date.getDay()]}` : `${MONTH_NAMES[date.getMonth()].slice(0,3)} ${ordinal(date.getDate())} · ${DOW_FULL[date.getDay()]}`}</span>
          <span style={{fontSize:'10px',color:'var(--text-3)'}}>{nonAllDay.length} event{nonAllDay.length===1?'':'s'}</span>
        </div>
        {allDay.length > 0 && (
          <div className="day-allday-row">
            {allDay.map(ev => (
              <div key={ev.id} className="day-allday-chip" onClick={()=>onEventClick(ev)} title={ev.title}>{ev.title}</div>
            ))}
          </div>
        )}
        <div className="day-timeline-scroll">
          <div className="day-timeline" ref={timelineRef} style={{height: `${hours.length*HOUR_PX}px`}}>
            {hours.map(h => (
              <div key={h} className="day-hour-row" style={{height: `${HOUR_PX}px`}}
                onClick={()=>{ const nd = new Date(date); nd.setHours(h,0,0,0); onCellClick(nd); }}>
                <div className="day-hour-label">{h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`}</div>
              </div>
            ))}
            {nonAllDay.map(ev => {
              const {top, height} = evPosition(ev);
              if (ev.event_kind === 'task_block') {
                const overdue = ev.category === 'task_overdue' || (ev.end_at && new Date(ev.end_at) < today);
                const t = (tasks || []).find(x => x.id === ev.task_id);
                return (
                  <DayTaskBlock key={ev.id} ev={ev} task={t} top={top} height={height}
                    overdue={overdue} HOUR_PX={HOUR_PX} hourStart={hourStart} hourEnd={hourEnd}
                    date={date} timelineRef={timelineRef}
                    onToggleComplete={()=>{ if(t) toggleTask(t); }}
                    onMove={onBlockMove} onTogglePin={onTogglePin} onTap={onEditTask} />
                );
              }
              return (
                <div key={ev.id} className={`day-event-block${ev.event_kind==='icloud_personal'?' icloud-personal':''}`}
                  style={{top: `${top}px`, height: `${height}px`}}
                  onClick={(e)=>{e.stopPropagation();onEventClick(ev);}}
                  title={ev.title}>
                  <div className="day-event-time">{pad2(new Date(ev.start_at).getHours())}:{pad2(new Date(ev.start_at).getMinutes())}</div>
                  <div className="day-event-title">{ev.title}</div>
                  {ev.location && <div className="day-event-loc" style={{display:'flex',alignItems:'center',gap:'4px'}}><Icon name="pin" size={11} /> {ev.location}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// YEAR — 6 months in a 3×2 grid; ‹/› shifts by 6 months

function YearGrid({ startMonth, today, events, onMonthClick, onDayClick }) {
  // Pre-compute event counts per day across the visible range
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth()+i, 1);
    months.push(d);
  }
  // Bucket event counts by ymd for the visible range
  const startBound = new Date(months[0]);
  const endBound = new Date(startMonth.getFullYear(), startMonth.getMonth()+6, 0, 23, 59, 59);
  const counts = {};
  for (const ev of events) {
    const s = new Date(ev.start_at);
    if (s < startBound || s > endBound) continue;
    const k = ymd(s);
    counts[k] = (counts[k] || 0) + 1;
  }
  function densityColor(n) {
    if (!n) return 'transparent';
    if (n === 1) return 'var(--accent-glow)';
    if (n === 2) return 'rgba(197,169,94,0.25)';
    if (n <= 4) return 'rgba(197,169,94,0.45)';
    return 'var(--accent-dim)';
  }
  return (
    <div className="year-grid">
      {months.map((m, mi) => {
        const y = m.getFullYear(), mo = m.getMonth();
        const gridStart = startOfMonthGrid(y, mo);
        const cells = []; for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setDate(gridStart.getDate()+i); cells.push(d); }
        return (
          <div key={mi} className="year-month">
            <div className="year-month-header" onClick={()=>onMonthClick(m)}>{MONTH_NAMES[mo]} {y}</div>
            <div className="year-dow">
              {['S','M','T','W','T','F','S'].map((d,i)=> <div key={i}>{d}</div>)}
            </div>
            <div className="year-days">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === mo;
                const isToday = ymd(d) === ymd(today);
                const n = counts[ymd(d)] || 0;
                return (
                  <div key={i}
                    onClick={(e)=>{e.stopPropagation();if(inMonth) onDayClick(d);}}
                    className={`year-day ${inMonth?'in':'out'} ${isToday?'today':''}`}
                    style={{background: inMonth ? densityColor(n) : 'transparent'}}
                    title={n>0?`${n} event${n===1?'':'s'}`:''}>
                    {d.getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─────────────────────────────────────────
// PLAYBOOKS VIEW — Triggerable, step-aware playbooks
// ─────────────────────────────────────────

export default CalendarView;
