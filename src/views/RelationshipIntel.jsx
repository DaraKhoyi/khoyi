// RelationshipIntel (+ RIChip/RISection/RIList/RIChips) — the AI relationship
// intelligence panel on a contact. Extracted from App.js (ContactDetailModal child).
import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../icons';

function RIChip({ children, tone }) {
  return <span style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '999px', border: `1px solid ${tone === 'gold' ? 'var(--accent-dim)' : 'var(--border)'}`, background: tone === 'gold' ? 'var(--accent-glow)' : 'var(--bg-card)', color: tone === 'gold' ? 'var(--accent)' : 'var(--text-2)' }}>{children}</span>;
}

function RISection({ label, children, hint }) {
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '6px' }}>{label}{hint ? <span style={{ color: 'var(--text-3)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}> · {hint}</span> : null}</div>
      {children}
    </div>
  );
}

function RIList({ items, num }) {
  // Coerce defensively: extraction can occasionally return a string where an
  // array is expected. A bare string becomes a single item; anything else that
  // isn't an array is dropped — never call .filter on a non-array (that throws).
  const arr = (Array.isArray(items) ? items : (typeof items === 'string' && items.trim() ? [items] : [])).filter(Boolean);
  if (!arr.length) return <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>—</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: num ? '20px' : '16px', display: 'flex', flexDirection: 'column', gap: '5px', listStyle: num ? 'decimal' : 'disc' }}>
      {arr.map((x, i) => <li key={i} style={{ fontSize: '12.5px', color: 'var(--text-1)', lineHeight: 1.45 }}>{typeof x === 'string' ? x : (x.detail || x.text || '')}</li>)}
    </ul>
  );
}

function RIChips({ items, tone }) {
  const arr = (Array.isArray(items) ? items : (typeof items === 'string' && items.trim() ? [items] : [])).filter(Boolean);
  if (!arr.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{arr.map((x, i) => <RIChip key={i} tone={tone}>{typeof x === 'string' ? x : (x.detail || '')}</RIChip>)}</div>;
}

export default function RelationshipIntel({ profile, onPurge, onConfirm }) {
  if (!profile || !profile.research_taken_at) return null;
  const p = profile.research_profile || {};
  const per = profile.research_personal || {};
  const plan = profile.research_connection_plan || {};
  const overlaps = profile.research_overlaps || [];
  const sources = profile.research_sources || [];
  const idc = profile.research_identity_confidence;
  const idcColor = idc === 'high' ? 'var(--green)' : idc === 'low' ? 'var(--red)' : 'var(--yellow)';
  const overlapIcon = { school: <Icon name="school" size={12} />, geography: <Icon name="pin" size={12} />, industry: <Icon name="building" size={12} />, interest: <Icon name="bulb" size={12} />, cause: <Icon name="heart" size={12} />, mutual_connection: <Icon name="users" size={12} /> };

  return (
    <div style={{ marginBottom: '14px', border: '1px solid var(--accent-dim)', borderRadius: '12px', overflow: 'hidden', background: 'linear-gradient(180deg, var(--accent-glow), transparent 120px)' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="brain" size={14} style={{verticalAlign:'-2px'}} /> Relationship Intelligence</div>
          {idc && <span style={{ fontSize: '10px', fontWeight: 700, color: idcColor, border: `1px solid ${idcColor}`, borderRadius: '999px', padding: '2px 8px' }}>identity: {idc}</span>}
        </div>
        {profile.research_headline && <div style={{ fontSize: '14px', color: 'var(--text-1)', marginTop: '8px', lineHeight: 1.4, fontWeight: 500 }}>{profile.research_headline}</div>}
        {idc === 'low' && <div style={{ fontSize: '11px', color: 'var(--yellow)', marginTop: '6px' }}>⚠ Identity match is uncertain — verify before relying on these details.</div>}
        {profile.research_needs_confirmation && (
          <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--yellow)', marginBottom: '3px' }}>⚠ Confirm this is the right person</div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-2)', lineHeight: 1.5 }}>
              The web match was only <b>{idc || 'medium'}</b> confidence, so this write-up hasn't been folded into the DISC read. Confirm it's them to fold it in, or purge it if it's the wrong person.
            </div>
            {onConfirm && (
              <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => onConfirm(profile.contact_id)}
                  style={{ background: 'var(--accent-2, #EBCB82)', border: 'none', color: '#1a1409', fontSize: '12px', fontWeight: 700, borderRadius: '8px', padding: '7px 14px', cursor: 'pointer' }}>
                  ✓ Yes, this is them
                </button>
                {onPurge && (
                  <button onClick={() => onPurge(profile.contact_id)}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '12px', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer' }}>
                    ✕ No, wrong person — purge
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {onPurge && !profile.research_needs_confirmation && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => onPurge(profile.contact_id)} title="Remove this research and DISC write-up from the profile (reversible)"
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '11px', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer' }}>
              Purge this research
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '4px 16px 16px' }}>
        {overlaps.length > 0 && (
          <RISection label={<><Icon name="link" size={11} /> You two have in common</>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {overlaps.map((o, i) => <div key={i} style={{ fontSize: '12.5px', color: 'var(--text-1)' }}>{overlapIcon[o.type] || '•'} {o.detail}</div>)}
            </div>
          </RISection>
        )}

        {plan.conversation_starters?.length > 0 && (
          <RISection label={<><Icon name="message" size={11} /> Conversation starters</>}>
            <RIList items={plan.conversation_starters} num />
          </RISection>
        )}

        {(plan.topics_lean_in?.length > 0 || plan.topics_avoid?.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '14px' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: '6px' }}>Lean into</div>
              <RIChips items={plan.topics_lean_in} />
            </div>
            {plan.topics_avoid?.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--yellow)', marginBottom: '6px' }}>Approach with care</div>
                <RIChips items={plan.topics_avoid} />
              </div>
            )}
          </div>
        )}

        {plan.add_value?.length > 0 && (
          <RISection label={<><Icon name="gift" size={11} /> How I can add value</>}>
            <RIList items={plan.add_value} />
          </RISection>
        )}

        {plan.follow_ups?.length > 0 && (
          <RISection label="↩ Thoughtful follow-ups">
            <RIList items={plan.follow_ups} />
          </RISection>
        )}

        {(per.hobbies?.length > 0 || per.family_context || per.geo_cultural_ties?.length > 0 || per.recurring_themes?.length > 0 || per.recent_excitement?.length > 0) && (
          <RISection label={<><Icon name="heart" size={11} /> Personal context</>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {per.hobbies?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Hobbies & passions: </span><RIChips items={per.hobbies} /></div>}
              {per.family_context && <div style={{ fontSize: '12.5px', color: 'var(--text-1)' }}><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Family (public): </span>{per.family_context}</div>}
              {per.geo_cultural_ties?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Ties: </span><RIChips items={per.geo_cultural_ties} /></div>}
              {per.recent_excitement?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Excited about lately: </span><RIList items={per.recent_excitement} /></div>}
              {per.recurring_themes?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Recurring themes: </span><RIChips items={per.recurring_themes} /></div>}
              {per.comms_preference && <div style={{ fontSize: '12px', color: 'var(--text-2)' }}><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Comms style: </span>{per.comms_preference}</div>}
            </div>
          </RISection>
        )}

        {(p.background_education || p.career || p.expertise?.length > 0 || p.community_media?.length > 0 || p.interests_values?.length > 0) && (
          <RISection label={<><Icon name="clipboard" size={11} /> Professional profile</>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {p.background_education && <div style={{ fontSize: '12.5px', color: 'var(--text-1)', lineHeight: 1.45 }}><b style={{ color: 'var(--text-2)' }}>Background: </b>{p.background_education}</div>}
              {p.career && <div style={{ fontSize: '12.5px', color: 'var(--text-1)', lineHeight: 1.45 }}><b style={{ color: 'var(--text-2)' }}>Career: </b>{p.career}</div>}
              {p.expertise?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Expertise: </span><RIChips items={p.expertise} /></div>}
              {p.interests_values?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Values & interests: </span><RIChips items={p.interests_values} /></div>}
              {p.community_media?.length > 0 && <div><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Community / media: </span><RIList items={p.community_media} /></div>}
            </div>
          </RISection>
        )}

        {sources.length > 0 && (
          <RISection label={<><Icon name="search" size={11} /> Sources</>} hint={`${sources.length} cited`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {sources.map((s, i) => s.url
                ? <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--accent)', border: '1px solid var(--accent-dim)', borderRadius: '999px', padding: '3px 9px', textDecoration: 'none' }}>{s.label || 'source'}{s.date ? ` · ${s.date}` : ''} ↗</a>
                : <RIChip key={i}>{s.label || 'source'}</RIChip>)}
            </div>
          </RISection>
        )}

        <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
          For relationship-building only — not a background check, and not for tenant/employment/credit screening.
        </div>
      </div>
    </div>
  );
}
