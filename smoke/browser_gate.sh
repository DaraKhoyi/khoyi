#!/usr/bin/env bash
# browser_gate.sh — the three browser suites, run at the same time instead of
# one after another.
#
# WHY. Serially, smoke (64 views), functional (136 checks) and largefont (37
# views) take about six minutes, and they are the whole cost of a push. They do
# not depend on each other, so the only reason they queued was that nobody had
# split them. In parallel the gate takes as long as the SLOWEST one, ~2 minutes.
#
# WHY A SEPARATE ACCOUNT EACH. Three suites clicking through one login at the
# same time is a race: functional creates and edits records while smoke is
# reading them, and a failure would be the tests colliding rather than the app
# breaking. A gate that fails for its own reasons gets ignored, which is worse
# than a slow one. Each suite gets a throwaway account of its own.
#
# CLEANUP IS A TRAP, NOT A LAST LINE. The old single-account runner deleted its
# user at the end, so any run that timed out, failed, or was interrupted left the
# account behind — 121 of them had accumulated since June, holding 10,890 rows,
# before smoke/test_hygiene.mjs cleaned them out on 23 Sep. The trap fires on
# success, failure and Ctrl-C alike.
#
# Usage:  bash smoke/browser_gate.sh
# Needs:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, and a server
#         already serving build/ at $SMOKE_BASE (default http://localhost:4173/).

set -uo pipefail

URL="${SUPABASE_URL:?SUPABASE_URL required}"
ANON="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY required}"
SK="${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY required}"
BASE="${SMOKE_BASE:-http://localhost:4173/}"
SUITES="${SUITES:-smoke functional largefont}"
LOGDIR="${LOGDIR:-/tmp/gate}"
mkdir -p "$LOGDIR"

declare -A UID_OF
CREATED=()

cleanup() {
  for u in "${CREATED[@]:-}"; do
    [ -n "$u" ] && curl -s -o /dev/null -X DELETE "$URL/auth/v1/admin/users/$u" \
      -H "apikey: $SK" -H "Authorization: Bearer $SK" || true
  done
}
trap cleanup EXIT INT TERM

make_user() {   # -> "uid email password"
  local stamp="$1"
  local email="smoke_${stamp}_$RANDOM@example.com"
  local pass="Smoke!${stamp}x"
  local uid
  uid=$(curl -s -X POST "$URL/auth/v1/admin/users" \
        -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$pass\",\"email_confirm\":true}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
  [ -z "$uid" ] && return 1
  # user_settings rows are made by a signup trigger, so this must upsert.
  curl -s -o /dev/null -X POST "$URL/rest/v1/user_settings" \
    -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=minimal" \
    -d "{\"user_id\":\"$uid\",\"onboarding_complete\":true,\"display_name\":\"Smoke Test\"}"
  SEED_USER_ID="$uid" node smoke/seed.mjs >/dev/null 2>&1
  echo "$uid $email $pass"
}

echo "▸ preparing one account per suite…"
declare -A EMAIL_OF PASS_OF
for s in $SUITES; do
  read -r uid email pass <<<"$(make_user "$(date +%s)")" || { echo "✗ could not create a test account for $s"; exit 1; }
  UID_OF[$s]="$uid"; EMAIL_OF[$s]="$email"; PASS_OF[$s]="$pass"; CREATED+=("$uid")
done

run_suite() {   # suite -> log
  SMOKE_URL="$BASE" SMOKE_EMAIL="${EMAIL_OF[$1]}" SMOKE_PASSWORD="${PASS_OF[$1]}" \
    node "smoke/$1.mjs" > "$LOGDIR/$1.log" 2>&1
}

# TWO AT A TIME, NOT THREE. Measured on this container: three headless browsers
# at once finished in 212s when nothing flaked, but the contention made a suite
# fail often enough that the serial retry pushed a run to 382s — SLOWER than
# running them one after another (~340s). Two at a time keeps most of the saving
# without the contention that causes the retry. Raise MAXJOBS only with a
# measurement, not a hope.
MAXJOBS="${MAXJOBS:-2}"

echo "▸ running ${SUITES// /, }, ${MAXJOBS} at a time…"
declare -A PID_OF
running=0
for s in $SUITES; do
  run_suite "$s" &
  PID_OF[$s]=$!
  running=$((running + 1))
  if [ "$running" -ge "$MAXJOBS" ]; then
    wait -n 2>/dev/null || true      # a slot freed; the exit code is collected below
    running=$((running - 1))
  fi
done

# ONE RETRY, ON ITS OWN, AND SAY SO. Running three browsers at once on one
# container is slower per browser, and smoke's ari_shell check — which asserts
# the signed-in session carries into the Ari shell — lost that race once while
# passing 64/64 when run alone. The cure for a flake must never be to loosen the
# check; it is to run it again cleanly. A suite that fails TWICE is a real
# failure, and a retry is always printed so flakiness stays visible.
FAILED=0
RETRIED=""
for s in $SUITES; do
  if wait "${PID_OF[$s]}"; then
    echo "  ✓ $s — $(grep -oE '====.*====' "$LOGDIR/$s.log" | tail -1)"
  else
    echo "  … $s failed under load — retrying it alone"
    if run_suite "$s"; then
      RETRIED="$RETRIED $s"
      echo "  ✓ $s — $(grep -oE '====.*====' "$LOGDIR/$s.log" | tail -1)  (passed on retry)"
    else
      FAILED=1
      echo "  ✗ $s FAILED TWICE — a real failure. See $LOGDIR/$s.log"
      grep -E '✗|FATAL|Error' "$LOGDIR/$s.log" | head -5
    fi
  fi
done
[ -n "$RETRIED" ] && echo "  note: needed a retry:$RETRIED"

[ "$FAILED" -eq 0 ] && echo "==== BROWSER GATE: all suites green ====" \
                    || echo "==== BROWSER GATE: FAILED — do not push ===="
exit "$FAILED"
