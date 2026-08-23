// Onboarding + announcements — the first-run walkthrough, the announcement a user
// sees on login, and the broker's admin panel for authoring them.
// Extracted from App.js (strangle the monolith, step 25).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { modal } from '../helpers';

export function OnboardingModal({ userId, userEmail, onComplete, onClose, initial }) {
  const [displayName, setDisplayName] = useState(initial?.display_name || '');
  const [profession, setProfession] = useState(initial?.profession || '');
  const [timezone, setTimezone] = useState(() => {
    if (initial?.timezone) return initial.timezone;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
    catch (_) { return ''; }
  });
  const [assistantContext, setAssistantContext] = useState(initial?.assistant_context || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Block ESC dismissal on first-run; allow it to close when re-opened manually.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); if (onClose) onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) { setError('Please enter your name.'); return; }
    setSaving(true);
    const payload = {
      user_id: userId,
      display_name: displayName.trim(),
      profession: profession.trim() || null,
      timezone: timezone.trim() || null,
      assistant_context: assistantContext.trim() || null,
      onboarding_complete: true,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
    if (upErr) {
      setSaving(false);
      setError(upErr.message || 'Could not save. Please try again.');
      return;
    }
    // Also update the user's robot system prompt to include their context so
    // chat replies are personalized from message #1.
    if (assistantContext.trim() || profession.trim() || displayName.trim()) {
      try {
        const contextLine = [
          displayName.trim() ? `The user's name is ${displayName.trim()}.` : null,
          profession.trim() ? `Their role: ${profession.trim()}.` : null,
          assistantContext.trim() ? `About them: ${assistantContext.trim()}` : null,
        ].filter(Boolean).join(' ');
        const newPrompt = `You are Ari, a sharp, friendly personal AI assistant. ${contextLine} You help with tasks, decisions, scheduling, writing, and anything else they need. Be direct, warm, and genuinely useful. Keep responses concise unless depth is needed. You are always on their side.`;
        await supabase.from('robots').update({ system_prompt: newPrompt }).eq('user_id', userId);
      } catch (_) { /* non-fatal — base prompt still works */ }
    }
    setSaving(false);
    onComplete();
  }

  return (
    <div className="modal-overlay" style={{zIndex: 2000, padding: '16px'}}>
      <div className="modal" style={{maxWidth: '520px', width: '100%', maxHeight: '92vh', overflowY: 'auto'}}>
        <div className="modal-header" style={{borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px'}}>
          <div>
            <h2 style={{margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-1)'}}>Let's get you set up</h2>
            <p style={{margin: '4px 0 0', fontSize: '13px', color: 'var(--text-2)'}}>
              Just your name to start &mdash; everything else can wait. Next we'll connect your email and show you what's already waiting for you.
            </p>
          </div>
          {onClose && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close" style={{flexShrink: 0, fontSize: '16px', lineHeight: 1, padding: '4px 8px'}}>✕</button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Your name <span style={{color: 'var(--red)'}}>*</span></label>
            <input
              className="form-input"
              type="text"
              autoFocus
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="What should we call you?"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">What do you do?</label>
            <input
              className="form-input"
              type="text"
              value={profession}
              onChange={e => setProfession(e.target.value)}
              placeholder="e.g. Listing agent, Buyer's agent, Team lead, Broker"
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Helps your AI assistant calibrate what's important and what's urgent for you.
            </p>
            {/* Every person who reaches this screen works at a real estate brokerage.
                Offering "Doctor, Engineer, Designer" as examples told an agent the
                tool was bought off a shelf and not built for them — which is the
                opposite of true, and it was the second thing they ever read. */}
          </div>

          <div className="form-group">
            <label className="form-label">Timezone</label>
            <input
              className="form-input"
              type="text"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              placeholder="e.g. America/New_York"
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Auto-detected from your browser. Edit if it's wrong.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Tell your assistant about you</label>
            <textarea
              className="form-input"
              rows={5}
              value={assistantContext}
              onChange={e => setAssistantContext(e.target.value)}
              placeholder="A few sentences about your work, priorities, who you serve, what matters. Your AI assistant uses this to tailor every response."
              style={{resize: 'vertical', fontFamily: 'inherit', minHeight: '110px'}}
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Optional — but the more context, the better the assistance. You can edit this anytime in Settings.
            </p>
          </div>

          {error && (
            <div style={{padding: '10px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: '6px', color: 'var(--red)', fontSize: '13px', marginBottom: '12px'}}>
              {error}
            </div>
          )}

          <div className="modal-actions" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '16px', flexWrap: 'wrap'}}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                // Skip path — write the minimum so we don't show this modal again.
                // User can fill in profession / context later in Settings.
                if (saving) return;
                if (!displayName.trim()) {
                  setError('Just need your name first (one field) — then you can skip the rest.');
                  return;
                }
                setSaving(true);
                setError('');
                const { error: upErr } = await supabase.from('user_settings').upsert({
                  user_id: userId,
                  display_name: displayName.trim(),
                  onboarding_complete: true,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id' });
                setSaving(false);
                if (upErr) {
                  setError(upErr.message || 'Could not save. Please try again.');
                  return;
                }
                onComplete();
              }}
              style={{fontSize: '13.5px', color: 'var(--text-2)', textDecoration: 'underline'}}
              title="Save just your name and fill in the rest later in Settings">
              Finish this later
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Finish setup'}
            </button>
          </div>
        </form>

        <p style={{margin: '14px 0 0', fontSize: '11px', color: 'var(--text-3)', textAlign: 'center'}}>
          Signed in as {userEmail}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// CHAT VIEW
// ─────────────────────────────────────────


// Single message bubble — handles text, image, and optional receipt-CTA card.
// Split out so we can lazily resolve signed URLs without re-rendering all bubbles.


// ─────────────────────────────────────────
// EISENHOWER PRIORITY HELPERS
// ─────────────────────────────────────────
// A = Q1 Urgent & Important   B = Q2 Important, Not Urgent
// C = Q3 Urgent, Not Important D = Q4 Neither

// Priority dropdown that shows the user's chosen style: A/B/C for Eisenhower,
// High/Medium/Low otherwise. It stores/emits a simple priority (high/medium/low)
// either way, mapping A↔high, B↔medium, C↔low, so callers don't change.

export function AnnouncementModal({ userId }) {
  const [queue, setQueue] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try { const { data } = await supabase.rpc('my_unacked_announcements'); if (alive) setQueue(Array.isArray(data) ? data : []); }
      catch (_) { if (alive) setQueue([]); }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);
  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') e.preventDefault(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  if (!loaded || queue.length === 0) return null;
  const current = queue[0];
  const remaining = queue.length - 1;

  async function acknowledge() {
    if (!checked || busy) return;
    setBusy(true);
    try { await supabase.from('announcement_acks').insert({ announcement_id: current.id, user_id: userId }); } catch (_) {}
    setBusy(false); setChecked(false);
    setQueue(q => q.slice(1));
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 3000, padding: '16px' }}>
      <div className="modal" style={{ maxWidth: '480px', width: '100%', maxHeight: '92vh', overflowY: 'auto', borderTop: '3px solid var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px' }}>📣</span>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Announcement</span>
          {remaining > 0 && <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-3)' }}>{remaining} more after this</span>}
        </div>
        {current.title && <h2 style={{ margin: '4px 0 10px', fontSize: '19px', fontWeight: 700, color: 'var(--text-1)' }}>{current.title}</h2>}
        <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-wrap', marginBottom: '18px' }}>{current.body}</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', borderRadius: '10px', background: 'var(--bg-hover)', border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border)') }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: '2px', width: '18px', height: '18px', accentColor: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: '13.5px', color: 'var(--text-1)' }}>I have read and understood this message.</span>
        </label>
        <button className="btn btn-primary" disabled={!checked || busy} onClick={acknowledge} style={{ width: '100%', marginTop: '14px', opacity: (!checked || busy) ? 0.5 : 1 }}>
          {busy ? 'Saving…' : (remaining > 0 ? 'Acknowledge & see next' : 'Acknowledge')}
        </button>
      </div>
    </div>
  );
}

// Owner/admin surface to post and manage announcements.

export function AnnouncementsAdmin({ userId, isAdmin = false }) {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [list, setList] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [audiences, setAudiences] = React.useState([]);
  const [audience, setAudience] = React.useState(isAdmin ? '' : '__none__');
  const [expiresAt, setExpiresAt] = React.useState('');

  const load = React.useCallback(async () => {
    try { const { data } = await supabase.rpc('announcement_stats'); setList(Array.isArray(data) ? data : []); } catch (_) { setList([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.rpc('my_announce_audiences');
        const auds = Array.isArray(data) ? data : [];
        setAudiences(auds);
        if (!isAdmin) setAudience(auds.length ? auds[0].team_id : '__none__');
      } catch (_) { setAudiences([]); }
    })();
  }, [isAdmin]);

  async function post() {
    if (!body.trim()) { setMsg('Message body is required.'); return; }
    setBusy(true); setMsg('');
    const team_id = (audience && audience !== '' && audience !== '__none__') ? audience : null;
    if (!isAdmin && !team_id) { setMsg('Please choose a team to post to.'); setBusy(false); return; }
    // Optional "show until" — a time-bound notice (a meeting, a deadline) self-
    // retires so it can't pop up for someone weeks later.
    const expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
    const { error } = await supabase.from('announcements').insert({ title: title.trim() || null, body: body.trim(), created_by: userId, team_id, expires_at });
    if (error) { setMsg('Error: ' + error.message); setBusy(false); return; }
    setTitle(''); setBody(''); setExpiresAt(''); setMsg('Posted. Only agents already signed up will see it — new users who join later won\u2019t get this old notice.'); setBusy(false); load();
  }
  async function toggleActive(a) { try { await supabase.from('announcements').update({ is_active: !a.is_active }).eq('id', a.id); } catch (_) {} load(); }
  async function remove(a) { if (!window.confirm('Delete this announcement? This also removes its acknowledgements.')) return; try { await supabase.from('announcements').delete().eq('id', a.id); } catch (_) {} load(); }

  const sbtn = { fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' };

  return (
    <div>
      <div className="page-header"><h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span>📣</span>Announcements</h2><p>Post a message that pops up on every agent's dashboard until they acknowledge it.</p></div>
      <div style={{ maxWidth: '640px' }}>
        <div className="panel" style={{ marginBottom: '18px' }}>
          <div className="panel-header"><h3>New announcement</h3></div>
          <div className="panel-body">
            <div className="form-group"><label className="form-label">Title (optional)</label><input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Office closed Friday" maxLength={120} /></div>
            <div className="form-group"><label className="form-label">Audience</label>
              <select className="form-input" value={audience} onChange={e => setAudience(e.target.value)}>
                {isAdmin && <option value="">Everyone (system-wide)</option>}
                {audiences.map(a => <option key={a.team_id} value={a.team_id}>{a.team_name}</option>)}
                {!isAdmin && audiences.length === 0 && <option value="__none__">No team assigned to you yet</option>}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>{isAdmin ? 'Post to everyone, or narrow to a single team.' : 'You can post to your team.'}</div>
            </div>
            <div className="form-group"><label className="form-label">Message</label><textarea className="form-input" value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="What do you want every agent to see?" /></div>
            <div className="form-group"><label className="form-label">Show until <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional — for meetings or deadlines, it hides itself after this)</span></label><input type="datetime-local" className="form-input" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></div>
            {msg && <div style={{ fontSize: '12.5px', marginBottom: '10px', color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{msg}</div>}
            <button className="btn btn-primary" disabled={busy} onClick={post}>{busy ? 'Posting…' : 'Post announcement'}</button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h3>Posted announcements</h3></div>
          <div className="panel-body">
            {list.length === 0 && <div style={{ fontSize: '13px', color: 'var(--text-3)' }}>No announcements yet.</div>}
            {list.map(a => (
              <div key={a.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: '14px' }}>{a.title || '(no title)'}</span>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 6px' }}>{a.team_name || 'Everyone'}</span>
                  {!a.is_active && <span style={{ fontSize: '10px', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 6px' }}>inactive</span>}
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent)' }}>✓ {a.ack_count} acknowledged</span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{a.body}</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{new Date(a.created_at).toLocaleDateString()}</span>
                  <button onClick={() => toggleActive(a)} style={{ ...sbtn, marginLeft: 'auto' }}>{a.is_active ? 'Deactivate' : 'Reactivate'}</button>
                  <button onClick={() => remove(a)} style={{ ...sbtn, color: 'var(--red)' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
