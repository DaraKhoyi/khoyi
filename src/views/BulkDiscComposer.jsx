import React, { useState, useMemo, useRef } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { quoNormPhone } from '../helpers';
import { quoCall } from '../quo';
import { useBackClose } from '../backClose';
import { notify } from '../notify';

// ─────────────────────────────────────────
// BULK DISC COMPOSER
// Select many contacts → type one message → Ari adapts it into D/I/S/C (+ a
// neutral version for contacts with no DISC profile). Swipe the drafts, edit any,
// then Send: each draft fans out to the contacts whose dominant style matches.
// {first_name} in a draft is replaced with each recipient's first name at send.
// ─────────────────────────────────────────
const DISC_LETTERS = ['D', 'I', 'S', 'C'];
export const DISC_STYLE_META = {
  D: { name: 'Dominance',         color: '#ef4444', tip: 'Direct & results-driven' },
  I: { name: 'Influence',         color: '#f59e0b', tip: 'Warm & expressive' },
  S: { name: 'Steadiness',        color: '#22c55e', tip: 'Steady & supportive' },
  C: { name: 'Conscientiousness', color: '#3b82f6', tip: 'Precise & analytical' },
  neutral: { name: 'No DISC on file', color: '#9499b0', tip: 'Clean house voice' },
};

export function dominantDiscLetter(p) {
  if (!p) return null;
  const explicit = p.baseline_primary || p.primary_letter;
  if (explicit && DISC_LETTERS.includes(explicit)) return explicit;
  const hasB = p.baseline_d_score != null;
  const d = hasB ? p.baseline_d_score : p.d_score;
  const i = hasB ? p.baseline_i_score : p.i_score;
  const s = hasB ? p.baseline_s_score : p.s_score;
  const c = hasB ? p.baseline_c_score : p.c_score;
  const arr = [['D', d], ['I', i], ['S', s], ['C', c]].filter(x => x[1] != null);
  if (!arr.length) return null;
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][0];
}

export function BulkDiscComposer({ contacts, profileByContact, channel, userId, onClose, onSent }) {
  useBackClose(onClose);
  const isEmail = channel === 'email';
  // profileByContact may be a Map (ContactsView) or a plain object (GroupMessageView) — read either.
  const getProfile = (id) => !profileByContact ? null : (typeof profileByContact.get === 'function' ? profileByContact.get(id) : profileByContact[id]);

  const { eligible, skipped } = useMemo(() => {
    const e = [], s = [];
    (contacts || []).forEach(c => { (isEmail ? c.email : c.phone) ? e.push(c) : s.push(c); });
    return { eligible: e, skipped: s };
  }, [contacts, isEmail]);

  const buckets = useMemo(() => {
    const b = { D: [], I: [], S: [], C: [], neutral: [] };
    eligible.forEach(c => { const k = dominantDiscLetter(getProfile(c.id)) || 'neutral'; b[k].push(c); });
    return b;
  }, [eligible, profileByContact]);
  const hasNeutral = buckets.neutral.length > 0;
  const cards = useMemo(() => [...DISC_LETTERS, ...(hasNeutral ? ['neutral'] : [])], [hasNeutral]);

  const [base, setBase] = useState('');
  const [baseSubject, setBaseSubject] = useState('');
  const [lockedLines, setLockedLines] = useState('');
  const [attachments, setAttachments] = useState([]); // [{ filename, mime, content_base64, size }]
  const [attachErr, setAttachErr] = useState('');
  const [step, setStep] = useState('compose'); // compose | review | sending | done
  const [gen, setGen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [idx, setIdx] = useState(0);
  const [expandList, setExpandList] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [trackBlast, setTrackBlast] = useState(false); // opt-in open tracking for the blast, OFF by default
  const [batchId, setBatchId] = useState(null);
  const [batchRows, setBatchRows] = useState([]);
  async function loadBatch(bId) {
    if (!bId) return;
    try {
      const { data } = await supabase.from('email_tracking').select('contact_id,to_address,variant,status,confident_open_at,open_count,apple_mpp').eq('batch_id', bId);
      setBatchRows(data || []);
    } catch (_) {}
  }
  const touchX = useRef(null);

  // Attachments: read each picked file to base64 for gmail-send's multipart/mixed.
  // Gmail caps a message at ~25MB; keep the total well under that.
  const MAX_ATTACH_TOTAL = 20 * 1024 * 1024;
  async function addFiles(fileList) {
    setAttachErr('');
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let running = attachments.reduce((n, a) => n + (a.size || 0), 0);
    const next = [];
    for (const f of files) {
      if (running + f.size > MAX_ATTACH_TOTAL) { setAttachErr('Attachments must total under 20 MB.'); break; }
      try {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1] || '');
          r.onerror = () => rej(new Error('read failed'));
          r.readAsDataURL(f);
        });
        next.push({ filename: f.name, mime: f.type || 'application/octet-stream', content_base64: b64, size: f.size });
        running += f.size;
      } catch (_) { setAttachErr('Couldn’t read ' + f.name); }
    }
    if (next.length) setAttachments(a => [...a, ...next]);
  }
  const removeAttach = (i) => setAttachments(a => a.filter((_, j) => j !== i));
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  const firstName = c => ((c.name || '').trim().split(/\s+/)[0]) || 'there';
  const personalize = (text, c) => (text || '').replace(/\{first[_\s]?name\}/gi, firstName(c)).replace(/\{name\}/gi, firstName(c));

  async function generate() {
    if (!base.trim() || gen) return;
    setGen(true);
    try {
      const { data, error } = await supabase.functions.invoke('ari-disc-broadcast', {
        body: { base_message: base.trim(), channel, styles: DISC_LETTERS, include_neutral: hasNeutral, base_subject: isEmail ? baseSubject.trim() : '' },
      });
      if (error || data?.error || !data?.drafts) { notify('Ari couldn’t draft those — try again.', 'error'); setGen(false); return; }
      const dr = {};
      cards.forEach(k => { const v = data.drafts[k] || { subject: '', body: '' }; dr[k] = { subject: isEmail ? (v.subject || baseSubject || '') : '', body: v.body || '' }; });
      setDrafts(dr); setIdx(0); setStep('review');
    } catch (e) { notify('Ari error: ' + (e.message || e), 'error'); }
    finally { setGen(false); }
  }

  const setField = (k, field, val) => setDrafts(prev => ({ ...prev, [k]: { ...prev[k], [field]: val } }));

  async function quoFrom() {
    const { data: st } = await supabase.from('quo_settings').select('active_number').eq('user_id', userId).maybeSingle();
    let from = st?.active_number || null;
    if (!from) throw new Error('No Quo number is selected for your account yet. Open the Quo tab and pick YOUR number before sending.');
    return from;
  }
  async function logSent(contact, ch, body, subject) {
    try {
      await supabase.from('contact_interactions').insert({
        user_id: userId, contact_id: contact.id, channel: ch, kind: ch, direction: 'outbound',
        occurred_at: new Date().toISOString(), body, brief: (subject || body).slice(0, 140), mentions: [contact.id], tags: [ch, 'broadcast'],
      });
      await supabase.from('contacts').update({ last_contact_at: new Date().toISOString(), last_outbound_at: new Date().toISOString(), last_communication_direction: 'outbound' }).eq('id', contact.id);
    } catch (_) {}
  }

  async function sendAll() {
    const jobs = [];
    cards.forEach(k => { const d = drafts[k]; if (!d || !(d.body || '').trim()) return; buckets[k].forEach(c => jobs.push({ c, d, k })); });
    if (!jobs.length) { notify('No drafts with recipients to send.', 'error'); return; }

    let acc = null, from = null;
    try {
      if (isEmail) {
        const { data: accs } = await supabase.from('email_accounts').select('id,email_address,is_default').contains('purposes',['email']).order('is_default',{ascending:false}).order('created_at').limit(1);
        acc = accs && accs[0];
        if (!acc) { notify('No email account connected. Connect Gmail in Settings.', 'error'); return; }
      } else { from = await quoFrom(); }
    } catch (e) { notify(String(e.message || e), 'error'); return; }

    setStep('sending'); setProgress({ done: 0, total: jobs.length });
    const bId = (trackBlast && isEmail) ? crypto.randomUUID() : null;
    setBatchId(bId);
    let sent = 0, failed = 0, first = true;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const { c, d, k } of jobs) {
      if (!first) await sleep(1200 + Math.floor(Math.random() * 1400)); // pace sends to protect sender reputation + dodge rate limits
      first = false;
      try {
        const body = personalize(d.body + (lockedLines.trim() ? '\n\n' + lockedLines : ''), c);
        if (isEmail) {
          const subject = personalize(d.subject, c) || '(no subject)';
          const extra = bId ? { track: true, variant: k, batch_id: bId, contact_id: c.id } : {};
          const { data: sr, error: se } = await supabase.functions.invoke('gmail-send', { body: { account_id: acc.id, to: c.email, subject, body_text: body, ...(attachments.length ? { attachments } : {}), ...extra } });
          if (se) throw se; if (sr?.error) throw new Error(sr.error);
          await logSent(c, 'email', body, subject);
        } else {
          await quoCall('/v1/messages', { method: 'POST', body: { content: body, from, to: [quoNormPhone(c.phone)] } });
          await logSent(c, 'text', body);
        }
        sent++;
      } catch (_) { failed++; }
      setProgress(p => ({ done: p.done + 1, total: p.total }));
    }
    setResult({ sent, failed, skipped: skipped.length });
    setStep('done');
    if (bId) loadBatch(bId);
    if (onSent) onSent();
  }

  const totalToSend = cards.reduce((n, k) => n + ((drafts[k] && (drafts[k].body || '').trim()) ? buckets[k].length : 0), 0);
  const cardKey = cards[idx];
  const meta = DISC_STYLE_META[cardKey] || DISC_STYLE_META.neutral;
  const recip = buckets[cardKey] || [];

  const chip = (k, n, dim) => {
    const m = DISC_STYLE_META[k];
    return <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: `1px solid ${m.color}`, color: dim ? 'var(--text-3)' : m.color, opacity: dim ? 0.55 : 1 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />{k === 'neutral' ? 'No DISC' : k} · {n}
    </span>;
  };

  return (
    <div className="modal-overlay" onClick={() => step !== 'sending' && onClose && onClose()} style={{ zIndex: 1300 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '95%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 7, margin: 0 }}>
            <Icon name={isEmail ? 'mail' : 'message'} size={16} style={{ color: 'var(--accent)' }} />
            {isEmail ? 'Email' : 'Text'} {eligible.length} contact{eligible.length === 1 ? '' : 's'}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={() => step !== 'sending' && onClose && onClose()}>✕</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          {step === 'compose' && (<>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.5 }}>
              Type your message once. Ari rewrites it for each behavioral style, then each version sends only to the people who match it.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {DISC_LETTERS.map(k => chip(k, buckets[k].length, buckets[k].length === 0))}
              {hasNeutral && chip('neutral', buckets.neutral.length, false)}
              {skipped.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid var(--border)', color: 'var(--text-3)' }}>No {isEmail ? 'email' : 'phone'} · {skipped.length} skipped</span>}
            </div>
            {isEmail && (
              <input value={baseSubject} onChange={e => setBaseSubject(e.target.value)} placeholder="Subject (Ari tunes it per style)"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', marginBottom: 10 }} />
            )}
            <textarea value={base} onChange={e => setBase(e.target.value)} autoFocus rows={6} placeholder="What do you want to say? (e.g. Just checking in — let me know if you'd like an updated home value for your place.)"
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 14, lineHeight: 1.5, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>🔒 Locked lines <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>— added to every version, exactly as written</span></div>
              <textarea value={lockedLines} onChange={e => setLockedLines(e.target.value)} rows={3} placeholder={"Your sign-off, a P.S. — Ari won't touch these.\ne.g. Thanks for being in this with me,\nDara"}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13, lineHeight: 1.5, background: 'var(--bg-base)', border: '1px solid rgba(203,163,92,.3)', borderRadius: 10, color: 'var(--text-1)', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            {isEmail && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    📎 Attach files
                    <input type="file" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Same attachment(s) go to everyone.</span>
                </div>
                {attachErr && <div style={{ fontSize: 11.5, color: 'var(--red, #e0794f)', marginTop: 6 }}>{attachErr}</div>}
                {attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {attachments.map((a, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 999, background: 'var(--bg-base)', border: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text-1)', maxWidth: 220 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.filename}</span>
                        <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{fmtSize(a.size)}</span>
                        <button type="button" onClick={() => removeAttach(i)} aria-label={'Remove ' + a.filename} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!base.trim() || gen || eligible.length === 0} onClick={generate} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                {gen ? '✨ Ari is writing…' : '✨ Generate D/I/S/C drafts'}
              </button>
            </div>
          </>)}

          {step === 'review' && (
            <div
              onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
              onTouchEnd={e => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; touchX.current = null; if (dx < -45 && idx < cards.length - 1) { setIdx(idx + 1); setExpandList(false); } else if (dx > 45 && idx > 0) { setIdx(idx - 1); setExpandList(false); } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: meta.color, lineHeight: 1 }}>{cardKey === 'neutral' ? '–' : cardKey}</span>
                  <span><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>{meta.name}</span><span style={{ fontSize: 11, color: 'var(--text-3)' }}>{meta.tip}</span></span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{idx + 1} / {cards.length}</span>
              </div>

              <button type="button" onClick={() => recip.length && setExpandList(v => !v)}
                style={{ width: '100%', textAlign: 'left', background: 'var(--bg-base)', border: `1px solid ${recip.length ? meta.color : 'var(--border)'}`, borderRadius: 9, padding: '8px 11px', marginBottom: 10, cursor: recip.length ? 'pointer' : 'default', color: 'var(--text-2)', fontSize: 12 }}>
                {recip.length === 0
                  ? <span style={{ color: 'var(--text-3)' }}>No selected contacts have this style — this draft won’t be sent.</span>
                  : <><strong style={{ color: meta.color }}>{recip.length}</strong> {isEmail ? 'will be emailed' : 'will be texted'} this version<span style={{ color: 'var(--text-3)' }}> · {expandList ? 'hide' : 'show'} names</span></>}
                {expandList && recip.length > 0 && <div style={{ marginTop: 6, color: 'var(--text-3)', lineHeight: 1.5 }}>{recip.map(c => c.name).join(', ')}</div>}
              </button>

              {isEmail && (
                <input value={drafts[cardKey]?.subject || ''} onChange={e => setField(cardKey, 'subject', e.target.value)} placeholder="Subject"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 13.5, fontWeight: 600, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', marginBottom: 8 }} />
              )}
              <textarea value={drafts[cardKey]?.body || ''} onChange={e => setField(cardKey, 'body', e.target.value)} rows={isEmail ? 8 : 6}
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 14, lineHeight: 1.5, background: 'var(--bg-base)', border: `1px solid ${meta.color}55`, borderRadius: 10, color: 'var(--text-1)', resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5 }}>{!isEmail && `${(drafts[cardKey]?.body || '').length} chars · `}<code style={{ color: 'var(--accent)' }}>{'{first_name}'}</code> becomes each person’s first name on send.</div>
              {lockedLines.trim() && (
                <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 9, background: 'rgba(203,163,92,.07)', border: '1px dashed rgba(203,163,92,.4)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>🔒 Locked · same on every version</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{lockedLines}</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'center', gap: 7, margin: '14px 0 4px' }}>
                {cards.map((k, i) => (
                  <button key={k} onClick={() => { setIdx(i); setExpandList(false); }} aria-label={k}
                    style={{ width: i === idx ? 22 : 8, height: 8, borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0, background: i === idx ? DISC_STYLE_META[k].color : 'var(--border)', transition: 'width .15s' }} />
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => { setIdx(idx - 1); setExpandList(false); }}>‹ Prev</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setStep('compose')}>Edit message</button>
                <button className="btn btn-ghost btn-sm" disabled={idx === cards.length - 1} onClick={() => { setIdx(idx + 1); setExpandList(false); }}>Next ›</button>
              </div>
              {isEmail && (
                <button onClick={() => setTrackBlast(v => !v)} title="Get a per-recipient 'Likely seen' read signal. Off by default." style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: trackBlast ? 'var(--accent)' : 'var(--text-3)', marginTop: 12 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${trackBlast ? 'var(--accent)' : 'var(--text-3)'}`, background: trackBlast ? 'var(--accent)' : 'transparent', color: '#1a1300', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: 12 }}>{trackBlast ? '✓' : ''}</span>
                  Track opens — per-recipient "Likely seen"
                </button>
              )}
              <button className="btn btn-primary" disabled={totalToSend === 0} onClick={sendAll} style={{ width: '100%', marginTop: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Icon name={isEmail ? 'mail' : 'quo'} size={15} /> Send all ({totalToSend})
              </button>
            </div>
          )}

          {step === 'sending' && (
            <div style={{ padding: '18px 4px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 10, textAlign: 'center' }}>Sending… {progress.done} / {progress.total}</div>
              <div style={{ height: 8, background: 'var(--bg-base)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%`, background: 'var(--accent)', transition: 'width .2s' }} />
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div style={{ padding: '14px 4px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>Sent {result.sent} message{result.sent === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {result.failed > 0 && <div style={{ color: 'var(--red)' }}>{result.failed} failed to send.</div>}
                {result.skipped > 0 && <div>{result.skipped} skipped (no {isEmail ? 'email' : 'phone'} on file).</div>}
              </div>
              {batchId && (
                <div style={{ marginTop: 16, textAlign: 'left', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 12px', maxHeight: 260, overflowY: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Read tracking</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => loadBatch(batchId)} style={{ fontSize: 11 }}>↻ Refresh</button>
                  </div>
                  {batchRows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Sending… tap Refresh in a moment to see who's opened.</div>}
                  {batchRows.map((r, i) => {
                    const seen = r.status === 'likely_seen';
                    const machine = r.status === 'opened_machine';
                    const label = seen ? 'Likely seen' : machine ? 'Loaded (unconfirmed)' : 'Sent';
                    const col = seen ? 'var(--accent)' : machine ? 'var(--text-2)' : 'var(--text-3)';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: (DISC_STYLE_META[r.variant] || DISC_STYLE_META.neutral).color, color: '#000', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.variant && r.variant !== 'neutral' ? r.variant : '–'}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.to_address}</span>
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: col }}>{seen ? '👁 ' : ''}{label}{r.open_count > 1 ? ` ·${r.open_count}×` : ''}</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.4 }}>Times in EST. "Likely seen" filters out scanners &amp; Apple auto-loads. Apple Mail users may show as Loaded/unconfirmed.</div>
                </div>
              )}
              <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 16 }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
