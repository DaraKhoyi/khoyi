// TemplatesModal — pick/insert a saved message template.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { MERGE_FIELDS } from '../helpers';
import { notify } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';

export default function TemplatesModal({ userId, templates, setTemplates, onClose, onPick }) {
  useBackClose(onClose);
  const blank = { name: '', channel: 'email', category: '', subject: '', body: '' };
  const [editing, setEditing] = useState(null); // template object or null
  const [form, setForm] = useState(blank);
  const bodyRef = useRef(null);

  function startNew() { setEditing('new'); setForm(blank); }
  function startEdit(t) { setEditing(t.id); setForm({ name: t.name, channel: t.channel, category: t.category || '', subject: t.subject || '', body: t.body || '' }); }
  function insertToken(tok) {
    const ta = bodyRef.current; const ins = `{{${tok}}}`;
    if (!ta) { setForm(f => ({ ...f, body: f.body + ins })); return; }
    const start = ta.selectionStart || form.body.length, end = ta.selectionEnd || form.body.length;
    const next = form.body.slice(0, start) + ins + form.body.slice(end);
    setForm(f => ({ ...f, body: next }));
    setTimeout(() => { ta.focus(); const p = start + ins.length; ta.setSelectionRange(p, p); }, 0);
  }
  async function save() {
    if (!form.name.trim() || !form.body.trim()) { notify('Name and body are required.', 'error'); return; }
    const row = { name: form.name.trim(), channel: form.channel, category: form.category.trim() || null, subject: form.channel === 'text' ? null : (form.subject.trim() || null), body: form.body, updated_at: new Date().toISOString() };
    if (editing === 'new') {
      const { data, error } = await supabase.from('message_templates').insert({ ...row, user_id: userId }).select().single();
      if (error) { notify(error.message, 'error'); return; }
      setTemplates(prev => [...prev, data]);
    } else {
      const { data, error } = await supabase.from('message_templates').update(row).eq('id', editing).select().single();
      if (error) { notify(error.message, 'error'); return; }
      setTemplates(prev => prev.map(t => t.id === editing ? data : t));
    }
    setEditing(null); setForm(blank);
  }
  async function remove(t) {
    await supabase.from('message_templates').delete().eq('id', t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1300 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '94%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="clipboard" size={15} /> Message templates</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px' }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input className="form-input" placeholder="Template name (e.g. Post-showing thank you)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ margin: 0, fontSize: '13px', padding: '8px 10px' }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <select className="form-select" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} style={{ margin: 0, fontSize: '12px', padding: '7px', flex: 1 }}>
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                  <option value="any">Either</option>
                </select>
                <input className="form-input" placeholder="Category (optional)" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ margin: 0, fontSize: '12px', padding: '7px', flex: 1 }} />
              </div>
              {form.channel !== 'text' && (
                <input className="form-input" placeholder="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} style={{ margin: 0, fontSize: '13px', padding: '8px 10px', fontWeight: 600 }} />
              )}
              <textarea ref={bodyRef} className="form-textarea" placeholder="Body — use merge fields like {{first_name}}" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} style={{ margin: 0, minHeight: '160px', fontSize: '13px', padding: '10px', lineHeight: 1.5 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-3)', alignSelf: 'center' }}>Insert:</span>
                {MERGE_FIELDS.map(f => (
                  <button key={f.token} onClick={() => insertToken(f.token)} title={f.label} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--accent)', cursor: 'pointer' }}>{`{{${f.token}}}`}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button className="btn btn-primary btn-sm" onClick={save}>Save template</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" onClick={startNew} style={{ marginBottom: '12px' }}>＋ New template</button>
              {templates.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-3)', padding: '12px 0' }}>No templates yet. Create one to reuse your common outreach.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {templates.map(t => (
                    <div key={t.id} style={{ padding: '9px 11px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)' }}>{t.name} <span style={{ fontSize: '10px', color: 'var(--text-3)', fontWeight: 400 }}>· {t.channel}{t.category ? ' · ' + t.category : ''}</span></div>
                        <div style={{ fontSize: '11px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject ? t.subject + ' — ' : ''}{t.body}</div>
                      </div>
                      {onPick && <button className="btn btn-ghost btn-sm" onClick={() => onPick(t)} title="Use this template" style={{ fontSize: '11px' }}>Use</button>}
                      <button onClick={() => startEdit(t)} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '12px' }}><Icon name="edit" size={13} /></button>
                      <button onClick={() => remove(t)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '12px' }}><Icon name="trash" size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
