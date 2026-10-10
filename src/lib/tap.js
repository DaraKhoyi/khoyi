// Counts-only tap tracking (10 Oct 2026, Dara approved). Sends a short slug and
// nothing else: never names, email text, phone numbers or ids. The database
// refuses anything that is not a slug (ui_events CHECK). Fire and forget.
import { supabase } from '../dataService';

const SLUG = /^[a-z0-9_.]{1,48}$/;
export function tap(element, action = 'tap') {
  if (!SLUG.test(element) || !/^[a-z_]{1,20}$/.test(action)) return;
  try { supabase.from('ui_events').insert({ element, action }).then(() => {}, () => {}); } catch (_) {}
}
export const isSlug = (s) => SLUG.test(s);
