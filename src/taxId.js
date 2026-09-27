// taxId.js — the one way the app reads or writes any part of a tax ID.
//
// Since 27 Sep 2026 no part of a tax ID lives on the contacts row. Contacts are
// shared (with a team, the brokerage, or every agent), and a last-four and an
// SSN/EIN label on a shared row went wherever the row went. Everything now lives
// in contact_tax_ids:
//   - the full number, encrypted; no app role can SELECT it (reveal_tax_id(),
//     brokerage staff only, every reveal logged);
//   - last4 + tax_id_type, readable only by the contact's current owner and
//     brokerage staff — never through sharing.
// Writes go through set_tax_id(), which checks the caller is signed in and owns
// the contact (or is staff). See supabase/sql/2026-09-27_tax_id_isolation.sql.
import { supabase } from './dataService';

// { last4, tax_id_type } for one contact, or null when nothing is on file (or
// the viewer may not see it — the two are deliberately indistinguishable).
export async function loadTaxId(contactId) {
  if (!contactId) return null;
  const { data } = await supabase.from('contact_tax_ids')
    .select('last4, tax_id_type').eq('contact_id', contactId).maybeSingle();
  return data || null;
}

// Map of contact_id -> { last4, tax_id_type } for many contacts (1099 reports).
export async function loadTaxIds(contactIds) {
  const ids = (contactIds || []).filter(Boolean);
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('contact_tax_ids')
      .select('contact_id, last4, tax_id_type').in('contact_id', ids.slice(i, i + 200));
    for (const r of data || []) out[r.contact_id] = r;
  }
  return out;
}

// value: the full number to store (encrypted server-side), or null to change
// only the type of a number already on file. Returns an error message or null.
export async function saveTaxId(contactId, value, type) {
  if (!contactId || (!value && !type)) return null;
  const { error } = await supabase.rpc('set_tax_id', {
    p_contact: contactId, p_value: value || null, p_type: type || null,
  });
  return error ? (error.message || String(error)) : null;
}
