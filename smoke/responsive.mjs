// Form-factor check. Run alongside the smoke gate whenever layout/CSS changes.
//
// The PWA manifest pinned orientation to "portrait" until v1.04.48, so only one
// shape ever had to work. It is now "any" — every device can rotate, which means
// four shapes have to hold, and the hard one is PHONE LANDSCAPE: the viewport
// becomes very SHORT, not wide, and vertical space is what runs out.
//
// Fails on horizontal overflow (the classic responsive break) or any page error.
//
// Usage:
//   SMOKE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... node smoke/responsive.mjs
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL, PW = process.env.SMOKE_PASSWORD;
const SHOT = process.env.SMOKE_SHOTS || '';

const FORMS = [
  { n: 'tablet-landscape', w: 1280, h: 800,  note: 'Tab S9 + keyboard/mouse' },
  { n: 'tablet-portrait',  w: 800,  h: 1280, note: 'Tab S9 upright' },
  { n: 'phone-landscape',  w: 851,  h: 393,  note: 'short viewport — the hard one' },
  { n: 'phone-portrait',   w: 390,  h: 844,  note: 'baseline' },
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let failed = 0;

for (const f of FORMS) {
  const ctx = await browser.newContext({ viewport: { width: f.w, height: f.h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String((e && e.message) || e)));
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button:has-text("Sign In")');
    await page.waitForFunction(() => typeof window.__setView === 'function', { timeout: 35000 });
    await page.waitForTimeout(2600);

    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      sidebar: (() => { const s = document.querySelector('.sidebar'); if (!s) return 'none';
        const r = s.getBoundingClientRect(); return (r.x >= -1 && r.width > 0) ? 'visible' : 'drawer'; })(),
    }));
    if (SHOT) await page.screenshot({ path: `${SHOT}/${f.n}.png` });

    const overflow = m.scrollW > m.clientW + 1;
    const bad = overflow || errs.length > 0;
    if (bad) failed++;
    console.log(`${bad ? '✗ FAIL' : '✓ PASS'}  ${f.n.padEnd(17)} ${String(f.w + 'x' + f.h).padEnd(9)} sidebar=${m.sidebar.padEnd(7)} ` +
      `h-overflow=${overflow ? `YES (${m.scrollW}>${m.clientW})` : 'no'} errors=${errs.length}   ${f.note}`);
    if (errs.length) errs.slice(0, 2).forEach(e => console.log(`         ${e.slice(0, 110)}`));
  } catch (e) {
    failed++; console.log(`✗ FAIL  ${f.n} — ${String(e.message || e).slice(0, 110)}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n==== RESPONSIVE: ${FORMS.length - failed}/${FORMS.length} form factors OK ====`);
process.exit(failed ? 1 : 0);
