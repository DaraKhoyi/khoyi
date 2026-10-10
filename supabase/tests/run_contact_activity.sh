#!/bin/bash
# Two-agent attribution check on a throwaway local database.
# Does not connect to production and does not apply SQL there.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${CONTACT_ACTIVITY_TEST_DB:-contact_activity_test}"
PSQL=(psql -v ON_ERROR_STOP=1)
if [ "$(id -un)" != "postgres" ]; then
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)
fi
"${PSQL[@]}" -c "drop database if exists ${DB};"
"${PSQL[@]}" -c "create database ${DB};"
"${PSQL[@]}" -d "$DB" -f supabase/tests/contact_activity_fixture.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/sql/2026-10-09d_contact_activity_attribution.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/sql/2026-10-10b_attribution_all_contacts.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/tests/contact_activity_attribution.sql >/dev/null
echo "contact activity attribution: passed"
"${PSQL[@]}" -d "$DB" -f supabase/sql/rollback/2026-10-10b_attribution_all_contacts.down.sql >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/sql/2026-10-10b_attribution_all_contacts.sql >/dev/null
echo "attribution rollback and re-apply: passed"
