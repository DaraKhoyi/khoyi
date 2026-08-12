// FollowupDraftModal — compose/send an email follow-up with AI draft + rewrite.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { applyMergeFields, quoNormPhone, resolveSendAccount } from '../helpers';
import { quoCall } from '../quo';
import { notify } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import ForkTuningOverlay from './ForkTuningOverlay';
import AriRewriteButton from './AriRewriteButton';
import TemplatesModal from './TemplatesModal';

export default function FollowupDraftModal({ entry, contacts, defaultContact, recentNotes, userId, onClose, onLogged, onSent }) {

  useBackClose(onClose);
  const candidates = (() => {
    const list = [];
    if (defaultContact && defaultContact.id) list.push(defaultContact);
    (entry.mentions || []).forEach(id => {
      if (!list.some(c => c.id === id)) { const c = contacts.find(x => x.id === id); if (c) list.push(c); }
    });
    return list;
  })();
  const [recipientId, setRecipientId] = useState(candidates[0]?.id || '');
  const recipient = contacts.find(c => c.id === recipientId) || candidates[0] || null;
  const [channel, setChannel] = useState(recipient?.email ? 'email' : 'text');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const composeBodyRef = useRef(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [showInstruction, setShowInstruction] = useState(false);
  const [discHint, setDiscHint] = useState(null); // {p, s} recipient DISC letters, for the "adapted to X style" hint
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!recipient?.id) { setDiscHint(null); return; }
      try {
        const { data } = await supabase.from('profiles').select('primary_letter,secondary_letter').eq('contact_id', recipient.id).eq('subject_kind', 'contact').maybeSingle();
        if (alive) setDiscHint(data?.primary_letter ? { p: data.primary_letter, s: data.secondary_letter } : null);
      } catch (_) { if (alive) setDiscHint(null); }
    })();
    return () => { alive = false; };
  }, [recipientId]); // eslint-disable-line
  const [attachments, setAttachments] = useState([]); // [{filename, mime_type, content_base64, size}]
  const [trackOpens, setTrackOpens] = useState(false); // opt-in open tracking, OFF by default
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const attachInputRef = React.useRef(null);
  const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // ~20MB Gmail-safe budget across files
  async function onPickAttachments(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file
    if (!files.length) return;
    let total = attachments.reduce((n, a) => n + (a.size || 0), 0);
    for (const f of files) {
      if (total + f.size > MAX_ATTACH_BYTES) { notify(`"${f.name}" skipped — attachments over ~20MB won't send by email.`, 'error'); continue; }
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(f); });
        if (!b64) { notify(`Couldn't read "${f.name}".`, 'error'); continue; }
        total += f.size;
        setAttachments(prev => [...prev, { filename: f.name, mime_type: f.type || 'application/octet-stream', content_base64: b64, size: f.size }]);
      } catch (_) { notify(`Couldn't read "${f.name}".`, 'error'); }
    }
  }
  const removeAttachment = (i) => setAttachments(prev => prev.filter((_, idx) => idx !== i));
  const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  async function draft() {
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-followup-draft', {
        body: {
          contactName: recipient?.name || null,
          company: recipient?.company || null,
          role: recipient?.role || null,
          contact_id: recipient?.id || null,
          channel,
          kind: entry.kind || 'note',
          entryBody: entry.body || entry.brief || '',
          occurredAt: entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : null,
          instruction: instruction || null,
          recentNotes: (recentNotes || []).slice(0, 6),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSubject(data?.subject || '');
      setBodyText(data?.body || '');
    } catch (e) {
      notify("Couldn't draft follow-up: " + (e.message || e), 'error');
    } finally { setDrafting(false); }
  }
  // No auto-draft: open blank so the user writes their own message and only spends AI
  // tokens when they choose to (Ari rewrite / Regenerate). Saves tokens across the team.

  // Templates
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('message_templates').select('*').order('name');
      setTemplates(data || []);
    })();
  }, []);
  function applyTemplate(t) {
    const ctx = { contact: recipient, senderName: 'Dara' };
    if (channel === 'email' && t.subject) setSubject(applyMergeFields(t.subject, ctx));
    setBodyText(applyMergeFields(t.body, ctx));
    setShowTemplates(false);
  }
  const pickableTemplates = templates.filter(t => t.channel === channel || t.channel === 'any');

  async function logSent(via, text) {
    try {
      const row = {
        user_id: userId,
        entity_type: entry.entity_type, entity_id: entry.entity_id,
        contact_id: entry.entity_type === 'contact' ? entry.entity_id : (recipient?.id || null),
        kind: via, channel: via === 'email' ? 'email' : 'text', direction: 'outbound',
        occurred_at: new Date().toISOString(),
        body: (via === 'email' && subject ? subject + ' — ' : '') + text,
        brief: text.slice(0, 140),
        mentions: recipient ? [recipient.id] : [], tags: ['followup'],
        pinned: false,
      };
      const { data } = await supabase.from('contact_interactions').insert(row).select().single();
      if (data && onLogged) onLogged(data);
    } catch (_) {}
  }

  async function sendEmail() {
    if (!recipient?.email) { notify('That contact has no email on file.', 'error'); return; }
    if (!bodyText.trim()) return;
    setSending(true);
    try {
      const acc = await resolveSendAccount();
      if (!acc) { notify('No email account is connected to send from. Connect Gmail in Settings.', 'error'); setSending(false); return; }
      const { data: sr, error: se } = await supabase.functions.invoke('gmail-send', {
        body: { account_id: acc.id, to: recipient.email, subject: subject || '(no subject)', body_text: bodyText, attachments: attachments.map(a => ({ filename: a.filename, mime_type: a.mime_type, content_base64: a.content_base64 })), track: trackOpens, contact_id: recipient?.id || null },
      });
      if (se) throw se;
      if (sr?.error) throw new Error(sr.error);
      await logSent('email', bodyText);
      // Flip the contact to "you replied last" IMMEDIATELY — both DB and (via
      // onSent) the in-memory card — instead of waiting for the background comms
      // recompute. Otherwise the card keeps showing "↓ They / you owe a reply"
      // for minutes after you actually replied.
      if (recipient?.id) {
        const nowIso = new Date().toISOString();
        const patch = { last_outbound_at: nowIso, last_contact_at: nowIso, last_communication_direction: 'outbound', comms_settled_at: null };
        supabase.from('contacts').update(patch).eq('id', recipient.id).then(() => {});
        if (onSent) onSent(recipient.id, patch);
      }
      notify('Follow-up sent to ' + recipient.email, 'success');
      onClose();
    } catch (e) {
      notify("Couldn't send: " + (e.message || e), 'error');
    } finally { setSending(false); }
  }
  async function scheduleEmail() {
    if (!recipient?.email) { notify('That contact has no email on file.', 'error'); return; }
    if (!bodyText.trim()) return;
    if (!scheduleAt) { notify('Pick a date and time first.', 'error'); return; }
    const when = new Date(scheduleAt);
    if (isNaN(when.getTime()) || when.getTime() < Date.now() + 60000) { notify('Pick a time at least a minute in the future.', 'error'); return; }
    setScheduling(true);
    try {
      const acc = await resolveSendAccount();
      if (!acc) { notify('No email account is connected to send from. Connect Gmail in Settings.', 'error'); setScheduling(false); return; }
      const { error: insErr } = await supabase.from('scheduled_emails').insert({
        user_id: userId, account_id: acc.id, to_email: recipient.email,
        subject: subject || '(no subject)', body_text: bodyText,
        attachments: attachments.map(a => ({ filename: a.filename, mime_type: a.mime_type, content_base64: a.content_base64 })),
        track: trackOpens, contact_id: recipient?.id || null, send_at: when.toISOString(), status: 'scheduled',
      });
      if (insErr) throw insErr;
      notify('Scheduled — sends ' + when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), 'success');
      onClose();
    } catch (e) {
      notify("Couldn't schedule: " + (e.message || e), 'error');
    } finally { setScheduling(false); }
  }
  async function sendText() {
    if (!recipient?.phone) { notify('That contact has no phone on file.', 'error'); return; }
    if (!bodyText.trim()) return;
    const to = quoNormPhone(recipient.phone);
    setSending(true);
    try {
      // Resolve the active Quo sending number (set in the Quo tab), else first available.
      let from = null;
      const { data: st } = await supabase.from('quo_settings').select('active_number').eq('user_id', userId).maybeSingle();
      from = st?.active_number || null;
      if (!from) throw new Error('No Quo number is selected for your account yet. Open the Quo tab and pick YOUR number before sending.');
      await quoCall('/v1/messages', { method: 'POST', body: { content: bodyText, from, to: [to] } });
      await logSent('text', bodyText);
      if (recipient?.id) {
        const nowIso = new Date().toISOString();
        const patch = { last_outbound_at: nowIso, last_contact_at: nowIso, last_communication_direction: 'outbound', comms_settled_at: null };
        supabase.from('contacts').update(patch).eq('id', recipient.id).then(() => {});
        if (onSent) onSent(recipient.id, patch);
      }
      notify('Text sent via Quo to ' + (recipient.name || to), 'success');
      onClose();
    } catch (e) {
      notify("Couldn't send via Quo (" + (e.message || e) + ") — opening Messages as fallback.", 'error');
      try { navigator.clipboard && navigator.clipboard.writeText(bodyText); } catch (_) {}
      window.location.href = `sms:${to.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(bodyText)}`;
      onClose();
    } finally { setSending(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
        {drafting && <ForkTuningOverlay contactName={recipient?.name} discLabel={recipient?.disc_primary_letter || recipient?.primary_letter || ''} />}
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px', width: '94%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="mail" size={15} /> Draft follow-up</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {candidates.length > 1 ? (
              <select className="form-select" value={recipientId} onChange={e => setRecipientId(e.target.value)} style={{ flex: '1 1 200px', padding: '7px', fontSize: '13px', margin: 0 }}>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <div style={{ flex: '1 1 200px', fontSize: '13px', color: 'var(--text-1)', display: 'flex', alignItems: 'center' }}>
                To: <strong style={{ marginLeft: '5px' }}>{recipient?.name || '—'}</strong>
              </div>
            )}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setChannel('email')} disabled={!recipient?.email}
                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: recipient?.email ? 'pointer' : 'not-allowed',
                  border: `1px solid ${channel === 'email' ? 'var(--accent)' : 'var(--border)'}`, background: channel === 'email' ? 'rgba(197,169,94,0.12)' : 'transparent', color: !recipient?.email ? 'var(--text-3)' : channel === 'email' ? 'var(--accent)' : 'var(--text-2)' }}>✉️ Email</button>
              <button onClick={() => setChannel('text')} disabled={!recipient?.phone}
                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: recipient?.phone ? 'pointer' : 'not-allowed',
                  border: `1px solid ${channel === 'text' ? 'var(--accent)' : 'var(--border)'}`, background: channel === 'text' ? 'rgba(197,169,94,0.12)' : 'transparent', color: !recipient?.phone ? 'var(--text-3)' : channel === 'text' ? 'var(--accent)' : 'var(--text-2)' }}>💬 Text</button>
            </div>
          </div>
          {channel === 'email' && recipient?.email && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '-6px', marginBottom: '10px' }}>{recipient.email}</div>}
          {channel === 'text' && recipient?.phone && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '-6px', marginBottom: '10px' }}>{recipient.phone}</div>}

          {drafting ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}><Icon name="sparkles" size={22} /> Ari is drafting…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-3)' }}><Icon name="clipboard" size={11} style={{verticalAlign:'-2px'}} /> Template:</span>
                <select value="" onChange={e => { const t = pickableTemplates.find(x => x.id === e.target.value); if (t) applyTemplate(t); }}
                  className="form-select" style={{ flex: '1 1 160px', margin: 0, fontSize: '12px', padding: '6px' }}>
                  <option value="">{pickableTemplates.length ? 'Start from a template…' : 'No templates for this channel'}</option>
                  {pickableTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowTemplates(true)} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>Manage</button>
              </div>
              {channel === 'email' && (
                <input className="form-input" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={{ fontSize: '13px', padding: '8px 10px', margin: 0, marginBottom: '8px', fontWeight: 600 }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                {discHint
                  ? <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>adapted to <strong style={{ color: 'var(--accent)' }}>{discHint.p}{discHint.s ? '/' + discHint.s : ''}</strong> style</span>
                  : <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>no DISC profile yet · neutral tone</span>}
                <span style={{ marginLeft: 'auto' }}><AriRewriteButton text={bodyText} onRewrite={setBodyText} textareaRef={composeBodyRef} contactName={recipient?.name} contactId={recipient?.id} discLabel={discHint ? `${discHint.p}${discHint.s ? '/' + discHint.s : ''}` : ''} /></span>
              </div>
              <textarea ref={composeBodyRef} className="form-textarea" value={bodyText} onChange={e => setBodyText(e.target.value)}
                placeholder={`Write your ${channel === 'email' ? 'email' : 'message'} to ${(recipient?.name || '').split(/\s+/)[0] || 'them'}…\n\nOr tap \u201cRegenerate\u201d to have Ari draft it, or \u201cAri rewrite\u201d to polish what you’ve written — adapted to their ${discHint ? discHint.p + (discHint.s ? '/' + discHint.s : '') + ' ' : ''}style.`}
                style={{ minHeight: '180px', fontSize: '13px', padding: '10px', margin: 0, lineHeight: 1.5, width: '100%' }} />
              {channel === 'email' && (
                <div style={{ marginTop: '8px' }}>
                  <input ref={attachInputRef} type="file" multiple onChange={onPickAttachments} style={{ display: 'none' }} />
                  <button className="btn btn-ghost btn-sm" onClick={() => attachInputRef.current && attachInputRef.current.click()} style={{ fontSize: '11px' }}>📎 Attach file</button>
                  <button onClick={() => setTrackOpens(v => !v)} title="Get a 'Likely seen' read signal. Off by default." style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: trackOpens ? 'var(--accent)' : 'var(--text-3)' }}>
                    <span style={{ width: '15px', height: '15px', borderRadius: '4px', border: `2px solid ${trackOpens ? 'var(--accent)' : 'var(--text-3)'}`, background: trackOpens ? 'var(--accent)' : 'transparent', color: '#1a1300', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: '11px' }}>{trackOpens ? '✓' : ''}</span>
                    Track opens
                  </button>
                  {attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {attachments.map((a, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', padding: '5px 8px', borderRadius: '8px', border: '1px solid rgba(197,169,94,0.45)', background: 'rgba(197,169,94,0.10)', fontSize: '11px', color: 'var(--text-1)' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>📄 {a.filename}</span>
                          <span style={{ color: 'var(--text-3)' }}>{fmtBytes(a.size)}</span>
                          <button onClick={() => removeAttachment(i)} title="Remove attachment" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {showInstruction ? (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <input className="form-input" placeholder="e.g. make it warmer, shorter, mention the inspection…" value={instruction} onChange={e => setInstruction(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); draft(); } }} style={{ flex: 1, fontSize: '12px', padding: '7px', margin: 0 }} />
                  <button className="btn btn-ghost btn-sm" onClick={draft} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>↻ Redraft</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => draft()} style={{ fontSize: '11px' }}>↻ Regenerate</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowInstruction(true)} style={{ fontSize: '11px' }}><Icon name="edit" size={13} /> Guide the draft</button>
                </div>
              )}
            </>
          )}
        </div>
        {channel === 'email' && showSchedule && (
          <div style={{ margin: '4px 0 0', padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)', marginBottom: '8px' }}>Schedule send</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '9px' }}>
              {(() => {
                const fmt = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
                const inHour = () => { const d = new Date(); d.setHours(d.getHours() + 1); return fmt(d); };
                const at = (addDays, h) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return fmt(d); };
                const nextMon8 = () => { const d = new Date(); const diff = ((1 - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate() + diff); d.setHours(8, 0, 0, 0); return fmt(d); };
                const presets = [['In 1 hour', inHour()], ['Tomorrow 8 AM', at(1, 8)], ['Monday 8 AM', nextMon8()]];
                return presets.map(([lbl, val]) => {
                  const active = scheduleAt === val;
                  return <button key={lbl} type="button" onClick={() => setScheduleAt(val)} style={{ padding: '7px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'rgba(197,169,94,0.14)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)' }}>{lbl}</button>;
                });
              })()}
            </div>
            <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '14px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-1)', colorScheme: 'dark' }} />
            <button type="button" onClick={scheduleEmail} disabled={scheduling || !scheduleAt || !bodyText.trim()} className="btn btn-primary btn-sm" style={{ marginTop: '10px', width: '100%', opacity: (scheduling || !scheduleAt || !bodyText.trim()) ? 0.55 : 1 }}>{scheduling ? 'Scheduling…' : '🕐 Schedule send'}</button>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {channel === 'email' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setShowSchedule(v => !v)} disabled={sending || drafting || !bodyText.trim()} title="Send at a future time">🕐 {showSchedule ? 'Hide' : 'Schedule'}</button>
              <button type="button" className="btn btn-primary" onClick={sendEmail} disabled={sending || drafting || !bodyText.trim()}>
                {sending ? 'Sending…' : <><Icon name="mail" size={13} /> Send email</>}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={sendText} disabled={drafting || !bodyText.trim()}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="message" size={13} /> Open in Messages</span>
            </button>
          )}
        </div>
      </div>
      {showTemplates && (
        <TemplatesModal userId={userId} templates={templates} setTemplates={setTemplates}
          onClose={() => setShowTemplates(false)} onPick={applyTemplate} />
      )}
    </div>
  );
}
