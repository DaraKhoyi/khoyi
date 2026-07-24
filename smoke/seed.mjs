#!/usr/bin/env node
// seed.mjs — give the throwaway smoke account something to render.
//
// The gate has been proving that views MOUNT, on an account with no data. Every
// list renders its empty state, every modal opens blank, and anything that only
// appears once there is something to show is never exercised. That is how the
// Skip bug passed a green gate for a week, and why a large-font layout check on
// an empty account reports 15/15 clean while three real collisions shipped.
//
// Names and titles here are deliberately LONG. Layout breaks on the longest
// realistic string, not the average one — "Bartholomew Fitzgerald-Montgomery III"
// is the test, "Bob Smith" is not.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SEED_USER_ID=<uuid> node smoke/seed.mjs
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const USER = process.env.SEED_USER_ID;
if (!URL || !KEY || !USER) { console.error('seed: need SUPABASE_URL, SUPABASE_SERVICE_KEY, SEED_USER_ID'); process.exit(1); }

const post = async (table, rows) => {
  // PostgREST rejects a batch whose objects have different key sets
  // ("All object keys must match") rather than defaulting the gaps. The first
  // version of this seeder failed on exactly that and reported a clean run
  // against an EMPTY account — a green result that meant nothing.
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  rows = rows.map(r => Object.fromEntries(keys.map(k => [k, k in r ? r[k] : null])));
  const r = await fetch(`${URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { console.error(`seed ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`); return []; }
  return r.json();
};

const iso = (d) => new Date(d).toISOString();
const DAY = 86400000;
const now = Date.now();

const contacts = [
  { name: 'Bartholomew Fitzgerald-Montgomery III', email: 'bartholomew.fitzgerald-montgomery@averylongdomainname.example.com',
    phone: '8135551234', type: 'client', cadence_days: 30,
    last_inbound_at: iso(now - 6 * DAY), last_communication_direction: 'inbound', last_contact_at: iso(now - 6 * DAY),
    company: 'Fitzgerald Montgomery Commercial Holdings LLC', role: 'Managing Director of Acquisitions' },
  { name: 'Ana Sofía Hernández-Villalobos', email: 'ana.sofia@example.com', phone: '8135555678', type: 'lead',
    cadence_days: 14, last_inbound_at: iso(now - 40 * DAY), last_communication_direction: 'inbound', last_contact_at: iso(now - 40 * DAY) },
  { name: 'Jo Ng', email: 'jo@example.com', phone: '8135559012', type: 'our_agent',
    last_outbound_at: iso(now - 2 * DAY), last_communication_direction: 'outbound', last_contact_at: iso(now - 2 * DAY) },
  { name: 'Christopher Vandenberg-Oyelaran', email: 'christopher.v@example.com', phone: '8135553456',
    type: 'vendor', cadence_days: 90, last_contact_at: iso(now - 120 * DAY) },
].map(c => ({ ...c, user_id: USER }));

const madeContacts = await post('contacts', contacts);
const cid = (i) => (madeContacts[i] && madeContacts[i].id) || null;

await post('tasks', [
  { user_id: USER, title: 'Follow up on the Fitzgerald-Montgomery commercial acquisition and confirm the revised closing timeline with counsel',
    priority: 'high', priority_system: 'eisenhower', eisenhower_quadrant: 'A', due_date: new Date(now - DAY).toISOString().slice(0, 10), completed: false, contact_id: cid(0) },
  { user_id: USER, title: 'Send comps', priority: 'medium', priority_system: 'eisenhower', eisenhower_quadrant: 'B',
    due_date: new Date(now).toISOString().slice(0, 10), completed: false },
  { user_id: USER, title: 'Review the quarterly brokerage compliance checklist before the audit', priority: 'low',
    priority_system: 'eisenhower', eisenhower_quadrant: 'C', due_date: new Date(now + 3 * DAY).toISOString().slice(0, 10), completed: false },
  { user_id: USER, title: 'Completed example task', priority: 'medium', priority_system: 'eisenhower',
    eisenhower_quadrant: 'B', completed: true, completed_at: iso(now - DAY) },
]);

await post('events', [
  { user_id: USER, title: 'Listing presentation — Bartholomew Fitzgerald-Montgomery III (Westshore portfolio)',
    start_at: iso(now + 2 * 3600000), end_at: iso(now + 3 * 3600000), contact_id: cid(0), all_day: false },
  { user_id: USER, title: 'Team standup', start_at: iso(now + DAY), end_at: iso(now + DAY + 1800000), all_day: false },
]);

await post('deals', [
  { user_id: USER, name: 'Fitzgerald Montgomery Commercial Holdings — 40,000 SF Westshore acquisition',
    client_name: 'Bartholomew Fitzgerald-Montgomery III', address: '4913 West Laurel Street, Tampa, FL 33607',
    status: 'active', side: 'listing', sale_price: 4250000, commission_pct: 3, gross_commission: 127500 },
]);

await post('journal_entries', [
  { user_id: USER, kind: 'note', source: 'seed', day: new Date(now).toISOString().slice(0, 10), occurred_at: iso(now),
    content: 'Seeded entry so the journal renders with real content rather than its empty state.' },
]);

if (!madeContacts.length) {
  console.error('seed: NO CONTACTS CREATED — the run below would test empty views and prove nothing.');
  process.exit(1);
}
console.log(`seeded: ${madeContacts.length} contacts, plus tasks, events, a deal and a journal entry`);
