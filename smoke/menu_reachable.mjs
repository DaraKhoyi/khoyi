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

import { readFileSync, existsSync } from "node:fs";

// App.js holds builtSet and the routes; the MENU itself moved to menuConfig.js.
// Read BOTH — when the menu moved, this guard silently dropped from 53 leaves to
// 14 and would have passed while seeing almost nothing. A guard that stops
// looking is worse than no guard, because it still reports success.
const src = readFileSync("src/App.js", "utf8")
  + "\n" + (existsSync("src/menuConfig.js") ? readFileSync("src/menuConfig.js", "utf8") : "");

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

// ── The reverse check ────────────────────────────────────────────────────────
// The rule above catches a screen listed in the menu but not wired up. It never
// caught the OPPOSITE — a screen fully wired and listed nowhere, which no user
// can reach and no test notices, because the smoke gate navigates by setting the
// view directly.
//
// Right now only two screens qualify and both are deliberate, so this guard
// protects a clean state rather than fixing a mess. That is the point: the audit
// that prompted it CLAIMED nine stranded screens and was wrong — it parsed
// menuConfig.js and missed the second menu defined inside App.js
// (brokerageGroup). A machine reading both files would not have made that
// mistake, which is the argument for having the machine do it every build.
//
// A screen may legitimately have no menu entry, so this is an allowlist rather
// than a ban — but it has to be a DECISION, written down with the reason.
// Read the bar: and views: ARRAYS, not every quoted word in the file. The first
// version of this matched any token, which meant the word 'adoption' sitting in
// a COMMENT counted as being in a room — I removed it from the bar to test the
// guard and it stayed green. A check that cannot fail is worse than no check,
// so comments are stripped first and only the two arrays are read.
const roomsSrc = readFileSync("src/modes.js", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const inRooms = new Set();
for (const m of roomsSrc.matchAll(/(?:bar|views)\s*:\s*\[([\s\S]*?)\]/g)) {
  for (const t of m[1].matchAll(/view:\s*'([a-z_0-9]+)'|'([a-z_0-9]+)'/g)) {
    inRooms.add(t[1] || t[2]);
  }
}

const DELIBERATELY_HIDDEN = new Map([
  ['dashboard', 'The rooms overview. Reached by the logo and the tuning-fork home, ' +
                'not by an entry inside the menu it opens.'],
  ['review', 'Opened from Today\'s call-review cards, which carry the count. A ' +
             'standalone entry would show an empty screen on most days.'],
]);

const stranded = [...routed]
  .filter((v) => !menu.has(v) && !inRooms.has(v) && !DELIBERATELY_HIDDEN.has(v))
  .sort();

if (stranded.length) {
  console.error(`\n==== MENU REACHABILITY: ${stranded.length} screen(s) reachable from nowhere ====`);
  for (const v of stranded) {
    console.error(`  ✗ '${v}' is routed and works, but appears in no menu and no room —` +
                  ` no user can open it.`);
  }
  console.error(`    Add it to a menu group, put it in a room bar, or record it in`);
  console.error(`    DELIBERATELY_HIDDEN in this file WITH THE REASON.`);
  process.exit(1);
}

console.log(`MENU REACHABILITY: clean — ${menu.size} menu leaves, ${routed.size} routed, ` +
            `all reachable; ${DELIBERATELY_HIDDEN.size} hidden by decision`);
