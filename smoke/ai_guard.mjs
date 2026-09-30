// ai_guard.mjs — no SSN, tax ID, card or bank number leaves for an AI model.
//
// The Sentinel + the Fiduciary (panel), 30 Sep. supabase/functions/_shared/aiGuard.ts
// wraps fetch for the AI hosts and blanks those numbers in every text field.
//
//   1. STATIC: every edge function that calls an AI host imports aiGuard.ts.
//      A new one that does not fails here.
//   2. KNOWN ANSWERS: each kind of number is removed; phones, ZIP+4, prices,
//      dates, MLS and parcel numbers pass untouched; an image's base64 data is
//      never altered; the JSON stays valid.
//
// Runs without network. BLOCKS.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

// 1. Static.
const AI = /api\.anthropic\.com|api\.openai\.com|api\.voyageai\.com|generativelanguage\.googleapis\.com/;
const GUARD = /import\s+["']\.\.\/_shared\/aiGuard\.ts["']/;
let callers = 0;
for (const d of readdirSync('supabase/functions')) {
  const f = `supabase/functions/${d}/index.ts`;
  if (d.startsWith('_') || !existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  if (!AI.test(s)) continue;
  callers++;
  if (!GUARD.test(s)) problems.push(`${d} calls an AI model without the guard — add: import "../_shared/aiGuard.ts";`);
}
for (const f of readdirSync('supabase/functions/_shared')) {
  if (f === 'aiGuard.ts') continue;
  const s = readFileSync(`supabase/functions/_shared/${f}`, 'utf8');
  if (AI.test(s) && !GUARD.test(s.replace('../_shared/', '../_shared/'))) {
    // shared modules are imported by functions that already carry the guard;
    // still require it so a new importer cannot forget.
    if (!/import\s+["']\.\/aiGuard\.ts["']/.test(s)) problems.push(`_shared/${f} calls an AI model without importing ./aiGuard.ts`);
  }
}

// 2. Known answers (Node 22 strips the TypeScript types).
const probe = `
import { redactText, redactRequestBody } from './supabase/functions/_shared/aiGuard.ts';
const cases = [
  ['SSN is 123-45-6789 for closing', false],
  ['ssn 123 45 6789', false],
  ['Social Security Number: 123456789', false],
  ['Tax ID #987654321', false],
  ['EIN: 12-3456789', false],
  ['card 4111 1111 1111 1111 exp 12/28', false],
  ['Routing number: 021000021 Account #: 1234567890', false],
  ['Call me at 813-310-0773', true],
  ['Wesley Chapel, FL 33543-1234', true],
  ['Listed at $345,000, closing 10/15/2026', true],
  ['MLS# T3512345 parcel 32-26-18-0000-00100-0010', true],
  ['Order number 4111111111111112', true],
  ['123-45-6789', false],
];
const out = cases.map(([s, keep]) => { const r = redactText(s); return { s, keep, t: r.text, ok: keep ? r.text === s : (r.text !== s && !/\\d{3}-\\d{2}-\\d{4}|\\d{9}|4111 1111|021000021|1234567890|3456789/.test(r.text)) }; });
const img = 'iVBORw0KGgo123-45-6789AAAA4111111111111111';
const body = JSON.stringify({ model: 'x', messages: [{ role: 'user', content: [
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } },
  { type: 'text', text: 'Buyer SSN 123-45-6789, phone 813-310-0773' } ] }] });
const rb = redactRequestBody(body);
let parsed = null; try { parsed = JSON.parse(rb.body); } catch {}
console.log(JSON.stringify({ out, imgKept: parsed && parsed.messages[0].content[0].source.data === img,
  textRedacted: parsed && !parsed.messages[0].content[1].text.includes('123-45-6789') && parsed.messages[0].content[1].text.includes('813-310-0773'),
  hits: rb.hits }));
`;
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', probe], { encoding: 'utf8' });
let res = null;
try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { problems.push('could not run the guard: ' + (r.stderr || r.stdout || '').slice(0, 300)); }
if (res) {
  for (const c of res.out) expect(c.ok, c.keep ? `the guard altered ordinary text: "${c.s}" → "${c.t}"` : `the guard let a sensitive number through: "${c.s}" → "${c.t}"`);
  expect(res.imgKept, 'the guard altered an image\'s data');
  expect(res.textRedacted, 'the guard did not clean the text beside an image (or removed the phone number)');
}

if (!problems.length) {
  console.log(`==== AI GUARD: clean — all ${callers} functions that call an AI model carry the guard; SSNs, tax IDs, cards and bank numbers are removed, ordinary numbers and images untouched ====`);
  process.exit(0);
}
console.log(`==== AI GUARD: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
