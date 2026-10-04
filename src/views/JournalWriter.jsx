import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useDictation } from './SharedUi';
import { todayNY } from '../clock';
import { logJournalEntry, loadRunningNote, saveRunningNote, reanalyzeEntry } from '../lib/journalLog';
import { supabase } from '../dataService';

// THE JOURNAL, FULL SCREEN (3 Oct 2026).
//
// Dara: "I don't want a little window inside the page. I kind of want a full
// screen… Once the note begins give me a full screen approach towards it. I like
// the editing tools at the bottom… include a date/time stamp button… one big
// note and keep coming back to it. Save its current state as I work on it and go
// away from it and then come back to it during the day."
//
// Three ways in, one screen:
//   running — TODAY'S NOTE. No Save button: it saves itself as you type, to the
//             server and to this phone, and reopens exactly where you left it.
//   short   — a quick note. "Log entry" files it under its time, as before.
//   edit    — an earlier note, reopened.
//
// The tool row sits on top of the keyboard: keyboard, dictate, time stamp,
// bullet, checklist, highlight, tidy, undo, redo. Notes stay plain text — a highlight is
// ==words== — so every note is still searchable, summarised and linked to the
// people it names. (Samsung's pen, eraser and lasso are handwriting tools; in a
// typed note their jobs are done by highlight, undo and the keyboard.)

const SANS = "'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const SERIF = "'Fraunces', Georgia, serif";
const LOCAL = (uid, day) => `prism.journal.running.${uid}.${day}`;
const SHORT = (uid) => `prism.journal.short.${uid}`;
const clock = (d = new Date()) => d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const dayLine = (d = new Date()) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
const writeLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

export default function JournalWriter({ userId, mode = 'running', entry = null, seedText = '', onClose }) {
  const day = todayNY();
  const [text, setText] = useState(mode === 'edit' ? (entry?.content || '') : '');
  const [ready, setReady] = useState(mode === 'edit');
  const [status, setStatus] = useState('');            // '', 'saving', 'saved 3:12 PM', 'offline'
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ top: 0, height: null });
  const taRef = useRef(null);
  const rowRef = useRef(mode === 'edit' ? entry : null);   // the running note's row once it exists
  const savedText = useRef(mode === 'edit' ? (entry?.content || '') : '');
  const analyzedText = useRef(mode === 'edit' ? (entry?.content || '') : '');
  const textRef = useRef(text); textRef.current = text;
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const pendingSel = useRef(null);
  const hist = useRef({ stack: [], at: -1, stamp: 0 });

  // ── history (undo / redo). Our own, because inserting a time stamp or a
  //    highlight changes the text from code, which wipes the browser's history.
  const remember = useCallback((value, force) => {
    const h = hist.current, now = Date.now();
    if (h.at >= 0 && h.stack[h.at] === value) return;
    if (!force && h.at >= 0 && now - h.stamp < 700 && h.at === h.stack.length - 1) { h.stack[h.at] = value; h.stamp = now; return; }
    h.stack = h.stack.slice(0, h.at + 1); h.stack.push(value);
    if (h.stack.length > 200) h.stack.shift();
    h.at = h.stack.length - 1; h.stamp = now;
  }, []);
  const [, bump] = useState(0);
  const apply = useCallback((value, sel, force = true) => {
    remember(textRef.current, true);
    setText(value); remember(value, force);
    if (sel != null) pendingSel.current = sel;
    bump((n) => n + 1);
  }, [remember]);
  const step = (dir) => {
    const h = hist.current; const to = h.at + dir;
    if (to < 0 || to >= h.stack.length) return;
    h.at = to; h.stamp = 0; setText(h.stack[to]); bump((n) => n + 1);
  };
  useLayoutEffect(() => {
    if (pendingSel.current == null || !taRef.current) return;
    const [a, b] = pendingSel.current; pendingSel.current = null;
    try { taRef.current.focus(); taRef.current.setSelectionRange(a, b == null ? a : b); } catch (_) {}
  });

  // ── open: bring back what was there. For today's note, the newer of the
  //    server's copy and this phone's copy wins — silently, never a prompt.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (mode === 'edit') { remember(entry?.content || '', true); return; }
      if (mode === 'short') {
        const d = readLocal(SHORT(userId));
        const t = seedText || (d && d.text) || '';
        if (alive) { setText(t); remember(t, true); setReady(true); }
        return;
      }
      // NOTHING TYPED MAY BE LOST TO THE LOAD (3 Oct). The box stays read-only
      // until the note is on screen: in testing, words typed while the saved note
      // was still arriving were wiped when it landed. And a slow network must not
      // lock the writer: after 5 seconds it opens on this phone's copy, and if the
      // server's copy turns up later with words this screen does not have, they
      // are put in ABOVE what was typed — neither side is dropped.
      const local = readLocal(LOCAL(userId, day));
      const fetching = loadRunningNote(userId, day).then((row) => ({ row }), () => ({ failed: true }));
      const first = await Promise.race([fetching, new Promise((r) => setTimeout(() => r({ slow: true }), 5000))]);
      if (!alive) return;
      const adopt = (row) => { rowRef.current = row; savedText.current = row ? (row.content || '') : ''; analyzedText.current = savedText.current; };
      const row = first.row || null;
      let t = row ? (row.content || '') : '';
      if (local && typeof local.text === 'string' && local.text !== t && (!row || new Date(local.at) > new Date(row.updated_at))) t = local.text;
      if (first.row !== undefined) adopt(row);
      setText(t); remember(t, true); setReady(true);
      if (row) setStatus('saved ' + clock(new Date(row.updated_at))); else if (first.failed || first.slow) setStatus('offline');
      pendingSel.current = [t.length, t.length];
      if (first.slow) fetching.then((late) => {
        if (!alive || !late.row) return;
        const theirs = String(late.row.content || ''), mine = textRef.current;
        adopt(late.row);
        if (theirs.trim() && !mine.includes(theirs.trim())) apply(theirs.replace(/\s+$/, '') + (mine.trim() ? '\n\n' + mine : ''), null);
        flush();
      });
    })();
    return () => { alive = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── today's note saves itself.
  const flush = useCallback(async () => {
    if (mode !== 'running' || saving.current) return;
    const value = textRef.current;
    if (value === savedText.current) return;
    if (!rowRef.current && !value.trim()) return;         // nothing written yet: do not create an empty note
    saving.current = true; setStatus('saving');
    try {
      const row = await saveRunningNote(userId, rowRef.current, value, day);
      const first = !rowRef.current;
      rowRef.current = row; savedText.current = value;
      setStatus('saved ' + clock());
      if (first) { try { window.dispatchEvent(new CustomEvent('journal-entry-added', { detail: { day } })); } catch (_) {} }
    } catch (_) { setStatus('offline'); }
    saving.current = false;
    if (textRef.current !== savedText.current) { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(flush, 1500); }
  }, [mode, userId, day]);

  useEffect(() => {
    if (!ready) return;
    if (mode === 'running') {
      writeLocal(LOCAL(userId, day), { text, at: new Date().toISOString() });   // this phone, at once
      clearTimeout(saveTimer.current); saveTimer.current = setTimeout(flush, 1200);
    } else if (mode === 'short') {
      writeLocal(SHORT(userId), text.trim() ? { text, at: new Date().toISOString() } : null);
    }
  }, [text, ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const hide = () => { if (document.hidden) flush(); };
    const on = () => flush();
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', on); window.addEventListener('online', on);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', on); window.removeEventListener('online', on); };
  }, [flush]);

  // ── the screen is the visible area above the keyboard, so the tools ride on it.
  useEffect(() => {
    const vv = window.visualViewport;
    const fit = () => setBox(vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight });
    fit();
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    window.addEventListener('resize', fit);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } window.removeEventListener('resize', fit); document.body.style.overflow = prev; };
  }, []);

  // ── dictation lands where the cursor is.
  const dict = useDictation((f) => {
    const ta = taRef.current; const v = textRef.current;
    const at = ta ? ta.selectionStart : v.length;
    const before = v.slice(0, at), after = v.slice(ta ? ta.selectionEnd : at);
    const piece = (before && !/\s$/.test(before) ? ' ' : '') + f.trim() + ' ';
    apply(before + piece + after, [before.length + piece.length], false);
  });

  // ── tools
  const sel = () => { const ta = taRef.current; return ta ? [ta.selectionStart, ta.selectionEnd] : [text.length, text.length]; };
  const stamp = () => {
    const [a, b] = sel(); const before = text.slice(0, a), after = text.slice(b);
    const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const s = lead + new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + clock() + ' — ';
    apply(before + s + after, [before.length + s.length]);
  };
  const bullet = () => {
    const [a] = sel(); const ls = text.lastIndexOf('\n', a - 1) + 1;
    if (text.slice(ls, ls + 2) === '• ') apply(text.slice(0, ls) + text.slice(ls + 2), [Math.max(ls, a - 2)]);
    else apply(text.slice(0, ls) + '• ' + text.slice(ls), [a + 2]);
  };
  const highlight = () => {
    const [a, b] = sel();
    if (a === b) { apply(text.slice(0, a) + '====' + text.slice(a), [a + 2]); return; }
    const picked = text.slice(a, b);
    if (/^==[\s\S]*==$/.test(picked)) apply(text.slice(0, a) + picked.slice(2, -2) + text.slice(b), [a, b - 4]);
    else apply(text.slice(0, a) + '==' + picked + '==' + text.slice(b), [a, b + 4]);
  };
  // ☐ / ☑ — a checklist, still plain text. Tap once for a box, again to tick it,
  // again to untick. Ticking also works by tapping the box in the day's list.
  const check = () => {
    const [a] = sel(); const ls = text.lastIndexOf('\n', a - 1) + 1; const head = text.slice(ls, ls + 2);
    if (head === '☐ ') apply(text.slice(0, ls) + '☑ ' + text.slice(ls + 2), [a]);
    else if (head === '☑ ') apply(text.slice(0, ls) + '☐ ' + text.slice(ls + 2), [a]);
    else if (head === '• ') apply(text.slice(0, ls) + '☐ ' + text.slice(ls + 2), [a]);
    else apply(text.slice(0, ls) + '☐ ' + text.slice(ls), [a + 2]);
  };
  // Tidy — proofread what was dictated, without shortening it (journal-tidy).
  // Works on the selected words, or the whole note. It goes in through the undo
  // history, so one tap of Undo brings the original words back.
  const [tidying, setTidying] = useState(false);
  const tidy = async () => {
    if (tidying) return;
    if (dict.recording) dict.stop();
    const [a, b] = sel(); const whole = a === b;
    const from = whole ? 0 : a, to = whole ? text.length : b;
    const piece = text.slice(from, to);
    const say = (m, k) => { if (window.__notify) window.__notify(m, k); };
    if (piece.trim().length < 12) { say('Write or dictate a little first — then Tidy cleans it up.', 'info'); return; }
    const snapshot = text;
    setTidying(true);
    try {
      const { data, error } = await supabase.functions.invoke('journal-tidy', { body: { text: piece } });
      let code = data && data.error;
      if (error && !code) { try { code = (await error.context.json()).error; } catch (_) { code = 'failed'; } }
      if (code === 'too_long') say('That is too long to tidy in one go — select a part of the note and tap Tidy again.', 'warn');
      else if (code === 'would_shorten') say('Tidy would have dropped some of your words, so nothing was changed.', 'warn');
      else if (code || !data || !data.tidied) say('Could not tidy just now — your note is unchanged.', 'error');
      else if (textRef.current !== snapshot) say('You kept writing, so Tidy left the note alone. Tap it again when you pause.', 'info');
      else {
        const lead = (piece.match(/^\s*/) || [''])[0], tail = (piece.match(/\s*$/) || [''])[0];
        const out = whole ? data.tidied : lead + data.tidied + tail;
        apply(text.slice(0, from) + out + text.slice(to), [from + out.length]);
        say('Tidied. Undo brings your own words back.', 'success');
      }
    } catch (_) { say('Could not tidy just now — your note is unchanged.', 'error'); }
    setTidying(false);
  };
  const keyboard = () => { const ta = taRef.current; if (!ta) return; if (document.activeElement === ta) ta.blur(); else ta.focus(); };
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); step(e.shiftKey ? 1 : -1); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {   // a bullet continues; an empty bullet ends the list
      const [a, b] = sel(); if (a !== b) return;
      const ls = text.lastIndexOf('\n', a - 1) + 1; const line = text.slice(ls, a);
      if (line === '• ' || line === '☐ ' || line === '☑ ') { e.preventDefault(); apply(text.slice(0, ls) + text.slice(a), [ls]); }
      else if (line.startsWith('• ')) { e.preventDefault(); apply(text.slice(0, a) + '\n• ' + text.slice(a), [a + 3]); }
      else if (line.startsWith('☐ ') || line.startsWith('☑ ')) { e.preventDefault(); apply(text.slice(0, a) + '\n☐ ' + text.slice(a), [a + 3]); }
    }
  };

  // ── leaving
  async function close() {
    if (dict.recording) dict.stop();
    if (mode === 'running') {
      clearTimeout(saveTimer.current);
      await flush();
      const row = rowRef.current;
      if (row && savedText.current === textRef.current) writeLocal(LOCAL(userId, day), null);   // the server has it; the phone copy has done its job
      if (row && savedText.current.trim().length > 20 && savedText.current !== analyzedText.current) reanalyzeEntry(userId, { ...row, content: savedText.current });
      onClose && onClose(true);
      return;
    }
    if (mode === 'edit') {
      const next = text.trim();
      if (!next) { if (window.__notify) window.__notify('A note can’t be empty — delete it from the day instead.', 'warn'); return; }
      if (next === (entry.content || '').trim()) { onClose && onClose(false); return; }
      setBusy(true);
      const { error } = await supabase.from('journal_entries').update({ content: next, analyzed: false, updated_at: new Date().toISOString() }).eq('id', entry.id);
      setBusy(false);
      if (error) { if (window.__notify) window.__notify('Could not save: ' + (error.message || error), 'error'); return; }
      reanalyzeEntry(userId, { ...entry, content: next });
      onClose && onClose(true);
      return;
    }
    onClose && onClose(false);   // a short note not yet logged stays on this phone
  }
  async function logShort() {
    const content = text.trim(); if (!content || busy) return;
    if (dict.recording) dict.stop();
    setBusy(true);
    try {
      await logJournalEntry(userId, content, 'text');
      writeLocal(SHORT(userId), null);
      if (window.__notify) window.__notify('Logged', 'success');
      onClose && onClose(true);
    } catch (e) { if (window.__notify) window.__notify(e.message || 'Save failed — your text is still here.', 'error'); }
    setBusy(false);
  }

  const h = hist.current;
  const title = mode === 'running' ? 'Today’s note' : mode === 'short' ? 'Quick note' : 'Edit note';
  const said = status === 'saving' ? 'Saving…' : status === 'offline' ? 'Saved on this phone — will sync' : status ? 'S' + status.slice(1) : '';
  const tool = (label, onTap, child, { on = false, off = false } = {}) => (
    <button type="button" aria-label={label} title={label} disabled={off}
      onMouseDown={(e) => e.preventDefault()} onClick={onTap}
      style={{ flex: '1 1 0', minWidth: 0, padding: 0, height: 48,   // the tools SHARE the width: they narrow on a small phone instead of scrolling (Dara, 3 Oct)
        border: 'none', background: on ? 'rgba(197,169,94,.18)' : 'transparent', borderRadius: 12,
        color: off ? 'rgba(246,241,231,.25)' : on ? '#EBCB82' : '#D8CFBE', fontFamily: SANS, fontSize: 17, fontWeight: 700, cursor: off ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{child}</button>
  );

  return (
    <div data-testid="journal-writer" role="dialog" aria-label={title}
      style={{ position: 'fixed', left: 0, right: 0, top: box.top, height: box.height == null ? '100dvh' : box.height, zIndex: 4000,
        background: '#100D09', display: 'flex', flexDirection: 'column', fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px', borderBottom: '1px solid rgba(246,241,231,0.07)' }}>
        <button type="button" aria-label="Back to the journal" onClick={close} disabled={busy}
          style={{ width: 44, height: 44, border: 'none', background: 'none', color: '#D8CFBE', fontSize: 26, cursor: 'pointer', flexShrink: 0 }}>{'‹'}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, color: '#F6F1E7', lineHeight: 1.2 }}>{title}</div>
          <div data-testid="journal-writer-status" style={{ fontSize: 12.5, color: '#9A917F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {mode === 'edit' ? dayLine(new Date(entry.occurred_at)) : dayLine()}{said ? ' · ' + said : ''}{dict.recording ? ' · listening…' : ''}
          </div>
        </div>
        {mode === 'short'
          ? <button type="button" onClick={logShort} disabled={busy || !text.trim()}
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', background: '#C5A95E', color: '#100D09', fontFamily: SANS, fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: (busy || !text.trim()) ? 0.5 : 1, flexShrink: 0 }}>{busy ? 'Logging…' : 'Log entry'}</button>
          : <button type="button" onClick={close} disabled={busy}
              style={{ minHeight: 44, padding: '0 14px', border: 'none', background: 'none', color: '#C5A95E', fontFamily: SANS, fontSize: 15, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>{busy ? 'Saving…' : 'Done'}</button>}
      </div>

      <textarea ref={taRef} data-testid="journal-writer-text" value={text + (dict.interim ? (text && !/\s$/.test(text) ? ' ' : '') + dict.interim : '')}
        onChange={(e) => { if (dict.interim) return; setText(e.target.value); remember(e.target.value, false); }}
        onKeyDown={onKey} autoFocus={mode !== 'running'} readOnly={!ready} data-ready={ready ? '1' : '0'}
        placeholder={ready ? 'What happened? Who did you meet, what did they say, what’s next?\n\nName people, properties, projects or files and they link to their records.' : 'Opening your note…'}
        style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', padding: '18px 20px 24px', border: 'none', outline: 'none', resize: 'none',
          background: 'transparent', color: '#F6F1E7', fontFamily: SANS, fontSize: 17, lineHeight: 1.65, WebkitOverflowScrolling: 'touch' }} />

      <div data-testid="journal-tools" style={{ display: 'flex', alignItems: 'center', gap: 0, overflow: 'hidden', padding: '4px 6px calc(env(safe-area-inset-bottom, 0px) + 4px)', background: '#1B1610', borderTop: '1px solid rgba(246,241,231,0.07)' }}>
        {tool('Show or hide the keyboard', keyboard, <span style={{ fontSize: 19 }}>{'⌨'}</span>)}
        {dict.supported && tool(dict.recording ? 'Stop dictating' : 'Dictate', () => (dict.recording ? dict.stop() : dict.start()), <Icon name="mic" size={19} />, { on: dict.recording })}
        {tool('Insert the date and time', stamp, <Icon name="clock" size={19} />)}
        {tool('Bullet', bullet, <span style={{ fontSize: 22, lineHeight: 1 }}>{'•'}</span>)}
        {tool('Checklist item — tap again to tick it', check, <span style={{ fontSize: 20, lineHeight: 1 }}>{'☑'}</span>)}
        {tool('Highlight', highlight, <span style={{ background: 'rgba(197,169,94,.45)', color: '#100D09', borderRadius: 4, padding: '0 6px', fontSize: 15, fontWeight: 800 }}>A</span>)}
        {tool(tidying ? 'Tidying…' : 'Tidy — clean up dictation without shortening it', tidy, tidying ? <span style={{ fontSize: 13 }}>{'…'}</span> : <Icon name="sparkles" size={19} />, { on: tidying })}
        {tool('Undo', () => step(-1), <span>{'↶'}</span>, { off: h.at <= 0 })}
        {tool('Redo', () => step(1), <span>{'↷'}</span>, { off: h.at >= h.stack.length - 1 })}
      </div>
    </div>
  );
}
