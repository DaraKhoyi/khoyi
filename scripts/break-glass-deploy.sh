#!/usr/bin/env bash
# ── break-glass-deploy.sh ───────────────────────────────────────────────────
# Publish PRODUCTION without GitHub Actions.
#
# WHY THIS EXISTS
#   Normal deploys are push-to-main; CI builds, re-runs the gate and publishes.
#   That is the right default and it stays the default. But it welds shipping to
#   GitHub Actions: when Actions is out, there is no route to production at all —
#   including for an urgent fix, which is exactly when you would care. On
#   6 Aug 2026 an Actions incident left three commits stranded for hours.
#   This is the sanctioned way out. It is NOT a faster path; it is the only path
#   when CI is unavailable.
#
# THE ONE RULE
#   The smoke gate runs first and a failure stops everything. A break-glass path
#   that skips the gate is how a broken build reaches agents at the precise
#   moment you are stressed and rushing. --skip-gate exists, it prints a loud
#   warning, and you should be able to say out loud why you used it.
#
# TARGETS
#   gh-pages    (default) pushes the built site to the gh-pages branch.
#               Works when only ACTIONS is down. Does NOT help when GitHub Pages
#               itself is degraded — publishing to gh-pages still waits on
#               GitHub's own Pages build. Read the caveat in DEPLOY.md.
#   cloudflare  publishes straight to Cloudflare Pages. This is the only target
#               that is genuinely independent of GitHub. Needs CLOUDFLARE_API_TOKEN
#               and CLOUDFLARE_ACCOUNT_ID.
#
# USAGE
#   export REACT_APP_SUPABASE_URL=... REACT_APP_SUPABASE_ANON_KEY=...
#   export SUPABASE_SERVICE_KEY=...           # gate only
#   bash scripts/break-glass-deploy.sh                      # gh-pages
#   bash scripts/break-glass-deploy.sh --target cloudflare
#   bash scripts/break-glass-deploy.sh --skip-gate          # say why out loud

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="gh-pages"
RUN_GATE=1
for arg in "$@"; do
  case "$arg" in
    --target) shift;;
    gh-pages|cloudflare) TARGET="$arg";;
    --skip-gate) RUN_GATE=0;;
    -h|--help) sed -n '1,35p' "$0"; exit 0;;
  esac
done

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. refuse to ship something that is not what is on main ─────────────────
# Deploying a dirty tree means the live SHA identifies a build nobody can
# reproduce. That is worse than not deploying.
# `git diff --quiet` is NOT enough: it ignores UNTRACKED files, and an untracked
# file still gets compiled into the bundle. Caught in testing — the first version
# of this guard sailed straight past two new files.
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | head -10
  die "Working tree is dirty (including untracked files). Commit or stash first."
fi
git fetch -q origin main
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "  local  $(echo "$LOCAL" | cut -c1-7)"
  echo "  origin $(echo "$REMOTE" | cut -c1-7)"
  die "HEAD does not match origin/main. Push or pull first — never publish a SHA that isn't on main."
fi
SHA=$(echo "$LOCAL" | cut -c1-7)
say "Deploying $SHA to $TARGET"

: "${REACT_APP_SUPABASE_URL:?set REACT_APP_SUPABASE_URL}"
: "${REACT_APP_SUPABASE_ANON_KEY:?set REACT_APP_SUPABASE_ANON_KEY}"

# ── 1. build ────────────────────────────────────────────────────────────────
say "Building"
npm install --no-audit --no-fund >/dev/null
rm -rf build node_modules/.vite
GENERATE_SOURCEMAP=false CI=false npx vite build

# CI normally stamps the service worker with the short SHA. Doing it here keeps
# "verify live by SHA" working, which is the only reliable way to tell whether a
# deploy actually landed through a caching CDN.
if [ -f build/sw.js ]; then
  sed -i.bak "s/prismos-[a-z0-9]\{1,\}/prismos-$SHA/g" build/sw.js && rm -f build/sw.js.bak
  grep -q "prismos-$SHA" build/sw.js || die "Could not stamp sw.js with the SHA."
fi
cp build/index.html build/404.html
echo "darasapp.com" > build/CNAME
[ -s build/CNAME ] || die "CNAME missing — the custom domain would break."

# ── 2. the gate ─────────────────────────────────────────────────────────────
if [ "$RUN_GATE" = "1" ]; then
  say "Running the smoke gate (never publish on red)"
  : "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY, or pass --skip-gate and be able to justify it}"
  export SUPABASE_URL="$REACT_APP_SUPABASE_URL"
  export SUPABASE_ANON_KEY="$REACT_APP_SUPABASE_ANON_KEY"
  bash smoke/run.sh || die "GATE FAILED — nothing published. Fix it, or ship the last good SHA."
else
  printf '\n\033[1;31m!! GATE SKIPPED — you are publishing unverified code to live agents. !!\033[0m\n'
  sleep 4
fi

# ── 3. publish ──────────────────────────────────────────────────────────────
case "$TARGET" in
  gh-pages)
    : "${GITHUB_PAT:?set GITHUB_PAT}"
    say "Publishing to gh-pages"
    npx gh-pages -d build --dotfiles \
      -r "https://${GITHUB_PAT}@github.com/DaraKhoyi/khoyi.git" \
      -m "break-glass deploy $SHA (CI unavailable)"
    echo "  Note: GitHub still has to run its own Pages build. If PAGES is also"
    echo "  degraded this will sit. Use --target cloudflare for a path that does"
    echo "  not depend on GitHub at all."
    ;;
  cloudflare)
    : "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
    : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
    say "Publishing to Cloudflare Pages"
    npx wrangler@latest pages deploy build \
      --project-name "${CLOUDFLARE_PROJECT:-prismos}" --branch main --commit-dirty=true
    ;;
  *) die "Unknown target '$TARGET'";;
esac

# ── 4. verify by SHA, not by hope ───────────────────────────────────────────
say "Verifying live (CDN lag is normal — up to ~4 min)"
for i in $(seq 1 12); do
  LIVE=$(curl -s "https://darasapp.com/sw.js?cb=$RANDOM" | grep -o 'prismos-[a-z0-9]*' | head -1 || true)
  echo "  attempt $i: ${LIVE:-<no response>}"
  if [ "$LIVE" = "prismos-$SHA" ]; then
    printf '\n\033[1;32m✓ Live on %s\033[0m\n' "$SHA"; exit 0
  fi
  sleep 25
done
die "Published, but darasapp.com is not serving $SHA yet. Could be CDN lag or a degraded Pages build — re-check before assuming it failed."
