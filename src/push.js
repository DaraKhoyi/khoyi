// push.js — the ONE way a device is connected for alerts, and the one way we
// decide whether an agent can actually be reached.
//
// 1 Oct 2026, from the panel: Josh Maples and Ola Alhuneidi were sent 15 alerts
// in 7 days and not one reached a device. Both were beta testers. Nothing in the
// app told them, and nothing told Dara. Three things let that happen:
//
//   1. "On" meant "a row exists in push_subscriptions". A row whose phone had
//      been refusing every alert for weeks still read as on — the Today prompt
//      went quiet and the Adoption screen showed 🔔.
//   2. Turning notifications on ended with a confident "You're all set" whether
//      or not the confirming push arrived. Setup had no real finish line.
//   3. A browser still holding a subscription made under an old VAPID key can't
//      receive our pushes, and subscribe() won't replace it on its own.
//
// So: a device counts only if it is not refusing (last_error is null — the same
// test lead_reachable() uses server-side), connecting a device always ends with
// a real test push whose result we SHOW, and a stale-key subscription is
// replaced. An agent who was missed is told how many times, plainly.
import { supabase } from './dataService';

export const VAPID_PUBLIC_KEY = 'BF7IbYP2gbqaV5B3-iaX88-r08O9tLutgXxUadjJicDKjl4QU8xxu-Yfdgloej6DeUrtChNcT6gT5HlS4Ze6OJk';
// Setup/test pushes carry this tag so the nightly "alerts delivered" count
// measures real alerts, not people pressing the test button.
export const PUSH_TEST_TAG = 'push-test';

export function b64ToU8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b); const a = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
  return a;
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}
export function isIOS() { return typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent); }
export function isStandalone() {
  return typeof window !== 'undefined' && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
}

function sameKey(buf, want) {
  if (!buf) return true;               // browser didn't say — don't churn it
  const got = new Uint8Array(buf);
  if (got.length !== want.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
  return true;
}

async function saveSub(userId, sub) {
  const j = sub.toJSON();
  return supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent },
    { onConflict: 'user_id,endpoint' });
}

// Where does this person stand? Read from the server, never inferred from the
// current browser alone.
//   devices  — rows saved for them
//   working  — rows not currently refusing alerts
//   missed7d — alerts in the last 7 days that reached no device
//   why      — the push log's reason for the latest miss ("no devices", ...)
export async function pushHealth(userId) {
  const out = { devices: 0, working: 0, missed7d: 0, why: null };
  if (!userId) return out;
  try {
    const { data } = await supabase.from('push_subscriptions').select('id,last_error').eq('user_id', userId);
    out.devices = (data || []).length;
    out.working = (data || []).filter(r => !r.last_error).length;
  } catch (_) {}
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await supabase.from('push_log').select('sent,note,tag,created_at')
      .eq('user_id', userId).gt('created_at', since).order('created_at', { ascending: false }).limit(200);
    const misses = (data || []).filter(r => (r.sent || 0) === 0 && r.tag !== PUSH_TEST_TAG);
    out.missed7d = misses.length;
    out.why = misses[0]?.note || null;
  } catch (_) {}
  return out;
}

// Quietly keep this browser's subscription saved (runs on load; no prompts).
export async function resaveThisDevice(userId) {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub || !sameKey(sub.options && sub.options.applicationServerKey, b64ToU8(VAPID_PUBLIC_KEY))) return false;
    await saveSub(userId, sub);
    return true;
  } catch (_) { return false; }
}

// Connect THIS device and prove it with a real push. Must be called from a tap
// (iOS only allows the permission prompt inside a user gesture).
// Returns { ok, sent, message } — ok is true only when the test reached a device.
export async function connectThisDevice(userId) {
  if (!pushSupported()) {
    return { ok: false, sent: 0, message: isIOS() && !isStandalone()
      ? 'On iPhone, alerts only work from the Home Screen app. Add PrismOS to your Home Screen, open it from there, and tap again.'
      : 'This browser can’t receive alerts. Open darasapp.com in Chrome (Android) or the Home Screen app (iPhone).' };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, sent: 0, message: isIOS()
      ? 'Notifications are off for PrismOS. Open Settings › Notifications › PrismOS, allow them, then tap again.'
      : 'Notifications are blocked for darasapp.com. Allow them in the browser’s site settings (the icon left of the address), then tap again.' };
  }
  const reg = await navigator.serviceWorker.ready;
  const key = b64ToU8(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made under a different key can never receive our pushes.
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
    try { await sub.unsubscribe(); } catch (_) {}
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { error } = await saveSub(userId, sub);
  if (error) return { ok: false, sent: 0, message: 'Couldn’t save this phone: ' + error.message };
  return sendTest();
}

// The finish line: send a real alert and report what actually happened.
export async function sendTest() {
  try {
    const { data, error } = await supabase.functions.invoke('push-send', { body: {
      title: 'Alerts are on ✓', body: 'New-lead alerts and your morning brief will come to this phone.',
      url: 'https://darasapp.com/', tag: PUSH_TEST_TAG } });
    if (error || data?.error) return { ok: false, sent: 0, message: 'The test alert failed to send: ' + (data?.error || error.message) };
    const sent = data?.sent || 0;
    if (sent > 0) return { ok: true, sent, message: `A test alert just went to ${sent === 1 ? 'your phone' : sent + ' devices'}. You’re connected.` };
    return { ok: false, sent: 0, message: data?.note === 'no devices'
      ? 'This phone didn’t save. Tap again; if it repeats, reinstall PrismOS from darasapp.com.'
      : 'Your phone refused the test alert. Remove PrismOS from your Home Screen, reinstall it from darasapp.com, and tap again.' };
  } catch (e) { return { ok: false, sent: 0, message: 'The test alert failed to send: ' + (e.message || e) }; }
}
