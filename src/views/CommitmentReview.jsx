import React, { useEffect, useState, Suspense, lazy } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import OwnerPicker from './OwnerPicker';
import { notify } from '../notify';

// ── CommitmentReview ─────────────────────────────────────────────────────────
// The one moment where calls turn into work. Deliberately a BATCH — "6 things
// from your calls" once, not six notifications across the day.
//
// The split down the middle is the whole idea:
//   YOURS  -> one tap makes it a task.
//   THEIRS -> one tap files it on your radar. It is NOT a task: you cannot do
//             Tom's job. It only becomes a task when it goes late, and then it
//             is a different job — chase him.
//
// Every card shows the sentence someone actually said. That quote is the guard
// against the old behaviour: with no attribution the previous extractor guessed
// the owner and filed "Dara visits Tom's property" when Tom had said "I'll come
// out there". If a claim can't show its receipt, it shouldn't be on your list.

const EMBER = '#C9563F';
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const lab = { fontSize: 9.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 800 };
const btn = (primary) => ({
  background: primary ? 'var(--accent-2)' : 'transparent',
  color: primary ? '#1a1409' : 'var(--text-2)',
  border: primary ? 'none' : '1px solid var(--border)',
  borderRadius: 100, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
});

// "your call · Tue, Sep 15" / "they called · 3 weeks ago" — the call is the
// evidence, so name it.
const callWhen = (c) => {
  const t = Date.parse(c.call_at || '');
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 864e5);
  const who = /in/i.test(c.call_dir || '') ? 'they called you' : /out/i.test(c.call_dir || '') ? 'you called' : 'call';
  const ago = days < 1 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? days + ' days ago'
    : new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return who + ' ' + ago;
};
const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const daysLate = (d) => Math.floor((Date.now() - new Date(d + 'T12:00:00')) / 86400000);

// Reading the call. The old note here said there was no route to a single call,
// which was true — but CallDetail is a COMPONENT, not a route, and it takes a
// callId. It can be opened in place. Dara: "frequently there is not enough of
// the conversation for me to determine the context, and sometimes it does not
// know with who."
const CallDetail = lazy(() => import('./CallDetail'));

// focusCallId / focusId / recoveryOnly: used by the Chief of Staff queue on
// Today (ChiefQueue.jsx), which decides WHAT is shown — this component only
// renders that one conversation, that one late promise, or (when you are
// caught up) the "set aside" recovery link.
export default function CommitmentReview({ userId, contactId = null, onChanged, compact = false, onSeeAll, focusCallId, focusId, recoveryOnly = false, onEmpty }) {
  const [rows, setRows] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [readingCall, setReadingCall] = useState(null);   // { callId, name }
  const [dueEdit, setDueEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);   // waiting-on row expanded for full edit
  const [shownProposed, setShownProposed] = useState(3);   // never a wall
  const [showOlder, setShowOlder] = useState(false);       // calls over a month old wait behind a tap
  // What the user sets on a card WHILE reviewing — a due date and a priority — so
  // a commitment becomes a properly-scheduled task in one step, instead of landing
  // dateless and having to be hunted down and edited later.
  const [edits, setEdits] = useState({});   // { [id]: { due, priority, title } }
  // Suggestions PrismOS set aside unreviewed (status 'expired', 29 Sep). Never
  // called "expired" on screen — they were the app's guesses, not failures.
  const [setAside, setSetAside] = useState(0);
  const [asideRows, setAsideRows] = useState(null);
  async function loadSetAside() {
    if (asideRows) { setAsideRows(null); return; }
    const { data } = await supabase.from('commitments').select('id,title,contact_id,created_at')
      .eq('status', 'expired').gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
      .order('created_at', { ascending: false }).limit(60);
    const ids = [...new Set((data || []).map(r => r.contact_id).filter(Boolean))];
    const names = {};
    if (ids.length) { const { data: cs } = await supabase.from('contacts').select('id,name').in('id', ids); (cs || []).forEach(c => { names[c.id] = c.name; }); }
    setAsideRows((data || []).map(r => ({ ...r, contact_name: names[r.contact_id] })));
  }
  async function bringBack(c) {
    const { error } = await supabase.rpc('restore_commitment', { p_id: c.id });
    if (error) { setErr(String(error.message || error)); return; }
    setAsideRows(rs => (rs || []).filter(r => r.id !== c.id));
    setSetAside(n => Math.max(0, n - 1));
    await load();
  }
  const editOf = (c) => edits[c.id] || { due: c.due_date || '', priority: 'B', title: c.title || '', notes: '' };
  // Seed from the COMMITMENT on first touch — not from empty strings — so setting
  // a date never wipes the title (and vice versa). Takes the whole commitment so
  // the seed has the real values. Functional update reads the latest edits map.
  const setEdit = (c, patch) => setEdits(e => {
    const cur = e[c.id] || { due: c.due_date || '', priority: 'B', title: c.title || '', notes: '' };
    return { ...e, [c.id]: { ...cur, ...patch } };
  });

  async function load() {
    let q = supabase.from('commitments')
      .select('id,contact_id,owner,owner_contact_id,owner_name,title,next_step,context,quote,due_date,confidence,status,call_id,fuse')
      .in('status', ['proposed', 'accepted'])
      .order('created_at', { ascending: false });
    if (contactId) q = q.eq('contact_id', contactId);
    if (!contactId) {
      supabase.from('commitments').select('id', { count: 'exact', head: true }).eq('status', 'expired')
        .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
        .then(({ count }) => setSetAside(count || 0), () => {});
    }
    const { data, error } = await q;
    if (error) { setErr(error.message); return; }
    const ids = [...new Set((data || []).map(r => r.contact_id).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: cs } = await supabase.from('contacts').select('id,name').in('id', ids);
      (cs || []).forEach(c => { names[c.id] = c.name; });
    }
    // WHEN AND WHICH CALL. Ray (panel): "I would dismiss a proposed commitment if I
    // did not know who proposed it — me or the app." A card with no date reads as
    // an order from nowhere; 110 of 148 came from calls over a month old and none
    // said so. The call's time and direction go on every conversation.
    const callIds = [...new Set((data || []).map(r => r.call_id).filter(Boolean))];
    const calls = {};
    for (let i = 0; i < callIds.length; i += 150) {
      const { data: qc } = await supabase.from('quo_calls').select('id,op_created_at,created_at,direction').in('id', callIds.slice(i, i + 150));
      (qc || []).forEach(q => { calls[q.id] = q; });
    }
    setRows((data || []).map(r => {
      const q = r.call_id && calls[r.call_id];
      return { ...r, contact_name: names[r.contact_id] || 'Unknown',
        call_at: q ? (q.op_created_at || q.created_at) : null, call_dir: q ? q.direction : null };
    }));
    // Everyone, for the "someone else" picker — the responsible party is often a
    // lender/TC/co-agent who was never on the call, so this cannot be scoped to
    // the call's participants.
    if (!contacts.length) {
      const { data: all } = await supabase.from('contacts').select('id,name').order('name');
      setContacts(all || []);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);
  // In a focus (the Chief of Staff queue), tell the queue the moment this item
  // is decided, whichever button did it, so the next one appears.
  useEffect(() => {
    if (!rows || recoveryOnly || !onEmpty || (focusCallId === undefined && !focusId)) return;
    const left = focusId
      ? rows.filter(r => r.id === focusId && r.status === 'accepted' && r.due_date && daysLate(r.due_date) > 0)
      : rows.filter(r => r.status === 'proposed' && (focusCallId ? r.call_id === focusCallId : !r.call_id));
    if (!left.length) onEmpty();
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // WHO is on the hook. NULL owner_contact_id on a "them" item means the person
  // on the call; set means a third party who never was.
  const responsible = (c) => {
    if (c.owner === 'me') return 'You';
    if (c.owner_contact_id) {
      const t = contacts.find(x => x.id === c.owner_contact_id);
      return t ? t.name : 'Someone else';
    }
    return c.contact_name;
  };

  // Attribution is a FACT, not a draft — persist the correction the moment it is
  // made, so it survives leaving the screen without accepting. Optimistic so the
  // chips respond instantly on a phone.
  async function setOwner(c, patch) {
    setRows(rs => rs.map(r => r.id === c.id ? { ...r, ...patch } : r));
    const { error } = await supabase.from('commitments')
      .update({ owner: patch.owner, owner_contact_id: patch.owner_contact_id })
      .eq('id', c.id);
    if (error) { setErr(String(error.message || error)); await load(); }
  }

  async function accept(c) {
    setBusy(c.id); setErr(null);
    const e = editOf(c);
    const title = (e.title || c.title || '').trim();
    if (!title) { setErr('Give the task a title first.'); setBusy(null); return; }
    try {
      if (c.owner === 'me') {
        // A/B/C is the Eisenhower quadrant, NOT the priority column (which is
        // constrained to high/medium/low). Writing 'B' to priority would violate
        // a CHECK constraint. Map to both so the task sorts correctly.
        const pmap = { A: 'high', B: 'medium', C: 'low', D: 'low' };
        const { data: t, error } = await supabase.from('tasks').insert({
          user_id: userId,
          title,
          due_date: e.due || c.due_date || null,
          priority: pmap[e.priority] || 'medium',
          priority_system: 'eisenhower',
          eisenhower_quadrant: e.priority || 'B',
          // Whatever was typed, plus the words that produced the task — the
          // quote is the evidence and should never be lost to an edit.
          notes: ((editOf(c).notes || '').trim()
            ? (editOf(c).notes || '').trim() + '\n\n'
            : '') + `From a call with ${c.contact_name} — they/you said: “${c.quote}”`,
          contact_id: c.contact_id || null,
          completed: false,
        }).select().single();
        if (error) throw error;
        const { error: uErr } = await supabase.from('commitments').update({ status: 'accepted', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', c.id);
        if (uErr) throw uErr;
      } else {
        // Theirs: on the radar, not on the list. No task is created here — that
        // is the entire point. It becomes work only if they miss the date. But we
        // keep your edited title and the date you expect it by, so the waiting-on
        // card and the late-detection use your version.
        const { error: uErr } = await supabase.from('commitments').update({
          status: 'accepted', title, due_date: e.due || c.due_date || null,
          decided_at: new Date().toISOString(),
        }).eq('id', c.id);
        if (uErr) throw uErr;
      }
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  // PUSH IT OUT. Rescheduling is the honest answer far more often than dropping
  // something, and it was the one response the card did not offer: chase, or let
  // go. Most late promises are neither.
  async function pushOut(c, days) {
    const base = c.due_date ? new Date(c.due_date + 'T12:00:00') : new Date();
    base.setDate(base.getDate() + days);
    await saveCommitment(c, { due_date: base.toISOString().slice(0, 10) });
  }

  // GONE, not hidden. Dismiss records that a decision was taken; delete is for
  // things that should never have been captured — a mis-heard line in a
  // transcript, or someone else's promise attributed to you.
  async function remove(c) {
    if (!window.confirm('Delete this for good? It will not come back. (Skip hides it and can be undone.)')) return;
    setBusy(c.id);
    const { error } = await supabase.from('commitments').delete().eq('id', c.id);
    setBusy(null);
    if (error) { setErr('Could not delete: ' + error.message); return; }
    setRows(rs => rs.filter(r => r.id !== c.id));
  }

  // SKIP IS ALWAYS UNDOABLE. Ray's fear, in his words: "the first time I dismiss
  // something and then find out I was supposed to do it and a client noticed."
  // A skip that can be taken back is one an agent can make without being sure.
  async function restore(ids) {
    const { error } = await supabase.from('commitments').update({ status: 'proposed', decided_at: null }).in('id', ids);
    if (error) { setErr(String(error.message || error)); return; }
    await load(); onChanged && onChanged();
    // An undo brings it back into the Chief of Staff queue, too.
    try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
  }
  async function dismiss(c) {
    setBusy(c.id);
    const { error } = await supabase.from('commitments').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { setErr(String(error.message || error)); setBusy(null); return; }
    await load(); onChanged && onChanged(); setBusy(null);
    notify('Skipped \u2014 \u201c' + String(c.title || '').slice(0, 60) + '\u201d', 'info', { label: 'Undo', onClick: () => restore([c.id]) });
  }

  // Reword a commitment in place. Save the edited title back to the row.
  // The waiting-on rows only ever let you reword the title. Everything else —
  // who it is on, when it is due — was fixed at extraction time and unreachable,
  // which is why two of Dara's read 'Unknown' and stayed that way.
  async function saveCommitment(c, patch) {
    setBusy(c.id); setErr(null);
    const clean = {};
    if (patch.title !== undefined) clean.title = String(patch.title || '').trim();
    if (patch.due_date !== undefined) clean.due_date = patch.due_date || null;
    if (patch.owner !== undefined) clean.owner = patch.owner;
    if (patch.owner_contact_id !== undefined) clean.owner_contact_id = patch.owner_contact_id;
    if (clean.title === '') { setErr('Give it a title first.'); setBusy(null); return false; }
    setRows(rs => rs.map(r => r.id === c.id ? { ...r, ...clean } : r));
    const { error } = await supabase.from('commitments').update(clean).eq('id', c.id);
    setBusy(null);
    if (error) { setErr(String(error.message || error)); await load(); return false; }
    return true;
  }

  async function saveTitle(c, newTitle) {
    const t = (newTitle || '').trim();
    setEditingId(null);
    if (!t || t === c.title) return;            // nothing changed
    setBusy(c.id);
    const { error } = await supabase.from('commitments').update({ title: t }).eq('id', c.id);
    if (error) { setErr(String(error.message || error)); }
    await load(); onChanged && onChanged(); setBusy(null);
  }

  // Delete a commitment outright (a bad/wrong item you don't want tracked at all).
  async function removeCommitment(c) {
    if (!window.confirm(`Delete this item?\n\n"${c.title}"\n\nThis removes it from your list entirely.`)) return;
    setBusy(c.id);
    const { error } = await supabase.from('commitments').delete().eq('id', c.id);
    if (error) { setErr(String(error.message || error)); setBusy(null); return; }
    await load(); onChanged && onChanged(); setBusy(null);
  }

  // "I already did this." A commitment can be finished by the time you review it.
  // Record it as a COMPLETED task so the work counts, then close the commitment.
  async function doneAlready(c) {
    setBusy(c.id); setErr(null);
    const title = (editOf(c).title || c.title || '').trim();
    try {
      const { data: t, error } = await supabase.from('tasks').insert({
        user_id: userId,
        title,
        notes: `From a call with ${c.contact_name} - already done when reviewed.`,
        contact_id: c.contact_id || null,
        completed: true,
        completed_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      await supabase.from('commitments').update({ status: 'done', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', c.id)
        .then(({ error: uErr }) => { if (uErr) throw uErr; });
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  // Someone else's promise came through. It was never your task, so no completed
  // task is recorded — we just close the tracking. "They delivered, stop watching."
  async function resolveTheirs(c) {
    setBusy(c.id);
    await supabase.from('commitments').update({ status: 'done', decided_at: new Date().toISOString() }).eq('id', c.id);
    await load(); onChanged && onChanged(); setBusy(null);
  }

  // The late ones: the only moment somebody else's promise becomes your problem.
  async function chase(c) {
    setBusy(c.id);
    try {
      const { data: t, error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: `Chase ${responsible(c)}: ${c.title}`,
        due_date: todayNY(),
        // Provenance stays honest: the QUOTE came from the call, even when the
        // person responsible was never on it.
        notes: `${c.contact_name} said “${c.quote}” — due ${fmtDate(c.due_date)}, now ${daysLate(c.due_date)} day(s) late.`
          + (c.owner_contact_id ? `\nYou assigned this to ${responsible(c)}, who was not on the call.` : ''),
        contact_id: c.owner_contact_id || c.contact_id || null,
        waiting_on: responsible(c),     // the app already speaks this
        completed: false,
      }).select().single();
      if (error) throw error;
      await supabase.from('commitments').update({ status: 'done', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', c.id);
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  if (!rows) return null;
  // Short-fuse promises ("call you right back", "there in 20 minutes") are already
  // moot by the time anyone reviews — measured 91% dismissed. Keep them out of the
  // queue entirely rather than making you hand-dismiss stale work.
  const focusing = focusCallId !== undefined || !!focusId || recoveryOnly;
  const proposed = rows.filter(r => r.status === 'proposed' && (r.fuse || 'near') !== 'immediate')
    .filter(r => !focusing ? true : (focusCallId !== undefined && !focusId && !recoveryOnly
      ? (focusCallId ? r.call_id === focusCallId : !r.call_id) : false));

  // Group by the conversation they came out of. Not every call should leave
  // work behind — most are just a conversation — and deciding that ONCE per
  // call is the difference between a queue you clear and one you abandon.
  // 24 proposals across 20 conversations: almost every call is a single
  // decision, which is why the per-item review felt heavier than it was.
  // NOT a useMemo: this sits below `if (!rows) return null`, so a hook here runs
  // conditionally and React tears the whole screen down — the smoke gate caught
  // exactly that. Two dozen rows do not need memoising anyway.
  const byCall = (() => {
    const m = new Map();
    for (const c of proposed) {
      const k = c.call_id || ('solo:' + c.id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    const when = (items) => Date.parse(items[0].call_at || '') || 0;
    return [...m.entries()].sort((a, b) => when(b[1]) - when(a[1]));
  })();
  const MONTH = 30 * 864e5;
  const recentCalls = byCall.filter(([, items]) => !items[0].call_at || Date.now() - Date.parse(items[0].call_at) <= MONTH);
  const olderCalls = byCall.filter(([, items]) => items[0].call_at && Date.now() - Date.parse(items[0].call_at) > MONTH);
  const callsToShow = showOlder ? byCall : recentCalls;

  // 'Summary only' — the call and its summary already live on the contact
  // record, so this drops the follow-ups and keeps everything else. Nothing is
  // lost that was not going to be noise.
  async function summaryOnly(items) {
    if (!items.length) return;
    setBusy(items[0].id); setErr(null);
    const ids = items.map(i => i.id);
    setRows(rs => rs.map(r => ids.includes(r.id) ? { ...r, status: 'dismissed' } : r));
    const { error } = await supabase.from('commitments')
      .update({ status: 'dismissed', decided_at: new Date().toISOString() }).in('id', ids);
    setBusy(null);
    if (error) { setErr(String(error.message || error)); await load(); return; }
    notify('Kept the summary \u2014 no tasks made from this call.', 'success', { label: 'Undo', onClick: () => restore(ids) });
  }
  const waiting = rows.filter(r => r.status === 'accepted' && r.owner === 'them');
  const late = waiting.filter(r => r.due_date && daysLate(r.due_date) > 0)
    .filter(r => !focusing ? true : (focusId ? r.id === focusId : false));
  const onTimeAll = focusing ? [] : waiting.filter(r => r.due_date && daysLate(r.due_date) > 0 ? false : true);
  // ON TODAY, SHOW ONLY WHAT IS ACTUALLY DUE. A promise someone made for
  // November 2nd is not today's business, and eight of them between Dara and the
  // thing he opened the app for is how a daily screen becomes something to
  // scroll past. Today keeps what is late or due within two days; the full list
  // — every future promise included — lives on Commitments, reached from the
  // "see all" link below.
  const soon = (r) => {
    if (!r.due_date) return true;          // undated: nobody is chasing it but him
    const d = Math.ceil((new Date(r.due_date + 'T12:00:00') - new Date()) / 86400000);
    return d <= 2;
  };
  const onTime = compact ? onTimeAll.filter(soon) : onTimeAll;
  const hiddenFuture = onTimeAll.length - onTime.length;
  const showAside = !contactId && setAside > 0 && (recoveryOnly || (!focusing && (!compact || proposed.length === 0)));
  if (!proposed.length && !late.length && !onTime.length && !showAside) return null;

  // IMPORTANT: this is a plain function, NOT a nested <Card/> component. A nested
  // component defined inside the render gets a new function identity every render,
  // so React remounts its whole subtree on each keystroke — which destroys the
  // <input> DOM node and drops focus/keyboard after one character. Calling a
  // function that returns JSX splices it into the parent at a stable position, so
  // the input keeps its identity and focus survives typing. Key goes on the root.
  // THE SAME EDGE THE CALL-REVIEW CARDS GOT. These sit stacked inside a
  // conversation, several to a call, each with its own title, quote, date,
  // priority, notes and four buttons — and they were separated by a plain
  // one-pixel line. A card carrying that much needs to look like a card: its own
  // ground, a real edge, and the faint gold top-light so the border reads on the
  // near-black instead of vanishing into it.
  const renderCard = (c, { children, tone, editable }) => (
    <div key={c.id} style={{ ...card,
      // MATCH THE LEAD CARD. var(--border) was too faint to read as a boundary
      // against the near-black — Dara could see the lead cards separate and
      // these not. Same treatment as a new lead: a gold wash and a gold edge at
      // half strength, which is the app's existing signal for "this is a thing
      // waiting on you". Late keeps the ember so urgency still outranks it.
      background: tone === 'late'
        ? 'linear-gradient(150deg,rgba(201,86,63,.13),rgba(201,86,63,.03))'
        : 'linear-gradient(150deg,rgba(197,169,94,.16),rgba(197,169,94,.04))',
      border: tone === 'late' ? `1px solid ${EMBER}` : '1px solid rgba(197,169,94,.5)',
      borderRadius: 16, marginBottom: 12,
      boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ ...lab, color: c.owner === 'me' ? 'var(--accent-2)' : 'var(--text-3)' }}>
          {c.owner === 'me' ? (c.contact_name && c.contact_name !== 'Unknown' ? `You told ${c.contact_name.split(' ')[0]} you would` : 'You said you would')
            : c.owner_contact_id ? `${responsible(c)} is on the hook`
            : `${c.owner_name || c.contact_name || 'Someone on the call'} said they would`}
        </span>
        {c.confidence === 'low' && <span style={{ fontSize: 9, color: EMBER, fontWeight: 700 }}>· PrismOS isn’t sure it heard this right</span>}
      </div>
      <div className="gold-hairline" style={{ margin: '2px 0 9px' }} />
      {/* Attribution is the single most-corrected field — extraction tagged 89 of
          199 items "them" and 75% were thrown away. Make fixing it one tap. */}
      <div style={{ marginBottom: 8 }}>
        <OwnerPicker owner={c.owner} ownerContactId={c.owner_contact_id}
          counterpartyName={c.contact_name} contacts={contacts}
          onChange={(patch) => setOwner(c, patch)} />
      </div>
      {editable ? (
        // The title is yours to fix — the extraction is a draft, not gospel.
        <input value={editOf(c).title}
          onChange={ev => setEdit(c, { title: ev.target.value })}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, fontWeight: 600,
            color: 'var(--text-1)', lineHeight: 1.4, background: 'var(--bg-base)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px' }} />
      ) : (
        editingId === c.id ? (
          <input autoFocus defaultValue={c.title}
            onBlur={ev => saveTitle(c, ev.target.value)}
            onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveTitle(c, ev.target.value); } if (ev.key === 'Escape') setEditingId(null); }}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, fontWeight: 600,
              color: 'var(--text-1)', lineHeight: 1.4, background: 'var(--bg-base)',
              border: '1px solid var(--accent-2)', borderRadius: 8, padding: '7px 9px' }} />
        ) : (
          <div onClick={() => setEditingId(c.id)} title="Tap to reword"
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4, cursor: 'text' }}>{c.title}</div>
        )
      )}
      {c.next_step && (
        <div style={{ fontSize: 13, color: 'var(--text-1)', margin: '7px 0 0', lineHeight: 1.45 }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10.5, fontWeight: 800,
            letterSpacing: '.14em', textTransform: 'uppercase', color: '#C5A95E', marginRight: 6 }}>You</span>
          {c.next_step}
        </div>
      )}
      {c.context && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{c.context}</div>
      )}
      {c.quote && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic', margin: '6px 0 0',
          paddingLeft: 9, borderLeft: '2px solid var(--accent-dim)', lineHeight: 1.5 }}>
          “{c.quote}”
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {/* The date is a BUTTON. "11d late" was read-only, so the only honest
            responses to a date that had slipped were to chase someone or drop
            it — when the real answer is usually "it moved to Friday". Tap it and
            pick a new one; the card re-sorts itself out of Late. */}
        {c.due_date && (
          dueEdit === c.id ? (
            <input type="date" defaultValue={c.due_date} autoFocus
              onChange={(e) => { const v = e.target.value; if (v) { saveCommitment(c, { due_date: v }); setDueEdit(null); } }}
              onBlur={() => setDueEdit(null)}
              style={{ background: 'var(--bg-base)', border: '1px solid var(--room-accent, var(--accent))',
                borderRadius: 8, padding: '5px 8px', color: 'var(--text-1)', fontSize: 12 }} />
          ) : (
            <button type="button" onClick={() => setDueEdit(c.id)}
              title="Change the due date"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, textDecorationLine: 'underline', textDecorationStyle: 'dotted',
                textUnderlineOffset: 3, color: tone === 'late' ? EMBER : 'var(--text-3)' }}>
              {tone === 'late' ? `${daysLate(c.due_date)}d late · was ${fmtDate(c.due_date)}` : fmtDate(c.due_date)}
            </button>
          )
        )}
        {/* Nothing to move if no date was ever set — so offer to set one. */}
        {!c.due_date && (
          dueEdit === c.id ? (
            <input type="date" autoFocus
              onChange={(e) => { const v = e.target.value; if (v) { saveCommitment(c, { due_date: v }); setDueEdit(null); } }}
              onBlur={() => setDueEdit(null)}
              style={{ background: 'var(--bg-base)', border: '1px solid var(--room-accent, var(--accent))',
                borderRadius: 8, padding: '5px 8px', color: 'var(--text-1)', fontSize: 12 }} />
          ) : (
            <button type="button" onClick={() => setDueEdit(c.id)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11,
                fontWeight: 700, color: 'var(--text-3)', textDecorationLine: 'underline',
                textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
              + due date
            </button>
          )
        )}
        <div style={{ flex: 1 }} />
        {!editable && (
          <button type="button" disabled={busy === c.id} onClick={() => removeCommitment(c)} title="Delete this item" aria-label="Delete"
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}>×</button>
        )}
        {children}
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 18 }}>
      {err && <div style={{ ...card, color: EMBER, fontSize: 12, marginBottom: 8 }}>{err}</div>}

      {late.length > 0 && (
        <>
          <div style={{ ...lab, color: EMBER, marginBottom: 7 }}>{focusId ? 'They’re late' : `They’re late — ${late.length}`}</div>
          {late.map(c => renderCard(c, { tone: 'late', children: (
            <>
              <button type="button" disabled={busy === c.id} onClick={() => chase(c)} style={btn(true)}>Chase them</button>
              <button type="button" disabled={busy === c.id} onClick={() => pushOut(c, 7)} style={btn(false)}>+1 week</button>
              <button type="button" disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}>Not needed</button>
              <button type="button" disabled={busy === c.id} onClick={() => remove(c)}
                style={{ ...btn(false), color: EMBER, borderColor: 'rgba(201,86,63,.45)' }}>Delete</button>
            </>
          ) }))}
        </>
      )}

      {proposed.length > 0 && (
        <>
          <div style={{ ...lab, marginBottom: 4, marginTop: late.length ? 14 : 0 }}>
            {compact ? 'Heard on your calls — one at a time' : <>Heard on your calls — {byCall.length} conversation{byCall.length === 1 ? '' : 's'} to check</>}
          </div>
          {/* WHO PROPOSED IT. The app did — say so, in plain words, every time.
              Ray: "If the app is telling me to do something I did not agree to,
              I press dismiss because I do not want to be wrong in public." */}
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 9 }}>
            PrismOS listens to your calls and writes down anything that sounded like a promise. These are its
            suggestions, not tasks — nothing happens until you choose. <b>Make it a task</b> if it’s real,
            <b> Skip</b> if it isn’t (you can undo).
          </div>
          {/* One decision per conversation, asked where you know the answer.
              Most calls are just a conversation and should leave a summary and
              nothing else; a few carry real work. Taking that call once, per
              call, is lighter than judging every extracted line — and the
              summary is already on the contact record either way, so 'summary
              only' loses nothing. */}
          {/* ONE AT A TIME on Today (panel, 29 Sep): a pile reads as a score of
              how far behind you are. Decide this one and the next appears. */}
          {callsToShow.slice(0, compact ? 1 : (showOlder ? 40 : 6)).map(([callKey, items]) => (
            <div key={callKey} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '9px 11px', marginBottom: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', flex: '1 1 auto', minWidth: 0 }}>
                  {items[0].contact_name}
                  <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                    {(items[0].call_at ? ' \u00B7 ' + callWhen(items[0]) : '')
                      + ' \u00B7 ' + items.length + ' possible follow-up' + (items.length === 1 ? '' : 's')}
                  </span>
                  {items[0].call_id && (
                    <button type="button"
                      onClick={() => setReadingCall({ callId: items[0].call_id, name: items[0].contact_name || 'this call' })}
                      style={{ marginLeft: 8, background: 'none', border: 'none', padding: '6px 0', minHeight: 36, cursor: 'pointer',
                        color: 'var(--room-accent, var(--accent))', fontSize: 11.5, fontWeight: 700 }}>
                      Read the call
                    </button>
                  )}
                </span>
                <button type="button" disabled={busy === items[0].id} onClick={() => summaryOnly(items)}
                  title="Keep the call and its summary on the record, create no tasks"
                  style={{ ...btn(false), padding: '5px 10px', fontSize: 11.5 }}>
                  {busy === items[0].id ? 'Filing\u2026' : 'Summary only'}
                </button>
              </div>
              {items.map(c => renderCard(c, { editable: true, children: (
            <>
              {/* Set WHEN and how urgent right here — for a task you'll own so it
                  lands scheduled, and for one you're tracking so you know when to
                  expect it and how much it matters. */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', marginBottom: 8, flexWrap: 'wrap' }}>
                <input type="date" value={editOf(c).due}
                  onChange={ev => setEdit(c, { due: ev.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
                    color: 'var(--text-1)', padding: '5px 8px', fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
                  {['A', 'B', 'C', 'D'].map(p => (
                    <button type="button" key={p}
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEdit(c, { priority: p }); }}
                      // 26x26 was under every touch guideline and Dara reported missing
                      // these. 44 is the floor (Apple HIG, WCAG 2.5.5); the letter stays
                      // the size it was, the target around it grows.
                      style={{ width: 44, height: 44, borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                        border: '1px solid ' + (editOf(c).priority === p ? 'var(--accent-2)' : 'var(--border)'),
                        background: editOf(c).priority === p ? 'var(--accent-2)' : 'transparent',
                        color: editOf(c).priority === p ? '#1a1409' : 'var(--text-3)' }}>{p}</button>
                  ))}
                </div>
              </div>
              {/* Anything else that belongs on the task. The quote is appended
                  automatically, so this is for what the call did not say. */}
              <textarea onClick={(e) => e.stopPropagation()} value={editOf(c).notes || ''} rows={2}
                onChange={ev => setEdit(c, { notes: ev.target.value })}
                placeholder="Add notes for this task (optional)"
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                  border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)',
                  padding: '6px 8px', fontSize: 12, marginBottom: 8, fontFamily: 'inherit', resize: 'vertical' }} />
              <button type="button" disabled={busy === c.id} onClick={() => accept(c)} style={btn(true)}>
                {c.owner === 'me' ? 'Make it a task' : 'Track it'}
              </button>
              {/* Done: for yours it records a completed task so the work counts;
                  for theirs it just closes the tracking — they delivered. */}
              {/* BOTH WAYS OF BEING FINISHED, on every card. It used to offer
                  one: "Done already" if you owned it, "They delivered" if they
                  did. Dara hit the case with no button — THEY said they would,
                  and HE did it — so the only completion available claimed they
                  had delivered, which is false and lands in the record as false.
                  Who did the work is a fact, not a consequence of whose name is
                  on the row. */}
              <button type="button" disabled={busy === c.id} onClick={() => doneAlready(c)} style={btn(false)}>
                {c.owner === 'me' ? 'Done already' : 'I did it'}
              </button>
              <button type="button" disabled={busy === c.id} onClick={() => resolveTheirs(c)} style={btn(false)}>
                They delivered
              </button>
              <button type="button" disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}
                title="Not a real promise — hide it. You can undo.">Skip</button>
            </>
              ) }))}
            </div>
          ))}
        </>
      )}

      {!compact && proposed.length > 0 && !showOlder && olderCalls.length > 0 && (
        <button type="button" onClick={() => setShowOlder(true)}
          style={{ background: 'none', border: 0, padding: '4px 0 8px', cursor: 'pointer', fontSize: 12,
            color: 'var(--room-accent, var(--accent))', fontWeight: 700, minHeight: 36 }}>
          {'Show ' + olderCalls.length + ' older conversation' + (olderCalls.length === 1 ? '' : 's') + ' (calls more than a month ago)'}
        </button>
      )}
      {compact && hiddenFuture > 0 && (
        <button type="button" onClick={() => onSeeAll && onSeeAll()}
          style={{ background: 'none', border: 0, padding: '2px 0 0', cursor: 'pointer', fontSize: 12,
            color: 'var(--room-accent, var(--accent))', fontWeight: 700 }}>
          {hiddenFuture} more not due yet — see all
        </button>
      )}

      {/* On Today this appears only once you are caught up — never as a pile. */}
      {showAside && (
        <div style={{ margin: '4px 0 12px' }}>
          <button type="button" onClick={() => loadSetAside()}
            style={{ background: 'none', border: 0, padding: '4px 0', minHeight: 44, cursor: 'pointer', fontSize: 12.5,
              color: 'var(--room-accent, var(--accent))', fontWeight: 700, textAlign: 'left' }}>
            {asideRows ? 'Hide' : (compact && !proposed.length ? 'You are caught up on your calls. ' : '') + 'PrismOS set aside ' + setAside + ' older suggestion' + (setAside === 1 ? '' : 's') + ' from calls you did not get to — look again'}
          </button>
          {asideRows && asideRows.map(c => (
            <div key={c.id} style={{ ...card, padding: '9px 12px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0, flex: 1, fontSize: 12.5, color: 'var(--text-1)' }}>
                {c.title}
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{(c.contact_name || 'A call') + (c.created_at ? ' \u00B7 ' + fmtDate(String(c.created_at).slice(0, 10)) : '')}</div>
              </div>
              <button type="button" onClick={() => bringBack(c)} style={btn(false)}>Bring back</button>
            </div>
          ))}
        </div>
      )}

      {onTime.length > 0 && (
        <>
          <div style={{ ...lab, color: 'var(--text-3)', marginBottom: 7, marginTop: 14 }}>
            Waiting on other people — {onTime.length}
          </div>
          {onTime.map(c => (
            <div key={c.id} style={{ ...card, padding: '10px 12px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                {editingId === c.id ? (
                  <input autoFocus defaultValue={c.title}
                    onBlur={ev => saveTitle(c, ev.target.value)}
                    onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveTitle(c, ev.target.value); } if (ev.key === 'Escape') setEditingId(null); }}
                    style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--accent-2)', borderRadius: 7,
                      color: 'var(--text-1)', padding: '5px 8px', fontSize: 12.5 }} />
                ) : (
                  <div onClick={() => setOpenId(openId === c.id ? null : c.id)} title="Tap to edit"
                    style={{ fontSize: 12.5, color: 'var(--text-1)', cursor: 'pointer' }}>
                    <b style={{ color: 'var(--accent-2)' }}>{responsible(c)}</b> — {c.title}
                  </div>
                )}
                {c.due_date && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>by {fmtDate(c.due_date)}</div>}

                {/* FULL EDIT, in place. Who it is on, what it says, when it is
                    due — the same three controls the proposal cards use, rather
                    than a second lesser editor. It stays on Today because that
                    is where the list is; sending you to another screen to fix a
                    date is how a list stops getting worked. */}
                {openId === c.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <div style={{ marginBottom: 8 }}>
                      <OwnerPicker owner={c.owner} ownerContactId={c.owner_contact_id}
                        counterpartyName={c.contact_name} contacts={contacts}
                        onChange={(patch) => setOwner(c, patch)} />
                    </div>
                    <input defaultValue={c.title} id={'ct-' + c.id}
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, color: 'var(--text-1)',
                        background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
                        padding: '7px 9px', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" defaultValue={c.due_date || ''} id={'cd-' + c.id}
                        style={{ flex: '1 1 140px', background: 'var(--bg-base)', border: '1px solid var(--border)',
                          borderRadius: 8, color: 'var(--text-1)', padding: '6px 8px', fontSize: 12.5 }} />
                      <button type="button" disabled={busy === c.id} style={{ ...btn(true), padding: '6px 12px', fontSize: 12 }}
                        onClick={async () => {
                          const t = document.getElementById('ct-' + c.id);
                          const d = document.getElementById('cd-' + c.id);
                          const ok = await saveCommitment(c, { title: t ? t.value : c.title, due_date: d ? d.value : c.due_date });
                          if (ok) setOpenId(null);
                        }}>
                        {busy === c.id ? 'Saving\u2026' : 'Save'}
                      </button>
                      <button type="button" style={{ ...btn(false), padding: '6px 10px', fontSize: 12 }} onClick={() => setOpenId(null)}>Cancel</button>
                    </div>
                    {c.quote && (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.45, fontStyle: 'italic' }}>
                        {'\u201C' + c.quote + '\u201D'}
                      </div>
                    )}
                    {/* Back to where it came from. There is no route to a single
                        call — QuoCallDetail only renders inside the Phone list —
                        so a 'open the call' button would strand you on a screen
                        with no way to find it. The person IS reachable, their
                        record carries the call in its timeline, and the quote
                        above is the evidence either way. */}
                    {c.call_id && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setReadingCall({ callId: c.call_id, name: c.owner_name || c.contact_name || 'this call' }); }}
                        style={{ marginTop: 8, marginRight: 12, background: 'none', border: 'none', padding: 0,
                          color: 'var(--room-accent, var(--accent))', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Read the call
                      </button>
                    )}
                    {c.contact_id && (
                      <button type="button" onClick={() => { try { window.__openContact && window.__openContact(c.contact_id); } catch (_) {} }}
                        style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                        {'\u2197 Open ' + (c.contact_name && c.contact_name !== 'Unknown' ? c.contact_name + '\u2019s' : 'the') + ' record'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" disabled={busy === c.id} onClick={() => removeCommitment(c)} title="Delete this item"
                aria-label="Delete"
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', flex: 'none' }}>×</button>
              <button type="button" disabled={busy === c.id} onClick={() => dismiss(c)} style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>Done</button>
            </div>
          ))}
          {byCall.length > 6 && (
            <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:8 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {(byCall.length - 6) + ' more conversation' + (byCall.length - 6 === 1 ? '' : 's') + ' below once these are filed'}
              </span>
            </div>
          )}
        </>
      )}

      {readingCall && (
        <div className="modal-overlay" onClick={() => setReadingCall(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(8,6,4,.72)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 620, maxHeight: '88dvh', minHeight: 0, overflow: 'auto',
              background: 'var(--bg-card)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
              border: '1px solid var(--border)', padding: '14px 14px calc(14px + env(safe-area-inset-bottom,0px))' }}>
            <button type="button" onClick={() => setReadingCall(null)}
              style={{ background: 'none', border: 0, padding: '2px 0 10px', cursor: 'pointer',
                color: 'var(--text-3)', fontSize: 13, fontWeight: 700 }}>Close</button>
            <Suspense fallback={<div style={{ padding: 16, color: 'var(--text-3)' }}>Opening the call…</div>}>
              <CallDetail callId={readingCall.callId} contactName={readingCall.name}
                onClose={() => setReadingCall(null)} />
            </Suspense>
          </div>
        </div>
      )}

    </div>
  );
}
