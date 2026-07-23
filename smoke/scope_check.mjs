// Static scope check — catches "X is not defined" BEFORE it reaches a user.
//
// Why this exists: v1.04.49 shipped a ReferenceError. A helper was defined in
// InboxView but used in GmailInboxView, two different components in the same
// file. It built cleanly (esbuild does not resolve scopes), and the smoke gate
// passed — because the smoke agent is a BRAND NEW user with no email connected,
// so it never renders a message header and never ran the broken line.
//
// That is the real lesson: the smoke gate proves views MOUNT, not that every
// branch inside them runs. A whole class of bug lives past the first render, and
// no amount of clicking around as an empty account will reach it. This check
// does not care about data at all — it reads the code.
import { readFileSync, readdirSync } from 'fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const GLOBALS = new Set([
  'window','document','console','navigator','location','history','localStorage','sessionStorage',
  'fetch','URL','URLSearchParams','Blob','File','FileReader','FormData','Headers','Request','Response',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'Promise','Map','Set','WeakMap','WeakSet','Symbol','Proxy','Reflect','JSON','Math','Date','RegExp',
  'Array','Object','String','Number','Boolean','Error','TypeError','RangeError','Function','BigInt',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI',
  'atob','btoa','structuredClone','queueMicrotask','crypto','performance','alert','confirm','prompt',
  'Intl','AbortController','TextEncoder','TextDecoder','Image','Audio','MutationObserver','IntersectionObserver',
  'ResizeObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','Element','HTMLElement',
  'globalThis','process','require','module','exports','__dirname','undefined','NaN','Infinity','self','top',
  'DataTransfer','Notification','speechSynthesis','SpeechSynthesisUtterance','MediaRecorder','AudioContext',
  'Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array',
  'ArrayBuffer','DataView','SharedArrayBuffer','caches','escape','unescape','WeakRef','FinalizationRegistry',
  'CSS','DOMParser','XMLSerializer','XMLHttpRequest','WebSocket','Worker','BroadcastChannel','ClipboardItem',
  'webkitAudioContext','SpeechRecognition','webkitSpeechRecognition','getComputedStyle','matchMedia','scrollTo',
]);

const files = [
  'src/App.js',
  ...readdirSync('src/views').filter(f => /\.jsx?$/.test(f)).map(f => `src/views/${f}`),
];

// Known-missing allowlist. It should only ever SHRINK, and only because the
// identifier now exists — never because a finding got inconvenient. As of
// v1.04.51 it is empty: computePace, weakestLinkCoaching, TEXT_TEMPLATES and
// the PrismThinking import were all written rather than tolerated.
const KNOWN_MISSING = new Set([]);

let problems = 0;
let known = 0;
for (const file of files) {
  let ast;
  try {
    ast = parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties', 'dynamicImport'],
    });
  } catch (e) {
    console.log(`✗ ${file} — parse failed: ${String(e.message).slice(0, 120)}`);
    problems++; continue;
  }
  const seen = new Set();
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (GLOBALS.has(name) || seen.has(name + '@' + path.node.loc?.start.line)) return;
      if (path.scope.hasBinding(name, true)) return;
      seen.add(name + '@' + path.node.loc?.start.line);
      if (KNOWN_MISSING.has(name)) {
        console.log(`· known  ${file}:${path.node.loc?.start.line} — '${name}' (pre-existing, tracked)`);
        known++; return;
      }
      console.log(`✗ ${file}:${path.node.loc?.start.line} — '${name}' is not defined in scope`);
      problems++;
    },
  });
}

console.log(problems === 0
  ? `\n==== SCOPE: clean — no NEW undefined identifiers (${known} known, tracked) ====`
  : `\n==== SCOPE: ${problems} NEW undefined reference(s) — fix before shipping ====`);
process.exit(problems ? 1 : 0);
