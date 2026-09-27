// edge_parse.mjs — does every edge function file even parse?
//
// Found 26 Sep: supabase/functions/property-research/index.ts had not parsed
// since 19 Sep. A comment was placed mid-statement —
//   subjectType: "property", subjectId: null }   // keyed by address ...); } catch (_) {}
// — so everything after "//", including the closing "); } catch", was ignored.
// The deploy failed, the live function stayed on its 1 Aug version, and nothing
// in the gate noticed: the gate built and tested the APP, never the functions.
// Only a manual redeploy a week later found it.
//
// esbuild parses TypeScript in milliseconds with no network and no Deno, so
// this runs everywhere, CI included. It checks SYNTAX only, not types: a
// deploy-time bundle failure is exactly a syntax failure. BLOCKS.
//
// Usage: node smoke/edge_parse.mjs

import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const ROOT = 'supabase/functions';
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(ts|js|mjs|tsx)$/.test(e.name)) files.push(p);
  }
};
walk(ROOT);

const bad = [];
await Promise.all(files.map(async (f) => {
  const src = fs.readFileSync(f, 'utf8');
  const loader = f.endsWith('.tsx') ? 'tsx' : f.endsWith('.ts') ? 'ts' : 'js';
  try {
    await transform(src, { loader, format: 'esm', target: 'es2022', logLevel: 'silent' });
  } catch (e) {
    const m = (e.errors && e.errors[0]) || {};
    bad.push(`${f}:${m.location ? m.location.line + ':' + m.location.column : '?'} — ${m.text || String(e).slice(0, 120)}`);
  }
}));

if (!bad.length) {
  console.log(`==== EDGE PARSE: clean — all ${files.length} edge function files parse ====`);
  process.exit(0);
}
console.log(`==== EDGE PARSE: ${bad.length} file(s) do NOT parse — they cannot deploy ====`);
for (const b of bad.sort()) console.log('  ✗ ' + b);
process.exit(1);
