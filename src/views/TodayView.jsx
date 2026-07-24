import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../dataService';
import { CallFollowupsPanel } from '../App';
import CommitmentReview from './CommitmentReview';
import StaleDecide from './StaleDecide';
import { DelegationInbox, DelegationOutbox } from './TaskDelegation';
import { useNbaSkips } from '../nbaSkips';
import { buildNextActions, buildGrowthMoves, bounceSignals, docSignals } from '../../supabase/functions/robot-chat/nba.js';

// ── TodayView — the single calm command center ───────────────────────────────
// One question, answered: "what do I do next?" Everything the agent must decide
// is triaged FOR them into a short deck of batches, not shown as raw inventory.
// The Automation Dial (Manual → Aggressive) governs how much the AI does before
// the agent is asked. Default is Suggest (level 2): the AI thinks ahead, the
// agent approves — trust is earned before anything acts on its own.

const AUTO_LEVELS = [
  { n: 1, key: 'manual',     label: 'Manual',      blurb: 'Nothing acts on its own. The app shows you what needs doing; you do it all.' },
  { n: 2, key: 'suggest',    label: 'Suggest',     blurb: 'The AI prepares everything — drafts replies, flags stale work — but waits for your tap. Recommended while you build trust.' },
  { n: 3, key: 'batch',      label: 'Batch-approve', blurb: 'The AI drafts and cleans in bulk. You approve a whole batch in one tap instead of one at a time.' },
  { n: 4, key: 'aggressive', label: 'Aggressive',  blurb: 'Auto-pilot. The AI clears obvious work on its own and only surfaces what truly needs you — then reports what it did.' },
];

export default function TodayView({
  contacts = [], setContacts, tasks = [], setTasks, events = [], deals = [],
  gciGoal = 0, setView, myUserId = null, oweReplyMap = {}, setOweReplyMap,
  agentName = '', onOpenPlan,
}) {
  const now = Date.now();
  const todayISO = new Date().toISOString().slice(0, 10);

  // ── Automation dial ────────────────────────────────────────────────────────
  const [autoLevel, setAutoLevel] = useState(2);
  const [approvals, setApprovals] = useState(0);
  const [showDial, setShowDial] = useState(false);
  useEffect(() => {
    let go = true;
    (async () => {
      if (!myUserId) return;
      const { data } = await supabase.from('user_settings')
        .select('automation_level, automation_approvals').eq('user_id', myUserId).maybeSingle();
      if (!go || !data) return;
      setAutoLevel(data.automation_level || 2);
      setApprovals(data.automation_approvals || 0);
    })();
    return () => { go = false; };
  }, [myUserId]);
  const saveLevel = async (n) => {
    setAutoLevel(n); setShowDial(false);
    try { await supabase.from('user_settings').update({ automation_level: n }).eq('user_id', myUserId); } catch (_) {}
  };
  const bumpApprovals = useCallback(async (by = 1) => {
    const next = approvals + by; setApprovals(next);
    try { await supabase.from('user_settings').update({ automation_approvals: next }).eq('user_id', myUserId); } catch (_) {}
  }, [approvals, myUserId]);

  // ── NBA signals (the same engine the dashboard + Ari use) ───────────────────
  const [openSignals, setOpenSignals] = useState({});
  const [docActions, setDocActions] = useState([]);
  const [bounceActions, setBounceActions] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [flaggedEmail, setFlaggedEmail] = useState([]);
  const [pendingRec, setPendingRec] = useState(0);
  const [showBounces, setShowBounces] = useState(false);
  const [brief, setBrief] = useState(null);          // AI daily briefing narrative
  const [showBrief, setShowBrief] = useState(false);
  const [bounceRows, setBounceRows] = useState(null);

  useEffect(() => {
    let go = true;
    (async () => {
      try {
        const { data } = await supabase.from('ari_briefings')
          .select('summary, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (go && data?.summary) setBrief(data);
      } catch (_) {}
      try {
        const { data } = await supabase.from('email_bounces')
          .select('id, original_subject, failed_recipients, reason_code, bounced_at')
          .eq('handled', false).order('bounced_at', { ascending: false }).limit(10);
        if (go) setBounceActions(bounceSignals(data || []));
      } catch (_) {}
      try {
        const since = new Date(now - 30 * 86400000).toISOString();
        const { data } = await supabase.from('email_tracking')
          .select('contact_id,confident_open_at,open_count')
          .not('contact_id', 'is', null).not('confident_open_at', 'is', null)
          .gte('confident_open_at', since).order('confident_open_at', { ascending: false }).limit(300);
        const m = {}; for (const r of (data || [])) if (!m[r.contact_id]) m[r.contact_id] = r;
        if (go) setOpenSignals(m);
      } catch (_) {}
      try {
        const { data } = await supabase.from('documents')
          .select('id, title, doc_type, summary, action_label, signed_state, document_contacts(contact_id)')
          .eq('action_needed', true).eq('status', 'ready').order('created_at', { ascending: false }).limit(20);
        if (go) setDocActions(docSignals(data || [], contacts));
      } catch (_) {}
      try {
        const { data } = await supabase.from('commitments')
          .select('id, title, owner, contact_name, status, due_date')
          .eq('status', 'proposed').order('created_at', { ascending: false }).limit(50);
        if (go) setCommitments(data || []);
      } catch (_) {}
      try {
        const { data } = await supabase.from('recordings').select('id')
          .in('status', ['pending', 'review', 'transcribing']).limit(200);
        if (go) setPendingRec((data || []).length);
      } catch (_) {}
    })();
    return () => { go = false; };
  }, [contacts, now]);

  const { skipAction, filterSkipped } = useNbaSkips(myUserId);
  const actions = useMemo(() => {
    const base = buildNextActions({ contacts, tasks, events, deals, now, oweReplyMap, openSignals });
    const all = [...base, ...docActions, ...bounceActions].sort((a, b) => b.score - a.score);
    return filterSkipped(all);   // a skip has to outlive a recompute
  }, [contacts, tasks, events, deals, oweReplyMap, openSignals, docActions, bounceActions, now, filterSkipped]);

  // ── Triage groups (the deck) ────────────────────────────────────────────────
  const owe = useMemo(() => Object.keys(oweReplyMap || {}).length, [oweReplyMap]);
  const dueToday = useMemo(() => tasks.filter(t => !t.completed && t.due_date === todayISO).length, [tasks, todayISO]);
  const pastDue = useMemo(() => tasks.filter(t => !t.completed && t.due_date && t.due_date < todayISO).length, [tasks, todayISO]);
  // Stale is judged by AGE SINCE CREATION (the auto-scheduler keeps re-dating old
  // tasks forward, so due_date always looks recent and is useless as a signal).
  // Candidates come from the server RPC, which also applies the safety guardrails.
  const [groomCands, setGroomCands] = useState([]);
  const [showGroom, setShowGroom] = useState(false);
  const [groomSel, setGroomSel] = useState({});
  const [groomBusy, setGroomBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const loadGroom = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('groom_stale_preview', { p_min_age_days: 30 });
      setGroomCands(data || []);
    } catch (_) { setGroomCands([]); }
  }, []);
  useEffect(() => { loadGroom(); }, [loadGroom, tasks.length]);
  const staleTasks = groomCands.length;

  // ── "How you're doing" — the one thing worth keeping from the old Dashboard.
  // Deliberately at the BOTTOM: it should reward, not pressure.
  const progress = useMemo(() => {
    const dayISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const doneToday = tasks.filter(t => t.completed && (t.completed_at || '').slice(0, 10) === todayISO).length;
    const openToday = tasks.filter(t => !t.completed && t.due_date === todayISO).length;
    const total = doneToday + openToday;
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = dayISO(i);
      week.push(tasks.filter(t => t.completed && (t.completed_at || '').slice(0, 10) === d).length);
    }
    return { doneToday, total, pct: total > 0 ? doneToday / total : 0, week, weekTotal: week.reduce((a, b) => a + b, 0) };
  }, [tasks, todayISO]);

  const hero = actions[0] || null;
  const [heroIdx, setHeroIdx] = useState(0);
  const cur = actions[Math.min(heroIdx, Math.max(0, actions.length - 1))] || null;
  const totalOpen = actions.length;

  // Act on a hero CTA (mirror of the dashboard's runCta, kept minimal here).
  const runCta = (cta) => {
    if (!cta) return;
    if (cta.kind === 'task_done') {
      try { supabase.from('tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', cta.payload).then(() => {}); } catch (_) {}
      setTasks && setTasks(pr => pr.map(x => x.id === cta.payload ? { ...x, completed: true } : x));
      setHeroIdx(0); bumpApprovals();
    } else if (cta.kind === 'open_reply') {
      if (cta.email) { window.__inboxOpenEmail = cta.email; setView && setView('inbox'); }
      else if (cta.phone) { window.__quoTab = { tab: 'messages', phone: cta.phone, name: cta.name }; setView && setView('quo'); }
      else setView && setView('inbox');
    } else if (cta.kind === 'view') { setView && setView(cta.payload); }
    else if (cta.kind === 'call') { window.location.href = 'tel:' + cta.payload; }
    else if (cta.kind === 'bounces') { openBounces(); }
  };
  // Load the full bounce detail (who it didn't reach + why + how to fix) and show
  // it in a modal — instead of dropping the agent in a generic inbox with no idea
  // which message is the problem.
  const openBounces = async () => {
    setShowBounces(true); setBounceRows(null);
    try {
      const { data } = await supabase.from('email_bounces')
        .select('id, original_subject, failed_recipients, reason_code, reason_text, fix_hint, from_address, bounced_at, handled')
        .eq('handled', false).order('bounced_at', { ascending: false }).limit(25);
      setBounceRows(data || []);
    } catch (_) { setBounceRows([]); }
  };
  const markBounceHandled = async (id) => {
    try { await supabase.from('email_bounces').update({ handled: true, handled_at: new Date().toISOString() }).eq('id', id); } catch (_) {}
    setBounceRows(r => (r || []).filter(x => x.id !== id));
    setBounceActions(a => a.filter(x => x.key !== 'bounce:' + id));
    if (window.__notify) window.__notify('Marked handled.', 'success');
  };
  // Archive the selected stale tasks — reversible, logged, and undoable in one tap.
  const runGroom = async () => {
    const ids = Object.entries(groomSel).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) return;
    setGroomBusy(true);
    try {
      const { data, error } = await supabase.rpc('groom_stale_archive', { p_task_ids: ids, p_level: autoLevel });
      if (error || !data?.ok) { if (window.__notify) window.__notify('Could not archive: ' + (error?.message || data?.error || ''), 'error'); }
      else {
        setLastBatch(data.batch_id);
        setTasks && setTasks(pr => pr.filter(t => !ids.includes(t.id)));
        setShowGroom(false);
        if (window.__notify) window.__notify(`Cleared ${data.archived} tasks — tap Undo if that wasn't right.`, 'success');
        bumpApprovals(ids.length);
        loadGroom();
      }
    } catch (e) { if (window.__notify) window.__notify('Could not archive: ' + (e.message || e), 'error'); }
    setGroomBusy(false);
  };
  const undoGroom = async () => {
    if (!lastBatch) return;
    try {
      const { data } = await supabase.rpc('groom_undo', { p_batch_id: lastBatch });
      if (data?.ok) { if (window.__notify) window.__notify(`Restored ${data.restored} tasks.`, 'success'); setLastBatch(null); loadGroom(); }
    } catch (_) {}
  };

  // Park the selected tasks in Someday/Maybe — kept, but off the active list.
  const parkSomeday = async () => {
    const ids = Object.entries(groomSel).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) return;
    setGroomBusy(true);
    try {
      const { data, error } = await supabase.rpc('tasks_park_someday', { p_task_ids: ids, p_note: null });
      if (error || !data?.ok) { if (window.__notify) window.__notify('Could not park: ' + (error?.message || data?.error || ''), 'error'); }
      else {
        setLastBatch(data.batch_id);
        setTasks && setTasks(pr => pr.filter(t => !ids.includes(t.id)));
        setShowGroom(false);
        if (window.__notify) window.__notify(`Moved ${data.parked} to Someday/Maybe.`, 'success');
        loadGroom();
      }
    } catch (e) { if (window.__notify) window.__notify('Could not park: ' + (e.message || e), 'error'); }
    setGroomBusy(false);
  };

  const markReplied = (contactId) => {
    if (!contactId) return;
    try { supabase.from('contact_interactions').insert({ user_id: myUserId, contact_id: contactId, direction: 'outbound', channel: 'manual', occurred_at: new Date().toISOString(), brief: 'Marked replied' }).then(() => {}, () => {}); } catch (_) {}
    setOweReplyMap && setOweReplyMap(m => { const n = { ...m }; delete n[contactId]; return n; });
    setHeroIdx(0); bumpApprovals();
  };
  // No reply needed — handled elsewhere / no longer applies; you did NOT reply.
  const markNoReplyNeeded = (contactId) => {
    if (!contactId) return;
    const stampIso = (oweReplyMap && oweReplyMap[contactId]) || new Date().toISOString();
    try { supabase.from('contacts').update({ no_reply_needed_at: stampIso }).eq('id', contactId).then(() => {}, () => {}); } catch (_) {}
    setOweReplyMap && setOweReplyMap(m => { const n = { ...m }; delete n[contactId]; return n; });
    setContacts && setContacts(pr => pr.map(x => x.id === contactId ? { ...x, no_reply_needed_at: stampIso } : x));
    if (window.__notify) window.__notify('Cleared — no reply needed.', 'success');
    setHeroIdx(0);
  };

  const tagColor = (t) => t === 'bounce' || t === 'overdue' ? 'var(--red)' : t === 'reply' ? 'var(--yellow)' : t === 'appt' ? '#06b6d4' : t === 'deal' ? '#22c55e' : 'var(--accent)';
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const level = AUTO_LEVELS.find(l => l.n === autoLevel) || AUTO_LEVELS[1];

  // A group card in the triage deck.
  const Group = ({ icon, label, count, sub, tone, onOpen, actionLabel }) => {
    if (!count) return null;
    return (
      <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', marginBottom: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', border: '1px solid ' + (tone || 'var(--border)'), fontSize: 20 }}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, color: 'var(--text-1)', fontWeight: 600, fontFamily: 'Fraunces, serif' }}>{label}</div>
          {sub && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{sub}</div>}
        </div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, color: tone || 'var(--accent)' }}>{count}</div>
      </div>
    );
  };

  return (
    <div className="ww-prism" style={{ maxWidth: 720, margin: '0 auto' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:#2A2016;--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;--accent:#CBA35C;}`}</style>

      {/* Calm header */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--accent)', fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif' }}>TODAY</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 32, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: 0 }}>
            {greeting}{agentName ? ', ' + agentName.split(' ')[0] : ''}.
          </h1>
          <button onClick={() => setShowDial(s => !s)} title="Automation level"
            style={{ flexShrink: 0, background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 100, padding: '5px 12px', fontSize: 11.5, cursor: 'pointer' }}>
            ⚙ {level.label}
          </button>
        </div>
      </div>

      {/* Automation dial */}
      {showDial && (
        <div className="panel" style={{ padding: 16, marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>HOW MUCH SHOULD PRISM DO FOR YOU?</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>You can move this any time. Start where you're comfortable — Prism earns its way up.</div>
          {AUTO_LEVELS.map(l => (
            <div key={l.n} onClick={() => saveLevel(l.n)}
              style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', marginBottom: 6, background: l.n === autoLevel ? 'rgba(203,163,92,0.10)' : 'transparent', border: '1px solid ' + (l.n === autoLevel ? 'rgba(203,163,92,0.45)' : 'var(--border)') }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2, border: '2px solid ' + (l.n === autoLevel ? 'var(--accent)' : 'var(--text-3)'), background: l.n === autoLevel ? 'var(--accent)' : 'transparent' }} />
              <div>
                <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{l.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{l.blurb}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The one hero — Do this next */}
      {cur ? (
        <div style={{ position: 'relative', borderRadius: 20, padding: '22px 20px 18px', marginBottom: 18, background: 'radial-gradient(90% 130% at 100% 0%, rgba(203,163,92,0.16), transparent 55%), linear-gradient(180deg, #1B1610, #100D09)', border: '1px solid rgba(203,163,92,0.55)', boxShadow: '0 0 40px rgba(203,163,92,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#EBCB82' }}>✦ Do this next</span>
            {totalOpen > 1 && <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700 }}>{Math.min(heroIdx + 1, totalOpen)} / {totalOpen}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'var(--bg-base)', border: '1px solid ' + tagColor(cur.tag), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>◆</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 21, fontFamily: 'Fraunces, serif', fontWeight: 300, letterSpacing: '-0.01em', color: '#F6F1E7', lineHeight: 1.18 }}>{cur.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.4 }}>{cur.why}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {cur.cta && <button className="btn btn-primary btn-sm" onClick={() => runCta(cur.cta)}>{cur.cta.label}</button>}
            {cur.tag === 'reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={() => markReplied(cur.contactId)}>✓ Replied</button>}
            {cur.tag === 'reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={() => markNoReplyNeeded(cur.contactId)} title="No reply is needed — handled elsewhere or no longer applies">No reply needed</button>}
            {totalOpen > 1 && <button className="btn btn-ghost btn-sm" title="Not now — hide this until tomorrow" onClick={() => { skipAction(cur); setHeroIdx(0); }}>Skip</button>}
            {onOpenPlan && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenPlan()}>Plan my day</button>}
          </div>
        </div>
      ) : (
        <div style={{ borderRadius: 20, padding: '28px 20px', marginBottom: 18, textAlign: 'center', background: 'linear-gradient(180deg, #1B1610, #100D09)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>✦</div>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 300, color: 'var(--text-1)' }}>You're clear.</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Nothing urgent. A great moment to reach out to someone new.</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setView && setView('prospecting')}>See growth moves</button>
        </div>
      )}

      {/* The day, narrated — folded in from the old Planning briefing */}
      {brief?.summary && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowBrief(v => !v)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 13px',
              color: 'var(--text-2)', fontSize: 12.5, cursor: 'pointer' }}>
            <span style={{ color: 'var(--accent)' }}>❋</span>
            <span style={{ flex: 1 }}>{showBrief ? 'Hide the briefing' : 'Read my briefing'}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{showBrief ? '▴' : '▾'}</span>
          </button>
          {showBrief && (
            <div style={{ marginTop: 8, padding: '13px 15px', borderRadius: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {brief.summary}
            </div>
          )}
        </div>
      )}

      {/* The triage deck — batches, not inventory */}
      <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-3)', fontWeight: 700, marginBottom: 10, fontFamily: 'Barlow Condensed, sans-serif' }}>YOUR DAY, TRIAGED</div>

      <Group icon="↩" label="Replies you owe" count={owe} tone="var(--yellow)"
        sub={autoLevel >= 2 ? 'Prism can draft these in your voice' : 'People waiting to hear back'}
        onOpen={() => setView && setView('contacts')} />

      <Group icon="✓" label="Call commitments to confirm" count={commitments.length} tone="var(--accent)"
        sub="Pulled from your calls & recordings — confirm or dismiss" onOpen={() => setView && setView('review')} />

      <Group icon="◷" label="Due today" count={dueToday} tone="#06b6d4"
        sub="Tasks scheduled for today" onOpen={() => setView && setView('tasks')} />

      <Group icon="✱" label="Flagged for your review" count={flaggedEmail.length} tone="var(--accent)"
        sub="Emails that need a decision" onOpen={() => setView && setView('inbox')} />

      <Group icon="◉" label="Recordings to process" count={pendingRec} tone="var(--text-3)"
        sub="Transcribe & pull action items" onOpen={() => setView && setView('review')} />

      {/* Planning decisions live here, not in the Tasks list */}
      {/* Somebody is blocked waiting on your yes or no — that outranks your own
          grooming, so it sits above the review queues. */}
      <DelegationInbox userId={myUserId}
        onChanged={() => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} }} />
      <DelegationOutbox userId={myUserId}
        onChanged={() => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} }} />
      <CommitmentReview userId={myUserId} onChanged={() => { try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {} }} />
      <StaleDecide tasks={tasks} setTasks={setTasks} userId={myUserId} />

      {/* Follow-ups pulled from your calls — planning belongs here, not in the dialer */}
      <CallFollowupsPanel userId={myUserId} contacts={contacts} setTasks={setTasks} />

      {/* Stale backlog — offered as cleanup, NOT shown as a wall of shame */}
      {staleTasks > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'rgba(140,132,117,0.06)', border: '1px dashed var(--border)', marginTop: 4 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{staleTasks} tasks have been open for a month or more.</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{autoLevel >= 3 ? 'Prism can clear these in one tap — fully reversible.' : 'Old tasks make the list feel heavier than it is.'}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setGroomSel(Object.fromEntries(groomCands.map(g => [g.task_id, true]))); setShowGroom(true); }}>Review →</button>
        </div>
      )}

      {/* Honest footer: what's NOT being shown, and why that's on purpose */}
      {pastDue > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
          You have {pastDue} past-due tasks. They're not gone — Prism is just keeping today focused on what matters most.
          <br /><button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5, padding: 4 }} onClick={() => setView && setView('tasks')}>See everything</button>
        </div>
      )}
      {/* How you're doing — reward at the end of the work, not a gate at the start */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10.5, letterSpacing: 1.6, color: 'var(--text-3)', fontWeight: 700, marginBottom: 10, fontFamily: 'Barlow Condensed, sans-serif' }}>HOW YOU'RE DOING</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ position: 'relative', width: 62, height: 62, flexShrink: 0 }}>
            <svg width="62" height="62" viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="27" fill="none" stroke="var(--border)" strokeWidth="5" />
              <circle cx="31" cy="31" r="27" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${Math.round(progress.pct * 169.6)} 169.6`} transform="rotate(-90 31 31)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'Fraunces, serif', fontSize: 17, color: 'var(--text-1)' }}>
              {progress.doneToday}
            </div>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-1)' }}>
              {progress.doneToday === 0 ? 'Nothing checked off yet today.' : `${progress.doneToday} done today.`}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 7 }}>{progress.weekTotal} in the last 7 days</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 26 }}>
              {progress.week.map((n, i) => {
                const max = Math.max(1, ...progress.week);
                return <div key={i} title={`${n} done`} style={{ flex: 1, height: `${Math.max(3, (n / max) * 26)}px`, borderRadius: 2, background: i === 6 ? 'var(--accent)' : 'rgba(203,163,92,0.32)' }} />;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bounce detail — "what happened" to the emails that didn't arrive */}
      {showBounces && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={e => e.target === e.currentTarget && setShowBounces(false)}>
          <div className="modal" style={{ maxWidth: 620, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="modal-header"><h3 style={{ margin: 0 }}>Emails that didn't arrive</h3><button className="modal-close" onClick={() => setShowBounces(false)}>×</button></div>
            {bounceRows === null && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Checking…</p>}
            {bounceRows && bounceRows.length === 0 && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>All clear — everything you've sent was accepted for delivery.</p>}
            {(bounceRows || []).map(b => (
              <div key={b.id} style={{ border: '1px solid rgba(203,163,92,.3)', borderRadius: 12, padding: 14, marginBottom: 12, background: 'linear-gradient(180deg,#1B1610,#100D09)' }}>
                <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: '#F6F1E7', marginBottom: 4 }}>{b.original_subject || '(no subject)'}</div>
                <div style={{ fontSize: 11.5, color: '#E4DCCB', marginBottom: 8 }}>sent {b.bounced_at ? new Date(b.bounced_at).toLocaleString() : ''}{b.from_address ? ' · from ' + b.from_address : ''}</div>
                <div style={{ fontSize: 12.5, color: '#e0965a', fontWeight: 700, marginBottom: 6 }}>Didn't reach {(b.failed_recipients || []).length || 'anyone'}: {(b.failed_recipients || []).join(', ')}</div>
                {b.fix_hint && <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{b.fix_hint}</div>}
                {b.reason_text && <details style={{ marginBottom: 8 }}><summary style={{ fontSize: 11.5, color: 'var(--text-3)', cursor: 'pointer' }}>What the mail server said</summary><pre style={{ fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{b.reason_text}</pre></details>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => { window.__composeEmail && window.__composeEmail((b.failed_recipients || [])[0] || '', b.original_subject ? 'Re: ' + b.original_subject : ''); setShowBounces(false); }}>Resend</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => markBounceHandled(b.id)}>✓ Handled</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Stale-task review — the groomer proposes, you decide. Always reversible. */}
      {showGroom && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={e => e.target === e.currentTarget && setShowGroom(false)}>
          <div className="modal" style={{ maxWidth: 640, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="modal-header"><h3 style={{ margin: 0 }}>Clear out old tasks</h3><button className="modal-close" onClick={() => setShowGroom(false)}>×</button></div>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 0 }}>
              These have been open a month or more. Decide what each pile deserves — <b>nothing is deleted</b>, and everything is reversible.
              Anything tied to a live deal, an upcoming appointment, someone you owe a reply, or marked high priority is left alone.
            </p>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(203,163,92,0.06)', border: '1px solid var(--border)' }}>
              <b style={{ color: 'var(--accent)' }}>Someday / Maybe</b> — worth keeping, no schedule (a book to read, a movie to watch, an idea to revisit).<br />
              <b style={{ color: 'var(--text-2)' }}>Archive</b> — done with it; hide it but keep the record.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setGroomSel(Object.fromEntries(groomCands.map(g => [g.task_id, true])))}>Select all</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGroomSel({})}>Select none</button>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>{Object.values(groomSel).filter(Boolean).length} of {groomCands.length} selected</span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              {groomCands.map((g, i) => (
                <label key={g.task_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderBottom: i < groomCands.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!groomSel[g.task_id]} onChange={e => setGroomSel(s => ({ ...s, [g.task_id]: e.target.checked }))} style={{ marginTop: 3 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{g.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{g.age_days}d old · {g.reason}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => setShowGroom(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={groomBusy || !Object.values(groomSel).some(Boolean)} onClick={parkSomeday} style={{ flex: 1, minWidth: 150 }}>
                {groomBusy ? '…' : `→ Someday/Maybe (${Object.values(groomSel).filter(Boolean).length})`}
              </button>
              <button className="btn btn-ghost" disabled={groomBusy || !Object.values(groomSel).some(Boolean)} onClick={runGroom} style={{ flex: 1, minWidth: 120 }}>
                {groomBusy ? '…' : `Archive (${Object.values(groomSel).filter(Boolean).length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-tap undo after a grooming run */}
      {lastBatch && !showGroom && (
        <div style={{ position: 'fixed', left: 16, right: 16, bottom: 84, zIndex: 2300, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--accent)', boxShadow: '0 10px 30px rgba(0,0,0,.45)' }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-1)' }}>Old tasks cleared.</div>
          <button className="btn btn-ghost btn-sm" onClick={undoGroom}>Undo</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setLastBatch(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
