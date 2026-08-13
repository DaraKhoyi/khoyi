#!/usr/bin/env node
// ── App.js size ratchet ──────────────────────────────────────────────────────
// The "strangle the monolith" refactor drove App.js from 19,539 lines down to a
// thin composition root. This guard makes that gain PERMANENT: App.js may shrink
// or hold, but it can never balloon again. Two rules, both fail the build:
//
//   1) BUDGET: App.js must stay at or under APPJS_BUDGET lines. The budget is a
//      ratchet — whenever App.js legitimately shrinks well below it, lower the
//      budget to lock in the win. It should only ever go DOWN.
//
//   2) NO NEW SCREENS INLINE: App.js must not gain new top-level components
//      beyond a known allow-list. New screens/modals/panels belong in their own
//      file under src/views/ (or a domain module), wired into App.js with a
//      one-line lazy import — never typed directly into the master file.
//
// Why a tool and not just discipline: "write the lesson down" failed repeatedly
// in this codebase (see the large-font history). Measuring is what holds.
//
// To raise the budget on purpose (rare, and it should be a deliberate choice),
// edit APPJS_BUDGET below in the same commit and say why.

import { readFileSync } from "node:fs";

const APPJS = "src/App.js";

// The ceiling. Currently sits a little above the real line count so ordinary
// edits don't trip it; drop it whenever App.js shrinks to lock the gain in.
const APPJS_BUDGET = 7400;

// Root-shell + small glue components that are ALLOWED to live in App.js. This is
// the composition root: the pieces that wire everything together and are not
// themselves feature screens. Adding a NEW name here should be a conscious,
// reviewed decision — the default answer for a new component is a new file.
const ALLOWED_INLINE = new Set([
  "AppMain",          // the root shell — wires routing, session, layout
  "App",              // the exported root
  "ErrorBoundary",    // top-level crash net (if/when added)
]);

const src = readFileSync(APPJS, "utf8");
const lines = src.split("\n");
const n = lines.length;

const problems = [];

// Rule 1 — budget
if (n > APPJS_BUDGET) {
  problems.push(
    `App.js is ${n} lines — over the ${APPJS_BUDGET}-line budget by ${n - APPJS_BUDGET}.\n` +
    `    New feature code belongs in its own file under src/views/ (or a domain module),\n` +
    `    not in App.js. If this growth is genuinely part of the root shell, raise\n` +
    `    APPJS_BUDGET in smoke/appjs_budget.mjs in this same commit and say why.`
  );
}

// Rule 2 — no new top-level components inline beyond the allow-list.
// Match top-level "function Name(" and "const Name = (props)=>" / "= function".
const declRe = /^(?:export\s+)?(?:function\s+([A-Z]\w+)\s*\(|const\s+([A-Z]\w+)\s*=\s*(?:React\.)?(?:memo\(|forwardRef\(|function\b|\([^)]*\)\s*=>|[A-Za-z]))/;
const found = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(declRe);
  if (!m) continue;
  const name = m[1] || m[2];
  // Heuristic: is it a component (returns JSX) rather than a plain const object?
  // We only care about function-style declarations here; a const assigned a
  // lazy(import()) is a wiring line, not an inline component, so skip those.
  if (/=\s*lazy(WithReload)?\s*\(/.test(lines[i])) continue;
  found.push(name);
}
const offenders = found.filter((name) => !ALLOWED_INLINE.has(name));

// We don't hard-fail on the CURRENT set (there are still mid-size components
// mid-migration). Instead we freeze the current set as a baseline and fail only
// when a NAME NOT already present appears — i.e. someone adds a brand-new screen
// straight into App.js. The baseline lives in a sibling file so it's explicit.
let baseline = new Set();
try {
  baseline = new Set(JSON.parse(readFileSync("smoke/appjs_components.json", "utf8")));
} catch {
  // First run: no baseline yet — the runner prints one to adopt.
}

const brandNew = offenders.filter((name) => !baseline.has(name));

if (baseline.size === 0) {
  console.log("APPJS RATCHET: no baseline yet. Adopt the current component set by writing");
  console.log("  smoke/appjs_components.json with this array:");
  console.log("  " + JSON.stringify([...new Set(offenders)].sort()));
} else if (brandNew.length) {
  problems.push(
    `New top-level component(s) added directly to App.js: ${brandNew.join(", ")}.\n` +
    `    New screens/modals/panels go in their own file under src/views/ and are\n` +
    `    wired in with a one-line lazy import. If one of these really is root-shell\n` +
    `    glue, add it to ALLOWED_INLINE (or the baseline) in this same commit.`
  );
}

if (problems.length) {
  console.error("\n==== APPJS RATCHET: FAIL ====");
  for (const p of problems) console.error("  ✗ " + p);
  console.error("");
  process.exit(1);
}

console.log(`APPJS RATCHET: clean — App.js ${n}/${APPJS_BUDGET} lines, no new inline screens.`);
