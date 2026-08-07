# Deploying PrismOS

## The default has not changed

**Push to main. CI builds, re-runs the gate, and publishes.** Do not hand-deploy
because it feels faster — it is not, and every manual publish is a chance to ship
a build nobody can reproduce.

## When CI is unavailable

GitHub Actions is not reliable enough to be your only route to production.
Through mid-2026 it averaged an incident roughly every 30 hours, and on
6 Aug 2026 an Actions outage left three commits stranded with jobs queued and no
runner ever assigned. Until then there was no sanctioned way to ship, so an
earlier instruction — *"do not hand-run gh-pages"* — was correct in spirit and a
dead end in practice.

There is now a sanctioned way out:

```bash
export REACT_APP_SUPABASE_URL="https://xlgfspnojjgvkuitcoaf.supabase.co"
export REACT_APP_SUPABASE_ANON_KEY="<anon key>"
export SUPABASE_SERVICE_KEY="<fetch live>"     # the gate needs this
export GITHUB_PAT="<pat>"
bash scripts/break-glass-deploy.sh
```

It refuses to run on a dirty tree or when HEAD is not origin/main, builds, stamps
`sw.js` with the short SHA so "verify by SHA" still works, **runs the full smoke
gate**, publishes, then polls darasapp.com until the SHA appears.

### The one rule

The gate runs first and a failure stops everything. `--skip-gate` exists and
prints a loud warning. If you use it you should be able to say out loud why.
A break-glass path that skips verification is how a broken build reaches agents
at the exact moment you are stressed and rushing.

## Which outage are you in?

| What is broken | Can you ship? | How |
|---|---|---|
| Actions only | Yes | `break-glass-deploy.sh` (gh-pages) |
| Actions **and** Pages | Only via Cloudflare | `--target cloudflare` |
| GitHub entirely (incl. git) | Only via Cloudflare | build from a local clone, `--target cloudflare` |
| Supabase | **No — and hosting is irrelevant.** No auth, no data, no app. |

**The honest caveat on the gh-pages target:** pushing to `gh-pages` still waits on
GitHub's own Pages build. When Pages is degraded — as it was alongside Actions on
6 Aug — this target will sit there too. It solves an Actions-only outage, not a
GitHub-wide one.

## The genuinely independent path

Only the Cloudflare target removes GitHub from the critical path. It needs a
one-time setup that has **not been done yet**:

1. Create a Cloudflare Pages project (suggested name `prismos`).
2. Create an API token with the *Cloudflare Pages: Edit* permission.
3. Keep `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and optionally
   `CLOUDFLARE_PROJECT` alongside the other deploy secrets.
4. Point darasapp.com at Cloudflare, or leave DNS on GitHub Pages and cut over
   only during an incident. Cutting over mid-incident costs a DNS propagation
   wait, so decide this **before** you need it.

Until step 1 is done, `--target cloudflare` will fail on a missing token. That is
the remaining gap, and it is the difference between "I can usually ship" and
"I can always ship."

## Order of fragility

Worth keeping in proportion. Ranked by what actually takes PrismOS down:

1. **Supabase** — a real single point of failure with no redundancy. Auth, data,
   edge functions, cron. If it goes, nothing else matters.
2. **GitHub Pages CDN lag** — a weekly irritation that has repeatedly caused
   stale-build reviews. Verify by SHA, never by version string.
3. **GitHub Actions** — monthly, and now survivable.

An Actions outage stops you shipping. It has never stopped an agent using the
app. Keep the response proportional to that.
