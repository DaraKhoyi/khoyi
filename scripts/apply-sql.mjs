// apply-sql.mjs — apply new supabase/sql files to the live database, once each.
//
// Until 1 Oct 2026 every SQL change was pasted in by hand with a personal token,
// so a fix could be pushed and deployed while its database half sat unapplied.
// Now: on push to main, any file in supabase/sql named 2026-10-01 or later that
// is not yet in public._applied_sql is run, in name order, and recorded. Files
// before that date were all applied by hand and are never re-run here.
//
// Rules:
//   * ONCE per file. A file that changes after it was applied is NOT re-run —
//     write a new file instead (old files hold one-time data fixes). The run
//     prints a warning so nobody thinks the edit shipped.
//   * In a transaction unless the file manages its own (begin;/commit;), so a
//     failing file leaves nothing half-applied. The first failure stops the run.
//   * Uses SUPABASE_ACCESS_TOKEN — the same secret the edge-function deploy uses.
import { readFileSync, readdirSync } from 'node:fs';
import crypto from 'node:crypto';

const REF = process.env.SUPABASE_PROJECT_REF || 'xlgfspnojjgvkuitcoaf';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FIRST = '2026-10-01';
const DIR = 'supabase/sql';
const DRY = process.argv.includes('--dry-run');

if (!TOKEN && !DRY) { console.error('SUPABASE_ACCESS_TOKEN is not set'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (!r.ok || !Array.isArray(j)) throw new Error(`HTTP ${r.status}: ${String(typeof j === 'string' ? j : JSON.stringify(j)).slice(0, 600)}`);
  return j;
}
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.slice(0, 10) >= FIRST).sort();
const hash = (f) => crypto.createHash('sha256').update(readFileSync(`${DIR}/${f}`)).digest('hex');

if (DRY) { console.log('Would consider:', files.join(', ') || '(none)'); process.exit(0); }

await q(`create table if not exists public._applied_sql (
  file text primary key, sha256 text not null, applied_at timestamptz not null default now(), commit_sha text);
alter table public._applied_sql enable row level security;
revoke all on public._applied_sql from anon, authenticated;`);

const done = new Map((await q('select file, sha256 from public._applied_sql')).map((r) => [r.file, r.sha256]));
let applied = 0;
for (const f of files) {
  const h = hash(f);
  if (done.has(f)) {
    if (done.get(f) !== h) console.log(`::warning::${f} changed after it was applied on the database; edits are NOT re-run. Put the change in a new file.`);
    continue;
  }
  const body = readFileSync(`${DIR}/${f}`, 'utf8');
  const ownTxn = /^\s*begin\s*;/im.test(body);
  const record = `insert into public._applied_sql(file, sha256, commit_sha) values (${lit(f)}, ${lit(h)}, ${lit(process.env.GITHUB_SHA || '')});`;
  console.log(`::group::Apply ${f}`);
  try {
    if (ownTxn) { await q(body); await q(record); }
    else await q(`begin;\n${body}\n;\n${record}\ncommit;`);
    console.log(`applied ${f}`); applied++;
  } catch (e) {
    console.log('::endgroup::');
    console.error(`::error::${f} failed — nothing after it was applied.\n${e.message}`);
    process.exit(1);
  }
  console.log('::endgroup::');
}
console.log(applied ? `Applied ${applied} file(s).` : 'Database already up to date.');
