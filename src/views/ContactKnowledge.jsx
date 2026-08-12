// ContactKnowledge — the AI knowledge/notes summary block on a contact.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';

export default function ContactKnowledge({ contactId }) {
  const [rows, setRows] = React.useState(null);
  React.useEffect(() => { let alive = true; (async () => { try { const { data } = await supabase.rpc('contact_knowledge', { p_contact_id: contactId }); if (alive) setRows(Array.isArray(data) ? data : []); } catch (_) { if (alive) setRows([]); } })(); return () => { alive = false; }; }, [contactId]);
  if (rows === null || rows.length === 0) return null;
  const facts = rows.filter(r => r.kind === 'fact');
  const sources = rows.filter(r => r.kind === 'source');
  return (
    <div className="panel" style={{ marginBottom: '12px', border: '1px solid var(--accent)' }}>
      <div className="panel-body">
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}><span>📚</span>What you know</div>
        {facts.map((fx, i) => (
          <div key={'f' + i} style={{ fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '3px' }}><span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{fx.label}:</span> {fx.detail}{fx.value_date ? <span style={{ color: 'var(--accent)' }}> ({fx.value_date})</span> : ''}</div>
        ))}
        {sources.length > 0 && <div style={{ marginTop: facts.length ? '8px' : 0, fontSize: '11px', color: 'var(--text-3)' }}>From: {sources.map(x => x.label).filter(Boolean).join(' · ')}</div>}
      </div>
    </div>
  );
}
