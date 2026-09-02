// ActivityTimeline — the unified contact/deal timeline (notes, calls, emails,
// texts, recordings) with an inline composer. EntryCard is nested within.
// Extracted from App.js (strangle) — the first of the 'giant' components.
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { supabase } from '../dataService';
import { decodeEntities } from '../helpers';
import { notify, confirmDialog } from '../notify';
import { Icon } from '../icons';
import FollowupDraftModal from './FollowupDraftModal';
const CallDetail = lazy(() => import('./CallDetail'));

// activity-kind config + local-time helpers (used only by this timeline)
const ACTIVITY_KINDS = {
  note:    { label: 'Note',    icon: <Icon name="edit" size={13} />, color: '#9499b0', directional: false, duration: false, channel: null,        placeholder: 'Write a note — what happened, what matters, next step…' },
  call:    { label: 'Call',    icon: <Icon name="quo" size={13} />, color: '#C5A95E', directional: true,  duration: true,  channel: 'phone',     placeholder: 'What did you discuss? Decisions, commitments, follow-ups…' },
  meeting: { label: 'Meeting', icon: <Icon name="users" size={13} />, color: '#22c55e', directional: true,  duration: true,  channel: 'in_person', placeholder: 'Meeting recap — who, what was decided, next steps…' },
  text:    { label: 'Text',    icon: <Icon name="message" size={13} />, color: '#38bdf8', directional: true,  duration: false, channel: 'text',      placeholder: 'Summary of the text exchange…' },
  email:   { label: 'Email',   icon: <Icon name="mail" size={13} />, color: '#a78bfa', directional: true,  duration: false, channel: 'email',     placeholder: 'Summary of the email…' },
};
const ACTIVITY_ORDER = ['note', 'call', 'meeting', 'text', 'email'];

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function ActivityTimeline({ entityType = 'contact', entityId, contact = null, userId, onContactPatch, contacts = [], onEditTask }) {
  const isContact = entityType === 'contact';
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState(null);

  // Composer
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [callByInteraction, setCallByInteraction] = useState({});
  const [openCall, setOpenCall] = useState(null);
  const [whenLocal, setWhenLocal] = useState(nowLocalInput());
  const [direction, setDirection] = useState('outbound');
  const [duration, setDuration] = useState('');
  const [followUpOn, setFollowUpOn] = useState(false);
  const [followUpWhen, setFollowUpWhen] = useState('');
  const [saving, setSaving] = useState(false);
  const composerRef = useRef(null);

  // @mention autocomplete
  const [mentionIds, setMentionIds] = useState([]);
  const [mentionQuery, setMentionQuery] = useState(null);
  const contactName = (id) => { const c = contacts.find(x => x.id === id); return c ? c.name : null; };

  // Voice-to-note (Web Speech API) + AI cleanup
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const recRef = useRef(null);
  const speechSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { notify('Voice capture isn’t supported in this browser — try Chrome.', 'error'); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let finalText = '', interimText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText) {
        setBody(prev => {
          const sep = (!prev || prev.endsWith(' ') || prev.endsWith('\n')) ? '' : ' ';
          return prev + sep + finalText.trim() + ' ';
        });
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      setRecording(false); setInterim('');
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') notify('Voice error: ' + e.error, 'error');
    };
    rec.onend = () => { setRecording(false); setInterim(''); };
    recRef.current = rec;
    try { rec.start(); setRecording(true); } catch (_) {}
  }
  function stopDictation() {
    try { recRef.current && recRef.current.stop(); } catch (_) {}
    setRecording(false); setInterim('');
  }
  async function cleanupWithAri() {
    if (!body.trim() || cleaning) return;
    if (recording) stopDictation();
    setCleaning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-note-cleanup', { body: { text: body, kind } });
      if (error) throw error;
      if (data && data.cleaned) {
        setBody(data.cleaned);
        // Re-capture any @mentions that survived cleanup
        setMentionIds(prev => prev.filter(id => { const n = contactName(id); return n && data.cleaned.includes('@' + n); }));
      } else if (data && data.error) {
        throw new Error(data.error);
      }
    } catch (e) {
      notify("Couldn't clean up the note: " + (e.message || e), 'error');
    } finally { setCleaning(false); }
  }
  useEffect(() => () => { try { recRef.current && recRef.current.abort(); } catch (_) {} }, []);

  // Inline edit
  const [editId, setEditId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [editDir, setEditDir] = useState('outbound');
  const [editDur, setEditDur] = useState('');

  // Follow-up drafter
  const [followupFor, setFollowupFor] = useState(null);

  // Synced Gmail messages, merged read-only into a contact's timeline
  const [emails, setEmails] = useState([]);

  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = supabase.from('contact_interactions').select('*');
      if (isContact) {
        // A contact's timeline includes entries logged on it, entries whose
        // contact_id points at it (Quo calls, Cube/shared recordings — linked via
        // the contact_id column rather than entity_type/entity_id), AND entries
        // logged elsewhere (property, investment, another contact) that @mention it.
        query = query.or(`and(entity_type.eq.contact,entity_id.eq.${entityId}),contact_id.eq.${entityId},mentions.cs.{${entityId}}`);
      } else {
        query = query.eq('entity_type', entityType).eq('entity_id', entityId);
      }
      const { data } = await query.order('occurred_at', { ascending: false });
      if (!cancelled) { setTimeline(data || []); setLoading(false); }

      // Which of these rows has a recorded call behind it? One query for the whole
      // timeline rather than one per row — the transcript and the audio stay put
      // until asked for, so the timeline loads at the same speed it always did.
      const callIds = (data || []).filter(d => d.kind === 'call').map(d => d.id);
      if (callIds.length) {
        const { data: calls } = await supabase.from('quo_calls')
          .select('id,interaction_id,duration,direction,speaker_map,raw')
          .in('interaction_id', callIds);
        if (!cancelled && calls) {
          const m = {};
          calls.forEach(c => { if (c.interaction_id) m[c.interaction_id] = c; });
          setCallByInteraction(m);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [entityType, entityId, isContact]);

  // Auto-thread real Gmail messages onto a contact's timeline (read-only).
  useEffect(() => {
    const email = isContact && contact && contact.email ? contact.email.trim().toLowerCase() : null;
    if (!email) { setEmails([]); return; }
    let cancelled = false;
    (async () => {
      const cols = 'id,from_address,from_name,subject,snippet,internal_date,direction,is_read,provider_thread_id,account_id';
      // Correspondence is correspondence whether the person was in To or Cc.
      // Matching only To meant an email that CC'd them never appeared here at
      // all — and cc is exactly how a broker loops people into a thread.
      const [inb, outb, cc, mine] = await Promise.all([
        supabase.from('email_messages').select(cols).eq('from_address', email).order('internal_date', { ascending: false }).limit(60),
        supabase.from('email_messages').select(cols).contains('to_addresses', [{ email }]).order('internal_date', { ascending: false }).limit(60),
        supabase.from('email_messages').select(cols).contains('cc_addresses', [{ email }]).order('internal_date', { ascending: false }).limit(60),
        supabase.from('email_accounts').select('email_address'),
      ]);
      if (cancelled) return;

      // Which addresses are the account owner's own. Gmail files the copy that
      // lands in a SECOND connected mailbox as inbound, so 185 of Dara's own
      // emails were rendering as "them -> you" — his own words attributed to the
      // other person. The sender decides direction; the folder does not.
      const own = new Set((mine.data || []).map(a => String(a.email_address || '').trim().toLowerCase()));

      const seen = new Set();
      const merged = [...(inb.data || []), ...(outb.data || []), ...(cc.data || [])]
        .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });

      // One email sent from one mailbox and received in another is TWO rows with
      // two provider ids — the same message, listed twice, which is what Dara
      // photographed. Collapse on what actually identifies the message.
      const byMsg = new Map();
      for (const m of merged) {
        const key = (m.subject || '') + '|' + (m.internal_date || '');
        const prev = byMsg.get(key);
        const isOwn = own.has(String(m.from_address || '').trim().toLowerCase());
        // Prefer the copy whose stored direction already agrees with the sender.
        if (!prev || (isOwn && m.direction === 'outbound' && prev.direction !== 'outbound')) byMsg.set(key, m);
      }

      const items = [...byMsg.values()].filter(m => m.internal_date).map(m => ({
        id: 'email:' + m.id,
        _email: true,
        kind: 'email',
        direction: own.has(String(m.from_address || '').trim().toLowerCase())
          ? 'outbound'
          : (m.direction || 'inbound'),
        occurred_at: m.internal_date,
        subject: m.subject || '(no subject)',
        body: (m.subject || '(no subject)') + (m.snippet ? ' \u2014 ' + m.snippet : ''),
        brief: m.snippet || m.subject || '',
        is_read: m.is_read,
        entity_type: 'contact', entity_id: entityId,
        mentions: [], tags: [], pinned: false,
      })).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
      setEmails(items);
    })();
    return () => { cancelled = true; };
  }, [isContact, entityId, contact && contact.email]);

  // Reach back into ALL of Gmail for one specific person, on demand. The normal
  // sync only holds what it has already pulled; this asks Gmail directly for the
  // contact's entire history (any label, any age, archived or not — Gmail search
  // ignores folders), stores it, then re-links so it lands on this timeline.
  const [backfilling, setBackfilling] = useState('');
  async function backfillContactEmail() {
    const email = isContact && contact && contact.email ? contact.email.trim().toLowerCase() : null;
    if (!email) return;
    setBackfilling('working');
    try {
      const { data: accts } = await supabase.from('email_accounts').select('id').eq('user_id', userId);
      // -in:trash -in:spam so we still skip the bin, but no label/inbox limit:
      // Gmail search spans All Mail, so archived and labelled mail is included.
      const q = `from:${email} OR to:${email} -in:trash -in:spam`;
      for (const a of (accts || [])) {
        await supabase.functions.invoke('gmail-sync', {
          body: { account_id: a.id, query_override: q, limit: 500 },
        });
      }
      // stitch the newly-pulled mail onto contacts by address
      await supabase.functions.invoke('contact-link-emails', { body: { user_id: userId } });
      setBackfilling('done');
    } catch (e) {
      setBackfilling('error');
    }
  }

  // Find past recordings — phone calls by number, meetings by spoken name +
  // calendar — that probably feature this contact but were never linked. The
  // mirror of the email reach-back: the moment an old conversation matters.
  const [findingRecs, setFindingRecs] = useState('');
  const [recCandidates, setRecCandidates] = useState(null);
  async function findPastRecordings() {
    if (!isContact || !contact) return;
    setFindingRecs('working'); setRecCandidates(null);
    try {
      const { data, error } = await supabase.functions.invoke('contact-find-recordings', {
        // No user_id: the function takes identity from the token. Sending one here
        // would imply the server trusts it, which is the bug that was fixed.
        body: { contact_id: contact.id },
      });
      if (error) throw error;
      setRecCandidates(data?.candidates || []);
      setFindingRecs('done');
    } catch (e) { setFindingRecs('error'); }
  }
  async function linkPastRecording(cand) {
    try {
      if (cand.kind === 'call') {
        await supabase.from('quo_calls').update({ contact_id: contact.id }).eq('id', cand.id);
      } else {
        await supabase.from('recordings').update({ contact_id: contact.id }).eq('id', cand.id);
      }
      await supabase.from('disc_analysis_queue').insert({
        user_id: userId, contact_id: contact.id, reason: 'past recording linked', status: 'pending',
      }).then(() => {}, () => {});
      setRecCandidates(prev => (prev || []).filter(c => c.id !== cand.id));
    } catch (_) {}
  }

  // Open tasks/reminders linked to this entity (contacts via task_contacts +
  // tasks.contact_id; properties via tasks.property_id). Surfaces overdue nudges.
  const [reminders, setReminders] = useState([]);
  async function loadReminders() {
    if (!entityId) { setReminders([]); return; }
    const cols = 'id,title,due_date,status,completed,priority';
    let rows = [];
    if (isContact) {
      const { data: links } = await supabase.from('task_contacts').select('task_id').eq('contact_id', entityId);
      const ids = (links || []).map(r => r.task_id);
      if (ids.length) {
        const { data: t1 } = await supabase.from('tasks').select(cols).in('id', ids).eq('completed', false);
        rows = t1 || [];
      }
      const { data: t2 } = await supabase.from('tasks').select(cols).eq('contact_id', entityId).eq('completed', false);
      const seen = new Set(rows.map(t => t.id));
      (t2 || []).forEach(t => { if (!seen.has(t.id)) { rows.push(t); seen.add(t.id); } });
    } else if (entityType === 'property') {
      const { data } = await supabase.from('tasks').select(cols).eq('property_id', entityId).eq('completed', false);
      rows = data || [];
    }
    rows = rows.filter(t => t.status !== 'done');
    setReminders(rows);
  }
  useEffect(() => { loadReminders(); /* eslint-disable-next-line */ }, [entityType, entityId, isContact]);

  async function completeReminder(t) {
    await supabase.from('tasks').update({ completed: true, completed_at: new Date().toISOString(), status: 'done' }).eq('id', t.id);
    setReminders(prev => prev.filter(x => x.id !== t.id));
  }
  function dueInfo(due) {
    if (!due) return { label: 'no date', tone: 'muted', sort: Infinity };
    const d = new Date(due + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff < 0) return { label: `overdue ${-diff}d`, tone: 'overdue', sort: diff };
    if (diff === 0) return { label: 'due today', tone: 'today', sort: 0 };
    if (diff === 1) return { label: 'tomorrow', tone: 'soon', sort: 1 };
    if (diff < 7) return { label: `in ${diff}d`, tone: 'soon', sort: diff };
    return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: 'future', sort: diff };
  }
  const TONE_COLOR = { overdue: 'var(--red)', today: 'var(--yellow)', soon: 'var(--accent)', future: 'var(--text-3)', muted: 'var(--text-3)' };
  const sortedReminders = reminders.map(t => ({ ...t, _due: dueInfo(t.due_date) })).sort((a, b) => a._due.sort - b._due.sort);
  const overdueCount = sortedReminders.filter(t => t._due.tone === 'overdue').length;
  const todayCount = sortedReminders.filter(t => t._due.tone === 'today').length;

  // Parse #hashtags from free text → lowercased tag array
  function parseTags(text) {
    const out = new Set();
    const re = /#([\p{L}\w][\p{L}\w-]*)/gu;
    let m; while ((m = re.exec(text || ''))) out.add(m[1].toLowerCase());
    return Array.from(out);
  }

  function relTime(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
  }
  function dayKeyOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
  function dayLabelOf(ts) {
    const d = new Date(ts), now = new Date();
    const k = dayKeyOf(ts);
    if (k === `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (k === `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`) return 'Yesterday';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }
  function timeOf(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  async function addEntry() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const k = ACTIVITY_KINDS[kind];
      const occ = whenLocal ? new Date(whenLocal).toISOString() : new Date().toISOString();
      // Keep only mentions whose @Name still appears in the body
      const liveMentions = mentionIds.filter(id => { const n = contactName(id); return n && body.includes('@' + n); });
      const row = {
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        contact_id: isContact ? entityId : null,
        kind,
        channel: k.directional ? k.channel : null,
        direction: k.directional ? direction : null,
        occurred_at: occ,
        body: body.trim(),
        brief: body.trim().slice(0, 140),
        duration_minutes: (k.duration && duration) ? Number(duration) : null,
        follow_up_at: (followUpOn && followUpWhen) ? new Date(followUpWhen).toISOString() : null,
        pinned: false,
        mentions: liveMentions,
        tags: parseTags(body),
      };
      const { data, error } = await supabase.from('contact_interactions').insert(row).select().single();
      if (error) throw error;
      setTimeline(prev => [data, ...prev]);

      // Bump the contact's last-contact signals for directional entries (contacts only)
      if (k.directional && isContact && contact) {
        const occT = new Date(occ).getTime();
        const patch = {};
        if (direction === 'inbound' && (!contact.last_inbound_at || occT > new Date(contact.last_inbound_at).getTime())) patch.last_inbound_at = occ;
        if (direction === 'outbound' && (!contact.last_outbound_at || occT > new Date(contact.last_outbound_at).getTime())) patch.last_outbound_at = occ;
        const newIn = patch.last_inbound_at || contact.last_inbound_at;
        const newOut = patch.last_outbound_at || contact.last_outbound_at;
        if (newIn || newOut) {
          patch.last_communication_channel = k.channel;
          patch.last_communication_direction = (!newOut || (newIn && new Date(newIn) > new Date(newOut))) ? 'inbound' : 'outbound';
        }
        if (!contact.last_contact_at || occT > new Date(contact.last_contact_at).getTime()) patch.last_contact_at = occ;
        if (Object.keys(patch).length) {
          await supabase.from('contacts').update(patch).eq('id', contact.id);
          onContactPatch && onContactPatch(patch);
        }
      }

      // Optional: schedule a linked follow-up task
      if (followUpOn && followUpWhen) {
        const followLabel = isContact && contact ? contact.name : (k.label + ' follow-up');
        const taskRow = {
          user_id: userId,
          title: `Follow up: ${followLabel}`,
          due_date: followUpWhen.slice(0, 10),
          priority: 'high', priority_system: 'eisenhower', eisenhower_quadrant: 'B', status: 'open',
        };
        if (isContact) taskRow.contact_id = entityId;
        if (entityType === 'property') taskRow.property_id = entityId;
        const { data: t } = await supabase.from('tasks').insert(taskRow).select().single();
        if (t && isContact) { try { await supabase.rpc('set_task_contacts', { p_task_id: t.id, p_contact_ids: [entityId] }); } catch (_) {} }
        loadReminders();
      }

      setBody(''); setDuration(''); setFollowUpOn(false); setFollowUpWhen(''); setWhenLocal(nowLocalInput());
      setMentionIds([]); setMentionQuery(null);
    } catch (e) {
      notify("Couldn't log activity: " + (e.message || e), 'error');
    } finally { setSaving(false); }
  }

  function startEdit(e) {
    setEditId(e.id); setEditBody(e.body || e.brief || '');
    setEditWhen(isoToLocalInput(e.occurred_at));
    setEditDir(e.direction || 'outbound');
    setEditDur(e.duration_minutes ? String(e.duration_minutes) : '');
  }
  async function saveEdit(e) {
    if (!editBody.trim()) return;
    const k = ACTIVITY_KINDS[e.kind] || ACTIVITY_KINDS.note;
    const patch = {
      body: editBody.trim(),
      brief: editBody.trim().slice(0, 140),
      occurred_at: editWhen ? new Date(editWhen).toISOString() : e.occurred_at,
      updated_at: new Date().toISOString(),
    };
    if (k.directional) patch.direction = editDir;
    if (k.duration) patch.duration_minutes = editDur ? Number(editDur) : null;
    patch.tags = parseTags(editBody);
    const { data } = await supabase.from('contact_interactions').update(patch).eq('id', e.id).select().single();
    if (data) setTimeline(prev => prev.map(x => x.id === data.id ? data : x).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)));
    setEditId(null); setEditBody('');
  }
  async function togglePin(e) {
    const { data } = await supabase.from('contact_interactions').update({ pinned: !e.pinned }).eq('id', e.id).select().single();
    if (data) setTimeline(prev => prev.map(x => x.id === data.id ? data : x));
  }
  async function removeEntry(e) {
    if (!await confirmDialog('Delete this entry from the timeline?')) return;
    await supabase.from('contact_interactions').delete().eq('id', e.id);
    setTimeline(prev => prev.filter(x => x.id !== e.id));
  }

  const k = ACTIVITY_KINDS[kind];
  // Merge stored entries with read-only synced emails for display
  const merged = [...timeline, ...emails];
  const presentKinds = ACTIVITY_ORDER.filter(kk => merged.some(t => (t.kind || 'note') === kk));
  const allTags = Array.from(new Set(timeline.flatMap(t => t.tags || []))).sort();
  const passKind = (t) => filter === 'all' || (t.kind || 'note') === filter;
  const passTag = (t) => !tagFilter || (t.tags || []).includes(tagFilter);
  // Pinned (stored entries only — emails are never pinned)
  const pinned = timeline.filter(t => t.pinned && passKind(t) && passTag(t));
  const unpinned = merged
    .filter(t => !t.pinned && passKind(t) && passTag(t))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

  // Group unpinned by day
  const groups = [];
  let curKey = null;
  for (const e of unpinned) {
    const dk = dayKeyOf(e.occurred_at);
    if (dk !== curKey) { groups.push({ key: dk, label: dayLabelOf(e.occurred_at), items: [] }); curKey = dk; }
    groups[groups.length - 1].items.push(e);
  }

  // NOTE: this is deliberately CALLED as a function below, not rendered as
  // <EntryCard/>. Defined inside ActivityTimeline, it is a NEW function on every
  // render, so React treats it as a different component type and unmounts and
  // remounts its whole subtree — including the note <textarea>, which has
  // autoFocus. That is why editing a note put the caret back at position 0 after
  // every keystroke: type a letter -> editBody changes -> parent re-renders ->
  // brand-new EntryCard type -> textarea remounted -> autoFocus fires -> caret 0.
  // Calling it inlines its output into this component's element tree, so the
  // textarea keeps its identity. It uses no hooks, which is what makes this safe.
  // If it ever needs hooks, hoist it to module scope and pass props instead.
  function EntryCard({ e, pinnedRail }) {
    const kk = ACTIVITY_KINDS[e.kind || 'note'] || ACTIVITY_KINDS.note;
    const edited = e.updated_at && new Date(e.updated_at).getTime() - new Date(e.occurred_at).getTime() > 60000
      && new Date(e.updated_at).getTime() - new Date(e.created_at).getTime() > 60000;
    if (editId === e.id) {
      return (
        <div style={{ padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '8px' }}>
          <textarea className="form-textarea" value={editBody} onChange={ev => setEditBody(ev.target.value)} autoFocus
            style={{ minHeight: '70px', fontSize: '13px', padding: '8px', margin: 0, marginBottom: '8px', width: '100%' }} />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <input type="datetime-local" className="form-input" value={editWhen} onChange={ev => setEditWhen(ev.target.value)} style={{ flex: '1 1 170px', padding: '6px', fontSize: '12px', margin: 0 }} />
            {kk.directional && (
              <select className="form-select" value={editDir} onChange={ev => setEditDir(ev.target.value)} style={{ flex: '1 1 140px', padding: '6px', fontSize: '12px', margin: 0 }}>
                <option value="outbound">⬆ I reached out</option>
                <option value="inbound">⬇ They reached out</option>
              </select>
            )}
            {kk.duration && (
              <input type="number" min="0" className="form-input" placeholder="min" value={editDur} onChange={ev => setEditDur(ev.target.value)} style={{ flex: '0 0 80px', padding: '6px', fontSize: '12px', margin: 0 }} />
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-primary btn-sm" onClick={() => saveEdit(e)} style={{ fontSize: '11px' }}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditId(null); setEditBody(''); }} style={{ fontSize: '11px' }}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <div className="activity-entry" style={{ position: 'relative', paddingLeft: '26px', marginBottom: '10px' }}>
        {/* rail dot */}
        <div style={{ position: 'absolute', left: '7px', top: '4px', width: '11px', height: '11px', borderRadius: '50%', background: kk.color, border: '2px solid var(--bg-base)', boxShadow: '0 0 0 1px ' + kk.color, zIndex: 1 }} />
        <div style={{ padding: '9px 11px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: e.body || e.brief ? '5px' : 0 }}>
            <span style={{ fontSize: '12px' }}>{kk.icon}</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: kk.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kk.label}</span>
            {e._email && (
              <span style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0 5px' }} title="Synced from Gmail">
                <span style={{display:'inline-flex',alignItems:'center',gap:'4px'}}><Icon name="mail" size={11} /> Gmail{e.is_read === false ? ' · unread' : ''}</span>
              </span>
            )}
            {!(e.entity_type === entityType && e.entity_id === entityId) && (
              <span style={{ fontSize: '10px', color: 'var(--text-3)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0 5px' }}
                title="Logged on another record; shown here because it mentions this contact">
                ↗ {e.entity_type === 'contact' ? (contactName(e.entity_id) || 'contact') : e.entity_type === 'property' ? '🏠 property' : e.entity_type === 'investment' ? '💼 investment' : e.entity_type}
              </span>
            )}
            {kk.directional && e.direction && (
              <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>{e.direction === 'outbound' ? '⬆ you → them' : '⬇ them → you'}</span>
            )}
            {e.duration_minutes ? <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>· {e.duration_minutes}m</span> : null}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '10px', color: 'var(--text-3)' }} title={new Date(e.occurred_at).toLocaleString()}>{timeOf(e.occurred_at)} · {relTime(e.occurred_at)}</span>
            <div className="activity-actions" style={{ display: 'flex', gap: '2px' }}>
              <button onClick={() => setFollowupFor(e)} title="Draft a follow-up email or text" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', padding: '0 3px' }}><Icon name="mail" size={14} /></button>
              {!e._email && <button onClick={() => togglePin(e)} title={e.pinned ? 'Unpin' : 'Pin to top'} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', padding: '0 3px', opacity: e.pinned ? 1 : 0.5 }}><Icon name="pin" size={14} /></button>}
              {!e._email && <button onClick={() => startEdit(e)} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '11px', padding: '0 3px' }}><Icon name="edit" size={14} /></button>}
              {!e._email && <button onClick={() => removeEntry(e)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '11px', padding: '0 3px' }}><Icon name="trash" size={14} /></button>}
            </div>
          </div>
          {(e.body || e.brief) && <div style={{ fontSize: '13px', color: 'var(--text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{decodeEntities(e.body || e.brief)}</div>}
          {callByInteraction[e.id] && (
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setOpenCall(openCall === e.id ? null : e.id)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)',
                  borderRadius: 100, padding: '4px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {openCall === e.id ? 'Hide' : 'Transcript'}
                {callByInteraction[e.id]?.raw?.cube?.drive_file_id ? ' & recording' : ''}
              </button>
              {openCall === e.id && (
                <React.Suspense fallback={<div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>Opening…</div>}>
                  <CallDetail callId={callByInteraction[e.id].id}
                    contactName={contact?.name || contactName(e.contact_id) || 'Them'}
                    onClose={() => setOpenCall(null)} />
                </React.Suspense>
              )}
            </div>
          )}
          {e.entity_type === 'recording' && <button onClick={() => { try { document.getElementById('contact-recordings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }} style={{ marginTop: '6px', background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>🎙 View full recording ▸</button>}
          {((e.mentions && e.mentions.length > 0) || (e.tags && e.tags.length > 0)) && (
            <div style={{ marginTop: '6px', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {(e.mentions || []).map(id => {
                const nm = contactName(id);
                if (!nm) return null;
                return <span key={'m' + id} style={{ fontSize: '10px', color: 'var(--accent)', background: 'var(--accent-dim, rgba(197,169,94,0.12))', border: '1px solid var(--accent)', borderRadius: '999px', padding: '1px 7px' }}><Icon name="contacts" size={11} /> {nm}</span>;
              })}
              {(e.tags || []).map(tg => (
                <button key={'t' + tg} onClick={() => setTagFilter(tagFilter === tg ? null : tg)}
                  style={{ fontSize: '10px', color: tagFilter === tg ? 'var(--bg-base)' : 'var(--text-2)', background: tagFilter === tg ? 'var(--text-2)' : 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 7px', cursor: 'pointer' }}>#{tg}</button>
              ))}
            </div>
          )}
          {(edited || e.follow_up_at) && (
            <div style={{ marginTop: '5px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {edited && <span style={{ fontSize: '10px', color: 'var(--text-3)', fontStyle: 'italic' }}>edited {relTime(e.updated_at)}</span>}
              {e.follow_up_at && <span style={{ fontSize: '10px', color: 'var(--accent)' }}><Icon name="clock" size={10} /> follow-up {new Date(e.follow_up_at).toLocaleDateString()}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Open follow-ups / reminders strip */}
      {sortedReminders.length > 0 && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', background: overdueCount > 0 ? 'rgba(239,68,68,0.07)' : 'var(--bg-card)', border: `1px solid ${overdueCount > 0 ? 'var(--red)' : 'var(--border)'}`, borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-1)' }}><Icon name="clock" size={12} /> Open follow-ups</span>
            {overdueCount > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--bg-base)', background: 'var(--red)', borderRadius: '999px', padding: '1px 7px' }}>{overdueCount} overdue</span>}
            {todayCount > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--bg-base)', background: 'var(--yellow)', borderRadius: '999px', padding: '1px 7px' }}>{todayCount} today</span>}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>{sortedReminders.length} open</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {sortedReminders.slice(0, 6).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <button onClick={() => completeReminder(t)} title="Mark done" style={{ width: '16px', height: '16px', borderRadius: '4px', border: `1.5px solid ${TONE_COLOR[t._due.tone]}`, background: 'transparent', cursor: 'pointer', flexShrink: 0, padding: 0 }} />
                {/* The checkbox finishes it; the title opens it. Reading a
                    follow-up and being unable to change it is the state Dara
                    kept landing in. */}
                <button onClick={() => onEditTask && onEditTask(t)} title="Open and edit this task"
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0,
                    color: 'var(--text-1)', fontSize: '12px', cursor: onEditTask ? 'pointer' : 'default',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit' }}>
                  {t.title}
                </button>
                <span style={{ fontSize: '10px', fontWeight: 600, color: TONE_COLOR[t._due.tone], whiteSpace: 'nowrap' }}>{t._due.label}</span>
              </div>
            ))}
          </div>
          {sortedReminders.length > 6 && <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '6px' }}>+ {sortedReminders.length - 6} more open</div>}
        </div>
      )}
      {/* Composer */}
      <div style={{ padding: '10px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '5px', marginBottom: '8px', flexWrap: 'wrap' }}>
          {ACTIVITY_ORDER.map(kk => {
            const cfg = ACTIVITY_KINDS[kk];
            const active = kind === kk;
            return (
              <button key={kk} onClick={() => setKind(kk)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${active ? cfg.color : 'var(--border)'}`,
                  background: active ? cfg.color + '22' : 'transparent',
                  color: active ? cfg.color : 'var(--text-2)' }}>
                <span>{cfg.icon}</span>{cfg.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
          {speechSupported && (
            <button type="button" onClick={() => recording ? stopDictation() : startDictation()}
              title={recording ? 'Stop dictation' : 'Dictate a note'}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${recording ? 'var(--red)' : 'var(--border)'}`,
                background: recording ? 'rgba(239,68,68,0.12)' : 'transparent',
                color: recording ? 'var(--red)' : 'var(--text-2)' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: recording ? 'var(--red)' : 'var(--text-3)', animation: recording ? 'pulse 1s infinite' : 'none' }} />
              {recording ? 'Recording… tap to stop' : <><Icon name="mic" size={13} /> Dictate</>}
            </button>
          )}
          {body.trim() && (
            <button type="button" onClick={cleanupWithAri} disabled={cleaning}
              title="Tighten this into a clean note with Ari"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, cursor: cleaning ? 'default' : 'pointer',
                border: '1px solid var(--accent)', background: 'rgba(197,169,94,0.10)', color: 'var(--accent)', opacity: cleaning ? 0.6 : 1 }}>
              {cleaning ? <><Icon name="sparkles" size={12} /> Cleaning…</> : <><Icon name="sparkles" size={12} /> Clean up with Ari</>}
            </button>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <textarea ref={composerRef} className="form-textarea" value={body}
            onChange={e => {
              const val = e.target.value;
              setBody(val);
              const caret = e.target.selectionStart || val.length;
              const m = val.slice(0, caret).match(/@([\p{L}\w'’.\-]*)$/u);
              setMentionQuery(m ? m[1] : null);
            }}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); addEntry(); } }}
            placeholder={k.placeholder + '   ·  @ to mention, # to tag'}
            style={{ minHeight: '64px', fontSize: '13px', padding: '8px 10px', margin: 0, marginBottom: '8px', width: '100%' }} />
          {recording && interim && (
            <div style={{ marginTop: '-4px', marginBottom: '8px', fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>{interim}…</div>
          )}
          {mentionQuery !== null && contacts.length > 0 && (() => {
            const q = mentionQuery.toLowerCase();
            const matches = contacts.filter(c => c.name && c.name.toLowerCase().includes(q)).slice(0, 6);
            if (matches.length === 0) return null;
            return (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '-4px', background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: '8px', zIndex: 30, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
                {matches.map(c => (
                  <div key={c.id} onClick={() => {
                    const ta = composerRef.current;
                    const caret = ta ? (ta.selectionStart || body.length) : body.length;
                    const before = body.slice(0, caret).replace(/@([\p{L}\w'’.\-]*)$/u, '@' + c.name + ' ');
                    const after = body.slice(caret);
                    setBody(before + after);
                    setMentionIds(prev => prev.includes(c.id) ? prev : [...prev, c.id]);
                    setMentionQuery(null);
                    setTimeout(() => { if (ta) { ta.focus(); const pos = before.length; ta.setSelectionRange(pos, pos); } }, 0);
                  }}
                    style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '7px', borderBottom: '1px solid var(--border)' }}
                    onMouseDown={e => e.preventDefault()}>
                    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>{(c.name || '?').slice(0, 1).toUpperCase()}</span>
                    <span style={{ color: 'var(--text-1)' }}>{c.name}</span>
                    {c.company && <span style={{ color: 'var(--text-3)', fontSize: '10px' }}>{c.company}</span>}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
          <input type="datetime-local" className="form-input" value={whenLocal} onChange={e => setWhenLocal(e.target.value)}
            title="When did this happen? (back-date freely)" style={{ flex: '1 1 168px', padding: '6px', fontSize: '12px', margin: 0 }} />
          {k.directional && (
            <select className="form-select" value={direction} onChange={e => setDirection(e.target.value)} style={{ flex: '1 1 150px', padding: '6px', fontSize: '12px', margin: 0 }}>
              <option value="outbound">⬆ I reached out</option>
              <option value="inbound">⬇ They reached out</option>
            </select>
          )}
          {k.duration && (
            <input type="number" min="0" className="form-input" placeholder="min" value={duration} onChange={e => setDuration(e.target.value)}
              title="Duration in minutes" style={{ flex: '0 0 76px', padding: '6px', fontSize: '12px', margin: 0 }} />
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!followUpOn ? (
            <button className="btn btn-ghost btn-sm" onClick={() => { setFollowUpOn(true); const d = new Date(); d.setDate(d.getDate() + 3); setFollowUpWhen(d.toISOString().slice(0, 10)); }} style={{ fontSize: '11px' }}><Icon name="clock" size={13} /> + Schedule follow-up</button>
          ) : (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: '1 1 220px' }}>
              <span style={{ fontSize: '11px', color: 'var(--accent)' }}><Icon name="clock" size={11} /> Follow-up task</span>
              <input type="date" className="form-input" value={followUpWhen} onChange={e => setFollowUpWhen(e.target.value)} style={{ flex: 1, padding: '5px', fontSize: '12px', margin: 0 }} />
              <button onClick={() => { setFollowUpOn(false); setFollowUpWhen(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '13px' }}>✕</button>
            </div>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={addEntry} disabled={!body.trim() || saving} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
            {saving ? '↻ Logging…' : `Log ${k.label}`}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      {presentKinds.length > 1 && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => setFilter('all')} style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '10px', cursor: 'pointer', border: '1px solid var(--border)', background: filter === 'all' ? 'var(--bg-hover)' : 'transparent', color: filter === 'all' ? 'var(--text-1)' : 'var(--text-3)', fontWeight: 600 }}>All ({merged.length})</button>
          {presentKinds.map(kk => {
            const cfg = ACTIVITY_KINDS[kk];
            const n = merged.filter(t => (t.kind || 'note') === kk).length;
            return (
              <button key={kk} onClick={() => setFilter(kk)} style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '10px', cursor: 'pointer', border: `1px solid ${filter === kk ? cfg.color : 'var(--border)'}`, background: filter === kk ? cfg.color + '22' : 'transparent', color: filter === kk ? cfg.color : 'var(--text-3)', fontWeight: 600 }}>{cfg.icon} {cfg.label} ({n})</button>
            );
          })}
        </div>
      )}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-3)', fontWeight: 600 }}>Tags:</span>
          {allTags.map(tg => (
            <button key={tg} onClick={() => setTagFilter(tagFilter === tg ? null : tg)}
              style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '10px', cursor: 'pointer', border: `1px solid ${tagFilter === tg ? 'var(--accent)' : 'var(--border)'}`, background: tagFilter === tg ? 'rgba(197,169,94,0.15)' : 'transparent', color: tagFilter === tg ? 'var(--accent)' : 'var(--text-3)', fontWeight: 600 }}>#{tg}</button>
          ))}
          {tagFilter && <button onClick={() => setTagFilter(null)} style={{ fontSize: '10px', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>clear</button>}
        </div>
      )}

      {/* Reach back into all of Gmail for this one person */}
      {isContact && contact && contact.email && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={backfillContactEmail} disabled={backfilling === 'working'}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 100,
              border: '1px solid var(--border)', background: 'transparent',
              color: backfilling === 'working' ? 'var(--text-3)' : 'var(--accent)', cursor: 'pointer' }}>
            {backfilling === 'working' ? 'Reaching back through Gmail…'
              : backfilling === 'done' ? '✓ Pulled their full history — refresh to see it'
              : backfilling === 'error' ? 'Couldn’t reach Gmail — try again'
              : '⟲ Pull this contact’s full email history'}
          </button>
          {backfilling === 'done' && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>archived & labelled mail included</span>}
        </div>
      )}

      {/* Reach back for past recordings that were never linked to this contact */}
      {isContact && contact && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={findPastRecordings} disabled={findingRecs === 'working'}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 100,
              border: '1px solid var(--border)', background: 'transparent',
              color: findingRecs === 'working' ? 'var(--text-3)' : 'var(--accent)', cursor: 'pointer' }}>
            {findingRecs === 'working' ? 'Searching past recordings…'
              : findingRecs === 'error' ? 'Couldn’t search — try again'
              : '⟲ Find past recordings with this contact'}
          </button>
          {findingRecs === 'done' && recCandidates && recCandidates.length === 0 && (
            <span style={{ fontSize: 10.5, color: 'var(--text-3)', marginLeft: 8 }}>none found</span>
          )}
          {recCandidates && recCandidates.length > 0 && (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 7, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                {recCandidates.length} may be this contact — confirm to link
              </div>
              {recCandidates.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, flex: 'none',
                    background: c.confidence === 'high' ? '#22c55e' : c.confidence === 'medium' ? '#C5A95E' : '#8C8475' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: 'var(--text-3)', marginRight: 6 }}>
                        {c.kind === 'call' ? 'CALL' : 'MEETING'}
                      </span>
                      {c.when ? new Date(c.when).toLocaleDateString() : ''} {c.preview ? '· ' + c.preview : ''}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{(c.why || []).join(' · ')}</div>
                  </div>
                  <button onClick={() => linkPastRecording(c)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 100,
                      border: 'none', background: 'var(--accent-2)', color: '#1a1409', cursor: 'pointer' }}>Link</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div style={{ fontSize: '12px', color: 'var(--text-3)', padding: '12px 0' }}>Loading timeline…</div>
      ) : merged.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic', padding: '14px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '8px' }}>
          No activity logged yet. Capture a call, meeting, or note above — every entry is time-stamped to this timeline.
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '6px' }}><Icon name="pin" size={10} /> Pinned</div>
              {pinned.map(e => <React.Fragment key={e.id}>{EntryCard({ e })}</React.Fragment>)}
            </div>
          )}
          {groups.map(g => (
            <div key={g.key} style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{g.label}</div>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              </div>
              <div style={{ position: 'relative', borderLeft: '2px solid var(--border)', marginLeft: '12px', paddingLeft: '0' }}>
                {g.items.map(e => <React.Fragment key={e.id}>{EntryCard({ e })}</React.Fragment>)}
              </div>
            </div>
          ))}
        </>
      )}
      {followupFor && (
        <FollowupDraftModal
          entry={followupFor}
          contacts={contacts}
          defaultContact={isContact ? contact : null}
          recentNotes={timeline.slice(0, 6).map(t => t.body || t.brief).filter(Boolean)}
          userId={userId}
          onClose={() => setFollowupFor(null)}
          onLogged={(row) => setTimeline(prev => [row, ...prev])}
          onSent={(cid, patch) => { if (onContactPatch) onContactPatch(patch); }}
        />
      )}
    </div>
  );
}
