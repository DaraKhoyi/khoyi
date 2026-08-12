// PlanMyDayModal — builds the user's plan for the day (AI-ordered tasks +
// calendar) as a reviewable timeline. Extracted from App.js (strangle).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { logJournalEntry } from '../lib/journalLog';
import { buildGrowthMoves } from '../../supabase/functions/robot-chat/nba.js';
import { isTopPriority, priorityLabel, todayISO } from '../helpers';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import PlanTimeline from './PlanTimeline';
import PrismThinking from './PrismThinking';

export default function PlanMyDayModal({ tasks, events, contacts = [], properties = [], userId, name, setView, onOpenTask, setTasks, onClose, oweReplyMap = {} }) {

  useBackClose(onClose);
  const [state, setState] = useState({ loading: true });
  const [accepting, setAccepting] = useState(false);
  const [recap, setRecap] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [preps, setPreps] = useState({});
  const [viewMode, setViewMode] = useState(null); // 'timeline' | 'list' (null = auto)
  const [highlight, setHighlight] = useState(null);
  const [inboxActs, setInboxActs] = useState({}); // per-step inbox action result
  const [pushCal, setPushCal] = useState(false);   // #6 write timed blocks to calendar on accept
  const [constraints, setConstraints] = useState(''); // #9 active re-plan constraint
  const [conInput, setConInput] = useState('');       // #9 free-text constraint draft
  const CON_CHIPS = ['Only 2 hours', 'Half day', 'Out until noon', 'Working from home'];
  const [reviewing, setReviewing] = useState(false);  // #11 end-of-day review open
  const [review, setReview] = useState({ mood: '', note: '', recap: '', loadingRecap: false, carried: 0, saving: false, saved: false });
  const tomorrowISO = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const mapsRef = useRef({ tasks: new Map(), contacts: new Map(), emails: new Map() });
  const mounted = useRef(true);
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Fingerprint of the inputs that drive a plan (today/top-priority tasks + today's events).
  // Deliberately ignores completion state, so checking off steps never marks the plan stale.
  const inputsSig = () => {
    const tISO = todayISO();
    const sel = new Map();
    (tasks || []).filter(t => t.due_date && t.due_date <= tISO).forEach(t => sel.set(t.id, t));
    (tasks || []).filter(t => isTopPriority(t)).forEach(t => { if (!sel.has(t.id)) sel.set(t.id, t); });
    const tpart = Array.from(sel.values()).map(t => `${t.id}:${t.due_date || ''}:${priorityLabel(t)}`).sort().join(',');
    const td = new Date();
    const epart = (events || []).filter(e => e.start_at && new Date(e.start_at).toDateString() === td.toDateString()).map(e => `${e.title}|${e.start_at}|${e.end_at || ''}`).sort().join(',');
    return `T[${tpart}]E[${epart}]`;
  };

  // Build inputs and ask the planner for a fresh sequence.
  // conArg (optional): a re-plan constraint like "Only 2 hours" / "Out until noon".
  const generateFresh = async (conArg) => {
    const effCon = conArg !== undefined ? conArg : constraints;
    try {
      if (conArg !== undefined) setConstraints(conArg);
      if (mounted.current) setState({ loading: true });
      const today = new Date();
      const tISO = todayISO();
      const tmap = new Map(), cmap = new Map(), emap = new Map();
      const tsel = new Map();
      tasks.filter(t => !t.completed && t.due_date && t.due_date <= tISO).forEach(t => tsel.set(t.id, t));
      tasks.filter(t => !t.completed && isTopPriority(t)).forEach(t => { if (!tsel.has(t.id)) tsel.set(t.id, t); });
      const payloadTasks = Array.from(tsel.values()).slice(0, 30).map((t, i) => { const id = `t${i + 1}`; tmap.set(id, t); return { id, title: t.title, due_date: t.due_date || null, priority: priorityLabel(t) }; });
      const localHHMM = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      const ev = (events || []).filter(e => e.start_at && new Date(e.start_at).toDateString() === today.toDateString()).map(e => e.all_day ? ({ title: e.title, all_day: true }) : ({ title: e.title, start: localHHMM(e.start_at), end: e.end_at ? localHHMM(e.end_at) : null }));
      const nowMs = Date.now();
      const relAge = (ts) => { if (!ts) return 'never'; const d = Math.floor((nowMs - new Date(ts).getTime()) / 86400000); if (d <= 0) return 'today'; if (d === 1) return '1d ago'; if (d < 7) return d + 'd ago'; if (d < 30) return Math.floor(d / 7) + 'w ago'; if (d < 365) return Math.floor(d / 30) + 'mo ago'; return Math.floor(d / 365) + 'y ago'; };
      const lastTouch = (c) => { const a = [c.last_contact_at, c.last_inbound_at, c.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime()); return a.length ? Math.max(...a) : null; };
      const owe = (contacts || []).filter(c => { if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false; const owedAt = oweReplyMap && oweReplyMap[c.id]; if (!owedAt) return false; if (c.comms_settled_at && new Date(c.comms_settled_at) >= new Date(owedAt)) return false; return true; }).sort((a, b) => new Date(oweReplyMap[a.id]||0) - new Date(oweReplyMap[b.id]||0));
      const outreach = (contacts || []).filter(c => { const cad = c.cadence_days; if (!cad) return false; if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false; const ts = lastTouch(c); const ds = ts === null ? null : Math.floor((nowMs - ts) / 86400000); return ds === null ? true : ds >= cad; }).sort((a, b) => (lastTouch(a) || 0) - (lastTouch(b) || 0));
      const reachSource = [
        ...owe.slice(0, 10).map(c => ({ c, reason: `owes a reply — they wrote ${relAge(c.last_inbound_at)}` })),
        ...outreach.slice(0, 10).map(c => ({ c, reason: `follow-up overdue — every ${c.cadence_days}d, last touch ${relAge(lastTouch(c))}` })),
      ].slice(0, 15);
      const reachouts = reachSource.map((x, i) => { const id = `r${i + 1}`; cmap.set(id, x.c); return { id, name: x.c.name, reason: x.reason }; });
      // #10 Pipeline protection — nurture/sphere people to get ahead on (on a cadence but not yet
      // due, so they don't surface as reach-outs), plus the broker's active lead-gen systems.
      const inReach = new Set(reachSource.map(x => x.c.id));
      const nurtureAhead = (contacts || []).filter(c => c.cadence_days && !inReach.has(c.id) && !(c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()))
        .sort((a, b) => (lastTouch(a) || 0) - (lastTouch(b) || 0))
        .slice(0, 8);
      const pipelineContacts = nurtureAhead.map((c, i) => { const id = `p${i + 1}`; cmap.set(id, c); return { id, name: c.name, reason: `nurture — every ${c.cadence_days}d, last touch ${relAge(lastTouch(c))}` }; });
      let pipelineSystems = [];
      try {
        const { data: sys } = await supabase.from('lead_gen_systems').select('name,category,is_overhead,is_active,is_archived').eq('user_id', userId).eq('is_active', true).limit(20);
        pipelineSystems = (sys || []).filter(s => !s.is_archived && !s.is_overhead && s.category !== 'overhead').map(s => ({ name: s.name, category: s.category })).slice(0, 8);
      } catch (_e) {}
      let unreadEmails = [];
      try {
        const { data: msgs } = await supabase.from('email_messages')
          .select('id,thread_id,provider_thread_id,account_id,subject,from_name,from_address,body_text,snippet,internal_date')
          .eq('user_id', userId).eq('is_read', false).contains('labels', ['INBOX'])
          .order('internal_date', { ascending: false }).limit(24);
        const seen = new Set();
        (msgs || []).forEach(m => {
          if (seen.has(m.thread_id)) return; seen.add(m.thread_id);
          if (unreadEmails.length >= 12) return;
          const id = `e${unreadEmails.length + 1}`;
          emap.set(id, { thread_id: m.thread_id, provider_thread_id: m.provider_thread_id, account_id: m.account_id, from: m.from_name || m.from_address, subject: m.subject, excerpt: (m.body_text || m.snippet || '').slice(0, 1200) });
          unreadEmails.push({ id, from: m.from_name || m.from_address || 'Unknown', subject: m.subject || '(no subject)', age: relAge(m.internal_date), excerpt: (m.body_text || m.snippet || '').slice(0, 700) });
        });
      } catch (_e) {}
      let dealsCtx = [];
      try {
        const { data: dl } = await supabase.from('deals').select('name,client_name,status,side,list_price,sale_price,notes').eq('user_id', userId).order('updated_at', { ascending: false }).limit(25);
        dealsCtx = (dl || []).map(d => ({ name: d.name || d.client_name || 'Deal', client: d.client_name, status: d.status, side: d.side, price: d.sale_price || d.list_price, notes: d.notes }));
      } catch (_e) {}
      const propsCtx = (properties || []).slice(0, 25).map(p => ({ name: p.nickname || p.address, status: p.status, notes: p.notes }));
      let journalCtx = [], brainCtx = [];
      try {
        const { data: jr } = await supabase.from('journal_entries').select('content,occurred_at').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(20);
        journalCtx = (jr || []).filter(j => j.content).map(j => ({ when: relAge(j.occurred_at), text: j.content }));
      } catch (_e) {}
      try {
        const { data: br } = await supabase.from('brain').select('title,content,pinned,updated_at').eq('user_id', userId).order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(20);
        brainCtx = (br || []).filter(b => b.content || b.title).map(b => ({ title: b.title, text: b.content || '' }));
      } catch (_e) {}
      mapsRef.current = { tasks: tmap, contacts: cmap, emails: emap };

      // #5 GCI pace — goal vs YTD earned, against year-elapsed pace
      let gci = null;
      try {
        const { data: fsRow } = await supabase.from('finance_settings').select('annual_gci_goal').eq('user_id', userId).maybeSingle();
        const goal = Number(fsRow?.annual_gci_goal || 0);
        if (goal > 0) {
          const yr = today.getFullYear();
          const { data: closed } = await supabase.from('deals').select('gross_commission,close_date').eq('user_id', userId).eq('status', 'closed');
          const ytd = (closed || []).filter(d => d.close_date && new Date(d.close_date).getFullYear() === yr).reduce((a, d) => a + (Number(d.gross_commission) || 0), 0);
          const start = new Date(yr, 0, 1), end = new Date(yr + 1, 0, 1);
          const yearPct = Math.round(((today - start) / (end - start)) * 100);
          const paceTarget = Math.round(goal * (yearPct / 100));
          let status = 'on_track';
          if (ytd <= 0) status = 'no_data';
          else if (ytd < paceTarget * 0.95) status = 'behind';
          else if (ytd > paceTarget * 1.05) status = 'ahead';
          gci = { goal, ytd: Math.round(ytd), yearPct, paceTarget, behindBy: Math.max(0, paceTarget - Math.round(ytd)), status };
        }
      } catch (_e) {}

      // #4 Habits — learn from follow-through across recent saved plans
      let habits = null;
      try {
        const { data: plans } = await supabase.from('day_plans').select('plan_date,items').eq('user_id', userId).order('plan_date', { ascending: false }).limit(20);
        if (plans && plans.length >= 2) {
          const ids = new Set();
          plans.forEach(pl => (pl.items || []).forEach(it => { if (it.taskId) ids.add(it.taskId); }));
          let dm = new Map();
          if (ids.size) { const { data: ts } = await supabase.from('tasks').select('id,completed,title').in('id', Array.from(ids)); dm = new Map((ts || []).map(t => [t.id, t])); }
          const byKind = {}; const seen = {};
          plans.forEach(pl => (pl.items || []).forEach(it => {
            const k = it.kind || 'task';
            byKind[k] = byKind[k] || { planned: 0, done: 0 };
            byKind[k].planned++;
            const t = it.taskId ? dm.get(it.taskId) : null;
            if (t && t.completed) byKind[k].done++;
            if (it.taskId) seen[it.taskId] = (seen[it.taskId] || 0) + 1;
          }));
          const byKindArr = Object.entries(byKind).map(([kind, v]) => ({ kind, planned: v.planned, done: v.done, rate: v.planned ? Math.round(v.done / v.planned * 100) : 0 }));
          const chronic = Object.entries(seen).filter(([id, c]) => c >= 2 && !(dm.get(id) && dm.get(id).completed)).map(([id]) => dm.get(id) && dm.get(id).title).filter(Boolean).slice(0, 6);
          habits = { plansAnalyzed: plans.length, byKind: byKindArr, chronic };
        }
      } catch (_e) {}

      // #10 Light-day detection — thin task/reach-out/email load means the day is a pipeline risk.
      const lightDay = (payloadTasks.length + reachouts.length + unreadEmails.length) <= 4;
      const { data, error } = await supabase.functions.invoke('plan-my-day', { body: { user_id: userId, name, date: today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), tasks: payloadTasks, events: ev, reachouts, unreadEmails, deals: dealsCtx, properties: propsCtx, journal: journalCtx, brain: brainCtx, gci, habits, workingHours: { start: 8, end: 18 }, constraints: effCon, pipeline: { contacts: pipelineContacts, systems: pipelineSystems }, lightDay } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (mounted.current) setState({ loading: false, mode: 'fresh', summary: data?.summary, plan: data?.plan || [], light: lightDay, constraint: effCon, flags: data?.flags || [] });
      // Persist the generated plan right away so leaving and returning restores it (no regenerate, no tokens).
      // We only link to tasks/contacts that already exist (no task creation, no calendar writes — those stay on Accept).
      try {
        const genItems = (data?.plan || []).map(p => {
          const tRef = (p.refs || []).find(r => mapsRef.current.tasks.has(r));
          const tt = tRef ? mapsRef.current.tasks.get(tRef) : null;
          const cRef = (p.refs || []).find(r => mapsRef.current.contacts.has(r));
          const cc = cRef ? mapsRef.current.contacts.get(cRef) : null;
          return { title: p.title, when: p.when, start: p.start || null, end: p.end || null, why: p.why, kind: p.kind, refs: p.refs || [], taskId: tt ? tt.id : null, contactId: cc ? cc.id : null };
        });
        if (genItems.length) await supabase.from('day_plans').upsert({ user_id: userId, plan_date: tISO, summary: data?.summary, items: genItems, inputs_sig: inputsSig(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,plan_date' });
      } catch (_save) {}
    } catch (e) { if (mounted.current) setState({ loading: false, error: String(e.message || e) }); }
  };

  useEffect(() => {
    mounted.current = true;
    (async () => {
      // 1. Already planned today? Load the saved plan instead of regenerating.
      try {
        const { data: today } = await supabase.from('day_plans').select('*').eq('user_id', userId).eq('plan_date', todayISO()).maybeSingle();
        if (today && Array.isArray(today.items) && today.items.length) {
          if (mounted.current) {
            const tmap = new Map(), cmap = new Map(), emap = new Map();
            (today.items || []).forEach(it => { const key = (it.refs || [])[0]; if (!key) return; if (it.taskId) { const tt = (tasks || []).find(x => x.id === it.taskId); if (tt) { tmap.set(key, tt); return; } } if (it.contactId) { const cc = (contacts || []).find(x => x.id === it.contactId); if (cc) cmap.set(key, cc); } });
            mapsRef.current = { tasks: tmap, contacts: cmap, emails: emap };
          }
          let stale = false; try { stale = !!today.inputs_sig && today.inputs_sig !== inputsSig(); } catch (_s) {}
          if (mounted.current) setState({ loading: false, mode: 'saved', summary: today.summary, plan: today.items, savedAt: today.updated_at || null, stale });
          if (mounted.current && today.review) setReview(r => ({ ...r, mood: today.review.mood || '', note: today.review.note || '', recap: today.review.recap || '', saved: true }));
          return;
        }
      } catch (_e) {}
      // 2. Roll-over recap from the most recent prior plan
      try {
        const { data: prior } = await supabase.from('day_plans').select('plan_date,items').eq('user_id', userId).lt('plan_date', todayISO()).order('plan_date', { ascending: false }).limit(1).maybeSingle();
        if (prior && Array.isArray(prior.items) && prior.items.length) {
          const ids = prior.items.map(it => it.taskId).filter(Boolean);
          let doneCount = 0;
          if (ids.length) { const { data: pts } = await supabase.from('tasks').select('id,completed').in('id', ids); const m = new Map((pts || []).map(t => [t.id, t.completed])); doneCount = prior.items.filter(it => it.taskId && m.get(it.taskId)).length; }
          if (mounted.current) setRecap({ date: prior.plan_date, done: doneCount, total: prior.items.length });
        }
      } catch (_e) {}
      // 3. Generate fresh
      await generateFresh();
    })();
    return () => { mounted.current = false; };
  }, []); // eslint-disable-line

  const resolveRef = (refs) => {
    const list = refs || [];
    const t = list.find(r => mapsRef.current.tasks.has(r));
    if (t) return { type: 'task', obj: mapsRef.current.tasks.get(t) };
    const r = list.find(x => mapsRef.current.contacts.has(x));
    if (r) return { type: 'contact', obj: mapsRef.current.contacts.get(r) };
    const e = list.find(x => mapsRef.current.emails.has(x));
    if (e) return { type: 'email', obj: mapsRef.current.emails.get(e) };
    return null;
  };
  const openStep = (refs) => {
    const hit = resolveRef(refs);
    if (!hit) return;
    if (hit.type === 'task' && onOpenTask) { onClose(); onOpenTask(hit.obj); return; }
    onClose();
    if (hit.type === 'task') setView && setView('tasks');
    else if (hit.type === 'contact') setView && setView('contacts');
    else if (hit.type === 'email') setView && setView('inbox');
  };

  const taskDone = (item) => { if (!item || !item.taskId) return false; const t = (tasks || []).find(x => x.id === item.taskId); return !!(t && t.completed); };
  const toggleItemDone = async (item) => {
    if (!item.taskId) return;
    const cur = taskDone(item);
    try {
      const { error: tErr } = await supabase.from('tasks').update({ completed: !cur, updated_at: new Date().toISOString() }).eq('id', item.taskId);
      if (tErr) { if (window.__notify) window.__notify('Could not update task: ' + (tErr.message || tErr), 'error'); return; }
      if (setTasks) setTasks(prev => prev.map(t => t.id === item.taskId ? { ...t, completed: !cur } : t));
    } catch (_e) {}
  };

  const acceptPlan = async () => {
    if (accepting) return;
    setAccepting(true);
    try {
      const tISO = todayISO();
      const plan = (state.plan || []).map(p => ({ ...p }));
      const pullIds = []; const createPayload = []; const createIdx = [];
      plan.forEach((p, idx) => {
        const tRef = (p.refs || []).find(r => mapsRef.current.tasks.has(r));
        const t = tRef ? mapsRef.current.tasks.get(tRef) : null;
        if (t) { p.taskId = t.id; if (t.due_date !== tISO) pullIds.push(t.id); }
        else { createIdx.push(idx); createPayload.push({ user_id: userId, title: p.title, due_date: tISO, notes: `From Plan my day${p.when ? ` · ${p.when}` : ''}`, completed: false }); }
      });
      if (pullIds.length) await supabase.from('tasks').update({ due_date: tISO }).in('id', pullIds);
      let inserted = [];
      if (createPayload.length) { const { data } = await supabase.from('tasks').insert(createPayload).select(); inserted = data || []; }
      createIdx.forEach((idx, k) => { if (inserted[k]) plan[idx].taskId = inserted[k].id; });
      const items = plan.map(p => { const cRef = (p.refs || []).find(r => mapsRef.current.contacts.has(r)); const cc = cRef ? mapsRef.current.contacts.get(cRef) : null; return { title: p.title, when: p.when, start: p.start || null, end: p.end || null, why: p.why, kind: p.kind, refs: p.refs || [], taskId: p.taskId || null, contactId: cc ? cc.id : null }; });
      await supabase.from('day_plans').upsert({ user_id: userId, plan_date: tISO, summary: state.summary, items, inputs_sig: inputsSig(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,plan_date' });
      // #6 — calendar write-back: drop the timed focus blocks onto the calendar (pushes to Google on next sync)
      let calN = 0;
      if (pushCal) {
        try {
          const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
          // Clear prior Plan-my-day blocks for today to avoid duplicates on re-accept
          await supabase.from('events').delete().eq('user_id', userId).eq('category', 'Plan my day').gte('start_at', startOfDay.toISOString()).lte('start_at', endOfDay.toISOString()).in('sync_status', ['local', 'pending_push']);
          const mk = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
          const evRows = plan.filter(p => p.start && p.end).map(p => ({ user_id: userId, title: p.title, description: `From Plan my day${p.why ? ` — ${p.why}` : ''}`, start_at: mk(p.start), end_at: mk(p.end), all_day: false, category: 'Plan my day', color: '#c5a95e', sync_status: 'pending_push' }));
          if (evRows.length) { await supabase.from('events').insert(evRows); calN = evRows.length; }
        } catch (_e) {}
      }
      if (setTasks) setTasks(prev => [...prev.map(t => pullIds.includes(t.id) ? { ...t, due_date: tISO } : t), ...inserted]);
      if (mounted.current) setState(s => ({ ...s, mode: 'saved', plan: items, justAccepted: pullIds.length + inserted.length, calN }));
    } catch (e) { if (mounted.current) setState(s => ({ ...s, acceptError: String(e.message || e) })); }
    setAccepting(false);
  };

  // #11 — End-of-day review loop -------------------------------------------------
  const reviewSplit = () => {
    const items = state.plan || [];
    const done = items.filter(taskDone);
    const undone = items.filter(p => !taskDone(p));
    return { done, undone, total: items.length };
  };
  const carryToTomorrow = async () => {
    const { undone } = reviewSplit();
    if (!undone.length) return;
    const tISO = tomorrowISO();
    try {
      const haveTask = undone.filter(p => p.taskId);
      const noTask = undone.filter(p => !p.taskId);
      // Every roll is now counted. This used to be a silent bulk update, which is
      // exactly why 68 tasks reached 30-60 days old while all of them displayed
      // "1 day late" — the app was hiding the cost of saying "not today".
      if (haveTask.length) await supabase.rpc('carry_tasks', { p_ids: haveTask.map(p => p.taskId), p_due: tISO });
      let inserted = [];
      if (noTask.length) {
        const payload = noTask.map(p => ({ user_id: userId, title: p.title, due_date: tISO, notes: `Carried from ${todayISO()} plan`, completed: false }));
        const { data } = await supabase.from('tasks').insert(payload).select();
        inserted = data || [];
      }
      if (setTasks) setTasks(prev => [...prev.map(t => haveTask.some(p => p.taskId === t.id) ? { ...t, due_date: tISO, completed: false } : t), ...inserted]);
      setReview(r => ({ ...r, carried: undone.length }));
    } catch (e) { setReview(r => ({ ...r, error: String(e.message || e) })); }
  };
  const generateRecap = async () => {
    const { done, undone, total } = reviewSplit();
    setReview(r => ({ ...r, loadingRecap: true, error: null }));
    try {
      let gci = null;
      try {
        const { data: fsRow } = await supabase.from('finance_settings').select('annual_gci_goal').eq('user_id', userId).maybeSingle();
        const goal = Number(fsRow?.annual_gci_goal || 0);
        if (goal > 0) {
          const yr = new Date().getFullYear();
          const { data: closed } = await supabase.from('deals').select('gross_commission,close_date').eq('user_id', userId).eq('status', 'closed');
          const ytd = (closed || []).filter(d => d.close_date && new Date(d.close_date).getFullYear() === yr).reduce((a, d) => a + (Number(d.gross_commission) || 0), 0);
          const now = new Date(), start = new Date(yr, 0, 1), end = new Date(yr + 1, 0, 1);
          const paceTarget = Math.round(goal * ((now - start) / (end - start)));
          let status = 'on_track'; if (ytd <= 0) status = 'no_data'; else if (ytd < paceTarget * 0.95) status = 'behind'; else if (ytd > paceTarget * 1.05) status = 'ahead';
          gci = { goal, ytd: Math.round(ytd), paceTarget, behindBy: Math.max(0, paceTarget - Math.round(ytd)), status };
        }
      } catch (_e) {}
      const { data, error } = await supabase.functions.invoke('day-review', { body: { user_id: userId, name, date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), doneCount: done.length, total, done: done.map(p => p.title), undone: undone.map(p => p.title), mood: review.mood, note: review.note, gci } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReview(r => ({ ...r, loadingRecap: false, recap: data?.recap || '' }));
    } catch (e) { setReview(r => ({ ...r, loadingRecap: false, error: String(e.message || e) })); }
  };
  const saveReview = async () => {
    const { done, total } = reviewSplit();
    setReview(r => ({ ...r, saving: true, error: null }));
    try {
      const reviewObj = { mood: review.mood || null, note: review.note || null, recap: review.recap || null, done: done.length, total, reviewed_at: new Date().toISOString() };
      await supabase.from('day_plans').update({ review: reviewObj, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('plan_date', todayISO());
      // Close the loop: write the reflection to the journal so it feeds tomorrow's plan.
      const dl = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const moodTxt = review.mood ? ` Felt: ${review.mood}.` : '';
      const noteTxt = review.note ? ` ${review.note.trim()}` : '';
      const recapTxt = review.recap ? `\n\n${review.recap}` : '';
      const content = `End-of-day review (${dl}): ${done.length} of ${total} planned items done.${moodTxt}${noteTxt}${recapTxt}`;
      try { await logJournalEntry(userId, content, 'text'); } catch (_e) {}
      setReview(r => ({ ...r, saving: false, saved: true }));
    } catch (e) { setReview(r => ({ ...r, saving: false, error: String(e.message || e) })); }
  };

  const draftStep = async (idx, p) => {
    setDrafts(d => ({ ...d, [idx]: { loading: true } }));
    try {
      const hit = resolveRef(p.refs);
      let body;
      if (hit && hit.type === 'contact') {
        const c = hit.obj;
        body = { contact_id: c.id, contactName: c.name, company: c.company, role: c.role, channel: p.channel === 'email' ? 'email' : 'text', kind: p.channel === 'call' ? 'call (talking points)' : 'follow-up', entryBody: p.why || p.title, instruction: `For today's plan step: ${p.title}${p.channel === 'call' ? '. Write a short call script / what to say.' : ''}` };
      } else if (hit && hit.type === 'email') {
        const em = hit.obj;
        body = { contactName: em.from || 'there', channel: 'email', kind: 'email reply', entryBody: `Subject: ${em.subject || ''}\n\n${em.excerpt || ''}`, instruction: 'Write a reply to this email.' };
      } else {
        body = { contactName: 'there', channel: 'text', kind: 'message', entryBody: p.why || p.title, instruction: `Draft a short message for: ${p.title}` };
      }
      const { data, error } = await supabase.functions.invoke('ai-followup-draft', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDrafts(d => ({ ...d, [idx]: { loading: false, subject: data.subject, body: data.body, channel: body.channel } }));
    } catch (e) { setDrafts(d => ({ ...d, [idx]: { loading: false, error: String(e.message || e) } })); }
  };
  const copyDraft = (idx) => {
    const dr = drafts[idx]; if (!dr) return;
    const text = (dr.subject ? `Subject: ${dr.subject}\n\n` : '') + (dr.body || '');
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_e) {}
    setDrafts(d => ({ ...d, [idx]: { ...d[idx], copied: true } }));
    setTimeout(() => setDrafts(d => ({ ...d, [idx]: { ...(d[idx] || {}), copied: false } })), 1600);
  };

  // #D — call prep (opener + talking points) folded in from the briefing
  const prepStep = async (idx, p) => {
    const hit = resolveRef(p.refs);
    if (!hit || hit.type !== 'contact') return;
    setPreps(s => ({ ...s, [idx]: { loading: true } }));
    try {
      const { data, error } = await supabase.functions.invoke('ari-call-prep', { body: { contact_id: hit.obj.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreps(s => ({ ...s, [idx]: { loading: false, prep: data.prep || null, disc: data.disc || null } }));
    } catch (e) { setPreps(s => ({ ...s, [idx]: { loading: false, error: String(e.message || e) } })); }
  };
  const copyOpener = (idx) => {
    const pr = preps[idx]; if (!pr || !pr.prep) return;
    try { navigator.clipboard && navigator.clipboard.writeText(pr.prep.opener || ''); } catch (_e) {}
    setPreps(s => ({ ...s, [idx]: { ...s[idx], copied: true } }));
    setTimeout(() => setPreps(s => ({ ...s, [idx]: { ...(s[idx] || {}), copied: false } })), 1600);
  };

  // #7 — one-tap inbox actions (works on every email a step covers)
  const resolveEmails = (refs) => (refs || []).filter(r => mapsRef.current.emails.has(r)).map(r => mapsRef.current.emails.get(r));
  const inboxAction = async (idx, refs, action) => {
    const emails = resolveEmails(refs);
    if (!emails.length) return;
    setInboxActs(s => ({ ...s, [idx]: { busy: action } }));
    try {
      let n = 0;
      for (const em of emails) {
        if (action === 'archive') {
          if (em.account_id && em.provider_thread_id) { await supabase.functions.invoke('gmail-modify', { body: { account_id: em.account_id, thread_id: em.provider_thread_id, action: 'archive' } }); n++; }
        } else if (action === 'read') {
          if (em.account_id && em.provider_thread_id) { await supabase.functions.invoke('gmail-modify', { body: { account_id: em.account_id, thread_id: em.provider_thread_id, action: 'mark_read' } }); n++; }
        } else if (action === 'snooze') {
          const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0);
          if (em.thread_id) { await supabase.from('email_threads').update({ snoozed_until: d.toISOString() }).eq('id', em.thread_id); n++; }
        } else if (action === 'task') {
          const d = new Date(); const tISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const row = { user_id: userId, title: `Reply: ${em.subject || em.from || 'email'}`, due_date: tISO, completed: false, priority: 'medium', notes: `From ${em.from || 'inbox'}${em.excerpt ? `\n\n${em.excerpt.slice(0, 300)}` : ''}` };
          if (em.provider_thread_id) row.email_thread_id = em.provider_thread_id;
          const { data: t } = await supabase.from('tasks').insert(row).select();
          if (t && t[0]) { n++; if (setTasks) setTasks(prev => [...prev, t[0]]); }
        }
      }
      const label = action === 'archive' ? `Archived ${n}` : action === 'read' ? `Marked ${n} read` : action === 'snooze' ? `Snoozed ${n} to tomorrow` : `Added ${n} ${n === 1 ? 'task' : 'tasks'}`;
      setInboxActs(s => ({ ...s, [idx]: { done: label } }));
    } catch (e) { setInboxActs(s => ({ ...s, [idx]: { error: String(e.message || e) } })); }
  };

  const saved = state.mode === 'saved';
  const doneCount = saved ? (state.plan || []).filter(taskDone).length : 0;

  const renderItem = (p, i) => {
    const kindTag = { task: { l: 'Task', c: 'var(--text-2)' }, reachout: { l: 'Reach out', c: 'var(--accent)' }, email: { l: 'Email', c: '#6aa9ff' }, focus: { l: 'Focus', c: '#4ade80' } }[p.kind] || { l: 'Task', c: 'var(--text-2)' };
    const hit = resolveRef(p.refs);
    const tappable = !!hit;
    const canDraft = hit && (hit.type === 'contact' || hit.type === 'email');
    const canPrep = hit && hit.type === 'contact';
    const done = saved && taskDone(p);
    const dr = drafts[i];
    const pr = preps[i];
    const chan = p.kind === 'reachout' ? p.channel : null;
    const chanMeta = { text: { l: 'Text', ic: 'message' }, call: { l: 'Call', ic: 'quo' }, email: { l: 'Email', ic: 'mail' } }[chan];
    const emailRefs = (p.refs || []).filter(r => mapsRef.current.emails.has(r));
    const ib = inboxActs[i];
    const draftLabel = hit && hit.type === 'email' ? 'Draft reply' : (chan === 'email' ? 'Draft email' : chan === 'call' ? 'Call script' : 'Draft message');
    return (
      <div key={i} style={{ background: 'var(--bg-base)', border: `1px solid ${highlight === i ? 'var(--accent)' : 'var(--border)'}`, boxShadow: highlight === i ? '0 0 0 2px var(--accent-dim)' : 'none', borderRadius: 12, padding: '12px 14px', transition: 'border-color .2s, box-shadow .2s' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {saved ? (
            <button onClick={() => toggleItemDone(p)} title={p.taskId ? (done ? 'Mark not done' : 'Mark done') : 'No linked task'}
              style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: `2px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`, background: done ? 'var(--accent)' : 'transparent', color: '#1b180f', fontWeight: 900, fontSize: 13, cursor: p.taskId ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '✓' : ''}</button>
          ) : (
            <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,var(--accent-2),var(--accent))', color: '#1b180f', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} onClick={tappable ? () => openStep(p.refs) : undefined}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: done ? 'var(--text-3)' : 'var(--text-1)', textDecoration: done ? 'line-through' : 'none', cursor: tappable ? 'pointer' : 'default' }}>{p.title}</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: kindTag.c, border: `1px solid ${kindTag.c}`, borderRadius: 999, padding: '1px 7px', opacity: 0.9 }}>{kindTag.l}</span>
              {chanMeta && <span title="Best way to reach them" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)', borderRadius: 999, padding: '1px 8px' }}><Icon name={chanMeta.ic} size={10} /> {chanMeta.l}</span>}
            </div>
            {p.when && <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, marginTop: 3 }}>{p.when}</div>}
            {p.why && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.45 }}>{p.why}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
              {canDraft && !dr && <button onClick={() => draftStep(i, p)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5 }}>✦ {draftLabel}</button>}
              {canPrep && !pr && <button onClick={() => prepStep(i, p)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5 }}>✦ Prep me</button>}
              {dr && dr.loading && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Drafting…</span>}
              {pr && pr.loading && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Prepping…</span>}
              {tappable && <button onClick={() => openStep(p.refs)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5 }}>Open ›</button>}
            </div>
            {emailRefs.length > 0 && (
              ib && ib.done ? (
                <div style={{ fontSize: 11.5, color: '#4ade80', fontWeight: 700, marginTop: 9 }}>✓ {ib.done}</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{emailRefs.length > 1 ? `${emailRefs.length} emails:` : 'Inbox:'}</span>
                  {[['archive', 'Archive'], ['read', 'Mark read'], ['snooze', 'Snooze'], ['task', '→ Task']].map(([a, l]) => (
                    <button key={a} disabled={!!(ib && ib.busy)} onClick={() => inboxAction(i, p.refs, a)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5, opacity: ib && ib.busy ? 0.6 : 1 }}>{ib && ib.busy === a ? '…' : l}</button>
                  ))}
                  {ib && ib.error && <span style={{ fontSize: 11, color: 'var(--red)' }}>{ib.error}</span>}
                </div>
              )
            )}
            {dr && dr.error && <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 6 }}>{dr.error}</div>}
            {pr && pr.error && <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 6 }}>{pr.error}</div>}
            {pr && !pr.loading && !pr.error && pr.prep && (
              <div style={{ marginTop: 9, background: 'var(--bg-card)', border: '1px solid var(--accent-dim)', borderRadius: 10, padding: '10px 12px' }}>
                {pr.disc && pr.disc.letter && <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>{pr.disc.letter} · {String(pr.disc.label || '').split('—')[0].trim()}</div>}
                {pr.prep.communicate && <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{pr.prep.communicate}</div>}
                {pr.prep.opener && (
                  <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--accent-dim)', borderRadius: 9, padding: '9px 11px', marginBottom: pr.prep.talking_points && pr.prep.talking_points.length ? 9 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Opener</span>
                      <button onClick={() => copyOpener(i)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 10, cursor: 'pointer', textTransform: 'uppercase' }}>{pr.copied ? 'copied' : 'copy'}</button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>{pr.prep.opener}</div>
                  </div>
                )}
                {pr.prep.talking_points && pr.prep.talking_points.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>Talking points</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>{pr.prep.talking_points.map((tp, k) => <li key={k} style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 3 }}>{tp}</li>)}</ul>
                  </div>
                )}
                {pr.prep.next_step && <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 8 }}><span style={{ color: 'var(--accent)', fontWeight: 700 }}>Aim for:</span> {pr.prep.next_step}</div>}
              </div>
            )}
            {dr && !dr.loading && !dr.error && (dr.body || dr.subject) && (
              <div style={{ marginTop: 9, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                {dr.subject && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 5 }}>Subject: {dr.subject}</div>}
                <div style={{ fontSize: 12.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{dr.body}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                  <button onClick={() => copyDraft(i)} className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 11.5, borderRadius: 8 }}>{dr.copied ? '✓ Copied' : 'Copy'}</button>
                  <button onClick={() => draftStep(i, p)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5 }}>↻ Redraft</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'linear-gradient(180deg,var(--bg-card),rgba(22,23,27,0.96))', padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-1)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>✦ Your day, planned {saved && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '1px 8px' }}>Saved</span>}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 18px' }}>
          {state.loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '34px 0' }}>
              <PrismThinking label={`${name || 'Ari'} is reading your inbox & triaging your day`} />
            </div>
          )}
          {state.error && <div style={{ color: 'var(--red)', fontSize: 13, padding: '10px 0' }}>Couldn't build a plan: {state.error}</div>}
          {!state.loading && !state.error && reviewing && saved && (() => {
            const { done, undone, total } = reviewSplit();
            const MOODS = [{ k: 'Great', e: '😀' }, { k: 'Solid', e: '🙂' }, { k: 'Tough', e: '😓' }];
            return (
              <div>
                <button onClick={() => setReviewing(false)} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5, marginBottom: 14 }}>‹ Back to plan</button>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{done.length}<span style={{ fontSize: 18, color: 'var(--text-3)' }}> / {total}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{done.length === total ? 'Everything done — a clean sweep. 🎯' : `${done.length} done · ${undone.length} to carry forward`}</div>
                </div>

                {undone.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Unfinished</span>
                      {review.carried ? <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>✓ {review.carried} carried to tomorrow</span>
                        : <button onClick={carryToTomorrow} className="quick-chip" style={{ padding: '5px 11px', fontSize: 11.5 }}>→ Carry all to tomorrow</button>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {undone.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-2)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px' }}>
                          <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)' }} />{p.title}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>How did today go?</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {MOODS.map(m => {
                      const active = review.mood === m.k;
                      return <button key={m.k} onClick={() => setReview(r => ({ ...r, mood: active ? '' : m.k }))} className="quick-chip" style={{ flex: 1, justifyContent: 'center', padding: '9px 0', fontSize: 13, ...(active ? { background: 'var(--accent)', color: '#1b180f', borderColor: 'var(--accent)', fontWeight: 700 } : {}) }}>{m.e} {m.k}</button>;
                    })}
                  </div>
                  <textarea value={review.note} onChange={e => setReview(r => ({ ...r, note: e.target.value }))} placeholder="A line on the day — a win, a lesson, what's on your mind (optional)…" rows={2}
                    style={{ width: '100%', marginTop: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text-1)', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>

                {review.recap ? (
                  <div style={{ marginBottom: 16, background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)', borderRadius: 10, padding: '11px 13px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>✦ {name || 'Ari'}'s reflection</div>
                    {review.recap}
                  </div>
                ) : (
                  <button onClick={generateRecap} disabled={review.loadingRecap} className="quick-chip" style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 13, marginBottom: 14 }}>
                    {review.loadingRecap ? `${name || 'Ari'} is reflecting…` : `✦ Get ${name || 'Ari'}'s end-of-day reflection`}
                  </button>
                )}

                {review.error && <div style={{ color: 'var(--red)', fontSize: 12, textAlign: 'center', marginBottom: 10 }}>{review.error}</div>}
                {review.saved ? (
                  <div style={{ textAlign: 'center', padding: '10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 11, fontSize: 13, color: '#4ade80', fontWeight: 700 }}>✓ Day closed out — saved to your journal.</div>
                ) : (
                  <button onClick={saveReview} disabled={review.saving} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 11, padding: '12px', fontSize: 14, opacity: review.saving ? 0.6 : 1 }}>
                    {review.saving ? 'Saving…' : '✓ Close out the day'}
                  </button>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 7 }}>Saves your reflection to the Journal, so it informs tomorrow's plan.</div>
              </div>
            );
          })()}
          {!state.loading && !state.error && !(reviewing && saved) && (
            <>
              {recap && !saved && (
                <div style={{ marginBottom: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 800 }}>↻ Roll-over</span> · Your last plan: <strong style={{ color: '#4ade80' }}>{recap.done} of {recap.total} done</strong>. Anything unfinished is carried into today below.
                </div>
              )}
              {state.summary && <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.5, fontWeight: 500 }}>{state.summary}</p>}
              {saved && state.savedAt && (() => {
                const hhmm = new Date(state.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                return (
                  <div style={{ margin: '-6px 0 14px', fontSize: 11.5, color: state.stale ? '#d9a93a' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', lineHeight: 1.5 }}>
                    <span>Saved {hhmm}{state.stale ? '' : ' · up to date'}</span>
                    {state.stale && (<><span>· your tasks or calendar changed since</span><button onClick={() => { setConInput(''); generateFresh(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0, fontSize: 11.5 }}>↻ Re-plan</button></>)}
                  </div>
                );
              })()}
              {state.light && (state.plan || []).length > 0 && (
                <div style={{ marginBottom: 14, background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="bulb" size={13} /><span><strong style={{ color: 'var(--accent)' }}>Light day</strong> — Ari added pipeline-protection time so a quiet day doesn't go to waste.</span>
                </div>
              )}
              {/* #12 — Risk & conflict flags: deterministic structural checks merged with Ari's judgment flags */}
              {(() => {
                const plan = state.plan || [];
                const out = [];
                // a) calendar double-booking among today's timed events
                const td = new Date();
                const evs = (events || []).filter(e => e.start_at && !e.all_day && new Date(e.start_at).toDateString() === td.toDateString())
                  .map(e => ({ title: e.title, s: new Date(e.start_at).getTime(), e: e.end_at ? new Date(e.end_at).getTime() : new Date(e.start_at).getTime() + 3600000 }))
                  .sort((a, b) => a.s - b.s);
                for (let i = 1; i < evs.length; i++) { if (evs[i].s < evs[i - 1].e) { out.push({ level: 'risk', text: `Calendar conflict: “${evs[i - 1].title}” overlaps “${evs[i].title}.”` }); break; } }
                // b) due-today tasks that ended up deferred (start null)
                const deferred = plan.filter(p => !p.start);
                const dueToday = [];
                deferred.forEach(p => { (p.refs || []).forEach(r => { const t = mapsRef.current.tasks.get(r); if (t && t.due_date === todayISO() && !t.completed && !dueToday.includes(t.title)) dueToday.push(t.title); }); });
                if (dueToday.length) out.push({ level: 'risk', text: `Due today but unscheduled: ${dueToday.slice(0, 2).map(t => `“${t}”`).join(', ')}${dueToday.length > 2 ? ` +${dueToday.length - 2} more` : ''}.` });
                // c) overall over-capacity
                const otherDeferred = deferred.length - 0;
                if (otherDeferred > 0 && !dueToday.length) out.push({ level: 'warn', text: `${otherDeferred} item${otherDeferred === 1 ? '' : 's'} won’t fit today — moved to “later / if there’s time.”` });
                // d) Ari's judgment flags from the planner
                (state.flags || []).forEach(f => out.push(f));
                if (!out.length) return null;
                const dedup = []; const seen = new Set();
                out.forEach(f => { const k = (f.text || '').toLowerCase().slice(0, 40); if (!seen.has(k)) { seen.add(k); dedup.push(f); } });
                return (
                  <div style={{ marginBottom: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>⚠ Heads up</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {dedup.slice(0, 5).map((f, i) => {
                        const c = f.level === 'risk' ? '#ef4444' : '#f59e0b';
                        return (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-1)', lineHeight: 1.45 }}>
                            <span style={{ flexShrink: 0, marginTop: 5, width: 7, height: 7, borderRadius: '50%', background: c }} />
                            <span>{f.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {/* #9 — Adjust the day: re-plan around real constraints */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Adjust the day</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {CON_CHIPS.map(opt => {
                    const active = constraints === opt;
                    return (
                      <button key={opt} onClick={() => { const v = active ? '' : opt; setConInput(''); generateFresh(v); }} className="quick-chip"
                        style={{ padding: '6px 12px', fontSize: 12, ...(active ? { background: 'var(--accent)', color: '#1b180f', borderColor: 'var(--accent)', fontWeight: 700 } : {}) }}>
                        {active ? '✓ ' : ''}{opt}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                  <input value={conInput} onChange={e => setConInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && conInput.trim()) { generateFresh(conInput.trim()); } }}
                    placeholder="…or type a limit (e.g. only mornings, no calls)"
                    style={{ flex: 1, minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px', color: 'var(--text-1)', fontSize: 12.5 }} />
                  <button onClick={() => { if (conInput.trim()) generateFresh(conInput.trim()); }} className="quick-chip" style={{ padding: '8px 14px', fontSize: 12.5, flexShrink: 0 }}>↻ Re-plan</button>
                </div>
                {constraints && !CON_CHIPS.includes(constraints) && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-2)' }}>
                    Planning around: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{constraints}</span>
                    <button onClick={() => { setConInput(''); generateFresh(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', marginLeft: 8 }}>clear</button>
                  </div>
                )}
              </div>
              {(() => {
                const plan = state.plan || [];
                const hasTimed = plan.some(p => p.start);
                const mode = viewMode || (hasTimed ? 'timeline' : 'list');
                const localHHMM = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
                const td = new Date();
                const eventsToday = (events || []).filter(e => e.start_at && !e.all_day && new Date(e.start_at).toDateString() === td.toDateString()).map(e => ({ title: e.title, start: localHHMM(e.start_at), end: e.end_at ? localHHMM(e.end_at) : null }));
                if (plan.length === 0) { const moves=buildGrowthMoves({contacts,deals:[],gciGoal:0,now:Date.now()}); return (
                  <div style={{ padding:'6px 0' }}>
                    <div style={{ fontSize:13.5, color:'var(--text-1)', fontWeight:700, marginBottom:3 }}>Nothing urgent to sequence — nice.</div>
                    <div style={{ fontSize:12.5, color:'var(--text-2)', marginBottom:14 }}>Here are some items you might want to consider today:</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {moves.slice(0,4).map(m=>(
                        <div key={m.key} onClick={()=>{ if(m.cta&&m.cta.kind==='view'){ setView(m.cta.payload); onClose&&onClose(); } }} style={{ cursor:'pointer', display:'flex', gap:11, alignItems:'flex-start', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 13px' }}>
                          <div style={{ width:32,height:32,borderRadius:9,flexShrink:0,background:'var(--bg-base)',border:'1px solid var(--accent)',display:'inline-flex',alignItems:'center',justifyContent:'center' }}><Icon name={m.icon||'target'} size={15} style={{color:'var(--accent)'}}/></div>
                          <div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:13.5,fontWeight:700,color:'var(--text-1)' }}>{m.title}</div><div style={{ fontSize:12,color:'var(--text-2)',marginTop:2,lineHeight:1.4 }}>{m.why}</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ); }
                const timed = plan.map((p, i) => ({ p, i })).filter(x => x.p.start);
                const deferred = plan.map((p, i) => ({ p, i })).filter(x => !x.p.start);
                return (
                  <>
                    {hasTimed && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                        <div className="seg-track" style={{ maxWidth: 240 }}>
                          <button className={`seg-btn ${mode === 'timeline' ? 'active' : ''}`} onClick={() => setViewMode('timeline')}>Timeline</button>
                          <button className={`seg-btn ${mode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>List</button>
                        </div>
                      </div>
                    )}
                    {mode === 'timeline' ? (
                      <>
                        <PlanTimeline steps={timed} events={eventsToday} saved={saved} isDone={(p) => taskDone(p)} onTapStep={(i) => { setViewMode('list'); setHighlight(i); setTimeout(() => setHighlight(null), 2200); }} />
                        {deferred.length > 0 && (
                          <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Later / if there's time</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{deferred.map(x => renderItem(x.p, x.i))}</div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {plan.map((p, i) => renderItem(p, i))}
                      </div>
                    )}
                  </>
                );
              })()}
              <div style={{ display: 'none' }}>
                {(state.plan || []).map((p, i) => null)}
                {(!state.plan || state.plan.length === 0) && <div style={{ color: 'var(--text-2)', fontSize: 13, textAlign: 'center', padding: '14px 0' }}>Nothing urgent to sequence — your runway is open.</div>}
              </div>

              {(state.plan && state.plan.length > 0) && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  {saved ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>✓ {doneCount} of {state.plan.length} done today</span>
                        <button onClick={generateFresh} className="quick-chip" style={{ padding: '7px 13px' }}>↻ Re-plan</button>
                      </div>
                      <button onClick={() => setReviewing(true)} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 11, padding: '11px', fontSize: 13.5, marginTop: 11 }}>
                        {review.saved ? '✓ View end-of-day review' : '🌙 End-of-day review'}
                      </button>
                      {state.justAccepted != null && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 7 }}>Saved to today. Check items off here or in Tasks — this plan will be waiting when you reopen.{state.calN ? ` ${state.calN} time block${state.calN === 1 ? '' : 's'} added to your calendar — open Calendar to sync to Google.` : ''}</div>}
                    </>
                  ) : (
                    <>
                      {(state.plan || []).some(p => p.start && p.end) && (
                        <button onClick={() => setPushCal(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 11px', textAlign: 'left' }}>
                          <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: `2px solid ${pushCal ? 'var(--accent)' : 'var(--border-strong)'}`, background: pushCal ? 'var(--accent)' : 'transparent', color: '#1b180f', fontWeight: 900, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{pushCal ? '✓' : ''}</span>
                          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Also block this time on my calendar</span>
                        </button>
                      )}
                      <button onClick={acceptPlan} disabled={accepting} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 11, padding: '12px', fontSize: 14, opacity: accepting ? 0.6 : 1 }}>
                        {accepting ? 'Saving…' : '✓ Accept plan → add to Today'}
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 7 }}>Saves the plan, pulls existing tasks into today, and creates tasks for reach-outs & emails.{pushCal ? ' Timed blocks are added to your calendar too.' : ''}</div>
                      {state.acceptError && <div style={{ color: 'var(--red)', fontSize: 12, textAlign: 'center', marginTop: 6 }}>{state.acceptError}</div>}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
