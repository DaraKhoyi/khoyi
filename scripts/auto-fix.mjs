// Supervised auto-fix — runs inside GitHub Actions for ONE crash signature.
// Reads the crash, asks Claude for a precise patch, applies it, builds, runs the
// smoke gate, and deploys to STAGING ONLY. Records the full diff for human review.
// It never touches production. Env required:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY,
//   DEPLOY_PAT, SIGNATURE_ID, FIX_ID, RUN_URL
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, DEPLOY_PAT, SIGNATURE_ID, FIX_ID, RUN_URL } = process.env;
const H = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  return r.ok ? r.json().catch(() => null) : null;
}
async function setFix(patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/crash_fixes?id=eq.${FIX_ID}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
}
function fail(msg) { console.error('AUTO-FIX FAILED:', msg); setFix({ status: 'failed', error: String(msg).slice(0, 1500), run_url: RUN_URL }); process.exit(1); }

const sig = (await db(`crash_signatures?id=eq.${SIGNATURE_ID}&select=*`))?.[0];
if (!sig) fail('signature not found');
await setFix({ status: 'running', run_url: RUN_URL });

// Pull a sample raw error for the stack
const sample = (await db(`client_errors?view=eq.${encodeURIComponent(sig.view || '')}&order=created_at.desc&limit=1&select=stack,component_stack,message`))?.[0] || {};
const stack = sample.stack || '';

// Resolve the target file from the AI area / stack
const hay = `${sig.ai_area || ''}\n${stack}`;
let file = null;
const mViews = hay.match(/src\/views\/([A-Za-z0-9_]+\.jsx)/) || hay.match(/([A-Za-z0-9_]+View\.jsx)/);
if (mViews) file = mViews[0].startsWith('src/') ? mViews[0] : `src/views/${mViews[1]}`;
else if (/App\.js/.test(hay)) file = 'src/App.js';
if (!file || !fs.existsSync(file)) fail(`could not resolve a source file to edit (area="${sig.ai_area}")`);

const lineMatch = hay.match(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)')) || hay.match(/line\s+(\d+)/i);
const src = fs.readFileSync(file, 'utf8').split('\n');
let lo = 0, hi = src.length;
if (lineMatch) { const ln = parseInt(lineMatch[1], 10); lo = Math.max(0, ln - 60); hi = Math.min(src.length, ln + 60); }
else if (src.length > 400) { hi = 400; } // small files: whole; huge files without a line: bail on a slice from top is useless
if (!lineMatch && src.length > 400) fail('no line number to locate the bug in a large file');
const slice = src.slice(lo, hi).map((l, i) => `${lo + i + 1}: ${l}`).join('\n');

let plan;
try {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/propose-patch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-token': process.env.INTERNAL_TOKEN }, body: JSON.stringify({ file, message: sig.message, diagnosis: sig.ai_diagnosis, stack, code_slice: slice }) });
  plan = await r.json();
} catch (e) { fail('patch proposal request failed: ' + e.message); }
if (!plan || !plan.old_str) fail('AI could not propose a safe fix (low confidence)');

const full = fs.readFileSync(file, 'utf8');
const occurrences = full.split(plan.old_str).length - 1;
if (occurrences !== 1) fail(`patch old_str matched ${occurrences} times (need exactly 1) — not applying`);
const patched = full.replace(plan.old_str, plan.new_str);
fs.writeFileSync(file, patched);
const diff = `--- ${file}\n- ${plan.old_str}\n+ ${plan.new_str}`;
await setFix({ file_path: file, diff: diff.slice(0, 4000), explanation: plan.explanation, confidence: plan.confidence });
console.log('Applied patch to', file);

// Build (staging base) + smoke gate + deploy to staging — all via the repo scripts.
try {
  console.log('Building…');
  execSync('rm -rf build node_modules/.vite && GENERATE_SOURCEMAP=false CI=false npx vite build', { stdio: 'inherit', env: process.env });
  console.log('Smoke gate…');
  execSync('bash smoke/run.sh', { stdio: 'inherit', env: process.env });
} catch (e) { fail('build or smoke gate failed — fix not deployed. ' + e.message); }

// Smoke green → finalize staging build (badge, no CNAME) + deploy to the staging repo.
try {
  console.log('Rebuilding for staging…');
  execSync('rm -rf build && GENERATE_SOURCEMAP=false CI=false npx vite build --base=/khoyi-staging/', { stdio: 'inherit', env: process.env });
  fs.rmSync('build/CNAME', { force: true });
  fs.copyFileSync('build/index.html', 'build/404.html');
  const badge = '<div style="position:fixed;bottom:8px;left:8px;z-index:99999;background:#9A8038;color:#0d0f14;font:700 10px system-ui;padding:3px 9px;border-radius:6px">STAGING · AI FIX</div>';
  for (const fn of ['build/index.html', 'build/404.html']) fs.writeFileSync(fn, fs.readFileSync(fn, 'utf8').replace('<body>', '<body>' + badge));
  execSync(`cd build && rm -rf .git && git init -q && git checkout -q -b gh-pages && git config user.email "dara@brokerdara.com" && git config user.name "Auto-fix" && touch .nojekyll && git add -A && git commit -q -m "auto-fix staging ${FIX_ID}" && git push -q -f "https://${DEPLOY_PAT}@github.com/DaraKhoyi/khoyi-staging.git" gh-pages && rm -rf .git`, { stdio: 'inherit' });
} catch (e) { fail('staging deploy failed after green smoke: ' + e.message); }

await setFix({ status: 'staged', smoke_result: 'green (all views OK)', staging_url: 'https://darakhoyi.github.io/khoyi-staging/', error: null, run_url: RUN_URL });
console.log('DONE — fix staged for review at https://darakhoyi.github.io/khoyi-staging/');
