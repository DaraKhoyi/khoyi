// Every glyph named in modes.js must exist in the icon set.
//
// Thirteen names did not — globe, upload, spark, book, doc, up, flow, sun,
// check, cal, people, phone, gear — and 'coin' on top of them. Icon falls back
// to a default star when a name is unknown, silently, so roughly 25 tabs across
// every room rendered the SAME PICTURE. Dara found it by looking at the Money
// room and asking why Add and Blueprint were identical.
//
// A fallback that never complains is how this survived: nothing crashed, nothing
// logged, and the screens looked plausible until someone compared two of them
// side by side. This check is the complaint.

import fs from 'node:fs';

const icons = fs.readFileSync('src/views/ModeBar.jsx', 'utf8');
const modes = fs.readFileSync('src/modes.js', 'utf8');

// ModeBar keeps its OWN glyph table, separate from icons.jsx — that separation
// is exactly what hid this: names that existed in one file rendered a star in
// the other.
const table = icons.slice(icons.indexOf('const glyphs'), icons.indexOf('const Icon'));
const known = new Set([...table.matchAll(/^\s*([a-z_0-9]+):/gm)].map((m) => m[1]));
const used = [...modes.matchAll(/glyph: '([a-z_0-9]+)'/g)].map((m) => m[1]);
const missing = [...new Set(used)].filter((g) => !known.has(g));

// Two tabs in the same bar showing the same icon is the other half of the fault,
// and it is what Dara actually noticed. Catch it directly rather than hoping the
// name check covers it.
const dupes = [];
for (const m of modes.matchAll(/bar:\s*\[([\s\S]*?)\n\s*\]/g)) {
  const block = m[1];
  const glyphs = [...block.matchAll(/glyph: '([a-z_0-9]+)'/g)].map((x) => x[1]);
  const seen = new Set(), clash = new Set();
  for (const g of glyphs) { if (seen.has(g)) clash.add(g); seen.add(g); }
  if (clash.size) dupes.push([...clash].join(', '));
}

if (missing.length || dupes.length) {
  if (missing.length) {
    console.error(`  ✗ ${missing.length} glyph name(s) have no icon and will render the default star:`);
    console.error(`    ${missing.join(', ')}`);
  }
  for (const d of dupes) console.error(`  ✗ a room bar repeats the same icon: ${d}`);
  console.error('\n    Pick a name that exists in src/icons.jsx. Two tabs with one picture is');
  console.error('    a tab bar that cannot be read at a glance, which is the whole job of one.\n');
  console.error('==== ICON CHECK: failed ====');
  process.exit(1);
}

console.log(`==== ICON CHECK: clean — ${new Set(used).size} distinct glyphs, all present, no bar repeats ====`);
