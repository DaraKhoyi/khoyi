// silent_failures.mjs — writes that can fail without anyone finding out.
//
// supabase-js does NOT throw on a failed write. It RESOLVES with { error }.
// So this compiles, runs, and lies:
//
//     try { await supabase.from('x').insert(row); } catch (_) {}
//
// The catch never fires; the error is simply never read. The UI has usually
// already updated optimistically, so the user sees success, and the truth only
// surfaces later when the change is gone. That is exactly how Skip appeared to
// work for a week while writing zero rows.
//
// Flags mutating calls (insert/update/upsert/delete/rpc/storage) whose result is
// discarded — no destructured `error`, no assignment, no `.then`. Reads are
// ignored: a failed select degrades visibly, a failed write does not.
import { readFileSync, readdirSync } from 'fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const MUTATORS = new Set(['insert', 'update', 'upsert', 'delete', 'rpc', 'remove', 'upload']);

const files = [
  'src/App.js',
  ...readdirSync('src/views').filter(f => /\.jsx?$/.test(f)).map(f => `src/views/${f}`),
];

const findings = [];

for (const file of files) {
  let ast;
  try {
    ast = parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties', 'dynamicImport'],
    });
  } catch { continue; }

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== 'MemberExpression') return;
      const method = callee.property?.name;
      if (!MUTATORS.has(method)) return;

      // must be part of a supabase chain
      let root = callee.object, depth = 0, isSupabase = false;
      while (root && depth++ < 8) {
        if (root.type === 'Identifier' && /supabase|admin/i.test(root.name)) { isSupabase = true; break; }
        root = root.callee?.object || root.object;
      }
      if (!isSupabase) return;

      // climb past chained builders (.eq().select() etc) to the outermost await
      let top = path;
      while (top.parentPath &&
        (top.parentPath.isMemberExpression() || top.parentPath.isCallExpression())) top = top.parentPath;
      const awaited = top.parentPath?.isAwaitExpression() ? top.parentPath : null;
      const node = awaited || top;

      // Is the result captured at all?
      const parent = node.parentPath;
      let handled = false;
      if (parent?.isVariableDeclarator()) {
        const id = parent.node.id;
        if (id.type === 'ObjectPattern') {
          handled = id.properties.some(p => p.key?.name === 'error' || p.key?.name === 'data');
        } else handled = true;               // assigned to a variable — caller may inspect it
      }
      if (parent?.isAssignmentExpression() || parent?.isReturnStatement()) handled = true;
      if (parent?.isMemberExpression() && ['then', 'catch'].includes(parent.node.property?.name)) handled = true;
      if (parent?.isArrowFunctionExpression() || parent?.isCallExpression()) handled = true;
      // Inside Promise.all([...]) the caller destructures the results, so the
      // array element itself looking "discarded" is a false alarm.
      if (parent?.isArrayExpression()) handled = true;

      // The dangerous shape specifically: wrapped in a try whose catch does
      // NOTHING. supabase-js resolves rather than throws, so the catch was never
      // going to fire — and now the error has nowhere left to go.
      let emptyCatch = false;
      const tryPath = path.findParent(p2 => p2.isTryStatement());
      if (tryPath) {
        const handlerBody = tryPath.node.handler?.body?.body;
        if (Array.isArray(handlerBody) && handlerBody.length === 0) emptyCatch = true;
      }

      if (!handled || emptyCatch) {
        findings.push({ file, line: node.node.loc?.start.line, method, emptyCatch });
      }
    },
  });
}

// Cluster by file so the output is actionable rather than a wall.
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

if (!findings.length) {
  console.log('\n==== SILENT WRITES: none — every mutating call checks its result ====');
} else {
  console.log('\nWrites whose failure nobody would notice:\n');
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${list.length})`);
    for (const f of list.slice(0, 12)) console.log(`     · line ${f.line}  .${f.method}()${f.emptyCatch ? '   [empty catch — error has nowhere to go]' : ''}`);
    if (list.length > 12) console.log(`     … and ${list.length - 12} more`);
  }
  const ec = findings.filter(f => f.emptyCatch).length;
  console.log(`\n==== SILENT WRITES: ${findings.length} unchecked mutating call(s), ${ec} of them inside an EMPTY CATCH ====`);
}
