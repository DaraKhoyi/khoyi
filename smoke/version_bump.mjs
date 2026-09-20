// version_bump.mjs — did the version actually change?
//
// Why this exists. The version label sat at v1.08.45 across FIVE commits while
// I reported .46, .47, .48 and .49 to Dara. Each bump was written as
// sed "s/v1.08.46/v1.08.47/" — which assumes the file says .46. When it said
// .45, sed matched nothing, changed nothing and exited 0. Nothing failed. The
// code deployed every time; the label never moved.
//
// Dara found it by reading his own phone: "I've only got through .45." The
// consequence was not cosmetic — the version is the ONE thing he uses to tell
// whether my fixes have reached him, so a stuck label made every report of
// mine unverifiable, and several of them were false.
//
// The handoff has warned about exactly this since July: "a sed against
// vX.YY.ZZ silently matches nothing." A warning in a document did not stop it.
// A check that runs does.
//
// Compares src/version.js against the last commit that touched anything in
// src/. If source changed and the version did not, it fails.
//
// Usage: node smoke/version_bump.mjs   (run before committing)

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; } };
const ver = (txt) => (/BUILD_VERSION\s*=\s*'([^']+)'/.exec(txt || '') || [])[1] || null;

const now = ver(fs.readFileSync('src/version.js', 'utf8'));
const before = ver(sh('git show HEAD:src/version.js'));

// Only matters when the app itself is changing. Tooling-only commits (smoke/,
// supabase/functions) do not ship a new build to Dara's phone.
const staged = sh('git diff --cached --name-only') || sh('git diff --name-only');
const appChanged = staged.split('\n').some(f => f.startsWith('src/') && f !== 'src/version.js');

if (!appChanged) {
  console.log(`==== VERSION: no app source changed — ${now} unchanged is correct ====`);
  process.exit(0);
}
if (now === before) {
  console.log('');
  console.log(`  ✗ src/ changed but BUILD_VERSION is still ${now}.`);
  console.log('');
  console.log('  Dara reads the version on his phone to know whether a fix has reached him.');
  console.log('  A label that does not move makes every report unverifiable. Read the current');
  console.log('  value and write the next one explicitly — never sed from an assumed old value.');
  console.log('');
  console.log('==== VERSION: not bumped ====');
  process.exit(1);
}
console.log(`==== VERSION: ${before} -> ${now} ====`);
process.exit(0);
