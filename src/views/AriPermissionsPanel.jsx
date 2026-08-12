// AriPermissionsPanel — settings panel extracted from App.js (strangle).
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';

const ARI_PERMISSION_GROUPS = [
  { group: 'Tasks & productivity', items: [
    { key: 'next_actions', label: 'Answer “what do I do next?” (your real priority ranking)', kind: 'read' },
    { key: 'tasks_read', label: 'Read your tasks', kind: 'read' },
    { key: 'tasks_write', label: 'Create / edit / complete tasks', kind: 'write' },
    { key: 'calendar_read', label: 'Read calendar & availability', kind: 'read' },
    { key: 'calendar_write', label: 'Create calendar events', kind: 'write' },
    { key: 'prospecting_control', label: 'Start/stop timers & check off prospecting', kind: 'write' },
  ]},
  { group: 'CRM & communication', items: [
    { key: 'contacts_read', label: 'Read contacts', kind: 'read' },
    { key: 'contacts_write', label: 'Update contacts', kind: 'write' },
    { key: 'inbox_read', label: 'Read inbox / email threads', kind: 'read' },
    { key: 'email_send', label: 'Draft & send email', kind: 'write' },
    { key: 'recruiting', label: 'Recruiting pipeline (read + update stage)', kind: 'write' },
  ]},
  { group: 'Money & files', items: [
    { key: 'finance_read', label: 'Read finance (GCI, ROI, budgets, transactions)', kind: 'read' },
    { key: 'transactions_write', label: 'Write transactions', kind: 'write' },
    { key: 'portfolio_read', label: 'Files, Properties, Investments, Mileage', kind: 'read' },
  ]},
  { group: 'Knowledge & reach', items: [
    { key: 'knowledge_search', label: 'Search Brain / Notes / Playbooks', kind: 'read' },
    { key: 'journal', label: 'Read & append your Journal', kind: 'write' },
    { key: 'web_search', label: 'Web search', kind: 'read' },
    { key: 'memory', label: 'Long-term memory', kind: 'write' },
  ]},
];

export default function AriPermissionsPanel({ userId }) {
  const [robot, setRobot] = useState(null);
  const [perms, setPerms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('robots').select('id,name,permissions').eq('user_id', userId).order('created_at').limit(1);
      const r = data && data[0];
      setRobot(r || null);
      setPerms((r && r.permissions) || {});
      setLoading(false);
    })();
  }, [userId]);

  async function toggle(key) {
    if (!robot) return;
    const next = { ...perms, [key]: !perms[key] };
    setPerms(next);
    setSaving(true);
    await supabase.from('robots').update({ permissions: next }).eq('id', robot.id);
    setSaving(false);
  }
  async function setAll(val) {
    if (!robot) return;
    const next = {};
    ARI_PERMISSION_GROUPS.forEach(g => g.items.forEach(it => { next[it.key] = val; }));
    setPerms(next); setSaving(true);
    await supabase.from('robots').update({ permissions: next }).eq('id', robot.id);
    setSaving(false);
  }

  const grantedCount = Object.values(perms).filter(Boolean).length;
  const total = ARI_PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="panel" style={{ marginBottom: '18px' }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3>Ari Permissions</h3>
        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{saving ? 'Saving…' : `${grantedCount}/${total} granted`}</span>
      </div>
      <div className="panel-body">
        {loading ? (
          <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>Loading…</p>
        ) : !robot ? (
          <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>No assistant found.</p>
        ) : (
          <>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '0 0 6px', lineHeight: 1.5 }}>
              Control what {robot.name || 'Ari'} can do for you in chat. Everything is scoped to your account.
              <span style={{ color: 'var(--text-3)' }}> Actions that write data ask you to confirm before they run.</span>
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button onClick={() => setAll(true)} style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer' }}>Grant all</button>
              <button onClick={() => setAll(false)} style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer' }}>Revoke all</button>
            </div>
            {ARI_PERMISSION_GROUPS.map(g => (
              <div key={g.group} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 700, marginBottom: '8px' }}>{g.group}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {g.items.map(it => {
                    const on = !!perms[it.key];
                    return (
                      <div key={it.key} onClick={() => toggle(it.key)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', cursor: 'pointer' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 500 }}>{it.label}</div>
                          <div style={{ fontSize: '10px', color: it.kind === 'write' ? 'var(--yellow)' : 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '1px' }}>{it.kind === 'write' ? <><Icon name="edit" size={11} /> Can change data</> : <><Icon name="eye" size={11} /> Read-only</>}</div>
                        </div>
                        <div style={{ width: '42px', height: '24px', borderRadius: '999px', background: on ? 'var(--accent)' : 'var(--bg-hover)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
                          <div style={{ position: 'absolute', top: '2px', left: on ? '20px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: on ? 'var(--bg-base)' : 'var(--text-3)', transition: 'left 0.15s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '6px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>
              Changes apply to your next message to Ari. Write actions (email, transactions, contact edits, calendar, recruiting) are confirmed in chat before they happen.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
