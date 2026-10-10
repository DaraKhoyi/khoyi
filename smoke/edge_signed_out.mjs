#!/usr/bin/env node
// ── Signed-out edge probe (security audit M6, 9 Oct 2026) ────────────────────
//
// verify_jwt = true is not a login check: the PUBLIC anon key (it ships inside
// the app) is a valid JWT, so the gateway lets it through. The only proof that
// a function is closed is to call it the way a stranger can and watch it say no.
//
// LIVE (needs SUPABASE_URL + SUPABASE_ANON_KEY): POSTs `{}` to every function
// in supabase/functions with only the anon key, and BLOCKS if any answers 2xx.
// It also sends `x-guard-probe: 1`, so a function on _shared/guard.ts that
// somehow let the caller through would answer without running its job.
// Functions on PUBLIC below are NOT called at all (no side effects on a portal
// or a webhook); each needs a reason a stranger is meant to reach it.
// STATIC (always): every PUBLIC entry still exists, so the list cannot rot.
//
// First run, 9 Oct 2026: ai-note-cleanup (spent AI credit for anyone),
// anthropic-status and github-status answered 200 signed out. Fixed in the same PR.

import { readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "supabase/functions";
const PUBLIC = new Map([
  ["booking-availability", "public booking page: free/busy slots for a booking link, no client data"],
  ["booking-get", "public booking page: reads one booking link by its slug"],
  ["booking-create", "public booking page: a client books a slot; validates the link and the slot"],
  ["calendar-ics-feed", "calendar apps fetch it with the secret feed token in the URL"],
  ["dropbox-oauth-callback", "OAuth redirect from Dropbox; trusts only a signed state"],
  ["gmail-oauth-callback", "OAuth redirect from Google (legacy); trusts only a signed state"],
  ["google-oauth-callback", "OAuth redirect from Google; trusts only a signed state"],
  ["investor-intake", "public investor intake form reached by an agent's link code"],
  ["investor-transition-answer", "a client answers a transition notice by its unguessable token"],
  ["investor-portal", "client portal, unguessable portal code"],
  ["sign-portal", "e-sign portal, unguessable signing token"],
  ["unstuck-portal", "seller portal, unguessable token"],
  ["listing-present", "shared listing presentation, unguessable share id"],
  ["ios-ingest", "iOS Shortcut ingest, per-user ingest token"],
  ["notify-optout", "one-click unsubscribe; the random token is the authorisation"],
  ["track-open", "email open pixel; records an open for a random id, returns a GIF"],
  ["quo-webhook", "Quo (OpenPhone) webhook; verifies the Quo signature"],
  ["gmail-push", "Google Pub/Sub push; verifies the Google OIDC token"],
]);

const fns = readdirSync(ROOT).filter((d) => !d.startsWith("_") && !d.startsWith(".") && statSync(`${ROOT}/${d}`).isDirectory()).sort();
let bad = 0;
for (const name of PUBLIC.keys()) {
  if (!fns.includes(name)) { console.log(`  ✗ PUBLIC list names ${name}, which has no folder; remove it`); bad++; }
}

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.log(`EDGE SIGNED-OUT PROBE: static only (${PUBLIC.size} public, ${fns.length - PUBLIC.size} to probe live)${bad ? ", FAILED" : ", clean"}`);
  process.exit(bad ? 1 : 0);
}

const targets = fns.filter((f) => !PUBLIC.has(f));

// A function changed by THIS change is still the old code in production until
// deploy-functions runs after the merge, so its live answer cannot judge the fix.
// Those are reported, not blocked. Base: the PR's merge base with origin/main,
// plus the commit before HEAD (covers the main-branch run racing the deploy).
function changedFns() {
  const out = new Set();
  for (const range of ["$(git merge-base origin/main HEAD)..HEAD", "HEAD~1..HEAD", "HEAD"]) {
    try {
      const cmd = range === "HEAD" ? "git diff --name-only HEAD" : `git diff --name-only ${range}`;
      for (const f of execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: "/bin/bash" }).split("\n")) {
        const m = f.match(/^supabase\/functions\/([^/_][^/]*)\//);
        if (m) out.add(m[1]);
      }
    } catch { /* shallow clone or no git: nothing is pending */ }
  }
  return out;
}
const pending = changedFns();
const pendingOpen = [];
const open = [], crashed = [], unreachable = [];
async function probe(fn) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(`${URL_}/functions/v1/${fn}`, {
      method: "POST", signal: ctl.signal,
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", "x-guard-probe": "1" },
      body: "{}",
    });
    const body = (await r.text()).slice(0, 120).replace(/\s+/g, " ");
    if (r.status >= 200 && r.status < 300) (pending.has(fn) ? pendingOpen : open).push(`${fn} → ${r.status} ${body}`);
    else if (r.status >= 500) crashed.push(`${fn} → ${r.status}`);
    else if (r.status === 404) unreachable.push(`${fn} → 404 (not deployed?)`);
  } catch (e) {
    unreachable.push(`${fn} → ${e.name === "AbortError" ? "timeout" : e.message}`);
  } finally { clearTimeout(t); }
}
const queue = [...targets];
await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) await probe(queue.shift()); }));

for (const l of open) console.log(`  ✗ OPEN to signed-out callers: ${l}`);
for (const l of pendingOpen) console.log(`  ! open in production, fixed in this change (re-checked after deploy): ${l}`);
for (const l of crashed) console.log(`  ! 5xx before auth (advisory, check it fails closed): ${l}`);
for (const l of unreachable) console.log(`  ! advisory: ${l}`);
bad += open.length;
console.log(`EDGE SIGNED-OUT PROBE: ${targets.length} probed, ${open.length} open, ${pendingOpen.length} open-but-fixed-here, ${crashed.length} 5xx, ${PUBLIC.size} public skipped${bad ? " — FAILED" : " — clean"}`);
process.exit(bad ? 1 : 0);
