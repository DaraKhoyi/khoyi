// ContactDetailModal — the full contact record (the biggest screen in the app):
// header, DISC, cadence, timeline, tasks, notes, comms, recordings, research,
// custom fields, social, documents. Extracted from App.js (strangle) — the
// single largest component move of the refactor. Every child is now a module.
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../dataService';
import { owesReply } from '../helpers';
import { notify, confirmDialog } from '../notify';
import { Icon } from '../icons';
import { useBackClose } from '../backClose';
import { Tip } from '../tipsUi';
import SingleContactPicker from './SingleContactPicker';
import QuoTextModal from './QuoTextModal';
import FollowupDraftModal from './FollowupDraftModal';
import ActivityTimeline from './ActivityTimeline';
import RelationshipIntel from './RelationshipIntel';
import SocialLinksPanel from './SocialLinksPanel';
import CustomFieldsPanel from './CustomFieldsPanel';
import ContactRecordingsSection from './ContactRecordingsSection';
import ContactKnowledge from './ContactKnowledge';
import ResearchProgress from './ResearchProgress';
import DownloadResearchDocx from './DownloadResearchDocx';
import PrepLeadButton from './PrepLeadButton';
import LinkedNotes from './LinkedNotes';
import { ContactDocuments } from './DocumentsView';
const CadenceSuggestion = lazy(() => import('./CadenceSuggestion'));
const AgentProduction = lazy(() => import('./AgentProduction'));

export default function ContactDetailModal({ contact, profile, onClose, onEdit, onBack, onProfileUpdate, userId, contacts = [], setContacts }) {

  useBackClose(onClose);
  const [analyzing, setAnalyzing] = useState(false);
  const [textTo, setTextTo] = useState(null); // { phone } when the Quo text composer is open
  const [emailComposeOpen, setEmailComposeOpen] = useState(false); // in-app email composer (AI draft + Gmail send)
  const [tab, setTab] = useState('overview');
  const [leadSystems, setLeadSystems] = useState([]);
  useEffect(() => { let go = true; supabase.from('lead_gen_systems').select('id,name,category,color,monthly_budget,target_leads_per_month,is_active,is_archived').then(({ data }) => { if (go) setLeadSystems((data || []).filter(s => !s.is_archived)); }); return () => { go = false; }; }, []);
  const [analyzeMsg, setAnalyzeMsg] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [loadingEvidence, setLoadingEvidence] = useState(true);
  // Evidence list is collapsed by default — it's reference detail, not the
  // primary signal. The DISC summary and reasoning above already tell the story.
  const [showEvidence, setShowEvidence] = useState(false);
  const [showBaselineForm, setShowBaselineForm] = useState(false);

  // Brain entries + investments linked to this contact
  const [linkedBrain, setLinkedBrain] = useState([]);
  const [linkedInvestments, setLinkedInvestments] = useState([]);

  // Quick-add task / event inline forms
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState(new Date().toISOString().slice(0,10));
  const [newTaskQuadrant, setNewTaskQuadrant] = useState('B');
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventStart, setNewEventStart] = useState('');
  const [newEventDuration, setNewEventDuration] = useState(60);
  const [newEventLocation, setNewEventLocation] = useState('');
  const [savingQuickAdd, setSavingQuickAdd] = useState(false);

  // Add a task linked to this contact (uses set_task_contacts RPC for clean linking)
  async function addQuickTask() {
    if (!newTaskTitle.trim()) return;
    setSavingQuickAdd(true);
    try {
      // Get the next rank in this quadrant so it lands at the bottom
      const { data: maxRow } = await supabase.from('tasks')
        .select('eisenhower_rank')
        .eq('user_id', userId)
        .eq('eisenhower_quadrant', newTaskQuadrant)
        .eq('completed', false)
        .order('eisenhower_rank', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextRank = (maxRow?.eisenhower_rank || 0) + 1;
      const priorityMap = { A: 'high', B: 'high', C: 'medium', D: 'low' };
      const { data: t, error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: newTaskTitle.trim(),
        due_date: newTaskDue || null,
        priority: priorityMap[newTaskQuadrant],
        priority_system: 'eisenhower',
        eisenhower_quadrant: newTaskQuadrant,
        eisenhower_rank: nextRank,
        status: 'open',
      }).select().single();
      if (error) throw error;
      // Link via RPC
      await supabase.rpc('set_task_contacts', { p_task_id: t.id, p_contact_ids: [contact.id] });
      // Refresh linked tasks list
      setLinkedTasks(prev => [{ ...t }, ...prev]);
      setNewTaskTitle(''); setNewTaskQuadrant('B'); setShowAddTask(false);
    } catch (e) {
      notify("Couldn't save task: " + (e.message || e), 'error');
    } finally {
      setSavingQuickAdd(false);
    }
  }

  // Add an event linked to this contact (events table has contact_id directly)
  async function addQuickEvent() {
    if (!newEventTitle.trim() || !newEventStart) return;
    setSavingQuickAdd(true);
    try {
      const start = new Date(newEventStart);
      const end = new Date(start.getTime() + (Number(newEventDuration) || 60) * 60000);
      const { data: ev, error } = await supabase.from('events').insert({
        user_id: userId,
        title: newEventTitle.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        location: newEventLocation.trim() || null,
        contact_id: contact.id,
        all_day: false,
      }).select().single();
      if (error) throw error;
      setLinkedEvents(prev => [ev, ...prev]);
      setNewEventTitle(''); setNewEventStart(''); setNewEventLocation(''); setNewEventDuration(60);
      setShowAddEvent(false);
    } catch (e) {
      notify("Couldn't save event: " + (e.message || e), 'error');
    } finally {
      setSavingQuickAdd(false);
    }
  }

  // Baseline form local state
  const [baseD, setBaseD] = useState(profile?.baseline_d_score ?? 50);
  const [baseI, setBaseI] = useState(profile?.baseline_i_score ?? 50);
  const [baseS, setBaseS] = useState(profile?.baseline_s_score ?? 50);
  const [baseC, setBaseC] = useState(profile?.baseline_c_score ?? 50);
  const [baseTakenAt, setBaseTakenAt] = useState(profile?.baseline_taken_at ? profile.baseline_taken_at.slice(0,10) : new Date().toISOString().slice(0,10));
  const [baseSource, setBaseSource] = useState(profile?.baseline_source || 'Prism Test');
  const [savingBase, setSavingBase] = useState(false);

  // Research flow state
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [researchScope, setResearchScope] = useState('both');  // 'personal' | 'business' | 'both'
  const [researchStage, setResearchStage] = useState('idle');  // 'idle' | 'identifying' | 'choose_candidate' | 'researching' | 'done' | 'error'
  useEffect(() => {
    if (contact && window.__autoResearch && window.__autoResearch === contact.id) {
      window.__autoResearch = null;
      const _h = window.__autoResearchHint; window.__autoResearchHint = null;
      // If a completed report already exists, don't auto-run — open the report so
      // the existing profile (and its confirm step) is what the user sees.
      if (!_h && profile && profile.research_status === 'done' && (profile.research_full_report || profile.research_profile)) {
        setShowResearchReport(true);
      } else {
        setShowResearchModal(true);
        setTimeout(() => { try { startResearch(_h); } catch (_) {} }, 150);
      }
    }
    /* eslint-disable-next-line */
  }, [contact, profile]);
  const [researchCandidates, setResearchCandidates] = useState([]);
  const [researchError, setResearchError] = useState(null);
  const [researchHint, setResearchHint] = useState('');
  const [showResearchReport, setShowResearchReport] = useState(false);  // for viewing existing report

  // Linked tasks
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  // Pass 3: linked events (events.contact_id) + linked properties (property_contacts join)
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [linkedProperties, setLinkedProperties] = useState([]);

  // Date-stamped notes (proper notes table — separate from contacts.notes pinned summary)

  // Manual interaction logging
  const [showLogInteraction, setShowLogInteraction] = useState(false);
  const [interactionForm, setInteractionForm] = useState({
    channel: 'phone',
    direction: 'outbound',
    occurred_at: new Date().toISOString().slice(0, 16),
    brief: '',
  });
  const [interactions, setInteractions] = useState([]);

  // Contact ↔ contact relationships
  const [relationships, setRelationships] = useState([]);
  const [showAddRel, setShowAddRel] = useState(false);
  const [relTargetId, setRelTargetId] = useState('');
  const [relType, setRelType] = useState('spouse');
  const [savingRel, setSavingRel] = useState(false);

  // Reset action busy state (shared across the three reset buttons)
  const [resetting, setResetting] = useState(false);

  // Load tasks, dated notes, interactions on mount
  useEffect(() => {
    if (!contact?.id) return;
    let cancelled = false;
    (async () => {
      // Tasks linked to this contact
      const { data: linkRows } = await supabase.from('task_contacts')
        .select('task_id').eq('contact_id', contact.id);
      if (linkRows && linkRows.length > 0) {
        const taskIds = linkRows.map(r => r.task_id);
        const { data: tasks } = await supabase.from('tasks')
          .select('*').in('id', taskIds).order('completed').order('due_date', { nullsFirst: false });
        if (!cancelled && tasks) setLinkedTasks(tasks);
      } else if (!cancelled) {
        setLinkedTasks([]);
      }

      // (Dated notes + manual interactions now load inside ActivityTimeline,
      // which renders the unified activity stream from public.contact_interactions.)

      // Pass 3: linked events
      const { data: evs } = await supabase.from('events')
        .select('*').eq('contact_id', contact.id).order('start_at', { ascending: false }).limit(50);
      if (!cancelled && evs) setLinkedEvents(evs);

      // Pass 3: linked properties via property_contacts join
      const { data: pcRows } = await supabase.from('property_contacts')
        .select('property_id').eq('contact_id', contact.id);
      if (pcRows && pcRows.length > 0) {
        const propIds = pcRows.map(r => r.property_id);
        const { data: props } = await supabase.from('properties')
          .select('id, nickname, address, city, state, category, status').in('id', propIds);
        if (!cancelled && props) setLinkedProperties(props);
      } else if (!cancelled) {
        setLinkedProperties([]);
      }

      // Contact ↔ contact relationships (either side)
      const { data: relRows } = await supabase.from('contact_relationships')
        .select('id, contact_a_id, contact_b_id, type, notes, created_at')
        .or(`contact_a_id.eq.${contact.id},contact_b_id.eq.${contact.id}`)
        .order('created_at', { ascending: false });
      if (!cancelled && relRows) setRelationships(relRows);

      // Linked brain entries (via brain_contacts junction — added May 31, 2026)
      const { data: bcRows } = await supabase.from('brain_contacts').select('brain_entry_id').eq('contact_id', contact.id);
      if (bcRows && bcRows.length > 0) {
        const ids = bcRows.map(r => r.brain_entry_id);
        const { data: brainRows } = await supabase.from('brain')
          .select('id, type, title, pinned, event_date, strength, tags').in('id', ids);
        if (!cancelled && brainRows) setLinkedBrain(brainRows);
      } else if (!cancelled) {
        setLinkedBrain([]);
      }

      // Linked investments (via investment_contacts junction — added May 31, 2026)
      const { data: icRows } = await supabase.from('investment_contacts').select('investment_id').eq('contact_id', contact.id);
      if (icRows && icRows.length > 0) {
        const ids = icRows.map(r => r.investment_id);
        const { data: invRows } = await supabase.from('investments')
          .select('id, name, kind, stage, amount, income_ytd, expense_ytd').in('id', ids);
        if (!cancelled && invRows) setLinkedInvestments(invRows);
      } else if (!cancelled) {
        setLinkedInvestments([]);
      }
    })();
    return () => { cancelled = true; };
  }, [contact?.id]);

  // Compute communication summary from contact fields (already populated by sync)
  function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  }
  function formatRelative(ts) {
    const d = daysSince(ts);
    if (d === null) return '';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d/7)}w ago`;
    if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  }
  const lastIn = contact.last_inbound_at;
  const lastOut = contact.last_outbound_at;
  const lastDir = contact.last_communication_direction;
  const lastChannel = contact.last_communication_channel || 'email';
  // Settled/handled must silence this panel too — it sits directly under the
  // pill that says Settled, so disagreeing here is the most visible way for the
  // app to contradict itself.
  const oweReply = owesReply(contact);
  const owedDays = (oweReply && lastIn) ? daysSince(lastIn) : null;


  async function logInteraction() {
    if (!interactionForm.channel || !interactionForm.direction) return;
    const occurredAt = interactionForm.occurred_at
      ? new Date(interactionForm.occurred_at).toISOString()
      : new Date().toISOString();
    const { data: created } = await supabase.from('contact_interactions').insert({
      user_id: userId,
      contact_id: contact.id,
      channel: interactionForm.channel,
      direction: interactionForm.direction,
      occurred_at: occurredAt,
      brief: interactionForm.brief.trim() || null,
    }).select().single();
    if (created) {
      setInteractions(prev => [created, ...prev]);
      // Also bump contact's last_inbound/outbound + channel + direction if this is more recent
      const isMoreRecentInbound = interactionForm.direction === 'inbound' && (!lastIn || new Date(occurredAt) > new Date(lastIn));
      const isMoreRecentOutbound = interactionForm.direction === 'outbound' && (!lastOut || new Date(occurredAt) > new Date(lastOut));
      const patch = {};
      if (isMoreRecentInbound) patch.last_inbound_at = occurredAt;
      if (isMoreRecentOutbound) patch.last_outbound_at = occurredAt;
      // Recompute direction
      const newIn = patch.last_inbound_at || lastIn;
      const newOut = patch.last_outbound_at || lastOut;
      if (newIn || newOut) {
        patch.last_communication_channel = interactionForm.channel;
        patch.last_communication_direction = (!newOut || (newIn && new Date(newIn) > new Date(newOut))) ? 'inbound' : 'outbound';
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('contacts').update(patch).eq('id', contact.id);
        if (error) {
          notify("Couldn't update contact's last-contact info.", 'error');
        } else {
          // Update local contact object — caller may not refetch
          Object.assign(contact, patch);
        }
      }
      setShowLogInteraction(false);
      setInteractionForm({ channel: 'phone', direction: 'outbound', occurred_at: new Date().toISOString().slice(0, 16), brief: '' });
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEvidence(true);
      const { data } = await supabase.from('disc_evidence')
        .select('*').eq('contact_id', contact.id).order('weight', { ascending: false }).limit(20);
      if (!cancelled) {
        setEvidence(data || []);
        setLoadingEvidence(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contact.id]);

  async function reanalyze() {
    setAnalyzing(true); setAnalyzeMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('disc-analyze', {
        body: { contact_id: contact.id, user_id: userId, force: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Reload profile + evidence
      const { data: freshProfile } = await supabase.from('profiles').select('*').eq('contact_id', contact.id).maybeSingle();
      const { data: freshEvidence } = await supabase.from('disc_evidence').select('*').eq('contact_id', contact.id).order('weight', { ascending: false }).limit(20);
      if (freshProfile) onProfileUpdate(freshProfile);
      if (freshEvidence) setEvidence(freshEvidence);
      setAnalyzeMsg({ type: 'ok', text: `Updated · ${data.status || 'ok'} · ${data.evidence_count || 0} pieces of evidence` });
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Failed: ' + (e.message || e) });
    } finally {
      setAnalyzing(false);
      setTimeout(() => setAnalyzeMsg(null), 5000);
    }
  }

  // ─── Reset actions: clear analyzed DISC, research, or everything ───
  // 'disc'     → clears observed scores + evidence + queue rows (keeps baseline + research)
  // 'research' → clears research_* fields (keeps observed + baseline)
  // 'all'      → clears observed + research + baseline + evidence + queue (full wipe)
  async function performReset(kind) {
    const messages = {
      disc:     'Reset observed DISC analysis? This clears scores, evidence, and queued analysis. Baseline and research are kept.',
      research: 'Reset research profile? This clears the web-research scores and the full report.',
      all:      'Reset ALL DISC data (observed + baseline + research + evidence)? This cannot be undone.',
    };
    if (!await confirmDialog(messages[kind] || 'Reset?')) return;
    setResetting(true); setAnalyzeMsg(null);
    try {
      const profileUpdates = {};
      if (kind === 'disc' || kind === 'all') {
        Object.assign(profileUpdates, {
          d_score: null, i_score: null, s_score: null, c_score: null,
          primary_letter: null, secondary_letter: null,
          analysis_status: null, last_analyzed_at: null,
          confidence: null, confidence_pct: null,
          rationale: null, signal_snapshot: null,
          signals_count: null, drift_note: null,
        });
      }
      if (kind === 'research' || kind === 'all') {
        Object.assign(profileUpdates, {
          research_d_score: null, research_i_score: null, research_s_score: null, research_c_score: null,
          research_primary: null, research_secondary: null, research_confidence: null,
          research_taken_at: null, research_summary: null, research_full_report: null,
          research_scope: null, research_matched_by: null,
        });
      }
      if (kind === 'all') {
        Object.assign(profileUpdates, {
          baseline_d_score: null, baseline_i_score: null, baseline_s_score: null, baseline_c_score: null,
          baseline_primary: null, baseline_secondary: null,
          baseline_taken_at: null, baseline_source: null, baseline_locked: false,
        });
      }
      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await supabase.from('profiles').update(profileUpdates).eq('contact_id', contact.id);
        if (error) throw error;
      }
      if (kind === 'disc' || kind === 'all') {
        await supabase.from('disc_evidence').delete().eq('contact_id', contact.id);
        await supabase.from('disc_analysis_queue').delete().eq('contact_id', contact.id);
        setEvidence([]);
      }
      // Reload profile so the UI reflects the reset
      const { data: fresh } = await supabase.from('profiles').select('*').eq('contact_id', contact.id).maybeSingle();
      if (fresh) onProfileUpdate(fresh);
      setAnalyzeMsg({ type: 'ok', text: kind === 'all' ? 'Full DISC reset complete.' : kind === 'disc' ? 'Observed DISC cleared.' : 'Research profile cleared.' });
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Reset failed: ' + (e.message || e) });
    } finally {
      setResetting(false);
      setTimeout(() => setAnalyzeMsg(null), 5000);
    }
  }

  // ─── Relationships: add and remove ───
  async function addRelationship() {
    if (!relTargetId || relTargetId === contact.id) return;
    setSavingRel(true);
    try {
      const { data, error } = await supabase.from('contact_relationships').insert({
        user_id: userId,
        contact_a_id: contact.id,
        contact_b_id: relTargetId,
        type: relType,
      }).select().single();
      if (error) {
        if (error.code === '23505') {
          notify('That relationship already exists.', 'error');
        } else {
          notify("Couldn't save relationship: " + error.message, 'error');
        }
      } else if (data) {
        setRelationships(prev => [data, ...prev]);
        setRelTargetId(''); setRelType('spouse'); setShowAddRel(false);
      }
    } finally {
      setSavingRel(false);
    }
  }

  async function removeRelationship(rel) {
    if (!await confirmDialog('Remove this relationship?')) return;
    const { error } = await supabase.from('contact_relationships').delete().eq('id', rel.id);
    if (error) { notify("Couldn't remove relationship.", 'error'); return; }
    setRelationships(prev => prev.filter(r => r.id !== rel.id));
  }

  // Helper: label for a relationship type as seen FROM this contact's perspective.
  // For asymmetric types (parent/child), invert when this contact is on the b-side.
  function relLabel(rel) {
    const thisIsA = rel.contact_a_id === contact.id;
    const inverseMap = { parent: 'child', child: 'parent' };
    if (!thisIsA && inverseMap[rel.type]) return inverseMap[rel.type];
    return rel.type;
  }
  function otherContactId(rel) {
    return rel.contact_a_id === contact.id ? rel.contact_b_id : rel.contact_a_id;
  }

  async function saveBaseline() {
    const scores = { D: baseD, I: baseI, S: baseS, C: baseC };
    const primary = Object.keys(scores).reduce((a,b) => scores[a] > scores[b] ? a : b);
    const secondary = Object.keys(scores)
      .filter(k => k !== primary)
      .reduce((a,b) => scores[a] > scores[b] ? a : b);
    const showSecondary = scores[secondary] >= 50 && (scores[primary] - scores[secondary]) <= 25;
    setSavingBase(true);
    try {
      const payload = {
        baseline_d_score: baseD, baseline_i_score: baseI, baseline_s_score: baseS, baseline_c_score: baseC,
        baseline_primary: primary,
        baseline_secondary: showSecondary ? secondary : null,
        baseline_taken_at: baseTakenAt,
        baseline_source: baseSource || 'Prism Test',
        baseline_locked: true,
      };
      let upd;
      if (profile) {
        const { data } = await supabase.from('profiles').update(payload).eq('id', profile.id).select().single();
        upd = data;
      } else {
        const { data } = await supabase.from('profiles').insert({
          ...payload,
          user_id: userId, contact_id: contact.id, subject_kind: 'contact',
          confidence: 'high', source: 'manual',
          d_score: baseD, i_score: baseI, s_score: baseS, c_score: baseC,
          primary_letter: primary, secondary_letter: showSecondary ? secondary : null,
        }).select().single();
        upd = data;
      }
      if (upd) onProfileUpdate(upd);
      setShowBaselineForm(false);
      setAnalyzeMsg({ type: 'ok', text: 'Baseline test result saved.' });
      setTimeout(() => setAnalyzeMsg(null), 4000);
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Save failed: ' + (e.message || e) });
      setTimeout(() => setAnalyzeMsg(null), 5000);
    } finally {
      setSavingBase(false);
    }
  }

  const hasBaseline = !!(profile && profile.baseline_d_score !== null && profile.baseline_d_score !== undefined);
  const hasInference = !!(profile && profile.last_analyzed_at);
  const hasResearch = !!(profile && profile.research_taken_at);
  // ── Behavioral fusion / deduction layer ──────────────────────────────────
  // Collapses the three stored layers — official test (authoritative), direct
  // interactions (strong), public research (a capped voice) — into ONE canonical
  // read with an honestly-capped confidence, so new intelligence actually moves
  // the needle instead of sitting inert in a side panel.
  function fuseBehavioralSignal(p) {
    if (!p) return null;
    const L = ['D', 'I', 'S', 'C'];
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
    const has = (v) => v !== null && v !== undefined;
    const pick = (sc) => {
      const a = L.map(k => [k, sc[k] ?? 0]).sort((x, y) => y[1] - x[1]);
      return { primary: a[0][0], secondary: (a[1][1] >= 50 && a[0][1] - a[1][1] <= 20) ? a[1][0] : null };
    };
    const baseline = has(p.baseline_d_score) ? { D: p.baseline_d_score, I: p.baseline_i_score, S: p.baseline_s_score, C: p.baseline_c_score } : null;
    // A 'pending' analysis with all-zero scores is an un-run placeholder, not a
    // real observation — treat it as no observation so we fall through to the
    // research read (Layer 3) instead of rendering flat zeros.
    const _obsZeroed = (p.analysis_status === 'pending') && !p.d_score && !p.i_score && !p.s_score && !p.c_score;
    const observed = (p.last_analyzed_at && !_obsZeroed) ? { D: p.d_score ?? 50, I: p.i_score ?? 50, S: p.s_score ?? 50, C: p.c_score ?? 50 } : null;
    const research = has(p.research_d_score) ? { D: p.research_d_score, I: p.research_i_score, S: p.research_s_score, C: p.research_c_score } : null;
    const directMass = observed ? (p.signals_count || 0) : 0;
    const obsConf = observed ? (p.confidence_pct || 0) : 0;
    const observedMeaningful = !!observed && (directMass >= 2 || obsConf >= 40);

    // Layer 1 — an official test on file is authoritative.
    if (baseline && (p.baseline_locked || p.baseline_source)) {
      const b = pick(baseline);
      return { scores: baseline, primary: p.baseline_primary || b.primary, secondary: p.baseline_secondary || b.secondary,
        pct: 95, tier: 'Confirmed', source: `official ${p.baseline_source || 'DISC'} test`,
        rationale: 'Locked to the official assessment on file. The layers below are shown as context only.' };
    }

    let scores, pct, primary, secondary, source, basis, note = null;
    if (observedMeaningful && research) {
      // Layer 2 — blend direct interactions (heavier) with public research (a capped voice).
      const wObs = Math.min(6, directMass) + 1, wRes = 1.2;
      scores = {}; L.forEach(k => scores[k] = clamp((observed[k] * wObs + research[k] * wRes) / (wObs + wRes)));
      const op = pick(observed).primary, rp = pick(research).primary;
      note = op !== rp ? `Direct interactions read ${op} while public presentation reads ${rp} — trusting interactions, watching for context-switching.` : null;
      ({ primary, secondary } = pick(scores));
      pct = clamp(Math.min(88, obsConf + (note ? -8 : 8) + Math.min(10, directMass)));
      source = 'direct interactions + public research';
      basis = `${directMass} direct signal${directMass === 1 ? '' : 's'} blended with public research`;
    } else if (observedMeaningful) {
      scores = { ...observed }; ({ primary, secondary } = pick(scores));
      primary = p.primary_letter || primary; secondary = p.secondary_letter || secondary;
      pct = clamp(Math.min(88, obsConf));
      source = 'direct interactions'; basis = `${directMass} direct signal${directMass === 1 ? '' : 's'} (emails, notes, calls)`;
    } else if (research) {
      // Layer 3 — sparse direct data but real research: move OFF the flat 50s toward the
      // research read, at a CAPPED confidence (public self-presentation ≠ how they engage).
      scores = { ...research };
      const r = pick(scores);
      primary = p.research_primary || r.primary; secondary = p.research_secondary || r.secondary;
      const rc = String(p.research_confidence || '').toLowerCase();
      const base = rc.includes('high') ? 66 : rc.includes('medium') ? 60 : (rc.includes('prov') || rc.includes('tent')) ? 52 : 55;
      pct = clamp(Math.min(70, base));
      source = 'public & professional presentation';
      basis = 'inferred from public & professional presentation (no direct interactions yet)';
      note = 'Public data shows how they present, not how they engage — expect this to sharpen, and possibly shift, once real interactions arrive.';
    } else {
      scores = observed || { D: 50, I: 50, S: 50, C: 50 }; ({ primary, secondary } = pick(scores));
      pct = clamp(obsConf || 0); source = 'insufficient evidence'; basis = 'not enough evidence yet';
    }
    const tier = pct >= 90 ? 'Confirmed' : pct >= 75 ? 'High' : pct >= 55 ? 'Medium' : pct >= 35 ? 'Emerging' : 'Provisional';
    let rationale = `Best available read, ${basis}.`; if (note) rationale += ' ' + note;
    return { scores, primary, secondary, pct, tier, source, rationale };
  }
  const fused = profile ? fuseBehavioralSignal(profile) : null;
  const discBarColors = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6' };

  // Identify candidates for this contact, then either auto-run (locked) or
  // prompt for candidate selection (strong/weak/insufficient).
  async function startResearch(hint) {
    // If a completed report already exists, SHOW IT — don't blindly re-identify.
    // Re-identification is flaky and can come back empty, which previously buried
    // a saved 23k-char profile behind a false "no profiles found" error. A refresh
    // is only forced when the user passes an explicit hint (the "search with this
    // detail" path) or clicks Re-run.
    if (!hint && profile && profile.research_status === 'done' &&
        (profile.research_full_report || profile.research_profile)) {
      setShowResearchModal(false);
      setShowResearchReport(true);
      setResearchStage('idle');
      return;
    }
    setResearchStage('identifying');
    setResearchError(null);
    setResearchCandidates([]);
    const proceed = (candidates, confidence) => {
      setResearchCandidates(candidates || []);
      if (confidence === 'insufficient') {
        setResearchError('Not enough info to identify this person safely. Add an email, phone, or employer to the contact.');
        setResearchStage('error');
        return;
      }
      if ((candidates || []).length === 0) {
        // If we already have a saved report, don't dead-end — offer it.
        if (profile && profile.research_status === 'done' && (profile.research_full_report || profile.research_profile)) {
          setShowResearchModal(false);
          setShowResearchReport(true);
          setResearchStage('idle');
          return;
        }
        // If the identifiers are STRONG (locked = email/phone present) but the
        // identify step returned no candidate, don't tell the user to "add more
        // identifiers" they already have — just research with what we know. The
        // identify pre-check is a safety net against name collisions, not a
        // requirement; with a strong anchor we can research directly. This was
        // the dead-end that blocked agents ("No matching public profiles found").
        if (confidence === 'locked') {
          runResearch({
            name: contact.name,
            headline: [contact.role, contact.company].filter(Boolean).join(' at ') || null,
            location: contact.city || null,
            source_url: (contact.socials && (contact.socials.linkedin || contact.socials.instagram)) || null,
          }, (contact && contact.email) ? 'email' : (contact && contact.phone ? 'phone' : 'manual'));
          return;
        }
        setResearchError('No matching public profiles found. Try adding an email, phone, or a LinkedIn/Instagram in Details.');
        setResearchStage('error');
        return;
      }
      if (confidence === 'locked' && candidates.length >= 1) {
        runResearch(candidates[0], (contact && contact.email) ? 'email' : (contact && contact.phone ? 'phone' : 'manual'));
      } else {
        setResearchStage('choose_candidate');
      }
    };
    try {
      const { data, error } = await supabase.functions.invoke('contact-identify', {
        body: { contact_id: contact.id, hint: (hint && String(hint).trim()) || undefined },
      });
      if (error) {
        let m = error.message || 'Identity lookup failed';
        try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (_) {}
        throw new Error(m);
      }
      if (data && data.error) throw new Error(data.error);
      // Identify now runs in the background (fixes iOS Safari killing the long
      // web-search request). Poll the profile until it finishes.
      if (data && data.status === 'identifying') {
        const started = Date.now();
        const poll = async () => {
          try {
            const { data: p } = await supabase.from('profiles')
              .select('identify_status, identify_candidates, identify_confidence, identify_error')
              .eq('contact_id', contact.id).maybeSingle();
            if (p && p.identify_status === 'done') { proceed(p.identify_candidates || [], p.identify_confidence); return; }
            if (p && p.identify_status === 'error') { setResearchError(p.identify_error || 'Identity lookup failed. Please try again.'); setResearchStage('error'); return; }
            if (Date.now() - started > 180000) { setResearchError('This is taking longer than usual — reopen this contact in a minute and try again.'); setResearchStage('error'); return; }
            setTimeout(poll, 5000);
          } catch (_e) { setTimeout(poll, 5000); }
        };
        poll();
      } else {
        proceed(data.candidates || [], data.confidence);
      }
    } catch (err) {
      setResearchError(err.message || String(err));
      setResearchStage('error');
    }
  }

  async function runResearch(candidate, matchedBy) {
    setResearchStage('researching');
    setResearchError(null);
    try {
      const { data, error } = await supabase.functions.invoke('contact-research', {
        body: {
          contact_id: contact.id,
          candidate,
          scope: researchScope,
          matched_by: matchedBy,
        },
      });
      if (error) {
        let m = error.message || 'Research failed';
        try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (_) {}
        throw new Error(m);
      }
      if (data && data.error) throw new Error(data.error);
      // Research now runs in the background (no more edge-timeout). Poll the
      // profile until it finishes so the button never dead-ends.
      const started = Date.now();
      const poll = async () => {
        try {
          const { data: p } = await supabase.from('profiles')
            .select('*').eq('contact_id', contact.id).maybeSingle();
          if (p && p.research_status === 'done') { onProfileUpdate(p); setResearchStage('done'); return; }
          if (p && p.research_status === 'error') { setResearchError(p.research_error || 'Research failed. Please try again.'); setResearchStage('error'); return; }
          if (Date.now() - started > 240000) { setResearchError('This is taking longer than usual — it will keep running in the background. Reopen this contact in a minute to see the result.'); setResearchStage('error'); return; }
          setTimeout(poll, 6000);
        } catch (_e) { setTimeout(poll, 6000); }
      };
      poll();
    } catch (err) {
      setResearchError(err.message || String(err));
      setResearchStage('error');
    }
  }

  // Copy research-derived DISC into baseline_* fields
  async function useResearchAsBaseline() {
    if (!profile || !profile.research_d_score) return;
    setSavingBase(true);
    try {
      const { data, error } = await supabase.from('profiles').update({
        baseline_d_score: profile.research_d_score,
        baseline_i_score: profile.research_i_score,
        baseline_s_score: profile.research_s_score,
        baseline_c_score: profile.research_c_score,
        baseline_primary: profile.research_primary,
        baseline_secondary: profile.research_secondary,
        baseline_source: `Research (${profile.research_scope}, ${profile.research_confidence})`,
        baseline_taken_at: profile.research_taken_at,
        baseline_locked: true,
      }).eq('id', profile.id).select().single();
      if (error) throw error;
      onProfileUpdate(data);
      setAnalyzeMsg({ type: 'ok', text: 'Research read copied to baseline.' });
      setTimeout(() => setAnalyzeMsg(null), 4000);
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Copy failed: ' + (e.message || e) });
    } finally {
      setSavingBase(false);
    }
  }

  function discBars(d, i, s, c, label) {
    return (
      <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
        {label && <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600}}>{label}</div>}
        {[['D',d],['I',i],['S',s],['C',c]].map(([letter, val]) => (
          <div key={letter} style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{width:'14px',fontWeight:700,color:discBarColors[letter],fontSize:'12px'}}>{letter}</span>
            <div style={{flex:1,height:'8px',background:'var(--bg-base)',borderRadius:'4px',overflow:'hidden'}}>
              <div className="bar-fill-anim" style={{height:'100%',width:`${val ?? 0}%`,background:discBarColors[letter],transition:'width 0.3s'}}/>
            </div>
            <span style={{minWidth:'28px',textAlign:'right',fontSize:'11px',fontFamily:'monospace',color:'var(--text-2)'}}>{val ?? '—'}</span>
          </div>
        ))}
      </div>
    );
  }

  const hdrInitials = (contact.name || '?').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
  const _hdrTypeMap = { our_agent:'Our Agent', agent:'Agent', lead:'Lead', recruit:'Recruit', prospect_agent:'Prospect Agent', vendor:'Vendor', family:'Family', personal:'Personal', partner:'Partner', broker:'Broker', brokerage:'Brokerage', commercial_tenant:'Tenant', doctor:'Doctor', other:'Other', misc:'Other' };
  const hdrTypeLabel = contact.type ? (_hdrTypeMap[contact.type] || contact.type.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())) : null;
  const _hdrTs = [contact.last_contact_at, contact.last_inbound_at, contact.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime());
  const _hdrLastTs = _hdrTs.length ? Math.max(..._hdrTs) : null;
  const _hdrRelAge = (ms) => { if (!ms) return null; const d = Math.floor((Date.now()-ms)/86400000); if (d<=0) return 'today'; if (d===1) return '1d ago'; if (d<7) return d+'d ago'; if (d<30) return Math.floor(d/7)+'w ago'; if (d<365) return Math.floor(d/30)+'mo ago'; return Math.floor(d/365)+'y ago'; };
  const hdrLastAge = _hdrRelAge(_hdrLastTs);
  // Three states, because two was a lie. Machine-derived direction is often
  // right but sometimes wrong, and there is a third truth it can't represent:
  // the exchange is FINISHED — nobody owes anybody and this person isn't on a
  // keep-in-touch loop. Without it the only way to stop the nudges was to
  // delete the cadence or let a false "they're waiting" sit there forever.
  // "Settled" is only still true if they HAVEN'T written since you settled it.
  // A newer inbound re-arms the reply — same rule owesReply() uses — so the badge
  // never says "Settled" while the Reach-Out-Next card says "you owe a reply".
  // (ONE RULE, ONE PLACE: don't re-derive "is settled" from the raw column.)
  const _settleStillValid = !!contact.comms_settled_at &&
    !(contact.last_inbound_at && new Date(contact.last_inbound_at).getTime() > new Date(contact.comms_settled_at).getTime());
  const hdrSettled = _settleStillValid;
  const hdrLastDir = hdrSettled ? '✓ Settled'
    : contact.last_communication_direction === 'inbound' ? '↓ They'
    : contact.last_communication_direction === 'outbound' ? '↑ You'
    : (_hdrLastTs ? 'Last' : null);
  // A PICKER, not a cycle. Cycling They -> You -> Settled forced a lie: reaching
  // Settled meant first declaring "I replied last", writing direction='outbound'
  // when no reply was sent. False, and unstable too — recompute_contact_comms_one
  // rewrites direction from real messages on the next sync, so the fib did not
  // even survive. Three states, one tap each, no invented middle step.
  // ("settled" stays its own column precisely BECAUSE recompute owns direction.)
  const [commsMenu, setCommsMenu] = useState(false);
  const setCommsState = async (which) => {
    setCommsMenu(false);
    const patch = which === 'settled' ? { comms_settled_at: new Date().toISOString() }
      : which === 'they' ? { comms_settled_at: null, last_communication_direction: 'inbound' }
      : { comms_settled_at: null, last_communication_direction: 'outbound' };
    const { error } = await supabase.from('contacts').update(patch).eq('id', contact.id);
    if (error) { if (window.__notify) window.__notify('Could not update: ' + (error.message || error), 'error'); return; }
    Object.assign(contact, patch);
    if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, ...patch } : c));
    if (window.__notify) window.__notify(
      which === 'settled' ? 'Settled — no reply owed either way. Your keep-in-touch cadence still runs.'
        : which === 'they' ? 'Marked: they wrote last — you owe a reply.'
        : 'Marked: you wrote last — waiting on them.', 'success');
  };

  // "Touch due" read as a button and did nothing, which is the worst of both.
  // It now snoozes the keep-in-touch nudge, reversibly — the cadence itself is
  // untouched, this just says "not this fortnight".
  const snoozeTouch = async () => {
    const until = new Date(Date.now() + 14 * 86400000).toISOString();
    const { error } = await supabase.from('contacts').update({ reachout_snooze_until: until }).eq('id', contact.id);
    if (error) { if (window.__notify) window.__notify('Could not snooze: ' + (error.message || error), 'error'); return; }
    contact.reachout_snooze_until = until;
    if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, reachout_snooze_until: until } : c));
    if (window.__notify) window.__notify('Touch snoozed for 2 weeks.', 'success', { label: 'Undo', onClick: async () => {
      await supabase.from('contacts').update({ reachout_snooze_until: null }).eq('id', contact.id);
      contact.reachout_snooze_until = null;
      if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, reachout_snooze_until: null } : c));
    }});
  };
  const hdrTouchDue = contact.cadence_days ? (_hdrLastTs ? (Date.now()-_hdrLastTs)/86400000 >= contact.cadence_days : true) : false;
  const _hdrOriginMap = {manual:'Manual entry',referral:'Referral',open_house:'Open house',prospecting:'Cold list / prospecting',website:'Website / inbound',sphere:'Sphere / past client',event:'Event / networking',social:'Social media',email:'From email',csv:'CSV import',import:'Import',other:'Other'};
  const _hdrReferredBy = contact.referred_by_contact_id ? ((contacts.find(c => c.id === contact.referred_by_contact_id) || {}).name) : null;
  const _hdrHome = [contact.home_address, contact.home_city, contact.home_state].filter(Boolean).join(', ');
  const _hdrBiz = [contact.business_address, contact.business_city, contact.business_state].filter(Boolean).join(', ');
  const hdrKeyFacts = [];
  if (contact.origin) hdrKeyFacts.push({ k:'Origin', v:(_hdrOriginMap[contact.origin]||contact.origin) + (contact.origin_detail ? ' · '+contact.origin_detail : '') });
  if (_hdrReferredBy) hdrKeyFacts.push({ k:'Referred by', v:_hdrReferredBy });
  if (_hdrHome) hdrKeyFacts.push({ k:'Home', v:_hdrHome });
  if (_hdrBiz) hdrKeyFacts.push({ k:'Business', v:_hdrBiz });
  const PIPE_STAGES = [ { id:'new', label:'New' }, { id:'attempting', label:'Attempting' }, { id:'contacted', label:'Contacted' }, { id:'appointment_set', label:'Appt' }, { id:'nurture', label:'Nurture' }, { id:'closed', label:'Closed' } ];
  const updatePipe = async (patch) => {
    patch = { ...patch };
    if (patch.pipeline_stage !== undefined) patch.pipeline_stage_changed_at = new Date().toISOString();
    const { error } = await supabase.from('contacts').update(patch).eq('id', contact.id);
    if (!error) { Object.assign(contact, patch); if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, ...patch } : c)); }
  };
  const curStageIdx = contact.pipeline_stage ? PIPE_STAGES.findIndex(s => s.id === contact.pipeline_stage) : -1;
  const curSystem = contact.lead_gen_system_id ? leadSystems.find(s => s.id === contact.lead_gen_system_id) : null;
  const leadKpi = (() => {
    const byId = {};
    (contacts || []).forEach(c => { if (!c.lead_gen_system_id) return; const k = c.lead_gen_system_id; byId[k] = byId[k] || { leads:0, closed:0 }; byId[k].leads++; if (c.pipeline_stage === 'closed') byId[k].closed++; });
    return leadSystems.map(s => { const d = byId[s.id] || { leads:0, closed:0 }; const conv = d.leads ? Math.round((d.closed / d.leads) * 100) : 0; const budget = Number(s.monthly_budget) || 0; const cpl = d.leads ? budget / d.leads : null; return { id:s.id, name:s.name, color:s.color, leads:d.leads, closed:d.closed, conv, budget, cpl }; }).filter(x => x.leads > 0 || x.budget > 0).sort((a,b) => b.leads - a.leads);
  })();
  const leadKpiMax = Math.max(1, ...leadKpi.map(x => x.leads));
  return createPortal((
    <div className="modal-overlay overlay-fade" onClick={e => e.target === e.currentTarget && onClose()} style={{padding:0,alignItems:'stretch',justifyContent:'center',zIndex:2500}}>
      <div className="modal sheet-rise ww-prism" style={{maxWidth:'640px',width:'100%',height:'100dvh',maxHeight:'100dvh',margin:0,padding:0,borderRadius:0,display:'flex',flexDirection:'column',overflow:'hidden',background:'radial-gradient(120% 18% at 50% 0%, rgba(203,163,92,.08), transparent 55%), #100D09'}}>
        <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
        <div style={{padding:'calc(14px + env(safe-area-inset-top, 0px)) 16px 12px',borderBottom:'1px solid var(--border)',background:'linear-gradient(180deg,var(--bg-card),var(--bg-base))'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'12px'}}>
            <div style={{width:'54px',height:'54px',borderRadius:'50%',flexShrink:0,background:'linear-gradient(135deg,var(--bg-hover),var(--bg-card))',border:'2px solid var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'19px',color:'var(--accent)',boxShadow:'0 0 0 4px rgba(197,169,94,0.08)'}}>{hdrInitials}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:'24px',fontWeight:300,fontFamily:'Fraunces, serif',color:'#F6F1E7',letterSpacing:'-0.01em',lineHeight:1.12,overflow:'hidden',textOverflow:'ellipsis'}}>{contact.name || '(unnamed)'}</div>
              {(contact.role || contact.profession || contact.company) && (
                <div style={{fontSize:'12.5px',color:'var(--text-2)',marginTop:'3px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{[contact.role || contact.profession, contact.company].filter(Boolean).join(' · ')}</div>
              )}
            </div>
            <div style={{display:'flex',gap:'5px',flexShrink:0}}>
              {onEdit && (
                <button type="button" onClick={onEdit} title="Edit" style={{width:'32px',height:'32px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-card)',color:'var(--text-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="edit" size={15} /></button>
              )}
              <button type="button" onClick={onClose} title="Close" style={{width:'32px',height:'32px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-card)',color:'var(--text-2)',cursor:'pointer',fontSize:'17px',lineHeight:1}}>×</button>
            </div>
          </div>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'12px'}}>
            {hdrTypeLabel && <span style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'11px',fontWeight:700,padding:'4px 9px',borderRadius:'999px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',color:'var(--accent)'}}>{hdrTypeLabel}</span>}
            {profile?.primary_letter && <span style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'11px',fontWeight:700,padding:'4px 9px',borderRadius:'999px',background:'rgba(255,255,255,0.04)',border:'1px solid '+discBarColors[profile.primary_letter],color:discBarColors[profile.primary_letter]}}>DISC {profile.primary_letter}{profile.secondary_letter ? '/'+profile.secondary_letter : ''}</span>}
            {hdrTouchDue && (
              <button type="button" onClick={snoozeTouch} title="Due for a keep-in-touch — tap to snooze it for 2 weeks"
                style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11px',fontWeight:700,padding:'4px 9px',borderRadius:'999px',cursor:'pointer',background:'rgba(245,158,11,0.13)',border:'1px solid rgba(245,158,11,0.4)',color:'#fbbf24'}}>
                <span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#fbbf24'}} />Touch due
              </button>
            )}
            {hdrLastAge && (
              <span style={{position:'relative',display:'inline-flex'}}>
                <button type="button" onClick={() => setCommsMenu(v => !v)}
                  title="Who owes a reply? Tap to set it"
                  style={{fontSize:'11px',fontWeight:600,padding:'4px 9px',borderRadius:'999px',cursor:'pointer',
                    background: hdrSettled ? 'rgba(197,169,94,0.14)' : 'var(--bg-card)',
                    border:'1px solid ' + (hdrSettled ? 'var(--accent)' : 'var(--border)'),
                    color: hdrSettled ? 'var(--accent)' : 'var(--text-2)'}}>
                  {hdrLastDir} · {hdrLastAge} ▾
                </button>
                {commsMenu && (
                  <>
                    {/* tap-away layer — there is no Escape key on a phone */}
                    <span onClick={() => setCommsMenu(false)} style={{position:'fixed',inset:0,zIndex:60}} />
                    <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:61,width:'232px',
                      background:'var(--bg-card)',border:'1px solid var(--accent-dim)',borderRadius:'10px',
                      padding:'6px',boxShadow:'0 10px 28px rgba(0,0,0,.5)'}}>
                      {[
                        ['they',    'They wrote last',  'You owe them a reply'],
                        ['you',     'You wrote last',   'Waiting on them'],
                        ['settled', 'Settled',          'Nobody owes anything. Cadence still runs.'],
                      ].map(([key, label, sub]) => {
                        const active = key === 'settled' ? hdrSettled
                          : !hdrSettled && contact.last_communication_direction === (key === 'they' ? 'inbound' : 'outbound');
                        return (
                          <button key={key} type="button" onClick={() => setCommsState(key)}
                            style={{display:'block',width:'100%',textAlign:'left',cursor:'pointer',borderRadius:'7px',
                              padding:'7px 9px',marginBottom:'2px',
                              border:'1px solid ' + (active ? 'var(--accent)' : 'transparent'),
                              background: active ? 'rgba(197,169,94,.14)' : 'none'}}>
                            <div style={{fontSize:'12.5px',fontWeight:700,color: active ? 'var(--accent)' : 'var(--text-1)'}}>{label}</div>
                            <div style={{fontSize:'10.5px',color:'var(--text-3)',lineHeight:1.35}}>{sub}</div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {(contact.phone || contact.email) && (
          <div style={{display:'flex',gap:'8px',padding:'13px 16px 0'}}>
            {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',padding:'11px 0',borderRadius:'11px',background:'linear-gradient(135deg,var(--accent-2),var(--accent))',color:'var(--bg-base)',textDecoration:'none',fontSize:'13.5px',fontWeight:700}}><Icon name="quo" size={15} /> Call</a>}
            {contact.phone && <button type="button" onClick={()=>setTextTo({ phone: contact.phone })} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',padding:'11px 0',borderRadius:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',color:'var(--text-1)',cursor:'pointer',fontSize:'13.5px',fontWeight:600}}><Icon name="message" size={15} /> Text</button>}
            {contact.email && <button type="button" onClick={()=>setEmailComposeOpen(true)} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',padding:'11px 0',borderRadius:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',color:'var(--text-1)',cursor:'pointer',fontSize:'13.5px',fontWeight:600}}><Icon name="mail" size={15} /> Email</button>}
          </div>
        )}
        {textTo && <QuoTextModal contact={contact} phone={textTo.phone} userId={userId} onClose={()=>setTextTo(null)} />}
        {emailComposeOpen && <FollowupDraftModal entry={{ entity_type:'contact', entity_id:contact.id, mentions:[contact.id] }} contacts={contacts} defaultContact={contact} userId={userId} onClose={()=>setEmailComposeOpen(false)} onSent={(cid, patch) => { Object.assign(contact, patch); if (setContacts) setContacts(prev => prev.map(c => c.id === cid ? { ...c, ...patch } : c)); }} />}

        <div style={{padding:'13px 16px 10px'}}>
          <div className="seg-track" style={{display:'flex',gap:'2px'}}>
            <button type="button" className={'seg-btn '+(tab==='overview'?'active':'')} style={{flex:1,fontSize:'10.5px',padding:'7px 1px'}} onClick={()=>setTab('overview')}>Overview</button>
            <button type="button" className={'seg-btn '+(tab==='activity'?'active':'')} style={{flex:1,fontSize:'10.5px',padding:'7px 1px'}} onClick={()=>setTab('activity')}>Activity</button>
            <button type="button" className={'seg-btn '+(tab==='insights'?'active':'')} style={{flex:1,fontSize:'10.5px',padding:'7px 1px'}} onClick={()=>setTab('insights')}>Insights</button>
            <button type="button" className={'seg-btn '+(tab==='details'?'active':'')} style={{flex:1,fontSize:'10.5px',padding:'7px 1px'}} onClick={()=>setTab('details')}>Details</button>
            <button type="button" className={'seg-btn '+(tab==='linked'?'active':'')} style={{flex:1,fontSize:'10.5px',padding:'7px 1px'}} onClick={()=>setTab('linked')}>Linked</button>
          </div>
        </div>

        <div style={{flex:1,minHeight:0,overflowY:'auto',overflowX:'hidden',paddingRight:'4px',paddingBottom:'120px'}}>
          {tab==='overview' && (<>
          {/* Production sits at the TOP of an agent's record on purpose: when you
              open a producer, their numbers are the context for everything else
              on the page. It renders nothing for non-agents and for agents with
              no transactions, so it costs other contacts nothing. */}
          <AgentProduction contactId={contact.id} canEdit={true} />
          {/* Roster card — the brokerage facts from the master roster. Shows only
              for agent-type contacts that actually have roster data, so it costs
              other contacts nothing. */}
          {(contact.type==='our_agent' || contact.type==='agent_lost') && (contact.nrds_number || contact.date_hired || contact.access_code || contact.previous_brokerage || contact.license_no || contact.realtor_board) && (
            <div style={{margin:'0 0 14px',padding:'14px 16px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:14}}>
              <div className="gold-move" style={{fontFamily:"'Barlow Condensed',sans-serif",textTransform:'uppercase',letterSpacing:'.22em',fontSize:10.5,fontWeight:700,marginBottom:10}}>Roster</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px 18px'}}>
                {[['Agent ID (NRDS)',contact.nrds_number],['Date hired',contact.date_hired],['License #',contact.license_no],['Access code',contact.access_code],['Previous brokerage',contact.previous_brokerage],['Board',contact.realtor_board]].filter(([,v])=>v).map(([k,v])=>(
                  <div key={k} style={{minWidth:0}}>
                    <div style={{fontSize:10.5,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>{k}</div>
                    <div style={{fontSize:13.5,color:'var(--text-1)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis'}}>{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <CadenceSuggestion contactId={contact.id} />
          <ContactKnowledge contactId={contact.id} />
          <PrepLeadButton contactId={contact.id} />
          {profile && (profile.primary_letter || hasBaseline) && (() => {
            const NAMES = { D:'Dominance', I:'Influence', S:'Steadiness', C:'Conscientiousness' };
            const TIPS = { D:'Direct and results-driven — be brief, lead with the bottom line, respect their time.', I:'Outgoing and relationship-driven — be warm and personal, keep the energy up.', S:'Steady and loyal — be patient and supportive; give time to decide, never pressure.', C:'Precise and analytical — lead with the facts and the detail; be accurate and thorough.' };
            const pl = profile.primary_letter, sl = profile.secondary_letter;
            const ub = hasBaseline;
            const dd = ub ? profile.baseline_d_score : profile.d_score;
            const ii = ub ? profile.baseline_i_score : profile.i_score;
            const ss = ub ? profile.baseline_s_score : profile.s_score;
            const cc = ub ? profile.baseline_c_score : profile.c_score;
            const pct = profile.confidence_pct;
            // A 28%-confidence guess used to render exactly like a verified
            // assessment: big bold letters and a prescriptive instruction to
            // "lead with the facts". Someone glancing at that walks into a
            // meeting believing it. Below the provisional floor the read stays
            // VISIBLE but stops presenting itself as fact — same principle as
            // refusing to auto-flip speaker labels we can't stand behind.
            const provisional = !ub && (pct == null || pct < 40);
            const confText = ub ? 'Verified assessment' : (pct != null ? pct + '% confidence' : 'Inferred');
            const confColor = ub ? '#34d399' : (pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : 'var(--text-3)');
            const srcLine = ub
              ? ('Source: ' + (profile.baseline_source || 'Official DISC') + (profile.baseline_taken_at ? ' · ' + new Date(profile.baseline_taken_at).toLocaleDateString() : ''))
              : 'Inferred from notes & communications';
            return (
              <div style={{margin:'2px 16px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'14px',padding:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',marginBottom:'12px'}}>
                  <span style={{fontSize:'10px',fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',color:'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="target" size={13} /> Behavioral Signal · DISC</span>
                  <span style={{fontSize:'10.5px',fontWeight:700,padding:'3px 10px',borderRadius:'999px',border:'1px solid '+confColor,color:confColor,whiteSpace:'nowrap'}}>{confText}</span>
                </div>
                {(dd!=null||ii!=null||ss!=null||cc!=null) && discBars(dd, ii, ss, cc, null)}
                {pl && (
                  <div style={{marginTop:'12px',display:'flex',alignItems:'baseline',gap:'9px',flexWrap:'wrap'}}>
                    <span style={{fontSize: provisional ? '19px' : '24px',fontWeight:800,lineHeight:1,
                      color: provisional ? 'var(--text-2)' : discBarColors[pl],
                      opacity: provisional ? 0.75 : 1}}>{pl}{sl?'/'+sl:''}</span>
                    <span style={{fontSize:'12.5px',color:'var(--text-2)'}}>{NAMES[pl]}{sl?' · '+NAMES[sl]:''}</span>
                    {provisional && <span style={{fontSize:'10px',fontWeight:700,color:'#f59e0b',border:'1px solid #f59e0b',borderRadius:'999px',padding:'2px 8px'}}>EARLY READ</span>}
                  </div>
                )}
                {pl && TIPS[pl] && (
                  provisional ? (
                    <div style={{marginTop:'10px',fontSize:'12px',color:'var(--text-2)',lineHeight:1.5,borderLeft:'2px solid var(--border)',paddingLeft:'11px'}}>
                      Too little evidence to coach from yet. <b>If</b> this read holds, {String(TIPS[pl]).charAt(0).toLowerCase() + String(TIPS[pl]).slice(1)} Treat it as a hypothesis to test on the next call — not a plan.
                    </div>
                  ) : (
                    <div style={{marginTop:'10px',fontSize:'12.5px',color:'var(--text-1)',lineHeight:1.5,borderLeft:'2px solid '+discBarColors[pl],paddingLeft:'11px'}}>{TIPS[pl]}</div>
                  )
                )}
                <div style={{marginTop:'10px',fontSize:'10.5px',color:'var(--text-3)'}}>{srcLine}</div>
              </div>
            );
          })()}
          <Tip id="cadence" label="Consistency compounds">Set a <b>cadence</b> and Prism reminds you when it's time to reach out — so you stay top-of-mind on a rhythm instead of calling only when you need something. Small, steady touches are how sphere-based agents earn referrals on repeat.</Tip>
          {(() => {
            const cad = contact.cadence_days;
            if (!cad) return null;
            const ds = _hdrLastTs ? Math.floor((Date.now() - _hdrLastTs) / 86400000) : null;
            const prog = ds != null ? Math.min(ds / cad, 1) : 1;
            const col = ds == null ? '#fbbf24' : ds >= cad ? '#ef4444' : ds >= cad * 0.7 ? '#fbbf24' : '#34d399';
            const statusText = ds == null ? 'No contact logged yet' : ds >= cad ? ((ds - cad) + ' day' + ((ds - cad) === 1 ? '' : 's') + ' overdue') : ((cad - ds) + ' day' + ((cad - ds) === 1 ? '' : 's') + ' until next');
            return (
              <div style={{margin:'0 16px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'14px',padding:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px'}}>
                  <span style={{fontSize:'10px',fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',color:'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="signal" size={13} /> Relationship</span>
                  <span style={{fontSize:'11px',fontWeight:600,color:'var(--text-2)'}}>{hdrLastAge ? (hdrLastDir + ' · ' + hdrLastAge) : 'No touch yet'}</span>
                </div>
                <div style={{height:'8px',borderRadius:'4px',background:'var(--bg-base)',overflow:'hidden'}}>
                  <div className="bar-fill-anim" style={{height:'100%',width:(Math.round(prog*100))+'%',background:col,borderRadius:'4px'}} />
                </div>
                <div style={{marginTop:'8px',display:'flex',justifyContent:'space-between',fontSize:'11px'}}>
                  <span style={{color:'var(--text-3)'}}>Keep in touch every {cad} days</span>
                  <span style={{color:col,fontWeight:700}}>{statusText}</span>
                </div>
              </div>
            );
          })()}
          {(() => {
            return (
              <div style={{margin:'0 16px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'14px',padding:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',marginBottom:'12px'}}>
                  <span style={{fontSize:'10px',fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',color:'var(--text-3)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="target" size={13} /> Lead Source &amp; Pipeline</span>
                  {contact.pipeline_stage === 'lost' && <span style={{fontSize:'10.5px',fontWeight:700,color:'#ef4444'}}>Lost</span>}
                </div>
                <div style={{display:'flex',gap:'4px',marginBottom:'12px'}}>
                  {PIPE_STAGES.map((st, i) => { const active = i <= curStageIdx; const isCur = i === curStageIdx; return (
                    <button key={st.id} type="button" onClick={() => updatePipe({ pipeline_stage: st.id })} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'5px',background:'none',border:'none',cursor:'pointer',padding:0}}>
                      <div style={{width:'100%',height:'5px',borderRadius:'3px',background: active ? 'var(--accent)' : 'var(--bg-base)',transition:'background 0.3s'}} />
                      <span style={{fontSize:'9px',fontWeight: isCur ? 800 : 600,color: isCur ? 'var(--accent)' : active ? 'var(--text-2)' : 'var(--text-3)',whiteSpace:'nowrap'}}>{st.label}</span>
                    </button>
                  ); })}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'11px',color:'var(--text-3)',minWidth:'52px'}}>Source</span>
                  <select value={contact.lead_gen_system_id || ''} onChange={e => updatePipe({ lead_gen_system_id: e.target.value || null })} style={{flex:1,background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--text-1)',padding:'8px 10px',fontSize:'12.5px'}}>
                    <option value="">— Not attributed —</option>
                    {leadSystems.filter(s => s.name === 'Not a Lead').map(s => <option key={s.id} value={s.id}>Not a Lead</option>)}
                    {leadSystems.filter(s => s.name !== 'Not a Lead').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{marginTop:'10px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                  <button type="button" onClick={() => updatePipe({ pipeline_stage: contact.pipeline_stage === 'lost' ? 'new' : 'lost' })} style={{fontSize:'11px',fontWeight:600,color: contact.pipeline_stage === 'lost' ? 'var(--accent)' : '#ef4444',background:'none',border:'none',cursor:'pointer',padding:0}}>{contact.pipeline_stage === 'lost' ? 'Reopen' : 'Mark lost'}</button>
                  {curSystem && Number(curSystem.monthly_budget) > 0 && <span style={{fontSize:'10px',color:'var(--text-3)'}}>${Number(curSystem.monthly_budget).toLocaleString()}/mo budget</span>}
                </div>
              </div>
            );
          })()}
          <div style={{padding:'2px 16px 14px'}}>
            {Array.isArray(contact.emails) && contact.emails.length > 0 && (
              <div style={{marginBottom:'6px'}}>
                {contact.emails.filter(e => e?.value).map((e, idx) => (
                  <div key={idx} style={{display:'flex',alignItems:'center',gap:'8px',padding:'4px 0',fontSize:'12.5px',color:'var(--text-2)'}}>
                    <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700,minWidth:'52px'}}>{e.label || 'Email'}</span>
                    <a href="#" onClick={(ev)=>{ev.preventDefault(); if(window.__composeEmail) window.__composeEmail(e.value);}} style={{color:'var(--text-2)',textDecoration:'none',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="mail" size={12} /> {e.value}</span>
                    </a>
                    {e.is_default && <span title="Default" style={{color:'var(--accent)',fontSize:'12px'}}>★</span>}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(contact.phones) && contact.phones.length > 0 && (
              <div>
                {contact.phones.filter(p => p?.value).map((p, idx) => (
                  <div key={idx} style={{display:'flex',alignItems:'center',gap:'8px',padding:'4px 0',fontSize:'12.5px',color:'var(--text-2)'}}>
                    <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700,minWidth:'52px'}}>{p.label || 'Phone'}</span>
                    <a href={`tel:${p.value.replace(/[^\d+]/g, '')}`} style={{color:'var(--text-2)',textDecoration:'none',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="quo" size={12} /> {p.value}</span>
                    </a>
                    <button type="button" onClick={()=>setTextTo({ phone: p.value })} title="Text via Quo" style={{color:'var(--text-3)',background:'none',border:'none',cursor:'pointer',fontSize:'14px',padding:'2px 4px'}}><Icon name="message" size={13} /></button>
                    {p.is_default && <span title="Default" style={{color:'var(--accent)',fontSize:'12px'}}>★</span>}
                  </div>
                ))}
              </div>
            )}
            {(!Array.isArray(contact.emails) || contact.emails.length === 0) && contact.email && (
              <div style={{padding:'4px 0',fontSize:'12.5px',color:'var(--text-2)'}}>
                <a href="#" onClick={(ev)=>{ev.preventDefault(); if(window.__composeEmail) window.__composeEmail(contact.email);}} style={{color:'var(--text-2)',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:'5px',cursor:'pointer'}}><Icon name="mail" size={12} /> {contact.email}</a>
              </div>
            )}
            {(!Array.isArray(contact.phones) || contact.phones.length === 0) && contact.phone && (
              <div style={{padding:'4px 0',fontSize:'12.5px',color:'var(--text-2)'}}>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} style={{color:'var(--text-2)',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="quo" size={12} /> {contact.phone}</a>
              </div>
            )}
            {hdrKeyFacts.length > 0 && (
              <div style={{marginTop:'12px',borderTop:'1px solid var(--border)',paddingTop:'10px'}}>
                {hdrKeyFacts.map((kf,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',gap:'12px',padding:'6px 0',fontSize:'12.5px',borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none'}}>
                    <span style={{color:'var(--text-3)',flexShrink:0}}>{kf.k}</span>
                    <span style={{color:'var(--text-1)',fontWeight:500,textAlign:'right',minWidth:0,overflowWrap:'anywhere'}}>{kf.v}</span>
                  </div>
                ))}
              </div>
            )}
            {contact.notes && (
              <div style={{marginTop:'12px',borderTop:'1px solid var(--border)',paddingTop:'10px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'5px'}}>Notes</div>
                <div style={{fontSize:'12.5px',color:'var(--text-2)',lineHeight:1.5,whiteSpace:'pre-wrap'}}>{contact.notes}</div>
              </div>
            )}
          </div>
          </>)}
          {tab==='insights' && (<>

          {analyzeMsg && (
            <div style={{padding:'8px 12px',marginBottom:'14px',borderRadius:'6px',fontSize:'12px',
              background: analyzeMsg.type==='ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              border:`1px solid ${analyzeMsg.type==='ok' ? '#22c55e' : '#ef4444'}`,
              color: analyzeMsg.type==='ok' ? '#22c55e' : '#ef4444'}}>{analyzeMsg.text}</div>
          )}

          {/* DISC display */}
          <div style={{padding:'14px',background:'var(--bg-base)',borderRadius:'10px',border:'1px solid var(--border)',marginBottom:'14px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
              <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="target" size={15} /> Behavioral Signal (DISC)</div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => { if (hasResearch && profile?.research_full_report) { setShowResearchReport(true); } else { setShowResearchModal(true); } }} style={{fontSize:'11px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                  <Icon name="search" size={13} /> {hasResearch ? 'View research' : 'Research from web'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={reanalyze} disabled={analyzing || resetting} style={{fontSize:'11px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                  {analyzing ? '↻ Analyzing…' : <><Icon name="sparkles" size={13} /> Re-analyze now</>}
                </button>
              </div>
            </div>
            {/* Reset actions — destructive, behind confirm() */}
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'4px',marginBottom:'10px',fontSize:'10px',color:'var(--text-3)',alignItems:'center'}}>
              <span style={{textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:600}}>Reset:</span>
              <button className="btn btn-ghost btn-sm" onClick={() => performReset('disc')} disabled={analyzing || resetting}
                style={{fontSize:'10px',padding:'3px 8px',color:'var(--red)'}}>
                {resetting ? '⏳' : '⟲ DISC'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => performReset('research')} disabled={analyzing || resetting}
                style={{fontSize:'10px',padding:'3px 8px',color:'var(--red)'}}>
                {resetting ? '⏳' : '⟲ Research'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => performReset('all')} disabled={analyzing || resetting}
                style={{fontSize:'10px',padding:'3px 8px',color:'var(--red)',borderColor:'var(--red)'}}>
                {resetting ? '⏳' : '⟲ All'}
              </button>
            </div>

            {fused && (hasInference || hasBaseline || hasResearch) && (
              <div style={{padding:'12px',marginBottom:'14px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'8px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px',gap:'8px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11px',fontWeight:800,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--accent)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="sparkles" size={13} /> Best read · {fused.primary}{fused.secondary ? '/' + fused.secondary : ''}</span>
                  <span style={{fontSize:'10px',fontWeight:700,color:'var(--text-2)'}}>{fused.tier} · {fused.pct}%</span>
                </div>
                {discBars(fused.scores.D, fused.scores.I, fused.scores.S, fused.scores.C, null)}
                <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.5}}>{fused.rationale}</div>
                <div style={{fontSize:'9px',color:'var(--text-3)',marginTop:'6px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Synthesized from: {fused.source}</div>
              </div>
            )}

            {!hasInference && !hasBaseline && (
              <div style={{fontSize:'12px',color:'var(--text-3)',padding:'10px',background:'var(--bg-card)',borderRadius:'6px',border:'1px dashed var(--border)'}}>
                No analysis yet. Click <strong>Re-analyze now</strong> to infer from notes, emails, and observations. Or enter a baseline below if they've taken an official DISC test.
              </div>
            )}

            {hasInference && (
              <div style={{marginBottom: hasBaseline ? '14px' : 0}}>
                {discBars(profile.d_score, profile.i_score, profile.s_score, profile.c_score, hasBaseline ? 'Observed (from communications)' : null)}
                {profile.rationale && (
                  <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'10px',lineHeight:1.5,fontStyle:'italic'}}>{profile.rationale}</div>
                )}
                {profile.drift_note && (
                  <div style={{padding:'8px 10px',background:'rgba(245,158,11,0.12)',border:'1px solid #f59e0b',borderRadius:'6px',color:'#f59e0b',fontSize:'11px',marginTop:'8px',lineHeight:1.5}}>
                    <strong>Drift from baseline:</strong> {profile.drift_note}
                  </div>
                )}
                <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
                  <span>Status: {profile.analysis_status}</span>
                  <span>Confidence: {profile.confidence_pct}%</span>
                  <span>{profile.signals_count} signals</span>
                  {profile.last_analyzed_at && <span>Updated: {new Date(profile.last_analyzed_at).toLocaleString()}</span>}
                </div>
                {(() => {
                  // Confidence floor hints — what's needed to reach the next tier.
                  const pct = profile.confidence_pct || 0;
                  const signals = profile.signals_count || 0;
                  if (pct >= 80) return null;
                  let hint = null;
                  if (pct < 40) {
                    const need = Math.max(0, 3 - signals);
                    hint = need > 0
                      ? `Currently provisional. Need ~${need} more piece${need === 1 ? '' : 's'} of evidence (notes or inbound emails) to reach medium confidence.`
                      : `Currently provisional. Evidence is sparse or mixed — more recent communications will sharpen the read.`;
                  } else if (pct < 80) {
                    const need = Math.max(0, 9 - signals);
                    hint = need > 0
                      ? `Medium confidence. Need ~${need} more piece${need === 1 ? '' : 's'} of varied evidence to reach high confidence.`
                      : `Medium confidence. The signals are consistent but not yet strong enough across contexts. A baseline test would lock it in.`;
                  }
                  return hint && (
                    <div style={{fontSize:'10px',color:'var(--accent)',marginTop:'6px',padding:'6px 10px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'4px',lineHeight:1.5}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="bulb" size={12} /> {hint}</span>
                    </div>
                  );
                })()}
              </div>
            )}

            {hasBaseline && (
              <div style={{paddingTop: hasInference ? '14px' : 0, borderTop: hasInference ? '1px solid var(--border)' : 'none'}}>
                {discBars(profile.baseline_d_score, profile.baseline_i_score, profile.baseline_s_score, profile.baseline_c_score, `Baseline · ${profile.baseline_source || 'Prism Test'}${profile.baseline_taken_at ? ' · ' + new Date(profile.baseline_taken_at).toLocaleDateString() : ''}`)}
              </div>
            )}

            {hasResearch && profile.research_d_score !== null && profile.research_d_score !== undefined && (
              <div style={{paddingTop: (hasInference || hasBaseline) ? '14px' : 0, borderTop: (hasInference || hasBaseline) ? '1px solid var(--border)' : 'none'}}>
                {discBars(profile.research_d_score, profile.research_i_score, profile.research_s_score, profile.research_c_score,
                  `Research · ${profile.research_scope || 'both'} · ${profile.research_confidence || 'tentative'}${profile.research_taken_at ? ' · ' + new Date(profile.research_taken_at).toLocaleDateString() : ''}`)}
                {profile.research_summary && (
                  <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.5,padding:'8px 10px',background:'var(--bg-card)',borderRadius:'6px'}}>
                    {profile.research_summary.split('\n').map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
                <div style={{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowResearchReport(true)} style={{fontSize:'11px'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="file" size={13} /> View full report</span>
                  </button>
                  {!hasBaseline && (
                    <button className="btn btn-ghost btn-sm" onClick={useResearchAsBaseline} disabled={savingBase} style={{fontSize:'11px'}}>
                      {savingBase ? '↻ Copying…' : '↑ Use as baseline'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <RelationshipIntel profile={profile} onConfirm={async (cid) => {
            // Confirm the web match: clear the flag AND actually fold the research
            // into the behavioral read. Clearing the boolean alone did nothing —
            // the live DISC is recomputed by disc-analyze, which only now (post-
            // confirm) folds in the research scores. If research scores are missing
            // (extraction can fail), disc-analyze still re-reads all evidence.
            try {
              const { data, error } = await supabase.from('profiles')
                .update({ research_needs_confirmation: false }).eq('contact_id', cid).select().single();
              if (error) { setAnalyzeMsg && setAnalyzeMsg({ type: 'error', text: 'Confirm failed: ' + error.message }); return; }
              if (data) onProfileUpdate(data);
              setAnalyzeMsg && setAnalyzeMsg({ type: 'ok', text: 'Confirmed — folding into the behavioral read…' });
              try {
                await supabase.functions.invoke('disc-analyze', { body: { contact_id: cid, user_id: userId, force: true } });
                const { data: fresh } = await supabase.from('profiles').select('*').eq('contact_id', cid).maybeSingle();
                if (fresh) onProfileUpdate(fresh);
                setAnalyzeMsg && setAnalyzeMsg({ type: 'ok', text: 'Confirmed — research folded into the profile.' });
              } catch (_) { /* flag is cleared; fold can be retried via Re-analyze */ }
            } catch (e) {
              setAnalyzeMsg && setAnalyzeMsg({ type: 'error', text: 'Confirm failed: ' + (e.message || e) });
            }
          }} onPurge={async (cid) => {
            if (!window.confirm('Purge the research and DISC write-up from this profile?\n\nThis clears the web-research findings and the research-based DISC read (in case it matched the wrong person). It is reversible from the backup, and does not delete the contact. Re-run research once you have a stronger identifier.')) return;
            try {
              const { data, error } = await supabase.rpc('purge_contact_research', { p_contact_id: cid, p_reason: 'purged from contact profile' });
              if (error || !data?.ok) { setAnalyzeMsg && setAnalyzeMsg({ type: 'error', text: 'Purge failed: ' + (error?.message || data?.error || 'unknown') }); return; }
              const { data: fresh } = await supabase.from('profiles').select('*').eq('contact_id', cid).maybeSingle();
              if (fresh) onProfileUpdate(fresh);
              setAnalyzeMsg && setAnalyzeMsg({ type: 'ok', text: 'Research purged. This is reversible from the backup if needed.' });
            } catch (e) {
              setAnalyzeMsg && setAnalyzeMsg({ type: 'error', text: 'Purge failed: ' + (e.message || e) });
            }
          }} />

          {/* Baseline entry */}
          <div style={{marginBottom:'14px'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowBaselineForm(s => !s)} style={{fontSize:'11px',width:'100%',justifyContent:'flex-start'}}>
              {showBaselineForm ? '▼ Hide' : (hasBaseline ? '▶ Update baseline test result' : '▶ Add official test result (Prism / DISC)')}
            </button>
            {showBaselineForm && (
              <div style={{padding:'14px',background:'var(--bg-base)',borderRadius:'8px',border:'1px solid var(--border)',marginTop:'8px'}}>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'12px',lineHeight:1.5}}>
                  Enter the test results (0-100 per dimension). Claude will treat this as the trusted starting point and surface drift when communications show change.
                </div>
                {[['D',baseD,setBaseD],['I',baseI,setBaseI],['S',baseS,setBaseS],['C',baseC,setBaseC]].map(([letter, val, setter]) => (
                  <div key={letter} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
                    <span style={{width:'18px',fontWeight:700,color:discBarColors[letter]}}>{letter}</span>
                    <input type="range" min="0" max="100" value={val} onChange={e=>setter(parseInt(e.target.value))} style={{flex:1,accentColor:discBarColors[letter]}}/>
                    <input type="number" min="0" max="100" value={val} onChange={e=>setter(Math.max(0,Math.min(100,parseInt(e.target.value)||0)))} style={{width:'56px',padding:'4px 6px',fontSize:'12px',background:'var(--bg-card)',color:'var(--text-1)',border:'1px solid var(--border)',borderRadius:'4px'}}/>
                  </div>
                ))}
                <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:'140px'}}>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Test date</label>
                    <input type="date" value={baseTakenAt} onChange={e=>setBaseTakenAt(e.target.value)} className="form-input" style={{padding:'6px 8px',fontSize:'12px'}}/>
                  </div>
                  <div style={{flex:1,minWidth:'140px'}}>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Source</label>
                    <input type="text" value={baseSource} onChange={e=>setBaseSource(e.target.value)} placeholder="Prism Test" className="form-input" style={{padding:'6px 8px',fontSize:'12px'}}/>
                  </div>
                </div>
                <div style={{display:'flex',gap:'8px',marginTop:'10px',justifyContent:'flex-end'}}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowBaselineForm(false)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={saveBaseline} disabled={savingBase}>{savingBase ? 'Saving…' : 'Save baseline'}</button>
                </div>
              </div>
            )}
          </div>

          {/* Recordings section */}
          <div id="contact-recordings-section"><ContactRecordingsSection contact={contact} userId={userId} onTranscribed={reanalyze} /></div>

          {/* Documents section */}
          <ContactDocuments contactId={contact.id} userId={userId} />

          {/* Notes now come from the unified `notes` store via entity_links —
              the same panel used on properties and projects. The old inline
              contact_notes UI wrote to a separate table and, as it happened,
              never rendered its list at all. */}
          <LinkedNotes userId={userId} targetType="contact" targetId={contact.id} />

          {/* Evidence trail — collapsed by default; tap header to expand */}
          {hasInference && (
            <div>
              <button type="button" onClick={() => setShowEvidence(v => !v)}
                style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'transparent',border:'none',color:'var(--text-1)',cursor:'pointer',padding:0,marginBottom: showEvidence ? '8px' : 0,textAlign:'left'}}>
                <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600}}>
                  What Claude considered
                  {!loadingEvidence && evidence.length > 0 && (
                    <span style={{color:'var(--accent)',marginLeft:'6px'}}>· {evidence.length} {evidence.length === 1 ? 'item' : 'items'}</span>
                  )}
                </span>
                <span style={{color:'var(--text-3)',fontSize:'12px'}}>{showEvidence ? '▼ Hide' : '▶ Show'}</span>
              </button>
              {showEvidence && (
                loadingEvidence ? (
                  <div style={{padding:'12px',color:'var(--text-3)',fontSize:'12px'}}>Loading evidence…</div>
                ) : evidence.length === 0 ? (
                  <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'6px',color:'var(--text-3)',fontSize:'12px'}}>
                    No evidence pieces recorded.
                  </div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                    {evidence.map(e => {
                      const sigs = [
                        e.signals_d ? `D:${e.signals_d}` : null,
                        e.signals_i ? `I:${e.signals_i}` : null,
                        e.signals_s ? `S:${e.signals_s}` : null,
                        e.signals_c ? `C:${e.signals_c}` : null,
                      ].filter(Boolean);
                      return (
                        <div key={e.id} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px'}}>
                          <div style={{display:'flex',gap:'6px',alignItems:'center',marginBottom:'2px',flexWrap:'wrap'}}>
                            <span style={{fontWeight:600,color:'var(--accent)',fontSize:'10px'}}>{e.source_kind}</span>
                            {sigs.length > 0 && <span style={{fontFamily:'monospace',color:'var(--text-2)',fontSize:'10px'}}>{sigs.join(' ')}</span>}
                            <span style={{color:'var(--text-3)',fontSize:'10px',marginLeft:'auto'}}>weight {Number(e.weight || 0).toFixed(2)}</span>
                          </div>
                          {e.reasoning && <div style={{color:'var(--text-1)',marginBottom:'4px',lineHeight:1.4}}>{e.reasoning}</div>}
                          {e.source_excerpt && (
                            <div style={{color:'var(--text-3)',fontSize:'10px',whiteSpace:'pre-wrap',lineHeight:1.4,maxHeight:'60px',overflow:'hidden',fontStyle:'italic'}}>
                              "{e.source_excerpt.slice(0, 240)}{e.source_excerpt.length > 240 ? '…' : ''}"
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          )}

          </>)}
          {tab==='details' && (<>
          {/* ── Social media ───────────────────────────────────── */}
          <div style={{marginTop:'18px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'8px',display:'flex',alignItems:'center',gap:'6px'}}>
              Social media <span style={{fontSize:'9px',color:'var(--accent)',fontWeight:700,textTransform:'none',letterSpacing:0}}>· used for web research</span>
            </div>
            <SocialLinksPanel contact={contact} contacts={contacts} setContacts={setContacts} />
          </div>
          {/* ── Prism CRM custom fields ───────────────────────── */}
          <div style={{marginTop:'18px',paddingTop:'14px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'8px'}}>
              Contact details · custom fields
            </div>
            <CustomFieldsPanel userId={userId} contact={contact} contacts={contacts} setContacts={setContacts} />
          </div>
        </>)}
        {tab==='activity' && (<>

        {/* ========== COMMUNICATION PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)',background:'var(--bg-base)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',gap:'8px',flexWrap:'wrap'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="signal" size={15} /> Communication &amp; Activity</div>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'10px',color:'var(--text-3)'}}>Keep in touch every</span>
              <select className="form-select" value={contact.cadence_days || ''}
                onChange={async (e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  await supabase.from('contacts').update({ cadence_days: val }).eq('id', contact.id);
                  contact.cadence_days = val;
                  if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, cadence_days: val } : c));
                }}
                style={{margin:0,padding:'3px 6px',fontSize:'11px',width:'auto'}}>
                <option value="">Off</option>
                <option value="7">Weekly</option>
                <option value="14">2 weeks</option>
                <option value="30">Monthly</option>
                <option value="60">2 months</option>
                <option value="90">Quarterly</option>
                <option value="180">6 months</option>
                <option value="365">Yearly</option>
              </select>
            </div>
          </div>
          {(lastIn || lastOut) && (
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'8px'}}>
              <div style={{flex:'1 1 200px',padding:'10px',background: oweReply ? 'rgba(245,158,11,0.10)' : 'var(--bg-card)', border:`1px solid ${oweReply ? 'var(--yellow)' : 'var(--border)'}`, borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color: oweReply ? 'var(--yellow)' : 'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600,marginBottom:'3px'}}>
                  ⬇ THEY → YOU {oweReply ? '· awaiting your reply' : (lastDir === 'inbound' && hdrSettled ? '· settled' : '')}
                </div>
                <div style={{fontSize:'12px',color:'var(--text-1)'}}>
                  {lastIn ? `${formatRelative(lastIn)} via ${lastChannel}` : '—'}
                </div>
                {lastIn && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{new Date(lastIn).toLocaleString()}</div>}
              </div>
              <div style={{flex:'1 1 200px',padding:'10px',background: lastDir === 'outbound' ? 'rgba(34,197,94,0.10)' : 'var(--bg-card)', border:`1px solid ${lastDir === 'outbound' ? '#22c55e' : 'var(--border)'}`, borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color: lastDir === 'outbound' ? '#22c55e' : 'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600,marginBottom:'3px'}}>
                  ⬆ YOU → THEM {lastDir === 'outbound' ? '· most recent' : ''}
                </div>
                <div style={{fontSize:'12px',color:'var(--text-1)'}}>
                  {lastOut ? `${formatRelative(lastOut)} via ${lastChannel}` : '—'}
                </div>
                {lastOut && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{new Date(lastOut).toLocaleString()}</div>}
              </div>
            </div>
          )}
          {owedDays !== null && owedDays >= 1 && (
            <div style={{padding:'8px 12px',background:'rgba(245,158,11,0.10)',border:'1px solid var(--yellow)',borderRadius:'6px',color:'var(--yellow)',fontSize:'12px',marginBottom:'8px'}}>
              ⚠ You may owe a reply — they wrote {owedDays} day{owedDays === 1 ? '' : 's'} ago and you haven't responded.
            </div>
          )}

          <ActivityTimeline
            entityType="contact"
            entityId={contact.id}
            contact={contact}
            userId={userId}
            contacts={contacts}
            onContactPatch={(patch) => {
              Object.assign(contact, patch);
              if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, ...patch } : c));
            }}
          />
        </div>

        </>)}
        {tab==='linked' && (<>
        {/* ========== LINKED TASKS PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="tasks" size={13} /> Tasks ({linkedTasks.length})</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowAddTask(v=>!v)} style={{fontSize:'11px'}}>
              {showAddTask ? '× Cancel' : '+ Add'}
            </button>
          </div>
          {showAddTask && (
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'8px',display:'flex',flexDirection:'column',gap:'6px'}}>
              <input className="form-input" placeholder="Task title…" value={newTaskTitle} onChange={e=>setNewTaskTitle(e.target.value)} autoFocus style={{margin:0,fontSize:'12px',padding:'6px 8px'}} />
              <div style={{display:'flex',gap:'6px'}}>
                <input className="form-input" type="date" value={newTaskDue} onChange={e=>setNewTaskDue(e.target.value)} style={{margin:0,fontSize:'12px',padding:'5px 8px',flex:1}} />
                <select className="form-select" value={newTaskQuadrant} onChange={e=>setNewTaskQuadrant(e.target.value)} style={{margin:0,fontSize:'12px',padding:'5px 8px',flex:'0 0 90px'}}>
                  <option value="A">A · Urg+Imp</option>
                  <option value="B">B · Imp</option>
                  <option value="C">C · Urg</option>
                  <option value="D">D · Neither</option>
                </select>
                <button className="btn btn-primary btn-sm" onClick={addQuickTask} disabled={!newTaskTitle.trim() || savingQuickAdd} style={{fontSize:'11px',whiteSpace:'nowrap'}}>
                  {savingQuickAdd ? '↻' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {linkedTasks.length === 0 && !showAddTask && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No tasks linked. Tap + Add to create one.
            </div>
          )}
          {(tasksExpanded ? linkedTasks : linkedTasks.slice(0, 3)).map(t => (
            <div key={t.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,textDecoration: t.completed ? 'line-through' : 'none',color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>
                {t.completed ? '✓ ' : '○ '}{t.title}
              </div>
              {t.due_date && (
                <span style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap'}}>
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
          {linkedTasks.length > 3 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setTasksExpanded(e => !e)} style={{fontSize:'11px',marginTop:'4px'}}>
              {tasksExpanded ? '↑ Show fewer' : `↓ Show all ${linkedTasks.length}`}
            </button>
          )}
        </div>

        {/* ========== LINKED EVENTS PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="calendar" size={13} /> Events ({linkedEvents.length})</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowAddEvent(v=>!v)} style={{fontSize:'11px'}}>
              {showAddEvent ? '× Cancel' : '+ Add'}
            </button>
          </div>
          {showAddEvent && (
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'8px',display:'flex',flexDirection:'column',gap:'6px'}}>
              <input className="form-input" placeholder="Event title…" value={newEventTitle} onChange={e=>setNewEventTitle(e.target.value)} autoFocus style={{margin:0,fontSize:'12px',padding:'6px 8px'}} />
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <input className="form-input" type="datetime-local" value={newEventStart} onChange={e=>setNewEventStart(e.target.value)} style={{margin:0,fontSize:'12px',padding:'5px 8px',flex:'1 1 180px'}} />
                <input className="form-input" type="number" min="5" step="5" value={newEventDuration} onChange={e=>setNewEventDuration(e.target.value)} title="Duration (minutes)" style={{margin:0,fontSize:'12px',padding:'5px 8px',width:'70px'}} />
                <button className="btn btn-primary btn-sm" onClick={addQuickEvent} disabled={!newEventTitle.trim() || !newEventStart || savingQuickAdd} style={{fontSize:'11px',whiteSpace:'nowrap'}}>
                  {savingQuickAdd ? '↻' : 'Save'}
                </button>
              </div>
              <input className="form-input" placeholder="Location (optional)" value={newEventLocation} onChange={e=>setNewEventLocation(e.target.value)} style={{margin:0,fontSize:'12px',padding:'5px 8px'}} />
            </div>
          )}
          {linkedEvents.length === 0 && !showAddEvent && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No events linked. Tap + Add to create one.
            </div>
          )}
          {linkedEvents.slice(0, 10).map(e => (
            <div key={e.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
              <div style={{color:'var(--text-1)'}}>{e.title}</div>
              <div style={{fontSize:'10px',color:'var(--text-3)'}}>{e.start_at ? new Date(e.start_at).toLocaleString() : '—'}</div>
            </div>
          ))}
          {linkedEvents.length > 10 && (
            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>Showing 10 of {linkedEvents.length}.</div>
          )}
        </div>

        {/* ========== LINKED BRAIN ENTRIES ========== */}
        {linkedBrain.length > 0 && (
          <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="brain" size={14} /> Brain ({linkedBrain.length})</span>
            </div>
            {linkedBrain.slice(0, 10).map(b => (
              <div key={b.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
                <div style={{color:'var(--text-1)',display:'flex',alignItems:'center',gap:'6px'}}>
                  {b.pinned && <span title="Pinned" style={{color:'var(--accent)'}}>★</span>}
                  <span>{b.title}</span>
                </div>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'capitalize'}}>{b.type}</div>
              </div>
            ))}
          </div>
        )}

        {/* ========== LINKED INVESTMENTS ========== */}
        {linkedInvestments.length > 0 && (
          <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="briefcase" size={14} /> Investments ({linkedInvestments.length})</span>
            </div>
            {linkedInvestments.map(inv => (
              <div key={inv.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                  <div style={{color:'var(--text-1)',fontWeight:500}}>{inv.name}</div>
                  <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'capitalize'}}>{inv.stage}</span>
                </div>
                {inv.amount != null && (
                  <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>
                    ${Number(inv.amount).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ========== LINKED PROPERTIES PANEL (Pass 3) ========== */}
        {linkedProperties.length > 0 && (
          <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="properties" size={14} /> Properties ({linkedProperties.length})</span>
            </div>
            {linkedProperties.map(p => (
              <div key={p.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                  <div style={{color:'var(--text-1)',fontWeight:500}}>{p.nickname || '(unnamed)'}</div>
                  <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'capitalize'}}>{p.category}</span>
                </div>
                {p.address && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{[p.address, p.city, p.state].filter(Boolean).join(', ')}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ========== REFERRED BY ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>↩ Referred by</div>
          <SingleContactPicker
            value={contact.referred_by_contact_id || null}
            onChange={async (id) => {
              const val = id || null;
              await supabase.from('contacts').update({ referred_by_contact_id: val }).eq('id', contact.id);
              contact.referred_by_contact_id = val;
              if (setContacts) setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, referred_by_contact_id: val } : c));
            }}
            contacts={contacts}
            setContacts={setContacts}
            currentContactId={contact.id}
            userId={userId}
            placeholder="Who referred them? Search or type to add…"
            defaultNewContactType="other"
          />
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>Tracks your referral source — links to the person who sent them your way.</div>
        </div>

        {/* ========== RELATIONSHIPS PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="link" size={14} /> Relationships ({relationships.length})</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddRel(v => !v)} style={{fontSize:'11px'}}>
              {showAddRel ? '× Cancel' : '+ Add'}
            </button>
          </div>
          {showAddRel && (
            <div style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'8px',display:'flex',flexDirection:'column',gap:'8px'}}>
              {/* Search-based contact picker — type to find, or create on the fly.
                  The default type of any newly-created contact is inferred from
                  the relationship type below: family-style relationships create
                  family contacts; business_partner creates a partner; etc. */}
              <SingleContactPicker
                value={relTargetId || null}
                onChange={(id) => setRelTargetId(id || '')}
                contacts={contacts}
                setContacts={setContacts}
                currentContactId={contact.id}
                userId={userId}
                placeholder="Search contacts or type to create…"
                defaultNewContactType={
                  ['spouse','parent','child','sibling'].includes(relType) ? 'family'
                  : relType === 'business_partner' ? 'partner'
                  : relType === 'colleague' ? 'other'
                  : 'other'
                }
              />
              <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
                <select className="form-select" value={relType} onChange={e => setRelType(e.target.value)}
                  style={{flex:'1 1 auto',fontSize:'12px',padding:'6px 9px',margin:0,minWidth:'140px'}}>
                  <option value="spouse">Spouse</option>
                  <option value="parent">Parent of…</option>
                  <option value="child">Child of…</option>
                  <option value="sibling">Sibling</option>
                  <option value="business_partner">Business partner</option>
                  <option value="partner">Partner</option>
                  <option value="friend">Friend</option>
                  <option value="colleague">Colleague</option>
                  <option value="other">Other</option>
                </select>
                <button className="btn btn-primary btn-sm" onClick={addRelationship}
                  disabled={savingRel || !relTargetId} style={{fontSize:'11px',whiteSpace:'nowrap'}}>
                  {savingRel ? '↻ Saving' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {relationships.length === 0 && !showAddRel && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No relationships set. Tap + Add to link this contact to family, partners, colleagues, etc.
            </div>
          )}
          {relationships.map(rel => {
            const otherId = otherContactId(rel);
            const other = contacts.find(c => c.id === otherId);
            const label = relLabel(rel).replace(/_/g, ' ');
            return (
              <div key={rel.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:'var(--text-1)',fontWeight:500}}>{other ? other.name : '(unknown contact)'}</div>
                  <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'capitalize'}}>{label}</div>
                </div>
                <button onClick={() => removeRelationship(rel)} title="Remove"
                  style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',padding:'4px 8px',fontSize:'14px'}}>×</button>
              </div>
            );
          })}
        </div>

        </>)}
        </div>
      </div>

      {/* Research flow modal */}
      {showResearchModal && (
        <div className="modal-overlay" onClick={(e) => { if (researchStage !== 'identifying' && researchStage !== 'researching') { setShowResearchModal(false); setResearchStage('idle'); }}} style={{zIndex: 1100}}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'600px',width:'92%'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0,display:'inline-flex',alignItems:'center',gap:'7px'}}><Icon name="search" size={15} /> Research {contact.name}</h3>
              <button className="btn btn-ghost btn-sm" disabled={researchStage === 'identifying' || researchStage === 'researching'}
                onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }}>✕</button>
            </div>
            <div style={{padding:'16px'}}>
              {researchStage === 'idle' && (
                <div>
                  {/* 30-day cache notice */}
                  {hasResearch && profile?.research_taken_at && (() => {
                    const daysAgo = Math.floor((Date.now() - new Date(profile.research_taken_at).getTime()) / 86400000);
                    const isFresh = daysAgo < 30;
                    return (
                      <div style={{padding:'10px 12px',marginBottom:'12px',borderRadius:'6px',
                        background: isFresh ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.10)',
                        border: `1px solid ${isFresh ? '#22c55e' : 'var(--yellow)'}`,
                        fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                        <div style={{color: isFresh ? '#22c55e' : 'var(--yellow)'}}>
                          {isFresh
                            ? `✓ Researched ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`} — usually still fresh.`
                            : `⚠ Researched ${daysAgo} days ago — may be stale.`}
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{fontSize:'11px',padding:'4px 8px'}}
                          onClick={() => { setShowResearchModal(false); setShowResearchReport(true); }}>
                          View existing
                        </button>
                      </div>
                    );
                  })()}

                  <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'12px',lineHeight:1.5}}>
                    I'll use public web sources (LinkedIn, company sites, news, social media if you choose) to build a profile and tentative behavioral read. Identity will be verified before deep research runs.
                  </div>

                  <div style={{marginBottom:'14px'}}>
                    <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'6px'}}>Scope</div>
                    <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                      {[
                        {id:'personal', label:'👤 Personal', desc:'Social media, hobbies, community'},
                        {id:'business', label:'💼 Business', desc:'LinkedIn, company, press, licenses'},
                        {id:'both', label:'🔀 Both', desc:'Full profile with sections labeled'},
                      ].map(opt => (
                        <button key={opt.id} className={`btn ${researchScope === opt.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                          onClick={() => setResearchScope(opt.id)}
                          style={{flex:'1 1 140px',minWidth:0,padding:'10px',flexDirection:'column',alignItems:'flex-start',gap:'2px',textAlign:'left'}}>
                          <div style={{fontWeight:600}}>{opt.label}</div>
                          <div style={{fontSize:'10px',opacity:0.75,fontWeight:400}}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{padding:'10px',background:'var(--bg-base)',borderRadius:'6px',marginBottom:'14px',fontSize:'11px',lineHeight:1.5}}>
                    <div style={{color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Identifiers we'll use:</div>
                    <div style={{color:'var(--text-2)'}}>
                      Name: {contact.name || '(none)'}<br />
                      {contact.email && <>Email: {contact.email}<br /></>}
                      {contact.phone && <>Phone: {contact.phone}<br /></>}
                      {contact.company && <>Company: {contact.company}<br /></>}
                      {contact.role && <>Role: {contact.role}<br /></>}
                      {contact.socials && Object.entries(contact.socials).filter(([,v])=>v && String(v).trim()).map(([k,v]) => (
                        <React.Fragment key={k}>{k.charAt(0).toUpperCase()+k.slice(1)}: {String(v)}<br /></React.Fragment>
                      ))}
                    </div>
                    {(() => {
                      const hasSocial = contact.socials && Object.values(contact.socials).some(v => v && String(v).trim());
                      return (!contact.email && !contact.phone && !hasSocial) ? (
                      <div style={{color:'var(--yellow)',marginTop:'6px',fontSize:'11px'}}>
                        ⚠️ Without an email, phone, or social profile, we'll need to disambiguate from multiple candidates. Add a LinkedIn or Instagram in Details for a much sharper result.
                      </div>
                      ) : null;
                    })()}
                  </div>

                  <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                    <button className="btn btn-ghost" onClick={() => setShowResearchModal(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={startResearch}>
                      {(contact.email || contact.phone) ? 'Run research' : 'Find candidates'}
                    </button>
                  </div>
                </div>
              )}

              {researchStage === 'identifying' && (
                <ResearchProgress contactName={contact.name} phase="identifying" />
              )}

              {researchStage === 'choose_candidate' && (
                <div>
                  <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'12px',lineHeight:1.5}}>
                    Found {researchCandidates.length} possible {researchCandidates.length === 1 ? 'match' : 'matches'}. Pick the right person before we run the full research:
                  </div>
                  {researchCandidates.map((c, i) => (
                    <div key={i} style={{padding:'10px',marginBottom:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px',marginBottom:'6px'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:'13px'}}>{c.name}</div>
                          {c.headline && <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'2px'}}>{c.headline}</div>}
                          {c.location && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}><Icon name="pin" size={11} /> {c.location}</div>}
                          {c.distinguishing_note && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>{c.distinguishing_note}</div>}
                          {c.source_url && <a href={c.source_url} target="_blank" rel="noopener noreferrer" style={{fontSize:'10px',color:'var(--accent)',marginTop:'4px',display:'inline-block',wordBreak:'break-all'}}>{c.source_url}</a>}
                        </div>
                        <span style={{fontSize:'10px',padding:'2px 8px',borderRadius:'4px',background: c.match_strength === 'high' ? 'rgba(34,197,94,0.15)' : c.match_strength === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: c.match_strength === 'high' ? '#22c55e' : c.match_strength === 'medium' ? '#f59e0b' : '#ef4444', whiteSpace:'nowrap'}}>
                          {c.match_strength || 'unknown'}
                        </span>
                      </div>
                      <button className="btn btn-primary btn-sm" style={{fontSize:'11px'}}
                        onClick={() => runResearch(c, 'manual')}>
                        ✓ Research this person
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }} style={{marginTop:'4px'}}>
                    None of these — cancel
                  </button>
                </div>
              )}

              {researchStage === 'researching' && (
                <ResearchProgress contactName={contact.name} phase="researching" />
              )}

              {researchStage === 'done' && (
                <div style={{padding:'20px',textAlign:'center'}}>
                  <div style={{fontSize:'40px',marginBottom:'8px'}}>✓</div>
                  <div style={{fontSize:'14px',color:'var(--text-1)',marginBottom:'14px'}}>Research complete.</div>
                  <div style={{display:'flex',gap:'8px',justifyContent:'center'}}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); setShowResearchReport(true); }}>
                      View report
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }}>
                      Done
                    </button>
                  </div>
                </div>
              )}

              {researchStage === 'error' && (
                <div>
                  <div style={{padding:'10px',background:'rgba(239,68,68,0.10)',border:'1px solid #ef4444',borderRadius:'6px',color:'#ef4444',fontSize:'12px',lineHeight:1.5,marginBottom:'12px'}}>
                    {researchError}
                  </div>
                  <div style={{ marginBottom:'12px' }}>
                    <div style={{ fontSize:'11.5px', color:'var(--text-2)', marginBottom:'6px', lineHeight:1.45 }}>Know something that’ll help find them? Add a handle, employer, or how they’re publicly known:</div>
                    <input className="form-input" value={researchHint} onChange={e => setResearchHint(e.target.value)} placeholder="e.g. Instagram @janedoe, or runs Acme Realty" style={{ width:'100%', boxSizing:'border-box' }} />
                    <button className="btn btn-primary btn-sm" disabled={!researchHint.trim()} style={{ marginTop:'8px', opacity: researchHint.trim() ? 1 : 0.5 }} onClick={() => { const h = researchHint.trim(); if (h) startResearch(h); }}>Search with this detail</button>
                  </div>
                  <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                    <button className="btn btn-ghost" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); setResearchHint(''); }}>Close</button>
                    <button className="btn btn-primary" onClick={() => setResearchStage('idle')}>Try again</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Research report viewer */}
      {showResearchReport && profile?.research_full_report && (
        <div className="modal-overlay" onClick={() => setShowResearchReport(false)} style={{zIndex: 1100}}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'820px',width:'94%',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <h3 style={{margin:0}}>Research report · {contact.name}</h3>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                  Scope: {profile.research_scope || 'both'} · Generated {profile.research_taken_at ? new Date(profile.research_taken_at).toLocaleString() : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowResearchReport(false)}>✕</button>
            </div>
            <div style={{padding:'16px',overflowY:'auto',flex:1,fontSize:'13px',lineHeight:1.7,color:'var(--text-1)',whiteSpace:'pre-wrap'}}>
              {profile.research_needs_confirmation && (
                <div style={{ marginBottom:'14px', padding:'12px 14px', borderRadius:'10px', background:'rgba(245,158,11,0.10)', border:'1px solid rgba(245,158,11,0.45)' }}>
                  <div style={{ fontSize:'12.5px', fontWeight:700, color:'var(--yellow)', marginBottom:'4px' }}>⚠ Is this the right person?</div>
                  <div style={{ fontSize:'12px', color:'var(--text-2)', lineHeight:1.5, marginBottom:'10px' }}>
                    This was matched to <b>{contact.name}</b> by {profile.research_matched_by || 'a public identifier'} at medium confidence, so it hasn't been folded into the DISC read yet. Confirm it's them, or purge if it's wrong.
                  </div>
                  <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                    <button onClick={async () => {
                      try {
                        const { data, error } = await supabase.from('profiles').update({ research_needs_confirmation: false }).eq('contact_id', profile.contact_id).select().single();
                        if (!error && data) {
                          onProfileUpdate(data);
                          setAnalyzeMsg && setAnalyzeMsg({ type:'ok', text:'Confirmed — folding into the behavioral read…' });
                          try {
                            await supabase.functions.invoke('disc-analyze', { body: { contact_id: profile.contact_id, user_id: userId, force: true } });
                            const { data: fresh } = await supabase.from('profiles').select('*').eq('contact_id', profile.contact_id).maybeSingle();
                            if (fresh) onProfileUpdate(fresh);
                            setAnalyzeMsg && setAnalyzeMsg({ type:'ok', text:'Confirmed — research folded into the profile.' });
                          } catch (_) {}
                          setShowResearchReport(false);
                        }
                      } catch (_) {}
                    }} style={{ background:'var(--accent-2, #EBCB82)', border:'none', color:'#1a1409', fontSize:'12px', fontWeight:700, borderRadius:'8px', padding:'8px 16px', cursor:'pointer' }}>
                      ✓ Yes, this is {contact.name?.split(' ')[0] || 'them'}
                    </button>
                    <button onClick={async () => {
                      if (!window.confirm('Purge this research? Reversible from backup; does not delete the contact.')) return;
                      try {
                        const { data, error } = await supabase.rpc('purge_contact_research', { p_contact_id: profile.contact_id, p_reason: 'wrong person, purged from report' });
                        if (!error && data?.ok) { const { data: fresh } = await supabase.from('profiles').select('*').eq('contact_id', profile.contact_id).maybeSingle(); if (fresh) onProfileUpdate(fresh); setShowResearchReport(false); setAnalyzeMsg && setAnalyzeMsg({ type:'ok', text:'Research purged.' }); }
                      } catch (_) {}
                    }} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-3)', fontSize:'12px', borderRadius:'8px', padding:'8px 16px', cursor:'pointer' }}>
                      ✕ No, wrong person
                    </button>
                  </div>
                </div>
              )}
              {profile.research_full_report}
            </div>
            <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',gap:'8px',flexWrap:'wrap'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchReport(false); setShowResearchModal(true); }}>
                ↻ Re-run research
              </button>
              <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                <DownloadResearchDocx contactId={profile.contact_id} contactName={contact.name} />
                <button className="btn btn-primary btn-sm" onClick={() => setShowResearchReport(false)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body);
}
