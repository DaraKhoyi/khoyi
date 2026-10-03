// Shared journal-save logic used by BOTH the full Journal screen
// (src/views/JournalView.jsx) and the floating Quick log in the main app
// (src/App.js). Previously logJournalEntry lived only inside JournalView and
// was not exported, so the Quick log's call to it threw "not defined" and
// surfaced as a generic "Save failed". Centralizing here fixes that and keeps
// the two paths from drifting.
import { supabase } from '../dataService';
import { todayNY } from '../clock';

// Match App.js's today_ymd exactly (UTC date slice) so the Quick log and the
// full Journal screen always agree on which day an entry belongs to.
const today_ymd = () => todayNY();

export async function mirrorJournalToTimeline(userId, entry, type, entityId) {
  try {
    const { data } = await supabase.from('contact_interactions').insert({
      user_id: userId, entity_type: type, entity_id: entityId,
      contact_id: type === 'contact' ? entityId : null,
      kind: 'note', channel: 'note', body: entry.content, brief: (entry.content || '').slice(0, 90),
      occurred_at: entry.occurred_at, journal_entry_id: entry.id,
    }).select('id').single();
    return data?.id || null;
  } catch (_) { return null; }
}

export async function processJournalAnalysis(userId, entry, analysis, skip = null) {
  const out = [];
  for (const l of (analysis.links || [])) {
    if (!l.id || !l.type || !l.label) continue;
    if (skip && skip.has(l.type + ':' + l.id)) continue;   // already confirmed, or the person said no
    const confirmed = (Number(l.confidence) || 0) >= 0.8;
    const { data: row } = await supabase.from('journal_links').insert({
      user_id: userId, entry_id: entry.id, entity_type: l.type, entity_id: l.id, label: l.label, confidence: l.confidence, confirmed, dismissed: false,
    }).select().single();
    if (!row) continue;
    // Mirror confirmed links (contact / property / deal — not project) onto the
    // entity's interaction timeline.
    if (confirmed && (l.type === 'contact' || l.type === 'property' || l.type === 'deal')) {
      const iid = await mirrorJournalToTimeline(userId, entry, l.type, l.id);
      if (iid) { await supabase.from('journal_links').update({ interaction_id: iid }).eq('id', row.id); row.interaction_id = iid; }
    }
    out.push(row);
  }
  return out;
}

// Insert a journal entry, self-healing through a lapsed login: if the first
// write is rejected for an auth/RLS reason, refresh the session once and retry.
// On unrecoverable failure it throws a clear, user-facing message (the callers
// keep the text in the box on throw, so nothing is lost).
export async function logJournalEntry(userId, content, kind) {
  const day = today_ymd();
  if (!userId) throw new Error('You appear to be signed out — please refresh the app and try again. Your text is safe.');
  const payload = { user_id: userId, day, occurred_at: new Date().toISOString(), kind: kind || 'text', content };
  const tryInsert = () => supabase.from('journal_entries').insert(payload).select().single();
  let { data: entry, error } = await tryInsert();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    const authish = error.status === 401 || msg.includes('jwt') || msg.includes('expired')
      || msg.includes('row-level security') || msg.includes('row level security')
      || msg.includes('not authorized') || msg.includes('permission');
    if (authish) {
      try { await supabase.auth.refreshSession(); } catch (_) {}
      ({ data: entry, error } = await tryInsert());
      if (error) {
        throw new Error('Your session expired. Please refresh the app (or sign in again), then tap Log — your text is still here.');
      }
    } else {
      throw error;
    }
  }
  if (!entry) throw new Error('Save failed — please try again. Your text is still here.');
  let links = [], actions = [];
  try {
    const { data: a } = await supabase.functions.invoke('journal-analyze', { body: { entry_id: entry.id } });
    if (a && !a.error) { links = await processJournalAnalysis(userId, entry, a); actions = a.action_items || []; }
  } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('journal-entry-added', { detail: { day } })); } catch (_) {}
  return { entry, links, actions };
}

// ── The day's running note (3 Oct 2026) ──────────────────────────────────────
// Dara: "one big note and keep coming back to it. Save its current state as I
// work on it and go away from it and then come back to it during the day."
// kind = 'running', one per person per day (unique index in
// supabase/sql/2026-10-03_journal_running_note.sql).

export async function loadRunningNote(userId, day = today_ymd()) {
  const { data, error } = await supabase.from('journal_entries').select('*')
    .eq('user_id', userId).eq('day', day).eq('kind', 'running').maybeSingle();
  if (error) throw error;
  return data || null;
}

// Save the running note's text. Creates the row on the first save; after that it
// is an update. Returns the row. Throws on failure — the caller keeps the text
// on the phone and tries again.
export async function saveRunningNote(userId, entry, content, day = today_ymd()) {
  if (!userId) throw new Error('signed out');
  if (entry && entry.id) {
    const { data, error } = await supabase.from('journal_entries')
      .update({ content, updated_at: new Date().toISOString() }).eq('id', entry.id).select().single();
    if (error) throw error;
    return data;
  }
  const ins = await supabase.from('journal_entries')
    .insert({ user_id: userId, day, kind: 'running', content, occurred_at: new Date().toISOString() }).select().single();
  if (!ins.error) return ins.data;
  // Another device started today's note a moment ago: write into that one.
  if (String(ins.error.code) === '23505') {
    const existing = await loadRunningNote(userId, day);
    if (existing) return saveRunningNote(userId, existing, content, day);
  }
  throw ins.error;
}

// The text changed, so who and what it mentions may have changed. Links the
// person confirmed stay (their copy on the contact's timeline is refreshed);
// links they dismissed stay dismissed; unconfirmed guesses are replaced.
export async function reanalyzeEntry(userId, entry) {
  try {
    const { data: old } = await supabase.from('journal_links').select('id,entity_type,entity_id,confirmed,dismissed,interaction_id').eq('entry_id', entry.id);
    const keep = new Set(), stale = [], live = [];
    for (const l of (old || [])) {
      if (l.confirmed || l.dismissed) { keep.add(l.entity_type + ':' + l.entity_id); if (l.confirmed && l.interaction_id) live.push(l.interaction_id); }
      else stale.push(l.id);
    }
    if (live.length) await supabase.from('contact_interactions').update({ body: entry.content, brief: (entry.content || '').slice(0, 90) }).in('id', live);
    if (stale.length) await supabase.from('journal_links').delete().in('id', stale);
    const { data: a } = await supabase.functions.invoke('journal-analyze', { body: { entry_id: entry.id } });
    let links = [], actions = [];
    if (a && !a.error) { links = await processJournalAnalysis(userId, entry, a, keep); actions = a.action_items || []; }
    try { window.dispatchEvent(new CustomEvent('journal-entry-added', { detail: { day: entry.day } })); } catch (_) {}
    return { links, actions };
  } catch (_) { return { links: [], actions: [] }; }
}

// "Little notes, combined at the end of the day": every short note of the day,
// in the order they were written, each under its time, becomes part of the
// day's one note. The short notes are removed; their words are not.
export async function combineDayNotes(userId, day, entries, fmtTime) {
  const shorts = entries.filter((e) => e.kind !== 'running').slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  if (!shorts.length) return null;
  const running = entries.find((e) => e.kind === 'running') || null;
  const block = shorts.map((e) => fmtTime(e.occurred_at) + ' \u2014 ' + String(e.content || '').trim()).join('\n\n');
  const text = running && String(running.content || '').trim() ? String(running.content).replace(/\s+$/, '') + '\n\n' + block : block;
  const saved = await saveRunningNote(userId, running, text, day);   // the words are safe BEFORE anything is removed
  const ids = shorts.map((e) => e.id);
  const { data: ls } = await supabase.from('journal_links').select('interaction_id').in('entry_id', ids);
  const iids = (ls || []).map((l) => l.interaction_id).filter(Boolean);
  if (iids.length) await supabase.from('contact_interactions').delete().in('id', iids);
  const { error } = await supabase.from('journal_entries').delete().in('id', ids);
  if (error) throw error;
  await reanalyzeEntry(userId, saved);
  return saved;
}

// ==words== is a highlight. Kept as plain text so every note stays searchable,
// summarisable and readable anywhere; drawn in gold where notes are shown.
export function splitHighlights(text) {
  const out = []; const re = /==([^=\n][^\n]*?)==/g; let last = 0, m;
  const s = String(text || '');
  while ((m = re.exec(s))) { if (m.index > last) out.push({ t: s.slice(last, m.index) }); out.push({ t: m[1], hi: true }); last = m.index + m[0].length; }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}
