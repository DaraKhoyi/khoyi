# Supervised auto-fix (staging only)

The crash → AI-fix → staging pipeline. **It never touches production** — prod
promotion is always a separate, manual, human step.

## Status: ACTIVE (2026-07-17). One-tap autonomy is live.
- `supabase/functions/propose-patch` — given a crash + code slice, returns a
  minimal patch (keeps the Anthropic key server-side).
- `scripts/auto-fix.mjs` — for ONE crash: resolve file/line → get patch → apply →
  build → **smoke gate** → deploy to staging → record the diff in `crash_fixes`.
  Validated locally end-to-end (planted a ReferenceError; it proposed + applied
  the fix, passed smoke 16/16, staged it).
- `crash_fixes` table — stores each attempt (status, file, diff, explanation,
  confidence, smoke_result, staging_url) for human review.

## To activate one-tap-from-the-app autonomy
DONE. The PAT was regranted with Contents/Workflows/Actions/Secrets, the workflow
lives at `.github/workflows/auto-fix.yml`, and its secrets are set. Notes:
- `SUPABASE_SERVICE_KEY` is deliberately NOT a stored secret — it is minted at run
  time from `SUPABASE_ACCESS_TOKEN`. The key that bypasses all RLS never sits at rest.
- propose-patch authenticates on `AUTOFIX_TOKEN` (its own secret), NOT the shared
  `QCP_TOKEN` that 14 other functions use. Blast radius of one.
- `ANTHROPIC_API_KEY` is not needed by the runner; propose-patch keeps it server-side.
OLD NOTE (historical):
Grant those three on the fine-grained PAT (github.com → Settings → Developer
settings → the token → Repository permissions), then:
1. Move `scripts/auto-fix.workflow.yml` → `.github/workflows/auto-fix.yml`.
2. Set repo Actions secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
   INTERNAL_TOKEN, DEPLOY_PAT.
3. Add a `request-auto-fix` edge function that (admin-only) inserts a `crash_fixes`
   row and fires `POST /repos/DaraKhoyi/khoyi/dispatches {event_type:auto_fix}`.
4. Add an "Attempt AI fix on staging" button to App Health.

## Until then
The engine runs on demand in a working session: point Claude at a crash, it
stages a fix (same pipeline, same smoke gate), you review it on staging, and it
only reaches production once you approve.
