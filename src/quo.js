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
// One message goes out as ONE message.
//
// v1.07.40 split anything over 160 characters into single-segment parts. That
// was built on a wrong diagnosis: the 402s looked length-driven because a
// multi-segment text costs more prepaid credits than a single segment, and the
// balance was running out partway up the length scale. It was never a length
// rule — a 30-character message failed the same way once the balance hit zero.
//
// So splitting bought nothing real and cost something real: the recipient got
// nine bubbles instead of one paragraph, and a threaded reply had no obvious
// message to reply to. Reverted. Quo accepts a long message in one piece; it
// simply charges more credits for the extra segments, which is a billing
// question, not a delivery one.
//
// What stays is the honest handling of a refusal, because that is the part that
// was actually missing.

// A blocked outbox is a connection fault, and it belongs where the other ones
// are: the undismissable banner on Today. Only the client can see this one —
// nothing server-side is told that a send was refused.
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

// ONE place that sends a text. Four screens call it.
export async function sendQuoSms({ from, to, content }) {
  const body = String(content || '').trim();
  if (!body) throw new Error('Nothing to send.');
  try {
    await quoCall('/v1/messages', {
      method: 'POST',
      body: { content: body, from, to: Array.isArray(to) ? to : [to] },
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/prepaid credits/i.test(msg)) {
      try { await flagQuoCredits(); } catch (_) {}
      throw new Error(
        'Quo is out of prepaid credits, so texts sent from PrismOS are being refused. ' +
        'Texts sent inside the Quo app still work because those are covered by your plan. ' +
        'Add credits in Quo (Settings \u2192 Billing) and this starts working again \u2014 ' +
        'the message length is not the problem.');
    }
    throw e;
  }
  clearQuoCreditsFlag();   // it works again — take the banner down
  return 1;
}

export default quoCall;
