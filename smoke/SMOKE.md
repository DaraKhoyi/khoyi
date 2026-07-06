# Pre-deploy smoke check

Automated guard that catches "this view crashes when you open it" bugs **before**
they reach agents — the exact class of failure that hit the Inbox for Ola and
Vickie in July 2026.

## What it does
A headless browser logs in as a throwaway agent and visits every critical view
(`dashboard, inbox, contacts, tasks, calendar, quo, email_review, group_message,
chief, agentruns, agent_activity, journal, brain, prospecting, settings,
app_health`). If any view trips the error boundary ("This view ran into an
error") or throws an uncaught error, the run **fails with exit code 1** — so the
deploy is blocked.

It navigates via `window.__setView(view)`, a hook exposed by the app for exactly
this purpose.

## Run it
```bash
# after building (build/ must exist), with Supabase keys in the env:
export SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=...
bash smoke/run.sh
```
Exit 0 = all views OK, safe to deploy. Exit 1 = a view crashed; the summary
lists which one. Fix it, rebuild, re-run — do not deploy on a red smoke.

## When to run
Every time, right after the build and **before** `gh-pages` deploy. It's the last
gate between a change and your agents.

## Notes / future
- Runs as a fresh, minimal agent, so it catches render/scope crashes (which fire
  regardless of data). To also catch data-shaped crashes, add a second pass with
  a populated read-only test account.
- Admin-only views render for the throwaway user via `__setView`; RLS simply
  returns empty data, so they still prove the view doesn't crash.
- Self-verified: planting a deliberate crash in a view makes the smoke fail on
  exactly that view (validated against a canary).
