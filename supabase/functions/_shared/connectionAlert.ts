// connectionAlert.ts — one way to say "something you depend on stopped working."
//
// The Google watcher had all of this and still never reached Dara, for four
// reasons worth remembering, because each is a trap any new watcher would fall
// into on its own:
//
//   1. It alerted on ONE channel (web push). A single channel is a single point
//      of failure, and push is the least reliable one we have.
//   2. It reported success without checking. `await fetch(push); return true;`
//      stamps "notified" even when zero devices were reached.
//   3. Recovery DELETED the evidence — reauth_required_at, reauth_notified_at
//      and the error string were all nulled — so "did it ever fire?" became
//      unanswerable. That is why Dara could not tell, and neither could I.
//   4. The one visible surface was a banner in Settings, a screen nobody opens
//      *because* something broke.
//
// So: every alert is a durable row that is NEVER deleted (resolved_at is set,
// history stays), it goes out on up to four independent channels, and each
// channel records whether it actually delivered.
//
// Channel order is deliberate. SMS is the one Dara said he would never miss, so
// it is not merely a fallback — it fires on the first alert for anything marked
// critical. Email is sent from a DIFFERENT account than the broken one, because
// emailing you about your broken email account is circular.

export type AlertChannel = { channel: string; ok: boolean; detail?: string; at: string };

export type RaiseArgs = {
  admin: any;
  userId: string;
  kind: string;          // 'google_email' | 'google_calendar' | 'quo' | ...
  targetId?: string | null;
  label: string;         // what the human calls it: "khoyi1234@gmail.com"
  detail?: string;       // machine reason, for the audit row
  what?: string;         // "email and calendar" — what stopped working
  actionUrl?: string;
  critical?: boolean;    // true => SMS immediately, not only on escalation
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QUO_BASE = "https://api.openphone.com";

// Re-alert cadence. Silence after the first shout is how an outage becomes
// permanent; shouting every ten minutes is how someone turns alerts off.
const RENOTIFY_MS = 6 * 60 * 60 * 1000;   // 6 hours
const ESCALATE_MS = 20 * 60 * 1000;       // still broken after 20 min => SMS

function nowIso() { return new Date().toISOString(); }

// ── individual channels ──────────────────────────────────────────────────────

async function sendPush(userId: string, title: string, body: string, url: string): Promise<AlertChannel> {
  const at = nowIso();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ user_id: userId, title, body, url, tag: "connection-alert" }),
    });
    const j = await r.json().catch(() => ({}));
    // "sent" is the only honest measure. A 200 with sent:0 means no device got
    // it, which is exactly the false success that hid the last outage.
    const sent = Number(j && j.sent) || 0;
    return { channel: "push", ok: r.ok && sent > 0, detail: r.ok ? `sent=${sent} failed=${j.failed ?? "?"}` : `HTTP ${r.status}`, at };
  } catch (e) {
    return { channel: "push", ok: false, detail: String(e), at };
  }
}

async function sendSms(admin: any, userId: string, text: string): Promise<AlertChannel> {
  const at = nowIso();
  try {
    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!apiKey) return { channel: "sms", ok: false, detail: "no QUO_API_KEY", at };

    const { data: agent } = await admin.from("agents")
      .select("alert_phone, alert_sms_enabled").eq("auth_user_id", userId).maybeSingle();
    if (!agent || agent.alert_sms_enabled === false) return { channel: "sms", ok: false, detail: "sms disabled", at };
    const to = agent.alert_phone;
    if (!to) return { channel: "sms", ok: false, detail: "no alert_phone on agent", at };

    const { data: qs } = await admin.from("quo_settings")
      .select("active_number").eq("user_id", userId).maybeSingle();
    const from = qs && qs.active_number;
    if (!from) return { channel: "sms", ok: false, detail: "no active Quo number", at };

    const r = await fetch(`${QUO_BASE}/v1/messages`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], content: text }),
    });
    if (!r.ok) return { channel: "sms", ok: false, detail: `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`, at };
    return { channel: "sms", ok: true, detail: `to ${to}`, at };
  } catch (e) {
    return { channel: "sms", ok: false, detail: String(e), at };
  }
}

// Send from an account that is NOT the one being reported broken, and never
// from an account already flagged. If email itself is what died, this simply
// reports that it could not run — it does not pretend to have delivered.
async function sendEmail(admin: any, userId: string, excludeAccountId: string | null, subject: string, text: string): Promise<AlertChannel> {
  const at = nowIso();
  try {
    const { data: accts } = await admin.from("email_accounts")
      .select("id, email_address, reauth_required_at, is_active")
      .eq("user_id", userId).eq("is_active", true);
    const healthy = (accts || []).filter((a: any) => a.id !== excludeAccountId && !a.reauth_required_at);
    if (!healthy.length) return { channel: "email", ok: false, detail: "no healthy account to send from", at };

    const { data: agent } = await admin.from("agents").select("email").eq("auth_user_id", userId).maybeSingle();
    const to = (agent && agent.email) || healthy[0].email_address;

    const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      // user_id is required — gmail-send 401s without it. That omission is what
      // silently broke four other functions; do not remove it.
      body: JSON.stringify({ account_id: healthy[0].id, user_id: userId, to, subject, body_text: text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j && j.error)) return { channel: "email", ok: false, detail: (j && j.error) || `HTTP ${r.status}`, at };
    return { channel: "email", ok: true, detail: `via ${healthy[0].email_address} to ${to}`, at };
  } catch (e) {
    return { channel: "email", ok: false, detail: String(e), at };
  }
}

// ── the public surface ───────────────────────────────────────────────────────

// Open (or update) an alert and notify. Idempotent: calling it every ten
// minutes while something is broken does NOT spam — one open row per target,
// re-notified on the cadence above.
export async function raiseConnectionAlert(a: RaiseArgs): Promise<{ alertId: string | null; notified: boolean; channels: AlertChannel[] }> {
  const { admin, userId, kind, label } = a;
  const targetId = a.targetId || null;

  const { data: existing } = await admin.from("connection_alerts")
    .select("id, opened_at, last_notified_at, notify_count, escalated_at, channels, acknowledged_at")
    .eq("user_id", userId).eq("kind", kind).is("resolved_at", null)
    .eq("target_id", targetId).maybeSingle();

  const now = Date.now();
  let alertId = existing ? existing.id : null;
  let openedAt = existing ? new Date(existing.opened_at).getTime() : now;

  if (!existing) {
    const { data: made, error } = await admin.from("connection_alerts")
      .insert({ user_id: userId, kind, target_id: targetId, label, detail: a.detail || null })
      .select("id").maybeSingle();
    if (error) return { alertId: null, notified: false, channels: [{ channel: "insert", ok: false, detail: error.message, at: nowIso() }] };
    alertId = made && made.id;
    openedAt = now;
  }

  const first = !existing;
  const lastNotified = existing && existing.last_notified_at ? new Date(existing.last_notified_at).getTime() : 0;
  const dueAgain = !first && now - lastNotified > RENOTIFY_MS;
  // Acknowledging silences the noise but never closes the alert — the banner
  // stays until the connection actually works again.
  const acked = !!(existing && existing.acknowledged_at);
  if (!first && !dueAgain) return { alertId, notified: false, channels: [] };
  if (acked && !dueAgain) return { alertId, notified: false, channels: [] };

  const what = a.what || "syncing";
  const url = a.actionUrl || "https://darasapp.com/?view=settings&reconnect=1";
  const title = "PrismOS: " + label + " stopped working";
  const body = `Your ${what} stopped. Open PrismOS and tap Reconnect — it takes about fifteen seconds.`;
  const sms = `PrismOS: ${label} disconnected — ${what} has stopped. Reconnect: ${url}`;

  const channels: AlertChannel[] = [];
  channels.push(await sendPush(userId, title, body, url));

  const brokenLongEnough = now - openedAt > ESCALATE_MS;
  const wantSms = a.critical !== false || brokenLongEnough || dueAgain;
  if (wantSms) channels.push(await sendSms(admin, userId, sms));

  channels.push(await sendEmail(admin, userId, kind.startsWith("google_") ? targetId : null,
    title, body + "\n\n" + url));

  const delivered = channels.some((c) => c.ok);
  const prior = (existing && Array.isArray(existing.channels)) ? existing.channels : [];
  await admin.from("connection_alerts").update({
    last_notified_at: nowIso(),
    notify_count: ((existing && existing.notify_count) || 0) + 1,
    escalated_at: wantSms ? ((existing && existing.escalated_at) || nowIso()) : (existing && existing.escalated_at) || null,
    detail: a.detail || null,
    channels: prior.concat(channels).slice(-40),
  }).eq("id", alertId);

  return { alertId, notified: delivered, channels };
}

// Recovery closes the alert but KEEPS the row. History is the whole point.
export async function resolveConnectionAlert(admin: any, userId: string, kind: string, targetId?: string | null) {
  await admin.from("connection_alerts").update({ resolved_at: nowIso() })
    .eq("user_id", userId).eq("kind", kind).eq("target_id", targetId || null).is("resolved_at", null);
}
