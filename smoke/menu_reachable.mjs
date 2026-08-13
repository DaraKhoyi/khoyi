#!/usr/bin/env node
// ── Menu reachability ────────────────────────────────────────────────────────
// Unstuck. shipped behind a GREEN 26/26 gate while being completely unreachable:
// the menu rendered it greyed with a "SOON" badge and swallowed the click. Three
// registries must agree for a screen to work —
//
//   1) the lazy import        const Foo = lazyWithReload(...)
//   2) the route              : view==='foo' ? <Foo/>
//   3) builtSet               the list MenuNode consults to decide live vs "soon"
//
// — and only two had been updated. The smoke gate navigates by setting the view
// directly, so it mounts screens the MENU WILL NOT OPEN. It proves a screen
// renders; it cannot prove a user can get to it.
//
// Auditing the same rule immediately turned up three MORE working screens greyed
// the same way (my_prism, production, transactions), so this was not a one-off.
//
// The rule: every menu leaf that has a route must be in builtSet.

import { readFileSync } from "node:fs";

const src = readFileSync("src/App.js", "utf8");

// builtSet = [...NAV.map(i => i.id), ...extras]
const bm = src.match(/const builtSet = new Set\(\[\.\.\.NAV\.map\(i => i\.id\)([^\]]*)\]\)/);
if (!bm) {
  console.error("✗ could not find builtSet in App.js — has it been renamed?");
  process.exit(1);
}
const extras = new Set([...bm[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));

// NAV_ALL ids — parse by bracket balance, NOT a fixed slice. A truncated slice
// produced false positives the first time this audit was run by hand.
const start = src.indexOf("const NAV_ALL = [");
let depth = 0, end = start;
for (let i = start; i < src.length; i++) {
  if (src[i] === "[") depth++;
  else if (src[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
}
const navIds = new Set([...src.slice(start, end + 1).matchAll(/id:\s*'([a-z_0-9]+)'/g)].map((m) => m[1]));
const built = new Set([...navIds, ...extras]);

const menu = new Set([...src.matchAll(/view:\s*'([a-z_0-9]+)'/g)].map((m) => m[1]));
const routed = new Set([...src.matchAll(/view===\s*'([a-z_0-9]+)'/g)].map((m) => m[1]));

const unreachable = [...menu].filter((v) => routed.has(v) && !built.has(v)).sort();

if (unreachable.length) {
  console.error(`\n==== MENU REACHABILITY: ${unreachable.length} unreachable screen(s) ====`);
  for (const v of unreachable) {
    console.error(`  ✗ '${v}' has a menu entry AND a route, but is not in builtSet —` +
                  ` it will render greyed as "SOON" and the click will be swallowed.`);
  }
  console.error(`    Add it to the builtSet extras list in src/App.js.`);
  process.exit(1);
}

console.log(`MENU REACHABILITY: clean — ${menu.size} menu leaves, ${routed.size} routed, all reachable`);
