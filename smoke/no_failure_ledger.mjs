// no_failure_ledger.mjs — nothing an agent sees counts what they did not do.
//
// Ray (panel), 1 Oct: "what is in this app that makes me feel judged." A screen
// that says "PrismOS set aside 142 older suggestions from calls you did not get
// to" reads as a list of people he let down, and he closes the app. Set-aside
// follow-ups are offered back as "Pick up where you left off", three at a time,
// with no total; the day-before push asks "still worth doing?" instead of
// warning. Broker screens (Broker*, Adoption) may count — they are for Dara.
// Static. BLOCKS.
import { readFileSync, readdirSync } from 'node:fs';

const problems = [];
const BANNED = [
  [/did(?: not|n['’]t) get to/i, '"you did not get to"'],
  [/last chance/i, '"last chance"'],
  [/aside tomorrow unless/i, 'a deadline-as-threat ("set aside tomorrow unless…")'],
  [/>\s*Bring back\s*</, '"Bring back" (say "Pick up")'],
  [/['"`]\s*\+\s*setAside\s*\+/, 'the set-aside COUNT rendered on screen'],
  [/\bexpired\b[^'"`]*['"`]\s*}/i, 'the word "expired" in on-screen text'],
];
const files = readdirSync('src/views').filter((f) => /\.jsx?$/.test(f) && !/^(Broker|Adoption)/.test(f)).map((f) => 'src/views/' + f);
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return;   // comments may explain the history
    for (const [re, what] of BANNED) if (re.test(line)) problems.push(`${f}:${i + 1} — ${what}`);
  });
}
const cr = readFileSync('src/views/CommitmentReview.jsx', 'utf8');
if (!/Pick up where you left off/.test(cr)) problems.push('CommitmentReview no longer offers "Pick up where you left off"');
if (!/asideRows\.slice\(0, asideShown\)/.test(cr)) problems.push('set-aside follow-ups are listed all at once instead of three at a time');
if (!/fuse\.neq\.immediate/.test(cr)) problems.push('"call you right back" promises are offered back — moot within hours, stale guilt');
const sqls = readdirSync('supabase/sql').filter((f) => f.endsWith('.sql')).sort();
const lastWarn = sqls.filter((f) => /warn_commitments_before_set_aside\(\)\s*\nreturns/.test(readFileSync('supabase/sql/' + f, 'utf8'))).pop();
const noComments = (t) => t.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');   // history notes may quote the old words
if (!lastWarn || /aside tomorrow unless/.test(noComments(readFileSync('supabase/sql/' + lastWarn, 'utf8')))) problems.push(`the follow-up push (${lastWarn}) warns instead of asking`);

if (problems.length) {
  console.log(`==== NO FAILURE LEDGER: ${problems.length} problem(s) ====`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('==== NO FAILURE LEDGER: clean — set-aside follow-ups offered back, never counted at the agent ====');
