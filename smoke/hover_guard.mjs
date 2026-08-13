#!/usr/bin/env node
// ── iOS single-tap guard ─────────────────────────────────────────────────────
// On iOS Safari, tapping an element whose first tap CHANGES ITS APPEARANCE
// applies a hover state on that tap and only fires the click on the SECOND one.
// Josh reported having to double-tap everywhere on iPhone; the cause was 62
// unguarded :hover rules, including .nav-item and .hamburger — the whole menu.
// 4 of 5 beta agents are on iPhone, so this is close to a total-failure bug.
//
// It was fixed once in v1.06.66. This check exists so it cannot come back: a
// comment at the top of index.css asks people to remember, and this codebase has
// repeatedly shown that remembering does not hold. A failing build does.
//
// TWO RULES:
//   1) every CSS :hover rule sits inside @media (hover: hover) ...
//   2) every inline onMouseEnter/onMouseOver handler is guarded by canHover()
//
// Note: `touch-action: manipulation` does NOT fix this. It fixes the 300ms tap
// DELAY, which is a different bug, and it was already set on .nav-item — which is
// probably why this was believed handled for so long.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const problems = [];

// ── 1. CSS ──────────────────────────────────────────────────────────────────
const CSS = "src/index.css";
if (existsSync(CSS)) {
  const raw = readFileSync(CSS, "utf8");
  // Blank out comments but KEEP the character count, so reported line numbers
  // stay accurate. Without this the walker reads a comment mentioning ":hover"
  // as a selector — the same false-positive that produced phantom dependency
  // cycles during the AccountingViews split.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

  const matchBrace = (s, start) => {
    let d = 0;
    for (let j = start; j < s.length; j++) {
      if (s[j] === "{") d++;
      else if (s[j] === "}" && --d === 0) return j;
    }
    return -1;
  };

  // walk nested blocks, tracking whether we're inside a hover-capability media query
  const walk = (block, offset, guarded) => {
    let i = 0;
    while (i < block.length) {
      const b = block.indexOf("{", i);
      if (b === -1) break;
      const e = matchBrace(block, b);
      if (e === -1) break;
      const sel = block.slice(i, b).trim();
      const body = block.slice(b + 1, e);
      if (sel.startsWith("@")) {
        const isHoverGuard = /hover\s*:\s*hover/.test(sel);
        walk(body, offset + b + 1, guarded || isHoverGuard);
      } else if (sel.includes(":hover") && !guarded) {
        const line = src.slice(0, offset + i).split("\n").length;
        problems.push(
          `${CSS}:${line} — unguarded :hover rule  ${sel.replace(/\s+/g, " ").slice(0, 70)}\n` +
          `    Wrap it: @media (hover: hover) and (pointer: fine) { ${sel.trim()} { ... } }`
        );
      }
      i = e + 1;
    }
  };
  walk(src, 0, false);
}

// ── 2. Inline hover handlers ────────────────────────────────────────────────
const walkDir = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkDir(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
};

for (const file of walkDir("src")) {
  const s = readFileSync(file, "utf8");
  if (!/onMouseEnter|onMouseOver/.test(s)) continue;
  const re = /(onMouseEnter|onMouseOver)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    let d = 0, end = -1;
    for (let j = open; j < s.length; j++) {
      if (s[j] === "{") d++;
      else if (s[j] === "}" && --d === 0) { end = j; break; }
    }
    if (end === -1) continue;
    const attr = s.slice(m.index, end + 1);
    if (!attr.includes("canHover()")) {
      const line = s.slice(0, m.index).split("\n").length;
      problems.push(
        `${file}:${line} — ${m[1]} handler not guarded by canHover()\n` +
        `    On iPhone this costs the user an extra tap. Guard it:\n` +
        `      ${m[1]}={e => { if (!canHover()) return; ...original body... }}\n` +
        `    canHover is exported from src/helpers.js.`
      );
    }
  }
}

if (problems.length) {
  console.error(`\n==== iOS TAP GUARD: ${problems.length} problem(s) ====`);
  for (const p of problems) console.error("  ✗ " + p);
  console.error(
    "\n  Why this fails the build: iOS applies hover on the first tap and clicks on\n" +
    "  the second, so anything unguarded here makes iPhone users tap twice. Most of\n" +
    "  the beta roster is on iPhone.\n"
  );
  process.exit(1);
}
console.log("iOS TAP GUARD: clean — all :hover rules and hover handlers are pointer-gated");
