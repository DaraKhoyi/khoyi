#!/usr/bin/env node
// ── Edge function auth guard ─────────────────────────────────────────────────
//
// Three security holes shipped this week, all in edge functions, all invisible to
// a gate that only drives the browser. This encodes the exact pattern:
//
//   contact-find-recordings ran as SERVICE ROLE (bypassing RLS) and read user_id
//   from the request BODY. A brand-new agent account passed the owner's user_id
//   and got back one of his contacts by name. Any agent could read any other
//   agent's contacts, transcripts and recordings.
//
//   day-review and plan-my-day had verify_jwt=false and took user_id from the
//   body. Not a data leak — they are handed their payload — but anyone with the
//   PUBLIC anon key could spend Anthropic tokens on the brokerage's bill and
//   attribute the cost to any agent they named.
//
// THE RULE: verify_jwt proves SOME valid token was presented. It never proves
// WHOSE. Any function that acts on behalf of a user must establish the caller
// itself — from the token — and must never trust an identity in the body.
//
// This check is STATIC on purpose. A live probe would have to POST to 135
// functions, and the ones that send email or SMS would actually send. Static
// analysis catches the same class with no side effects and runs in a second.
//
// It flags the COMBINATION, not any single trait:
//   uses service role  +  takes an identity from the body  +  never derives the
//   caller from the token
// Any one alone is fine. Together they are the bug that shipped three times.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";
if (!existsSync(ROOT)) { console.log("EDGE AUTH GUARD: no functions directory"); process.exit(0); }

// Functions that legitimately take an id from the body. Each needs a REASON, and
// the reason must be one of: it is called only by pg_cron with the service role
// and is not reachable with a user token; or it is a public portal whose whole
// job is to serve someone with no account, protected by an unguessable token.
const ALLOWED = new Map([
  ['notify-optout', 'One-click unsubscribe from a lead-notification email. The caller is a mail ' +
    'client, not a session, so the random token IS the authorisation — it maps to exactly one ' +
    'notification_prefs row. The only thing it can do is set email_new_leads = false: it cannot ' +
    'read the agent\'s data, act as them, or turn anything back on. A leaked token is worth ' +
    'silencing one notification the person can have restored by asking.'],
  // pg_cron / server-to-server only
  ["lead-notify", "pg_cron only; sweeps every agent's new leads. Rejects anything without the service key or QCP token, and takes the recipient from the lead row it read, never from the request body"],
  ["disc-batch-nightly", "pg_cron only; iterates every user by design"],
  ["usage-report-monthly", "pg_cron only; reports across all users"],
  ["google-contacts-sync", "runs per-account from a cron sweep"],
  ["lead-concierge", "invoked server-side by gmail-sync/quo-webhook, not by the app"],
  ["quo-webhook", "inbound webhook from Quo; no user session exists"],
  ["call-commitments", "server-side pass over call records"],
  ["call-enrich", "server-side pass over call records"],
  ["crash-monitor", "pg_cron only, verify_jwt=false; sweeps client_errors across all users"],
  ["email-nightly-intel", "pg_cron only, verify_jwt=false; nightly pass over every mailbox"],
  ["investor-notify", "server-side alert fan-out; not reachable from the app"],
  ["sheets-sync", "cron sweep plus an admin-triggered refresh; operates on the brokerage sheet, not a user's rows"],
  ["investor-intake", "public buy-box form; the signed intake token is the credential"],
  ["recording-identify", "invoked from the app WITH a token; id is a recording, not an identity"],
  // public portals — identity IS the unguessable token in the URL
  ["sign-portal", "public signing portal; the token is the credential"],
  ["booking-availability", "public booking page; no account exists"],
  ["booking-create", "public booking page; no account exists"],
  ["investor-portal", "public investor portal; signed token is the credential"],
  ["unstuck-portal", "public seller portal; signed token is the credential"],
  ["investor-transition-answer", "public one-tap answer; signed token is the credential"],
]);

const IDENTITY_IN_BODY = /\b(user_id|owner_id|agent_id|agent_user_id)\b\s*[,}=:]/;
const DERIVES_CALLER = /auth\.getUser\s*\(|getUser\s*\(\s*\)|decodeJwt\s*\(|is_brokerage_staff/;
const SERVICE_ROLE = /SUPABASE_SERVICE_ROLE_KEY/;
const READS_BODY = /await\s+req\.json\s*\(/;

const problems = [];
const allowedSeen = [];

for (const name of readdirSync(ROOT)) {
  const file = join(ROOT, name, "index.ts");
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  const raw = readFileSync(file, "utf8");
  // Strip comments so a comment ABOUT user_id is not read as code using it —
  // the same false-positive that produced phantom dependency cycles elsewhere.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  if (!SERVICE_ROLE.test(src)) continue;      // no elevated rights, no escalation
  if (!READS_BODY.test(src)) continue;        // takes nothing from the caller
  if (!IDENTITY_IN_BODY.test(src)) continue;  // takes no identity from the caller
  if (DERIVES_CALLER.test(src)) continue;     // establishes the caller properly

  if (ALLOWED.has(name)) { allowedSeen.push(name); continue; }
  problems.push(
    `${name} — runs as SERVICE ROLE, takes an identity from the request body, and never\n` +
    `    establishes the caller from the token. That is the exact shape of the\n` +
    `    contact-find-recordings leak: any signed-in agent can name someone else's\n` +
    `    user_id and act as them, because service role bypasses RLS.\n` +
    `    Fix: derive the id from auth.getUser() and ignore the body's copy. If this\n` +
    `    function is genuinely cron-only or a public portal, add it to ALLOWED in\n` +
    `    smoke/edge_auth.mjs WITH THE REASON.`
  );
}

if (problems.length) {
  console.error(`\n==== EDGE AUTH GUARD: ${problems.length} function(s) trust the caller's own claim ====`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`EDGE AUTH GUARD: clean — no function trusts a body-supplied identity (${allowedSeen.length} allowed by reason)`);
