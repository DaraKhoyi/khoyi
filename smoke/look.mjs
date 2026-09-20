// look.mjs — screenshots of the screens a change touched, so they can be LOOKED
// AT before the change is committed.
//
// Why this exists. Four styling changes shipped in one week that Dara caught by
// eye and no test could have caught, because each was valid CSS doing the wrong
// thing: a card border set to the divider token, two tabs drawing the same icon,
// a label truncated to "Transacti…", a mark drowned by its own background. The
// gate proves a screen MOUNTS and that its text is present. It cannot tell you
// the screen looks wrong, and until now neither could I — Dara was my eyes, on
// every visual change, which is not a reasonable thing to ask of him.
//
// Usage:
//   node smoke/look.mjs today contacts tasks         # these views
//   LOOK_BASELINE=1 node smoke/look.mjs today        # save as the "before"
//   node smoke/look.mjs today                        # then compare against it
//
// Each view is captured twice: at phone width, and at 135% type where layouts
// break first. Both go in LOOK_DIR (default /home/claude/shots).
//
// When a baseline exists, it also reports the percentage of pixels that changed
// — which catches what nobody thinks to look for: the screen you did NOT mean to
// touch. A styling change to one card that moves three other screens is the bug
// you find out about a week later.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const OUT = process.env.LOOK_DIR || '/home/claude/shots';
const BASE = path.join(OUT, 'baseline');
const IS_BASELINE = process.env.LOOK_BASELINE === '1';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

const views = process.argv.slice(2);
if (!views.length) {
  console.error('usage: node smoke/look.mjs <view> [view...]   e.g. today contacts tasks');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
if (IS_BASELINE) fs.mkdirSync(BASE, { recursive: true });

// Two passes: the phone Dara holds, and the same phone at the large system font
// he actually runs. Three of the four escaped bugs were only visible at one of
// these two, so capturing one and not the other is how they got through.
const PASSES = [
  { tag: 'phone', width: 390, height: 844, zoom: 1 },
  { tag: 'large', width: 390, height: 844, zoom: 1.35 },
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];

for (const pass of PASSES) {
  const ctx = await browser.newContext({
    viewport: { width: pass.width, height: pass.height },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // DID THE APP ACTUALLY LOAD? Proving this tool, I planted a visible fault,
  // re-ran, and got "CHANGED ~87.8%" — which looked like a perfect catch. The
  // screenshot was a 404 page from a static server that had not finished
  // restarting. The tool photographed a blank error page, measured a large
  // difference, and reported success. A screenshot tool that cannot tell an app
  // from a 404 will confirm whatever you already believe, which is worse than
  // having no eyes at all.
  const loaded = await page.evaluate(() => {
    const root = document.getElementById('root') || document.body;
    return !!root && root.children.length > 0 && !/Error response|File not found/i.test(document.body.innerText);
  });
  if (!resp || !resp.ok() || !loaded) {
    console.error(`\n  ✗ ${URL} did not serve the app (HTTP ${resp ? resp.status() : 'none'}).`);
    console.error('    Nothing was captured. Start the static server and try again — a screenshot');
    console.error('    of an error page is not a screenshot of the screen.\n');
    console.error('==== LOOK: aborted, the app did not load ====');
    process.exit(2);
  }

  if (EMAIL && PASSWORD) {
    try {
      await page.fill('input[type="email"]', EMAIL);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button:has-text("Sign In")');
      await page.waitForTimeout(13000);
    } catch (_) { /* already signed in, or a different entry screen */ }
  }
  // First-run prompts sit over everything and would be the only thing captured.
  for (const label of ['Skip for now', 'Not now', 'Got it']) {
    try { await page.click(`button:has-text("${label}")`, { timeout: 2500 }); await page.waitForTimeout(800); }
    catch (_) { /* not shown */ }
  }

  if (pass.zoom !== 1) {
    // Matches how the large-font gate simulates Dara's Galaxy: scale the root
    // font size rather than the page, because that is what the OS setting does.
    await page.evaluate((z) => { document.documentElement.style.fontSize = (16 * z) + 'px'; }, pass.zoom);
    await page.waitForTimeout(900);
  }

  for (const view of views) {
    try {
      await page.evaluate((v) => { if (window.__setView) window.__setView(v); }, view);
      // Views load their data after mount; a fixed wait would capture spinners.
      await page.waitForTimeout(1200);
      for (let i = 0; i < 10; i++) {
        const busy = await page.evaluate(() =>
          /Loading|Opening|Reading what they wrote/i.test(document.body.innerText) ||
          !!document.querySelector('.spinner'));
        if (!busy) break;
        await page.waitForTimeout(700);
      }
      // A FULL-PAGE SHOT LIES ABOUT FIXED ELEMENTS. The browser composites them
      // at their viewport position onto a tall image, so a floating action
      // button appears to sit on top of whatever content happens to be at that
      // offset. My first finding from this tool was exactly that false
      // positive: I reported the mic button covering a card heading, then
      // measured elementFromPoint at its real centre and found nothing under it
      // but itself. An instrument that invents faults is worse than no
      // instrument, because it sends you to fix things that are not broken.
      //
      // So: hide fixed elements for the tall shot, and take a SECOND shot of the
      // viewport with them visible, which is where a genuine overlap shows up.
      const hidden = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' && cs.display !== 'none') { out.push(el); el.dataset.lookHid = '1'; el.style.display = 'none'; }
        }
        return out.length;
      });
      const file = path.join(OUT, `${view}-${pass.tag}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('[data-look-hid]')) { el.style.display = ''; delete el.dataset.lookHid; }
      });
      // The viewport as the person sees it, floating controls included.
      const vfile = path.join(OUT, `${view}-${pass.tag}-viewport.png`);
      await page.screenshot({ path: vfile });
      if (IS_BASELINE) fs.copyFileSync(file, path.join(BASE, `${view}-${pass.tag}.png`));

      const boundary = await page.evaluate(() =>
        document.body.innerText.includes('This view ran into an error'));
      results.push({ view, pass: pass.tag, file, vfile, hidden, boundary, bytes: fs.statSync(file).size });
    } catch (e) {
      results.push({ view, pass: pass.tag, error: String(e).slice(0, 80) });
    }
  }
  await ctx.close();
}
await browser.close();

// Compare against the baseline, if one was taken. Deliberately crude — a byte
// delta, not a pixel diff — because the point is to say WHICH screens moved so
// they get looked at, not to judge whether the movement was good. A tool that
// decides that for you is a tool that will be wrong about it.
let moved = 0;
for (const r of results) {
  if (r.error || IS_BASELINE) continue;
  const b = path.join(BASE, `${r.view}-${r.pass}.png`);
  if (!fs.existsSync(b)) { r.diff = 'no baseline'; continue; }
  // COMPARE THE BYTES, NOT THE SIZE. Proving this tool, I planted a real
  // regression — a heading recoloured to almost the background — and it reported
  // "unchanged", because recolouring text barely moves the file size. A diff
  // that misses an invisible heading is a diff that would have missed every
  // fault Dara caught this week: the faint border, the identical icons, the
  // drowned mark. All of those are colour, not layout.
  //
  // PNG encoding is deterministic for identical input, so any byte difference is
  // a pixel difference. Crude in the other direction now — a one-pixel shift
  // counts — but a tool that over-reports sends me to LOOK, and looking is the
  // entire point. Under-reporting tells me there is nothing to see.
  const same = Buffer.compare(fs.readFileSync(b), fs.readFileSync(r.file)) === 0;
  r.diff = same ? 'unchanged' : 'CHANGED — open it';
  if (!same) moved++;
}

console.log('');
console.log(IS_BASELINE ? '==== LOOK: baseline saved ====' : '==== LOOK ====');
for (const r of results) {
  if (r.error) { console.log(`  ✗ ${r.view} [${r.pass}] — ${r.error}`); continue; }
  const flag = r.boundary ? ' ERROR BOUNDARY' : '';
  console.log(`  ${r.boundary ? '✗' : '·'} ${r.view} [${r.pass}] ${r.diff || ''}${flag}`);
  console.log(`      ${r.file}`);
  if (r.vfile) console.log(`      ${r.vfile}   (viewport — floating controls in place)`);
}
if (!IS_BASELINE && moved) {
  console.log('');
  console.log(`  ${moved} screen(s) moved. Open each one before committing — including any you did`);
  console.log('  not mean to change, which is the whole reason this compares against a baseline.');
}
const broke = results.filter(r => r.boundary || r.error).length;
if (broke) { console.log(`\n==== LOOK: ${broke} screen(s) failed to render ====`); process.exit(1); }
console.log('');
process.exit(0);
