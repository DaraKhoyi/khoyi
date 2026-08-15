#!/usr/bin/env node
// ── Open-screens registry check ──────────────────────────────────────────────
// The ALT-TAB switcher's rules are invisible until they fail, and the way they
// fail is by silently destroying a half-written reply on the fifth switch. That
// is the one outcome that would make Dara stop trusting the feature, so it is
// asserted here rather than left to a code review.
//
// Runs headless with a stubbed localStorage — no browser, no build, milliseconds.

// stub localStorage
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const m = await import('../src/openScreens.js');
const U = 'u1';
const sleep = () => new Promise(r => setTimeout(r, 5));
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '  ok   ' : '  FAIL ') + name); };

// 1. cap at 4, oldest clean evicted
for (const v of ['inbox','contacts','journal','prospecting']) { m.touchScreen(U, v); await sleep(); }
m.touchScreen(U, 'finance'); await sleep();
let open = m.openScreens(U, 'finance');
ok('caps at 4 slots', open.length === 3 && m.openScreens(U,'nothing').length === 4);
ok('evicted the oldest (inbox)', !open.some(s => s.view === 'inbox'));

// 2. dirty is never evicted — THE critical rule
m.clearAll(U);
m.touchScreen(U, 'inbox'); await sleep();
m.parkScreen(U, 'inbox', null, { dirty: true, note: 'draft to Marcus, unsent' });
for (const v of ['contacts','journal','prospecting','finance','calendar']) { m.touchScreen(U, v); await sleep(); }
const all = m.openScreens(U, 'nothing');
ok('dirty screen survives 5 further switches', all.some(s => s.view === 'inbox' && s.dirty));
ok('its note is preserved', all.find(s => s.view==='inbox').note === 'draft to Marcus, unsent');

// 3. ALT-TAB target is the last DIFFERENT screen, and toggles
m.clearAll(U);
m.touchScreen(U,'prospecting'); await sleep(); m.touchScreen(U,'inbox'); await sleep();
ok('previous from inbox is prospecting', m.previousScreen(U,'inbox').view === 'prospecting');
m.touchScreen(U,'prospecting'); await sleep();
ok('toggles back to inbox', m.previousScreen(U,'prospecting').view === 'inbox');

// 4. sub-tabs are distinct places
m.clearAll(U);
m.touchScreen(U,'prospecting','today'); await sleep(); m.touchScreen(U,'prospecting','roi'); await sleep();
ok('sub-tabs are separate slots', m.openScreens(U,'nothing').length === 2);

// 5. survives a "restart" — new module instance, same storage
m.clearAll(U);
m.touchScreen(U,'inbox'); m.parkScreen(U,'inbox',null,{dirty:true,note:'half-written reply',snap:{scroll:840,thread:'t-9'}});
const m2 = await import('../src/openScreens.js?reload=1');
const snap = m2.getSnapshot(U,'inbox');
ok('snapshot survives a fresh module load', snap && snap.scroll === 840 && snap.thread === 't-9');
ok('parked-work flag is set', m2.hasParkedWork(U,'nothing'));

// 6. per-user isolation
m.touchScreen('u2','deals');
ok('users are isolated', !m.openScreens('u2','nothing').some(s=>s.view==='inbox'));

console.log(fail ? `\n==== OPEN SCREENS: ${fail} FAILED ====` : `OPEN SCREENS: clean — ${pass}/${pass} registry rules hold`);
process.exit(fail ? 1 : 0);
