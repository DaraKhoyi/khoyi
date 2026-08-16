#!/usr/bin/env node
// ── Mutation-error reporting check ───────────────────────────────────────────
// supabase-js RESOLVES with { error } rather than throwing, so the extremely
// common
//     try { await supabase.from('x').update(...) } catch (_) {}
// never fires and the failure is invisible. With an optimistic UI update in
// front of it the user is told it worked; the truth surfaces days later as
// "my task disappeared".
//
// dataService.js wraps supabase.from() so every failed mutation is reported.
// THIS FILE EXISTS TO PROVE THAT WRAPPER ACTUALLY FIRES. A reporting layer that
// silently does nothing is worse than none, because it looks like coverage —
// and every analyzer written for this codebase was wrong on its first run.
//
// It drives a REAL failing write in a REAL browser against the REAL client, then
// asserts the error reached the console. Nothing is mocked.

import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const reported = [];
page.on('console', (m) => { if (m.type() === 'error' && /\[supabase\]/.test(m.text())) reported.push(m.text()); });

let failed = null;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await page.waitForFunction(() => !!window.__supabase, { timeout: 40000 });

  // A write that is guaranteed to fail: a column that does not exist. The point
  // is the caller DISCARDS the result, exactly like the 247 sites in the app.
  // Capture what the USER is shown, not just the console. Reporting a failure to
  // devtools fixes our blindness; it does not stop an agent walking away thinking
  // their change saved.
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.__notify;
    window.__notify = (msg, kind, action) => { window.__toasts.push({ msg, kind, hasAction: !!action }); if (orig) return orig(msg, kind, action); };
  });

  const outcome = await page.evaluate(async () => {
    try {
      await window.__supabase.from('tasks').update({ __no_such_column__: 1 }).eq('id', '00000000-0000-0000-0000-000000000000');
    } catch (_) { /* swallowed, as the real call sites do */ }
    return 'done';
  });
  if (outcome !== 'done') failed = 'could not run the probe';
  await page.waitForTimeout(1500);

  if (!reported.length) {
    failed = 'a mutation failed and NOTHING was reported — the wrapper in dataService.js is not firing';
  }
  const toasts = await page.evaluate(() => window.__toasts || []);
  const shown = toasts.filter((t) => t.kind === 'error');
  if (!failed && !shown.length) {
    failed = 'the failure was logged but the USER was never told — tellUser() in dataService.js is not firing';
  }
  if (!failed && !shown.some((t) => t.hasAction)) {
    failed = 'the user was told but given no way to fix the screen — the Reload action is missing';
  }
} catch (err) {
  failed = String(err).slice(0, 200);
}
await browser.close();

if (failed) {
  console.error('\n==== MUTATION GUARD: FAILED ====');
  console.error('  ✗ ' + failed);
  process.exit(1);
}
console.log(`MUTATION GUARD: clean — failed writes are reported (${reported.length}) AND surfaced to the user with a Reload action`);
