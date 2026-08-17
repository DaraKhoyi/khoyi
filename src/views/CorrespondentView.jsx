// CorrespondentView — The Correspondent.
//
// One seed in, one publishable piece out, then a per-person note. The screen is
// built around the fact that APPROVAL is where features like this die: the agent
// approves ONE object — the piece, the audience, the suppressions — not forty
// emails. Autonomy before approval is maximal; after approval it does exactly what
// was authorised and nothing more.
//
// It shows the angles it REJECTED alongside the one it chose, because the agent is
// judging the judgement, not just proofreading prose.
//
// "No story this week" is a first-class outcome, displayed as a decision rather
// than an error. Every content tool in real estate produces something every time,
// which is why its output gets deleted unread.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { canHover } from '../helpers';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 15, marginBottom: 12 };
const btn = { background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit' };
const ghost = { background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 15px', cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit' };

export default function CorrespondentView({ userId }) {
  const [seedKind, setSeedKind] = useState('zip');
  const [seedValue, setSeedValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [pieces, setPieces] = useState([]);
  const [open, setOpen] = useState(null);
  const [audience, setAudience] = useState(null);
  const [sends, setSends] = useState([]);
  const [tags, setTags] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('correspondent_pieces').select('*')
      .order('created_at', { ascending: false }).limit(30);
    setPieces(Array.isArray(data) ? data : []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { (async () => {
    try { const { data } = await supabase.rpc('tags_available'); setTags(Array.isArray(data) ? data : []); } catch (_) {}
  })(); }, []);

  const research = async () => {
    if (!seedValue.trim()) return;
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s?.session?.access_token;
      const r = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/correspondent-research', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_kind: seedKind, seed_value: seedValue.trim() }),
      });
      const d = await r.json();
      if (!d.ok) { if (window.__notify) window.__notify(d.error || 'Research failed.', 'error'); }
      else if (d.no_story && window.__notify) window.__notify('No story worth publishing: ' + (d.reason || ''), 'info');
      await load();
    } catch (e) { if (window.__notify) window.__notify(String(e), 'error'); }
    setBusy(false);
  };

  const showAudience = async (p) => {
    setOpen(p); setAudience(null);
    if (p.no_story) return;
    try { const { data } = await supabase.rpc('correspondent_audience', { p_piece: p.id }); setAudience(Array.isArray(data) ? data : []); } catch (_) { setAudience([]); }
  };

  // The piece as a branded newsletter. PDF opens print-ready; Word downloads and
  // opens editable. Both are produced server-side rather than from a print
  // stylesheet, because the export has to carry the licensed brokerage disclosure
  // and must refuse to make a failed compliance review look finished.
  const exportPiece = async (p, format) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;
      if (!token) { if (window.__notify) window.__notify('Please sign in again.', 'error'); return; }
      const url = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/correspondent-export'
        + '?t=' + encodeURIComponent(p.id) + '&format=' + format;
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) {
        const t = await res.text();
        if (window.__notify) window.__notify(t.replace(/<[^>]*>/g, '').trim() || 'Could not build the newsletter.', 'error');
        return;
      }
      if (format === 'docx') {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (p.slug || 'newsletter') + '.docx';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        return;
      }
      const html = await res.text();
      const w = window.open('', '_blank');
      if (!w) { if (window.__notify) window.__notify('Please allow pop-ups to open the newsletter.', 'error'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    } catch (e) {
      if (window.__notify) window.__notify('Could not build the newsletter: ' + (e.message || e), 'error');
    }
  };

  const publish = async (p) => {
    const { error } = await supabase.from('correspondent_pieces')
      .update({ status: 'published', published_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { if (window.__notify) window.__notify(error.message, 'error'); return; }
    if (window.__notify) window.__notify('Published. The notes can go out now.');
    await load(); setOpen({ ...p, status: 'published' });
  };

  // Personalize, then approve, then send — in that order, and each step refuses
  // to run before the one before it. The order is the safety.
  const personalize = async (p) => {
    setBusy('personalize');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/correspondent-personalize', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece_id: p.id }),
      });
      const d = await res.json();
      if (!d.ok) { if (window.__notify) window.__notify(d.error || 'Could not draft the notes.', 'error'); }
      else if (window.__notify) window.__notify(
        d.personal + ' personal note' + (d.personal === 1 ? '' : 's') + ', ' + d.newsletter_only +
        ' as newsletter (no specific fact on file — not faked).');
      await loadSends(p.id);
    } catch (e) { if (window.__notify) window.__notify(String(e), 'error'); }
    setBusy(null);
  };

  const loadSends = async (pid) => {
    const { data } = await supabase.from('correspondent_sends').select('*').eq('piece_id', pid).order('tier');
    setSends(Array.isArray(data) ? data : []);
  };

  const approve = async (p) => {
    const { data, error } = await supabase.rpc('correspondent_approve', { p_piece: p.id });
    if (error || data?.ok === false) { if (window.__notify) window.__notify(data?.error || error.message, 'error'); return; }
    if (window.__notify) window.__notify('Approved — ' + data.approved_personal + ' personal, ' + data.approved_newsletter + ' newsletter. Nothing has sent yet.');
    await load(); await loadSends(p.id); setOpen({ ...p, status: 'approved' });
  };

  const send = async (p) => {
    if (!window.confirm('Send now?\n\nThis goes out from your own email address, one message at a time. Only the notes you approved will send.')) return;
    setBusy('send');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/correspondent-send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + sess?.session?.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece_id: p.id }),
      });
      const d = await res.json();
      if (window.__notify) window.__notify(d.ok ? ('Sent ' + d.sent + (d.failed ? ', ' + d.failed + ' failed' : '')) : (d.error || 'Send failed'), d.ok ? 'info' : 'error');
      await load(); await loadSends(p.id);
    } catch (e) { if (window.__notify) window.__notify(String(e), 'error'); }
    setBusy(null);
  };

  const sending = audience ? audience.filter(a => !a.suppressed) : [];
  const held = audience ? audience.filter(a => a.suppressed) : [];

  return (
    <div className="ww-corr" style={{ padding: '18px 16px 100px' }}>
      <style>{`.ww-corr{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Autonomous</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>The Correspondent.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.55 }}>
        Give it a place, an interest, or a hunch. It researches, writes one piece worth reading, and tells you who should actually receive it — or tells you there's no story this week and stops.
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['zip', 'A place'], ['tag', 'An interest'], ['freehand', 'A hunch']].map(([k, l]) => (
            <button key={k} onClick={() => { setSeedKind(k); setSeedValue(''); }}
              style={{ ...ghost, background: seedKind === k ? 'rgba(203,163,92,.16)' : 'transparent',
                color: seedKind === k ? CHAMP : 'var(--text-3)', borderColor: seedKind === k ? 'rgba(203,163,92,.45)' : 'var(--border)' }}>{l}</button>
          ))}
        </div>
        {seedKind === 'tag' ? (
          <select value={seedValue} onChange={e => setSeedValue(e.target.value)}
            style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '11px', fontSize: 14, fontFamily: 'inherit' }}>
            <option value="">Choose a tag…</option>
            {tags.map(t => <option key={t.slug} value={t.slug}>{t.label}{t.uses ? ` (${t.uses})` : ''}</option>)}
          </select>
        ) : (
          <input value={seedValue} onChange={e => setSeedValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') research(); }}
            placeholder={seedKind === 'zip' ? 'e.g. 33549 or Lutz' : 'e.g. what the new flood maps did to insurance quotes in Pasco'}
            style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '11px', fontSize: 14, fontFamily: 'inherit' }} />
        )}
        <button onClick={research} disabled={busy || !seedValue.trim()} style={{ ...btn, marginTop: 10, width: '100%', opacity: busy ? .6 : 1 }}>
          {busy ? 'Researching — this takes a minute…' : 'Research it'}
        </button>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          It may come back with nothing. That's the point — a piece nobody needed teaches your list to ignore the next one.
        </div>
      </div>

      {open && (
        <div style={{ ...card, borderColor: 'rgba(203,163,92,.45)' }}>
          {open.no_story ? (
            <>
              <div style={{ fontSize: 12, color: GOLD, fontWeight: 700, letterSpacing: '.1em' }}>NO STORY</div>
              <div style={{ fontSize: 14.5, color: 'var(--text-1)', marginTop: 6, lineHeight: 1.6 }}>{open.no_story_reason}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Seed: {open.seed_value}. Nothing was sent and nothing is queued.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.35 }}>{open.title}</div>
              {open.dek && <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.55 }}>{open.dek}</div>}
              {open.angle && (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.55 }}>
                  <b style={{ color: CHAMP }}>Angle:</b> {open.angle}
                </div>
              )}
              {Array.isArray(open.angles_rejected) && open.angles_rejected.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.55 }}>
                  <b>Rejected:</b> {open.angles_rejected.map(a => a.angle).join(' · ')}
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-1)', lineHeight: 1.7, marginTop: 12,
                borderTop: '1px solid var(--border)', paddingTop: 12, maxHeight: 340, overflowY: 'auto' }}>{open.body_md}</div>
              {Array.isArray(open.sources) && open.sources.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.6 }}>
                  <b>Sources:</b> {open.sources.map((s, i) => <span key={i}>{s.publisher}{i < open.sources.length - 1 ? ' · ' : ''}</span>)}
                </div>
              )}
              {open.compliance && (
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10,
                  background: open.compliance.pass === false || (open.compliance.findings || []).length ? 'rgba(201,139,139,.10)' : 'rgba(203,163,92,.10)',
                  border: '1px solid ' + (open.compliance.pass === false || (open.compliance.findings || []).length ? 'rgba(201,139,139,.4)' : 'rgba(203,163,92,.3)') }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: (open.compliance.findings || []).length ? '#c98b8b' : CHAMP }}>
                    Fair housing review {(open.compliance.findings || []).length ? `— ${open.compliance.findings.length} to look at` : '— clean'}
                  </div>
                  {open.compliance.note && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>{open.compliance.note}</div>}
                  {(open.compliance.findings || []).slice(0, 4).map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
                      “{String(f.quote).slice(0, 90)}” — {f.problem}
                    </div>
                  ))}
                </div>
              )}

              {audience && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>
                    Who gets it: {sending.length} of {audience.length}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.55 }}>
                    {held.length} held back. A piece that goes to everyone is a broadcast.
                  </div>
                  {held.slice(0, 6).map(h => (
                    <div key={h.contact_id} style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 5 }}>
                      <span style={{ color: 'var(--text-2)' }}>{h.name}</span> — {h.suppressed_reason || 'held'}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {open.status !== 'published'
                  ? <button onClick={() => publish(open)} style={btn}>Publish the piece</button>
                  : <span style={{ fontSize: 12.5, color: CHAMP, alignSelf: 'center' }}>Published — notes can go out</span>}
                {open.published_at && (
                  <button onClick={() => personalize(open)} disabled={busy === 'personalize'} style={ghost}>
                    {busy === 'personalize' ? 'Writing notes…' : (sends.length ? 'Redraft the notes' : 'Draft the notes')}
                  </button>
                )}
                <button onClick={() => exportPiece(open, 'pdf')} style={ghost}>Newsletter (PDF)</button>
                <button onClick={() => exportPiece(open, 'docx')} style={ghost}>Newsletter (Word)</button>
                {sends.some(x => x.status === 'drafted' || x.status === 'newsletter_only') && (
                  <button onClick={() => approve(open)} style={btn}>Approve {sends.filter(x => x.status === 'drafted' || x.status === 'newsletter_only').length}</button>
                )}
                {sends.some(x => x.status === 'approved') && (
                  <button onClick={() => send(open)} disabled={busy === 'send'} style={btn}>
                    {busy === 'send' ? 'Sending…' : 'Send ' + sends.filter(x => x.status === 'approved').length}
                  </button>
                )}
                <button onClick={() => setOpen(null)} style={ghost}>Close</button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
                Publishing puts it at a real address of yours. Nothing is emailed to anyone until you approve the notes — and a note can't go out before the piece is live.
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '18px 0 6px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Recent</div>
      {pieces.length === 0 && <div style={{ ...card, color: 'var(--text-3)', fontSize: 13 }}>Nothing yet.</div>}
      {pieces.map(p => (
        <button key={p.id} onClick={() => showAudience(p)}
          onMouseEnter={e => { if (!canHover()) return; e.currentTarget.style.borderColor = 'rgba(203,163,92,.45)'; }}
          onMouseLeave={e => { if (!canHover()) return; e.currentTarget.style.borderColor = 'var(--border)'; }}
          style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', letterSpacing: '.06em' }}>
            {String(p.seed_kind).toUpperCase()} · {p.seed_value}
            {p.status === 'published' && <span style={{ color: CHAMP }}> · PUBLISHED</span>}
          </div>
          <div style={{ fontSize: 15, color: p.no_story ? 'var(--text-3)' : 'var(--text-1)', fontWeight: 600, marginTop: 4, lineHeight: 1.4 }}>
            {p.no_story ? 'No story this week' : p.title}
          </div>
        </button>
      ))}
    </div>
  );
}
