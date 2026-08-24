// smoke/jsx_escapes.mjs
//
// A \uXXXX escape inside a JSX TEXT node is not an escape. JSX text is not a
// JavaScript string literal, so the characters render exactly as typed and the
// user sees the seven characters "\u00B7" where a "·" was intended.
//
// This has now shipped twice. Dara photographed it in production reading
//   "NEW LEAD \u00B7 REPLY READY" and "emailed \u00B7 39m ago"
// and the same mistake was caught pre-ship once before in EmailShared.jsx. It
// survives review because the source looks correct — the escape is only wrong
// because of WHERE it sits, and the build has no opinion about it.
//
// Correct:   <span>{'New lead \u00B7 reply ready'}</span>   (a real string)
// Correct:   <span title={'a \u2014 b'}>                    (attribute expression)
// WRONG:     <span>New lead \u00B7 reply ready</span>       (JSX text)
//
// Attributes written as plain strings (title="a \u2014 b") are the same trap, so
// they are checked too.

import { readFileSync, readdirSync } from 'fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const files = [
  ...readdirSync('src/views').filter(f => /\.jsx?$/.test(f)).map(f => `src/views/${f}`),
  ...readdirSync('src').filter(f => /\.jsx?$/.test(f)).map(f => `src/${f}`),
];

// A backslash, then a literal u, then either 4 hex digits or {hex}. We look at
// RAW source text, so a real escape (already collapsed by the parser into the
// character itself) can never match.
const ESCAPE = /\\u(?:\{[0-9A-Fa-f]{1,6}\}|[0-9A-Fa-f]{4})/;

const problems = [];

for (const file of files) {
  let src, ast;
  try {
    src = readFileSync(file, 'utf8');
    ast = parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties', 'dynamicImport'],
    });
  } catch (_) { continue; }   // scope_check reports parse failures; don't double up

  traverse(ast, {
    JSXText(path) {
      const raw = path.node.extra && path.node.extra.raw ? path.node.extra.raw : path.node.value;
      const m = ESCAPE.exec(raw);
      if (!m) return;
      problems.push({
        file, line: path.node.loc && path.node.loc.start.line, found: m[0],
        where: 'JSX text', snippet: raw.trim().slice(0, 60).replace(/\s+/g, ' '),
      });
    },
    // title="Open \u2019s record" — a plain string attribute has the same problem.
    JSXAttribute(path) {
      const v = path.node.value;
      if (!v || v.type !== 'StringLiteral') return;
      const raw = v.extra && v.extra.raw ? v.extra.raw : '';
      const m = ESCAPE.exec(raw);
      if (!m) return;
      problems.push({
        file, line: v.loc && v.loc.start.line, found: m[0],
        where: `attribute ${path.node.name && path.node.name.name}`,
        snippet: raw.trim().slice(0, 60),
      });
    },
  });
}

if (!problems.length) {
  console.log('\n==== JSX ESCAPES: clean — no \\uXXXX escapes stranded in JSX text ====\n');
  process.exit(0);
}

console.log(`\n==== JSX ESCAPES: ${problems.length} problem(s) ====\n`);
for (const p of problems) {
  console.log(`  \u2717 ${p.file}:${p.line} — ${p.found} in ${p.where}`);
  console.log(`    ${p.snippet}`);
  console.log(`    This renders literally. Wrap it in an expression: {'\u2026${p.found}\u2026'}`);
}
console.log('');
process.exit(1);
