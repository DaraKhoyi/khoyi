// no_forced_update.mjs — a new version never reloads the app by itself.
//
// Dara, 28 Sep 2026: "I was just working on saving a note … when PrismOS decided
// to update the app and I lost my work. Do not automatically implement updates."
// Three separate pieces of code each used to reload a running app when a new
// version was deployed. Each is pinned here so none can creep back:
//
//   1. public/sw.js — a new service worker must not skipWaiting() on install;
//      it waits until the person taps Update (the SKIP_WAITING message).
//   2. index.html — 'controllerchange' reloads only when the person asked
//      (window.__prismUpdateRequested).
//   3. src/App.js — a screen whose code fails to load must not reload the page;
//      it retries, then shows a card with a Refresh button.
//   4. deploy.yml — old build files stay published (keep_files), so a phone on
//      the previous version can still open its screens.
//   5. src/UpdateBanner.jsx — the banner exists, is mounted, and checks for
//      unsaved work before updating.
//
// Static; runs in CI too. BLOCKS.

import { readFileSync } from 'node:fs';

const problems = [];
const read = (f) => readFileSync(f, 'utf8');
const code = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');   // ignore comment lines

const sw = code(read('public/sw.js'));
const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'"));
if (/skipWaiting\s*\(/.test(install)) problems.push('public/sw.js: the install handler calls skipWaiting() — a new version would take over by itself');
if (!/SKIP_WAITING[\s\S]{0,80}skipWaiting\s*\(/.test(sw)) problems.push('public/sw.js: the SKIP_WAITING message no longer activates the new version (Update would do nothing)');

const html = read('index.html');
const ccAt = html.indexOf("addEventListener('controllerchange'");
const cc = ccAt < 0 ? '' : html.slice(ccAt, ccAt + 400);
if (!/__prismUpdateRequested/.test(cc)) problems.push("index.html: 'controllerchange' reloads without checking window.__prismUpdateRequested");

// 6. A COLD START on an old saved copy loads the current build — once, and never
//    over someone's typing (2 Oct: a moment of bad signal opened the app "many
//    versions ago" and it stayed there). Proven live by smoke/stale_shell.mjs.
const bootAt = html.indexOf('__staleShellReload');
const boot = bootAt < 0 ? '' : html.slice(html.lastIndexOf('<script>', bootAt), html.indexOf('</script>', bootAt));
if (!boot) problems.push('index.html: an app opened on an old saved copy no longer loads the current build');
else {
  if (!/if \(typed \|\| Date\.now\(\) - t0 > 8000\) return;/.test(boot)) problems.push('index.html: the cold-start refresh can reload over someone who is typing, or long after the app opened');
  if (!/sessionStorage\.getItem\(KEY\) === n\[1\]\) return;/.test(boot)) problems.push('index.html: the cold-start refresh can loop (no once-per-build guard)');
}
const swAll = read('public/sw.js');
if (!/c\.put\('\/index\.html', copy\)/.test(swAll)) problems.push('public/sw.js: a successful page load no longer replaces the saved copy — the offline fallback goes stale again');
if (!/caches\.open\(VERSION\)\.then\(\(c\) => c\.match\(key\)\)/.test(swAll)) problems.push("public/sw.js: the offline fallback no longer reads this worker's own cache first (the oldest cache would answer)");

const app = read('src/App.js');
const lazy = code(app.slice(app.indexOf('function lazyWithReload'), app.indexOf('function lazyWithReload') + 2500));
if (/(?<!onClick:\s*\(\)\s*=>\s*)window\.location\.reload\(\)/.test(lazy.replace(/onClick:\s*\(\)\s*=>\s*window\.location\.reload\(\)/g, ''))) {
  problems.push('src/App.js lazyWithReload: reloads the page by itself when a screen fails to load');
}
if (!/import UpdateBanner from '\.\/UpdateBanner'/.test(app) || !/<UpdateBanner\s*\/>/.test(app)) problems.push('src/App.js: UpdateBanner is not mounted — nobody would be told about a new version');

const deploy = read('.github/workflows/deploy.yml');
if (!/keep_files:\s*true/.test(deploy)) problems.push('deploy.yml: gh-pages publish deletes old build files (keep_files: true missing)');

const banner = read('src/UpdateBanner.jsx');
if (!/workInProgress\(\)/.test(banner) || !/confirmDialog/.test(banner)) problems.push('src/UpdateBanner.jsx: Update no longer checks for unsaved work first');
if (!/__prismUpdateRequested\s*=\s*true/.test(banner)) problems.push('src/UpdateBanner.jsx: Update does not mark the reload as requested');

if (!problems.length) {
  console.log('==== NO FORCED UPDATE: clean — new versions wait for the person to tap Update; nothing reloads mid-task ====');
  process.exit(0);
}
console.log(`==== NO FORCED UPDATE: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
