// QuoTextModal — compose + send an SMS through Quo, with Ari voice-rewrite.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { quoCall } from '../quo';
import { quoNormPhone } from '../helpers';
import { notify } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import AriRewriteButton from './AriRewriteButton';

export default function QuoTextModal({ contact, userId, defaultText = '', phone, onClose, onSent }) {
  useBackClose(onClose);
  const name = contact?.name || 'this contact';
  const phoneRaw = phone || contact?.phone || contact?.mobile || '';
  const [text, setText] = useState(defaultText || '');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const toDigits = (phoneRaw || '').replace(/[^\d+]/g, '');

  async function send() {
    const msg = text.trim();
    if (!msg || sending) return;
    if (!phoneRaw) { setErr('This contact has no phone number on file.'); return; }
    setSending(true); setErr('');
    const to = quoNormPhone(phoneRaw);
    try {
      let from = null;
      const { data: st } = await supabase.from('quo_settings').select('active_number').eq('user_id', userId).maybeSingle();
      from = st?.active_number || null;
      if (!from) throw new Error('No Quo number is selected for your account yet. Open the Text & Phone screen and pick YOUR number before sending.');
      await quoCall('/v1/messages', { method: 'POST', body: { content: msg, from, to: [to] } });
      if (contact?.id) {
        try {
          await supabase.from('contact_interactions').insert({
            user_id: userId, contact_id: contact.id, channel: 'text', kind: 'text', direction: 'outbound',
            occurred_at: new Date().toISOString(), body: msg, brief: msg.slice(0, 140), mentions: [contact.id], tags: ['text'],
          });
          await supabase.from('contacts').update({ last_contact_at: new Date().toISOString(), last_outbound_at: new Date().toISOString(), last_communication_direction: 'outbound' }).eq('id', contact.id);
        } catch (_) {}
      }
      setSent(true);
      if (typeof notify === 'function') notify('Text sent via Quo to ' + name, 'success');
      if (onSent) onSent(msg);
      setTimeout(() => onClose && onClose(), 700);
    } catch (e) {
      setErr('Couldn’t send via Quo: ' + (e.message || e));
    } finally { setSending(false); }
  }

  return (
    <div className="modal-overlay" onClick={() => !sending && onClose && onClose()} style={{ zIndex: 1300 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px', width: '94%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', margin: 0 }}><Icon name="message" size={15} style={{ color: 'var(--accent)' }} /> Text {name}</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => !sending && onClose && onClose()}>✕</button>
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' }}>
            {phoneRaw ? <>To <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{phoneRaw}</span> · sent from your Quo number</> : 'No phone number on file for this contact.'}
          </div>
          <AriRewriteButton text={text} onRewrite={setText} contactName={name} contactId={contact?.id} />
          <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={5}
            placeholder={`Write a text to ${name}…`}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: '14px', lineHeight: 1.5, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-1)', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{text.length} characters</span>
            {sent && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span>}
          </div>
          {err && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--red)' }}>
              {err}
              {toDigits && <> · <a href={`sms:${toDigits}?body=${encodeURIComponent(text)}`} style={{ color: 'var(--accent)' }}>open Messages instead</a></>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button className="btn btn-ghost" onClick={() => !sending && onClose && onClose()}>Cancel</button>
            <button className="btn btn-primary" disabled={sending || sent || !text.trim() || !phoneRaw} onClick={send} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
              <Icon name="quo" size={14} /> {sending ? 'Sending…' : 'Send via Quo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
