// AriRewriteButton — 'Ari rewrite' control: rewrites a draft (or a highlighted
// selection) in the user's voice, tuned to the recipient's DISC style.
// Extracted from App.js (strangle). Deps now all live in modules.
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { splitQuotedReply } from '../helpers';
import ForkTuningOverlay from './ForkTuningOverlay';

export default function AriRewriteButton({ text, onRewrite, contactName, discLabel, sourceText, contactId, textareaRef }) {
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState(null);
  const [err, setErr] = useState(null);
  const [scope, setScope] = useState(null); // remembers a selection-only rewrite for undo
  const [note, setNote] = useState(null);   // says what was actually rewritten
  const go = async () => {
    if (!text || !text.trim()) { setErr('Write a draft first.'); return; }
    // If the user has highlighted part of the draft, rewrite ONLY that — leave
    // the rest (e.g. a forwarded message below) untouched. Otherwise rewrite all.
    const ta = textareaRef && textareaRef.current;
    let selStart = -1, selEnd = -1, selected = '';
    if (ta && typeof ta.selectionStart === 'number' && ta.selectionEnd > ta.selectionStart) {
      selStart = ta.selectionStart; selEnd = ta.selectionEnd;
      selected = text.slice(selStart, selEnd);
    }
    // Precedence: an explicit highlight wins (most specific intent), otherwise
    // rewrite only the newly-composed part and leave the quoted thread alone.
    const usingSelection = selected.trim().length > 0;
    const split = usingSelection ? null : splitQuotedReply(text);
    if (!usingSelection && split && split.quoted && !split.body.trim()) {
      setErr('Write your reply above the quoted thread first.');
      return;
    }
    const autoScoped = !usingSelection && !!(split && split.quoted && split.body.trim());
    const toRewrite = usingSelection ? selected : (autoScoped ? split.body : text);
    setErr(null); setNote(null); setBusy(true);
    const { data, error } = await supabase.functions.invoke('ari-rewrite', { body:{ draft: toRewrite, contact_name:contactName||'the recipient', contact_id:contactId, disc_label:discLabel||'', source_text:sourceText||'' } });
    setBusy(false);
    if (error || data?.error || !data?.message) { setErr('Rewrite failed — try again.'); return; }
    setPrev(text);
    if (usingSelection) {
      // splice the rewritten selection back into the full draft, preserving
      // leading/trailing whitespace so surrounding text stays intact
      const rewritten = String(data.message);
      const next = text.slice(0, selStart) + rewritten + text.slice(selEnd);
      setScope({ start: selStart, len: rewritten.length });
      onRewrite(next);
      // restore a caret/selection around the rewritten span after render
      setTimeout(() => {
        if (ta) { try { ta.focus(); ta.setSelectionRange(selStart, selStart + rewritten.length); } catch (_) {} }
      }, 0);
    } else if (autoScoped) {
      // Reattach the thread exactly as it was — not re-generated, not reflowed.
      const rewritten = String(data.message).replace(/\s+$/, '');
      setScope(null);
      onRewrite(rewritten + '\n' + split.quoted);
      setNote('Rewrote your message — the quoted thread below was left untouched.');
    } else {
      setScope(null);
      onRewrite(data.message);
    }
  };
  const undo = () => { if (prev==null) return; onRewrite(prev); setPrev(null); setScope(null); };
  return (
    <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:'6px',marginBottom:'6px'}}>
      {busy && <ForkTuningOverlay contactName={contactName} discLabel={discLabel} />}
      {err && <span style={{fontSize:'10px',color:'var(--red)',marginRight:'auto'}}>{err}</span>}
      {!err && note && <span style={{fontSize:'10px',color:'var(--text-3)',marginRight:'auto'}}>{note}</span>}
      {prev!=null && <button type="button" className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'11px'}} onClick={undo}>Undo</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={go} title="Rewrite in your voice. Highlight part of the draft to rewrite only that." style={{padding:'2px 9px',fontSize:'11px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}>{busy?'✨ Ari is writing…':'✨ Ari rewrite'}</button>
    </div>
  );
}
