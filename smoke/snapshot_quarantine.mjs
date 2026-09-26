// snapshot_quarantine.mjs — no one-off backup tables in the live schema.
//
// Before a risky data fix we snapshot the table first (good). On 21–24 Sep that
// produced ELEVEN such copies, all created in `public` — next to the live
// tables, reachable by any report or schema scan that does not name-exclude
// them. The overnight panel caught one (cfd_backup_20260923, 12,420 rows,
// ranked sixth-largest in the system) and warned a broad financial query could
// silently count a copy alongside the real rows. One of the eleven really was
// financial: txn_date_paid_backup_20260921.
//
// Fixed 26 Sep by moving all eleven to the `archive` schema, which the API does
// not expose and the app roles cannot read. This guard stops the twelfth.
//
// The rule:  snapshots go in archive, never public.
//   create table archive.<table>_<purpose>_<YYYYMMDD> as select * from public.<table> ...;
//
// BLOCKS the gate (exit 1). A snapshot in public is never the right answer, so
// unlike schema_drift there is no "keep it" case to accommodate. A real feature
// table whose name happens to match goes in ALLOW with the reason.
//
// Usage: SUPABASE_PAT=... node smoke/snapshot_quarantine.mjs

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== SNAPSHOT QUARANTINE: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

// Feature tables that look like snapshots but are part of the product.
const ALLOW = {
  profile_research_backups: 'undo store for contact research — used by restore_contact_research / purge_contact_research',
};

// A trailing date stamp, or a snapshot word as its own name segment.
const PATTERN = String.raw`(_20[0-9]{6}$)|((^|_)(backup|backups|bak|snapshot|prereset|preimport|removed|old|copy|tmp|temp)(_|$))`;

const sql = `select c.relname, c.reltuples::bigint est
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and c.relname ~ '${PATTERN}'
  order by c.relname`;

let rows = null;
for (let i = 0; i < 5 && !Array.isArray(rows); i++) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
      body: JSON.stringify({ query: sql }),
    });
    rows = await r.json();
  } catch { rows = null; }
  if (!Array.isArray(rows)) await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
}
if (!Array.isArray(rows)) {
  // Could not ask the database. That is not a pass — say so and fail.
  console.log('==== SNAPSHOT QUARANTINE: FAILED — could not query the database ====');
  console.log(JSON.stringify(rows).slice(0, 300));
  process.exit(1);
}

const bad = rows.filter((r) => !ALLOW[r.relname]);
console.log('==== SNAPSHOT QUARANTINE ====');
for (const r of rows.filter((r) => ALLOW[r.relname])) console.log(`  ✓ allowed    ${r.relname} — ${ALLOW[r.relname]}`);
if (bad.length === 0) {
  console.log('  ✓ no one-off snapshot tables in public');
  process.exit(0);
}
for (const r of bad) console.log(`  ✗ public.${r.relname} (~${r.est < 0 ? '?' : r.est} rows)`);
console.log(`\n${bad.length} snapshot table(s) in the live schema. Move each one out:`);
console.log('  alter table public.<name> set schema archive; revoke all on archive.<name> from anon, authenticated;');
process.exit(1);
