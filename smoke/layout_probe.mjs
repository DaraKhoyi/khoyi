// layout_probe.mjs — the one measurement of "did the layout break": text cut
// off, text pushed off the screen, siblings painted over each other, sideways
// scroll. Shared by largefont.mjs (every room) and accounting_screens.mjs
// (every accounting screen, on two phones), so the two can never disagree
// about what a broken layout is. Moved here unchanged from largefont.mjs.

export const PROBE = `(() => {
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
    // A sticky bar rides over what scrolls beneath it. That is what it is for, not a collision
    // (found 7 Oct 2026: the books bar over the checkbook, once the page had scrolled).
    if (cs.position === 'sticky') return false;
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
export const SIGNATURE = `(() => {
  const de = document.documentElement;
  const els = document.querySelectorAll('*');
  let h = 0;
  for (let i = 0; i < els.length; i += 7) {           // every 7th box is plenty
    const r = els[i].getBoundingClientRect();
    h = (h * 31 + Math.round(r.top) + Math.round(r.left) * 3 + Math.round(r.width) * 7 + Math.round(r.height) * 11) | 0;
  }
  return [els.length, de.scrollWidth, document.body.scrollHeight, h].join(':');
})()`;

export async function settle(page, { maxMs = 6000, step = 350 } = {}) {
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
export async function measure(page) {
  await settle(page);
  let r = await page.evaluate(PROBE);
  const badNow = (x) => x.docOverflow > 2 || x.clippedTotal || x.collisionsTotal || x.escapedTotal;
  if (!badNow(r)) return { r, confirmed: false };
  const first = r;
  await settle(page, { maxMs: 4000 });
  r = await page.evaluate(PROBE);
  return { r, confirmed: true, healed: !badNow(r), first };
}

