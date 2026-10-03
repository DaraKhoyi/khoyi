// stale_shell.mjs — an app opened on an old saved copy loads the current build.
//
// Dara, 2 Oct 2026, 9:21pm: "The app is not loading. It says it's loading an
// offline older copy from many versions ago. Let the current version load."
// The service worker hands back a saved copy when the page request fails; that
// copy then ran all session. index.html now asks the server which build is
// current the moment it opens. This proves, in a real browser:
//   1. the server names a different build  -> the page reloads ONCE (no loop);
//   2. same, but someone is already typing -> it does NOT reload;
//   3. the server names this build         -> nothing happens.
// BLOCKS. Needs the built app served at SMOKE_URL.
import { chromium } from 'playwright';

const URL_ = process.env.SMOKE_URL || 'http://localhost:4173/';
const problems = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

async function run({ stale, typeFirst }) {
  // serviceWorkers blocked so the route below sees the request; the script under
  // test is the page's own, not the worker's.
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let loads = 0;
  page.on('load', () => { loads++; });
  if (stale) {
    await page.route('**/index.html?boot=*', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/main\.[A-Za-z0-9_-]+\.js/, 'main.NEWERBUILD0.js');
      if (typeFirst) await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });
  }
  if (typeFirst) await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })), 200));
  });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const has = await page.evaluate(() => !!document.querySelector('script[src*="/static/js/main."]')).catch(() => false);
  await ctx.close();
  return { loads, has };
}

try {
  const a = await run({ stale: true, typeFirst: false });
  if (!a.has) problems.push('the built page has no hashed main bundle to compare — the check cannot work');
  if (a.loads !== 2) problems.push(`an old copy should load the current build exactly once; the page loaded ${a.loads} time(s) (1 = it stayed on the old copy, 3+ = it loops)`);
  const b = await run({ stale: true, typeFirst: true });
  if (b.loads !== 1) problems.push(`the page reloaded (${b.loads} loads) while someone was typing — work could be lost`);
  const c = await run({ stale: false, typeFirst: false });
  if (c.loads !== 1) problems.push(`the page reloaded (${c.loads} loads) when it was already the current build`);
} catch (e) { problems.push('could not run: ' + String(e.message || e).slice(0, 160)); }
await browser.close();

if (!problems.length) {
  console.log('==== STALE SHELL: clean — an old saved copy loads the current build once; never over typing; never when already current ====');
  process.exit(0);
}
console.log(`==== STALE SHELL: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
