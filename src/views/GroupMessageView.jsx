import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BulkDiscComposer, dominantDiscLetter } from './BulkDiscComposer';

const GOLD = '#C5A95E';
const DISC_COLOR = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6', '—': '#6b7280' };
const DISC_WORD = { D: 'Driver — direct & results-first', I: 'Influencer — warm & upbeat', S: 'Steady — patient & personal', C: 'Conscientious — precise & factual', '—': 'No DISC read yet' };

function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }

export default function GroupMessageView({ contacts = [], profiles = [], userId }) {
  const [channel, setChannel] = useState('email');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [composing, setComposing] = useState(false);
  const searchRef = useRef(null);

  const profileByContact = useMemo(() => { const m = {}; profiles.forEach(p => { if (p.contact_id) m[p.contact_id] = p; }); return m; }, [profiles]);
  const discOf = (c) => { const p = profileByContact[c.id]; const l = p ? dominantDiscLetter(p) : null; return l || '—'; };
  const discFull = (c) => { const p = profileByContact[c.id]; if (!p) return '—'; const a = p.baseline_primary || p.primary_letter; const b = p.baseline_secondary || p.secondary_letter; return a ? (b && b !== a ? `${a}/${b}` : a) : '—'; };
  const reachable = (c) => channel === 'email' ? !!c.email : !!c.phone;

  // Dropping selections that can't be reached on the newly-chosen channel.
  useEffect(() => { setSelected(sel => sel.filter(id => { const c = contacts.find(x => x.id === id); return c && (channel === 'email' ? !!c.email : !!c.phone); })); }, [channel]); // eslint-disable-line

  const q = search.trim().toLowerCase();
  const list = useMemo(() => {
    let arr = contacts.filter(reachable);
    if (q) arr = arr.filter(c => (c.name || '').toLowerCase().includes(q));
    return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [contacts, q, channel]); // eslint-disable-line

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectedContacts = useMemo(() => selected.map(id => contacts.find(c => c.id === id)).filter(Boolean), [selected, contacts]);
  const allFilteredSelected = list.length > 0 && list.every(c => selectedSet.has(c.id));
  const toggleAllFiltered = () => { if (allFilteredSelected) { const ids = new Set(list.map(c => c.id)); setSelected(s => s.filter(id => !ids.has(id))); } else { setSelected(s => Array.from(new Set([...s, ...list.map(c => c.id)]))); } };

  // Behavioral spread across the current selection — the "why this is smart" strip.
  const spread = useMemo(() => { const t = { D: 0, I: 0, S: 0, C: 0, '—': 0 }; selectedContacts.forEach(c => { t[discOf(c)] = (t[discOf(c)] || 0) + 1; }); return t; }, [selectedContacts]); // eslint-disable-line

  const seg = (val, label, icon) => (
    <button onClick={() => setChannel(val)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, letterSpacing: '.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all .15s', background: channel === val ? GOLD : 'transparent', color: channel === val ? '#0d0f14' : 'var(--text-2)' }}>
      <span style={{ fontSize: 15 }}>{icon}</span>{label}
    </button>
  );

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', paddingBottom: 96 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}><span>✨</span> Group message</h2>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>Pick a group. Write your message once. Each person receives a version tuned to their behavioral style — in your voice, with their name.</div>
      </div>

      {/* Channel */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 13, marginBottom: 16 }}>
        {seg('email', 'Email', '✉️')}
        {seg('text', 'Text', '💬')}
      </div>

      {/* Selected chips */}
      {selectedContacts.length > 0 && (
        <div style={{ background: 'linear-gradient(180deg, rgba(197,169,94,.08), rgba(197,169,94,.02))', border: `1px solid ${GOLD}55`, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: GOLD, letterSpacing: '.02em' }}>{selectedContacts.length} selected</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {['D', 'I', 'S', 'C', '—'].filter(k => spread[k]).map(k => (
                <span key={k} title={DISC_WORD[k]} style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6, color: '#fff', background: DISC_COLOR[k] }}>{k === '—' ? '?' : k} {spread[k]}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selectedContacts.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12.5 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: DISC_COLOR[discOf(c)], color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{discFull(c) === '—' ? initials(c.name) : discFull(c)}</span>
                <span style={{ color: 'var(--text-1)' }}>{(c.name || '').split(/\s+/)[0]}</span>
                <button onClick={() => toggle(c.id)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
              </span>
            ))}
            <button onClick={() => setSelected([])} style={{ fontSize: 11.5, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>Clear all</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14 }}>🔍</span>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name to find & add…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 36px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontSize: 14 }} />
      </div>

      {/* Select-all row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 4px 8px' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{list.length} {channel === 'email' ? 'with email' : 'with a number'}{q ? ` matching “${search}”` : ''}</span>
        {list.length > 0 && <button onClick={toggleAllFiltered} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: GOLD, background: 'none', border: 'none', cursor: 'pointer' }}>{allFilteredSelected ? 'Deselect these' : `Select all ${q ? 'matches' : ''}`.trim()}</button>}
      </div>

      {/* Scrollable contact list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'hidden', background: 'var(--bg-card)', maxHeight: '52vh', overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ padding: 26, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No contacts {channel === 'email' ? 'with an email' : 'with a phone number'}{q ? ' match that' : ''}.</div>}
        {list.map((c, i) => {
          const on = selectedSet.has(c.id);
          const d = discOf(c);
          return (
            <div key={c.id} onClick={() => toggle(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: on ? 'rgba(197,169,94,.10)' : 'transparent', transition: 'background .12s' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? GOLD : 'var(--border-strong, #333)'}`, background: on ? GOLD : 'transparent', color: '#0d0f14', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 }}>{on ? '✓' : ''}</span>
              <span style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-hover)', color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{initials(c.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel === 'email' ? c.email : c.phone}</div>
              </div>
              <span title={DISC_WORD[d]} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 7, color: d === '—' ? 'var(--text-3)' : '#fff', background: d === '—' ? 'transparent' : DISC_COLOR[d], border: d === '—' ? '1px solid var(--border)' : 'none' }}>{discFull(c)}</span>
            </div>
          );
        })}
      </div>

      {/* Sticky action bar */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'linear-gradient(180deg, transparent, var(--bg-base) 34%)', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 40 }}>
        <button disabled={selectedContacts.length === 0} onClick={() => setComposing(true)}
          style={{ pointerEvents: 'auto', maxWidth: 780, width: '100%', padding: '14px', borderRadius: 13, border: 'none', cursor: selectedContacts.length ? 'pointer' : 'default', fontSize: 15, fontWeight: 800, background: selectedContacts.length ? GOLD : 'var(--bg-card)', color: selectedContacts.length ? '#0d0f14' : 'var(--text-3)', boxShadow: selectedContacts.length ? '0 8px 26px -8px rgba(197,169,94,.6)' : 'none', transition: 'all .15s' }}>
          {selectedContacts.length ? `Draft ${channel === 'email' ? 'emails' : 'texts'} for ${selectedContacts.length} →` : 'Select people to message'}
        </button>
      </div>

      {composing && (
        <BulkDiscComposer contacts={selectedContacts} profileByContact={profileByContact} channel={channel} userId={userId}
          onClose={() => setComposing(false)} onSent={() => {}} />
      )}
    </div>
  );
}
