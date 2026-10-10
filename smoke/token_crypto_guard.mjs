#!/usr/bin/env node
// ── Google tokens at rest: every reader can open them ────────────────────────
//
// email_accounts.access_token / refresh_token may be stored sealed
// ("enc:v1:...", _shared/googleTokens.ts, 8 Oct 2026). A function that reads
// them through a client WITHOUT withTokenCrypto() gets ciphertext, sends it to
// Google, gets invalid_grant, and the agent is told to reconnect for nothing.
// A function that WRITES them without it stores plain text again.
//
// THE RULE (static, no database): a function that touches email_accounts and a
// Google token field builds EVERY Supabase client with withTokenCrypto().
// The one exception is google-token-seal, which must see what is stored.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";
const RAW_ALLOWED = new Map([
  ["google-token-seal", "the backfill itself: reads and swaps the stored form on purpose"],
]);
// A Google token field, not a Supabase session's access_token.
const TOKEN_USE = /(?<!session\??\.)\b(refresh_token|access_token)\b/;

const bad = [];
let checked = 0;
for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
  const file = join(ROOT, dir.name, "index.ts");
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  if (!/["'`]email_accounts["'`]/.test(src)) continue;
  const code = src.replace(/\/\/[^\n]*/g, "");
  if (!TOKEN_USE.test(code)) continue;
  if (RAW_ALLOWED.has(dir.name)) continue;
  checked++;
  const calls = [...code.matchAll(/createClient\(/g)];
  for (const m of calls) {
    // Read up to the matching parenthesis.
    let depth = 1, i = m.index + m[0].length;
    while (depth && i < code.length) { if (code[i] === "(") depth++; else if (code[i] === ")") depth--; i++; }
    const args = code.slice(m.index, i);
    if (!args.includes("withTokenCrypto(")) {
      const line = code.slice(0, m.index).split("\n").length;
      bad.push(`${file}:${line} — createClient without withTokenCrypto() in a function that handles Google tokens`);
    }
  }
  if (!/from\s+["']\.\.\/_shared\/googleTokens\.ts["']/.test(src)) bad.push(`${file} — handles Google tokens but does not import _shared/googleTokens.ts`);
}

if (bad.length) {
  console.log(`==== TOKEN CRYPTO: FAILED — ${bad.length} place(s) would read or write Google tokens without the at-rest encryption ====`);
  for (const b of bad) console.log("  ✗ " + b);
  process.exit(1);
}
console.log(`==== TOKEN CRYPTO: clean — all ${checked} functions that handle Google tokens open and seal them (${RAW_ALLOWED.size} raw by reason) ====`);
