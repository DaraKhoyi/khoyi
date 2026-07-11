import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { useBackClose, ContactPicker, Icon, confirmDialog, modal, notify } from '../App';

function BrainEntryModal({ onClose, onSave, onDelete, initial, defaultType, contacts = [] }) {

  useBackClose(onClose);
  const [type, setType] = useState(initial?.type || defaultType || 'memory');
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [event_date, setEventDate] = useState(initial?.event_date || '');
  const [pinned, setPinned] = useState(initial?.pinned || false);
  const [tagsRaw, setTagsRaw] = useState((initial?.tags || []).join(', '));
  const [strength, setStrength] = useState(initial?.strength ?? 50);
  const [contactIds, setContactIds] = useState([]);

  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('brain_contacts').select('contact_id').eq('brain_entry_id', initial.id);
      if (!cancelled && data) setContactIds(data.map(r => r.contact_id));
    })();
    return () => { cancelled = true; };
  }, [initial?.id]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    onSave({
      type, title: title.trim(), content: content.trim() || null,
      event_date: event_date || null, pinned, tags, strength,
      _contact_ids: contactIds,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3>{initial ? 'Edit Brain Entry' : 'New Brain Entry'}</h3>
            {initial && onDelete && <button type="button" className="modal-delete" onClick={()=>onDelete(initial)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                <option value="north-star">🎯 North Star</option>
                <option value="soul">🪞 Soul</option>
                <option value="memory">📖 Memory</option>
                <option value="playbook">📚 Playbook</option>
                <option value="decision">⚖️ Decision</option>
                <option value="lesson">💡 Lesson</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Date (optional)</label><input className="form-input" type="date" value={event_date} onChange={e=>setEventDate(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} autoFocus required /></div>
          <div className="form-group"><label className="form-label">Content</label><textarea className="form-textarea" value={content} onChange={e=>setContent(e.target.value)} style={{minHeight:'180px'}} placeholder="What is this? Why does it matter? What's the action?" /></div>
          <div className="form-group">
            <label className="form-label">Tags <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(comma-separated, e.g. alex, succession, recruiting)</span></label>
            <input className="form-input" value={tagsRaw} onChange={e=>setTagsRaw(e.target.value)} placeholder="tag1, tag2, tag3" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Strength <span style={{color:'var(--accent)',fontWeight:700,fontSize:'13px'}}>{strength}</span></label>
              <input type="range" min="0" max="100" step="5" value={strength} onChange={e=>setStrength(parseInt(e.target.value))} style={{width:'100%',accentColor:'var(--accent)'}} />
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>
                <span>passing</span><span>core belief</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginTop:'24px'}}>
                <input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} />
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="pin" size={13} /> Pin to top</span>
              </label>
            </div>
          </div>
          <ContactPicker contacts={contacts} selectedIds={contactIds} onChange={setContactIds} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Entry</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Compute current streak: consecutive days (ending today or yesterday) with ≥1 brain entry

function computeBrainStreak(brain) {
  if (!brain || brain.length === 0) return { current: 0, longest: 0, today: false };
  const days = new Set();
  for (const b of brain) {
    if (!b.created_at) continue;
    const d = new Date(b.created_at);
    days.add(d.toISOString().slice(0,10));
  }
  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0,10);
  const hitToday = days.has(today);
  // Start from today or yesterday
  let cursor = hitToday ? today : (days.has(yesterday) ? yesterday : null);
  let current = 0;
  while (cursor && days.has(cursor)) {
    current++;
    const prev = new Date(new Date(cursor).getTime() - 864e5);
    cursor = prev.toISOString().slice(0,10);
  }
  // Longest streak across all data
  const sortedDays = [...days].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of sortedDays) {
    if (prev) {
      const gap = (new Date(d) - new Date(prev)) / 864e5;
      run = gap === 1 ? run + 1 : 1;
    } else { run = 1; }
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest, today: hitToday };
}


function BrainView({ brain, setBrain, userId, tasks = [], events = [], contacts = [] }) {
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [activeTab, setActiveTab] = useState('north-star');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching, [] = no results
  const [searchLoading, setSearchLoading] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);

  const TABS = [
    { id: 'north-star', label: 'North Star', icon: <Icon name="target" size={13} /> },
    { id: 'soul',       label: 'Soul',       icon: <Icon name="sparkles" size={13} /> },
    { id: 'memory',     label: 'Memory',     icon: <Icon name="notes" size={13} /> },
    { id: 'playbook',   label: 'Playbooks',  icon: <Icon name="library" size={13} /> },
    { id: 'decision',   label: 'Decisions',  icon: <Icon name="scale" size={13} /> },
    { id: 'lesson',     label: 'Lessons',    icon: <Icon name="bulb" size={13} /> },
  ];

  // STREAK: consecutive days with at least one brain entry
  const streak = computeBrainStreak(brain);
  const totalTags = new Set(brain.flatMap(b => b.tags || [])).size;
  const pinnedCount = brain.filter(b => b.pinned).length;

  // Debounced hybrid search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        if (semanticMode) {
          // Semantic search via edge function (will work once embeddings are populated)
          const { data, error } = await supabase.functions.invoke('brain-semantic-search', {
            body: { query: q, user_id: userId, limit: 25 }
          });
          if (error) {
            console.warn('Semantic search not available, falling back to hybrid:', error.message);
            const { data: fallback } = await supabase.rpc('search_brain', { p_query: q, p_user_id: userId, p_limit: 25 });
            setSearchResults(fallback || []);
          } else {
            setSearchResults(data?.results || []);
          }
        } else {
          const { data, error } = await supabase.rpc('search_brain', { p_query: q, p_user_id: userId, p_limit: 25 });
          if (error) console.error(error);
          setSearchResults(data || []);
        }
      } catch (e) {
        console.error('Search error:', e);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery, semanticMode, userId]);

  const tabEntries = brain.filter(b => b.type === activeTab);
  const sorted = [...tabEntries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if ((b.strength || 50) !== (a.strength || 50)) return (b.strength || 50) - (a.strength || 50);
    const aD = a.event_date || a.created_at;
    const bD = b.event_date || b.created_at;
    return new Date(bD) - new Date(aD);
  });

  const inSearchMode = searchResults !== null;
  const displayEntries = inSearchMode ? searchResults : sorted;

  async function handleSave(data) {
    const { _contact_ids, ...entryData } = data;
    let savedEntryId = null;
    if (editEntry) {
      const { data: u, error } = await supabase.from('brain').update(entryData).eq('id', editEntry.id).select().single();
      if (error) { notify("Couldn't save entry. Try again.", 'error'); return; }
      if (u) { setBrain(prev => prev.map(x => x.id === u.id ? u : x)); savedEntryId = u.id; }
    } else {
      const { data: c, error } = await supabase.from('brain').insert({ ...entryData, user_id: userId }).select().single();
      if (error) { notify("Couldn't create entry. Try again.", 'error'); return; }
      if (c) { setBrain(prev => [c, ...prev]); savedEntryId = c.id; }
    }
    // Sync contact links via RPC (replace full set)
    if (savedEntryId && Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_brain_contacts', {
        p_brain_id: savedEntryId,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) notify("Saved entry, but contact links failed.", 'error');
    }
    setShowModal(false); setEditEntry(null);
    // Trigger background embedding generation (silent — fails gracefully if function not deployed)
    try {
      const id = editEntry?.id;
      if (id || true) {
        supabase.functions.invoke('brain-embed', { body: { id: id || null, all_missing: !id } }).catch(()=>{});
      }
    } catch (e) {}
  }

  async function deleteEntry(id) {
    if (!await confirmDialog('Delete this entry?')) return;
    // Snapshot for rollback
    const snapshot = brain.find(x => x.id === id);
    setBrain(prev => prev.filter(x => x.id !== id));
    const { error } = await supabase.from('brain').delete().eq('id', id);
    if (error) {
      if (snapshot) setBrain(prev => [snapshot, ...prev.filter(x => x.id !== id)]);
      notify("Couldn't delete entry. Reverted.", 'error');
    }
  }

  async function togglePin(entry, e) {
    e.stopPropagation();
    const { data: u, error } = await supabase.from('brain').update({ pinned: !entry.pinned }).eq('id', entry.id).select().single();
    if (error) { notify("Couldn't update pin state.", 'error'); return; }
    if (u) setBrain(prev => prev.map(x => x.id === u.id ? u : x));
  }

  const currentTab = TABS.find(t => t.id === activeTab);
  const typeLabel = (t) => TABS.find(x => x.id === t)?.icon + ' ' + TABS.find(x => x.id === t)?.label;

  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><div className="ww-eyebrow" style={{marginBottom:6}}>Your operating memory · Realty ONE Group</div><h2 style={{display:'flex',alignItems:'center',gap:'10px',margin:0,fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'30px',letterSpacing:'-0.02em'}}><Icon name="brain" size={24} style={{color:'var(--accent)',flexShrink:0}} />Brain</h2><p>{brain.length} entries · {totalTags} unique tags</p></div>
        <button className="btn-add-circle" onClick={()=>{setEditEntry(null);setShowModal(true);}} title="New Entry" aria-label="New Entry">+</button>
      </div>

      {/* STREAK + STATS BANNER — subtle gamification in brand gold */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'10px',
        marginBottom:'14px'
      }}>
        <div style={{padding:'12px 14px',background:'linear-gradient(135deg, var(--accent-glow) 0%, transparent 100%)',border:'1px solid var(--accent-dim)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Capture streak</div>
          <div style={{display:'flex',alignItems:'baseline',gap:'6px'}}>
            <span style={{fontSize:'27px',fontWeight:300,color:'#F6F1E7',fontFamily:'Fraunces, serif',letterSpacing:'-0.01em'}}>{streak.current}</span>
            <span style={{fontSize:'11px',color:'var(--text-3)'}}>day{streak.current!==1?'s':''}</span>
            {streak.today && <span title="Logged today" style={{marginLeft:'auto',color:'var(--accent)',fontSize:'14px'}}>●</span>}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>best: {streak.longest} days</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Pinned</div>
          <div style={{fontSize:'27px',fontWeight:300,color:'#F6F1E7',fontFamily:'Fraunces, serif',letterSpacing:'-0.01em'}}>{pinnedCount}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>core references</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Memory entries</div>
          <div style={{fontSize:'27px',fontWeight:300,color:'#F6F1E7',fontFamily:'Fraunces, serif',letterSpacing:'-0.01em'}}>{brain.filter(b=>b.type==='memory').length}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>facts about people, tools, decisions</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Playbooks</div>
          <div style={{fontSize:'27px',fontWeight:300,color:'#F6F1E7',fontFamily:'Fraunces, serif',letterSpacing:'-0.01em'}}>{brain.filter(b=>b.type==='playbook').length}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>repeatable plays</div>
        </div>
      </div>

      {/* SEARCH BAR — works across all types */}
      <div style={{marginBottom:'14px',position:'relative'}}>
        <div style={{position:'relative'}}>
          <span style={{position:'absolute',left:'14px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'14px',pointerEvents:'none'}}><Icon name="search" size={14} /></span>
          <input
            className="form-input"
            placeholder={semanticMode ? 'Ask anything (semantic) — "decisions about Alex"' : 'Search across all entries — title, content, tags'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{paddingLeft:'40px',paddingRight:searchQuery?'80px':'14px',fontSize:'14px',height:'44px',background:'var(--bg-card)'}}
          />
          {searchQuery && (
            <button onClick={()=>setSearchQuery('')} className="btn btn-ghost btn-sm" style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',padding:'4px 10px'}}>clear</button>
          )}
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'11px',color:'var(--text-2)'}}>
            <input type="checkbox" checked={semanticMode} onChange={e=>setSemanticMode(e.target.checked)} style={{accentColor:'var(--accent)'}} />
            Semantic mode <span style={{color:'var(--text-3)'}}>(meaning-based, requires embeddings)</span>
          </label>
          {searchLoading && <span style={{fontSize:'11px',color:'var(--accent)'}}>searching…</span>}
          {inSearchMode && !searchLoading && (
            <span style={{fontSize:'11px',color:'var(--text-3)',marginLeft:'auto'}}>
              {displayEntries.length} {displayEntries.length===1?'match':'matches'}
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        {!inSearchMode && (
          <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              {TABS.map(t => {
                const count = brain.filter(b => b.type === t.id).length;
                return (
                  <button key={t.id} className={`btn btn-sm ${activeTab===t.id?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab(t.id)}>
                    {t.icon} {t.label}{count > 0 && <span style={{marginLeft:'6px',opacity:0.7}}>({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="panel-body">
          {displayEntries.length === 0
            ? <div className="empty-state">
                <div className="empty-icon">{inSearchMode ? <Icon name="search" size={28} /> : currentTab?.icon}</div>
                <p>{inSearchMode ? `No matches for "${searchQuery}".` : `Nothing in ${currentTab?.label} yet.`}</p>
              </div>
            : <div className="task-list">
                {displayEntries.map(entry => {
                  const strength = entry.strength ?? 50;
                  // Pass 3 Finding #2: reverse view — count tasks referencing this brain entry
                  const derivedTaskCount = tasks.filter(t => t.brain_entry_id === entry.id).length;
                  const derivedTaskCompleted = tasks.filter(t => t.brain_entry_id === entry.id && t.completed).length;
                  // Pass 4 Finding #6: events linked to this brain entry
                  const derivedEventCount = events.filter(e => e.brain_entry_id === entry.id).length;
                  return (
                    <div key={entry.id} className="task-item" style={{cursor:'pointer',flexDirection:'column',alignItems:'stretch',gap:'8px'}} onClick={()=>{setEditEntry(entry);setShowModal(true);}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',width:'100%'}}>
                        {/* Strength dot — color & opacity scale with strength */}
                        <span title={`Strength: ${strength}`} style={{
                          width:'8px',height:'8px',borderRadius:'50%',
                          background:'var(--accent)',
                          opacity: 0.25 + (strength/100)*0.75,
                          flexShrink:0,
                          boxShadow: strength >= 80 ? '0 0 8px var(--accent-glow)' : 'none'
                        }}/>
                        <div style={{flex:1,fontWeight:600,color:'var(--text-1)',lineHeight:1.35}}>
                          {entry.pinned && <span title="Pinned" style={{marginRight:'6px',color:'var(--accent)'}}><Icon name="pin" size={12} /></span>}
                          {inSearchMode && <span className="pill" style={{marginRight:'8px',fontSize:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',color:'var(--text-3)'}}>{typeLabel(entry.type)}</span>}
                          {entry.title}
                        </div>
                        <div className="task-meta">
                          {derivedTaskCount > 0 && (
                            <span
                              title={`${derivedTaskCount} task${derivedTaskCount === 1 ? '' : 's'} linked${derivedTaskCompleted > 0 ? ` · ${derivedTaskCompleted} done` : ''}`}
                              style={{fontSize:'10px',color:'var(--text-3)',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',padding:'2px 6px',whiteSpace:'nowrap'}}>
                              <Icon name="tasks" size={12} /> {derivedTaskCompleted > 0 ? `${derivedTaskCompleted}/${derivedTaskCount}` : derivedTaskCount}
                            </span>
                          )}
                          {derivedEventCount > 0 && (
                            <span
                              title={`${derivedEventCount} event${derivedEventCount === 1 ? '' : 's'} linked`}
                              style={{fontSize:'10px',color:'var(--text-3)',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',padding:'2px 6px',whiteSpace:'nowrap'}}>
                              <Icon name="calendar" size={12} /> {derivedEventCount}
                            </span>
                          )}
                          {entry.event_date && <span className="task-due">{entry.event_date}</span>}
                          <button className="task-delete" style={{color:entry.pinned?'var(--accent)':undefined}} onClick={(e)=>togglePin(entry,e)} title="Pin">{entry.pinned ? '★' : '☆'}</button>
                          <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteEntry(entry.id);}}>×</button>
                        </div>
                      </div>
                      {entry.content && <div style={{fontSize:'13px',color:'var(--text-2)',whiteSpace:'pre-wrap',lineHeight:1.5,paddingLeft:'18px'}}>{entry.content.length > 240 ? entry.content.slice(0,240) + '…' : entry.content}</div>}
                      {entry.tags && entry.tags.length > 0 && (
                        <div style={{display:'flex',gap:'4px',flexWrap:'wrap',paddingLeft:'18px'}}>
                          {entry.tags.map(tag => (
                            <span key={tag} className="pill" style={{fontSize:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',color:'var(--text-2)',padding:'2px 8px'}}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <BrainEntryModal onClose={()=>{setShowModal(false);setEditEntry(null);}} onSave={handleSave} onDelete={async (e)=>{ if(!await confirmDialog(`Delete "${e.title}"?`)) return; await deleteEntry(e.id); setShowModal(false); setEditEntry(null); }} initial={editEntry} defaultType={activeTab} contacts={contacts} />}
    </div>
  );
}


// ─────────────────────────────────────────
// CALENDAR VIEW — month grid + Google Calendar sync
// ─────────────────────────────────────────

export default BrainView;
