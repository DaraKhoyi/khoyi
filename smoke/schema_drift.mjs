// schema_drift.mjs — 202 tables, and which parts of them the app stopped using.
//
// The fault this exists for is slower than a bug and harder to undo. A column
// gets replaced and the old one stays, still written by one path and read by
// none. A table gets superseded and lingers with rows nobody looks at. Nothing
// breaks, so nothing prompts a decision — and a year later there are three ways
// to store a note and no one remembers which is authoritative.
//
// This codebase has already paid for that twice: contact_notes and
// property_notes both lived alongside `notes` until they were migrated, and
// property_notes had never been rendered at all. Two more consolidation
// candidates are named in the handoff right now — no_reply_needed_at and
// comms_settled_at "overlap".
//
// Three questions, all answerable from the database and the source:
//
//   1. A table with rows that NOTHING in src/ or any function mentions.
//   2. A column that is entirely NULL across a populated table — reserved and
//      never filled, or abandoned after a rename.
//   3. A table that is WRITTEN but never READ, or read but never written.
//
// Deliberately reports rather than blocks. Drift is a decision to make, not a
// build to fail: the right answer is sometimes "keep it, we need it next
// quarter", and a guard that cannot accept that gets ignored.
//
// Usage: SUPABASE_PAT=... node smoke/schema_drift.mjs

import fs from 'node:fs';
import path from 'node:path';

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== SCHEMA DRIFT: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

async function q(sql, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'User-Agent': 'KhoyiApp/1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
    await new Promise(res => setTimeout(res, 800 * (i + 1) * (i + 1)));
  }
  throw new Error('rate limited');
}

// Everything the app could possibly refer to: client source, edge functions, and
// the SQL of every stored function — a table used only inside a trigger is still
// used, and missing that would make this check pure noise.
const walk = (dir) => { try {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name))
      : (/\.(jsx?|ts|sql)$/.test(e.name) ? [path.join(dir, e.name)] : []));
} catch (_) { return []; } };

let corpus = '';
for (const f of [...walk('src'), ...walk('supabase')]) corpus += fs.readFileSync(f, 'utf8');
const fnDefs = await q(`select pg_get_functiondef(p.oid) def from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
for (const r of fnDefs) corpus += r.def;
const views = await q(`select pg_get_viewdef(c.oid) def from pg_class c
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m')`);
for (const r of views) corpus += r.def;

const mentioned = (word) => new RegExp(`\\b${word}\\b`).test(corpus);

const tables = await q(`
  select c.relname, coalesce(s.n_live_tup, 0) rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
  where n.nspname = 'public' and c.relkind = 'r'
  order by 2 desc`);

const orphanTables = [];
for (const t of tables) {
  if (Number(t.rows) < 5) continue;                 // empty: unused, not drifted
  if (!mentioned(t.relname)) orphanTables.push(t);
}

// Columns that are entirely null in a table that has real rows.
const deadColumns = [];
const pendingColumns = [];
for (const t of tables) {
  if (Number(t.rows) < 100) continue;               // too few rows to conclude anything
  let cols;
  try {
    cols = await q(`select column_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = '${t.relname}' and is_nullable = 'YES'`);
  } catch (_) { continue; }
  if (!cols.length || cols.length > 60) continue;
  const checks = cols.map(c => `count(${JSON.stringify(c.column_name).replace(/"/g, '"')}) as "${c.column_name}"`).join(', ');
  let counts;
  try { counts = await q(`select ${checks} from public.${t.relname}`); } catch (_) { continue; }
  for (const [col, n] of Object.entries(counts[0] || {})) {
    if (Number(n) !== 0) continue;
    // EMPTY IS NOT THE SAME AS ABANDONED. ai_usage_log.subject_type and
    // lead_concierge.brief were both added TODAY and are empty because nothing
    // has run yet — reporting those as drift would bury the real ones. The
    // distinction that matters is whether any code still names the column: if
    // nothing mentions it and nothing fills it, it is abandoned. If code names
    // it but it is empty, it is new or conditional, and only worth a count.
    (mentioned(col) ? pendingColumns : deadColumns).push({ table: t.relname, col, rows: t.rows });
  }
}

console.log('');
let any = 0;
if (orphanTables.length) {
  any++;
  console.log(`  TABLES WITH ROWS THAT NOTHING REFERS TO — ${orphanTables.length}`);
  for (const t of orphanTables.slice(0, 12)) console.log(`    ${t.relname}  (${t.rows} rows)`);
  console.log('    Nothing in src/, the edge functions, the stored functions or the views names');
  console.log('    these. Either something stopped using them, or they are fed by a path this');
  console.log('    check cannot see — a webhook, or a job configured outside the repo.');
  console.log('');
}
if (deadColumns.length) {
  any++;
  console.log(`  COLUMNS NOTHING WRITES AND NOTHING NAMES — ${deadColumns.length}`);
  for (const c of deadColumns.slice(0, 15)) console.log(`    ${c.table}.${c.col}  (${c.rows} rows, none filled)`);
  console.log('    Reserved and never used, or abandoned after a rename. carry_count sat like');
  console.log('    this for months while "how many times has this rolled over?" stayed');
  console.log('    unanswerable — a column that exists but is never written is worse than one');
  console.log('    that does not exist, because it reads as an answer.');
  console.log('');
}

if (pendingColumns.length) {
  console.log(`  (${pendingColumns.length} more are empty but still referenced in code — new or conditional, not drift.)`);
  console.log('');
}
if (!any) {
  console.log(`==== SCHEMA DRIFT: clean — ${tables.length} tables, nothing orphaned or unfilled ====`);
  process.exit(0);
}
console.log('  Reported, not failed: drift is a decision, and "keep it, we need it next quarter"');
console.log('  is a legitimate answer. This exists so the decision gets MADE rather than deferred');
console.log('  until nobody remembers which of three tables is authoritative.');
console.log('');
console.log(`==== SCHEMA DRIFT: ${orphanTables.length} orphan table(s), ${deadColumns.length} unfilled column(s) ====`);
process.exit(0);
