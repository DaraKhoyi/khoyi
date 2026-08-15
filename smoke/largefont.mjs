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

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const EMAIL = process.env.SMOKE_EMAIL, PW = process.env.SMOKE_PASSWORD;
const SCALE = Number(process.env.FONT_SCALE || 1.35);
const VIEWS = (process.env.SMOKE_VIEWS ||
  'dashboard,inbox,contacts,tasks,calendar,quo,chief,journal,brain,prospecting,settings,documents,my_prism,myvoice,app_health,listing_presentation,google_contacts,cadence_review,coach,knowledge,unstuck,files,learn,agents,review,numbers,finance,tracker,teams,investor_pipeline,transactions,production,briefing,properties'
).split(',').map(s => s.trim()).filter(Boolean);

const PROBE = `(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const ownText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };

  const clipped = [];
  const collisions = [];
  const escaped = [];

  // Is this element inside something that legitimately puts content off-screen?
  //   - a horizontal scroller (overflow-x auto/scroll) — carousels, chip rows
  //   - a transformed ancestor — the mindset panel parks at translateX(-102%)
  //   - a clipping ancestor that is itself off-screen
  // Walking ancestors is what keeps this check from crying wolf, which is the
  // only reason it is safe to add at all.
  const parkedOffscreen = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
      if (cs.transform && cs.transform !== 'none') return true;
      if (cs.position === 'fixed' || cs.position === 'absolute') return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);

    // CLIPPED: content wider than the box, not allowed to wrap, no ellipsis.
    // overflow:auto/scroll is intentional (a scroller), so it is excluded.
    if (ownText(el) &&
        cs.whiteSpace === 'nowrap' &&
        cs.textOverflow !== 'ellipsis' &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' &&
        el.scrollWidth > el.clientWidth + 2) {
      clipped.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), text: ownText(el).slice(0, 46) });
    }

    // ESCAPED: the box extends past the right edge of the screen. When an
    // ancestor has overflow-x:hidden this does NOT widen the document, so
    // docOverflow stays 0 and the content is simply cut off with no scrollbar
    // and no warning — invisible to every other check here. Found the hard way:
    // a 900px div in a 390px viewport was reported clean.
    if (ownText(el) &&
        cs.position !== 'fixed' && cs.position !== 'absolute' &&
        cs.transform === 'none' &&
        !parkedOffscreen(el)) {
      const r = el.getBoundingClientRect();
      const over = Math.round(r.right - document.documentElement.clientWidth);
      if (over > 8) {
        escaped.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), text: ownText(el).slice(0, 40), over });
      }
    }
  }

  // COLLISIONS between siblings that both paint text.
  // INLINE elements are excluded. Two <strong>s inside one wrapped paragraph
  // have boxes that legitimately overlap across line breaks — flagging that is
  // noise, and a checker that cries wolf is a checker everyone learns to skip.
  // Only block-ish siblings, which are the ones that are supposed to occupy
  // separate space, can genuinely collide.
  const boxes = (parent) => [...parent.children].filter(c => {
    if (!vis(c)) return false;
    const cs = getComputedStyle(c);
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;
    if (cs.display === 'inline') return false;
    return (c.innerText || '').trim().length > 0;
  });
  const flowing = (parent) => {
    // A parent whose own text flows (a paragraph) is not a layout container.
    const cs = getComputedStyle(parent);
    return cs.display === 'inline' || cs.display === 'inline-block' ||
           (cs.display === 'block' && parent.tagName === 'P');
  };
  for (const parent of document.querySelectorAll('body *')) {
    if (flowing(parent)) continue;
    const kids = boxes(parent);
    if (kids.length < 2 || kids.length > 12) continue;
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // Require a MEANINGFUL overlap in both axes — a 1px rounding kiss is not
        // a defect, and neither is a deliberate -2px tuck.
        if (ox > 6 && oy > 6) {
          collisions.push({
            a: (kids[i].innerText || '').trim().slice(0, 34),
            b: (kids[j].innerText || '').trim().slice(0, 34),
            overlap: Math.round(ox) + 'x' + Math.round(oy),
          });
        }
      }
    }
  }

  return {
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: clipped.slice(0, 8),
    clippedTotal: clipped.length,
    collisions: collisions.slice(0, 8),
    collisionsTotal: collisions.length,
    escaped: escaped.slice(0, 8),
    escapedTotal: escaped.length,
  };
})()`;


// ── settling ────────────────────────────────────────────────────────────────
// A fixed 1500ms wait was a guess, and on data-driven screens (Quo especially,
// which lays out around call rows that arrive on their own schedule) the probe
// sometimes fired mid-paint and reported an overlap that healed a moment later.
// A gate that cries wolf trains you to ignore it, which is worse than no gate.
//
// So: wait for the layout to STOP MOVING rather than for a stopwatch. Sample a
// cheap signature of the page; when two consecutive samples match, it has
// settled. Cap it so a screen with a spinner that never stops cannot hang the run.
const SIGNATURE = `(() => {
  const de = document.documentElement;
  const els = document.querySelectorAll('*');
  let h = 0;
  for (let i = 0; i < els.length; i += 7) {           // every 7th box is plenty
    const r = els[i].getBoundingClientRect();
    h = (h * 31 + Math.round(r.top) + Math.round(r.left) * 3 + Math.round(r.width) * 7 + Math.round(r.height) * 11) | 0;
  }
  return [els.length, de.scrollWidth, document.body.scrollHeight, h].join(':');
})()`;

async function settle(page, { maxMs = 6000, step = 350 } = {}) {
  let last = null;
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await page.waitForTimeout(step);
    let sig;
    try { sig = await page.evaluate(SIGNATURE); } catch (_) { return false; }
    if (sig === last) return true;
    last = sig;
  }
  return false;                                        // never settled — measure anyway
}

// Measure once the page is still. If anything is wrong, let it settle again and
// re-measure: a REAL layout break is stable and will report identically, while a
// mid-load artefact disappears. This confirms failures, it does not hide them —
// nothing that survives a second settled reading is ever suppressed.
async function measure(page) {
  await settle(page);
  let r = await page.evaluate(PROBE);
  const badNow = (x) => x.docOverflow > 2 || x.clippedTotal || x.collisionsTotal || x.escapedTotal;
  if (!badNow(r)) return { r, confirmed: false };
  const first = r;
  await settle(page, { maxMs: 4000 });
  r = await page.evaluate(PROBE);
  return { r, confirmed: true, healed: !badNow(r), first };
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input[type="email"]', { timeout: 20000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(() => typeof window.__setView === 'function', { timeout: 35000 });

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
