#!/usr/bin/env bash
# Pre-deploy smoke check: builds (if needed), spins up the built app locally,
# logs in as a throwaway agent, visits every critical view, and fails if any
# view crashes. Run this BEFORE every gh-pages deploy.
#
# Requires these in the environment:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
set -euo pipefail
cd "$(dirname "$0")/.."

# Static guard: no React hooks after the App-shell guards (React #310 protection)
echo "→ static hooks-order check"
python3 smoke/hooks_check.py

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

: "${SUPABASE_URL:?set SUPABASE_URL}"; : "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"; : "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"
[ -d build ] || { echo "No build/ — run the build first."; exit 2; }

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
  [ -n "${SUID:-}" ] && curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUID" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null || true
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
curl -s -X POST "$SUPABASE_URL/rest/v1/user_settings" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"user_id\":\"$SUID\",\"onboarding_complete\":true,\"display_name\":\"Smoke Test\"}" >/dev/null

# Give the account something to render. Without this every list shows its empty
# state and the gate only ever proves that views MOUNT — which is how a
# ReferenceError past the first render, and three large-font collisions, all
# shipped past a green run.
echo "→ seeding the throwaway agent"
SEED_USER_ID="$SUID" node smoke/seed.mjs || { echo "seed failed — the run below would prove nothing"; exit 2; }

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
echo "→ running functional gate (multi-device)"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/functional.mjs

# Prove failed writes are actually reported. supabase-js resolves with { error }
# instead of throwing, so a discarded mutation is invisible; dataService.js wraps
# from() to catch that. This drives a REAL failing write and asserts it surfaced —
# a reporting layer that quietly does nothing is worse than none.
echo "→ mutation-error reporting"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/mutation_guard.mjs
