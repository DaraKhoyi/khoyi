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

export default quoCall;
