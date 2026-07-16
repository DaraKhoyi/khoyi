# Add the smoke gate to CI (needs a permission Claude doesn't have)

## Why this matters

`.github/workflows/deploy.yml` **deploys to production on every push to `main`.**
A smoke gate that only runs on a developer's machine therefore protects nothing:
one forgetful push ships a broken app straight to the beta agents.

The gate has to run **inside the pipeline**, between build and publish, so that
red smoke fails the job and the publish step never executes.

## Why it isn't already done

Our fine-grained GitHub PAT lacks the `workflow` permission, so pushing any change
under `.github/workflows/` is rejected by GitHub:

    ! [remote rejected] main -> main (refusing to allow a Personal Access Token to
      create or update workflow `.github/workflows/deploy.yml` without `workflow` scope)

## Option A — grant the permission once (preferred)

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ (the PrismOS deploy token) → Repository permissions → set **Workflows: Read and write**
→ Save. Then Claude can apply this and future CI changes directly.

(This is the same permission gap that blocks the auto-fix engine's one-tap autonomy.)

## Option B — apply it by hand

Copy `scripts/deploy-with-smoke.workflow.yml` over `.github/workflows/deploy.yml`
and commit. The only change is one new step inserted **before** "Publish build to
gh-pages".

## What the step does

- Installs Playwright chromium.
- Mints the `service_role` key **at run time** from `SUPABASE_ACCESS_TOKEN`
  (the Management API token the repo already has), so **no new secret is needed**.
- Runs `smoke/run.sh`, which visits every critical view and exits non-zero on any crash.
- If it fails, the job fails and **nothing publishes**.
