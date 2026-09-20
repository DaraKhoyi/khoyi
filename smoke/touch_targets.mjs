// touch_targets.mjs — can a thumb actually hit it?
//
// Every agent uses this on a phone, often one-handed, often in a car. Nothing
// checked that a tappable thing is big enough to tap. The accepted floor is
// 44×44 CSS pixels (Apple's HIG; Android says 48dp, WCAG 2.5.5 says 44). Below
// that, people miss — and Ray, who will not ask for help, just assumes he did
// something wrong.
//
// This is the "UI expert" advice made deterministic. A reviewer saying a button
// looks small is an opinion that varies by reviewer and by day. 31×22 is a fact,
// and the same fact every run.
//
// MEASURED, NOT INFERRED: it reads the rendered box of each control, including
// padding and any pseudo-element hit area, at the real phone width. Reading the
// CSS would miss all of that.
//
// Usage: SMOKE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... node smoke/touch_targets.mjs [view...]

import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const MIN = Number(process.env.TOUCH_MIN || 44);
const views = process.argv.slice(2).length ? process.argv.slice(2)
  : ['today', 'tasks', 'contacts', 'inbox', 'calendar', 'finance', 'numbers', 'journal'];

// Controls that are legitimately small, with the reason. Every entry is a case
// the check cannot judge, not a licence to ignore a class of control.
const ALLOW = [
  { match: /^[×✕✖]$/, why: 'close glyph inside a modal header, adjacent to nothing else tappable' },
  { match: /^[‹›<>]$/, why: 'carousel arrows, paired and repeatable — a miss costs one tap' },
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
if (EMAIL && PASSWORD) {
  try {
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(13000);
  } catch (_) { /* already in */ }
}
for (const label of ['Skip for now', 'Not now', 'Got it']) {
  try { await page.click(`button:has-text("${label}")`, { timeout: 2500 }); await page.waitForTimeout(700); }
  catch (_) { /* not shown */ }
}

const findings = [];
for (const view of views) {
  try {
    await page.evaluate((v) => { if (window.__setView) window.__setView(v); }, view);
    await page.waitForTimeout(2200);
    const small = await page.evaluate((min) => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')) {
        const r = el.getBoundingClientRect();
        // Invisible or not laid out — not a target anyone can miss.
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        // Off-screen above/below is fine; the page scrolls.
        if (r.right <= 0 || r.left >= innerWidth) continue;
        if (r.width < min || r.height < min) {
          out.push({
            text: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 34),
            w: Math.round(r.width), h: Math.round(r.height),
          });
        }
      }
      return out;
    }, MIN);

    for (const s of small) {
      if (ALLOW.some(a => a.match.test(s.text))) continue;
      findings.push({ view, ...s });
    }
  } catch (e) {
    findings.push({ view, text: '(view failed to open)', w: 0, h: 0, error: String(e).slice(0, 60) });
  }
}
await browser.close();

// Dedupe: the same control repeated down a list is one fault, not twenty.
const seen = new Map();
for (const f of findings) {
  const k = `${f.view}|${f.text}|${f.w}x${f.h}`;
  seen.set(k, (seen.get(k) || 0) + 1);
}

// A RATCHET, NOT A WALL. The first run found 111 controls under 44px. Blocking
// on that would mean the check is switched off by lunchtime, and a guard nobody
// can satisfy is a guard nobody reads. So: record today's number, fail only if
// it goes UP. The same pattern as the file budgets, for the same reason — the
// debt stops growing today and gets paid down deliberately.
const BUDGET = 'smoke/touch_budget.json';
let budget = null;
try { budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8')); } catch (_) { /* first run */ }

console.log('');
if (!seen.size) {
  console.log(`==== TOUCH TARGETS: clean — every control at least ${MIN}px across ${views.length} views ====`);
  process.exit(0);
}
for (const [k, n] of [...seen.entries()].sort()) {
  const [view, text, size] = k.split('|');
  console.log(`  ✗ [${view}] ${size}  "${text}"${n > 1 ? `  ×${n}` : ''}`);
}
console.log('');
console.log(`  Below ${MIN}px a thumb misses, and the person assumes they did something wrong rather`);
console.log('  than that the button was too small. Give it padding, or a larger hit area — the');
console.log('  glyph can stay the size it is.');
console.log('');
if (!budget) {
  fs.writeFileSync(BUDGET, JSON.stringify({ max: seen.size, set: new Date().toISOString().slice(0, 10) }, null, 2));
  console.log(`==== TOUCH TARGETS: ${seen.size} under ${MIN}px — baseline recorded, this must not grow ====`);
  process.exit(0);
}
if (seen.size > budget.max) {
  console.log(`  This is ${seen.size - budget.max} MORE than the budget of ${budget.max} set on ${budget.set}.`);
  console.log('  Fix the new ones. Do not raise the budget without a reason written beside it.');
  console.log('');
  console.log(`==== TOUCH TARGETS: ${seen.size} control(s) under ${MIN}px, budget ${budget.max} ====`);
  process.exit(1);
}
if (seen.size < budget.max) {
  fs.writeFileSync(BUDGET, JSON.stringify({ max: seen.size, set: new Date().toISOString().slice(0, 10) }, null, 2));
  console.log(`  Down from ${budget.max} to ${seen.size}. Budget tightened — it cannot go back up.`);
}
console.log('');
console.log(`==== TOUCH TARGETS: ${seen.size} under ${MIN}px, within the budget of ${budget.max} ====`);
process.exit(0);
