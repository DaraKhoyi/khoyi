// gated_props.mjs — find features that exist but are invisible.
//
// The pattern, hit three times in one night:
//   function TaskModal({ onDelete }) { ... {onDelete && <button>Delete</button>} }
//   <TaskModal onSave={...} />          <-- no onDelete, so no Delete button
//
// The code is correct. The feature is built. It simply never appears at that
// call site, and it looks like a missing feature rather than a wiring mistake —
// which is why all three took a user report to find.
//
// Detects: a prop used as the gate of a conditional render, where at least one
// JSX call site of that component omits it. Reports only components that have
// BOTH a passing and an omitting call site, since a prop nobody passes anywhere
// is usually dead code rather than a broken feature.
import { readFileSync, readdirSync } from 'fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const files = [
  'src/App.js',
  ...readdirSync('src/views').filter(f => /\.jsx?$/.test(f)).map(f => `src/views/${f}`),
];

const gates = new Map();   // Component -> Set(prop) used to gate rendered output
const props = new Map();   // Component -> Set(prop) declared
const sites = [];          // { comp, attrs:Set, file, line }

const isJSXish = (n) =>
  n && (n.type === 'JSXElement' || n.type === 'JSXFragment' ||
        (n.type === 'ConditionalExpression' && (isJSXish(n.consequent) || isJSXish(n.alternate))) ||
        (n.type === 'LogicalExpression' && isJSXish(n.right)));

for (const file of files) {
  let ast;
  try {
    ast = parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties', 'dynamicImport'],
    });
  } catch { continue; }

  traverse(ast, {
    // Component definitions with a destructured props object
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path) {
      const node = path.node;
      let name = node.id?.name;
      if (!name && path.parent?.type === 'VariableDeclarator') name = path.parent.id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;              // components only
      const p0 = node.params?.[0];
      if (!p0 || p0.type !== 'ObjectPattern') return;

      const declared = new Set();
      for (const pr of p0.properties) {
        if (pr.type === 'ObjectProperty' && pr.key?.name) declared.add(pr.key.name);
      }
      props.set(name, declared);

      // Which of those props gate JSX?  {prop && <x/>} or prop ? <x/> : null
      // Only props that gate something INTERACTIVE. A missing `sub` or `hint`
      // is a cosmetic choice; a missing `onDelete` is a feature the user cannot
      // reach. Handler-shaped names count, and so does any gated subtree that
      // contains a button or an onClick.
      const interactive = (node) => {
        let found = false;
        const walk = (n) => {
          if (!n || typeof n !== 'object' || found) return;
          if (n.type === 'JSXOpeningElement') {
            const nm = n.name?.name;
            if (nm === 'button' || nm === 'a' || nm === 'input' || nm === 'select' || nm === 'textarea') found = true;
            for (const at of (n.attributes || [])) {
              if (at.type === 'JSXAttribute' && /^on[A-Z]/.test(at.name?.name || '')) found = true;
            }
          }
          for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object' && v.type) walk(v);
          }
        };
        walk(node);
        return found;
      };
      const gated = gates.get(name) || new Set();
      path.traverse({
        LogicalExpression(inner) {
          if (inner.node.operator !== '&&') return;
          if (!isJSXish(inner.node.right)) return;
          // Conditions CHAIN: `{initial && onDelete && <button/>}` parses as
          // ((initial && onDelete) && jsx), so the left side is another
          // expression, not a bare identifier. The first version of this tool
          // only looked one level down and gave a false all-clear on the exact
          // bug it was written to find. Collect every prop named anywhere in
          // the condition instead.
          const namesInCondition = (n, acc = new Set()) => {
            if (!n || typeof n !== 'object') return acc;
            if (n.type === 'Identifier' && declared.has(n.name)) acc.add(n.name);
            if (n.type === 'MemberExpression' && n.object?.type === 'Identifier' && declared.has(n.object.name)) acc.add(n.object.name);
            if (n.type === 'MemberExpression' && n.property?.name && declared.has(n.property.name)) acc.add(n.property.name);
            for (const k of ['left', 'right', 'argument', 'object', 'expressions', 'test']) {
              const v = n[k];
              if (Array.isArray(v)) v.forEach(x => namesInCondition(x, acc));
              else if (v && typeof v === 'object') namesInCondition(v, acc);
            }
            return acc;
          };
          const isInteractive = interactive(inner.node.right);
          for (const nm of namesInCondition(inner.node.left)) {
            if (/^on[A-Z]/.test(nm) || isInteractive) gated.add(nm);
          }
        },
        ConditionalExpression(inner) {
          const t = inner.node.test;
          if (t.type === 'Identifier' && declared.has(t.name) && (isJSXish(inner.node.consequent) || isJSXish(inner.node.alternate))
              && (/^on[A-Z]/.test(t.name) || interactive(inner.node.consequent) || interactive(inner.node.alternate))) gated.add(t.name);
        },
      });
      if (gated.size) gates.set(name, gated);
    },

    // Every place a component is used
    JSXOpeningElement(path) {
      const n = path.node.name;
      if (n.type !== 'JSXIdentifier' || !/^[A-Z]/.test(n.name)) return;
      const attrs = new Set();
      let spread = false;
      for (const a of path.node.attributes) {
        if (a.type === 'JSXAttribute' && a.name?.name) attrs.add(a.name.name);
        if (a.type === 'JSXSpreadAttribute') spread = true;
      }
      sites.push({ comp: n.name, attrs, spread, file, line: path.node.loc?.start.line });
    },
  });
}

const findings = [];
for (const [comp, gatedProps] of gates) {
  const compSites = sites.filter(s => s.comp === comp);
  if (compSites.length < 2) continue;                         // need something to compare against
  for (const prop of gatedProps) {
    const withProp = compSites.filter(s => s.attrs.has(prop));
    const without  = compSites.filter(s => !s.attrs.has(prop) && !s.spread);
    // Only interesting when SOME call site passes it — that proves the feature
    // is meant to be reachable, and the others are the oversight.
    if (withProp.length > 0 && without.length > 0) {
      findings.push({ comp, prop, passing: withProp.length, missing: without });
    }
  }
}

findings.sort((a, b) => b.missing.length - a.missing.length);
if (!findings.length) {
  console.log('\n==== GATED PROPS: none — every gated feature is wired at every call site ====');
} else {
  console.log(`\nFeatures that exist but are invisible at some call sites:\n`);
  for (const f of findings) {
    console.log(`  ${f.comp}  —  '${f.prop}' gates rendered output`);
    console.log(`     passed at ${f.passing} site(s); MISSING at ${f.missing.length}:`);
    for (const m of f.missing) console.log(`       · ${m.file}:${m.line}`);
  }
  console.log(`\n==== GATED PROPS: ${findings.length} gated feature(s) not wired everywhere ====`);
}
