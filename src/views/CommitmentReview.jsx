import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

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
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    let q = supabase.from('commitments')
      .select('id,contact_id,owner,title,quote,due_date,confidence,status,call_id')
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
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  async function accept(c) {
    setBusy(c.id); setErr(null);
    try {
      if (c.owner === 'me') {
        // Same shape the app uses everywhere else — no bespoke task dialect.
        const { data: t, error } = await supabase.from('tasks').insert({
          user_id: userId,
          title: c.title,
          due_date: c.due_date || null,
          notes: `From a call with ${c.contact_name} — they/you said: “${c.quote}”`,
          contact_id: c.contact_id || null,
          completed: false,
        }).select().single();
        if (error) throw error;
        await supabase.from('commitments').update({ status: 'accepted', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', c.id);
      } else {
        // Theirs: on the radar, not on the list. No task is created here — that
        // is the entire point. It becomes work only if they miss the date.
        await supabase.from('commitments').update({ status: 'accepted', decided_at: new Date().toISOString() }).eq('id', c.id);
      }
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  async function dismiss(c) {
    setBusy(c.id);
    await supabase.from('commitments').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', c.id);
    await load(); onChanged && onChanged(); setBusy(null);
  }

  // The late ones: the only moment somebody else's promise becomes your problem.
  async function chase(c) {
    setBusy(c.id);
    try {
      const { data: t, error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: `Chase ${c.contact_name}: ${c.title}`,
        due_date: new Date().toISOString().slice(0, 10),
        notes: `${c.contact_name} said “${c.quote}” — due ${fmtDate(c.due_date)}, now ${daysLate(c.due_date)} day(s) late.`,
        contact_id: c.contact_id || null,
        waiting_on: c.contact_name,     // the app already speaks this
        completed: false,
      }).select().single();
      if (error) throw error;
      await supabase.from('commitments').update({ status: 'done', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', c.id);
      await load(); onChanged && onChanged();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(null);
  }

  if (!rows) return null;
  const proposed = rows.filter(r => r.status === 'proposed');
  const waiting = rows.filter(r => r.status === 'accepted' && r.owner === 'them');
  const late = waiting.filter(r => r.due_date && daysLate(r.due_date) > 0);
  const onTime = waiting.filter(r => !late.includes(r));
  if (!proposed.length && !waiting.length) return null;

  const Card = ({ c, children, tone }) => (
    <div style={{ ...card, borderColor: tone === 'late' ? EMBER : 'var(--border)', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ ...lab, color: c.owner === 'me' ? 'var(--accent-2)' : 'var(--text-3)' }}>
          {c.owner === 'me' ? 'You said you would' : `${c.contact_name} said they would`}
        </span>
        {c.confidence === 'low' && <span style={{ fontSize: 9, color: EMBER, fontWeight: 700 }}>· unsure</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4 }}>{c.title}</div>
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
          {late.map(c => (
            <Card key={c.id} c={c} tone="late">
              <button disabled={busy === c.id} onClick={() => chase(c)} style={btn(true)}>Chase them</button>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}>Let it go</button>
            </Card>
          ))}
        </>
      )}

      {proposed.length > 0 && (
        <>
          <div style={{ ...lab, marginBottom: 7, marginTop: late.length ? 14 : 0 }}>
            From your calls — {proposed.length} to review
          </div>
          {proposed.map(c => (
            <Card key={c.id} c={c}>
              <button disabled={busy === c.id} onClick={() => accept(c)} style={btn(true)}>
                {c.owner === 'me' ? 'Make it a task' : 'Track it'}
              </button>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={btn(false)}>Not a thing</button>
            </Card>
          ))}
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
                <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
                  <b style={{ color: 'var(--accent-2)' }}>{c.contact_name}</b> — {c.title}
                </div>
                {c.due_date && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>by {fmtDate(c.due_date)}</div>}
              </div>
              <button disabled={busy === c.id} onClick={() => dismiss(c)} style={{ ...btn(false), padding: '5px 10px', fontSize: 11 }}>Done</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
