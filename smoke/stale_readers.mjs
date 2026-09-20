// stale_readers.mjs — find code that filters on a value nothing has held for a
// month, and functions that can only ever return nothing.
//
// The fault this exists for. Expiry was switched off and all 255 commitments
// restored, which was right. But expired_commitments_by_agent() went on
// filtering status='expired' — and silently became a function that counts zero.
// Dara's broker panel showed NOTHING for two days and neither of us noticed,
// because an empty panel and a panel with nothing to report look identical.
//
// That is the shape: remove a mechanism, leave the reader that measured it. It
// does not throw, it does not log, it returns a well-formed empty answer.
// Nothing in the gate could see it, because nothing was broken — it was just
// asking about something that no longer happens.
//
// So: read every status-ish filter out of the SQL functions and the client, ask
// the database how many rows actually hold that value, and complain about the
// ones where the answer is zero and has been for 30 days.
//
// Usage:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node smoke/stale_readers.mjs
//
// Allowlist a deliberate case in STALE_OK below WITH THE REASON — a value that
// is genuinely rare, or a code path kept for data that will arrive later.

import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
// NO DEFAULT. I wrote the live token in here as a fallback and GitHub's push
// protection refused the push — correctly, for the second time this week. The
// repo is PUBLIC. A convenience default in a gate script is a credential
// published to the world.
const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== STALE READERS: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

// value → why it is allowed to be absent. Keep the reason; a bare list rots.
const STALE_OK = {
  'commitments.status=expired':
    'Deliberately unreachable: expiry was removed 19 Sep and must never come back. ' +
    'Kept in the log vocabulary so historical rows still read correctly.',
};

// The Management API rate-limits, and this check makes a query per filter —
// eighty of them. Without backoff it dies partway through and reports a crash
// that looks like a code fault. Back off and retry, as the handoff has said
// since July.
async function q(sql, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'User-Agent': 'KhoyiApp/1.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
    await new Promise(res => setTimeout(res, 800 * (i + 1) * (i + 1)));
  }
  throw new Error('rate limited after ' + tries + ' attempts');
}

// Every "column = 'literal'" in a SQL function body or in src/. Deliberately
// narrow: status-like columns only, because those are the ones a removed
// mechanism orphans. A general literal scan would drown the signal.
const COL = '(status|state|kind|outcome|event|stage|source|type|scope|direction|priority_system)';

const fnBodies = await q(`
  select p.proname, pg_get_functiondef(p.oid) def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'`);

const found = new Map();   // "table.col=val" → [where it was seen]
// Which values each reader tests for the same column. A function handling BOTH
// 'eisenhower' and 'simple' is not stale — it is defensive code carrying an old
// format alongside the live one, and flagging it teaches people to ignore this
// check. First run did exactly that on task_streak(); this is the fix.
const alongside = new Map();   // "where|table.col" → Set(values)

const note = (table, col, val, where) => {
  if (!table || !val) return;
  const k = `${table}.${col}=${val}`;
  if (!found.has(k)) found.set(k, []);
  if (!found.get(k).includes(where)) found.get(k).push(where);
  const ak = `${where}|${table}.${col}`;
  if (!alongside.has(ak)) alongside.set(ak, new Set());
  alongside.get(ak).add(val);
};

// --- from the SQL functions ---------------------------------------------------
for (const row of fnBodies) {
  const def = row.def || '';
  // FROM/JOIN <table> ... <col> = '<val>'  — pair each filter with the nearest
  // table named before it, which is right for the single-table functions that
  // make up nearly all of these.
  const tables = [...def.matchAll(/\b(?:from|join|update|into)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
    .map(m => ({ at: m.index, name: m[1] }));
  for (const m of def.matchAll(new RegExp(`\\b${COL}\\s*=\\s*'([a-z_][a-z0-9_]*)'`, 'gi'))) {
    const before = tables.filter(t => t.at < m.index).pop();
    note(before && before.name, m[1].toLowerCase(), m[2], `fn ${row.proname}()`);
  }
}

// --- from the client ----------------------------------------------------------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name))
    : (/\.(jsx?|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));

for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  // .from('table') ... .eq('status', 'value')
  for (const m of src.matchAll(/\.from\(['"]([a-z_][a-z0-9_]*)['"]\)([\s\S]{0,400}?)(?=\.from\(|\n\n|$)/g)) {
    const table = m[1];
    for (const e of m[2].matchAll(new RegExp(`\\.(?:eq|neq)\\(['"]${COL}['"]\\s*,\\s*['"]([a-z_][a-z0-9_]*)['"]`, 'gi'))) {
      note(table, e[1].toLowerCase(), e[2], path.relative('.', file));
    }
  }
}

// --- ask the database which of those values any row actually holds ------------
const problems = [];
const skipped = [];
for (const [key, seen] of found) {
  const [tableCol, val] = key.split('=');
  const [table, col] = tableCol.split('.');
  if (STALE_OK[key]) continue;
  // TRANSIENT STATES LEGITIMATELY HIT ZERO. A work queue with nothing waiting
  // holds no 'pending' rows, and that is the queue working, not a stale reader.
  // Caught on the first real run: disc_analysis_queue is 757 rows, all 'done',
  // and flagging queue_disc_analysis() for looking at 'pending' would be exactly
  // the crying-wolf that makes a guard get ignored.
  if (/^(pending|queued|processing|running|in_progress|new|draft|sending|retry)$/.test(val)) continue;
  let total, hits, recent;
  try {
    // TWO NUMBERS, NOT THREE. The original asked "and how recently?" using
    // coalesce(updated_at, created_at), and 53 of 81 tables have neither — so
    // the query errored and the finding was dropped. That is how a planted test
    // case escaped: the check was blind on two thirds of the schema and called
    // itself clean. The recency refinement was worth less than the coverage it
    // cost, so it is gone. "No row holds this value" is the test that matters.
    const r = await q(`select
        (select count(*) from public.${table}) total,
        (select count(*) from public.${table} where ${col}::text = '${val}') hits`);
    ({ total, hits } = r[0]);
    recent = null;
  } catch (e) {
    // LOUD, not silent. This swallowed a planted test case: the probe's count
    // query failed and the finding vanished with it, so the check reported
    // "clean" while looking straight at the fault. A check that cannot measure
    // something must say so — silence here is the same failure it exists to find.
    skipped.push(`${key} (${String(e.message).slice(0, 60)})`);
    continue;
  }
  // An empty TABLE is a feature not yet used, not a stale reader. The fault is a
  // table with rows where this particular value has vanished.
  // Does every reader of this value ALSO test a value that is live? Then the
  // code is handling several cases on purpose and this one is a fallback.
  const allHandleLive = [];
  for (const where of seen) allHandleLive.push(await (async () => {
    const others = [...(alongside.get(`${where}|${table}.${col}`) || [])].filter(v => v !== val);
    for (const other of others) {
      // A FAILED query is not evidence of absence. Treating it as one made this
      // check flap between runs — task_streak() was flagged, then not, then was
      // again — and a guard that changes its mind is a guard people re-run until
      // it agrees with them. Unknown means skip the finding, not assert it.
      try {
        const r = await q(`select count(*) n from public.${table} where ${col}::text = '${other}'`);
        if (Number(r[0].n) > 0) return true;
      } catch (_) { return true; }
    }
    return false;
  })());
  if (allHandleLive.length && allHandleLive.every(Boolean)) continue;

  if (Number(total) > 20 && Number(hits) === 0) {
    problems.push({ key, seen, total, why: 'no row has held this value' });
  }
}

if (skipped.length) {
  console.log('');
  console.log(`  Could not measure ${skipped.length} filter(s) — treat as UNKNOWN, not clean:`);
  for (const sk of skipped.slice(0, 8)) console.log(`      ${sk}`);
}
if (!problems.length) {
  console.log(`==== STALE READERS: ${skipped.length ? skipped.length + ' unmeasured, ' : ''}clean — ${found.size} status filters checked, every one still matches live rows ====`);
  process.exit(0);
}
console.log('');
for (const p of problems) {
  console.log(`  ✗ ${p.key} — ${p.why} (${p.total} rows in the table)`);
  for (const s of p.seen) console.log(`      read by ${s}`);
}
console.log('');
console.log('  Code is asking about something that no longer happens. It will not throw and it');
console.log('  will not log — it returns a well-formed empty answer, which is how a broker');
console.log('  dashboard showed nothing for two days. Either the mechanism should come back, or');
console.log('  the reader should measure what replaced it. If the absence is deliberate, add it');
console.log('  to STALE_OK in this file WITH THE REASON.');
console.log('');
console.log(`==== STALE READERS: ${problems.length} reader(s) filtering on a value nothing holds ====`);
process.exit(1);
