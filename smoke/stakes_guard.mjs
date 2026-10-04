// stakes_guard.mjs — what is at stake decides whether a follow-up may be hidden.
//
// Panel (Skeptic + Ray), 2 Oct: 144 follow-ups expired through the "immediate"
// fuse without a warning. Reading them: half were "be there in five" — and the
// other half were a key release at a closing, an MLS price reduction, a declined
// payment. `fuse` (how soon) had been used as "how little it matters".
// Now stakes is its own judgement, and a HIGH-stakes promise is never stored as
// 'immediate' — so it is reviewed, warned about and recoverable like any other,
// while the logistics stay hidden. This holds that line. BLOCKS.
import { readFileSync } from 'node:fs';
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const read = (p) => readFileSync(p, 'utf8');

// 1 — static: the reader is asked the two questions separately, stores the answer,
//     and does not drop a high-stakes promise for being said "right now".
const fn = read('supabase/functions/call-commitments/index.ts');
expect(/"stakes":"high"\|"normal"\|"low"/.test(fn), 'call-commitments no longer asks the model for stakes');
expect(/fuse and stakes are DIFFERENT questions/.test(fn), 'call-commitments no longer tells the model fuse and stakes are separate');
expect(/c\.fuse === "immediate" && c\.stakes !== "high"\) \{ await leave\(c, "in_the_moment"\)/.test(fn), 'the "in the moment" guard drops high-stakes promises again');
expect(/stakes: \["high","normal","low"\]\.includes\(c\.stakes\)/.test(fn), 'call-commitments no longer stores stakes');
expect(/c\.stakes === 'high'/.test(read('src/views/CommitmentReview.jsx')), 'the review card no longer says why a high-stakes follow-up is there');

// 2 — live: the floor rule, the trigger, and no high-stakes row hidden as immediate.
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (PAT) {
  const q = async (sql) => {
    for (let i = 0; i < 8; i++) {
      const r = await fetch('https://api.supabase.com/v1/projects/xlgfspnojjgvkuitcoaf/database/query', { method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 3000 * (i + 1))); continue; }
      const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
    }
    throw new Error('the database did not answer');
  };
  try {
    const cases = [
      ['Call title company to authorize key release to buyer at closing', 'high'],
      ['Reduce MLS listing price to $3,995,000', 'high'],
      ['Request a one-week due diligence extension', 'high'],
      ['Bradley to email the outcome of the call to the opposing attorney', 'high'],
      ['Drop off September and October rent check', 'high'],
      ['Return home in like 5 minutes', 'low'],
      ['I will call you right back', 'low'],
      ['Help Natasha hang clothes in the closet', 'normal'],
    ];
    const [r] = await q('select ' + cases.map(([t], i) => `public.commitment_stakes_rule('${t.replace(/'/g, "''")}') c${i}`).join(', '));
    cases.forEach(([t, want], i) => expect(r['c' + i] === want, `stakes rule: "${t}" reads as ${r['c' + i]}, expected ${want}`));

    // The trigger, proven on a row that never persists.
    const [t] = await q(`begin;
      with u as (select user_id from commitments limit 1),
      ins as (insert into commitments (user_id, owner, title, quote, status, fuse, dedupe_key)
        select user_id, 'me', v.title, v.quote, 'proposed', 'immediate', 'stakes-guard-' || v.k from u,
          (values ('a', 'Call title to release the keys at closing', 'let me call title right now'),
                  ('b', 'Head over to the office shortly', 'I will be there in five minutes')) v(k, title, quote)
        returning dedupe_key, fuse, stakes)
      select (select fuse || '/' || stakes from ins where dedupe_key = 'stakes-guard-a') hi,
             (select fuse || '/' || stakes from ins where dedupe_key = 'stakes-guard-b') lo;
      rollback;`);
    expect(t && t.hi === 'near/high', `a high-stakes promise said "right now" is stored as ${t && t.hi} — it would be hidden and set aside unwarned`);
    expect(t && t.lo === 'immediate/low', `"be there in five" is stored as ${t && t.lo} — the noise is back in the review list`);

    const [n] = await q(`select count(*)::int n from commitments where fuse = 'immediate' and stakes = 'high'`);
    expect(n.n === 0, `${n.n} high-stakes follow-up(s) are stored as 'immediate' — hidden from review and never warned`);
    const [u] = await q(`select count(*)::int n from commitments where stakes is null`);
    expect(u.n === 0, `${u.n} follow-up(s) have no stakes judgement`);
    const [cq] = await q(`select pg_get_functiondef('public.chief_queue(integer)'::regprocedure) ~ 'bool_or\\(c\\.stakes = ''high''\\)' ok`);
    expect(cq.ok, 'Today no longer puts a high-stakes call ahead of ordinary suggestions (chief_queue)');
  } catch (e) { problems.push('could not check the live rule: ' + e.message); }
} else if (!process.env.CI) problems.push('set SUPABASE_PAT to check the live stakes rule');

if (!problems.length) {
  console.log('==== STAKES: clean — stakes judged apart from fuse; a high-stakes promise is never hidden as "immediate"; the logistics still are ====');
  process.exit(0);
}
console.log(`==== STAKES: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
