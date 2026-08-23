// KnowledgeView — the Knowledge base screen.
// Extracted from App.js (strangle the monolith, step 24). Self-contained: it had
// zero dependencies on App.js scope, only supabase + React.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../dataService';

export default function KnowledgeView({ userId, isAdmin = false }) {
  const [tab, setTab] = React.useState('ask');
  // Ask
  const [q, setQ] = React.useState('');
  const [asking, setAsking] = React.useState(false);
  const [ans, setAns] = React.useState(null);
  // Add
  const [kind, setKind] = React.useState('text');
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [file, setFile] = React.useState(null);
  const [scope, setScope] = React.useState('private');
  const [teamId, setTeamId] = React.useState('');
  const [myTeams, setMyTeams] = React.useState([]);
  const [tagsStr, setTagsStr] = React.useState('');
  const [trust, setTrust] = React.useState('standard');
  const [adding, setAdding] = React.useState(false);
  const [addMsg, setAddMsg] = React.useState('');
  // Library
  const [sources, setSources] = React.useState([]);
  const [factsBySource, setFactsBySource] = React.useState({});
  const [linksBySource, setLinksBySource] = React.useState({});
  const [feedback, setFeedback] = React.useState(null);
  const [conflicts, setConflicts] = React.useState([]);
  const [recording, setRecording] = React.useState(false);
  const [audit, setAudit] = React.useState(null);
  const [evals, setEvals] = React.useState(null);
  const [evalQ, setEvalQ] = React.useState('');
  const [evalExp, setEvalExp] = React.useState('');
  const [evalRunning, setEvalRunning] = React.useState(false);
  const mediaRef = React.useRef(null);
  const chunksRef = React.useRef([]);

  const loadLib = React.useCallback(async () => {
    try {
      const [{ data: srcs }, { data: facts }, { data: links }, { data: conf }] = await Promise.all([
        supabase.from('knowledge_sources').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.rpc('my_knowledge_facts'),
        supabase.rpc('my_knowledge_links'),
        supabase.rpc('my_knowledge_conflicts'),
      ]);
      setSources(Array.isArray(srcs) ? srcs : []);
      setConflicts(Array.isArray(conf) ? conf : []);
      const fb = {}; (facts || []).forEach(x => { (fb[x.source_id] = fb[x.source_id] || []).push(x); }); setFactsBySource(fb);
      const lb = {}; (links || []).forEach(x => { (lb[x.source_id] = lb[x.source_id] || []).push(x); }); setLinksBySource(lb);
    } catch (_) {}
  }, []);
  async function sendFeedback(helpful) {
    setFeedback(helpful ? 'up' : 'down');
    try { await supabase.from('knowledge_usage').insert({ user_id: userId, surface: 'search', query: q.slice(0, 500), helpful, source_id: (ans && ans.citations && ans.citations[0] && ans.citations[0].source_id) || null }); } catch (_) {}
  }
  async function confirmLink(l) { const { error } = await supabase.from('knowledge_links').update({ confirmed: true }).eq('id', l.id); if (error) { if (window.__notify) window.__notify('Could not confirm: ' + (error.message || error), 'error'); return; } loadLib(); }
  async function removeLink(l) { const { error } = await supabase.from('knowledge_links').delete().eq('id', l.id); if (error) { if (window.__notify) window.__notify('Could not remove: ' + (error.message || error), 'error'); return; } loadLib(); }
  async function resolveConflict(id) { const { error } = await supabase.from('knowledge_conflicts').update({ resolved: true }).eq('id', id); if (error) { if (window.__notify) window.__notify('Could not resolve: ' + (error.message || error), 'error'); return; } loadLib(); }
  async function startRec() {
    setAddMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => { try { stream.getTracks().forEach(t => t.stop()); } catch (_) {} const mime = mr.mimeType || 'audio/webm'; const blob = new Blob(chunksRef.current, { type: mime }); await uploadAudio(blob, mime); };
      mediaRef.current = mr; mr.start(); setRecording(true);
    } catch (e) { setAddMsg('Microphone unavailable or permission denied.'); }
  }
  function stopRec() { try { mediaRef.current && mediaRef.current.stop(); } catch (_) {} setRecording(false); }
  async function uploadAudio(blob, mime) {
    setAdding(true); setAddMsg('Uploading & transcribing your voice note…');
    try {
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
      const path = `${userId}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now())}/dictation.${ext}`;
      const { error: upErr } = await supabase.storage.from('knowledge').upload(path, blob, { contentType: mime });
      if (upErr) { setAddMsg('Upload failed: ' + upErr.message); setAdding(false); return; }
      const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke('knowledge-ingest', { body: { kind: 'file', storage_path: path, mime_type: mime, filename: 'dictation.' + ext, title: title.trim() || 'Voice note', scope, team_id: scope === 'team' ? (teamId || null) : null, tags, trust_level: trust } });
      if (error || !data?.source_id) { setAddMsg('Could not add: ' + (error?.message || data?.error || 'unknown')); setAdding(false); return; }
      setTitle(''); setTagsStr(''); setAddMsg('Voice note saved — transcribing now.'); setTab('library'); loadLib();
    } catch (e) { setAddMsg(String(e)); }
    setAdding(false);
  }
  async function exportKnowledge() {
    try {
      const [{ data: srcs }, { data: facts }] = await Promise.all([
        supabase.from('knowledge_sources').select('title,scope,source_type,trust_level,tags,summary,created_at').order('created_at'),
        supabase.rpc('my_knowledge_facts'),
      ]);
      const payload = { exported_at: new Date().toISOString(), sources: srcs || [], facts: facts || [] };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'prismos-knowledge-export.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { if (window.__notify) window.__notify('Export failed', 'error'); }
  }
  const loadAudit = React.useCallback(async () => { try { const { data } = await supabase.rpc('knowledge_access_audit', { days_back: 30 }); setAudit(Array.isArray(data) ? data : []); } catch (_) { setAudit([]); } }, []);
  React.useEffect(() => { if (tab === 'audit' && audit === null) loadAudit(); }, [tab, audit, loadAudit]);
  async function reprocess(sc) { try { await supabase.functions.invoke('knowledge-ingest', { body: { reprocess: true, source_id: sc.id } }); if (window.__notify) window.__notify('Reprocessing…', 'success'); } catch (_) {} loadLib(); }
  const loadEvals = React.useCallback(async () => { try { const { data } = await supabase.from('knowledge_evals').select('*').order('created_at'); setEvals(Array.isArray(data) ? data : []); } catch (_) { setEvals([]); } }, []);
  React.useEffect(() => { if (tab === 'evals' && evals === null) loadEvals(); }, [tab, evals, loadEvals]);
  async function addEval() { if (!evalQ.trim()) return; { const { error } = await supabase.from('knowledge_evals').insert({ user_id: userId, question: evalQ.trim(), expected: evalExp.trim() || null }); if (error) { if (window.__notify) window.__notify('Could not add: ' + (error.message || error), 'error'); return; } } setEvalQ(''); setEvalExp(''); loadEvals(); }
  async function delEval(id) { const { error } = await supabase.from('knowledge_evals').delete().eq('id', id); if (error) { if (window.__notify) window.__notify('Could not delete: ' + (error.message || error), 'error'); return; } loadEvals(); }
  async function runEvals() {
    if (!evals || !evals.length) return; setEvalRunning(true);
    for (const ev of evals) {
      try { const { data } = await supabase.functions.invoke('knowledge-ask', { body: { query: ev.question, surface: 'search' } }); const ans = (data && data.answer) || ''; const pass = ev.expected ? ans.toLowerCase().includes(ev.expected.toLowerCase()) : null; await supabase.from('knowledge_evals').update({ last_answer: ans.slice(0, 2000), last_pass: pass, last_run_at: new Date().toISOString() }).eq('id', ev.id); } catch (_) {}
    }
    setEvalRunning(false); loadEvals();
  }
  React.useEffect(() => { loadLib(); (async () => { try { const { data } = await supabase.rpc('my_teams'); setMyTeams(Array.isArray(data) ? data : []); } catch (_) {} })(); }, [loadLib]);
  // poll while anything is processing
  React.useEffect(() => {
    if (!sources.some(s => s.status === 'processing' || s.status === 'pending')) return;
    const t = setInterval(loadLib, 4000); return () => clearInterval(t);
  }, [sources, loadLib]);

  async function runAsk() {
    if (!q.trim()) return;
    setAsking(true); setAns(null); setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-ask', { body: { query: q, surface: 'search' } });
      if (error || !data) { setAns({ answer: 'Something went wrong: ' + (error?.message || 'unknown'), citations: [] }); }
      else setAns(data);
    } catch (e) { setAns({ answer: String(e), citations: [] }); }
    setAsking(false);
  }

  async function addKnowledge() {
    setAddMsg('');
    if (kind === 'text' && !text.trim()) { setAddMsg('Paste some text first.'); return; }
    if (kind === 'url' && !url.trim()) { setAddMsg('Enter a link first.'); return; }
    if (kind === 'file' && !file) { setAddMsg('Choose a file first.'); return; }
    setAdding(true);
    try {
      const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      const base = { scope, team_id: scope === 'team' ? (teamId || null) : null, tags, trust_level: trust, title: title.trim() || undefined };
      let body;
      if (kind === 'file') {
        const path = `${userId}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now())}/${file.name}`;
        const { error: upErr } = await supabase.storage.from('knowledge').upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) { setAddMsg('Upload failed: ' + upErr.message); setAdding(false); return; }
        body = { ...base, kind: 'file', storage_path: path, mime_type: file.type, filename: file.name };
      } else if (kind === 'url') body = { ...base, kind: 'url', url: url.trim() };
      else body = { ...base, kind: 'text', text };
      const { data, error } = await supabase.functions.invoke('knowledge-ingest', { body });
      if (error || !data?.source_id) { setAddMsg('Could not add: ' + (error?.message || data?.error || 'unknown')); setAdding(false); return; }
      setTitle(''); setText(''); setUrl(''); setFile(null); setTagsStr('');
      setAddMsg('Added — processing now. It’ll be searchable in a moment.');
      setTab('library'); loadLib();
    } catch (e) { setAddMsg(String(e)); }
    setAdding(false);
  }

  async function del(s) {
    if (!window.confirm('Delete "' + (s.title || 'this item') + '" from your knowledge?')) return;
    // The empty catch meant a failed delete looked identical to a successful one:
    // the list reloaded, the row was still there, and nothing said why.
    const { error } = await supabase.from('knowledge_sources').delete().eq('id', s.id);
    if (error) {
      if (window.__notify) window.__notify('Could not delete that — it is still in your knowledge.', 'error');
      return;
    }
    loadLib();
  }

  const STAT = { ready: ['var(--green)', 'Ready'], processing: ['var(--yellow)', 'Processing…'], pending: ['var(--yellow)', 'Queued'], error: ['var(--red)', 'Error'] };
  const TABBTN = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid ' + (tab === id ? 'var(--accent)' : 'var(--border)'), background: tab === id ? 'rgba(197,169,94,0.12)' : 'transparent', color: tab === id ? 'var(--accent)' : 'var(--text-2)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div>
      <div className="page-header"><h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span>📚</span>Knowledge</h2><p>Feed the app what you know — notes, links, files — then ask it anything. Answers cite their source and stay within your scope.</p></div>
      <div style={{ maxWidth: '680px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>{TABBTN('ask', 'Ask')}{TABBTN('add', 'Add')}{TABBTN('library', 'Library')}{isAdmin && TABBTN('audit', 'Audit')}{isAdmin && TABBTN('evals', 'Evals')}</div>

        {tab === 'ask' && (
          <div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="form-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runAsk(); }} placeholder="Ask your knowledge anything…" style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={asking} onClick={runAsk}>{asking ? '…' : 'Ask'}</button>
            </div>
            {asking && <div style={{ marginTop: '14px', color: 'var(--text-3)', fontSize: '13px' }}>Searching your knowledge…</div>}
            {ans && (
              <div className="panel" style={{ marginTop: '14px' }}>
                <div className="panel-body">
                  <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{ans.answer}</div>
                  {ans.citations && ans.citations.length > 0 && (
                    <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '6px' }}>Sources</div>
                      {ans.citations.map(c => (
                        <div key={c.n} style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '6px' }}><b style={{ color: 'var(--accent)' }}>[{c.n}]</b> {c.title} <span style={{ color: 'var(--text-3)' }}>— {c.snippet}…</span></div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Helpful?</span>
                    <button onClick={() => sendFeedback(true)} style={{ background: feedback === 'up' ? 'rgba(197,169,94,0.2)' : 'transparent', border: '1px solid var(--border)', borderRadius: '7px', padding: '2px 9px', cursor: 'pointer', fontSize: '13px' }}>👍</button>
                    <button onClick={() => sendFeedback(false)} style={{ background: feedback === 'down' ? 'rgba(197,169,94,0.2)' : 'transparent', border: '1px solid var(--border)', borderRadius: '7px', padding: '2px 9px', cursor: 'pointer', fontSize: '13px' }}>👎</button>
                    {feedback && <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Thanks — noted.</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'add' && (
          <div className="panel"><div className="panel-body">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {[['text', 'Note'], ['url', 'Link'], ['file', 'File'], ['dictate', 'Dictate']].map(([k, l]) => (
                <button key={k} onClick={() => setKind(k)} style={{ flex: 1, padding: '8px', borderRadius: '9px', border: '1px solid ' + (kind === k ? 'var(--accent)' : 'var(--border)'), background: kind === k ? 'rgba(197,169,94,0.12)' : 'transparent', color: kind === k ? 'var(--accent)' : 'var(--text-2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <div className="form-group"><label className="form-label">Title (optional)</label><input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., WV Ave project notes" /></div>
            {kind === 'text' && <div className="form-group"><label className="form-label">Text</label><textarea className="form-input" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="Paste notes, facts, anything worth remembering…" /></div>}
            {kind === 'url' && <div className="form-group"><label className="form-label">Link</label><input className="form-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>}
            {kind === 'file' && <div className="form-group"><label className="form-label">File (PDF, image, audio, Word, or Excel)</label><input type="file" accept=".pdf,image/*,audio/*,.m4a,.mp3,.wav,.docx,.xlsx,.xls" onChange={e => setFile(e.target.files && e.target.files[0])} style={{ fontSize: '13px', color: 'var(--text-2)' }} /><div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>Audio gets transcribed automatically, then mined for facts like everything else.</div></div>}
            {kind === 'dictate' && (
              <div className="form-group"><label className="form-label">Voice note</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {!recording ? <button type="button" className="btn btn-primary" onClick={startRec} disabled={adding}>● Start recording</button>
                              : <button type="button" className="btn" onClick={stopRec} style={{ background: 'var(--red)', color: '#fff' }}>■ Stop & save</button>}
                  {recording && <span style={{ fontSize: '12px', color: 'var(--red)' }}>Recording…</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>Speak your note; on stop it's transcribed and mined for facts. Set the title/tags/scope above first.</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '1 1 150px' }}><label className="form-label">Who can see it</label>
                <select className="form-input" value={scope} onChange={e => setScope(e.target.value)}>
                  <option value="private">Private (only me)</option>
                  {myTeams.length > 0 && <option value="team">A team</option>}
                  {isAdmin && <option value="brokerage">Whole brokerage</option>}
                </select>
              </div>
              {scope === 'team' && <div className="form-group" style={{ flex: '1 1 150px' }}><label className="form-label">Team</label>
                <select className="form-input" value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">Choose…</option>{myTeams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}</select>
              </div>}
              <div className="form-group" style={{ flex: '1 1 150px' }}><label className="form-label">Trust</label>
                <select className="form-input" value={trust} onChange={e => setTrust(e.target.value)}><option value="standard">Standard</option><option value="authoritative">Authoritative</option><option value="draft">Draft</option></select>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Tags (comma-separated)</label><input className="form-input" value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="west virginia ave, zoning" /></div>
            {addMsg && <div style={{ fontSize: '12.5px', marginBottom: '10px', color: addMsg.startsWith('Added') ? 'var(--green)' : 'var(--red)' }}>{addMsg}</div>}
            {kind !== 'dictate' && <button className="btn btn-primary" disabled={adding} onClick={addKnowledge}>{adding ? 'Adding…' : 'Add to knowledge'}</button>}
          </div></div>
        )}

        {tab === 'library' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
              <button onClick={exportKnowledge} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>⬇ Export</button>
            </div>
            {conflicts.length > 0 && (
              <div className="panel" style={{ marginBottom: '12px', border: '1px solid var(--yellow)' }}>
                <div className="panel-body">
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--yellow)', marginBottom: '8px' }}>⚠ {conflicts.length} possible conflict{conflicts.length > 1 ? 's' : ''} in your knowledge</div>
                  {conflicts.map(c => (
                    <div key={c.id} style={{ fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                      <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{c.fact_key}</div>
                      <div>Now: <b>{c.new_value}</b> <span style={{ color: 'var(--text-3)' }}>({c.new_title})</span></div>
                      <div>Was: {c.old_value} <span style={{ color: 'var(--text-3)' }}>({c.old_title})</span></div>
                      <button onClick={() => resolveConflict(c.id)} style={{ marginTop: '4px', fontSize: '10px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>Dismiss</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sources.length === 0 && <div className="panel"><div className="panel-body"><div style={{ fontSize: '13px', color: 'var(--text-3)' }}>Nothing yet. Add a note, link, or file to get started.</div></div></div>}
            {sources.map(s => { const st = STAT[s.status] || ['var(--text-3)', s.status]; return (
              <div key={s.id} className="panel" style={{ marginBottom: '10px' }}><div className="panel-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: '14px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || '(untitled)'}</span>
                  <span style={{ fontSize: '10px', color: st[0], border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 6px', whiteSpace: 'nowrap' }}>{st[1]}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-3)' }}>{s.scope}{s.scope !== 'private' ? '' : ''}</span>
                  <button onClick={() => reprocess(s)} style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>Reprocess</button>
                  <button onClick={() => del(s)} style={{ fontSize: '13px', padding: '10px 14px', minHeight: 44, borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>Delete</button>
                </div>
                {s.summary && <div style={{ fontSize: '12.5px', color: 'var(--text-2)', marginTop: '5px' }}>{s.summary}</div>}
                {s.error && <div style={{ fontSize: '12px', color: 'var(--red)', marginTop: '4px' }}>{s.error}</div>}
                {s.tags && s.tags.length > 0 && <div style={{ marginTop: '6px', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>{s.tags.map((t, i) => <span key={i} style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-hover)', borderRadius: '6px', padding: '1px 7px' }}>{t}</span>)}</div>}
                {(factsBySource[s.id] || []).length > 0 && (
                  <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>Extracted facts</div>
                    {(factsBySource[s.id] || []).map(fx => (
                      <div key={fx.id} style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '2px' }}><span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{fx.fact_key}:</span> {fx.value_text}{fx.value_date ? <span style={{ color: 'var(--accent)' }}> ({fx.value_date})</span> : ''}</div>
                    ))}
                  </div>
                )}
                {(linksBySource[s.id] || []).length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>Linked records</div>
                    {(linksBySource[s.id] || []).map(l => (
                      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-1)' }}>{l.target_type}: {l.target_name || '(record)'}</span>
                        {l.confirmed ? <span style={{ fontSize: '10px', color: 'var(--green)' }}>✓ linked</span> : (<>
                          <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>suggested</span>
                          <button onClick={() => confirmLink(l)} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--green)', cursor: 'pointer' }}>Confirm</button>
                          <button onClick={() => removeLink(l)} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
                        </>)}
                      </div>
                    ))}
                  </div>
                )}
              </div></div>
            ); })}
          </div>
        )}

        {tab === 'audit' && (
          <div style={{ maxWidth: '680px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px' }}>Who used shared (team / brokerage) knowledge in the last 30 days. Private items are never shown here.</div>
            {audit === null && <div style={{ color: 'var(--text-3)', fontSize: '13px' }}>Loading…</div>}
            {audit && audit.length === 0 && <div className="panel"><div className="panel-body"><div style={{ fontSize: '13px', color: 'var(--text-3)' }}>No shared-knowledge access recorded yet.</div></div></div>}
            {audit && audit.map((r, i) => (
              <div key={i} className="panel" style={{ marginBottom: '8px' }}><div className="panel-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)' }}>{r.actor_name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 6px' }}>{r.surface}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-3)' }}>{new Date(r.used_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                {r.query && <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '3px' }}>“{r.query}”</div>}
                {r.source_title && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{r.source_scope} · {r.source_title}</div>}
              </div></div>
            ))}
          </div>
        )}

        {tab === 'evals' && (
          <div style={{ maxWidth: '680px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px' }}>Save real questions with an expected keyword, then Run all to measure retrieval quality as your knowledge grows.</div>
            <div className="panel" style={{ marginBottom: '12px' }}><div className="panel-body">
              <div className="form-group"><label className="form-label">Question</label><input className="form-input" value={evalQ} onChange={e => setEvalQ(e.target.value)} placeholder="When is the WV base drawing due?" /></div>
              <div className="form-group"><label className="form-label">Expected answer contains</label><input className="form-input" value={evalExp} onChange={e => setEvalExp(e.target.value)} placeholder="July 3" /></div>
              <button className="btn btn-primary btn-sm" onClick={addEval}>Add test</button>
            </div></div>
            {evals && evals.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{evals.filter(e => e.last_pass === true).length} passing of {evals.filter(e => e.last_pass === true || e.last_pass === false).length} run</span>
                <button className="btn btn-primary btn-sm" disabled={evalRunning} onClick={runEvals}>{evalRunning ? 'Running…' : 'Run all'}</button>
              </div>
            )}
            {evals && evals.map(ev => (
              <div key={ev.id} className="panel" style={{ marginBottom: '8px' }}><div className="panel-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {ev.last_pass === true && <span style={{ color: 'var(--green)' }}>✓</span>}
                  {ev.last_pass === false && <span style={{ color: 'var(--red)' }}>✕</span>}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>{ev.question}</span>
                  <button onClick={() => delEval(ev.id)} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
                </div>
                {ev.expected && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>Expect: {ev.expected}</div>}
                {ev.last_answer && <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>{ev.last_answer.slice(0, 300)}</div>}
              </div></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
