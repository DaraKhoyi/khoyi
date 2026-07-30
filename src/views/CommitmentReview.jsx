import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import OwnerPicker from './OwnerPicker';

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

const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const daysLate = (d) => Math.floor((Date.now() - new Date(d + 'T12:00:00')) / 86400000);

export default function CommitmentReview({ userId, contactId = null, onChanged }) {
  const [rows, setRows] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [shownProposed, setShownProposed] = useState(3);   // never a wall
  // What the user sets on a card WHILE reviewing — a due date and a priority — so
  // a commitment becomes a properly-scheduled task in one step, instead of landing
  // dateless and having to be hunted down and edited later.
  const [edits, setEdits] = useState({});   // { [id]: { due, priority, title } }
  const editOf = (c) => edits[c.id] || { due: c.due_date || '', priority: 'B', title: c.title || '' };
  // Seed from the COMMITMENT on first touch — not from empty strings — so setting
  // a date never wipes the title (and vice versa). Takes the whole commitment so
  // the seed has the real values. Functional update reads the latest edits map.
  const setEdit = (c, patch) => setEdits(e => {
    const cur = e[c.id] || { due: c.due_date || '', priority: 'B', title: c.title || '' };
    return { ...e, [c.id]: { ...cur, ...patch } };
  });

  async function load() {
    let q = supabase.from('commitments')
      .select('id,contact_id,owner,owner_contact_id,title,quote,due_date,confidence,status,call_id,fuse')
      .in('status', ['proposed', 'accepted'])
      .order('created_at', { ascending: false });
    if (contactId) q = q.eq('contact_id', contactId);
    const { data, error } = await q;
    if (error) { setErr(error.message); return; }
    const ids = [...new Set((data || []).map(r => r.contact_id).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: cs } = await supabase.from('contacts').select('id,name').in('id', ids);
      (cs || []).forEach(c => { names[c.id] = c.name; });
    }
    setRows((data || []).map(r => ({ ...r, contact_name: names[r.contact_id] || 'Unknown' })));
    // Everyone, for the "someone else" picker — the responsible party is often a
    // lender/TC/co-agent who was never on the call, so this cannot be scoped to
    // the call's participants.
    if (!contacts.length) {
      const { data: all } = await supabase.from('contacts').select('id,name').order('name');
      setContacts(all || []);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

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
        const pmap = { A: 'high', B: 'medium', C: 'low' };
        const { data: t, error } = await supabase.from('tasks').insert({
          user_id: userId,
          title,
          due_date: e.due || c.due_date || null,
          priority: pmap[e.priority] || 'medium',
          priority_system: 'eisenhower',
          eisenhower_quadrant: e.priority || 'B',
          notes: `From a call with ${c.contact_name} — they/you said: “${c.quote}”`,
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

  async function dismiss(c) {
    setBusy(c.id);
    const { error } = await supabase.from('commitments').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { setErr(String(error.message || error)); setBusy(null); return; }
    await load(); onChanged && onChanged(); setBusy(null);
  }

  // Reword a commitment in place. Save the edited title back to the row.
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
        due_date: new Date().toISOString().slice(0, 10),
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
  const proposed = rows.filter(r => r.status === 'proposed' && (r.fuse || 'near') !== 'immediate');
  const waiting = rows.filter(r => r.status === 'accepted' && r.owner === 'them');
  const late = waiting.filter(r => r.due_date && daysLate(r.due_date) > 0);
  const onTime = waiting.filter(r => !late.includes(r));
  if (!proposed.length && !waiting.length) return null;

  // IMPORTANT: this is a plain function, NOT a nested <Card/> component. A nested
  // component defined inside the render gets a new function identity every render,
  // so React remounts its whole subtree on each keystroke — which destroys the
  // <input> DOM node and drops focus/keyboard after one character. Calling a
  // function that returns JSX splices it into the parent at a stable position, so
  // the input keeps its identity and focus survives typing. Key goes on the root.
  const renderCard = (c, { children, tone, editable }) => (
    <div key={c.id} style={{ ...card, borderColor: tone === 'late' ? EMBER : 'var(--border)', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ ...lab, color: c.owner === 'me' ? 'var(--accent-2)' : 'var(--text-3)' }}>
          {c.owner === 'me' ? 'You said you would'
            : c.owner_contact_id ? `${responsible(c)} is on the hook`
            : `${c.contact_name} said they would`}
        </span>
        {c.confidence === 'low' && <span style={{ fontSize: 9, color: EMBER, fontWeight: 700 }}>· unsure</span>}
      </div>
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
      {c.quote && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic', margin: '6px 0 0',
          paddingLeft: 9, borderLeft: '2px solid var(--accent-dim)', lineHeight: 1.5 }}>
          “{c.quote}”
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {c.due_date && (
          <span style={{ fontSize: 11, fontWeight: 700, color: tone === 'late' ? EMBER : 'var(--text-3)' }}>
            {tone === 'late' ? `${daysLate(c.due_date)}d late · was ${fmtDate(c.due_date)}` : fmtDate(c.due_date)}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!editable && (
          <button disabled={busy === c.id} onClick={() => removeCommitment(c)} title="Delete this item" aria-label="Delete"
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
          <div style={{ ...lab, color: EMBER, marginBottom: 7 }}>They’re late — {late.length}</div>
          {late.map(c => renderCard(c, { tone: 'late', children: (
            <>
              <button disabled={busy === c.id} onClick={() => chase(c)} style={btn(true)}>Chase them</button>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}>Let it go</button>
            </>
          ) }))}
        </>
      )}

      {proposed.length > 0 && (
        <>
          <div style={{ ...lab, marginBottom: 7, marginTop: late.length ? 14 : 0 }}>
            From your calls — {Math.min(shownProposed, proposed.length)} of {proposed.length} to review
          </div>
          {proposed.slice(0, shownProposed).map(c => renderCard(c, { editable: true, children: (
            <>
              {/* Set WHEN and how urgent right here — for a task you'll own so it
                  lands scheduled, and for one you're tracking so you know when to
                  expect it and how much it matters. */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', marginBottom: 8, flexWrap: 'wrap' }}>
                <input type="date" value={editOf(c).due}
                  onChange={ev => setEdit(c, { due: ev.target.value })}
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
                    color: 'var(--text-1)', padding: '5px 8px', fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 3 }}>
                  {['A', 'B', 'C'].map(p => (
                    <button key={p} onClick={() => setEdit(c, { priority: p })}
                      style={{ width: 26, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        border: '1px solid ' + (editOf(c).priority === p ? 'var(--accent-2)' : 'var(--border)'),
                        background: editOf(c).priority === p ? 'var(--accent-2)' : 'transparent',
                        color: editOf(c).priority === p ? '#1a1409' : 'var(--text-3)' }}>{p}</button>
                  ))}
                </div>
              </div>
              <button disabled={busy === c.id} onClick={() => accept(c)} style={btn(true)}>
                {c.owner === 'me' ? 'Make it a task' : 'Track it'}
              </button>
              {/* Done: for yours it records a completed task so the work counts;
                  for theirs it just closes the tracking — they delivered. */}
              <button disabled={busy === c.id}
                onClick={() => (c.owner === 'me' ? doneAlready(c) : resolveTheirs(c))}
                style={btn(false)}>
                {c.owner === 'me' ? 'Done already' : 'They delivered'}
              </button>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}>Not a thing</button>
            </>
          ) }))}
        </>
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
                  <div onClick={() => setEditingId(c.id)} title="Tap to reword"
                    style={{ fontSize: 12.5, color: 'var(--text-1)', cursor: 'text' }}>
                    <b style={{ color: 'var(--accent-2)' }}>{responsible(c)}</b> — {c.title}
                  </div>
                )}
                {c.due_date && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>by {fmtDate(c.due_date)}</div>}
              </div>
              <button disabled={busy === c.id} onClick={() => removeCommitment(c)} title="Delete this item"
                aria-label="Delete"
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', flex: 'none' }}>×</button>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>Done</button>
            </div>
          ))}
          {proposed.length > shownProposed && (
            <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShownProposed(n => n + 3)}>
                Show 3 more ({proposed.length - shownProposed} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
