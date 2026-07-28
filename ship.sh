#!/usr/bin/env bash
# ship.sh — the safe build+gate path from BUILD_PROCESS.md, in one command.
# Runs scope-check → build → full gate, and STOPS on the first red. It does NOT
# push (that's your deliberate final step) — it proves the change is safe to push.
#
# Usage:  bash ship.sh
# Requires env: REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
set -euo pipefail

say() { printf "\n\033[1;33m▸ %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }

# 0. sanity: are we in a fresh clone on main?
[ -f src/version.js ] || fail "Not in the repo root (no src/version.js)."
VER=$(grep -o "v[0-9][0-9.]*" src/version.js | head -1)
say "Building PrismOS $VER"

# 1. scope check
say "Step 1/4 — scope check"
node smoke/scope_check.mjs | tail -1 | grep -q "clean" || fail "Scope check found undefined identifiers. Fix before shipping."

# 2. build
say "Step 2/4 — build"
: "${REACT_APP_SUPABASE_URL:?set REACT_APP_SUPABASE_URL}"
: "${REACT_APP_SUPABASE_ANON_KEY:?set REACT_APP_SUPABASE_ANON_KEY}"
GENERATE_SOURCEMAP=false CI=false npx vite build 2>&1 | tail -2 | grep -q "built" || fail "Build failed."

# 3. gate
say "Step 3/4 — the gate (scope, smoke, large-font, functional multi-device)"
export SUPABASE_URL="$REACT_APP_SUPABASE_URL"
export SUPABASE_ANON_KEY="$REACT_APP_SUPABASE_ANON_KEY"
: "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY (fetch live)}"
GATE=$(bash smoke/run.sh 2>&1)
echo "$GATE" | grep -E "SMOKE:|LARGE FONT:|FUNCTIONAL:|hooks-check"
echo "$GATE" | grep -q "SMOKE: 20/20" || fail "Smoke gate not 20/20."
echo "$GATE" | grep -q "LARGE FONT: 15/15" || fail "Large-font gate not 15/15."
echo "$GATE" | grep -q "FUNCTIONAL:" || fail "Functional gate did not run."
echo "$GATE" | grep "FUNCTIONAL:" | grep -qv "0 passed" || fail "Functional gate failed."
# functional must show all passed (no ✗)
echo "$GATE" | grep -q "✗" && fail "Functional gate has failures (see ✗ above)."

# 4. data integrity (if a PAT is available)
say "Step 4/4 — data integrity sweep"
if [ -n "${SUPA_PAT:-}" ]; then
  SUPA_PAT="$SUPA_PAT" node smoke/data_integrity.mjs || fail "Data integrity sweep found issues."
else
  echo "  (skipped — set SUPA_PAT to run the live data sweep)"
fi

printf "\n\033[1;32m✓ ALL GREEN — %s is safe to ship.\033[0m\n" "$VER"
printf "  Next: git add -A && git commit -F <msg> && git push origin main\n"
printf "  Then verify live by SHA (see BUILD_PROCESS.md Step 8).\n\n"
