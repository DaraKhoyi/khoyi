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
  'dashboard,inbox,contacts,tasks,calendar,quo,chief,journal,brain,prospecting,settings,documents,my_prism,myvoice,app_health'
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
  };
})()`;

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
    await page.waitForTimeout(1500);
    const r = await page.evaluate(PROBE);
    const problems = [];
    if (r.docOverflow > 2) problems.push(`h-overflow ${r.docOverflow}px`);
    if (r.clippedTotal) problems.push(`${r.clippedTotal} clipped`);
    if (r.collisionsTotal) problems.push(`${r.collisionsTotal} overlapping`);
    if (problems.length) {
      bad++;
      console.log(`✗ ${view.padEnd(14)} ${problems.join(', ')}`);
      for (const c of r.clipped) console.log(`      clipped: "${c.text}"  <${c.tag} class="${c.cls}">`);
      for (const c of r.collisions) console.log(`      overlap: "${c.a}" ↔ "${c.b}"  (${c.overlap}px)`);
    } else {
      console.log(`✓ ${view.padEnd(14)} clean`);
    }
  } catch (e) {
    bad++; console.log(`✗ ${view.padEnd(14)} probe failed — ${String(e.message || e).slice(0, 80)}`);
  }
}
await browser.close();
console.log(`\n==== LARGE FONT: ${VIEWS.length - bad}/${VIEWS.length} views clean ====`);
process.exit(bad ? 1 : 0);
