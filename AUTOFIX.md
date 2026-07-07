# Supervised auto-fix (staging only)

The crash → AI-fix → staging pipeline. **It never touches production** — prod
promotion is always a separate, manual, human step.

## Status: engine built & validated; autonomous trigger pending one permission grant
- `supabase/functions/propose-patch` — given a crash + code slice, returns a
  minimal patch (keeps the Anthropic key server-side).
- `scripts/auto-fix.mjs` — for ONE crash: resolve file/line → get patch → apply →
  build → **smoke gate** → deploy to staging → record the diff in `crash_fixes`.
  Validated locally end-to-end (planted a ReferenceError; it proposed + applied
  the fix, passed smoke 16/16, staged it).
- `crash_fixes` table — stores each attempt (status, file, diff, explanation,
  confidence, smoke_result, staging_url) for human review.

## To activate one-tap-from-the-app autonomy
The deploy PAT currently lacks **Secrets**, **Workflows**, and **Actions**
permissions, so the GitHub Actions runner can't be provisioned automatically.
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
