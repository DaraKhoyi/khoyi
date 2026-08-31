// QuoTextModal — compose + send an SMS through Quo, with Ari voice-rewrite.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { quoCall, sendQuoSms } from '../quo';
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
  // Quo is not the only way Dara texts. Some go from the phone in his hand, on
  // T-Mobile, and PrismOS cannot see those at all — so a text sent that way used
  // to vanish from the record entirely and the contact looked untouched.
  // Choosing the line is the fix; recording the phone-sent one honestly is the
  // rest of it.
  const [method, setMethod] = useState(() => {
    try { return localStorage.getItem('prism_text_method') || 'quo'; } catch (_) { return 'quo'; }
  });
  const pickMethod = (m) => {
    setMethod(m); setErr('');
    try { localStorage.setItem('prism_text_method', m); } catch (_) {}
  };
  const toDigits = (phoneRaw || '').replace(/[^\d+]/g, '');

  // One writer for both paths, so a phone-sent text lands in the timeline, the
  // cadence dates and the call list exactly like a Quo one — with the single
  // difference that matters: we did not send it, so we do not claim it was
  // delivered.
  async function logText(msg, via) {
    if (!contact?.id) return;
    const now = new Date().toISOString();
    const viaLabel = via === 'quo' ? 'Sent via Quo' : 'Sent from your phone';
    try {
      const { error } = await supabase.from('contact_interactions').insert({
        user_id: userId, contact_id: contact.id,
        channel: 'text', kind: 'text', direction: 'outbound',
        occurred_at: now, body: msg,
        brief: (via === 'quo' ? '' : '\u{1F4F1} ') + msg.slice(0, 140),
        mentions: [contact.id],
        // The tag is how the cadence and any later audit can tell a delivered
        // text from one we only handed to the phone.
        tags: via === 'quo' ? ['text', 'quo'] : ['text', 'device', 'unverified'],
      });
      if (error) { notify && notify('Text recorded on the card failed: ' + error.message, 'error'); return; }
      await supabase.from('contacts').update({
        last_contact_at: now, last_outbound_at: now, last_communication_direction: 'outbound',
        last_communication_channel: 'text',
      }).eq('id', contact.id);
      // Counts as today's touch either way — the point of the call list is who
      // you have reached, not which wire carried it.
      try { await supabase.rpc('log_call_list', { p_contact: contact.id, p_outcome: 'texted' }); } catch (_) {}
      if (notify) notify(viaLabel + ' \u2014 saved to ' + name + '\u2019s record.', 'success');
    } catch (e) {
      if (notify) notify('Could not save the text to the record: ' + (e.message || e), 'error');
    }
  }

  // Hand the message to the phone's own SMS app, then record it here. We cannot
  // know whether he pressed send, so the record says so rather than pretending.
  async function sendFromPhone() {
    const msg = text.trim();
    if (!msg) return;
    if (!toDigits) { setErr('This contact has no phone number on file.'); return; }
    setSending(true); setErr('');
    try {
      const href = 'sms:' + toDigits + (/(iPhone|iPad|Mac)/i.test(navigator.userAgent) ? '&' : '?')
        + 'body=' + encodeURIComponent(msg);
      window.location.href = href;
      await logText(msg, 'device');
      setSent(true);
      if (onSent) onSent(msg);
      setTimeout(() => onClose && onClose(), 900);
    } catch (e) {
      setErr('Could not open Messages: ' + (e.message || e));
    } finally { setSending(false); }
  }

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
      await sendQuoSms({ from, to, content: msg });
      await logText(msg, 'quo');
      setSent(true);
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
            {phoneRaw
              ? <>To <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{phoneRaw}</span>
                  {method === 'quo' ? ' \u00B7 from your Quo number' : ' \u00B7 from your phone'}</>
              : 'No phone number on file for this contact.'}
          </div>
          {/* Which line carries it. Quo sends and confirms; the phone hands off
              to Messages and we record it as unverified, because we genuinely
              cannot see whether it left. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['quo', 'Quo', 'Sent and logged by PrismOS'],
              ['device', 'My phone', 'Opens Messages \u2014 saved to the record, marked unverified']].map(([k, label, hint]) => (
              <button key={k} type="button" title={hint} onClick={() => pickMethod(k)}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid ' + (method === k ? '#EBCB82' : 'var(--border)'),
                  background: method === k ? 'rgba(235,203,130,.16)' : 'transparent',
                  color: method === k ? '#EBCB82' : 'var(--text-3)' }}>
                {label}
              </button>
            ))}
          </div>
          {method === 'device' ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.45, marginBottom: 10 }}>
              {'This opens your phone\u2019s Messages app with the text ready. PrismOS cannot see whether you press send, so it is saved to the record marked \u201Cfrom your phone, unverified.\u201D'}
            </div>
          ) : null}
          <AriRewriteButton text={text} onRewrite={setText} contactName={name} contactId={contact?.id} />
          <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={5}
            placeholder={`Write a text to ${name}…`}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: '14px', lineHeight: 1.5, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-1)', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              {text.length + ' characters'}
            </span>
            {sent && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span>}
          </div>
          {err && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--red)' }}>
              {err}
              {toDigits && <> {'\u00B7'} <button type="button" onClick={() => { pickMethod('device'); sendFromPhone(); }}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                send from your phone instead</button></>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button className="btn btn-ghost" onClick={() => !sending && onClose && onClose()}>Cancel</button>
            <button className="btn btn-primary" disabled={sending || sent || !text.trim() || !phoneRaw} onClick={() => (method === 'quo' ? send() : sendFromPhone())} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
              <Icon name={method === 'quo' ? 'quo' : 'message'} size={14} />{' '}
              {sending ? (method === 'quo' ? 'Sending\u2026' : 'Opening\u2026') : (method === 'quo' ? 'Send via Quo' : 'Open Messages')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
