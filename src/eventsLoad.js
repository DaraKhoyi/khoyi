// eventsLoad.js — the ONE way the app reads a person's calendar from the database.
//
// Two faults, both found 6 Oct 2026 while looking into Josh's booking report:
//
//   1. The database hands back at most 1,000 rows per request. Four places
//      re-read the calendar with no window and no paging, oldest first. For
//      anyone with more than 1,000 events (Dara has 1,213) the newest ones
//      silently fell off the screen after every sync, refresh or task delete,
//      until the app was reloaded.
//   2. A repeating event is stored once, on the date it FIRST happened. The
//      opening load asked only for the last 180 days, so a weekly meeting or a
//      birthday that began before that was missing until something re-read
//      the calendar (and then fault 1 took other events away).
//
// So: every repeating event regardless of when it began, plus every single
// event from 180 days back to 540 days ahead, read in pages until there are no
// more. Returns { data, error } like supabase-js.
import { supabase } from './dataService';

const PAGE = 1000;
export const eventsWindow = (now = new Date()) => ({
  lower: new Date(now.getTime() - 180 * 86400000).toISOString(),
  upper: new Date(now.getTime() + 540 * 86400000).toISOString(),
});

async function pages(build) {
  const all = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await build().order('start_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}

export async function loadEvents() {
  const { lower, upper } = eventsWindow();
  const [once, repeating] = await Promise.all([
    pages(() => supabase.from('events').select('*').is('recur_freq', null).gte('start_at', lower).lte('start_at', upper)),
    pages(() => supabase.from('events').select('*').not('recur_freq', 'is', null).lte('start_at', upper)),
  ]);
  if (once.error || repeating.error) return { data: null, error: once.error || repeating.error };
  const data = [...once.data, ...repeating.data].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  return { data, error: null };
}
