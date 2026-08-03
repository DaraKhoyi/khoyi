import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../dataService';
import { Tip, Icon, lbl, today_ymd, useDictation, ymd, TipFor} from '../App';
import { logJournalEntry, mirrorJournalToTimeline } from '../lib/journalLog';

const JLINK_META = {
  contact:  { icon: <Icon name="contacts" size={11} />, color: '#60a5fa' },
  property: { icon: <Icon name="properties" size={11} />, color: '#34d399' },
  project:  { icon: <Icon name="folder" size={11} />, color: '#a78bfa' },
  deal:     { icon: <Icon name="deals" size={11} />, color: '#fbbf24' },
};

function fmtJDay(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }

function fmtJTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

function shiftDay(ymd, delta) { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + delta); return dt.toISOString().slice(0, 10); }



function AutoGrowTextarea({ value, minHeight = 120, maxHeight = 600, style, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight, maxHeight);
    el.style.height = h + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, maxHeight]);
  return <textarea ref={ref} value={value} style={{ ...style, minHeight, resize: 'none', overflow: 'hidden' }} {...rest} />;
}


function LinkChip({ link, onConfirm, onDismiss }) {
  const meta = JLINK_META[link.entity_type] || { icon: '•', color: 'var(--text-3)' };
  if (link.confirmed) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: meta.color, background: `${meta.color}1a`, border: `1px solid ${meta.color}55`, borderRadius: '999px', padding: '2px 9px' }}>{meta.icon} {link.label}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, color: 'var(--text-2)', background: 'var(--bg-hover)', border: '1px dashed var(--border)', borderRadius: '999px', padding: '2px 6px 2px 9px' }}>
      {meta.icon} {link.label}?
      <button onClick={onConfirm} title="Confirm link" style={{ border: 'none', background: 'var(--green)', color: '#fff', borderRadius: '50%', width: '17px', height: '17px', cursor: 'pointer', fontSize: '10px', lineHeight: 1 }}>✓</button>
      <button onClick={onDismiss} title="Dismiss" style={{ border: 'none', background: 'var(--bg-base)', color: 'var(--text-3)', borderRadius: '50%', width: '17px', height: '17px', cursor: 'pointer', fontSize: '10px', lineHeight: 1 }}>✕</button>
    </span>
  );
}


function jPad(n) { return String(n).padStart(2, '0'); }

function jFmt(dt) { return `${dt.getFullYear()}-${jPad(dt.getMonth() + 1)}-${jPad(dt.getDate())}`; }

function periodRange(mode, anchorYmd) {
  const [y, m, d] = anchorYmd.split('-').map(Number); const dt = new Date(y, m - 1, d);
  if (mode === 'week') {
    const dow = (dt.getDay() + 6) % 7; const mon = new Date(dt); mon.setDate(dt.getDate() - dow);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: jFmt(mon), end: jFmt(sun), key: `wk_${jFmt(mon)}`, label: `Week of ${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  return { start: jFmt(first), end: jFmt(last), key: `${y}-${jPad(m)}`, label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

function JournalStory({ userId, mode }) {
  const [anchor, setAnchor] = useState(today_ymd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const range = periodRange(mode, anchor);
  const isCurrent = (() => { const r = periodRange(mode, today_ymd()); return r.key === range.key; })();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: row } = await supabase.from('journal_periods').select('*').eq('user_id', userId).eq('period_type', mode).eq('period_key', range.key).maybeSingle();
    setData(row?.highlights || (row?.summary ? { story: row.summary } : null));
    setLoading(false);
  }, [userId, mode, range.key]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const { data: res } = await supabase.functions.invoke('journal-period-summary', { body: { period_type: mode, period_key: range.key, start: range.start, end: range.end } });
      if (res?.summary) setData(res.summary);
      else if (window.__notify) window.__notify(res?.message || 'No entries this period', 'warn');
    } catch (e) { if (window.__notify) window.__notify('Story failed', 'error'); }
    finally { setGenerating(false); }
  }
  function shift(dir) { setAnchor(prev => { const [y, m, d] = prev.split('-').map(Number); const dt = new Date(y, m - 1, d); if (mode === 'week') dt.setDate(dt.getDate() + dir * 7); else dt.setMonth(dt.getMonth() + dir); return jFmt(dt); }); }

  const sections = [['relationships', 'users', 'Relationships advanced'], ['deals_projects', 'chart', 'Files & projects moved'], ['wins', 'deals', 'Wins'], ['patterns', 'search', 'Patterns Ari noticed'], ['focus_next', 'target', `Focus next ${mode}`]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={() => shift(-1)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer' }}>◀</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', fontWeight: 700 }}>{range.label}{isCurrent && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '6px' }}>● current</span>}</div>
        <button onClick={() => shift(1)} disabled={isCurrent} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer', opacity: isCurrent ? 0.4 : 1 }}>▶</button>
      </div>
      {loading ? <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div> :
        !data ? (
          <div className="panel" style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '30px', marginBottom: '8px' }}><Icon name="calendar" size={30} style={{color:'var(--text-3)'}} /></div>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>Weave your {mode} into a story — the arc, who you advanced, what moved, and where to aim next.</p>
            <button onClick={generate} disabled={generating} className="btn btn-primary btn-sm">{generating ? 'Writing your story…' : <><Icon name="sparkles" size={13} /> Write my {mode}'s story</>}</button>
          </div>
        ) : (
          <div className="panel" style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(197,169,94,0.08), rgba(197,169,94,0.01))', border: '1px solid rgba(197,169,94,0.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 800, display:'inline-flex', alignItems:'center', gap:'5px' }}><Icon name="notes" size={12} /> The story of your {mode}</span>
              <button onClick={generate} disabled={generating} style={{ fontSize: '10px', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>{generating ? '…' : '↻ regenerate'}</button>
            </div>
            {data.story && <p style={{ fontSize: '14px', color: 'var(--text-1)', margin: '0 0 14px', lineHeight: 1.6 }}>{data.story}</p>}
            {sections.map(([k, ic, lbl]) => (Array.isArray(data[k]) && data[k].length ? (
              <div key={k} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '4px', display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name={ic} size={11} /> {lbl}</div>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>{data[k].map((x, i) => <li key={i} style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.55 }}>{x}</li>)}</ul>
              </div>
            ) : null))}
          </div>
        )}
    </div>
  );
}


function JournalView({ userId }) {
  const [day, setDay] = useState(today_ymd());
  const [mode, setMode] = useState('day');
  const [entries, setEntries] = useState([]);
  const [linksByEntry, setLinksByEntry] = useState({});
  const [actionsByEntry, setActionsByEntry] = useState({});
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);   // journal entry currently being edited
  const [draft, setDraft] = useState('');              // in-progress edited text
  const [savingEdit, setSavingEdit] = useState(false);
  // Shared-into-app (Web Share Target): a link/text shared from another app.
  useEffect(() => {
    const d = window.__pendingSharedText;
    if (!d) return;
    window.__pendingSharedText = null;
    const parts = [d.title, d.text, d.url].filter(Boolean);
    if (parts.length) setText(parts.join('\n'));
  }, []);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const taRef = useRef(null);
  const dict = useDictation((f) => setText(prev => { const sep = (!prev || /\s$/.test(prev)) ? '' : ' '; return prev + sep + f.trim() + ' '; }));
  const isToday = day === today_ymd();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: es } = await supabase.from('journal_entries').select('*').eq('user_id', userId).eq('day', day).order('occurred_at', { ascending: false });
    const list = es || [];
    setEntries(list);
    if (list.length) {
      const ids = list.map(e => e.id);
      const { data: ls } = await supabase.from('journal_links').select('*').in('entry_id', ids).eq('dismissed', false);
      const byE = {}; (ls || []).forEach(l => { (byE[l.entry_id] = byE[l.entry_id] || []).push(l); }); setLinksByEntry(byE);
    } else setLinksByEntry({});
    const { data: jd } = await supabase.from('journal_days').select('*').eq('user_id', userId).eq('day', day).maybeSingle();
    setSummary(jd?.highlights || (jd?.summary ? { recap: jd.summary } : null));
    setLoading(false);
  }, [userId, day]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = (e) => { if (e.detail?.day === day) load(); };
    window.addEventListener('journal-entry-added', h);
    return () => window.removeEventListener('journal-entry-added', h);
  }, [day, load]);

  async function save() {
    const content = text.trim();
    if (!content || saving) return;
    if (dict.recording) dict.stop();
    setSaving(true);
    try {
      const kind = /\s/.test(content) && dict.supported ? 'text' : 'text';
      const { entry, links, actions } = await logJournalEntry(userId, content, kind);
      setEntries(prev => [entry, ...prev]);
      setLinksByEntry(prev => ({ ...prev, [entry.id]: links }));
      if (actions && actions.length) setActionsByEntry(prev => ({ ...prev, [entry.id]: actions }));
      setText('');
      if (window.__notify) window.__notify('Logged', 'success');
    } catch (e) { if (window.__notify) window.__notify(e.message || 'Save failed — please try again.', 'error'); }
    finally { setSaving(false); }
  }
  async function confirmLink(entry, link) {
    setLinksByEntry(prev => ({ ...prev, [entry.id]: (prev[entry.id] || []).map(l => l.id === link.id ? { ...l, confirmed: true } : l) }));
    await supabase.from('journal_links').update({ confirmed: true }).eq('id', link.id);
    if (!link.interaction_id && JLINK_META[link.entity_type] && link.entity_type !== 'project') {
      const iid = await mirrorJournalToTimeline(userId, entry, link.entity_type, link.entity_id);
      if (iid) await supabase.from('journal_links').update({ interaction_id: iid }).eq('id', link.id);
    }
  }
  async function dismissLink(entry, link) {
    setLinksByEntry(prev => ({ ...prev, [entry.id]: (prev[entry.id] || []).filter(l => l.id !== link.id) }));
    await supabase.from('journal_links').update({ dismissed: true, confirmed: false }).eq('id', link.id);
    if (link.interaction_id) await supabase.from('contact_interactions').delete().eq('id', link.interaction_id);
  }
  async function makeTask(entryId, action, idx) {
    const { error } = await supabase.from('tasks').insert({ user_id: userId, title: action.title, due_date: action.due_date || null, priority: 'medium', completed: false, notes: `From journal · ${day}` });
    if (error) { if (window.__notify) window.__notify('Could not create task: ' + (error.message || error), 'error'); return; }
    setActionsByEntry(prev => ({ ...prev, [entryId]: (prev[entryId] || []).filter((_, i) => i !== idx) }));
    if (window.__notify) window.__notify('Task created', 'success');
  }
  async function deleteEntry(entry) {
    const ls = linksByEntry[entry.id] || [];
    for (const l of ls) { if (l.interaction_id) await supabase.from('contact_interactions').delete().eq('id', l.interaction_id); }
    const { error } = await supabase.from('journal_entries').delete().eq('id', entry.id);
    if (error) { if (window.__notify) window.__notify('Could not delete entry: ' + (error.message || error), 'error'); return; }
    setEntries(prev => prev.filter(e => e.id !== entry.id));
  }
  function startEdit(entry) { setEditingId(entry.id); setDraft(entry.content || ''); }
  function cancelEdit() { setEditingId(null); setDraft(''); }
  async function saveEdit(entry) {
    const next = draft.trim();
    if (!next) { if (window.__notify) window.__notify('Entry can’t be empty', 'warn'); return; }
    if (next === (entry.content || '').trim()) { cancelEdit(); return; }
    setSavingEdit(true);
    // Re-analyze links/actions on edit (content changed), same as a fresh entry.
    const { error } = await supabase.from('journal_entries')
      .update({ content: next, analyzed: false, updated_at: new Date().toISOString() })
      .eq('id', entry.id);
    setSavingEdit(false);
    if (error) { if (window.__notify) window.__notify('Could not save: ' + (error.message || error), 'error'); return; }
    // Clear the now-stale links/actions in the UI; re-analysis will repopulate.
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, content: next, analyzed: false } : e));
    setLinksByEntry(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
    setActionsByEntry(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
    cancelEdit();
    if (window.__notify) window.__notify('Entry updated', 'success');
    // Re-link/re-extract in the background (best-effort), then refresh this day.
    try { await supabase.functions.invoke('journal-analyze', { body: { entry_id: entry.id } }); load(); } catch (_) {}
  }
  async function summarize() {
    setSummarizing(true);
    try {
      const { data } = await supabase.functions.invoke('journal-daily-summary', { body: { day } });
      if (data?.summary) setSummary(data.summary);
      else if (window.__notify) window.__notify(data?.message || 'Nothing to summarize', 'warn');
    } catch (e) { if (window.__notify) window.__notify('Summary failed', 'error'); }
    finally { setSummarizing(false); }
  }
  async function runSearch() {
    if (!searchQ.trim()) return;
    setSearching(true); setSearchResults(null);
    try {
      const { data } = await supabase.functions.invoke('journal-search', { body: { query: searchQ, limit: 25 } });
      setSearchResults(data?.results || []);
    } catch (e) { setSearchResults([]); }
    finally { setSearching(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingBottom: '80px' }}>
      <TipFor screen="journal" />
      {/* Header */}
      <div className="fade-up">
        <div className="gold-move" style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: '11px', fontWeight: 700, display: 'inline-block', marginBottom: '2px' }}>Daily Journal</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '30px', fontWeight: 300, fontFamily: 'Fraunces, serif', letterSpacing: '-0.02em', margin: 0, display:'flex', alignItems:'center', gap:'10px' }}><Icon name="journal" size={24} style={{color:'var(--accent)',flexShrink:0}} />My Mindset</h2>
          <span style={{ flex: 1 }} />
          <button onClick={() => { setSearchOpen(o => !o); setSearchResults(null); setSearchQ(''); }} title="Search all days"
            style={{ width: '36px', height: '36px', borderRadius: '10px', border: '1px solid var(--border)', background: searchOpen ? 'var(--accent)' : 'var(--bg-hover)', color: searchOpen ? 'var(--bg-base)' : 'var(--text-2)', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="search" size={16} /></button>
        </div>
        <Tip id="capture" label="Capture beats recall">The best agents run on <b>captured</b> details, not remembered ones. A 20-second note today — what they said, what they want — turns a cold follow-up into a warm one next week. Everything you log trains Prism, too.</Tip>
        {!searchOpen && (
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
            {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '7px 0', borderRadius: '8px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', background: mode === m ? 'var(--accent)' : 'var(--bg-hover)', color: mode === m ? 'var(--bg-base)' : 'var(--text-2)' }}>{lbl}</button>
            ))}
          </div>
        )}
        {searchOpen ? (
          <div className="panel" style={{ padding: '12px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }} placeholder="Search every day — e.g. 'what did I discuss with the bakery tenant?'"
                style={{ flex: 1, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '9px', color: 'var(--text-1)', fontSize: '13px' }} />
              <button onClick={runSearch} disabled={searching} style={{ padding: '10px 16px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>{searching ? '…' : 'Go'}</button>
            </div>
            {searchResults && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {searchResults.length === 0 ? <p style={{ fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>No matches.</p> :
                  searchResults.map(r => (
                    <button key={r.id} onClick={() => { setDay(r.day); setSearchOpen(false); }} style={{ textAlign: 'left', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '9px', padding: '10px 12px', cursor: 'pointer' }}>
                      <div style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 700, marginBottom: '3px' }}>{fmtJDay(r.day)} · {fmtJTime(r.occurred_at)} · {(r.similarity * 100).toFixed(0)}% match</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-1)', lineHeight: 1.4 }}>{(r.content || '').slice(0, 160)}{(r.content || '').length > 160 ? '…' : ''}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ) : mode === 'day' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
            <button onClick={() => setDay(shiftDay(day, -1))} style={{ width: '34px', height: '34px', borderRadius: '9px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer' }}>◀</button>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-1)' }}>{fmtJDay(day)}</div>
              {!isToday && <button onClick={() => setDay(today_ymd())} style={{ fontSize: '11px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>→ Jump to today</button>}
            </div>
            <button onClick={() => setDay(shiftDay(day, 1))} disabled={isToday} style={{ width: '34px', height: '34px', borderRadius: '9px', border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-2)', cursor: 'pointer', opacity: isToday ? 0.4 : 1 }}>▶</button>
          </div>
        ) : null}
      </div>

      {!searchOpen && mode !== 'day' && <JournalStory userId={userId} mode={mode} />}

      {/* Composer (today only) */}
      {mode === 'day' && isToday && !searchOpen && (
        <div className="panel" style={{ padding: '16px', border: dict.recording ? '1px solid var(--red)' : '1px solid var(--border)', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-1)' }}>New entry</span>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>· {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            <span style={{ flex: 1 }} />
            {dict.recording && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--red)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s ease-in-out infinite' }} />listening…
              </span>
            )}
          </div>
          <AutoGrowTextarea value={text + (dict.interim ? (text && !/\s$/.test(text) ? ' ' : '') + dict.interim : '')} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder={"What happened? Who did you meet, what did they say, what's next?\n\nTip: name people, properties, projects or files and they'll auto-link to their records."}
            minHeight={220} maxHeight={640}
            style={{ width: '100%', padding: '16px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-1)', fontSize: '16px', boxSizing: 'border-box', lineHeight: 1.6, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {dict.supported && (
              <button onClick={() => dict.recording ? dict.stop() : dict.start()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '12px 18px', borderRadius: '999px', border: `1.5px solid ${dict.recording ? 'var(--red)' : 'var(--border)'}`, background: dict.recording ? 'rgba(239,68,68,0.12)' : 'var(--bg-hover)', color: dict.recording ? 'var(--red)' : 'var(--text-2)', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>
                {dict.recording ? <>⏹ Stop</> : <><Icon name="mic" size={13} /> Dictate</>}
              </button>
            )}
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''}</span>
            <span style={{ flex: 1 }} />
            <button onClick={save} disabled={saving || !text.trim()} style={{ padding: '12px 28px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: '999px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', opacity: (saving || !text.trim()) ? 0.5 : 1, boxShadow: (saving || !text.trim()) ? 'none' : '0 2px 10px rgba(197,169,94,0.3)' }}>{saving ? 'Logging…' : 'Log entry'}</button>
          </div>
        </div>
      )}

      {/* Day summary */}
      {mode === 'day' && !searchOpen && (summary ? (
        <div className="panel" style={{ padding: '14px', background: 'linear-gradient(135deg, rgba(197,169,94,0.08), rgba(197,169,94,0.01))', border: '1px solid rgba(197,169,94,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 800, display:'inline-flex', alignItems:'center', gap:'5px' }}><Icon name="sparkles" size={12} /> Day recap</span>
            <button onClick={summarize} disabled={summarizing} style={{ fontSize: '10px', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>{summarizing ? '…' : '↻ regenerate'}</button>
          </div>
          {summary.recap && <p style={{ fontSize: '13px', color: 'var(--text-1)', margin: '0 0 10px', lineHeight: 1.5 }}>{summary.recap}</p>}
          {[['people', 'users', 'People'], ['moved', 'tasks', 'Moved forward'], ['open', 'clock', 'Open loops'], ['tomorrow', 'target', 'Tomorrow']].map(([k, ic, lbl]) => (
            Array.isArray(summary[k]) && summary[k].length ? (
              <div key={k} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '3px', display:'inline-flex', alignItems:'center', gap:'4px' }}><Icon name={ic} size={11} /> {lbl}</div>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>{summary[k].map((x, i) => <li key={i} style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5 }}>{x}</li>)}</ul>
              </div>
            ) : null
          ))}
        </div>
      ) : (entries.length > 0 && (
        <button onClick={summarize} disabled={summarizing} className="panel" style={{ padding: '12px', textAlign: 'center', cursor: 'pointer', border: '1px dashed var(--border)', color: 'var(--accent)', fontWeight: 700, fontSize: '13px', background: 'var(--bg-card)' }}>
          {summarizing ? 'Summarizing your day…' : <><Icon name="sparkles" size={13} /> Summarize my day</>}
        </button>
      )))}

      {/* Timeline */}
      {mode === 'day' && !searchOpen && (loading ? <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div> :
        entries.length === 0 ? (
          <div className="panel" style={{ padding: '28px', textAlign: 'center' }}>
            <div style={{ marginBottom: '8px' }}><Icon name="journal" size={30} style={{color:'var(--text-3)'}} /></div>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>{isToday ? 'Your day is a blank page. Capture your first moment above — a call, a showing, a thought.' : 'Nothing logged this day.'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {entries.map(entry => {
              const links = linksByEntry[entry.id] || [];
              const actions = actionsByEntry[entry.id] || [];
              return (
                <div key={entry.id} className="panel" style={{ padding: '12px 14px', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmtJTime(entry.occurred_at)}</span>
                    {entry.kind === 'voice'
                      ? <span style={{ display:'inline-flex', opacity:0.6 }} title="Voice entry"><Icon name="mic" size={12} /></span>
                      : <button onClick={() => (editingId === entry.id ? cancelEdit() : startEdit(entry))} title="Edit entry" style={{ display:'inline-flex', background:'none', border:'none', padding:0, cursor:'pointer', color: editingId === entry.id ? 'var(--accent)' : 'var(--text-3)' }}><Icon name="edit" size={12} /></button>}
                    <span style={{ flex: 1 }} />
                    <button onClick={() => deleteEntry(entry)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '13px', opacity: 0.6 }}><Icon name="trash" size={14} /></button>
                  </div>
                  {editingId === entry.id ? (
                    <div>
                      <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={Math.max(3, draft.split('\n').length + 1)}
                        style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-1,#100D09)', border:'1px solid var(--accent)', borderRadius:'8px', color:'var(--text-1)', padding:'10px 12px', fontSize:'14px', lineHeight:1.55, fontFamily:'inherit', resize:'vertical' }} />
                      <div style={{ display:'flex', gap:'8px', marginTop:'8px', justifyContent:'flex-end' }}>
                        <button onClick={cancelEdit} disabled={savingEdit} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:'999px', padding:'6px 16px', fontSize:'13px', fontWeight:600, cursor:'pointer' }}>Cancel</button>
                        <button onClick={() => saveEdit(entry)} disabled={savingEdit} style={{ background:'var(--accent)', border:'none', color:'#100D09', borderRadius:'999px', padding:'6px 18px', fontSize:'13px', fontWeight:800, cursor:'pointer', opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '14px', color: 'var(--text-1)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{entry.content}</div>
                  )}
                  {(links.length > 0 || actions.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                      {links.map(l => <LinkChip key={l.id} link={l} onConfirm={() => confirmLink(entry, l)} onDismiss={() => dismissLink(entry, l)} />)}
                      {actions.map((a, i) => (
                        <button key={i} onClick={() => makeTask(entry.id, a, i)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--green)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '999px', padding: '3px 10px', cursor: 'pointer' }}>＋ Task: {a.title}{a.due_date ? ` (${a.due_date})` : ''}</button>
                      ))}
                    </div>
                  )}
                  {!entry.analyzed && links.length === 0 && actions.length === 0 && (
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '6px', fontStyle: 'italic' }}>linking…</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

// Floating one-tap capture — drops a timestamped entry into today's journal from
// anywhere in the app, then auto-links it in the background.

export default JournalView;
