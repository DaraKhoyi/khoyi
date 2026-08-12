// SocialLinksPanel (+ SocialGlyph) — social profile links on a contact.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { notify } from '../notify';

// social platform config + handle->url (used only here)
const SOCIAL_PLATFORMS = [
  { key: 'linkedin',  label: 'LinkedIn',  icon: 'in', hint: 'profile URL or /in/handle', base: 'https://www.linkedin.com/in/' },
  { key: 'facebook',  label: 'Facebook',  icon: 'f',  hint: 'profile URL or username',    base: 'https://facebook.com/' },
  { key: 'instagram', label: 'Instagram', icon: 'ig', hint: '@handle',                    base: 'https://instagram.com/' },
  { key: 'tiktok',    label: 'TikTok',    icon: 'tt', hint: '@handle',                    base: 'https://tiktok.com/@' },
  { key: 'x',         label: 'X / Twitter', icon: 'x', hint: '@handle',                   base: 'https://x.com/' },
  { key: 'youtube',   label: 'YouTube',   icon: 'yt', hint: 'channel URL or @handle',     base: 'https://youtube.com/@' },
  { key: 'zillow',    label: 'Zillow',    icon: 'z',  hint: 'Zillow profile URL',         base: '' },
  { key: 'realtor_com', label: 'Realtor.com', icon: 'rc', hint: 'Realtor.com profile URL', base: '' },
  { key: 'google_business', label: 'Google Business', icon: 'gb', hint: 'Google Business Profile URL', base: '' },
  { key: 'website',   label: 'Website',   icon: 'w',  hint: 'https://…',                  base: '' },
];
function socialToUrl(platform, raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const p = SOCIAL_PLATFORMS.find(x => x.key === platform);
  const handle = v.replace(/^@/, '');
  if (platform === 'website') return 'https://' + v.replace(/^\/+/, '');
  return (p?.base || '') + handle;
}

function SocialGlyph({ icon }) {
  return (
    <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'lowercase' }}>{icon}</span>
  );
}

export default function SocialLinksPanel({ contact, contacts = [], setContacts }) {
  const [socials, setSocials] = useState(contact.socials || {});
  const [editing, setEditing] = useState(null);   // platform key being edited
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(platform, value) {
    setBusy(true);
    const next = { ...socials };
    const v = String(value || '').trim();
    if (v) next[platform] = v; else delete next[platform];
    const { error } = await supabase.from('contacts').update({ socials: next }).eq('id', contact.id);
    setBusy(false);
    if (error) { notify("Couldn't save that link.", 'error'); return; }
    setSocials(next);
    contact.socials = next;
    if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, socials: next } : c));
    setEditing(null); setDraft('');
  }

  const filled = SOCIAL_PLATFORMS.filter(p => socials[p.key]);
  const empty = SOCIAL_PLATFORMS.filter(p => !socials[p.key]);

  return (
    <div>
      {filled.length === 0 && editing === null && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>No social profiles yet. Add them — Prism uses them to research this person more accurately.</div>
      )}
      {filled.map(p => {
        const url = socialToUrl(p.key, socials[p.key]);
        const isEd = editing === p.key;
        return (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
            <SocialGlyph icon={p.icon} />
            {isEd ? (
              <>
                <input autoFocus className="form-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={p.hint}
                  onKeyDown={e => { if (e.key === 'Enter') save(p.key, draft); if (e.key === 'Escape') { setEditing(null); setDraft(''); } }}
                  style={{ flex: 1, margin: 0, padding: '5px 8px', fontSize: 12.5 }} />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(p.key, draft)}>Save</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{p.label}</div>
                  <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{socials[p.key]}</a>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(p.key); setDraft(socials[p.key]); }} style={{ fontSize: 11 }}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => save(p.key, '')} style={{ fontSize: 11, color: 'var(--text-3)' }}>✕</button>
              </>
            )}
          </div>
        );
      })}

      {empty.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {empty.map(p => (
            editing === p.key ? (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 0' }}>
                <SocialGlyph icon={p.icon} />
                <input autoFocus className="form-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={`${p.label} — ${p.hint}`}
                  onKeyDown={e => { if (e.key === 'Enter') save(p.key, draft); if (e.key === 'Escape') { setEditing(null); setDraft(''); } }}
                  style={{ flex: 1, margin: 0, padding: '5px 8px', fontSize: 12.5 }} />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(p.key, draft)}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setDraft(''); }}>✕</button>
              </div>
            ) : (
              <button key={p.key} onClick={() => { setEditing(p.key); setDraft(''); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 100, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}>
                + {p.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}
