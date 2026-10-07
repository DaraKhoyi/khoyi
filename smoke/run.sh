#!/usr/bin/env bash
# Pre-deploy smoke check: builds (if needed), spins up the built app locally,
# logs in as a throwaway agent, visits every critical view, and fails if any
# view crashes. Run this BEFORE every gh-pages deploy.
#
# Requires these in the environment:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
set -euo pipefail
cd "$(dirname "$0")/.."

# ── WHICH CHECK? (Dara, 5 Oct 2026: "Yes, add a fast lane") ───────────────────
# smoke/lane.mjs reads what actually changed. Only wording, layout, comments or
# the version label → fast. Anything else, or anything it cannot read → full.
# Nobody can ask for the fast lane; GATE_LANE=full forces the full check.
# FAST still runs: every static check, the code-reading half of the live
# checks, the fresh-account walk, every screen mounting, and the large-font
# layout check. FAST skips: checks that only read the live database (nothing
# there changed), the functional walk, and the mutation check.
LANE="$(node smoke/lane.mjs)"; [ "$LANE" = fast ] || LANE=full
echo "→ release check lane: $LANE"
# guard <name> [static] — a live check. In the fast lane only the ones that have
# a code-reading half run, with database access withheld so only that half runs.
guard() {
  if [ "$LANE" = full ]; then node "smoke/$1.mjs" || exit 1
  elif [ "${2:-}" = static ]; then SUPABASE_SERVICE_KEY= SUPABASE_PAT= node "smoke/$1.mjs" || exit 1
  fi
}
# The lane rule cannot be fooled into carrying a change to logic. Both lanes.
node smoke/lane_test.mjs

# Static guard: no React hooks after the App-shell guards (React #310 protection)
echo "→ static hooks-order check"
python3 smoke/hooks_check.py

# The clock. New York time is a correctness property, not a preference: a date
# that differs by a day between Tampa and Tokyo, or shifts an hour at a DST
# boundary, is wrong for every user at once and invisible for months.
node smoke/clock_check.mjs

# Icons: a name with no matching icon falls back to a star silently, so tabs go
# identical without anything failing. Found the hard way in the Money room.
node smoke/icon_check.mjs

# Work that was done and cannot be seen: data loaded and never rendered, a
# handler wired to a function that no longer exists. Static, no credentials.
node smoke/dead_ui.mjs

# Did the version label actually move? It sat at v1.08.45 across five commits
# while every report claimed otherwise. Passes trivially in CI (HEAD is the
# commit being built); it bites locally, before the push.
node smoke/version_bump.mjs


# Readers left behind by a removed mechanism. Needs the Management API, so it is
# skipped where SUPABASE_PAT is absent rather than failing the run.
# Clean up after runs that died before their cleanup, and assert the field
# catalogue is still ONE shared set. Runs FIRST: a purge is worth most before
# the next throwaway account is created.
if [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then node smoke/test_hygiene.mjs || exit 1; fi

if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then node smoke/stale_readers.mjs; fi

# Scheduled jobs: errored, gone quiet, or "succeeded" while the HTTP call behind
# them failed. Also needs the Management API.
if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then node smoke/cron_health.mjs; fi

# Parts of the schema the app stopped using. Reports, never blocks — drift is a
# decision, and "keep it, we need it next quarter" is a legitimate answer.
if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then node smoke/schema_drift.mjs; fi

# One-off backup tables belong in the `archive` schema, never next to the live
# tables where a report can count them twice. BLOCKS. (Panel, 26 Sep: eleven
# snapshots had piled up in public, one of them financial.)
if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then node smoke/snapshot_quarantine.mjs; fi

# Definer functions whose owner check a signed-out caller skips ("auth.uid() is
# not null and ..."), and sensitive columns on tables other agents can read
# through sharing, and credentials (Google tokens, iCloud password) readable by
# the browser. BLOCKS. (27 Sep: set_tax_id + merge_contacts; the panel's
# contacts.tax_id_last4 and iCloud key.) Its static half runs without a PAT.
if [ "$LANE" = full ]; then node smoke/definer_guard.mjs; else SUPABASE_PAT= node smoke/definer_guard.mjs; fi

# Every deployed edge function has source here, and config.toml's verify_jwt
# matches live — or the next deploy flips it and locks out a cron caller. BLOCKS.
if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then node smoke/function_config.mjs; fi

# Crash-shaped and orphaned records in live data. BLOCKS. HANDOFF.md listed this
# as a gate guard for weeks while nothing here ran it — wired in 26 Sep.
if [ "$LANE" = full ] && [ -n "${SUPABASE_PAT:-}" ]; then SUPA_PAT="$SUPABASE_PAT" node smoke/data_integrity.mjs; fi

# Static guard: no undefined identifiers. The runtime smoke check proves views
# MOUNT; it cannot prove every branch inside them runs, because the throwaway
# agent has no data. v1.04.49 shipped a ReferenceError straight past a green
# gate for exactly that reason.
echo "→ static scope check"
node smoke/scope_check.mjs

# Static guard: App.js size ratchet. Keeps the strangle-the-monolith win permanent —
# App.js can shrink or hold but never balloon, and new screens cannot be jammed into
# it (they belong in their own file). See smoke/appjs_budget.mjs.
echo "→ App.js size ratchet"
node smoke/appjs_budget.mjs

# Every menu leaf with a route must be in builtSet, or the menu greys it out and
# swallows the click. Unstuck. shipped unreachable behind a green 26/26 gate
# because the smoke run navigates by view directly and never touches the menu.
echo "→ menu reachability"
node smoke/menu_reachable.mjs

# Static guard: iOS single-tap. Every :hover rule must sit inside a hover-capability
# media query, and every inline onMouseEnter must be gated by canHover(). Otherwise
# iPhone users have to tap twice — the bug Josh hit, which affected the whole menu.
echo "→ iOS tap guard"
node smoke/hover_guard.mjs

# The tuning fork answers one tap — including the tap iOS cancels mid-gesture
# (Josh, third report, 1 Oct). Drives the real handlers through iPhone event orders.
echo "→ fork one-tap"
node smoke/fork_tap.mjs || exit 1

# The app stays calm: Dara's eight and More, dots not counts, three on Today, this week in
# the Inbox, importance before any nudge (Josh + Dara, 1 Oct). BLOCKS.
echo "→ calm"
node smoke/calm_guard.mjs || exit 1

# Every menu entry has its own picture, and every picture exists (Dara, 5 Oct).
node smoke/menu_icons.mjs || exit 1
# The calendar day scrolls to its end; same-time events never overprint (Dara, 5 Oct).
node smoke/calendar_guard.mjs || exit 1
# Money opens on the check register; payee match, sticky date, search, balances.
node smoke/money_register_guard.mjs || exit 1
# The public booking page can always be finished (Josh, 6 Oct 2026).
node smoke/booking_guard.mjs || exit 1
# One repeat rule, one day rule, Google's rule kept (Dara, 6 Oct 2026).
node smoke/recurrence_guard.mjs || exit 1

# Static guard: a component defined INSIDE another is a new type every render, so
# React remounts its subtree. With a text input inside, the caret jumps to 0 after
# every keystroke — the note-editing bug Dara hit.
echo "→ nested component guard"
node smoke/nested_component_guard.mjs

# Static guard: a \uXXXX escape inside JSX TEXT is not an escape — JSX text is
# not a string literal, so the user sees the seven characters "\u00B7". Dara
# photographed exactly that in production ("NEW LEAD \u00B7 REPLY READY"), and
# its first run found five more live instances including the iOS push-setup
# copy every iPhone agent reads.
echo "→ JSX escape guard"
node smoke/jsx_escapes.mjs

# Static guard: no edge function may trust an identity supplied in the request
# body while running as service role. Three security holes shipped this week in
# exactly that shape, all invisible to a gate that only drives the browser.
echo "→ edge function auth guard"
node smoke/edge_auth.mjs

# Every edge function file must PARSE — the gate built the app but never the
# functions, and property-research failed to deploy for a week unnoticed.
node smoke/edge_parse.mjs

# Every function that spends AI credit records it against the user (standing
# rule; 8 functions had been spending unrecorded). Static, runs in CI too.
node smoke/ai_cost_guard.mjs

# A new version never reloads the app by itself (Dara lost a note to an
# automatic update, 28 Sep). Static, runs in CI too.
node smoke/no_forced_update.mjs || exit 1

: "${SUPABASE_URL:?set SUPABASE_URL}"; : "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"; : "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"
[ -d build ] || { echo "No build/ — run the build first."; exit 2; }

# What can a stranger read with only the public key (it ships inside the app)?
# On 27 Sep five database functions handed out agents' response records,
# testers' contact details and the company's financials. Calls every exposed
# function as anon; any real data in the answer blocks the push.
guard anon_exposure

# The PrismOS connector for Claude (prism-mcp): signs in the way Claude does,
# calls the tools as a throwaway user, and proves RLS and every gate still hold.
guard mcp_connector

# Talk to Prism (the home-screen voice screen's brain): answers from the
# person's own data, refuses strangers, and never changes anything without a yes.
guard talk_to_prism

# Where closings came from (closing_attribution): plants known closings in 1999
# and checks each is tied to the right client, source and speed to lead.
guard lead_attribution

# Brokerage-wide sender mutes: the browser cannot set one; one agent or a
# lead-source address is refused; every live one meets the gate.
guard brokerage_mute_guard

# Suggestions never pile up: stale call suggestions are set aside on schedule,
# one Chief of Staff list at a time (panel, 29 Sep).
guard close_the_loop

# An email deleted in Gmail or in PrismOS stops asking for a reply (Josh, 29 Sep).
guard deleted_email
guard open_reads
# A lead alert reaches a phone, or that person is skipped; a Gmail answer counts (Marguerite, 29 Sep).
guard lead_reaches_a_person
# Every AI call names who (or which deal) it was about (Archivist + Merchant, 30 Sep).
guard ai_subject_guard
# A lead card knows who just asked the moment it lands (Simplifier + Marguerite + Newcomer, 30 Sep).
guard who_just_asked
# No SSN, tax ID, card or bank number reaches an AI model (Sentinel + Fiduciary, 30 Sep).
guard ai_guard static
# A successful Google reconnect clears "needs reconnecting" at once (Dara, 30 Sep).
guard reconnect_clears static
# "Can they transact?" from their own words, with receipts (Marguerite, 30 Sep).
guard can_they_transact
# A "whole brokerage" library file opens for every agent (Dara, 30 Sep).
guard library_shared
# "What did I say last time" — plainly; never elapsed time or a score (Ray, 30 Sep).
guard last_time
# A follow-up from a call is never set aside without one chance to keep it (Marguerite + Skeptic, 1 Oct).
guard warn_before_set_aside static
# What is at stake decides whether a follow-up may be hidden; high stakes is never 'immediate' (Skeptic + Ray, 2 Oct).
guard stakes_guard
# One agent can never reach another agent's mailbox: owner-only policies, proven with two logins (Sentinel, 1 Oct).
guard credential_scope
# Nothing an agent sees counts what they did not do (Ray, 1 Oct).
guard no_failure_ledger static
# Nothing disappears without a line the person can read and undo (Dara + Ray, 4 Oct).
guard record_guard static
# A level is only offered where a job obeys it (Dara, 4 Oct).
guard dial_guard static
# The day's goals belong to the person and are never a score (Dara, 4 Oct).
guard goals_guard static
# One gate for every notification; what PrismOS learns can be read, forgotten and reset (Dara, 4 Oct).
guard triage_guard static
# The morning note is short and never a count (Dara, 4 Oct: "overwhelmed by all the stuff").
guard morning_note_guard static
# The PRISM Edge is a starting guess the person can see and change; never a verdict (decisions 1, 2, 3, 9).
guard prism_edge_guard static
# Only the people on a book's list can read or change it; being Broker or Broker Admin opens nothing;
# a switched-off assistant is out on their next tap. Proven with three sign-ins, for every accounting table (Dara, 6 Oct).
guard books_guard static
# Under the checkbook, a double-entry ledger: balanced or rejected by any path, whole cents, corrections keep
# their history, nobody writes it directly, and every set of books ties out (Dara, 6 Oct, build prompt part 3).
guard ledger_guard static
# Statements: nothing imported reaches the books unapproved, a statement that is off posts nothing, duplicates are
# shown, and only a rule a person confirmed files by itself (Dara, 6 Oct, build prompt part 4).
guard statements_guard static
# Reconciliation finishes only at zero and then locks its entries; the reports add up and say the same thing on
# screen, in the file and on paper (Dara, 6 Oct, build prompt part 5).
guard reports_guard static

# Preflight: the browser must actually exist. Without this the node step dies with a
# wall of stack trace, and if the CALLER pipes our output (e.g. `| tail`) the exit
# code gets masked and the deploy proceeds on a gate that never ran. A gate that
# silently passes is worse than no gate at all.
CHROME_PATH="$(node -e "try{process.stdout.write(require('playwright').chromium.executablePath())}catch(e){}" 2>/dev/null || true)"
if [ -z "$CHROME_PATH" ] || [ ! -e "$CHROME_PATH" ]; then
  echo "" >&2
  echo "✗ SMOKE GATE CANNOT RUN — Playwright's chromium is not installed." >&2
  echo "  This is NOT a pass. Install it, then re-run:" >&2
  echo "      npx playwright install chromium" >&2
  echo "" >&2
  exit 2
fi

# The web server must be up BEFORE any stage that drives a browser. The
# fresh-account walk below is one of them: it used to sit above this line and
# could therefore never pass (ERR_CONNECTION_REFUSED), which held v1.07.24 and
# v1.07.25 out of production. SUID is still empty here; cleanup tolerates that.
cleanup() {
  kill "${SRV:-}" 2>/dev/null || true
  # Delete the throwaway's ROWS before the auth user. Deleting only the auth user
  # left its seeded agents/contacts behind, so every gate run added a permanent
  # "Jo Ng" to the agents table — four accumulated in one morning.
  if [ -n "${SUID:-}" ]; then
    for t in agents contacts; do
      curl -s -X DELETE "$SUPABASE_URL/rest/v1/$t?user_id=eq.$SUID" \
        -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null || true
    done
    curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUID" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null || true
  fi
}
trap cleanup EXIT

python3 -m http.server 4173 --directory build >/tmp/smoke_httpd.log 2>&1 & SRV=$!
sleep 2

# A BARE account — no seed, no agents row, no settings — walked on a phone.
# Every other stage seeds data first, so day-one was the one state nothing tested.
# Its first run found two Today queries naming columns that do not exist, inside
# empty catches, firing on every poll: two cards that had never worked for anyone.
# Runs BEFORE seed.mjs deliberately; seeding first would hide exactly this.
# (It creates and deletes its own bare user, separate from the smoke agent.)
echo "→ fresh-account walk"
node smoke/freshaccount.mjs

EMAIL="smoke_$(date +%s)_$RANDOM@example.com"; PASSWORD="Smoke!$(date +%s)$RANDOM"
echo "→ creating throwaway agent $EMAIL"
# Retry: the Supabase auth admin API occasionally returns an empty/non-JSON body
# on a transient blip. A single attempt piped into json.load nuked the whole gate
# (JSONDecodeError) — the same failure mode the key-mint step already guards. Try
# up to 3 times with backoff before giving up.
SUID=""
for attempt in 1 2 3; do
  RESP=$(curl -s -w '\n%{http_code}' -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")
  CODE=$(printf '%s' "$RESP" | tail -n1)
  BODY=$(printf '%s' "$RESP" | sed '$d')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    SUID=$(printf '%s' "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  fi
  [ -n "$SUID" ] && break
  echo "→ could not create smoke user (HTTP $CODE), attempt $attempt/3; retrying in $((attempt * 10))s"
  sleep $((attempt * 10))
done
[ -n "$SUID" ] || { echo "✗ SMOKE GATE CANNOT RUN — could not create a throwaway agent from the Supabase auth API after 3 attempts (last HTTP $CODE). This is an upstream/transient issue, not a code failure; re-run the job."; exit 2; }
# UPSERT, not INSERT. A trigger on auth.users already creates this row, so a
# plain POST hits a primary-key conflict, fails silently behind >/dev/null, and
# leaves onboarding_complete at its default of FALSE. That was survivable while
# first-run was a dismissible form; once FirstRun became a full-screen overlay it
# covered the app, and the one large-font probe that CLICKS anything — lp_editor
# — timed out. The gate went red for a reason that had nothing to do with the
# code under test, which is the worst kind of red.
curl -s -X POST "$SUPABASE_URL/rest/v1/user_settings" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "{\"user_id\":\"$SUID\",\"onboarding_complete\":true,\"display_name\":\"Smoke Test\"}" >/dev/null

# And prove it took. A silent setup failure that only shows up 200 lines later as
# a click timeout costs more to diagnose than this check costs to run.
OB=$(curl -s "$SUPABASE_URL/rest/v1/user_settings?user_id=eq.$SUID&select=onboarding_complete" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" | grep -o 'true' | head -1)
if [ "$OB" != "true" ]; then
  echo "✗ SMOKE SETUP FAILED — onboarding_complete is not true for the throwaway user." >&2
  echo "  Every probe that clicks would hit the first-run overlay and time out." >&2
  exit 2
fi

# Give the account something to render. Without this every list shows its empty
# state and the gate only ever proves that views MOUNT — which is how a
# ReferenceError past the first render, and three large-font collisions, all
# shipped past a green run.
echo "→ seeding the throwaway agent"
SEED_USER_ID="$SUID" node smoke/seed.mjs || { echo "seed failed — the run below would prove nothing"; exit 2; }

# An app opened on an old saved copy loads the current build, once, never over typing (Dara, 2 Oct).
echo "→ stale saved copy heals itself"
SMOKE_URL="http://localhost:4173/" node smoke/stale_shell.mjs || exit 1

echo "→ running smoke check"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/smoke.mjs

# Large system font. This exact failure has shipped three times (hamburger
# v1.03.13, Inbox pills v1.03.28, Edit Task header v1.04.47) and was caught by a
# user every time. Writing the lesson down did not work; measuring does.
echo "→ large-font layout check"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/largefont.mjs

# ── FUNCTIONAL gate (v1.04.98+) ──────────────────────────────────────────────
# The mount checks above prove views RENDER. This proves core features WORK, as a
# logged-in agent, across iPhone/Android/tablet/desktop viewports — the gap that
# let a broken research flow ship green and embarrass the beta.
[ "$LANE" = full ] && echo "→ running functional gate (multi-device)"
# Can a thumb hit it? REPORTS, does not block — yet.
#
# It found 111 real controls under 44px and that part works. What does not, yet,
# is a baseline that holds across environments: this machine sees 111 and CI sees
# 112 on the same commit, because which cards render depends on the seeded
# content and the time of day. Blocking on a set I cannot reproduce in CI would
# fail deploys for no reason, and the cure for that is always to loosen the
# check until it means nothing.
#
# So it prints every run and blocks none. Drop the `|| true` once the baseline is
# identical in both places — the list is in smoke/touch_budget.json and the
# failure mode to fix is which controls differ, not how many.
if [ "$LANE" = fast ]; then echo "→ fast lane: the functional walk and the mutation check are skipped (no logic changed)"; echo "==== RELEASE CHECK: fast lane passed ===="; exit 0; fi
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/touch_targets.mjs || true

SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/functional.mjs

# Prove failed writes are actually reported. supabase-js resolves with { error }
# instead of throwing, so a discarded mutation is invisible; dataService.js wraps
# from() to catch that. This drives a REAL failing write and asserts it surfaced —
# a reporting layer that quietly does nothing is worse than none.
echo "→ mutation-error reporting"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/mutation_guard.mjs
