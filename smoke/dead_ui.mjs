// dead_ui.mjs — things the app fetches and never shows, and controls wired to
// nothing.
//
// Five "built-but-invisible" features turned up in one month: property_notes
// loaded from the database and written back but NEVER RENDERED, contact dated
// notes the same, a Delete button whose handler was passed at one call site out
// of three. Each cost real work and shipped as nothing. None of them failed —
// that is the whole problem. Code that loads data and forgets to display it
// runs perfectly.
//
// Two checks, both deliberately conservative, because a guard that cries wolf
// about JSX gets switched off within a week:
//
//   1. LOADED, NEVER SHOWN. A useState whose setter is called with the result of
//      a database read, where the state variable itself never appears again.
//      Fetched, stored, dropped.
//
//   2. WIRED TO NOTHING. An onClick/onChange naming a function that is not
//      defined in the file and is not a prop, an import or a global. scope_check
//      catches an undefined identifier at parse level; this catches the narrower
//      case of a handler that was renamed or deleted while its button stayed.
//
// Usage: node smoke/dead_ui.mjs

import fs from 'node:fs';
import path from 'node:path';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name))
    : (/\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

// Names that are set and legitimately never read in JSX: they feed effects,
// guards or other logic. Keep this list short and REASONED — every entry is a
// case the check cannot see, not a case it is allowed to ignore.
const SETTER_OK = /^(setLoading|setBusy|setErr|setError|setSaving|setMsg|setSendMsg|setNonce|setTick|setReady|setMounted|setDirty)$/;

const problems = [];

for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative('.', file);

  // ── 1. loaded, never shown ────────────────────────────────────────────────
  for (const m of src.matchAll(/const \[(\w+), (set\w+)\] = useState\(/g)) {
    const [, name, setter] = m;
    if (SETTER_OK.test(setter)) continue;

    // Only care when the setter is fed by a database read — otherwise this is a
    // plain bit of UI state and its absence from JSX means nothing.
    const fedByQuery = new RegExp(
      `${setter}\\s*\\(\\s*(?:data|rows|res|result|r)\\b|` +
      `\\bconst\\s*\\{\\s*data[^}]*\\}\\s*=\\s*await[\\s\\S]{0,400}?${setter}\\s*\\(`
    ).test(src);
    if (!fedByQuery) continue;

    // Is the value ever read anywhere other than its own declaration and setter?
    const reads = [...src.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
    // 1 = the destructuring itself. 2 is usually declaration + a lone setState.
    if (reads <= 1) {
      problems.push({
        file: rel, kind: 'loaded, never shown', what: name,
        detail: `${setter}() is fed from a query and ${name} is never read again`,
      });
    }
  }

  // ── 2. wired to nothing ───────────────────────────────────────────────────
  // Handlers named directly: onClick={doThing}. Skip inline arrows, member
  // expressions and anything with an argument — those are a different shape and
  // scope_check already parses them properly.
  const declared = new Set();
  for (const d of src.matchAll(/(?:function|const|let|var)\s+(\w+)\s*[=(]/g)) declared.add(d[1]);
  // DESTRUCTURED DECLARATIONS. Missing these made the first run pure noise:
  // every useState setter — setTags, setSearch, setPhones — was reported as a
  // handler wired to nothing, because `const [tags, setTags] = useState()`
  // matches neither `const name =` nor `function name(`. A check whose first
  // output is twelve false positives gets switched off before it ever finds
  // anything.
  for (const d of src.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) {
    for (const part of d[1].split(',')) { const nm = part.trim(); if (/^\w+$/.test(nm)) declared.add(nm); }
  }
  for (const d of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
    for (const part of d[1].split(',')) {
      const nm = part.split(':').pop().split('=')[0].trim();
      if (/^\w+$/.test(nm)) declared.add(nm);
    }
  }
  // Function parameters, including arrow params — a handler passed down and used
  // directly is extremely common here.
  for (const d of src.matchAll(/\(([^)]{0,200})\)\s*=>/g)) {
    for (const part of d[1].split(',')) {
      const nm = part.split(':').pop().split('=')[0].trim().replace(/[{}[\]]/g, '');
      if (/^\w+$/.test(nm)) declared.add(nm);
    }
  }
  for (const d of src.matchAll(/(?:import\s+\{([^}]+)\}|import\s+(\w+))/g)) {
    for (const part of (d[1] || d[2] || '').split(',')) declared.add(part.trim().split(' as ').pop().trim());
  }
  // COMPONENT PROPS. The first attempt required the destructured object to
  // contain no braces, so `function X({ a, modeBadges = {} })` did not match and
  // every prop of that component was reported missing — onClose, onSignOut,
  // onHero. Walk from the opening paren to its matching close instead, which
  // handles defaults, nested objects and multi-line signatures.
  for (const d of src.matchAll(/function\s+\w*\s*\(/g)) {
    let i = d.index + d[0].length, depth = 1, buf = '';
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (!depth) break; }
      buf += ch; i++;
    }
    for (const part of buf.replace(/\{|\}/g, ',').split(',')) {
      const nm = part.split(':').pop().split('=')[0].trim();
      if (/^\w+$/.test(nm)) declared.add(nm);
    }
  }

  for (const h of src.matchAll(/\son(?:Click|Change|Submit|Blur|Focus|Input)=\{(\w+)\}/g)) {
    const name = h[1];
    if (declared.has(name)) continue;
    if (/^(undefined|null)$/.test(name)) continue;
    problems.push({
      file: rel, kind: 'wired to nothing', what: name,
      detail: 'a handler by this name is not defined, imported or received as a prop in this file',
    });
  }
}

if (!problems.length) {
  console.log('==== DEAD UI: clean — nothing loaded and dropped, no handler wired to a missing function ====');
  process.exit(0);
}
console.log('');
for (const p of problems) {
  console.log(`  ✗ ${p.file} — ${p.kind}: ${p.what}`);
  console.log(`      ${p.detail}`);
}
console.log('');
console.log('  Work that was done and cannot be seen. None of this FAILS — code that loads data');
console.log('  and forgets to render it runs perfectly, which is why five of these shipped in a');
console.log('  month. Either show it or delete it; leaving it is the worst of the three.');
console.log('');
console.log(`==== DEAD UI: ${problems.length} ====`);
process.exit(1);
