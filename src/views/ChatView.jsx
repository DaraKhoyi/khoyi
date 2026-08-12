// ChatView — the Ask Ari conversational screen.
// Extracted from App.js (strangle).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { Tip } from '../tipsUi';
import ChatMessageBubble from './ChatMessageBubble';
import PrismThinking from './PrismThinking';

export default function ChatView({ robots, userId, hasModeBar }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  // Image attachment state — single image at a time for simplicity
  const [pendingImageFile, setPendingImageFile] = useState(null);   // raw File
  const [pendingImagePreview, setPendingImagePreview] = useState(null);  // object URL for thumbnail
  const [uploadingImage, setUploadingImage] = useState(false);
  // Lightbox viewer
  const [viewerUrl, setViewerUrl] = useState(null);
  // Signed-URL cache for image_path → signed URL (refresh after near-expiry)
  const [signedUrls, setSignedUrls] = useState({});
  // Receipt category lookup for CTA card display
  const [taxCatMap, setTaxCatMap] = useState({});
  const [systemMap, setSystemMap] = useState({});
  const [taxCats, setTaxCats] = useState([]);        // business categories (tax_categories)
  const [personalCats, setPersonalCats] = useState([]); // personal categories (personal_budget_lines)
  const [leadSystems, setLeadSystems] = useState([]); // full list for the lead-gen dropdown
  // CTA card state — tracks which messages have had their receipt pushed
  const [receiptPushed, setReceiptPushed] = useState({});  // messageKey -> { ok, txId, error }
  const [receiptSaving, setReceiptSaving] = useState({});  // messageKey -> bool
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const robot = robots[0] || null;
  const robotId = robot?.id;

  // Load conversation history. Supports both legacy format
  // ({ user_message, assistant_response }) and current format
  // ({ role, content, image_path?, receipt_data? }).
  useEffect(() => {
    if (!robotId || !userId) { setLoadingHistory(false); return; }
    supabase
      .from('robot_conversations')
      .select('messages')
      .eq('user_id', userId)
      .eq('robot_id', robotId)
      .maybeSingle()
      .then(({ data }) => {
        const entries = Array.isArray(data?.messages) ? data.messages : [];
        const flat = [];
        for (const e of entries) {
          // Legacy paired-turn format
          if (e.user_message != null || e.assistant_response != null) {
            if (e.user_message) flat.push({ role: 'user', content: e.user_message });
            if (e.assistant_response) flat.push({ role: 'assistant', content: e.assistant_response });
            continue;
          }
          // Current per-turn format
          if (e.role && (typeof e.content === 'string' || e.image_path)) {
            const msg = { role: e.role, content: e.content || '' };
            if (e.image_path) msg.image_path = e.image_path;
            if (e.receipt_data) msg.receipt_data = e.receipt_data;
            if (e.research_action) msg.research_action = e.research_action;
            flat.push(msg);
          }
        }
        setMessages(flat);
        setLoadingHistory(false);
      });
  }, [robotId, userId]);

  // Load business + personal categories and lead-gen systems for the receipt card
  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from('tax_categories').select('id, name, is_meals_partial, sort_order').eq('user_id', userId),
      supabase.from('lead_gen_systems').select('id, name, is_archived').eq('user_id', userId),
      supabase.from('personal_budget_lines').select('id, category, sort_order, is_archived').eq('user_id', userId),
    ]).then(([tc, ls, pb]) => {
      const cats = (tc.data || []).map(c => ({ id: c.id, name: c.name, is_meals_partial: c.is_meals_partial, sort_order: c.sort_order }))
        .sort((a, b) => ((a.sort_order ?? 999) - (b.sort_order ?? 999)) || a.name.localeCompare(b.name));
      setTaxCats(cats);
      const tcMap = {}; cats.forEach(c => { tcMap[c.id] = c.name; });
      const pcats = (pb.data || []).filter(p => !p.is_archived).map(p => ({ id: p.id, name: p.category, is_meals_partial: false, sort_order: p.sort_order }))
        .sort((a, b) => ((a.sort_order ?? 999) - (b.sort_order ?? 999)) || a.name.localeCompare(b.name));
      setPersonalCats(pcats);
      pcats.forEach(p => { tcMap[p.id] = p.name; });  // so the pushed-summary label resolves for either scope
      setTaxCatMap(tcMap);
      const sys = (ls.data || []).filter(s => !s.is_archived).sort((a, b) => a.name.localeCompare(b.name));
      setLeadSystems(sys);
      const sMap = {}; sys.forEach(s => { sMap[s.id] = s.name; }); setSystemMap(sMap);
    });
  }, [userId]);

  // Add a new category on the fly to the correct list (business → tax_categories,
  // personal → personal_budget_lines). Re-uses an existing one if the name matches.
  const addCategory = useCallback(async (name, sc) => {
    const nm = (name || '').trim();
    if (!nm) return null;
    if (sc === 'personal') {
      const existing = personalCats.find(c => c.name.toLowerCase() === nm.toLowerCase());
      if (existing) return existing;
      const { data, error } = await supabase.from('personal_budget_lines')
        .insert({ user_id: userId, category: nm, monthly_amount: 0, sort_order: 999 })
        .select('id, category').single();
      if (error) { if (window.__notify) window.__notify('Could not add category: ' + error.message, 'error'); return null; }
      const obj = { id: data.id, name: data.category, is_meals_partial: false };
      setPersonalCats(prev => [...prev, obj]);
      setTaxCatMap(prev => ({ ...prev, [obj.id]: obj.name }));
      return obj;
    }
    const existing = taxCats.find(c => c.name.toLowerCase() === nm.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from('tax_categories')
      .insert({ user_id: userId, name: nm, schedule_c_line: '27a' })
      .select('id, name, is_meals_partial').single();
    if (error) { if (window.__notify) window.__notify('Could not add category: ' + error.message, 'error'); return null; }
    const obj = { id: data.id, name: data.name, is_meals_partial: data.is_meals_partial };
    setTaxCats(prev => [...prev, obj]);
    setTaxCatMap(prev => ({ ...prev, [obj.id]: obj.name }));
    return obj;
  }, [taxCats, personalCats, userId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Mint a signed URL for an image_path on first render and cache it
  const getSignedUrl = useCallback(async (imagePath) => {
    if (!imagePath) return null;
    if (signedUrls[imagePath]) return signedUrls[imagePath];
    const { data } = await supabase.storage.from('receipts').createSignedUrl(imagePath, 3600);
    const url = data?.signedUrl || null;
    if (url) setSignedUrls(prev => ({ ...prev, [imagePath]: url }));
    return url;
  }, [signedUrls]);

  // Cleanup the object URL when pending image changes / unmounts
  useEffect(() => {
    return () => {
      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    };
  }, [pendingImagePreview]);

  // Downscale + re-encode any picked photo to JPEG before upload. Makes receipts
  // work from iPhones (HEIC — which the server/Claude can't read, but iOS decodes
  // natively when the image is drawn to a canvas) and keeps large photos small.
  async function normalizeToJpeg(file) {
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const im = new window.Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = dataUrl; });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('dims');
    const scale = Math.min(1, 1600 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.85));
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  async function pickImage(file) {
    if (!file) return;
    const looksImage = (file.type || '').startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name || '');
    if (!looksImage) {
      if (window.__notify) window.__notify('Please choose an image', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      if (window.__notify) window.__notify('Image too large (25MB max)', 'error');
      return;
    }
    // Convert/downscale to JPEG; fall back to the original if it can't be processed.
    let outFile = file;
    try { outFile = await normalizeToJpeg(file); } catch (_) { outFile = file; }
    // Clean up previous preview URL
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImageFile(outFile);
    setPendingImagePreview(URL.createObjectURL(outFile));
  }

  function clearPendingImage() {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImageFile(null);
    setPendingImagePreview(null);
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !pendingImageFile) || sending || !robot) return;
    setSending(true);

    // Upload image (if any) first so we have a storage path to send
    let imagePath = null;
    let optimisticImageUrl = null;
    if (pendingImageFile) {
      setUploadingImage(true);
      try {
        const ext = (pendingImageFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
        const path = `${userId}/chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, pendingImageFile, {
          contentType: pendingImageFile.type || 'image/jpeg',
          upsert: false,
        });
        if (upErr) throw new Error('Upload failed: ' + upErr.message);
        imagePath = path;
        optimisticImageUrl = pendingImagePreview;  // reuse the object URL for instant display
        // Cache the object URL so the bubble shows immediately while signed URL is fetched
        setSignedUrls(prev => ({ ...prev, [path]: pendingImagePreview }));
      } catch (err) {
        if (window.__notify) window.__notify(err.message, 'error');
        setSending(false);
        setUploadingImage(false);
        return;
      } finally {
        setUploadingImage(false);
      }
    }

    // Optimistic user message
    const userMsg = { role: 'user', content: text };
    if (imagePath) userMsg.image_path = imagePath;
    const optimistic = [...messages, userMsg];
    setMessages(optimistic);
    setInput('');
    clearPendingImage();
    setTimeout(() => inputRef.current?.focus(), 50);

    const history = optimistic.slice(-21, -1)
      .map(m => {
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
        // Anthropic rejects any message with empty content. Drop truly-empty
        // turns; give image-only turns a minimal text placeholder so the
        // content is never empty.
        if (!hasText && !m.image_path) return null;
        return {
          role: m.role,
          content: hasText ? m.content : '(image)',
          ...(m.image_path ? { image_path: m.image_path } : {}),
        };
      })
      .filter(Boolean);

    try {
      const { data, error } = await supabase.functions.invoke('robot-chat', {
        body: { robot_id: robot.id, user_id: userId, message: text, history, image_path: imagePath },
      });
      if (error) throw error;
      const reply = data?.response || data?.reply || data?.content || '';
      const receiptData = data?.receipt_data || null;
      const researchAction = data?.research_action || null;
      if (reply || receiptData || researchAction) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.content === reply && !receiptData && !researchAction) return prev;
          const newMsg = { role: 'assistant', content: reply };
          if (receiptData) newMsg.receipt_data = receiptData;
          if (researchAction) newMsg.research_action = researchAction;
          return [...prev, newMsg];
        });
      } else if (data?.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Connection error: ${err.message || err}` }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, sending, robot, messages, userId, pendingImageFile, pendingImagePreview]);

  // Push a parsed receipt to the transactions table — wires Ari to accounting.
  // messageKey is the index of the assistant message holding the receipt_data.
  const pushReceiptToAccounting = useCallback(async (messageKey, receiptData, override) => {
    setReceiptSaving(prev => ({ ...prev, [messageKey]: true }));
    try {
      const scope = override?.scope || receiptData.scope || 'business';
      const amount = Math.abs(Number(receiptData.amount || 0));
      if (!amount) throw new Error('Missing amount on receipt');
      // Expense = negative; receipts default to expense unless explicitly income
      const signedAmount = -amount;
      const catId = override?.tax_category_id !== undefined ? override.tax_category_id : (receiptData.tax_category_id || null);
      const leadId = override?.lead_gen_system_id !== undefined ? override.lead_gen_system_id : (receiptData.lead_gen_system_id || null);
      const perId = override?.personal_budget_line_id !== undefined ? override.personal_budget_line_id : (receiptData.personal_budget_line_id || null);
      const payload = {
        user_id: userId,
        date: receiptData.date || new Date().toISOString().slice(0, 10),
        amount: signedAmount,
        scope,
        tax_category_id: scope === 'business' ? (catId || null) : null,
        lead_gen_system_id: scope === 'business' ? (leadId || null) : null,
        meals_who: override?.meals_who || null,
        meals_why: override?.meals_why || null,
        personal_budget_line_id: scope === 'personal' ? (perId || null) : null,
        payee: receiptData.vendor || null,
        description: receiptData.description_guess || null,
        account: null,
        receipt_url: receiptData.receipt_path || null,
        entered_via: 'photo',
        ai_confidence: receiptData.confidence ?? null,
      };
      const { data, error } = await supabase.from('transactions').insert(payload).select().single();
      if (error) throw error;
      setReceiptPushed(prev => ({ ...prev, [messageKey]: { ok: true, txId: data.id } }));
      if (window.__notify) window.__notify(`Added $${amount.toFixed(2)} to accounting`, 'success');
    } catch (err) {
      setReceiptPushed(prev => ({ ...prev, [messageKey]: { ok: false, error: err.message || String(err) } }));
      if (window.__notify) window.__notify('Save failed: ' + (err.message || err), 'error');
    } finally {
      setReceiptSaving(prev => ({ ...prev, [messageKey]: false }));
    }
  }, [userId]);

  // Handle Enter key — shift+enter = newline, enter = send
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // Auto-grow textarea
  const handleInput = useCallback((e) => {
    const ta = e.target;
    setInput(ta.value);
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  if (!robot) {
    return (
      <div>
        <div className="page-header"><h2>AI Assistant</h2><p>No assistant found</p></div>
        <div className="empty-state"><div className="empty-icon">🤖</div><p>No robots configured yet.</p></div>
      </div>
    );
  }

  const canSend = (input.trim() || pendingImageFile) && !sending && !uploadingImage;

  return (
    <div className={"chat-wrap ww-prism" + (hasModeBar ? " has-modebar" : "")}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .chat-robot-name{font-family:'Fraunces',serif;color:#F6F1E7;} .ww-prism .chat-bubble.assistant{background:linear-gradient(180deg,#1B1610,#18130D);border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .chat-bubble.user{background:rgba(203,163,92,.15);border:1px solid rgba(203,163,92,.32);color:#F6F1E7;}`}</style>
      {/* Robot header */}
      <div className="chat-robot-header">
        <div className="chat-robot-avatar">{robot.avatar_emoji || '🤖'}</div>
        <div>
          <div className="chat-robot-name">{robot.name}</div>
          <div className="chat-robot-role">{robot.role}</div>
        </div>
        <div className="online-dot" title="Online" />
      </div>

      <div style={{ padding: '10px 12px 0' }}>
        <Tip id="ari_research" label="Let Ari do the digging">Ask me to look up anyone in your world — try “<b>research Ali</b>” or “<b>who is Jane Doe</b>”. I’ll find the contact and run a full web research profile: who they are, their background, and how to connect. Add an <b>email, phone, or employer</b> and the results get sharper.</Tip>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {loadingHistory ? (
          <div className="chat-empty"><div className="spinner" style={{margin:'0 auto'}} /></div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <h3 style={{fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'34px',letterSpacing:'-0.02em',color:'#F6F1E7',margin:'0 0 10px',lineHeight:1.12}}>How can I help?</h3>
            <p style={{color:'#C8BFAE',fontSize:'14px',maxWidth:'36ch',margin:'0 auto',lineHeight:1.5}}>{robot.role || 'Your assistant'} — ask me anything, or tap 📷 to snap a receipt and I\'ll push it to accounting.</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:'8px',justifyContent:'center',marginTop:'18px'}}>
              {['What should I do next?','Look up a contact for me','Draft a follow-up to my newest lead','Summarize my week'].map(s => (
                <button key={s} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 30); }} style={{background:'transparent',border:'1px solid rgba(203,163,92,.34)',color:'#C8BFAE',fontFamily:'Manrope,sans-serif',fontSize:'12.5px',padding:'9px 14px',borderRadius:'100px',cursor:'pointer'}}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <ChatMessageBubble
              key={i}
              message={m}
              messageKey={i}
              getSignedUrl={getSignedUrl}
              signedUrls={signedUrls}
              onZoom={setViewerUrl}
              taxCatMap={taxCatMap}
              systemMap={systemMap}
              taxCats={taxCats}
              personalCats={personalCats}
              leadSystems={leadSystems}
              addCategory={addCategory}
              receiptPushed={receiptPushed[i]}
              receiptSaving={!!receiptSaving[i]}
              onPushReceipt={(override) => pushReceiptToAccounting(i, m.receipt_data, override)}
            />
          ))
        )}
        {sending && (
          <div className="chat-bubble-wrap assistant">
            <div className="chat-bubble assistant">
              <PrismThinking label="Ari is thinking" />
            </div>
          </div>
        )}
      </div>

      {/* Pending image preview chip */}
      {pendingImagePreview && (
        <div className="chat-pending-image">
          <img src={pendingImagePreview} alt="Attached" className="chat-pending-image-thumb"
            onClick={() => setViewerUrl(pendingImagePreview)} />
          <div className="chat-pending-image-info">
            <strong>Photo attached</strong>
            {uploadingImage ? 'Uploading…' : 'Ready to send'}
          </div>
          <button type="button" className="chat-pending-image-remove" onClick={clearPendingImage} title="Remove">×</button>
        </div>
      )}

      {/* Quick actions */}
      {!pendingImageFile && (
        <div style={{ display: 'flex', gap: 8, padding: '0 12px 8px', flexWrap: 'wrap' }}>
          <button type="button" disabled={sending}
            onClick={() => { setInput('Create a new contact from this business card.'); setTimeout(() => cameraInputRef.current?.click(), 0); }}
            title="Snap a business card and I'll save the contact"
            style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="camera" size={13} /> New contact
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="chat-input-bar">
        <button
          type="button"
          className="chat-attach-btn"
          onClick={() => cameraInputRef.current?.click()}
          disabled={sending}
          title="Take a photo"
          aria-label="Take a photo"
        >
          <Icon name="camera" size={18} />
        </button>
        <button
          type="button"
          className="chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          title="Attach from gallery"
          aria-label="Attach image"
          style={{fontSize:'16px'}}
        >
          <Icon name="paperclip" size={18} />
        </button>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
          style={{display:'none'}}
          onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={fileInputRef} type="file" accept="image/*"
          style={{display:'none'}}
          onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={pendingImageFile ? 'Add a caption (optional)…' : `Message ${robot.name}…`}
          rows={1}
          disabled={sending}
        />
        <button
          className="chat-send-btn"
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
        >
          ➤
        </button>
      </div>

      {/* Full-screen image viewer */}
      {viewerUrl && (
        <div className="chat-image-viewer" onClick={() => setViewerUrl(null)}>
          <img src={viewerUrl} alt="Full size" />
        </div>
      )}
    </div>
  );
}
