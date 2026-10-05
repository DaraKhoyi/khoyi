// lane_test.mjs — the fast lane must be impossible to reach with a change to logic.
//
// lane.mjs decides which release check a change gets. If it is ever fooled, an
// error ships on the short check — the exact risk Dara accepted the fast lane
// against (5 Oct 2026). So every way a "small" edit can change behaviour is
// pinned here, and this runs in BOTH lanes. BLOCKS.
import { classify } from './lane.mjs';
const problems = [];
const base = `import React, { useState } from 'react';
import { supabase } from '../dataService';
const KIND = { commitment: 'A follow-up from a call, set aside' };
export default function Demo({ items, limit = 3 }) {
  const [said, setSaid] = useState('');
  // a note for the next reader
  const save = async () => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', 7);
    if (error) { window.__notify('Could not save that: try again in a moment', 'error'); return; }
    setSaid(items.length > limit ? 'Saved. There are more below.' : 'Saved to your list.');
  };
  if (said === 'closed') return null;
  return (
    <div style={{ padding: 12, color: 'var(--text-2)', marginTop: -4 }} data-testid="demo">
      <h3 title="What this is">Things that need you</h3>
      <input placeholder="Type a name here" value={said} onChange={(e) => setSaid(e.target.value)} />
      {items.slice(0, limit).map((it) => <p key={it.id} className="row" style={{ opacity: 1 }}>{it.what} is waiting</p>)}
      <button type="button" onClick={save}>Save it now</button>
    </div>
  );
}
`;
const one = (after, path = 'src/views/Demo.jsx', status = 'M', before = base) => classify([{ path, status, before, after }]).lane;
const swap = (a, b) => { if (!base.includes(a)) throw new Error('fixture lost: ' + a); return base.replace(a, b); };
const fast = (what, after, ...rest) => { if (one(after, ...rest) !== 'fast') problems.push(`should be FAST and is not: ${what}`); };
const full = (what, after, ...rest) => { if (one(after, ...rest) !== 'full') problems.push(`REACHED THE FAST LANE: ${what}`); };

// ── wording and layout: fast
fast('text between tags', swap('Things that need you', 'What needs you today'));
fast('a placeholder', swap('Type a name here', 'Start typing a name'));
fast('a title', swap('title="What this is"', 'title="What this list is for"'));
fast('a message shown to the person', swap('Could not save that: try again in a moment', 'That did not save. Please try once more'));
fast('a sentence chosen by a condition', swap('Saved to your list.', 'Saved. It is on your list.'));
fast('padding', swap('padding: 12', 'padding: 16'));
fast('a colour', swap("color: 'var(--text-2)'", "color: 'var(--text-3)'"));
fast('a negative margin', swap('marginTop: -4', 'marginTop: -8'));
fast('a comment', swap('// a note for the next reader', '// a clearer note for whoever reads this next'));
fast('a label in a table of labels', swap('A follow-up from a call, set aside', 'A follow-up heard on a call, then set aside'));
fast('the version label alone', "export const BUILD_VERSION = 'v1.16.03';\n", 'src/version.js', 'M', "export const BUILD_VERSION = 'v1.16.02';\n");
fast('a stylesheet value', '.row {\n  padding: 4px;\n  color: #fff;\n}', 'src/app.css', 'M', '.row {\n  padding: 2px;\n  color: #fff;\n}');
full('a stylesheet that hides something', '.row {\n  padding: 2px;\n  display: none;\n}', 'src/app.css', 'M', '.row {\n  padding: 2px;\n  display: block;\n}');
full('a new stylesheet rule', '.row {\n  padding: 2px;\n}\n.send {\n  margin: 0;\n}', 'src/app.css', 'M', '.row {\n  padding: 2px;\n}');
full('an inline style that hides something', swap("color: 'var(--text-2)'", "color: 'var(--text-2)', display: 'none'"));
fast('a document', '# new words', 'HANDOFF.md', 'M', '# old words');

// ── anything that can change what the app DOES: full
full('a number in logic', swap('limit = 3', 'limit = 5'));
full('a table name', swap("from('tasks')", "from('task')"));
full('a value written to the database', swap("status: 'done'", "status: 'archived'"));
full('a query value', swap(".eq('id', 7)", ".eq('id', 8)"));
full('a query column', swap(".eq('id', 7)", ".eq('user_id', 7)"));
full('a comparison', swap("said === 'closed'", "said === 'open'"));
full('a condition', swap('items.length > limit', 'items.length >= limit'));
full('a handler', swap('onClick={save}', 'onClick={() => setSaid("x")}'));
full('a removed element', swap('<button type="button" onClick={save}>Save it now</button>', ''));
full('an added element', swap('<h3 title="What this is">', '<h3 title="What this is"><b>New</b>'));
full('a class name', swap('className="row"', 'className="row hidden"'));
full('a test id', swap('data-testid="demo"', 'data-testid="demo2"'));
full('an input type', swap('type="button"', 'type="submit"'));
full('an inline opacity', swap('opacity: 1', 'opacity: 0'));
full('a new expression inside text', swap('{it.what} is waiting', '{it.what} is waiting for {it.who}'));
full('a style that became a condition', swap('padding: 12', 'padding: said ? 12 : 0'));
full('a second argument to a notice', swap("'error'); return;", "'info'); return;"));
full('an import', swap("from '../dataService'", "from '../otherService'"));
full('a hook default', swap("useState('')", "useState('closed')"));
full('a key in a table of labels', swap('commitment:', 'dropped:'));
full('a sentence that became code', swap("'Saved to your list.'", "window.location.href"));
full('a new file', base, 'src/views/New.jsx', 'A', null);
full('a deleted file', null, 'src/views/Demo.jsx', 'D');
full('a database file', 'select 2', 'supabase/sql/2026-10-06_x.sql', 'M', 'select 1');
full('an edge function', 'b', 'supabase/functions/gmail-sync/index.ts', 'M', 'a');
full('a release check', 'b', 'smoke/calm_guard.mjs', 'M', 'a');
full('the lane rule itself', 'b', 'smoke/lane.mjs', 'M', 'a');
full('the check script', 'b', 'smoke/run.sh', 'M', 'a');
full('a workflow', 'b', '.github/workflows/deploy.yml', 'M', 'a');
full('the service worker', 'b', 'public/sw.js', 'M', 'a');
full('the package list', 'b', 'package.json', 'M', 'a');
full('more than the version in version.js', "export const BUILD_VERSION = 'v1.16.03';\nwindow.x = 1;\n", 'src/version.js', 'M', "export const BUILD_VERSION = 'v1.16.02';\n");
full('code that does not parse', swap('return (', 'return (('));
if (classify([]).lane !== 'full') problems.push('REACHED THE FAST LANE: no readable change at all');
// one wording file beside one logic file is a full check
if (classify([{ path: 'src/views/A.jsx', status: 'M', before: base, after: swap('Save it now', 'Save this now') }, { path: 'src/views/B.jsx', status: 'M', before: base, after: swap('limit = 3', 'limit = 4') }]).lane !== 'full') problems.push('REACHED THE FAST LANE: wording beside a logic change');

if (problems.length) { console.error(`\n==== LANE: ${problems.length} problem(s) ====`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('==== LANE: clean — only wording, layout, comments and the version label can take the fast lane ====');
