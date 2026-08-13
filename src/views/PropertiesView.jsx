import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import LinkedNotes from './LinkedNotes';
import { Icon } from '../icons';
import ActivityTimeline from './ActivityTimeline';
import PropertyModal from './PropertyModal';
import { useBackClose } from '../backClose';
import { confirmDialog } from '../notify';
import { canHover, modal } from '../helpers';

function PropertyDetailModal({ property, contacts, onClose, onEdit, onDeleted, userId }) {

  useBackClose(onClose);
  const [linkedContactIds, setLinkedContactIds] = useState([]);
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [linkedInvestments, setLinkedInvestments] = useState([]);
  const [linkedDrawings, setLinkedDrawings] = useState([]);
  const [propertyNotes, setPropertyNotes] = useState([]);

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactQuery, setContactQuery] = useState('');

  const [newNoteBody, setNewNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [viewDrawing, setViewDrawing] = useState(null);

  const linkedContacts = useMemo(
    () => linkedContactIds.map(id => contacts.find(c => c.id === id)).filter(Boolean),
    [linkedContactIds, contacts]
  );

  useEffect(() => {
    if (!property?.id) return;
    let cancelled = false;
    (async () => {
      const [lcRes, ltRes, leRes, liRes, ldRes, lnRes] = await Promise.all([
        supabase.from('property_contacts').select('contact_id').eq('property_id', property.id),
        supabase.from('tasks').select('*').eq('property_id', property.id).order('completed').order('due_date', { nullsFirst: false }),
        supabase.from('events').select('*').eq('property_id', property.id).order('start_at', { ascending: false }).limit(50),
        supabase.from('investments').select('*').eq('property_id', property.id).order('created_at', { ascending: false }),
        supabase.from('drawings').select('id, title, shapes, units, px_per_unit, created_at').eq('property_id', property.id).order('created_at', { ascending: false }),
        supabase.from('property_notes').select('*').eq('property_id', property.id).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setLinkedContactIds((lcRes.data || []).map(r => r.contact_id));
      setLinkedTasks(ltRes.data || []);
      setLinkedEvents(leRes.data || []);
      setLinkedInvestments(liRes.data || []);
      setLinkedDrawings(ldRes.data || []);
      setPropertyNotes(lnRes.data || []);
    })();
    return () => { cancelled = true; };
  }, [property?.id]);

  async function addContactLink(contactId) {
    const newIds = [...linkedContactIds, contactId];
    const { error } = await supabase.rpc('set_property_contacts', {
      p_property_id: property.id,
      p_contact_ids: newIds,
    });
    if (error) {
      if (window.__notify) window.__notify('Could not link contact: ' + error.message, 'error');
      return;
    }
    setLinkedContactIds(newIds);
    setShowContactPicker(false);
    setContactQuery('');
  }

  async function removeContactLink(contactId) {
    const newIds = linkedContactIds.filter(id => id !== contactId);
    const { error } = await supabase.rpc('set_property_contacts', {
      p_property_id: property.id,
      p_contact_ids: newIds,
    });
    if (error) {
      if (window.__notify) window.__notify('Could not unlink contact: ' + error.message, 'error');
      return;
    }
    setLinkedContactIds(newIds);
  }

  async function addDatedNote() {
    const body = newNoteBody.trim();
    if (!body || savingNote) return;
    setSavingNote(true);
    const { data, error } = await supabase.from('property_notes').insert({
      user_id: userId, property_id: property.id, body,
    }).select().single();
    setSavingNote(false);
    if (error) {
      if (window.__notify) window.__notify('Could not save note: ' + error.message, 'error');
      return;
    }
    setPropertyNotes(prev => [data, ...prev]);
    setNewNoteBody('');
  }

  async function deleteDatedNote(noteId) {
    const prev = propertyNotes;
    setPropertyNotes(p => p.filter(n => n.id !== noteId));
    const { error } = await supabase.from('property_notes').delete().eq('id', noteId);
    if (error) {
      setPropertyNotes(prev);
      if (window.__notify) window.__notify('Could not delete note: ' + error.message, 'error');
    }
  }

  async function handleDeleteProperty() {
    if (!await confirmDialog(`Delete ${property.nickname || 'this property'}? This removes the property and all its linked notes. Tasks/events stay but lose the link.`)) return;
    const { error } = await supabase.from('properties').delete().eq('id', property.id);
    if (error) {
      if (window.__notify) window.__notify('Could not delete: ' + error.message, 'error');
      return;
    }
    onDeleted?.(property.id);
    onClose();
  }

  const availableContacts = useMemo(() => {
    const linked = new Set(linkedContactIds);
    const q = contactQuery.toLowerCase().trim();
    return contacts
      .filter(c => !linked.has(c.id))
      .filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [contacts, linkedContactIds, contactQuery]);

  const equity = property.current_value && property.loan_balance
    ? Number(property.current_value) - Number(property.loan_balance)
    : null;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'620px',padding:0,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'16px 18px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',position:'sticky',top:0,background:'var(--bg-card)',zIndex:5}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
              <h3 style={{margin:0,fontSize:'18px',color:'var(--text-1)'}}>{property.nickname || 'Untitled property'}</h3>
              {property.category && <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{property.category}</span>}
              {property.status && <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{(property.status || '').replace('_', ' ')}</span>}
            </div>
            {property.address && (
              <div style={{fontSize:'13px',color:'var(--text-2)'}}>
                {[property.address, property.city, property.state, property.zip].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {(property.current_value || property.loan_balance || property.list_price) && (
          <div style={{padding:'10px 18px',borderBottom:'1px solid var(--border)',display:'flex',gap:'18px',flexWrap:'wrap',fontSize:'12px'}}>
            {property.list_price ? <div><span style={{color:'var(--text-3)'}}>List:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.list_price).toLocaleString()}</strong></div> : null}
            {property.current_value ? <div><span style={{color:'var(--text-3)'}}>Value:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.current_value).toLocaleString()}</strong></div> : null}
            {property.loan_balance ? <div><span style={{color:'var(--text-3)'}}>Loan:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.loan_balance).toLocaleString()}</strong>{property.loan_rate ? <span style={{color:'var(--text-3)'}}> @ {property.loan_rate}%</span> : null}</div> : null}
            {equity !== null ? <div><span style={{color:'var(--text-3)'}}>Equity:</span> <strong style={{color:'var(--accent)'}}>${equity.toLocaleString()}</strong></div> : null}
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="users" size={13} /> Contacts ({linkedContacts.length})</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowContactPicker(v => !v)} style={{fontSize:'11px'}}>
              {showContactPicker ? '× Cancel' : '+ Link'}
            </button>
          </div>
          {showContactPicker && (
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'8px'}}>
              <input className="form-input" placeholder="Search contacts…" value={contactQuery} onChange={e => setContactQuery(e.target.value)} autoFocus style={{fontSize:'12px',padding:'6px 8px',marginBottom:'6px'}} />
              <div style={{maxHeight:'180px',overflowY:'auto'}}>
                {availableContacts.length === 0 && (
                  <div style={{fontSize:'11px',color:'var(--text-3)',padding:'4px',fontStyle:'italic'}}>No contacts {contactQuery ? 'match' : 'available to link'}.</div>
                )}
                {availableContacts.map(c => (
                  <div key={c.id} onClick={() => addContactLink(c.id)} style={{padding:'6px 8px',cursor:'pointer',fontSize:'12px',borderRadius:'4px'}} onMouseEnter={e  => { if (!canHover()) return; e.currentTarget.style.background = 'var(--bg-hover)'; }} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {c.name} {c.email && <span style={{color:'var(--text-3)'}}>· {c.email}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {linkedContacts.length === 0 && !showContactPicker && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No contacts linked.</div>
          )}
          {linkedContacts.map(c => (
            <div key={c.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,color:'var(--text-1)'}}>
                {c.name} {c.email && <span style={{color:'var(--text-3)'}}>· {c.email}</span>}
              </div>
              <button onClick={() => removeContactLink(c.id)} title="Unlink" style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'14px',padding:'0 4px'}}>×</button>
            </div>
          ))}
        </div>

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="tasks" size={13} /> Tasks ({linkedTasks.length})</span>
          </div>
          {linkedTasks.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No tasks linked. Link this property when creating or editing a task.</div>
          ) : linkedTasks.map(t => (
            <div key={t.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,textDecoration: t.completed ? 'line-through' : 'none',color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>
                {t.completed ? '✓ ' : '○ '}{t.title}
              </div>
              {t.due_date && <span style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap'}}>{new Date(t.due_date).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="calendar" size={13} /> Events ({linkedEvents.length})</span>
          </div>
          {linkedEvents.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No events linked.</div>
          ) : linkedEvents.slice(0, 10).map(e => (
            <div key={e.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
              <div style={{color:'var(--text-1)'}}>{e.title}</div>
              <div style={{fontSize:'10px',color:'var(--text-3)'}}>{e.start_at ? new Date(e.start_at).toLocaleString() : '—'}</div>
            </div>
          ))}
          {linkedEvents.length > 10 && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>Showing 10 of {linkedEvents.length}.</div>}
        </div>

        {linkedInvestments.length > 0 && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="dollar" size={13} /> Investments ({linkedInvestments.length})</div>
            {linkedInvestments.map(inv => (
              <div key={inv.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',gap:'8px',fontSize:'12px'}}>
                <div style={{color:'var(--text-1)'}}>{inv.label || inv.kind || 'Investment'}</div>
                {inv.amount && <span style={{color:'var(--accent)'}}>${Number(inv.amount).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        )}

        {linkedDrawings.length > 0 && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="edit" size={13} /> Drawings ({linkedDrawings.length})</div>
            {linkedDrawings.map(d => {
              const shapeCount = Array.isArray(d.shapes) ? d.shapes.length : 0;
              return (
                <div key={d.id} onClick={() => setViewDrawing(d)} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'4px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px'}}>
                  <div>
                    <div style={{color:'var(--text-1)',fontWeight:500}}>{d.title || 'Untitled drawing'}</div>
                    <div style={{fontSize:'10px',color:'var(--text-3)'}}>{shapeCount} shape{shapeCount === 1 ? '' : 's'} · {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</div>
                  </div>
                  <span style={{color:'var(--accent)',fontSize:'11px'}}>View ›</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)',background:'var(--bg-base)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'10px',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="signal" size={13} /> Activity</div>
          <ActivityTimeline entityType="property" entityId={property.id} userId={userId} contacts={contacts} />
        </div>

        {/* property_notes rows were being loaded and written but NEVER rendered —
            the notes existed and were invisible. They now live in the unified
            `notes` store and surface here through entity_links, alongside
            anything else linked to this property. */}
        <div style={{ padding: '0 18px 14px' }}>
          <LinkedNotes userId={userId} targetType="property" targetId={property.id} />
        </div>

        {property.notes && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'4px'}}>Note (on property record)</div>
            <div style={{fontSize:'12px',color:'var(--text-2)',whiteSpace:'pre-wrap'}}>{property.notes}</div>
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)',display:'flex',gap:'8px',justifyContent:'space-between'}}>
          <button className="btn btn-ghost btn-sm" onClick={handleDeleteProperty} style={{color:'var(--red)'}}>Delete property</button>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={onEdit}>Edit details</button>
          </div>
        </div>

        {viewDrawing && (
          <DrawingViewerModal drawing={viewDrawing} onClose={() => setViewDrawing(null)} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DRAWING VIEWER MODAL — minimal read-only SVG renderer
// Restored per Q3a=C. Only renders the shape types Dara used: line, rect,
// circle, polyline, freehand. No editing, no panning/zooming.
// ─────────────────────────────────────────

function DrawingViewerModal({ drawing, onClose }) {

  useBackClose(onClose);
  // Memoize so the useMemo below doesn't see a new array on every render.
  const shapes = useMemo(
    () => Array.isArray(drawing.shapes) ? drawing.shapes : [],
    [drawing.shapes]
  );

  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function note(x, y) {
      if (typeof x === 'number' && typeof y === 'number') {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    for (const s of shapes) {
      if (s.type === 'line' || s.type === 'dimension') { note(s.x1, s.y1); note(s.x2, s.y2); }
      else if (s.type === 'rect') { note(s.x, s.y); note((s.x || 0) + (s.w || 0), (s.y || 0) + (s.h || 0)); }
      else if (s.type === 'circle') { note((s.cx || 0) - (s.r || 0), (s.cy || 0) - (s.r || 0)); note((s.cx || 0) + (s.r || 0), (s.cy || 0) + (s.r || 0)); }
      else if ((s.type === 'polyline' || s.type === 'freehand') && Array.isArray(s.points)) { for (const p of s.points) note(p.x, p.y); }
      else if (s.type === 'text') { note(s.x, s.y); note((s.x || 0) + 50, (s.y || 0) + 14); }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 100, h: 100 };
    const pad = 20;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }, [shapes]);

  function renderShape(s, i) {
    const stroke = s.stroke || s.color || '#e8eaf0';
    const fill = s.fillStyle && s.fillStyle !== 'none' ? (s.fillColor || stroke) : 'none';
    const sw = s.strokeWidth || 2;
    const common = { stroke, strokeWidth: sw, fill, key: s.id || i };
    if (s.type === 'line' || s.type === 'dimension') return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} fill="none" />;
    if (s.type === 'rect') return <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />;
    if (s.type === 'circle') return <circle cx={s.cx} cy={s.cy} r={s.r} {...common} />;
    if (s.type === 'polyline' && Array.isArray(s.points)) {
      const pts = s.points.map(p => `${p.x},${p.y}`).join(' ');
      return <polyline points={pts} {...common} fill="none" />;
    }
    if (s.type === 'freehand' && Array.isArray(s.points) && s.points.length >= 2) {
      const d = 'M ' + s.points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
      return <path d={d} {...common} fill="none" />;
    }
    if (s.type === 'text') {
      return <text x={s.x} y={s.y} fill={s.color || stroke} fontSize={s.fontSize || 14} key={s.id || i}>{s.text || ''}</text>;
    }
    return null;
  }

  return (
    <div className="modal-overlay" style={{zIndex: 1500}} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'820px',width:'94%',padding:0,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{margin:0,fontSize:'16px',color:'var(--text-1)'}}>{drawing.title || 'Untitled drawing'}</h3>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>
              {shapes.length} shape{shapes.length === 1 ? '' : 's'} · Read-only view
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{padding:'18px',background:'var(--bg-base)'}}>
          <div style={{background:'#1a1d26',borderRadius:'6px',padding:'12px',minHeight:'320px'}}>
            <svg viewBox={`${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`} style={{width:'100%',height:'auto',maxHeight:'60vh',display:'block'}}>
              {shapes.map(renderShape)}
            </svg>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',textAlign:'center'}}>
            Read-only viewer. The drafting editor is not currently available.
          </div>
        </div>
      </div>
    </div>
  );
}


function PropertiesView({ properties, setProperties, userId, contacts }) {
  const [showModal, setShowModal] = useState(false);
  const [editProp, setEditProp] = useState(null);
  const [detailProp, setDetailProp] = useState(null);
  const [catFilter, setCatFilter] = useState('all');

  const CATS = [
    { id: 'all', label: 'All', iconName: 'properties' },
    { id: 'listing', label: 'Listings', iconName: 'tag' },
    { id: 'investment', label: 'Investments', iconName: 'dollar' },
    { id: 'personal', label: 'Personal', iconName: 'home' },
    { id: 'rental', label: 'Rentals', iconName: 'key' },
  ];

  const filtered = catFilter === 'all' ? properties : properties.filter(p => p.category === catFilter);

  async function handleSave(data) {
    if (editProp) {
      const { data: u } = await supabase.from('properties').update(data).eq('id', editProp.id).select().single();
      if (u) setProperties(prev => prev.map(p => p.id === u.id ? u : p));
    } else {
      const { data: c } = await supabase.from('properties').insert({ ...data, user_id: userId }).select().single();
      if (c) setProperties(prev => [c, ...prev]);
    }
    setShowModal(false); setEditProp(null);
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2 style={{display:'flex',alignItems:'center',gap:'10px',margin:0,fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'30px',letterSpacing:'-0.02em'}}><Icon name="properties" size={24} style={{color:'var(--accent)',flexShrink:0}} />Properties</h2><p>{properties.length} total · {filtered.length} shown</p></div>
        <button className="btn-add-circle" onClick={()=>{setEditProp(null);setShowModal(true);}} title="New Property" aria-label="New Property">+</button>
      </div>

      {(() => {
        const totVal = properties.reduce((s,pp)=> s + (Number(pp.current_value)||0), 0);
        const totEq = properties.reduce((s,pp)=> s + ((pp.current_value && pp.loan_balance) ? (Number(pp.current_value)-Number(pp.loan_balance)) : (Number(pp.current_value)||0)), 0);
        if (totVal <= 0) return null;
        return (
          <div style={{border:'1px solid rgba(203,163,92,.40)',borderRadius:'18px',padding:'18px 18px 16px',marginBottom:'14px',background:'radial-gradient(90% 130% at 100% 0%, rgba(203,163,92,.12), transparent 55%), linear-gradient(180deg,#1B1610,#100D09)'}}>
            <div className="ww-eyebrow">Portfolio equity</div>
            <div style={{display:'flex',alignItems:'baseline',gap:'12px',flexWrap:'wrap',margin:'8px 0 2px'}}>
              <span style={{fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'42px',letterSpacing:'-0.02em',color:'#F6F1E7',lineHeight:1}}>${Math.round(totEq).toLocaleString()}</span>
              <span style={{fontSize:'13px',color:'#C8BFAE'}}>${Math.round(totVal).toLocaleString()} total value · {properties.length} propert{properties.length===1?'y':'ies'}</span>
            </div>
          </div>
        );
      })()}

      <div className="panel">
        <div className="panel-header panel-header-compact">
          <h3>Properties</h3>
          <div className="filter-chip-row">
            {CATS.map(c => (
              <button key={c.id} className={`filter-chip ${catFilter===c.id?'active':''}`} onClick={()=>setCatFilter(c.id)}><span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name={c.iconName} size={12} /> {c.label}</span></button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon"><Icon name="properties" size={28} /></div><p>No properties here.</p></div>
            : <div className="task-list">
                {filtered.map(p => {
                  const equity = p.current_value && p.loan_balance ? Number(p.current_value) - Number(p.loan_balance) : null;
                  return (
                  <div key={p.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>setDetailProp(p)}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                        {p.nickname}
                        <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{p.category}</span>
                      </div>
                      {p.address && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>{[p.address,p.city,p.state,p.zip].filter(Boolean).join(', ')}</div>}
                      <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
                        {p.category === 'listing' && p.list_price && <span>List ${Number(p.list_price).toLocaleString()}</span>}
                        {p.current_value && <span>Value ${Number(p.current_value).toLocaleString()}</span>}
                        {p.loan_balance && <span>Loan ${Number(p.loan_balance).toLocaleString()}{p.loan_rate?` @ ${p.loan_rate}%`:''}</span>}
                        {equity !== null && <span style={{color:'var(--accent)'}}>Equity ${equity.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="task-meta">
                      <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{(p.status||'').replace('_',' ')}</span>
                    </div>
                  </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <PropertyModal onClose={()=>{setShowModal(false);setEditProp(null);}} onSave={handleSave} onDelete={async (p)=>{ if(!await confirmDialog(`Delete property "${p.nickname || p.address || '(unnamed)'}"?`)) return; await supabase.from('properties').delete().eq('id', p.id); setProperties(prev=>prev.filter(x=>x.id!==p.id)); setShowModal(false); setEditProp(null); }} initial={editProp} />}
      {detailProp && (
        <PropertyDetailModal
          property={detailProp}
          contacts={contacts || []}
          onClose={() => setDetailProp(null)}
          onEdit={() => { setEditProp(detailProp); setShowModal(true); setDetailProp(null); }}
          onDeleted={(id) => setProperties(prev => prev.filter(p => p.id !== id))}
          userId={userId}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// INVESTMENTS VIEW
// ─────────────────────────────────────────

export default PropertiesView;
