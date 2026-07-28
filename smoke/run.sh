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

EMAIL="smoke_$(date +%s)_$RANDOM@example.com"; PASSWORD="Smoke!$(date +%s)$RANDOM"
echo "→ creating throwaway agent $EMAIL"
SUID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$SUID" ] || { echo "could not create smoke user"; exit 2; }
curl -s -X POST "$SUPABASE_URL/rest/v1/user_settings" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"user_id\":\"$SUID\",\"onboarding_complete\":true,\"display_name\":\"Smoke Test\"}" >/dev/null

# Give the account something to render. Without this every list shows its empty
# state and the gate only ever proves that views MOUNT — which is how a
# ReferenceError past the first render, and three large-font collisions, all
# shipped past a green run.
echo "→ seeding the throwaway agent"
SEED_USER_ID="$SUID" node smoke/seed.mjs || { echo "seed failed — the run below would prove nothing"; exit 2; }

cleanup() {
  kill "${SRV:-}" 2>/dev/null || true
  curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUID" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null || true
}
trap cleanup EXIT

python3 -m http.server 4173 --directory build >/tmp/smoke_httpd.log 2>&1 & SRV=$!
sleep 2
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
