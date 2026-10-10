#!/bin/bash
# Lead-verdict check on a throwaway local database.
# Does not connect to production and does not apply SQL there.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${LEAD_VERDICT_TEST_DB:-lead_verdict_test}"
PSQL=(psql -v ON_ERROR_STOP=1)
if [ "$(id -un)" != "postgres" ]; then
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)
fi
"${PSQL[@]}" -c "drop database if exists ${DB};"
"${PSQL[@]}" -c "create database ${DB};"
"${PSQL[@]}" -d "$DB" -f supabase/tests/lead_notify_verdict_fixture.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/sql/2026-10-10c_lead_notify_verdict_guard.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/tests/lead_notify_verdict.sql >/dev/null
echo "lead notify verdict: passed"
