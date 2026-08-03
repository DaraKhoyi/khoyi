// Ad-hoc visual render of the Listing Presentation editor at iPhone width.
// Not part of the gate. Usage: SMOKE_EMAIL=.. SMOKE_PASSWORD=.. node smoke/shot_listing.mjs
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR || '/home/claude/shots';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input[type="email"]', { timeout: 20000 });
await page.fill('input[type="email"]', process.env.SMOKE_EMAIL);
await page.fill('input[type="password"]', process.env.SMOKE_PASSWORD);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(() => typeof window.__setView === 'function', { timeout: 35000 });
await page.waitForTimeout(2500);

// dismiss any onboarding / profile modal blocking the view
for (let i = 0; i < 6; i++) {
  const open = await page.evaluate(() => !!document.querySelector('.modal-overlay'));
  if (!open) break;
  await page.keyboard.press('Escape');
  for (const t of ['Skip', 'Later', 'Close', 'Not now', 'Done']) {
    const b = page.locator(`.modal-overlay button:has-text("${t}")`).first();
    if (await b.count()) { try { await b.click({ timeout: 1500 }); } catch (_) {} }
  }
  await page.waitForTimeout(600);
}
await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(n => n.remove()); });
await page.waitForTimeout(400);

await page.evaluate(() => window.__setView('listing_presentation'));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/01-list.png`, fullPage: false });

await page.click('button:has-text("New Listing Presentation")');
await page.waitForTimeout(1500);
await page.evaluate(() => { window.scrollTo(0,0); document.querySelectorAll('*').forEach(n=>{ if(n.scrollTop) n.scrollTop=0; }); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/00-editor-empty.png` });
const box = await page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const hdr = document.querySelector('header') || document.querySelector('[class*="app-header"]');
  const back = Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('\u2190'));
  const r = e => { if(!e) return null; const b=e.getBoundingClientRect(); return {t:Math.round(b.top),b:Math.round(b.bottom),l:Math.round(b.left),r:Math.round(b.right)}; };
  return { h1: r(h1), header: r(hdr), back: r(back), h1text: h1 && h1.textContent, scrollY: window.scrollY };
});
console.log('MEASURE', JSON.stringify(box));
// give it an address + a comp so the valuation panel renders
await page.fill('input[placeholder*="4214 W Virginia"]', '18430 Coats St, Spring Hill, FL 34610');
await page.fill('input[placeholder="Comp address"]', '18512 Coats St, Spring Hill, FL');
await page.fill('input[placeholder="Sale price"]', '412000');
await page.fill('input[placeholder="GLA (sq ft)"]', '1980');
await page.fill('input[placeholder="The Henderson Family"]', 'The Henderson Family');
await page.waitForTimeout(900);
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+40 && getComputedStyle(n).overflowY.match(/auto|scroll/)); (el||document.scrollingElement).scrollTop=0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-essentials.png` });
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+40 && getComputedStyle(n).overflowY.match(/auto|scroll/)); (el||document.scrollingElement).scrollTop=780; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02b-essentials-scrolled.png` });
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+40 && getComputedStyle(n).overflowY.match(/auto|scroll/)); const t=el||document.scrollingElement; t.scrollTop=t.scrollHeight; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02c-essentials-bottom.png` });

await page.click('text=More details');
await page.waitForTimeout(1200);
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+40 && getComputedStyle(n).overflowY.match(/auto|scroll/)); (el||document.scrollingElement).scrollTop=0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03-more-details.png` });
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+40 && getComputedStyle(n).overflowY.match(/auto|scroll/)); (el||document.scrollingElement).scrollTop=1050; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03b-more-details-2.png` });

await page.click('button:has-text("Back to essentials")');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-back.png`, fullPage: false });

console.log('shots written to', OUT);
await browser.close();
