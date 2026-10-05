// menu_icons.mjs — every entry in the tuning-fork menu has its own picture.
//
// Dara, 5 Oct 2026: "Keep still the great icons, make sure they are all unique
// and illustrative." Looking found two faults a person only sees side by side:
//   • five entries named an icon that did not exist (sun, trophy, coin, health,
//     sparkle). Icon draws nothing for an unknown name, so Money — a top-level
//     entry — had no picture at all, and nothing failed.
//   • 24 icons were shared: sparkles by six entries, chart by seven, users by
//     seven. A picture six things share tells you nothing.
// Holds, for the whole menu (agent, team leader and broker): every icon name
// exists; no two entries with different names share an icon; and no two entries
// use icons that are drawn alike (contacts/users, home/properties). Static. BLOCKS.
import fs from 'node:fs';
const problems = [];
const icons = fs.readFileSync('src/icons.jsx', 'utf8');
const paths = Object.fromEntries([...icons.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\((.*)\),\s*$/gm)].map((m) => [m[1], m[2].replace(/\s+/g, '')]));
const app = fs.readFileSync('src/App.js', 'utf8');
const src = fs.readFileSync('src/menuConfig.js', 'utf8') + app.slice(app.indexOf('const brokerageGroup = {'), app.indexOf('const MENU = buildMenu('));
const by = {};                                   // icon -> Set(labels)
let n = 0;
for (const m of src.matchAll(/label: '([^']+)',((?:(?!label:)[^\n])*?)icon: '([^']+)'/g)) { n++; (by[m[3]] ||= new Set()).add(m[1]); }
if (n < 80) problems.push(`only ${n} menu entries could be read — this check has lost its footing`);
if (/\{ label: '[^']+'(?:(?!icon:|label:)[^\n}])*\}/.test(src)) problems.push('a menu entry has no icon at all');
for (const [icon, labels] of Object.entries(by)) {
  if (!paths[icon]) problems.push(`"${[...labels].join('", "')}" names the icon "${icon}", which does not exist — it draws nothing`);
  for (const same of [['Agent Roster', 'Team Roster'], ['Teams', 'Team']]) if (same.every((l) => labels.has(l))) labels.delete(same[1]);   // one screen, named by role; never both shown
  if (labels.size > 1) problems.push(`"${icon}" is shared by ${[...labels].map((l) => `"${l}"`).join(' and ')}`);
}
const used = Object.keys(by).filter((k) => paths[k]);
for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++)
  if (paths[used[i]] === paths[used[j]]) problems.push(`"${used[i]}" and "${used[j]}" are the same drawing under two names`);
// Drawn alike though not identical — a person cannot tell these apart at menu size.
for (const [a, b] of [['contacts', 'users'], ['home', 'properties'], ['prospecting', 'target'], ['chat', 'sparkles'], ['library', 'playbooks'], ['dashboard', 'grid'], ['briefcase', 'deals'], ['investments', 'arrowUp']])
  if (by[a] && by[b] && !(a === 'investments' && b === 'arrowUp')) problems.push(`"${a}" and "${b}" look alike; the menu uses both ("${[...by[a]][0]}" and "${[...by[b]][0]}")`);
if (problems.length) { console.error(`\n==== MENU ICONS: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log(`==== MENU ICONS: clean — ${n} entries, each with its own picture, every one drawn ====`);
