#!/usr/bin/env node
// ── Fresh-account walk ───────────────────────────────────────────────────────
//
// FAILURE CONDITION: it has failed if a bare-account bug can ship again, or if
// the gate reports green while the app is firing hundreds of failed requests.
//
// WHY THIS EXISTS. Every other stage of the gate SEEDS data first, and everything
// verified by hand ran on Dara's account — 500 contacts, email connected, every
// feature on. No agent's first day looks like that, and that state was untested
// until it was walked once by hand. That single walk found two Today queries
// referencing columns that do not exist, inside empty catches, firing on every
// poll: 321 failed requests in two minutes, and two cards that had NEVER shown
// anything to any user since they were written.
//
// WHAT IT FAILS ON, and why the bar is exactly here:
//   PostgREST schema errors — 42703 undefined column, 42P01 undefined table,
//   42883 undefined function, PGRST202 no such function.
// A query naming a column that does not exist is NEVER correct. It cannot be a
// permission, a race, a cold cache or an empty table. That makes this check
// deterministic: no allowlist, no flake, no judgement call. A 403 might be
// legitimate RLS and a 404 might be a real absence, so neither fails the build.
//
// It also reports total failed requests without failing on them, because the
// COUNT is the smell even when each one is individually defensible.
//
// The account is created bare — no seed, no agents row, no user_settings — and
// deleted afterwards whatever happens.

import { chromium } from "playwright";

const URL = process.env.SMOKE_URL || "http://localhost:4173/";
const SUPA = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

if (!SUPA || !SERVICE) { console.log("FRESH ACCOUNT: skipped (no SUPABASE_URL / SUPABASE_SERVICE_KEY)"); process.exit(0); }

// Raw fetch against the auth admin API rather than supabase-js. Creating a
// supabase-js client here threw on CI ("Node.js 20 detected without native
// WebSocket support") because the client spins up a realtime socket we never
// use — green locally on Node 22, red on the runner. Every other stage in this
// gate already talks to the API over plain fetch; this one now matches.
const authHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const adminCreateUser = async (body) => {
  const r = await fetch(`${SUPA}/auth/v1/admin/users`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  if (!r.ok) return { data: null, error: new Error((json && (json.msg || json.message || json.error_description)) || `HTTP ${r.status}`) };
  return { data: { user: json }, error: null };
};
const adminDeleteUser = async (id) => {
  await fetch(`${SUPA}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: authHeaders });
};
const stamp = Date.now();
const email = `fresh_gate_${stamp}@example.com`;
const password = `Fg!${stamp}xY`;

const SCHEMA_CODES = ["42703", "42P01", "42883", "PGRST202", "PGRST204"];
let userId = null;
let failed = 0;

try {
  const { data: made, error: mkErr } = await adminCreateUser({
    email, password, email_confirm: true,
  });
  if (mkErr) throw new Error("could not create the throwaway account: " + mkErr.message);
  userId = made.user.id;

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  // A phone, because that is where an agent's first day happens.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const schemaErrors = [];
  const allBad = [];
  page.on("response", async (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    allBad.push(res.status() + " " + url.slice(0, 90));
    if (!/\/rest\/v1\//.test(url)) return;
    let body = "";
    try { body = await res.text(); } catch (_) { return; }
    for (const code of SCHEMA_CODES) {
      if (body.includes(`"${code}"`)) {
        let msg = body;
        try { msg = JSON.parse(body).message || body; } catch (_) {}
        const table = (url.split("/rest/v1/")[1] || "").split("?")[0];
        schemaErrors.push({ code, table, msg: String(msg).slice(0, 120) });
        return;
      }
    }
  });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 25000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByText("Sign In", { exact: true }).first().click();
  await page.waitForTimeout(9000);

  // Past the one interstitial a new agent meets, the way they would leave it.
  const later = page.getByText("Finish this later", { exact: false }).first();
  if (await later.count()) {
    await page.fill('input[placeholder*="call you" i]', "Gate Walker").catch(() => {});
    await later.click().catch(() => {});
    await page.waitForTimeout(7000);
  }
  // Let the polling screens run a full cycle — the bug this was built for only
  // showed up because Today re-queries on a timer.
  await page.waitForTimeout(9000);

  await browser.close();

  const uniq = new Map();
  for (const e of schemaErrors) uniq.set(e.table + e.code + e.msg, e);

  if (uniq.size) {
    console.error(`\n==== FRESH ACCOUNT: ${uniq.size} schema error(s) on a bare account ====`);
    for (const e of uniq.values()) {
      console.error(`  ✗ ${e.table} [${e.code}] — ${e.msg}`);
    }
    console.error(`\n    A query naming a column or table that does not exist is never correct.`);
    console.error(`    It fails on EVERY call, and if it sits in an empty catch nobody ever`);
    console.error(`    sees it — supabase-js resolves with { error } rather than throwing, so`);
    console.error(`    a try/catch cannot catch it. Check the error on the query itself.`);
    console.error(`    Total failed requests in this session: ${allBad.length}\n`);
    failed = 1;
  } else {
    console.log(`FRESH ACCOUNT: clean — a bare account loads with no schema errors (${allBad.length} failed request(s) total)`);
  }
} catch (err) {
  console.error("\n==== FRESH ACCOUNT: the walk itself failed ====");
  console.error("  " + String(err && err.message ? err.message : err));
  failed = 1;
} finally {
  // Always clean up, including when the walk threw.
  if (userId) { try { await adminDeleteUser(userId); } catch (_) {} }
}

process.exit(failed);
