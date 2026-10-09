// apply-auth-config.mjs — make the live Supabase Auth settings match
// supabase/auth-config.json (only the keys listed there; "_comment" is ignored).
//
// 8 Oct 2026, security batch 1: turns public sign-up off. Uses the same
// SUPABASE_ACCESS_TOKEN secret as apply-sql and the edge-function deploy.
// Prints only key names and boolean/number values — never secrets.
//   node scripts/apply-auth-config.mjs            apply
//   node scripts/apply-auth-config.mjs --check    report drift, exit 1 if any
import { readFileSync } from 'node:fs';

const REF = process.env.SUPABASE_PROJECT_REF || 'xlgfspnojjgvkuitcoaf';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CHECK = process.argv.includes('--check');
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set'); process.exit(1); }

const want = JSON.parse(readFileSync('supabase/auth-config.json', 'utf8'));
delete want._comment;
for (const [k, v] of Object.entries(want)) {
  if (!['boolean', 'number'].includes(typeof v)) { console.error(`refusing non-boolean/number setting ${k}`); process.exit(1); }
}
const api = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' };

async function current() {
  const r = await fetch(api, { headers: H });
  if (!r.ok) throw new Error(`GET auth config: HTTP ${r.status}`);
  return r.json();
}
const drift = (cur) => Object.fromEntries(Object.entries(want).filter(([k, v]) => cur[k] !== v));

const before = await current();
const d = drift(before);
for (const k of Object.keys(want)) console.log(`${k}: live=${JSON.stringify(before[k])} want=${JSON.stringify(want[k])}`);
if (!Object.keys(d).length) { console.log('Auth settings already match.'); process.exit(0); }
if (CHECK) { console.error('Auth settings drift: ' + Object.keys(d).join(', ')); process.exit(1); }

const r = await fetch(api, { method: 'PATCH', headers: H, body: JSON.stringify(d) });
if (!r.ok) { console.error(`PATCH auth config: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
const after = drift(await current());
if (Object.keys(after).length) { console.error('Still drifting after PATCH: ' + Object.keys(after).join(', ')); process.exit(1); }
console.log('Applied: ' + Object.keys(d).join(', '));
