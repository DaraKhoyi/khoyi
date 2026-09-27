// ai_cost_guard.mjs — every edge function that spends AI money records it.
//
// Dara's standing rule (see _shared/aiUsage.ts): every function spending tokens
// on a user's behalf logs the cost to ai_usage_log against that user. On 26 Sep
// EIGHT functions were found spending with no record at all — ari-briefing,
// ari-call-prep, disc-readout, email-to-task, myvoice-synthesize,
// sync-agent-profiles, task-email-ingest, and the briefing's OpenAI voicemail.
// They were the functions that had lived outside this repo, so no review ever
// saw them. Three of them also had no caller check, so anyone could spend the
// credit. A rule in a comment did not hold; a check that runs does.
//
// Passes a function if it calls an AI endpoint AND references a logger
// (logAiUsage / logEmbeddingUsage / logTtsUsage) or writes ai_usage_log itself.
// EXEMPT is the documented list of system functions with no billable agent.
// Static, no key needed — runs in CI too. BLOCKS.
//
// Usage: node smoke/ai_cost_guard.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'supabase/functions';
const EXEMPT = {
  'ai-key-manage': 'pings a key to validate it',
  'crash-monitor': 'system monitor, no agent',
  'propose-patch': 'developer tooling',
  'ai-note-cleanup': 'system maintenance',
  'anthropic-status': '1-token health ping',
};
const SPENDS = /api\.anthropic\.com\/v1\/messages|api\.openai\.com\/v1\/(embeddings|audio|chat|responses)/;
const LOGS = /logAiUsage|logEmbeddingUsage|logTtsUsage|ai_usage_log/;

const read = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? read(p) : /\.(ts|js|mjs)$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
});

const bad = [];
let spenders = 0;
for (const fn of fs.readdirSync(ROOT).filter((d) => !d.startsWith('_') && fs.statSync(path.join(ROOT, d)).isDirectory())) {
  const src = read(path.join(ROOT, fn)).join('\n');
  if (!SPENDS.test(src)) continue;
  spenders++;
  if (EXEMPT[fn]) continue;
  if (!LOGS.test(src)) bad.push(fn);
}
if (!bad.length) {
  console.log(`==== AI COST: clean — all ${spenders} AI-calling functions record their cost (${Object.keys(EXEMPT).length} documented exemptions) ====`);
  process.exit(0);
}
console.log(`==== AI COST: ${bad.length} function(s) spend AI credit and record NOTHING ====`);
for (const b of bad) console.log(`  ✗ ${b}`);
console.log('  Import logAiUsage (or logEmbeddingUsage / logTtsUsage) from ../_shared/aiUsage.ts and log');
console.log('  against the billing user. Genuinely system-only? Add it to EXEMPT with the reason.');
process.exit(1);
