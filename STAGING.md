# Staging

**URL:** https://darakhoyi.github.io/khoyi-staging/  (separate repo `DaraKhoyi/khoyi-staging`, its own GitHub Pages site — fully isolated from production `darasapp.com`).

## What it is
A place to load and click through a NEW build before it reaches agents. It's a
different origin from prod, so it can't touch prod's cache/service-worker/login,
and it's marked with a **STAGING** badge so it's never mistaken for the live app.

## Important: shared backend
Staging talks to the **same live Supabase backend** as production. It's a preview
of new *code* against real *data* — not a data sandbox. Read/click freely; be
careful with destructive writes. (A fully isolated backend is a future upgrade.)

## Workflow (the seatbelt)
1. Make changes.
2. Build → run the smoke gate (`smoke/run.sh`).
3. Deploy to staging: `GITHUB_PAT=... REACT_APP_SUPABASE_URL=... REACT_APP_SUPABASE_ANON_KEY=... bash scripts/deploy-staging.sh`
4. Open the staging URL, log in (separate login), verify the change.
5. Only then promote to production (the normal gh-pages deploy to darasapp.com).

## Caveats
- Log in again on staging (separate origin = separate session).
- Connecting a NEW Gmail/Calendar may fail on staging unless the staging redirect
  URI is added to Google — most testing doesn't need it.
