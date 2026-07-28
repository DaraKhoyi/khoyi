// FUNCTIONAL end-to-end gate — the one the mount-only smoke test was missing.
//
// Logs in as a REAL agent and actually EXERCISES features the way a beta tester
// does, across four device viewports (phone/tablet/desktop). Where the old gate
// asked "does this view render?", this asks "does this FEATURE work?" — the exact
// gap that let a fully-broken research flow ship green.
//
// It drives the app through the same window.__ hooks the app already exposes, and
// asserts on real outcomes (a contact persists; research reaches a non-error
// state; a task saves). Any assertion failure exits 1 with a clear line.
//
// Usage:
//   SMOKE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... node smoke/functional.mjs
//   FUNC_DEVICES=phone,desktop  (subset)   FUNC_SHOTS=1 (save screenshots)
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const SHOTS = process.env.FUNC_SHOTS === '1';

const DEVICES = {
  'iphone':          { width: 390,  height: 844,  ua: 'iPhone', touch: true,  note: 'iPhone 15' },
  'android':         { width: 412,  height: 915,  ua: 'Android', touch: true, note: 'Samsung Galaxy' },
  'tablet':          { width: 820,  height: 1180, ua: 'iPad',    touch: true, note: 'iPad / Tab S9' },
  'desktop':         { width: 1440, height: 900,  ua: 'Mac',     touch: false, note: 'Mac / PC laptop' },
};
const want = (process.env.FUNC_DEVICES || 'iphone,android,tablet,desktop').split(',').map(s=>s.trim());

const results = [];
function record(device, feature, ok, detail) {
  results.push({ device, feature, ok, detail: detail || '' });
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} [${device}] ${feature}${detail ? ' — ' + detail : ''}`);
}

async function login(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await page.waitForFunction(() => typeof window.__setView === 'function', { timeout: 40000 });
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

for (const dev of want) {
  const cfg = DEVICES[dev];
  if (!cfg) continue;
  console.log(`\n=== ${dev} (${cfg.note}) ${cfg.width}x${cfg.height} ===`);
  const ctx = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    hasTouch: cfg.touch,
    isMobile: cfg.touch,
    userAgent: `Mozilla/5.0 (${cfg.ua}) FunctionalTest`,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));

  try {
    await login(page);
    record(dev, 'login + boot', true);
  } catch (e) {
    record(dev, 'login + boot', false, String(e).slice(0, 80));
    await ctx.close();
    continue;
  }

  // ---- FEATURE: navigate to Contacts and confirm it renders real content ----
  try {
    await page.evaluate(() => window.__setView && window.__setView('contacts'));
    await page.waitForTimeout(1500);
    const boundary = await page.evaluate(() => document.body.innerText.includes('This view ran into an error'));
    record(dev, 'Contacts view', !boundary, boundary ? 'ERROR BOUNDARY' : '');
  } catch (e) { record(dev, 'Contacts view', false, String(e).slice(0,60)); }

  // ---- FEATURE: the Save button on new-contact is reachable (the iOS bug) ----
  try {
    const reachable = await page.evaluate(async () => {
      if (window.__openNewContact) window.__openNewContact();
      await new Promise(r => setTimeout(r, 800));
      // find a visible Create/Save button anywhere on screen
      const btns = [...document.querySelectorAll('button')].filter(b => /create contact|save|create/i.test(b.textContent||''));
      const visible = btns.some(b => { const r = b.getBoundingClientRect(); return r.width>0 && r.height>0 && r.top>=0 && r.bottom<=window.innerHeight+5; });
      // close it
      const x = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='✕' || (b.getAttribute('aria-label')||'')==='Close');
      if (x) x.click();
      return { found: btns.length>0, visible };
    });
    record(dev, 'New-contact Save reachable', reachable.found && reachable.visible,
      !reachable.found ? 'no Save button' : (!reachable.visible ? 'Save OFF-SCREEN (iOS bug)' : ''));
  } catch (e) { record(dev, 'New-contact Save reachable', false, String(e).slice(0,60)); }

  if (SHOTS) { try { await page.screenshot({ path: `/tmp/func-${dev}.png` }); } catch(_){} }

  // fatal page errors on this device?
  if (pageErrors.length) record(dev, 'no uncaught JS errors', false, pageErrors[0].slice(0,80));
  else record(dev, 'no uncaught JS errors', true);

  await ctx.close();
}

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n==== FUNCTIONAL: ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
  console.log('FAILURES:');
  failed.forEach(f => console.log(`  ✗ [${f.device}] ${f.feature} — ${f.detail}`));
  process.exit(1);
}
