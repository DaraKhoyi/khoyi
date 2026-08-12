// CustomFieldsPanel (+ CustomFieldRow, AddCustomFieldModal) — user-defined
// custom fields on a contact. Extracted from App.js (ContactDetailModal child).
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { confirmDialog } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import SingleContactPicker from './SingleContactPicker';
import MultiContactPicker from './MultiContactPicker';


// custom-field group config + value helpers (used only here)
const CUSTOM_FIELDS_GROUP_META = {
  family:           { label: 'Family',                  iconName: 'users' },
  milestones:       { label: 'Birthdays & anniversaries', iconName: 'cake' },
  relationship:     { label: 'Relationship & cadence',  iconName: 'heart' },
  communication:    { label: 'Communication & DISC',    iconName: 'message' },
  real_estate_pros: { label: 'Real-estate pros',        iconName: 'briefcase' },
  home:             { label: 'Current home',            iconName: 'home' },
  buyer:            { label: 'Buyer pipeline',          iconName: 'cart' },
  seller:           { label: 'Seller pipeline',         iconName: 'tag' },
  investor:         { label: 'Investor profile',        iconName: 'chart' },
  lifestyle:        { label: 'Lifestyle & interests',   iconName: 'target' },
  source_context:   { label: 'Source & life context',   iconName: 'compass' },
  custom:           { label: 'My custom fields',        iconName: 'star' },
};
const CUSTOM_FIELDS_GROUP_ORDER = [
  'communication', 'relationship', 'milestones', 'family',
  'real_estate_pros', 'home', 'buyer', 'seller', 'investor',
  'lifestyle', 'source_context', 'custom',
];
function hasValue(v, type) {
  if (!v) return false;
  if (type === 'boolean') return v.value_boolean === true || v.value_boolean === false;
  if (type === 'number' || type === 'currency') return v.value_number !== null && v.value_number !== undefined;
  if (type === 'date') return !!v.value_date;
  if (type === 'multiselect' || type === 'contact_ref_multi') {
    return Array.isArray(v.value_json) && v.value_json.length > 0;
  }
  if (type === 'contact_ref' || type === 'property_ref' || type === 'lead_gen_system_ref') {
    return !!v.value_ref_id;
  }
  return !!v.value_text;
}
function readValue(v, type) {
  if (!v) return '';
  switch (type) {
    case 'long_text': case 'text': case 'url': case 'phone': case 'email': case 'dropdown':
      return v.value_text || '';
    case 'number': case 'currency':
      return v.value_number ?? '';
    case 'date':
      return v.value_date || '';
    case 'boolean':
      return v.value_boolean === null || v.value_boolean === undefined ? '' : v.value_boolean;
    case 'multiselect': case 'contact_ref_multi':
      return Array.isArray(v.value_json) ? v.value_json : [];
    case 'contact_ref': case 'property_ref': case 'lead_gen_system_ref':
      return v.value_ref_id || '';
    default:
      return v.value_text || '';
  }
}

export default function CustomFieldsPanel({ userId, contact, contacts = [], setContacts }) {
  const [definitions, setDefinitions] = useState([]);
  const [values, setValues] = useState({});  // keyed by field_definition_id
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);  // key to flash green
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [showAddField, setShowAddField] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: defs }, { data: vals }, { data: sysList }] = await Promise.all([
        supabase.from('custom_field_definitions')
          .select('*').eq('user_id', userId).eq('scope', 'contact').eq('is_archived', false)
          .order('group_name').order('sort_order'),
        supabase.from('contact_field_values')
          .select('*').eq('contact_id', contact.id),
        supabase.from('lead_gen_systems')
          .select('id,name,color,is_overhead').eq('user_id', userId).eq('is_active', true).order('name'),
      ]);
      if (cancelled) return;
      setDefinitions(defs || []);
      const vMap = {};
      (vals || []).forEach(v => { vMap[v.field_definition_id] = v; });
      setValues(vMap);
      setSystems(sysList || []);
      // Default-collapse groups that have NO populated values; expand the rest.
      const populatedGroups = new Set();
      (defs || []).forEach(d => {
        const v = vMap[d.id];
        if (hasValue(v, d.field_type)) populatedGroups.add(d.group_name);
      });
      const collapsed = {};
      (defs || []).forEach(d => {
        if (!populatedGroups.has(d.group_name)) collapsed[d.group_name] = true;
      });
      setCollapsedGroups(collapsed);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, contact.id]);

  // Group definitions
  const grouped = useMemo(() => {
    const g = {};
    definitions.forEach(d => {
      if (!g[d.group_name]) g[d.group_name] = [];
      g[d.group_name].push(d);
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order));
    // Sort groups by canonical order, with unknown groups at end
    const ordered = [];
    CUSTOM_FIELDS_GROUP_ORDER.forEach(k => { if (g[k]) ordered.push([k, g[k]]); });
    Object.keys(g).forEach(k => {
      if (!CUSTOM_FIELDS_GROUP_ORDER.includes(k)) ordered.push([k, g[k]]);
    });
    return ordered;
  }, [definitions]);

  // Save a single field value (upsert) — fields are autosaved on blur/change.
  async function saveValue(def, raw) {
    setSavingKey(def.id);
    // Build the right column from raw based on type
    const payload = {
      user_id: userId,
      contact_id: contact.id,
      field_definition_id: def.id,
      value_text: null, value_number: null, value_date: null,
      value_boolean: null, value_ref_id: null, value_json: null,
    };
    const isEmpty = raw === '' || raw === null || raw === undefined;
    if (isEmpty) {
      // Clear: delete the value row entirely (so emptiness is the absence)
      await supabase.from('contact_field_values')
        .delete().eq('contact_id', contact.id).eq('field_definition_id', def.id);
      setValues(prev => { const c = { ...prev }; delete c[def.id]; return c; });
      setSavingKey(null);
      setSavedFlash(def.id); setTimeout(() => setSavedFlash(null), 700);
      return;
    }
    switch (def.field_type) {
      case 'text': case 'long_text': case 'url': case 'phone': case 'email':
        payload.value_text = String(raw); break;
      case 'number': case 'currency':
        payload.value_number = Number(raw); break;
      case 'date':
        payload.value_date = String(raw); break;
      case 'boolean':
        payload.value_boolean = !!raw; break;
      case 'dropdown':
        payload.value_text = String(raw); break;
      case 'multiselect':
        payload.value_json = Array.isArray(raw) ? raw : [];
        if (payload.value_json.length === 0) {
          // Empty multiselect: clear
          await supabase.from('contact_field_values')
            .delete().eq('contact_id', contact.id).eq('field_definition_id', def.id);
          setValues(prev => { const c = { ...prev }; delete c[def.id]; return c; });
          setSavingKey(null); setSavedFlash(def.id); setTimeout(() => setSavedFlash(null), 700);
          return;
        }
        break;
      case 'contact_ref': case 'property_ref': case 'lead_gen_system_ref':
        payload.value_ref_id = String(raw); break;
      case 'contact_ref_multi':
        payload.value_json = Array.isArray(raw) ? raw : []; break;
      default:
        payload.value_text = String(raw);
    }
    const { data, error } = await supabase
      .from('contact_field_values')
      .upsert(payload, { onConflict: 'contact_id,field_definition_id' })
      .select().single();
    setSavingKey(null);
    if (error) {
      if (window.__notify) window.__notify('Could not save: ' + error.message, 'error');
      return;
    }
    setValues(prev => ({ ...prev, [def.id]: data }));
    setSavedFlash(def.id); setTimeout(() => setSavedFlash(null), 700);
  }

  function toggleGroup(g) {
    setCollapsedGroups(prev => ({ ...prev, [g]: !prev[g] }));
  }

  async function deleteUserField(def) {
    if (def.is_system_locked) return;
    if (!await confirmDialog(`Delete the "${def.label}" field? Existing data for this field will be lost across all contacts.`)) return;
    // Soft-archive the definition; cascade values via FK.
    await supabase.from('custom_field_definitions').update({ is_archived: true }).eq('id', def.id);
    setDefinitions(prev => prev.filter(d => d.id !== def.id));
    setValues(prev => { const c = { ...prev }; delete c[def.id]; return c; });
  }

  if (loading) {
    return <div style={{padding:'12px',color:'var(--text-3)',fontSize:'12px'}}>Loading fields…</div>;
  }

  return (
    <div style={{marginTop:'8px',display:'flex',flexDirection:'column',gap:'4px'}}>
      {grouped.map(([groupName, fields]) => {
        const meta = CUSTOM_FIELDS_GROUP_META[groupName] || { label: groupName, iconName: 'folder' };
        const isCollapsed = !!collapsedGroups[groupName];
        const populatedCount = fields.filter(d => hasValue(values[d.id], d.field_type)).length;
        return (
          <div key={groupName} style={{background:'var(--bg-card)',borderRadius:'8px',border:'1px solid var(--border)',overflow:'hidden'}}>
            <button type="button" onClick={() => toggleGroup(groupName)}
              style={{
                width:'100%', padding:'10px 12px', background:'transparent', border:'none',
                color:'var(--text-1)', cursor:'pointer', display:'flex',
                alignItems:'center', justifyContent:'space-between', gap:'8px',
              }}>
              <span style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px',fontWeight:700}}>
                <span style={{display:'inline-flex',alignItems:'center'}}><Icon name={meta.iconName} size={16} /></span>
                <span>{meta.label}</span>
                {populatedCount > 0 && <span style={{padding:'1px 6px',background:'rgba(197,169,94,0.18)',color:'var(--accent)',borderRadius:'10px',fontSize:'9px',fontWeight:700}}>{populatedCount}</span>}
              </span>
              <span style={{color:'var(--text-3)',fontSize:'11px'}}>{isCollapsed ? '▶' : '▼'}</span>
            </button>
            {!isCollapsed && (
              <div style={{padding:'4px 12px 12px',display:'flex',flexDirection:'column',gap:'8px'}}>
                {fields.map(def => (
                  <CustomFieldRow
                    key={def.id} def={def}
                    value={values[def.id]}
                    contacts={contacts}
                    setContacts={setContacts}
                    currentContactId={contact.id}
                    userId={userId}
                    systems={systems}
                    saving={savingKey === def.id}
                    flash={savedFlash === def.id}
                    onSave={(raw) => saveValue(def, raw)}
                    onDelete={() => deleteUserField(def)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setShowAddField(true)}
        style={{
          marginTop:'4px', padding:'10px 12px', background:'var(--bg-card)',
          border:'1px dashed var(--border)', borderRadius:'8px',
          color:'var(--text-3)', cursor:'pointer', fontSize:'12px', fontWeight:600,
        }}>
        + Add a custom field
      </button>
      {showAddField && (
        <AddCustomFieldModal
          userId={userId}
          existingKeys={new Set(definitions.map(d => d.field_key))}
          onClose={() => setShowAddField(false)}
          onCreated={(newDef) => {
            setDefinitions(prev => [...prev, newDef]);
            setShowAddField(false);
            // Auto-expand the "custom" group so the new field is visible
            setCollapsedGroups(prev => ({ ...prev, [newDef.group_name]: false }));
          }}
        />
      )}
    </div>
  );
}

function CustomFieldRow({ def, value, contacts, setContacts, currentContactId, userId, systems, saving, flash, onSave, onDelete }) {
  // Local state mirrors the saved value so editing is smooth without round-tripping on each keystroke.
  const initial = useMemo(() => readValue(value, def.field_type), [value, def.field_type]);
  const [local, setLocal] = useState(initial);
  useEffect(() => { setLocal(initial); }, [initial]);

  function commit(val) {
    // Only fire a save if value actually changed
    const before = JSON.stringify(initial ?? null);
    const after = JSON.stringify(val ?? null);
    if (before === after) return;
    onSave(val);
  }

  const inputBase = {
    width: '100%', padding: '7px 9px',
    background: 'var(--bg-base)', color: 'var(--text-1)',
    border: `1px solid ${flash ? 'var(--green)' : 'var(--border)'}`,
    borderRadius: '6px', fontSize: '12.5px',
    transition: 'border-color .25s ease',
  };

  let editor;
  switch (def.field_type) {
    case 'long_text':
      editor = (
        <textarea value={local || ''} onChange={e => setLocal(e.target.value)}
          onBlur={() => commit(local)} rows={3}
          style={{...inputBase, fontFamily:'inherit', resize:'vertical'}}
          placeholder={def.placeholder || ''}/>
      ); break;
    case 'number':
      editor = (
        <input type="number" step="any" value={local ?? ''} onChange={e => setLocal(e.target.value)}
          onBlur={() => commit(local === '' ? null : Number(local))}
          style={inputBase} placeholder={def.placeholder || ''}/>
      ); break;
    case 'currency':
      editor = (
        <div style={{position:'relative'}}>
          <span style={{position:'absolute',left:'9px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'12px',pointerEvents:'none'}}>$</span>
          <input type="number" step="0.01" value={local ?? ''} onChange={e => setLocal(e.target.value)}
            onBlur={() => commit(local === '' ? null : Number(local))}
            style={{...inputBase, paddingLeft:'20px'}} placeholder={def.placeholder || '0.00'}/>
        </div>
      ); break;
    case 'date':
      editor = (
        <input type="date" value={local || ''}
          onChange={e => { setLocal(e.target.value); commit(e.target.value || null); }}
          style={inputBase}/>
      ); break;
    case 'boolean':
      editor = (
        <div style={{display:'flex',gap:'4px',background:'var(--bg-base)',padding:'2px',borderRadius:'6px',border:'1px solid var(--border)'}}>
          {[['', '—'], [true, 'Yes'], [false, 'No']].map(([v, lbl]) => (
            <button key={String(v)} type="button"
              onClick={() => { setLocal(v); commit(v === '' ? null : v); }}
              style={{
                flex:1, padding:'5px', border:'none', borderRadius:'4px', cursor:'pointer',
                fontSize:'11px', fontWeight:700,
                background: local === v ? (v === true ? 'var(--green)' : v === false ? 'var(--red)' : 'var(--bg-hover)') : 'transparent',
                color: local === v ? '#fff' : 'var(--text-3)',
              }}>{lbl}</button>
          ))}
        </div>
      ); break;
    case 'dropdown': {
      const opts = Array.isArray(def.options) ? def.options : [];
      editor = (
        <select value={local || ''}
          onChange={e => { setLocal(e.target.value); commit(e.target.value || null); }}
          style={inputBase}>
          <option value="">— Not set —</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ); break;
    }
    case 'multiselect': {
      // Render as a button row that toggles each option in/out of value_json
      const opts = Array.isArray(def.options) ? def.options : [];
      const selected = Array.isArray(local) ? local : [];
      editor = (
        <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
          {opts.map(o => {
            const on = selected.includes(o);
            return (
              <button key={o} type="button"
                onClick={() => {
                  const next = on ? selected.filter(x => x !== o) : [...selected, o];
                  setLocal(next); commit(next);
                }}
                style={{
                  padding:'4px 9px', borderRadius:'999px',
                  border:`1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? 'var(--bg-base)' : 'var(--text-2)',
                  cursor:'pointer', fontSize:'11px', fontWeight:600,
                }}>{o}</button>
            );
          })}
        </div>
      ); break;
    }
    case 'contact_ref': {
      // Map the field's group to a sensible default contact type for newly-
      // created contacts. Family-group ref fields create family members;
      // real-estate-pro fields create vendors; everything else falls back
      // to 'other'. The user can edit the type later on the contact record.
      let defaultNewType = 'other';
      if (def.group_name === 'family') defaultNewType = 'family';
      else if (def.group_name === 'real_estate_pros') defaultNewType = 'vendor';
      else if (def.group_name === 'buyer' || def.group_name === 'seller') defaultNewType = 'vendor';
      editor = (
        <SingleContactPicker
          value={local || null}
          onChange={(id) => { setLocal(id || ''); commit(id || null); }}
          contacts={contacts || []}
          setContacts={setContacts}
          currentContactId={currentContactId}
          userId={userId}
          refFilter={def.ref_filter || null}
          placeholder={def.placeholder || 'Search contacts…'}
          defaultNewContactType={defaultNewType}
        />
      ); break;
    }
    case 'lead_gen_system_ref': {
      const refId = local || '';
      editor = (
        <select value={refId}
          onChange={e => { setLocal(e.target.value); commit(e.target.value || null); }}
          style={inputBase}>
          <option value="">— Not set —</option>
          {systems.map(s => (
            <option key={s.id} value={s.id}>{s.name}{s.is_overhead ? ' (overhead)' : ''}</option>
          ))}
        </select>
      ); break;
    }
    case 'contact_ref_multi': {
      // Multi-contact picker: chips for already-linked contacts, type-ahead
      // search with create-on-the-fly. Used for "Children", "Parents", and
      // any user-added multi-contact custom field.
      const arr = Array.isArray(local) ? local : [];
      editor = (
        <MultiContactPicker
          value={arr}
          onChange={(next) => { setLocal(next); commit(next); }}
          contacts={contacts || []}
          setContacts={setContacts}
          currentContactId={currentContactId}
          userId={userId}
          placeholder={def.placeholder || 'Type a name…'}
          // Heuristic: family-group fields default new contacts to type='family'.
          defaultNewContactType={def.group_name === 'family' ? 'family' : 'other'}
        />
      ); break;
    }
    default:
      editor = (
        <input type={def.field_type === 'email' ? 'email' : def.field_type === 'url' ? 'url' : def.field_type === 'phone' ? 'tel' : 'text'}
          value={local || ''} onChange={e => setLocal(e.target.value)}
          onBlur={() => commit(local === '' ? null : local)}
          style={inputBase} placeholder={def.placeholder || ''}/>
      );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
        <label style={{fontSize:'10.5px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.04em',fontWeight:700,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {def.label}
        </label>
        {saving && <span style={{fontSize:'9px',color:'var(--text-3)'}}>↻</span>}
        {flash && <span style={{fontSize:'9px',color:'var(--green)'}}>✓ saved</span>}
        {!def.is_system_locked && (
          <button type="button" onClick={onDelete} title="Delete this custom field" aria-label="Delete custom field"
            style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'11px',padding:'0 4px'}}>×</button>
        )}
      </div>
      {editor}
      {def.help_text && <div style={{fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',lineHeight:1.3}}>{def.help_text}</div>}
    </div>
  );
}

function AddCustomFieldModal({ userId, existingKeys, onClose, onCreated }) {
  useBackClose(onClose);
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [optionsText, setOptionsText] = useState('');  // newline-separated for dropdowns/multiselects
  const [placeholder, setPlaceholder] = useState('');
  const [helpText, setHelpText] = useState('');
  const [saving, setSaving] = useState(false);

  // Auto-derive the field_key from the label
  const key = useMemo(() => {
    let k = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!k) return '';
    // De-conflict against existing keys
    let candidate = k, n = 2;
    while (existingKeys.has(candidate)) { candidate = `${k}_${n}`; n++; }
    return candidate;
  }, [label, existingKeys]);

  const needsOptions = (fieldType === 'dropdown' || fieldType === 'multiselect');

  async function handleSave() {
    if (!label.trim()) {
      if (window.__notify) window.__notify('Enter a label first.', 'error');
      return;
    }
    if (needsOptions && optionsText.trim().split(/\n+/).filter(Boolean).length === 0) {
      if (window.__notify) window.__notify('Add at least one option (one per line).', 'error');
      return;
    }
    setSaving(true);
    const options = needsOptions ? optionsText.split(/\n+/).map(s => s.trim()).filter(Boolean) : null;
    const { data, error } = await supabase
      .from('custom_field_definitions')
      .insert({
        user_id: userId, scope: 'contact',
        field_key: key, label: label.trim(), field_type: fieldType,
        options, placeholder: placeholder.trim() || null, help_text: helpText.trim() || null,
        group_name: 'custom', sort_order: 9000,
        is_prism_standard: false, is_system_locked: false,
      })
      .select().single();
    setSaving(false);
    if (error) {
      if (window.__notify) window.__notify('Could not create field: ' + error.message, 'error');
      return;
    }
    onCreated(data);
  }

  const fieldTypeOptions = [
    ['text',                 'Short text'],
    ['long_text',            'Long text (multi-line)'],
    ['number',               'Number'],
    ['currency',             'Currency ($)'],
    ['date',                 'Date'],
    ['boolean',              'Yes / No'],
    ['dropdown',             'Single-choice dropdown'],
    ['multiselect',          'Multi-choice tags'],
    ['contact_ref',          'Link to another contact'],
    ['lead_gen_system_ref',  'Link to a lead-gen system'],
    ['url',                  'URL'],
    ['phone',                'Phone'],
    ['email',                'Email'],
  ];

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{zIndex: 1200}}>
      <div className="modal" style={{maxWidth:'420px'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3 style={{margin:0,fontSize:'14px'}}>+ New custom field</h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'18px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>
        <div className="form-group">
          <label className="form-label">Label</label>
          <input className="form-input" type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Spouse's birthday, Coffee preference, Pool installer" autoFocus/>
          {key && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>Key: <code>{key}</code></div>}
        </div>
        <div className="form-group">
          <label className="form-label">Field type</label>
          <select className="form-input" value={fieldType} onChange={e => setFieldType(e.target.value)}>
            {fieldTypeOptions.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
          </select>
        </div>
        {needsOptions && (
          <div className="form-group">
            <label className="form-label">Options (one per line)</label>
            <textarea className="form-input" value={optionsText} onChange={e => setOptionsText(e.target.value)}
              rows={4} placeholder={'Option 1\nOption 2\nOption 3'}
              style={{fontFamily:'inherit',resize:'vertical'}}/>
          </div>
        )}
        <div className="form-row">
          <div className="form-group" style={{flex:1}}>
            <label className="form-label">Placeholder (optional)</label>
            <input className="form-input" type="text" value={placeholder} onChange={e => setPlaceholder(e.target.value)}
              placeholder="Hint shown in the empty input"/>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Help text (optional)</label>
          <input className="form-input" type="text" value={helpText} onChange={e => setHelpText(e.target.value)}
            placeholder="Small note shown under the field"/>
        </div>
        <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'12px'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? 'Creating…' : '+ Create field'}
          </button>
        </div>
      </div>
    </div>
  );
}
