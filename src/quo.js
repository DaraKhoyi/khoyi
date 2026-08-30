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
// Quo bills EVERY text sent through the API against prepaid credits, while
// texts sent inside the Quo app are covered by the plan. When the credit balance
// reaches zero the API returns 402 "The organization does not have enough
// prepaid credits to send the message" and the Quo app keeps working — which is
// exactly what Dara saw.
//
// A correction worth recording. On 27 Aug the same error appeared and the
// evidence pointed at LENGTH: 160 characters sent, 161 failed. That was real but
// it was not the cause. There was a small credit balance left, and a
// multi-segment message costs more of it than a single segment, so the balance
// ran out partway up the length scale and length looked like the trigger. On 30
// Aug a THIRTY-character message to the same number failed the same way. The
// balance is simply gone. Length was a symptom of price, not the rule.
//
// Splitting still earns its place — fewer segments is less credit per message,
// and it is how the app behaves — so it stays. But the error must name the real
// problem, because "shorten it" sends someone off editing a message that was
// never too long.
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
// A blocked outbox is a connection fault, and it belongs where the other ones
// are: the undismissable banner on Today. Only the client can see this one —
// nothing server-side gets told that a send was refused.
async function flagQuoCredits() {
  const { data: u } = await supabase.auth.getUser();
  const uid = u && u.user && u.user.id;
  if (!uid) return;
  const { data: open } = await supabase.from('connection_alerts')
    .select('id').eq('kind', 'quo_credits').is('resolved_at', null).limit(1);
  if (open && open.length) return;
  await supabase.from('connection_alerts').insert({
    user_id: uid, kind: 'quo_credits', target_id: 'sms',
    label: 'Texting from PrismOS',
    detail: 'Quo returned 402: not enough prepaid credits.',
  });
}

async function clearQuoCreditsFlag() {
  try {
    await supabase.from('connection_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('kind', 'quo_credits').is('resolved_at', null);
  } catch (_) {}
}

export async function sendQuoSms({ from, to, content, onProgress }) {
  const parts = splitSms(content);
  if (!parts.length) throw new Error('Nothing to send.');
  for (let i = 0; i < parts.length; i++) {
    try {
      await quoCall('/v1/messages', { method: 'POST', body: { content: parts[i], from, to: Array.isArray(to) ? to : [to] } });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/prepaid credits/i.test(msg)) {
        // Raise it on the home screen too — this blocks every text, not just
        // this one, and it will not fix itself.
        try { await flagQuoCredits(); } catch (_) {}
        throw new Error(
          'Quo is out of prepaid credits, so texts sent from PrismOS are being refused. ' +
          'Texts sent inside the Quo app still work because those are covered by your plan. ' +
          'Add credits in Quo (Settings \u2192 Billing) and this starts working again \u2014 ' +
          'the message length is not the problem.');
      }
      throw new Error(i === 0 ? msg : 'Sent ' + i + ' of ' + parts.length + ' parts, then: ' + msg);
    }
    if (onProgress) onProgress(i + 1, parts.length);
  }
  // It works again — take the banner down without waiting for a sweep.
  clearQuoCreditsFlag();
  return parts.length;
}

export default quoCall;
