// voiceReviews — offline voice notes that were retried later (CRM Phase 1, 10 Oct 2026).
// The outbox replays a recording when signal returns. Its result used to be thrown
// away, so the memo was silently lost. Now the result is kept on this phone in a
// review queue, and VoiceCapture shows "voice note ready to review" with the same
// Edit / Cancel / Save cards. Nothing is saved to the database until Save.
import { supabase } from '../dataService';
const key = (uid) => 'voiceReviews:' + uid;
export function pendingVoiceReviews(uid) {
  try { return JSON.parse(localStorage.getItem(key(uid)) || '[]'); } catch (_) { return []; }
}
export function dropVoiceReview(uid, id) {
  localStorage.setItem(key(uid), JSON.stringify(pendingVoiceReviews(uid).filter(r => r.id !== id)));
  window.dispatchEvent(new Event('voice-reviews'));
}
export async function replayVoiceNote(payload, uid) {
  const { data, error } = await supabase.functions.invoke('voice-note', { body: payload });
  // THROW to keep it queued: returning quietly would delete the recording.
  if (error || data?.error) throw new Error(data?.error || error?.message || 'send failed');
  if (data?.empty) return;
  const item = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
    transcript: data.transcript || '', result: { ...(data.result || {}), capped: !!data.capped } };
  localStorage.setItem(key(uid), JSON.stringify([...pendingVoiceReviews(uid), item].slice(-20)));
  window.dispatchEvent(new Event('voice-reviews'));
}
