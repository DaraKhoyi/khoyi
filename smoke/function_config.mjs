// function_config.mjs — does the repo describe what is actually deployed?
//
// Two faults found 26 Sep, both invisible until something broke:
//
//   1. SEVENTEEN deployed edge functions had no source in this repo at all —
//      including calendar-poll, gmail-discover and scheduled-email-send, which
//      run every few minutes. Nothing here could review or safely fix them.
//      Recovered with `supabase functions download <slug> --use-api`.
//
//   2. THIRTY-ONE functions were live with verify_jwt OFF but absent from
//      supabase/config.toml. `supabase functions deploy` reads config.toml, and
//      an absent entry means verify_jwt = true. So the NEXT deploy of any of
//      them — gmail-sync, night-review, commitment-nudge, the Dropbox and iOS
//      webhooks — would have quietly re-enabled JWT checks and locked out the
//      cron job or webhook that calls it. HANDOFF already warned that cron-called
//      functions need verify_jwt false; the config file just did not say so.
//
// BLOCKS the gate on either. One Management API call; skips without a key.
//
// Usage: SUPABASE_PAT=... node smoke/function_config.mjs

import fs from 'node:fs';

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) {
  console.log('==== FUNCTION CONFIG: skipped — set SUPABASE_PAT to run this check ====');
  process.exit(0);
}

let live = null;
for (let i = 0; i < 5 && !Array.isArray(live); i++) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions`, {
      headers: { Authorization: `Bearer ${PAT}`, 'User-Agent': 'KhoyiApp/1.0' },
    });
    live = r.ok ? await r.json() : null;
  } catch { live = null; }
  if (!Array.isArray(live)) await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
}
if (!Array.isArray(live)) {
  console.log('==== FUNCTION CONFIG: FAILED — could not list deployed functions ====');
  process.exit(1);
}

const toml = fs.readFileSync('supabase/config.toml', 'utf8');
const cfg = {};
for (const m of toml.matchAll(/\[functions\.([a-z0-9_-]+)\]([^[]*)/g)) {
  const v = /verify_jwt\s*=\s*(true|false)/.exec(m[2]);
  if (v) cfg[m[1]] = v[1] === 'true';
}
const dirs = new Set(fs.readdirSync('supabase/functions'));

const noSource = live.filter((f) => !dirs.has(f.slug)).map((f) => f.slug);
const jwtDrift = live
  .filter((f) => (cfg[f.slug] ?? true) !== f.verify_jwt)
  .map((f) => `${f.slug} (live ${f.verify_jwt}, config.toml ${f.slug in cfg ? cfg[f.slug] : 'absent = true'})`);

console.log('==== FUNCTION CONFIG ====');
if (!noSource.length && !jwtDrift.length) {
  console.log(`  ✓ all ${live.length} deployed functions have source here, and every verify_jwt matches config.toml`);
  process.exit(0);
}
if (noSource.length) {
  console.log(`  ✗ ${noSource.length} deployed function(s) with NO source in supabase/functions:`);
  for (const s of noSource) console.log(`      ${s}`);
  console.log('    Recover:  npx supabase functions download <slug> --project-ref ' + REF + ' --use-api');
}
if (jwtDrift.length) {
  console.log(`  ✗ ${jwtDrift.length} function(s) whose next deploy would CHANGE verify_jwt:`);
  for (const s of jwtDrift) console.log(`      ${s}`);
  console.log('    Make config.toml say what is live (unless the live value is the bug).');
}
process.exit(1);
