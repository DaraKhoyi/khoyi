// Automated pre-deploy smoke check.
// Logs in as a throwaway agent, visits every critical view, and fails (exit 1)
// if any view trips the error boundary or throws an uncaught error — catching
// "this view crashes on open" bugs BEFORE they reach agents.
//
// Usage: SMOKE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... node smoke/smoke.mjs
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const VIEWS = (process.env.SMOKE_VIEWS ||
  'dashboard,inbox,contacts,tasks,calendar,quo,email_review,group_message,chief,agentruns,agent_activity,journal,brain,prospecting,settings,documents,my_prism,app_health'
).split(',').map(s => s.trim()).filter(Boolean);

const BOUNDARY = 'This view ran into an error';
const pageErrors = [];
let current = 'boot';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push({ view: current, msg: (e && e.message) || String(e), fatal: true }));

const results = [];
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await page.waitForFunction(() => typeof window.__setView === 'function', { timeout: 35000 });
  await page.waitForTimeout(3000); // let first load + data settle

  for (const view of VIEWS) {
    current = view;
    const before = pageErrors.length;
    try { await page.evaluate((v) => window.__setView(v), view); } catch (_) {}
    await page.waitForTimeout(1800); // allow lazy chunk + effects to run
    const boundary = await page.evaluate((t) => !!(document.body && document.body.innerText.includes(t)), BOUNDARY);
    const errs = pageErrors.slice(before);
    const ok = !boundary && errs.length === 0;
    results.push({ view, ok, boundary, err: errs[0]?.msg });
    console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${view}${boundary ? '   [error boundary]' : ''}${errs[0] ? '   ' + errs[0].msg : ''}`);
  }
} catch (e) {
  console.log(`✗ FATAL during "${current}": ${e.message}`);
  results.push({ view: current, ok: false, err: e.message });
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n==== SMOKE: ${results.length - failed.length}/${results.length} views OK ====`);
if (failed.length) { console.log('FAILED VIEWS: ' + failed.map(r => r.view).join(', ')); process.exit(1); }
process.exit(0);
