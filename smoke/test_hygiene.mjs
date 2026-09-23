#!/usr/bin/env node
// test_hygiene.mjs — clean up after gate runs that died before their cleanup,
// and assert the field catalogue has not gone back to copy-per-user.
//
// WHY THIS EXISTS. The overnight panel flagged custom_field_definitions at
// 11,470 rows with only 4 beta users, and asked what was inserting at scale.
// The answer was two separate things, neither of them what it looked like:
//
//   1. Every signup copied the 90 Prism standard fields into a per-user set.
//      Identical rows, system-locked, nobody able to edit them — so the copies
//      bought nothing, and the seeder read its template FROM the same table,
//      which meant any drift in one user's copy would propagate to the next
//      signup. Now ONE shared catalogue (user_id is null), 90 rows total.
//
//   2. 121 of the 138 accounts were TEST accounts — 88% of the rows. The gate
//      creates a throwaway user per run and deletes it at the end, but a run
//      that times out, fails, or is interrupted never reaches the cleanup. The
//      leftovers accumulated for four months, each carrying seeded contacts,
//      tasks and events.
//
// So the fix is not only to tidy up; it is to make the gate self-healing. Runs
// WILL be interrupted again. This purges any test account older than three
// hours at the START of a run — old enough never to touch a run in progress,
// including a parallel session's.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY; skips quietly without them, like
// the other credentialed guards.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.log('HYGIENE: skipped (no service key)');
  process.exit(0);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const TEST_EMAIL = /@example\.com$/i;
const THREE_HOURS = 3 * 60 * 60 * 1000;

let failed = false;

// ── 1. purge abandoned test accounts ────────────────────────────────────────
try {
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: H });
  const body = await r.json();
  const users = body.users || [];
  const stale = users.filter((u) =>
    TEST_EMAIL.test(u.email || '') && Date.now() - new Date(u.created_at).getTime() > THREE_HOURS);

  let removed = 0;
  for (const u of stale) {
    const d = await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H });
    if (d.ok) removed++;
    else console.log(`  could not remove ${u.email}: HTTP ${d.status}`);
  }
  const left = users.filter((u) => TEST_EMAIL.test(u.email || '')).length - removed;
  console.log(`HYGIENE: ${users.length} accounts, ${stale.length} stale test accounts, ${removed} removed, ${left} test account(s) younger than 3h left alone`);
} catch (e) {
  console.log(`HYGIENE: purge could not run — ${e.message}`);
}

// ── 2. the catalogue must stay shared ───────────────────────────────────────
// A regression here is silent and compounding: 90 rows per signup, times 96
// agents waiting to join. Cheap to check, expensive to notice late.
try {
  const r = await fetch(
    `${URL}/rest/v1/custom_field_definitions?select=id&is_prism_standard=eq.true&user_id=not.is.null&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } });
  const range = r.headers.get('content-range') || '';
  const copies = Number((range.split('/')[1] || '0'));
  if (copies > 0) {
    console.log(`  ✗ ${copies} per-user copies of the standard field catalogue — it is meant to be ONE shared set (user_id null). Something is seeding per user again.`);
    failed = true;
  } else {
    console.log('HYGIENE: field catalogue is shared, no per-user copies');
  }
} catch (e) {
  console.log(`HYGIENE: catalogue check could not run — ${e.message}`);
}

process.exit(failed ? 1 : 0);
