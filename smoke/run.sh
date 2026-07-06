#!/usr/bin/env bash
# Pre-deploy smoke check: builds (if needed), spins up the built app locally,
# logs in as a throwaway agent, visits every critical view, and fails if any
# view crashes. Run this BEFORE every gh-pages deploy.
#
# Requires these in the environment:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_URL:?set SUPABASE_URL}"; : "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"; : "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"
[ -d build ] || { echo "No build/ — run the build first."; exit 2; }

EMAIL="smoke_$(date +%s)_$RANDOM@example.com"; PASSWORD="Smoke!$(date +%s)$RANDOM"
echo "→ creating throwaway agent $EMAIL"
SUID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$SUID" ] || { echo "could not create smoke user"; exit 2; }
curl -s -X POST "$SUPABASE_URL/rest/v1/user_settings" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"user_id\":\"$SUID\",\"onboarding_complete\":true,\"display_name\":\"Smoke Test\"}" >/dev/null

cleanup() {
  kill "${SRV:-}" 2>/dev/null || true
  curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUID" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null || true
}
trap cleanup EXIT

python3 -m http.server 4173 --directory build >/tmp/smoke_httpd.log 2>&1 & SRV=$!
sleep 2
echo "→ running smoke check"
SMOKE_URL="http://localhost:4173/" SMOKE_EMAIL="$EMAIL" SMOKE_PASSWORD="$PASSWORD" node smoke/smoke.mjs
