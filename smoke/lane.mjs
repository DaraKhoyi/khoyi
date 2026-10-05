// lane.mjs — which release check does this change get: the full one, or the fast lane?
//
// Dara, 5 Oct 2026 (Blueprint item 18): "Yes, add a fast lane" — wording and
// layout changes should not wait ~19 minutes. The danger he was told about, and
// accepted on one condition: a "wording only" change that was not wording only
// is how an error gets out. So the lane is decided HERE, by reading what
// actually changed — never by the author saying so. There is no way to ask for
// the fast lane. GATE_LANE=full forces the full check; nothing forces fast.
//
// FAST only when EVERY changed file is one of:
//   • src/version.js, with nothing but the version string changed
//   • a Markdown file (not shipped)
//   • an existing src/**/*.css file, where only values of existing sizing,
//     spacing, colour or type rules changed (nothing that can hide a control)
//   • an existing src/**/*.js(x) file whose code is IDENTICAL once these are
//     blanked out:  text between tags · placeholder/title/alt/aria-label/label
//     strings · plain values inside style={{ }} (except display, visibility,
//     opacity, position and the like) · comments · and sentence-like
//     strings (three or more words, no code punctuation) that are not being
//     compared, looked up, or handed to a query.
// Anything else — a new or deleted file, a database file, an edge function, a
// check, a workflow, a number in logic, a condition, a query, a name — is FULL.
// If the change cannot be read at all (no base commit, a parse error), FULL.
//
// What the fast lane still runs is decided in run.sh: the build, every static
// check, the fresh-account walk, every screen mounting, and the large-font
// layout check. It skips the live-database checks and the functional walk.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const WORD_ATTRS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'label']);
// Style that can make a control vanish or stop answering a tap is not "layout"
// for this purpose: the fast lane skips the walk that would notice.
const STYLE_LOGIC = new Set(['display', 'visibility', 'pointerEvents', 'opacity', 'zIndex', 'position', 'overflow', 'overflowX', 'overflowY', 'userSelect', 'touchAction']);
const CSS_LOGIC = /(^|[\s;{])(display|visibility|pointer-events|opacity|z-index|position|overflow(-[xy])?|user-select|touch-action|content)\s*:/i;
// A string handed to one of these is a name, a query or a pattern — never wording.
const CODE_CALLS = new Set(['select', 'from', 'rpc', 'eq', 'neq', 'or', 'and', 'not', 'filter', 'in', 'is', 'order', 'match', 'ilike', 'like', 'contains', 'invoke', 'fetch', 'querySelector', 'querySelectorAll', 'getElementById',
  'test', 'replace', 'replaceAll', 'split', 'join', 'includes', 'startsWith', 'endsWith', 'indexOf', 'getItem', 'setItem', 'removeItem', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage',
  'setView', 'navigate', 'open', 'require', 'import', 'RegExp', 'Function', 'eval', 'setAttribute', 'getAttribute', 'has', 'get', 'set', 'delete', 'channel', 'on', 'emit', 'encodeURIComponent', 'URL']);
const sentence = (s) => typeof s === 'string' && s.trim().split(/\s+/).length >= 3 && /^[\s“"'(¡¿]*[A-Z0-9]/.test(s) && !/[=<>{}()*_|\\`$#@]|\/\/|\.\w+\.|\w\.\w|::|->|&&/.test(s);

function calleeName(node) {
  const c = node.callee;
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') return c.property?.name || c.property?.value || '';
  if (c.type === 'Import') return 'import';
  return '';
}
// May this string node be treated as wording, given where it sits?
function wordingPosition(path) {
  let child = path.node;
  for (let p = path.parentPath; p; child = p.node, p = p.parentPath) {
    const n = p.node, t = n.type;
    if (t === 'BinaryExpression' || t === 'SwitchCase' || t === 'ImportDeclaration' || t === 'ExportNamedDeclaration' || t === 'ExportAllDeclaration' || t === 'TaggedTemplateExpression') return false;
    if ((t === 'MemberExpression' || t === 'OptionalMemberExpression') && n.property === child) return false;      // obj['key']
    if ((t === 'ObjectProperty' || t === 'ObjectMethod' || t === 'ClassProperty') && n.key === child) return false; // { 'key': … }
    if (t === 'CallExpression' || t === 'OptionalCallExpression' || t === 'NewExpression') { if (CODE_CALLS.has(calleeName(n))) return false; }
    if (t === 'JSXAttribute') return WORD_ATTRS.has(n.name?.name) || n.name?.name === 'children';
    if (t === 'FunctionDeclaration' || t === 'Program') break;
  }
  return true;
}

// The code with everything that is only wording or layout blanked out.
export function skeleton(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'], errorRecovery: false });
  traverse(ast, {
    JSXText(path) { path.node.value = path.node.value.trim() ? '·' : ''; if (path.node.extra) delete path.node.extra; },
    JSXAttribute(path) {
      const n = path.node, name = n.name?.name;
      if (WORD_ATTRS.has(name) && n.value?.type === 'StringLiteral') { n.value.value = ''; delete n.value.extra; }
      if (name === 'style' && n.value?.type === 'JSXExpressionContainer' && n.value.expression.type === 'ObjectExpression') {
        for (const pr of n.value.expression.properties) {
          if (pr.type !== 'ObjectProperty' || pr.computed) continue;
          if (STYLE_LOGIC.has(pr.key?.name ?? pr.key?.value)) continue;
          const v = pr.value;
          if (v.type === 'StringLiteral') { v.value = ''; delete v.extra; }
          else if (v.type === 'NumericLiteral') { v.value = 0; delete v.extra; }
          else if (v.type === 'UnaryExpression' && v.operator === '-' && v.argument.type === 'NumericLiteral') { v.argument.value = 0; delete v.argument.extra; }
        }
      }
    },
    StringLiteral(path) {
      if (path.parent.type === 'JSXAttribute') return;                       // handled above, by attribute name
      if (sentence(path.node.value) && wordingPosition(path)) { path.node.value = ''; delete path.node.extra; }
    },
    TemplateLiteral(path) {
      // every fixed piece must read as wording, and it must sit where wording sits
      const whole = path.node.quasis.map((q) => q.value.cooked ?? '').join(' x ');
      if (sentence(whole) && wordingPosition(path)) for (const q of path.node.quasis) q.value = { raw: '', cooked: '' };
    },
  });
  return generate(ast, { comments: false, compact: true, retainLines: false }).code;
}

// files: [{ path, status: 'M'|'A'|'D'|'R…', before: string|null, after: string|null }]
export function classify(files) {
  const reasons = [];
  if (!files.length) reasons.push('nothing changed that could be read');
  for (const f of files) {
    const p = f.path;
    if (/\.md$/i.test(p)) continue;
    if (f.status !== 'M') { reasons.push(`${p}: a file was added, removed or renamed`); continue; }
    if (p === 'src/version.js') {
      const strip = (s) => String(s).replace(/BUILD_VERSION = '[^']*'/, "BUILD_VERSION = ''");
      if (strip(f.before) !== strip(f.after)) reasons.push(`${p}: more than the version string changed`);
      continue;
    }
    if (/^src\/.+\.css$/.test(p)) {
      // a stylesheet: fast, unless a changed line can hide a control or block a tap
      const b = new Set(String(f.before).split('\n').map((l) => l.trim())), a = new Set(String(f.after).split('\n').map((l) => l.trim()));
      const changed = [...a].filter((l) => !b.has(l)).concat([...b].filter((l) => !a.has(l)));
      if (changed.some((l) => CSS_LOGIC.test(l) || /[{}]/.test(l))) reasons.push(`${p}: a rule was added or removed, or a changed line can hide a control or block a tap`);
      continue;
    }
    if (/^src\/.+\.jsx?$/.test(p) && !/\.test\.jsx?$/.test(p)) {
      try { if (skeleton(f.before) !== skeleton(f.after)) reasons.push(`${p}: the code changed, not only wording or layout`); }
      catch (e) { reasons.push(`${p}: could not be read as code (${String(e.message).slice(0, 80)})`); }
      continue;
    }
    reasons.push(`${p}: outside what the fast lane may carry`);
  }
  return { lane: reasons.length ? 'full' : 'fast', reasons };
}

function git(args) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }

export function changedFiles() {
  const ci = !!process.env.GITHUB_ACTIONS;
  // On a developer's machine the comparison is ALWAYS with what is published
  // (origin/main); only the deploy robot is told its base. Otherwise committing
  // a logic change and then comparing with HEAD would hide it.
  const base = ci ? (process.env.LANE_BASE || '') : 'origin/main';
  if (!base || /^0+$/.test(base)) throw new Error('no base commit to compare with');
  git(['cat-file', '-e', base + '^{commit}']);
  // In CI the workflow stamps the build id into two files before this runs, so
  // compare what was COMMITTED. Locally, compare what is on disk, committed or not.
  const names = git(ci ? ['diff', '--name-status', base, 'HEAD'] : ['diff', '--name-status', base]).split('\n').filter(Boolean);
  const files = names.map((l) => { const [status, ...rest] = l.split('\t'); const path = rest[rest.length - 1];
    const show = (ref) => { try { return git(['show', `${ref}:${path}`]); } catch { return null; } };
    return { path, status: status[0], before: show(base), after: ci ? show('HEAD') : (existsSync(path) ? readFileSync(path, 'utf8') : null) }; });
  if (!ci) for (const path of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) files.push({ path, status: 'A', before: null, after: null });
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let out = { lane: 'full', reasons: [] };
  if ((process.env.GATE_LANE || '').toLowerCase() === 'full') out.reasons.push('GATE_LANE=full');
  else { try { out = classify(changedFiles()); } catch (e) { out = { lane: 'full', reasons: ['could not read the change: ' + String(e.message).split('\n')[0].slice(0, 120)] }; } }
  if (out.lane === 'fast') console.error('==== LANE: fast — only wording, layout, comments or the version label changed ====');
  else { console.error('==== LANE: full ===='); for (const r of out.reasons.slice(0, 12)) console.error('  · ' + r); if (out.reasons.length > 12) console.error(`  · and ${out.reasons.length - 12} more`); }
  process.stdout.write(out.lane + '\n');
}
