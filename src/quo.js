// ── Quo (OpenPhone) API helper — extracted from App.js (strangle) ─────────────
// Thin wrapper over the quo-proxy edge function. Self-contained (only needs the
// supabase client). The Quo modals/components import quoCall from here.

import { supabase } from './dataService';

export async function quoCall(path, { method = 'GET', query, body } = {}) {
  const { data, error } = await supabase.functions.invoke('quo-proxy', { body: { path, method, query, body } });
  if (error) throw new Error(error.message || 'quo-proxy unreachable');
  if (!data) throw new Error('No response from Quo');
  if (data.ok === false && data.error) throw new Error(data.error);
  if (typeof data.status === 'number' && data.status >= 400) {
    const d = data.data || {};
    throw new Error(d.message || d.errors?.[0]?.message || `Quo error ${data.status}`);
  }
  return data.data; // { data: [...] } | { data: {...} }
}

// ── Sending a text ───────────────────────────────────────────────────────────
//
// Quo's API bills anything longer than ONE SMS segment against prepaid credits,
// and this workspace has none — so a long text comes back 402 "The organization
// does not have enough prepaid credits to send the message". The message is
// technically Quo's and completely misleading: nothing is wrong with the plan,
// and the SAME text pasted into the Quo app sends fine, because in-app
// messaging is included where multi-segment API sends are not.
//
// Measured against the live API rather than assumed:
//     160 characters -> 202 sent
//     161 characters -> 402 Not Enough Credits
//
// So we send the way the app does: as single-segment messages, in order. Split
// on sentence and word boundaries so each part reads like something a person
// typed, never mid-word.
export const SMS_SEGMENT = 160;

export function splitSms(text, limit = SMS_SEGMENT) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= limit) return [t];
  const parts = [];
  let rest = t;
  while (rest.length > limit) {
    let cut = -1;
    // Prefer a sentence end, then a line break, then a space — in that order,
    // and only in the back half so a part is never absurdly short.
    const window = rest.slice(0, limit + 1);
    for (const re of [/[.!?]\s(?=[^]*$)/g, /\n(?=[^]*$)/g, /\s(?=[^]*$)/g]) {
      let m, last = -1;
      while ((m = re.exec(window)) !== null) { if (m.index > limit * 0.45) last = m.index + (re.source.startsWith('[.!?]') ? 1 : 0); }
      if (last > 0) { cut = last; break; }
    }
    if (cut <= 0) cut = limit;               // one enormous word: hard cut
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

// How many texts this will actually become. The composer shows it so nobody is
// surprised by six bubbles.
export function smsPartCount(text) { return splitSms(text).length; }

// ONE place that sends a text. Four screens used to call quoCall('/v1/messages')
// directly and all four hit the same wall.
export async function sendQuoSms({ from, to, content, onProgress }) {
  const parts = splitSms(content);
  if (!parts.length) throw new Error('Nothing to send.');
  for (let i = 0; i < parts.length; i++) {
    try {
      await quoCall('/v1/messages', { method: 'POST', body: { content: parts[i], from, to: Array.isArray(to) ? to : [to] } });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/prepaid credits/i.test(msg)) {
        throw new Error(parts.length > 1
          ? 'Quo rejected part ' + (i + 1) + ' of ' + parts.length + '. Shorten the message and try again.'
          : 'Quo rejected this message. Shorten it and try again.');
      }
      throw new Error(i === 0 ? msg : 'Sent ' + i + ' of ' + parts.length + ' parts, then: ' + msg);
    }
    if (onProgress) onProgress(i + 1, parts.length);
  }
  return parts.length;
}

export default quoCall;
