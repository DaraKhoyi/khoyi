// largefont.mjs — catch the bug that has shipped THREE times.
//
// The hamburger (v1.03.13), the Inbox pills (v1.03.28) and the Edit Task header
// (v1.04.47) all broke the same way: one flex row holding a title plus labelled
// controls, fine at default type and collapsed at Dara's system font, with text
// running underneath other text. Each was caught by a user, not by us. Writing
// the lesson down three times did not work; measuring does.
//
// Renders every view at 1.35x and reports, per view:
//   · horizontal overflow of the document
//   · CLIPPED text — an element whose content is wider than its box with no
//     ellipsis and no wrapping, i.e. words physically cut off
//   · COLLISIONS — two sibling elements whose painted boxes overlap while both
//     contain text, which is what "the title ran under the buttons" looks like
//     to a machine
//
// Deliberately conservative. It ignores anything hidden, positioned, or tiny,
// and only compares SIBLINGS — a badge legitimately sitting on top of an avatar
// is not a bug, and flagging it would train everyone to ignore the output.
import { chromium } from 'playwright';
import { SIGNED_OUT_PROBE, SIGNED_OUT_NOTE } from './session_guard.mjs';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL, PW = process.env.SMOKE_PASSWORD;
const SCALE = Number(process.env.FONT_SCALE || 1.35);
const VIEWS = (process.env.SMOKE_VIEWS ||
  'dashboard,inbox,contacts,tasks,calendar,quo,chief,journal,brain,prospecting,settings,documents,my_prism,myvoice,app_health,listing_presentation,google_contacts,cadence_review,coach,knowledge,unstuck,files,learn,agents,review,numbers,finance,tracker,teams,investor_pipeline,transactions,production,briefing,properties,adoption'
).split(',').map(s => s.trim()).filter(Boolean);

import { PROBE, measure } from './layout_probe.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input[type="email"]', { timeout: 20000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'),  /* signed IN, not merely booted: __setView exists on the sign-in screen too — see session_guard.mjs */ { timeout: 35000 });

// Scale type the way an OS accessibility setting does — root font-size, so
// every rem/em-derived box grows with it.
await page.addStyleTag({ content: `html { font-size: ${Math.round(16 * SCALE)}px !important; }` });

let bad = 0;
console.log(`\nLarge-font layout check — ${Math.round(SCALE * 100)}% type, 390px wide\n`);
for (const view of VIEWS) {
  try {
    await page.evaluate(v => window.__setView(v), view);
    const m = await measure(page);
    const r = m.r;
    if (m.healed) console.log(`  (${view}: a transient during load cleared on re-measure — not reported)`);
    const problems = [];
    if (await page.evaluate(SIGNED_OUT_PROBE).catch(() => false)) problems.push(SIGNED_OUT_NOTE);
    if (r.docOverflow > 2) problems.push(`h-overflow ${r.docOverflow}px`);
    if (r.clippedTotal) problems.push(`${r.clippedTotal} clipped`);
    if (r.collisionsTotal) problems.push(`${r.collisionsTotal} overlapping`);
    if (r.escapedTotal) problems.push(`${r.escapedTotal} off-screen`);
    if (problems.length) {
      bad++;
      console.log(`✗ ${view.padEnd(14)} ${problems.join(', ')}`);
      for (const c of r.clipped) console.log(`      clipped: "${c.text}"  <${c.tag} class="${c.cls}">`);
      for (const c of r.collisions) console.log(`      overlap: "${c.a}" ↔ "${c.b}"  (${c.overlap}px)`);
    for (const c of (r.escaped || [])) console.log(`      off-screen by ${c.over}px: "${c.text}"  <${c.tag} class="${c.cls}">`);
    } else {
      console.log(`✓ ${view.padEnd(14)} clean`);
    }
  } catch (e) {
    bad++; console.log(`✗ ${view.padEnd(14)} probe failed — ${String(e.message || e).slice(0, 400)}`);
  }
}
// ── The listing-presentation EDITOR ───────────────────────────────────────
// The loop above can only reach screens addressable by name. The editor and its
// More-details screen live behind two clicks, so they were never measured — and
// the editor's header is exactly the shape that has shipped broken three times:
// one flex row holding a long title plus a labelled control. Measured here for
// the same reason the Ari shell is smoke-tested: it ships in this build.
// No address is left in the field at the end, so the autosave never fires and
// the run leaves no row behind.
let extra = 0, extraTotal = 0;
const probeStep = async (name) => {
  extraTotal++;
  const m = await measure(page);
  const r = m.r;
  if (m.healed) console.log(`  (${name}: a transient during load cleared on re-measure — not reported)`);
  const problems = [];
  if (r.docOverflow > 2) problems.push(`h-overflow ${r.docOverflow}px`);
  if (r.clippedTotal) problems.push(`${r.clippedTotal} clipped`);
  if (r.collisionsTotal) problems.push(`${r.collisionsTotal} overlapping`);
  if (r.escapedTotal) problems.push(`${r.escapedTotal} off-screen`);
  if (problems.length) {
    extra++;
    console.log(`✗ ${name.padEnd(14)} ${problems.join(', ')}`);
    for (const c of r.clipped) console.log(`      clipped: "${c.text}"  <${c.tag} class="${c.cls}">`);
    for (const c of r.collisions) console.log(`      overlap: "${c.a}" ↔ "${c.b}"  (${c.overlap}px)`);
    for (const c of (r.escaped || [])) console.log(`      off-screen by ${c.over}px: "${c.text}"  <${c.tag} class="${c.cls}">`);
  } else {
    console.log(`✓ ${name.padEnd(14)} clean`);
  }
};
try {
  await page.evaluate(() => window.__setView('listing_presentation'));
  await page.waitForTimeout(1200);
  // A first-run onboarding modal swallows pointer events on a fresh account.
  for (let i = 0; i < 4; i++) {
    if (!(await page.evaluate(() => !!document.querySelector('.modal-overlay')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  // Hide it with CSS, never remove the nodes: ripping React-owned nodes out of
  // the DOM makes React crash later on insertBefore, which looks exactly like a
  // product bug and is not one.
  await page.addStyleTag({ content: '.modal-overlay{display:none !important;}' });
  await page.waitForTimeout(300);
  await page.click('button:has-text("New Listing Presentation")');
  await page.waitForTimeout(1200);
  // The longest realistic address, not the average one — layout breaks on the
  // long string (the same lesson that put long names into smoke/seed.mjs).
  const addr = page.locator('input[placeholder*="4214 W Virginia"]');
  await addr.fill('18430 Coats Street, Spring Hill, FL 34610');
  await probeStep('lp_editor');
  await addr.fill('');                       // keep autosave from writing a row
  await page.click('text=More details');
  await page.waitForTimeout(1200);
  await probeStep('lp_details');
} catch (e) {
  extra++; extraTotal++;
  console.log(`✗ ${'lp_editor'.padEnd(14)} probe failed — ${String(e.message || e).slice(0, 400)}`);
}

await browser.close();
console.log(`\n==== LARGE FONT: ${(VIEWS.length + extraTotal) - (bad + extra)}/${VIEWS.length + extraTotal} views clean ====`);
process.exit((bad + extra) ? 1 : 0);
