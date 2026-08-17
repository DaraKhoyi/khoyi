// TagsView — where the vocabulary is managed.
//
// Two sections, because the rules genuinely differ:
//   COMPANY tags — the brokerage's shared language. Everyone applies them; only
//     brokerage staff can rename or remove them. An agent sees them clearly
//     marked and read-only rather than discovering the restriction by being
//     refused after clicking.
//   YOUR tags — an agent's own. Rename and delete freely.
//
// DELETING SHOWS THE DAMAGE FIRST. A tag on 40 contacts disappears from all 40,
// so the confirm states the number. Silently stripping a tag people sort by is
// the kind of thing that gets noticed weeks later and never traced back.
//
// RENAMING CHANGES THE LABEL, NOT THE SLUG. Records store the slug, so a rename
// can never orphan them. Said out loud in the UI so nobody expects otherwise.
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { useTagVocabulary, slugify } from './TagInput';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';

export default function TagsView({ isAdmin }) {
  const { tags, loading, reload } = useTagVocabulary();
  const [newLabel, setNewLabel] = useState('');
  const [newCompany, setNewCompany] = useState(false);
  const [editing, setEditing] = useState(null);   // { id, label }
  const [busy, setBusy] = useState(false);

  const company = tags.filter(t => t.company);
  const mine = tags.filter(t => !t.company);
  const clash = mine.filter(m => company.some(c => c.slug === m.slug));

  const say = (msg, kind = 'info') => { if (window.__notify) window.__notify(msg, kind); };

  const create = async () => {
    const label = newLabel.trim();
    if (!label) return;
    if (tags.some(t => t.slug === slugify(label))) { say('That tag already exists.', 'error'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('tag_save', { p: { label, company: newCompany } });
    setBusy(false);
    if (error || (data && data.ok === false)) { say((data && data.error) || error.message, 'error'); return; }
    setNewLabel(''); setNewCompany(false); reload();
  };

  const rename = async () => {
    if (!editing || !editing.label.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('tag_save', { p: { id: editing.id, label: editing.label.trim() } });
    setBusy(false);
    if (error || (data && data.ok === false)) { say((data && data.error) || error.message, 'error'); return; }
    setEditing(null); reload();
  };

  const remove = async (t) => {
    // First call reports the usage count instead of acting on it.
    const probe = await supabase.rpc('tag_delete', { p_id: t.id });
    const d = probe.data;
    if (d && d.needs_confirm) {
      const ok = window.confirm(
        `"${d.label}" is on ${d.uses} contact${d.uses === 1 ? '' : 's'}.\n\n` +
        `Deleting it removes the tag from all of them. This cannot be undone.\n\nDelete anyway?`);
      if (!ok) return;
      const res = await supabase.rpc('tag_delete', { p_id: t.id, p_confirm_uses: d.uses });
      if (res.data && res.data.ok === false) { say(res.data.error, 'error'); return; }
      say(`Deleted "${d.label}" and removed it from ${d.uses} contact${d.uses === 1 ? '' : 's'}.`);
    } else if (d && d.ok === false) { say(d.error, 'error'); return; }
    reload();
  };

  const row = (t, editable) => (
    <div key={t.id || t.slug} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderBottom: '1px solid var(--border)' }}>
      {editing && editing.id === t.id ? (
        <>
          <input autoFocus value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }}
            style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-1)', padding: '7px 9px', fontSize: 14, fontFamily: 'inherit' }} />
          <button onClick={rename} disabled={busy} style={btn}>Save</button>
          <button onClick={() => setEditing(null)} style={ghost}>Cancel</button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 14.5, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 7 }}>
            {t.company && <span style={{ color: GOLD, fontSize: 10 }}>◆</span>}
            {t.label}
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              {t.uses > 0 ? `${t.uses} contact${t.uses === 1 ? '' : 's'}` : 'unused'}
            </span>
          </span>
          {editable ? (
            <>
              <button onClick={() => setEditing({ id: t.id, label: t.label })} style={ghost}>Rename</button>
              <button onClick={() => remove(t)} style={{ ...ghost, color: '#c98b8b', borderColor: 'rgba(201,139,139,.4)' }}>Delete</button>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>brokerage</span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="ww-tags" style={{ padding: '18px 16px 90px' }}>
      <style>{`.ww-tags{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em',
        fontSize: 11, fontWeight: 700, color: GOLD }}>Vocabulary</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>Tags.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.55 }}>
        Tags you apply on a contact. Renaming changes what you see — records keep working, because they store the tag itself, not its name.
      </div>

      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>New tag</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder="e.g. Farsi speaker"
            style={{ flex: '1 1 200px', minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 10, color: 'var(--text-1)', padding: '10px 11px', fontSize: 14, fontFamily: 'inherit' }} />
          <button onClick={create} disabled={busy || !newLabel.trim()} style={btn}>Add</button>
        </div>
        {isAdmin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={newCompany} onChange={e => setNewCompany(e.target.checked)} />
            Make this a company tag — every agent can use it, only the brokerage can change it
          </label>
        )}
      </div>

      {clash.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(203,163,92,.45)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: CHAMP }}>Duplicates of a company tag</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55 }}>
            You have your own version of {clash.map(c => `“${c.label}”`).join(', ')}. The brokerage's is used when you pick it, so yours is redundant — deleting it keeps things tidy without changing any contact.
          </div>
        </div>
      )}

      <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '18px 0 6px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
        Your tags {mine.length ? `(${mine.length})` : ''}
      </div>
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
          : mine.length ? mine.map(t => row(t, true))
          : <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>None yet — add one above, or type a new one straight onto a contact.</div>}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '20px 0 6px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
        Company tags {company.length ? `(${company.length})` : ''}
      </div>
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {company.length ? company.map(t => row(t, !!isAdmin))
          : <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>
              {isAdmin ? 'None yet. Tick “company tag” above to create one everybody can use.'
                       : 'The brokerage has not published any shared tags yet.'}
            </div>}
      </div>
    </div>
  );
}

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 11 };
const btn = { background: '#EBCB82', color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const ghost = { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' };
