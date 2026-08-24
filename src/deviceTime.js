// deviceTime — the app follows the device, not a value typed once.
//
// THE PROBLEM. Dara set his timezone at onboarding and it was stored as
// America/New_York. He then flew to Calgary. The DISPLAY was fine — every screen
// renders with toLocaleDateString and no pinned timezone, so times on screen were
// already Calgary time. But the STORED value never changed, so everything computed
// on the server still thought he was in Tampa: the morning brief generated for a
// New York morning, and "today" meant a New York today.
//
// TWO DIFFERENT NEEDS, and conflating them is what caused this:
//
//   DISPLAY must follow the device, always, with no stored value involved. A clock
//   that disagrees with the phone it is running on is simply wrong. This already
//   worked and nothing here changes it.
//
//   SCHEDULING cannot ask the device — pg_cron runs at 3am with no browser open.
//   It needs a stored value, which means the stored value has to be kept honest by
//   the client whenever the client is running.
//
// So: on every app open, compare the device zone to the stored one and correct the
// store if they differ. Cheap, silent, and it means a broker who lands in Calgary
// gets his brief on Calgary time the next morning without touching a setting.
//
// WHY IT UPDATES SILENTLY RATHER THAN ASKING. A prompt on landing — "you appear to
// be in Calgary, update?" — is a question with no wrong answer that still costs
// attention, and someone travelling is the LEAST likely person to want a settings
// dialog. If the answer is always yes, it should not be a question. It is recorded
// so it can be seen, and Settings still lets it be set by hand.
//
// The one case this gets wrong is a phone left on the wrong zone, which corrects
// itself the moment the phone does.
import { supabase } from './dataService';

/** What the DEVICE says, right now. Never cached, never stored. */
export const deviceZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { return null; }
};

/** Today, as the device reckons it. Server "today" can differ by a day mid-flight. */
export const deviceToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Correct the stored zone if the device has moved. Returns the change when one
 * happened, so a caller can mention it once rather than leaving it invisible.
 */
export async function syncTimezone(userId, storedZone) {
  const zone = deviceZone();
  if (!userId || !zone || zone === storedZone) return null;
  try {
    const { error } = await supabase
      .from('user_settings')
      .update({ timezone: zone, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) return null;
    return { from: storedZone || '(unset)', to: zone };
  } catch (_) { return null; }
}
