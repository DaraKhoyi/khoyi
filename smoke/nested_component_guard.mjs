#!/usr/bin/env node
// ── Nested component guard ───────────────────────────────────────────────────
// A component DEFINED INSIDE another component is a brand-new function on every
// render, so React treats it as a different component TYPE and unmounts/remounts
// its entire subtree. When that subtree contains a text input, the caret jumps
// back to position 0 after every keystroke — the user has to reposition the
// cursor to type each letter.
//
// That was a real reported bug: editing a note on a contact's timeline.
// ActivityTimeline defined EntryCard inside itself, EntryCard held the note
// <textarea autoFocus>, and every keystroke changed editBody -> parent re-render
// -> new EntryCard type -> textarea remounted -> autoFocus -> caret 0.
//
// Two legitimate fixes:
//   1. hoist the component to module scope and pass props, or
//   2. if it uses NO hooks, CALL it as a function — {Thing({ x })} — so its
//      output is inlined into the parent's element tree and nothing remounts.
//
// This check only flags the dangerous case: a nested component that is RENDERED
// as <Thing/> AND contains an input/textarea/select. A nested component with no
// form control is untidy but harmless, and is not worth failing a build over.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : (/\.jsx?$/.test(n) && out.push(p));
  }
  return out;
};

// Empty, and that is the point. The original backlog held nine entries; a look-ahead
// window was reporting form controls that merely appeared BELOW one-line arrow
// components. With the extent measured properly only ONE was real —
// DealsView's LineItemEditor, which held two text inputs and would have jumped the
// caret to 0 on every keystroke exactly like the contact note editor did. It is
// fixed; the rest were never bugs. Add an entry here only with a written reason.
const KNOWN = new Set([]);

const problems = [];
const known = [];

for (const file of walk("src")) {
  const raw = readFileSync(file, "utf8");
  // Strip comments first. Without this, a comment that MENTIONS <Thing/> — such as
  // the one explaining this very fix in ActivityTimeline — reads as a render site.
  // Same false-positive class as the phantom dependency cycles and the :hover guard.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
                 .replace(/^[ \t]*\/\/.*$/gm, "");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // indented => nested inside something
    const m = /^\s{2,}(?:const|function)\s+([A-Z]\w+)\s*[=(]/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    const idKey = `${file}:${name}`;
    // skip hook-memoised values and plain style/constant objects
    if (/use(Memo|Callback|Ref|State)\s*\(/.test(lines[i])) continue;
    const head = lines.slice(i, i + 3).join(" ");
    if (!/=>|function/.test(head)) continue;
    // Measure the component's ACTUAL extent by brace balance. A fixed look-ahead
    // window reports any form control that merely appears BELOW a one-line arrow
    // component, which produced three false entries on the original backlog — and
    // a guard with false positives trains people to ignore it.
    let depth = 0, seen = false, end = i;
    for (let k = i; k < lines.length && k < i + 400; k++) {
      for (const ch of lines[k]) { if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--; }
      if (seen && depth <= 0) { end = k; break; }
    }
    const body = lines.slice(i, end + 1).join("\n");
    if (!/<(input|textarea|select)\b/.test(body)) continue;
    // only a problem if it is RENDERED as an element somewhere
    if (!new RegExp(`<${name}[\\s/>]`).test(src)) continue;
    if (KNOWN.has(idKey)) { known.push(idKey); continue; }
    problems.push(
      `${file}:${i + 1} — <${name}/> is defined inside another component and contains a form control.\n` +
      `    React remounts it on every parent render, so the caret jumps to position 0\n` +
      `    after each keystroke. Hoist it to module scope and pass props, or — if it\n` +
      `    uses no hooks — call it as a function: {${name}({ ...props })}`
    );
  }
}

if (problems.length) {
  console.error(`\n==== NESTED COMPONENT GUARD: ${problems.length} problem(s) ====`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
if (known.length) {
  console.log(`NESTED COMPONENT GUARD: clean — no NEW cases. ${known.length} pre-existing on the backlog:`);
  for (const k of known) console.log("    · " + k);
} else {
  console.log("NESTED COMPONENT GUARD: clean — no remount-on-render inputs");
}
