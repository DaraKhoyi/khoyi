// Shared journal-save logic used by BOTH the full Journal screen
// (src/views/JournalView.jsx) and the floating Quick log in the main app
// (src/App.js). Previously logJournalEntry lived only inside JournalView and
// was not exported, so the Quick log's call to it threw "not defined" and
// surfaced as a generic "Save failed". Centralizing here fixes that and keeps
// the two paths from drifting.
import { supabase } from '../dataService';

// Match App.js's today_ymd exactly (UTC date slice) so the Quick log and the
// full Journal screen always agree on which day an entry belongs to.
const today_ymd = () => new Date().toISOString().slice(0, 10);

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

export async function processJournalAnalysis(userId, entry, analysis) {
  const out = [];
  for (const l of (analysis.links || [])) {
    if (!l.id || !l.type || !l.label) continue;
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
