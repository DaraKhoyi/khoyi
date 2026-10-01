#!/usr/bin/env node
// ── The tuning fork answers ONE tap ──────────────────────────────────────────
// Josh has reported "I have to tap the menu twice" three times (v1.06.66,
// v1.07.79, 1 Oct 2026). Each fix was real and each left a path open. This check
// drives the fork's handlers through the event sequences an iPhone actually
// produces and fails the build if any single tap does not open the menu exactly
// once, or if a double tap stops flipping.
//
// Sequences:
//   normal tap          pointerdown → pointerup → click        menu opens once
//   cancelled tap (iOS) pointerdown → pointercancel → click    menu opens once  ← the lost tap
//   double tap          two normal taps within 320 ms          menu closes, flips
//   hold                pointerdown … 480 ms                   switcher, no menu
// Plus a static check that the fork can't be claimed by iOS for panning.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/flipGestures.js'), 'utf8');
const tmp = path.join(root, 'smoke/.fork_tap_tmp.mjs');
fs.writeFileSync(tmp, src);
const { forkHandlers } = await import(pathToFileURL(tmp).href + '?t=' + Date.now());
fs.unlinkSync(tmp);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = () => ({ preventDefault() {} });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++; };

function rig() {
  const log = [];
  const h = forkHandlers({
    onMenu: (open) => log.push(open === false ? 'close' : 'open'),
    onFlip: () => log.push('flip'),
    onSwitcher: () => log.push('switcher'),
  });
  return { h, log };
}

console.log('→ tuning fork: one tap opens the menu');
{
  const { h, log } = rig();
  h.onPointerDown(ev()); h.onPointerUp(ev()); h.onClick(ev());
  check(log.join() === 'open', 'normal tap opens once (got: ' + (log.join() || 'nothing') + ')');
}
await sleep(400);
{
  const { h, log } = rig();
  h.onPointerDown(ev()); h.onPointerCancel(ev()); h.onClick(ev());
  check(log.join() === 'open', 'iOS-cancelled tap still opens (got: ' + (log.join() || 'nothing') + ')');
}
await sleep(400);
{
  const { h, log } = rig();
  h.onPointerDown(ev()); h.onPointerUp(ev()); h.onClick(ev());
  await sleep(120);
  h.onPointerDown(ev()); h.onPointerUp(ev()); h.onClick(ev());
  check(log.join() === 'open,close,flip', 'double tap flips (got: ' + log.join() + ')');
}
await sleep(400);
{
  const { h, log } = rig();
  h.onPointerDown(ev()); await sleep(520); h.onPointerUp(ev()); h.onClick(ev());
  check(log.join() === 'switcher', 'hold opens the switcher only (got: ' + log.join() + ')');
}
await sleep(400);
{
  const { h, log } = rig();
  h.onPointerDown(ev()); h.onPointerUp(ev());
  await sleep(1200);
  h.onPointerDown(ev()); h.onPointerUp(ev()); h.onClick(ev());
  check(log.join() === 'open,open', 'two separate taps are two opens, never a flip (got: ' + log.join() + ')');
}

const app = fs.readFileSync(path.join(root, 'src/App.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
check(/forkHandlers\([\s\S]{0,400}?fork-btn/.test(app), 'the fork element carries .fork-btn');
check(/\.fork-btn\s*\{[^}]*touch-action:\s*none/.test(css), '.fork-btn has touch-action:none (iOS cannot claim the tap as a pan)');
check(/data-chevron/.test(app) && /closest\('\[data-chevron\]'\)/.test(app), 'menu chevron expands by touch instead of navigating');

if (fails) { console.log(`FORK TAP: ${fails} failure(s)`); process.exit(1); }
console.log('FORK TAP: clean');
