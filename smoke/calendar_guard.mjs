// calendar_guard.mjs — the day can be scrolled to its end, and two events at the
// same time never print over each other.
//
// Dara, 5 Oct 2026, with a screenshot: he could not scroll the Day view past
// 5 PM unless he first swiped to another day, and two 11:00 meetings read as one
// garbled line ("HarshaMPatelhtic / Carolinas").
//   • The day and week grids were boxes that scrolled INSIDE the page (82vh
//     tall). On a phone the box's bottom sat under the bottom bar and a finger
//     moved one scroller or the other. They are now part of the page: one scroller.
//   • Every block took the full width. Blocks that share minutes are now split
//     into lanes (src/calendarLanes.js).
// Static, no credentials. BLOCKS.
import fs from 'node:fs';
import { layoutLanes } from '../src/calendarLanes.js';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const css = fs.readFileSync('src/index.css', 'utf8');
for (const cls of ['day-timeline-scroll', 'week-grid-scroll']) {
  const rules = [...css.matchAll(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
  expect(!/overflow(-y)?\s*:\s*(auto|scroll)|max-height/.test(rules), `.${cls} scrolls inside the page again — the day cannot be reached to its end on a phone`);
}
expect(/\.day-event-block\s*\{[^}]*var\(--lanes, 1\)/.test(css) && /\.week-event-block\s*\{[^}]*var\(--lanes, 1\)/.test(css), 'event blocks no longer take their width from their lane — same-time events will overlap');
const view = fs.readFileSync('src/views/CalendarView.jsx', 'utf8');
expect((view.match(/layoutLanes\(/g) || []).length >= 2 && (view.match(/laneVars\(/g) || []).length >= 3, 'the day or week view no longer lays its blocks out in lanes');

const overlaps = (a, b) => a.top < b.top + b.height - 0.5 && b.top < a.top + a.height - 0.5;
const check = (name, boxes, wantLanes) => {
  const L = layoutLanes(boxes);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    if (overlaps(boxes[i], boxes[j]) && L[boxes[i].id].lane === L[boxes[j].id].lane) problems.push(`${name}: "${boxes[i].id}" and "${boxes[j].id}" share minutes and a lane — they would print over each other`);
  for (const [id, n] of Object.entries(wantLanes)) if (L[id].lanes !== n) problems.push(`${name}: "${id}" is split ${L[id].lanes} ways, expected ${n}`);
  for (const b of boxes) if (L[b.id].lane >= L[b.id].lanes) problems.push(`${name}: "${b.id}" sits outside its own lanes`);
};
// Dara's Tuesday: two at 11:00; one alone at 13:00; two at 15:30.
check('Dara’s day', [{ id: 'harsha', top: 260, height: 26 }, { id: 'regional', top: 260, height: 52 }, { id: 'tina', top: 364, height: 104 }, { id: 'fmo', top: 494, height: 26 }, { id: 'discovery', top: 494, height: 52 }],
  { harsha: 2, regional: 2, tina: 1, fmo: 2, discovery: 2 });
check('three at once', [{ id: 'a', top: 0, height: 60 }, { id: 'b', top: 10, height: 60 }, { id: 'c', top: 20, height: 60 }], { a: 3, b: 3, c: 3 });
check('a chain', [{ id: 'a', top: 0, height: 60 }, { id: 'b', top: 30, height: 60 }, { id: 'c', top: 70, height: 30 }], { a: 2, b: 2, c: 2 });
check('back to back', [{ id: 'a', top: 0, height: 52 }, { id: 'b', top: 52, height: 52 }], { a: 1, b: 1 });
check('alone', [{ id: 'a', top: 100, height: 52 }], { a: 1 });
expect(Object.keys(layoutLanes([])).length === 0, 'an empty day breaks the layout');

if (problems.length) { console.error(`\n==== CALENDAR: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== CALENDAR: clean — one scroller, and same-time events sit side by side ====');
